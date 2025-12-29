"""
Run Till End Service - Executes all steps in a session from start to finish.

This service provides:
1. Reset browser to initial URL
2. Execute all steps sequentially
3. Real-time progress via WebSocket
4. Pause on failure with options: Auto Heal, Undo, Skip
5. Cancellation support
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Awaitable

import aiohttp
from sqlalchemy.orm import Session
from starlette.websockets import WebSocket

from app.models import ExecutionLog, TestSession, TestStep
from app.services.browser_orchestrator import (
    BrowserPhase,
    BrowserSession as OrchestratorSession,
    get_orchestrator,
)
from app.services.cdp_runner import CDPRunner
from app.services.replay_builder import build_playwright_steps_for_session
from app.services.script_recorder import PlaywrightStep

logger = logging.getLogger(__name__)


@dataclass
class RunTillEndState:
    """State of a Run Till End execution."""
    session_id: str
    is_running: bool = False
    is_paused: bool = False  # Paused on failure
    current_step: int = 0
    total_steps: int = 0
    failed_step: int | None = None
    failed_error: str | None = None
    skipped_steps: list[int] = field(default_factory=list)
    cancel_requested: bool = False


@dataclass
class RunTillEndResult:
    """Result of Run Till End execution."""
    success: bool
    total_steps: int
    completed_steps: int
    failed_step: int | None = None
    skipped_steps: list[int] = field(default_factory=list)
    error_message: str | None = None


async def _refresh_cdp_ws_url(browser_session: OrchestratorSession) -> str | None:
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
                        logger.info(f"Refreshed CDP WebSocket URL: {fresh_url}")
                        return fresh_url
    except Exception as e:
        logger.warning(f"Error refreshing CDP URL: {e}")

    return None


class RunTillEndService:
    """Service to execute all steps from start to finish."""

    def __init__(
        self,
        db: Session,
        session: TestSession,
        send_message: Callable[[dict[str, Any]], Awaitable[None]],
    ):
        self.db = db
        self.session = session
        self.send_message = send_message
        self.state = RunTillEndState(session_id=session.id)
        self._continue_event = asyncio.Event()
        self._pw_steps: list[PlaywrightStep] = []
        self._step_to_pw_index: dict[int, int] = {}  # Maps step_number to PlaywrightStep indices

    async def execute(self) -> RunTillEndResult:
        """
        Execute all steps from start to finish.

        Returns:
            RunTillEndResult with execution details
        """
        logger.info(f"Starting Run Till End for session {self.session.id}")

        # Get all steps
        steps = list(self.session.steps)
        if not steps:
            return RunTillEndResult(
                success=False,
                total_steps=0,
                completed_steps=0,
                error_message="No steps found in session",
            )

        # Sort by step number
        steps = sorted(steps, key=lambda s: s.step_number)
        max_step = steps[-1].step_number

        self.state.total_steps = len(steps)
        self.state.is_running = True

        # Send started message
        await self.send_message({
            "type": "run_till_end_started",
            "total_steps": len(steps),
        })

        # Find active browser session
        orchestrator = get_orchestrator()
        browser_sessions = await orchestrator.list_sessions(
            phase=BrowserPhase.ANALYSIS,
            active_only=True,
        )

        browser_session = next(
            (bs for bs in browser_sessions if bs.test_session_id == self.session.id),
            None
        )

        if not browser_session:
            logger.warning(f"No active browser session found for session {self.session.id}")
            return RunTillEndResult(
                success=False,
                total_steps=len(steps),
                completed_steps=0,
                error_message="No active browser session found. Please start the browser first.",
            )

        # Refresh CDP URL
        cdp_url = await _refresh_cdp_ws_url(browser_session)
        if not cdp_url:
            return RunTillEndResult(
                success=False,
                total_steps=len(steps),
                completed_steps=0,
                error_message="Browser session is no longer reachable.",
            )

        # Build PlaywrightSteps for all steps
        self._pw_steps = build_playwright_steps_for_session(steps, max_step)

        if not self._pw_steps:
            return RunTillEndResult(
                success=True,
                total_steps=len(steps),
                completed_steps=0,
                error_message="No executable steps found",
            )

        # Build mapping from step_number to pw_step indices
        # Note: pw_steps include a goto at index 0, so we need to account for that
        self._build_step_mapping(steps)

        # Log start
        self.db.add(ExecutionLog(
            session_id=self.session.id,
            level="INFO",
            message=f"Run Till End started with {len(self._pw_steps)} PlaywrightSteps",
            source="run_till_end_service",
        ))
        self.db.commit()

        # Execute steps using CDPRunner
        completed_steps = 0
        current_pw_index = 0

        try:
            runner = CDPRunner(
                headless=False,
                cdp_url=cdp_url,
            )

            async with runner:
                while current_pw_index < len(self._pw_steps):
                    # Check for cancellation
                    if self.state.cancel_requested:
                        logger.info(f"Run Till End cancelled at step {current_pw_index}")
                        await self.send_message({
                            "type": "run_till_end_completed",
                            "success": False,
                            "total_steps": len(steps),
                            "completed_steps": completed_steps,
                            "skipped_steps": self.state.skipped_steps,
                            "cancelled": True,
                        })
                        return RunTillEndResult(
                            success=False,
                            total_steps=len(steps),
                            completed_steps=completed_steps,
                            skipped_steps=self.state.skipped_steps,
                            error_message="Cancelled by user",
                        )

                    pw_step = self._pw_steps[current_pw_index]
                    step_number = self._get_step_number_for_pw_index(current_pw_index, steps)

                    # Send progress update
                    self.state.current_step = step_number
                    await self.send_message({
                        "type": "run_till_end_progress",
                        "current_step": step_number,
                        "total_steps": len(steps),
                        "status": "running",
                    })

                    # Execute the step
                    run_id = f"rte_{self.session.id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
                    step_result = await runner._execute_step(pw_step, run_id)

                    if step_result.status == "failed":
                        # Step failed - pause and wait for user action
                        self.state.is_paused = True
                        self.state.failed_step = step_number
                        self.state.failed_error = step_result.error_message

                        await self.send_message({
                            "type": "run_till_end_paused",
                            "failed_step": step_number,
                            "error_message": step_result.error_message or "Step execution failed",
                            "options": ["auto_heal", "undo", "skip"],
                        })

                        # Wait for user action (skip or continue)
                        self._continue_event.clear()
                        await self._continue_event.wait()

                        # Check if cancelled
                        if self.state.cancel_requested:
                            continue  # Will be handled at loop start

                        # Check if step was skipped
                        if step_number in self.state.skipped_steps:
                            logger.info(f"Step {step_number} skipped, continuing to next")
                            current_pw_index += 1
                            continue

                        # Otherwise break on failure
                        return RunTillEndResult(
                            success=False,
                            total_steps=len(steps),
                            completed_steps=completed_steps,
                            failed_step=step_number,
                            skipped_steps=self.state.skipped_steps,
                            error_message=step_result.error_message,
                        )

                    # Step passed or healed
                    completed_steps += 1
                    current_pw_index += 1

                    # Send step completed status
                    await self.send_message({
                        "type": "run_till_end_progress",
                        "current_step": step_number,
                        "total_steps": len(steps),
                        "status": "completed",
                    })

            # All steps completed
            self.state.is_running = False

            # Touch the browser session to keep it active for user interaction
            await orchestrator.touch_session(browser_session.id)

            await self.send_message({
                "type": "run_till_end_completed",
                "success": True,
                "total_steps": len(steps),
                "completed_steps": completed_steps,
                "skipped_steps": self.state.skipped_steps,
            })

            # Log completion
            self.db.add(ExecutionLog(
                session_id=self.session.id,
                level="INFO",
                message=f"Run Till End completed: {completed_steps}/{len(steps)} steps, {len(self.state.skipped_steps)} skipped",
                source="run_till_end_service",
            ))
            self.db.commit()

            return RunTillEndResult(
                success=True,
                total_steps=len(steps),
                completed_steps=completed_steps,
                skipped_steps=self.state.skipped_steps,
            )

        except Exception as e:
            logger.exception(f"Run Till End failed for session {self.session.id}")

            self.state.is_running = False

            await self.send_message({
                "type": "run_till_end_completed",
                "success": False,
                "total_steps": len(steps),
                "completed_steps": completed_steps,
                "skipped_steps": self.state.skipped_steps,
                "error_message": str(e),
            })

            return RunTillEndResult(
                success=False,
                total_steps=len(steps),
                completed_steps=completed_steps,
                skipped_steps=self.state.skipped_steps,
                error_message=str(e),
            )

    def _build_step_mapping(self, steps: list[TestStep]) -> None:
        """Build mapping from step_number to PlaywrightStep indices."""
        # The first pw_step is typically a goto (navigation)
        # After that, each TestStep's actions become pw_steps
        # This is approximate - we map by position
        pw_index = 0
        for step in steps:
            if step.step_number == 1 and pw_index == 0:
                # First step often has a goto prepended
                pw_index = 0
            self._step_to_pw_index[step.step_number] = pw_index
            # Count actions in this step
            action_count = len(step.actions) if step.actions else 0
            if step.step_number == 1:
                action_count += 1  # Account for goto step
            pw_index += max(1, action_count)

    def _get_step_number_for_pw_index(self, pw_index: int, steps: list[TestStep]) -> int:
        """Get the TestStep step_number for a given PlaywrightStep index."""
        # Find which step this pw_index belongs to
        for step in reversed(steps):
            start_idx = self._step_to_pw_index.get(step.step_number, 0)
            if pw_index >= start_idx:
                return step.step_number
        return steps[0].step_number if steps else 1

    async def skip_step(self, step_number: int) -> None:
        """
        Mark a step as skipped (visually only, not saved to DB).
        This doesn't continue execution - user must click Continue separately.
        """
        logger.info(f"Skipping step {step_number} in session {self.session.id}")

        if step_number not in self.state.skipped_steps:
            self.state.skipped_steps.append(step_number)

        # Send confirmation that step is skipped
        await self.send_message({
            "type": "step_skipped",
            "step_number": step_number,
        })

        # Log skip action
        self.db.add(ExecutionLog(
            session_id=self.session.id,
            level="INFO",
            message=f"Step {step_number} skipped during Run Till End",
            source="run_till_end_service",
        ))
        self.db.commit()

    async def continue_execution(self) -> None:
        """
        Continue execution after a skip.
        """
        logger.info(f"Continuing Run Till End for session {self.session.id}")
        self.state.is_paused = False
        self._continue_event.set()

    async def cancel(self) -> None:
        """Cancel the current execution."""
        logger.info(f"Cancelling Run Till End for session {self.session.id}")
        self.state.cancel_requested = True
        self.state.is_running = False
        # If paused, wake up the wait
        self._continue_event.set()

        # Log cancellation
        self.db.add(ExecutionLog(
            session_id=self.session.id,
            level="INFO",
            message="Run Till End cancelled by user",
            source="run_till_end_service",
        ))
        self.db.commit()


# Global registry of active Run Till End services by session_id
_active_services: dict[str, RunTillEndService] = {}


def get_active_service(session_id: str) -> RunTillEndService | None:
    """Get the active Run Till End service for a session."""
    return _active_services.get(session_id)


def register_service(session_id: str, service: RunTillEndService) -> None:
    """Register an active Run Till End service."""
    _active_services[session_id] = service


def unregister_service(session_id: str) -> None:
    """Unregister a Run Till End service."""
    _active_services.pop(session_id, None)
