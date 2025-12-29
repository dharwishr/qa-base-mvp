"""
Replay Service - Handles replaying all steps in an existing session.

This service provides the core replay functionality for re-initiating test sessions.
When a user opens an old test case and clicks "Re-initiate Session", this service:
1. Starts a new browser session (or reuses existing one)
2. Replays all recorded steps in the browser using CDPRunner
3. Returns the result including browser session info for live view
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime

import aiohttp
from sqlalchemy.orm import Session

from app.models import ExecutionLog, TestSession
from app.services.browser_orchestrator import (
    BrowserPhase,
    BrowserSession as OrchestratorSession,
    get_orchestrator,
)
from app.services.cdp_runner import CDPRunner
from app.services.replay_builder import build_playwright_steps_for_session

logger = logging.getLogger(__name__)


async def _wait_for_browser_ready(cdp_http_url: str, max_retries: int = 30, delay: float = 1.0) -> bool:
    """Wait for the browser to be ready by polling the CDP endpoint."""
    for attempt in range(max_retries):
        try:
            async with aiohttp.ClientSession() as http_session:
                async with http_session.get(
                    f"{cdp_http_url}/json/version",
                    timeout=aiohttp.ClientTimeout(total=5)
                ) as resp:
                    if resp.status == 200:
                        logger.info(f"Browser ready after {attempt + 1} attempts")
                        return True
        except Exception:
            pass
        await asyncio.sleep(delay)
    return False


async def _get_cdp_ws_url(browser_session: OrchestratorSession) -> str | None:
    """
    Fetch fresh CDP WebSocket URL from the browser's /json/version endpoint.
    """
    import re
    import os
    
    running_in_docker = os.path.exists("/.dockerenv")
    
    if running_in_docker and browser_session.container_ip:
        check_host = browser_session.container_ip
        check_port = 9222
    elif browser_session.cdp_port:
        check_host = browser_session.cdp_host
        check_port = browser_session.cdp_port
    else:
        logger.warning("No CDP port or container IP available")
        return None
    
    cdp_http_url = f"http://{check_host}:{check_port}"
    
    # Wait for browser to be ready
    if not await _wait_for_browser_ready(cdp_http_url):
        logger.warning("Browser never became ready")
        return None
    
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
                        logger.info(f"Got CDP WebSocket URL: {fresh_url}")
                        return fresh_url
    except Exception as e:
        logger.warning(f"Error getting CDP URL: {e}")
    
    return None


@dataclass
class ReplayResult:
    """Result of a replay operation."""
    success: bool
    total_steps: int
    steps_replayed: int
    replay_status: str  # passed | failed | healed | partial
    error_message: str | None = None
    failed_at_step: int | None = None
    browser_session_id: str | None = None
    user_message: str | None = None


async def replay_session(
    db: Session,
    session: TestSession,
    headless: bool = False,
) -> ReplayResult:
    """
    Replay all steps in a test session.
    
    This will:
    1. Start a new browser session (via orchestrator)
    2. Build replay steps from the session's recorded steps
    3. Execute replay using CDPRunner
    
    Args:
        db: Database session
        session: The test session to replay
        headless: Whether to run in headless mode
    
    Returns:
        ReplayResult with details of the operation
    """
    logger.info(f"Starting replay for session {session.id}, headless={headless}")
    
    steps = list(session.steps)
    if not steps:
        return ReplayResult(
            success=False,
            total_steps=0,
            steps_replayed=0,
            replay_status="failed",
            error_message="No steps found in session",
            user_message="This session has no steps to replay.",
        )
    
    total_steps = len(steps)
    max_step = max(s.step_number for s in steps)
    
    # Log the replay start
    db.add(ExecutionLog(
        session_id=session.id,
        level="INFO",
        message=f"Starting replay of {total_steps} steps",
        source="replay_service",
    ))
    db.commit()
    
    # Start a new browser session
    orchestrator = get_orchestrator()
    if not orchestrator:
        return ReplayResult(
            success=False,
            total_steps=total_steps,
            steps_replayed=0,
            replay_status="failed",
            error_message="Browser orchestrator not available",
            user_message="Could not start browser. Please try again.",
        )
    
    try:
        browser_session = await orchestrator.create_session(
            phase=BrowserPhase.ANALYSIS,
            test_session_id=session.id,
        )
        logger.info(f"Started browser session {browser_session.id} for replay")
    except Exception as e:
        logger.error(f"Failed to start browser session: {e}")
        return ReplayResult(
            success=False,
            total_steps=total_steps,
            steps_replayed=0,
            replay_status="failed",
            error_message=str(e),
            user_message="Failed to start browser session. Please try again.",
        )
    
    # Get CDP WebSocket URL
    cdp_url = await _get_cdp_ws_url(browser_session)
    if not cdp_url:
        await orchestrator.stop_session(browser_session.id)
        return ReplayResult(
            success=False,
            total_steps=total_steps,
            steps_replayed=0,
            replay_status="failed",
            error_message="Could not get CDP WebSocket URL",
            user_message="Browser started but could not connect. Please try again.",
        )
    
    # Build replay steps
    pw_steps = build_playwright_steps_for_session(steps, max_step)
    
    if not pw_steps:
        logger.warning(f"No PlaywrightSteps built for replay in session {session.id}")
        return ReplayResult(
            success=True,
            total_steps=total_steps,
            steps_replayed=0,
            replay_status="passed",
            browser_session_id=browser_session.id,
            user_message="Session loaded. No actions to replay.",
        )
    
    # Execute replay using CDPRunner
    logger.info(f"Replaying {len(pw_steps)} steps using CDP URL: {cdp_url}")
    
    try:
        runner = CDPRunner(
            headless=headless,
            cdp_url=cdp_url,
        )
        
        async with runner:
            run_id = f"replay_{session.id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
            result = await runner.run(pw_steps, run_id)
        
        # Handle replay result
        steps_replayed = len([r for r in result.step_results if r.status in ("passed", "healed")])
        
        if result.status == "failed" and result.step_results:
            failed_step_result = result.step_results[-1]
            failed_step_index = failed_step_result.step_index + 1  # 1-indexed for user
            
            db.add(ExecutionLog(
                session_id=session.id,
                level="WARNING",
                message=f"Replay failed at step {failed_step_index}: {result.error_message}",
                source="replay_service",
            ))
            db.commit()

            # Touch the browser session to keep it active for debugging
            await orchestrator.touch_session(browser_session.id)

            return ReplayResult(
                success=False,
                total_steps=total_steps,
                steps_replayed=steps_replayed,
                replay_status="partial" if steps_replayed > 0 else "failed",
                error_message=result.error_message,
                failed_at_step=failed_step_index,
                browser_session_id=browser_session.id,
                user_message=f"Replay failed at step {failed_step_index}: {result.error_message}",
            )
        
        # Log success
        db.add(ExecutionLog(
            session_id=session.id,
            level="INFO",
            message=f"Replay completed successfully. Status: {result.status}. "
                    f"Passed: {result.passed_steps}, Healed: {result.healed_steps}",
            source="replay_service",
        ))
        db.commit()

        # Touch the browser session to keep it active for user interaction
        await orchestrator.touch_session(browser_session.id)

        healed_msg = f" ({result.healed_steps} selectors auto-healed)" if result.healed_steps > 0 else ""

        return ReplayResult(
            success=True,
            total_steps=total_steps,
            steps_replayed=steps_replayed,
            replay_status=result.status,
            browser_session_id=browser_session.id,
            user_message=f"Successfully replayed all {total_steps} steps.{healed_msg}",
        )
        
    except Exception as e:
        logger.exception(f"Error during replay for session {session.id}")
        
        try:
            db.rollback()
        except Exception:
            pass
        
        try:
            db.add(ExecutionLog(
                session_id=session.id,
                level="ERROR",
                message=f"Replay failed with error: {str(e)}",
                source="replay_service",
            ))
            db.commit()
        except Exception as log_error:
            logger.warning(f"Failed to log replay error: {log_error}")
        
        return ReplayResult(
            success=False,
            total_steps=total_steps,
            steps_replayed=0,
            replay_status="failed",
            error_message=str(e),
            browser_session_id=browser_session.id if browser_session else None,
            user_message=f"Replay failed: {str(e)}",
        )
