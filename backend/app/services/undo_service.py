"""
Undo Service - Handles undoing test steps by replaying actions.

This service provides the core undo functionality for test analysis sessions.
When a user clicks "Undo till here", this service:
1. Deletes steps after the target step from the database
2. Replays the remaining steps in the browser using CDPRunner
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import aiohttp
from sqlalchemy.orm import Session

from app.models import ExecutionLog, StepAction, TestSession, TestStep
from app.services.browser_orchestrator import (
    BrowserPhase,
    BrowserSession as OrchestratorSession,
    get_orchestrator,
)
from app.services.cdp_runner import CDPRunner
from app.services.replay_builder import build_playwright_steps_for_session

logger = logging.getLogger(__name__)


async def _refresh_cdp_ws_url(browser_session: OrchestratorSession) -> str | None:
    """
    Fetch fresh CDP WebSocket URL from the browser's /json/version endpoint.
    
    The WebSocket URL includes a unique GUID that changes each browser session,
    so we must fetch it fresh rather than using a cached value.
    
    Returns:
        The fresh WebSocket URL, or None if the browser is not reachable.
    """
    import re
    import os
    
    # Detect if running in Docker
    running_in_docker = os.path.exists("/.dockerenv")
    
    # Determine which address to use
    if running_in_docker and browser_session.container_ip:
        check_host = browser_session.container_ip
        check_port = 9222  # Internal container port
    elif browser_session.cdp_port:
        check_host = browser_session.cdp_host
        check_port = browser_session.cdp_port
    else:
        logger.warning("No CDP port or container IP available")
        return None
    
    cdp_http_url = f"http://{check_host}:{check_port}"
    
    try:
        async with aiohttp.ClientSession() as http_session:
            async with http_session.get(
                f"{cdp_http_url}/json/version",
                timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                if resp.status == 200:
                    version_info = await resp.json()
                    ws_url = version_info.get("webSocketDebuggerUrl")
                    if ws_url:
                        # Rewrite the URL to use the correct host/port
                        if running_in_docker and browser_session.container_ip:
                            fresh_url = re.sub(
                                r'ws://[^/]+',
                                f'ws://{browser_session.container_ip}:9222',
                                ws_url
                            )
                        else:
                            fresh_url = re.sub(
                                r'ws://[^/]+',
                                f'ws://{browser_session.cdp_host}:{browser_session.cdp_port}',
                                ws_url
                            )
                        logger.info(f"Refreshed CDP WebSocket URL: {fresh_url}")
                        return fresh_url
                    else:
                        logger.warning("No webSocketDebuggerUrl in /json/version response")
                else:
                    logger.warning(f"CDP /json/version returned status {resp.status}")
    except aiohttp.ClientError as e:
        logger.warning(f"Failed to connect to CDP endpoint: {e}")
    except asyncio.TimeoutError:
        logger.warning("Timeout connecting to CDP endpoint")
    except Exception as e:
        logger.warning(f"Error refreshing CDP URL: {e}")
    
    return None


@dataclass
class UndoResult:
    """Result of an undo operation."""
    success: bool
    target_step_number: int
    steps_removed: int
    steps_replayed: int
    replay_status: str  # passed | failed | healed | partial
    error_message: str | None = None
    failed_at_step: int | None = None
    actual_step_number: int | None = None  # The step we actually ended up at (for partial undo)
    user_message: str | None = None  # Human-readable message for the UI


async def undo_to_step(
    db: Session,
    session: TestSession,
    target_step_number: int,
) -> UndoResult:
    """
    Undo a test session to a specific step number.
    
    This will:
    1. Delete all steps after target_step_number
    2. Find the active browser session
    3. Replay steps 1 through target_step_number using CDPRunner
    
    Args:
        db: Database session
        session: The test session to undo
        target_step_number: The step number to undo to (inclusive)
    
    Returns:
        UndoResult with details of the operation
    """
    logger.info(f"Starting undo for session {session.id} to step {target_step_number}")
    
    # Validate target step number
    steps = list(session.steps)
    if not steps:
        return UndoResult(
            success=False,
            target_step_number=target_step_number,
            steps_removed=0,
            steps_replayed=0,
            replay_status="failed",
            error_message="No steps found in session",
        )
    
    max_step = max(s.step_number for s in steps)
    if target_step_number < 1 or target_step_number > max_step:
        return UndoResult(
            success=False,
            target_step_number=target_step_number,
            steps_removed=0,
            steps_replayed=0,
            replay_status="failed",
            error_message=f"Invalid target step number. Must be between 1 and {max_step}",
        )
    
    # Nothing to undo if we're already at the target
    if target_step_number == max_step:
        return UndoResult(
            success=True,
            target_step_number=target_step_number,
            steps_removed=0,
            steps_replayed=0,
            replay_status="passed",
        )
    
    # Step 1: Delete steps after target_step_number
    steps_to_delete = [s for s in steps if s.step_number > target_step_number]
    steps_removed = len(steps_to_delete)
    
    for step in steps_to_delete:
        # Delete step actions first (cascade may handle this, but be explicit)
        db.query(StepAction).filter(StepAction.step_id == step.id).delete(synchronize_session=False)
        db.delete(step)
    
    db.commit()
    logger.info(f"Deleted {steps_removed} steps from session {session.id}")
    
    # Log the undo action
    db.add(ExecutionLog(
        session_id=session.id,
        level="INFO",
        message=f"Undo to step {target_step_number} triggered; steps {target_step_number + 1}..{max_step} deleted",
        source="undo_service",
    ))
    db.commit()
    
    # Step 2: Find active browser session
    orchestrator = get_orchestrator()
    browser_sessions = await orchestrator.list_sessions(
        phase=BrowserPhase.ANALYSIS,
        active_only=True,
    )
    
    browser_session = next(
        (bs for bs in browser_sessions if bs.test_session_id == session.id),
        None
    )
    
    if not browser_session:
        logger.warning(f"No active browser session found for session {session.id}")
        return UndoResult(
            success=False,
            target_step_number=target_step_number,
            steps_removed=steps_removed,
            steps_replayed=0,
            replay_status="failed",
            error_message="No active browser session found. Please start a new test session.",
        )
    
    # Refresh CDP WebSocket URL from the browser's /json/version endpoint
    # The URL changes each time the browser restarts, so we must fetch it fresh
    cdp_url = await _refresh_cdp_ws_url(browser_session)
    if not cdp_url:
        logger.warning(f"Could not get fresh CDP URL for session {session.id}")
        return UndoResult(
            success=False,
            target_step_number=target_step_number,
            steps_removed=steps_removed,
            steps_replayed=0,
            replay_status="failed",
            error_message="Browser session is no longer reachable. Please start a new test session.",
        )
    
    # Step 3: Build replay steps
    remaining_steps = [s for s in steps if s.step_number <= target_step_number]
    pw_steps = build_playwright_steps_for_session(remaining_steps, target_step_number)
    
    if not pw_steps:
        logger.warning(f"No PlaywrightSteps built for replay in session {session.id}")
        return UndoResult(
            success=True,
            target_step_number=target_step_number,
            steps_removed=steps_removed,
            steps_replayed=0,
            replay_status="passed",
        )
    
    # Step 4: Execute replay using CDPRunner
    logger.info(f"Replaying {len(pw_steps)} steps using CDP URL: {cdp_url}")
    
    try:
        runner = CDPRunner(
            headless=False,  # Browser is already running
            cdp_url=cdp_url,
        )
        
        async with runner:
            run_id = f"undo_{session.id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
            result = await runner.run(pw_steps, run_id)
        
        # Handle partial replay - if replay failed, delete steps from failed step onwards
        if result.status == "failed" and result.step_results:
            # Find the step that failed (the last one in results since we stop on failure)
            failed_step_result = result.step_results[-1]
            failed_step_index = failed_step_result.step_index
            
            # Calculate actual step number we successfully reached
            # The step_index in result is 0-based, and maps to remaining_steps
            # We successfully completed steps before the failed one
            successful_step_count = len([r for r in result.step_results if r.status in ("passed", "healed")])
            
            # Find the actual TestStep that failed - remaining_steps are sorted by step_number
            if successful_step_count < len(remaining_steps):
                # Calculate which step numbers to keep and remove
                step_numbers_to_keep = [s.step_number for s in remaining_steps[:successful_step_count]]
                step_numbers_to_remove = [s.step_number for s in remaining_steps[successful_step_count:]]
                
                if step_numbers_to_remove:
                    actual_last_step = step_numbers_to_keep[-1] if step_numbers_to_keep else 0
                    
                    logger.info(
                        f"Partial undo: deleting steps {step_numbers_to_remove} "
                        f"(failed at step index {failed_step_index}), keeping up to step {actual_last_step}"
                    )
                    
                    # Fresh query to get steps to delete (avoid stale objects)
                    fresh_steps_to_delete = db.query(TestStep).filter(
                        TestStep.session_id == session.id,
                        TestStep.step_number.in_(step_numbers_to_remove)
                    ).all()
                    
                    # Get the action type of the first failed step for the message
                    failed_action = "unknown"
                    if fresh_steps_to_delete and fresh_steps_to_delete[0].actions:
                        failed_action = fresh_steps_to_delete[0].actions[0].action_name
                    
                    # Delete step actions first, then steps
                    for step in fresh_steps_to_delete:
                        db.query(StepAction).filter(StepAction.step_id == step.id).delete(synchronize_session=False)
                    
                    # Delete the steps
                    db.query(TestStep).filter(
                        TestStep.session_id == session.id,
                        TestStep.step_number.in_(step_numbers_to_remove)
                    ).delete(synchronize_session=False)
                    
                    db.commit()
                    
                    # Log the partial undo
                    db.add(ExecutionLog(
                        session_id=session.id,
                        level="WARNING",
                        message=f"Partial undo: replay failed at step {failed_step_index + 1}. "
                                f"Deleted steps {actual_last_step + 1}..{target_step_number}. "
                                f"Session now at step {actual_last_step}.",
                        source="undo_service",
                    ))
                    db.commit()
                    
                    return UndoResult(
                        success=False,
                        target_step_number=target_step_number,
                        steps_removed=steps_removed + len(step_numbers_to_remove),
                        steps_replayed=successful_step_count,
                        replay_status="partial",
                        error_message=result.error_message,
                        failed_at_step=failed_step_index,
                        actual_step_number=actual_last_step,
                        user_message=f"Undo partially completed. Replay failed at step {actual_last_step + 1} ({failed_action}): {result.error_message}. Session is now at step {actual_last_step}.",
                    )
        
        # Log replay result for successful case
        db.add(ExecutionLog(
            session_id=session.id,
            level="INFO" if result.status in ("passed", "healed") else "ERROR",
            message=f"Undo replay completed with status: {result.status}. "
                    f"Passed: {result.passed_steps}, Failed: {result.failed_steps}, "
                    f"Healed: {result.healed_steps}",
            source="undo_service",
        ))
        db.commit()
        
        return UndoResult(
            success=result.status in ("passed", "healed"),
            target_step_number=target_step_number,
            steps_removed=steps_removed,
            steps_replayed=len(pw_steps),
            replay_status=result.status,
            error_message=result.error_message,
            failed_at_step=result.step_results[-1].step_index if result.status == "failed" and result.step_results else None,
            actual_step_number=target_step_number if result.status in ("passed", "healed") else None,
            user_message=f"Successfully undid to step {target_step_number}." if result.status in ("passed", "healed") else None,
        )
        
    except Exception as e:
        logger.exception(f"Error during undo replay for session {session.id}")
        
        # Rollback any pending transaction before attempting to log
        try:
            db.rollback()
        except Exception:
            pass
        
        try:
            db.add(ExecutionLog(
                session_id=session.id,
                level="ERROR",
                message=f"Undo replay failed with error: {str(e)}",
                source="undo_service",
            ))
            db.commit()
        except Exception as log_error:
            logger.warning(f"Failed to log undo error: {log_error}")
            try:
                db.rollback()
            except Exception:
                pass
        
        return UndoResult(
            success=False,
            target_step_number=target_step_number,
            steps_removed=steps_removed,
            steps_replayed=0,
            replay_status="failed",
            error_message=str(e),
        )


def undo_to_step_sync(
    db: Session,
    session: TestSession,
    target_step_number: int,
) -> UndoResult:
    """
    Synchronous wrapper for undo_to_step.
    
    Creates a new event loop to run the async function.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(
            undo_to_step(db, session, target_step_number)
        )
    finally:
        loop.close()
