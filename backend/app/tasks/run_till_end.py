"""Celery task for run-till-end execution.

Run-till-end replays all recorded steps from a test session,
allowing verification that the test still works correctly.

This task integrates with the AnalysisEventPublisher for
persistence and real-time streaming.
"""

import asyncio
import logging
from typing import Any

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import TestSession, TestStep, ExecutionLog
from app.services.event_publisher import (
    AnalysisEventPublisher,
    check_cancelled,
    check_stop_requested,
    clear_stop_requested,
)

logger = logging.getLogger(__name__)


# Redis key patterns for run-till-end control
SKIP_STEP_KEY = "rte_skip:{session_id}:{step_number}"
CONTINUE_KEY = "rte_continue:{session_id}"


@celery_app.task(bind=True, name="run_till_end")
def run_till_end(self, session_id: str, skipped_steps: list[int] | None = None) -> dict:
    """Execute all recorded steps in a session from start to finish.

    Args:
        session_id: The test session ID
        skipped_steps: Optional list of step numbers to skip

    Returns:
        Dict with run-till-end results:
        {
            "status": "completed" | "failed" | "paused" | "cancelled",
            "success": bool,
            "total_steps": int,
            "completed_steps": int,
            "failed_step": int | None,
            "skipped_steps": list[int],
            "error": str | None
        }
    """
    from app.services.run_till_end_service import RunTillEndService, RunTillEndResult

    db = SessionLocal()
    publisher = None
    skipped = list(skipped_steps) if skipped_steps else []

    try:
        # Get session
        session = db.query(TestSession).filter(TestSession.id == session_id).first()
        if not session:
            logger.error(f"Session {session_id} not found")
            return {
                "status": "failed",
                "success": False,
                "total_steps": 0,
                "completed_steps": 0,
                "failed_step": None,
                "skipped_steps": skipped,
                "error": f"Session {session_id} not found",
            }

        # Initialize event publisher
        publisher = AnalysisEventPublisher(db, session_id)

        # Check if cancelled before starting
        if check_cancelled(session_id):
            logger.info(f"Run-till-end cancelled before start for session {session_id}")
            publisher.run_till_end_completed(success=False, skipped_steps=skipped)
            return {
                "status": "cancelled",
                "success": False,
                "total_steps": 0,
                "completed_steps": 0,
                "failed_step": None,
                "skipped_steps": skipped,
            }

        # Get all steps
        steps = db.query(TestStep).filter(
            TestStep.session_id == session_id
        ).order_by(TestStep.step_number).all()

        if not steps:
            logger.warning(f"No steps found for session {session_id}")
            return {
                "status": "completed",
                "success": True,
                "total_steps": 0,
                "completed_steps": 0,
                "failed_step": None,
                "skipped_steps": skipped,
            }

        total_steps = len(steps)

        # Publish started event
        publisher.run_till_end_started(total_steps=total_steps)

        logger.info(f"Starting run-till-end for session {session_id}: {total_steps} steps")

        # Execute using a wrapper that publishes events
        result = _execute_run_till_end(
            db=db,
            session=session,
            publisher=publisher,
            steps=steps,
            skipped_steps=skipped,
        )

        # Clear stop flag if set
        clear_stop_requested(session_id)

        # Publish completion
        publisher.run_till_end_completed(
            success=result.get("success", False),
            skipped_steps=result.get("skipped_steps", []),
        )

        logger.info(f"Run-till-end completed for session {session_id}: {result}")
        return result

    except Exception as e:
        logger.error(f"Run-till-end task failed for session {session_id}: {e}")

        if publisher:
            publisher.run_till_end_completed(success=False, skipped_steps=skipped)

        return {
            "status": "failed",
            "success": False,
            "total_steps": 0,
            "completed_steps": 0,
            "failed_step": None,
            "skipped_steps": skipped,
            "error": str(e),
        }

    finally:
        if publisher:
            publisher.close()
        db.close()


def _execute_run_till_end(
    db,
    session: TestSession,
    publisher: AnalysisEventPublisher,
    steps: list[TestStep],
    skipped_steps: list[int],
) -> dict:
    """Execute run-till-end with event publishing.

    This uses the existing RunTillEndService but wraps it to:
    1. Check for stop/cancel flags
    2. Publish progress events
    3. Handle skip steps from the caller

    Args:
        db: Database session
        session: Test session
        publisher: Event publisher
        steps: List of steps to execute
        skipped_steps: Step numbers to skip

    Returns:
        Dict with execution results
    """
    from app.services.run_till_end_service import RunTillEndService

    session_id = session.id
    total_steps = len(steps)
    completed_steps = 0
    failed_step = None
    failed_error = None

    # Create a modified send_message callback that publishes events
    async def send_message_callback(msg: dict) -> None:
        """Forward WebSocket-style messages to event publisher."""
        msg_type = msg.get("type", "")

        if msg_type == "run_till_end_progress":
            current = msg.get("current_step", 0)
            total = msg.get("total_steps", total_steps)

            # Check for stop request
            if check_stop_requested(session_id):
                logger.info(f"Stop requested during run-till-end for session {session_id}")
                return

            publisher.run_till_end_progress(current_step=current, total_steps=total)

        elif msg_type == "run_till_end_paused":
            step_num = msg.get("step_number", 0)
            error = msg.get("error", "Unknown error")
            publisher.run_till_end_paused(step_number=step_num, error=error)

    # Create service with our callback
    service = RunTillEndService(db, session, send_message_callback)

    # Set skipped steps if provided
    service.state.skipped_steps = list(skipped_steps)

    # Run in event loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(service.execute())

        # Check final status
        if check_stop_requested(session_id):
            return {
                "status": "paused",
                "success": False,
                "total_steps": result.total_steps,
                "completed_steps": result.completed_steps,
                "failed_step": result.failed_step,
                "skipped_steps": result.skipped_steps,
                "error": "Paused by user",
            }
        elif check_cancelled(session_id):
            return {
                "status": "cancelled",
                "success": False,
                "total_steps": result.total_steps,
                "completed_steps": result.completed_steps,
                "failed_step": result.failed_step,
                "skipped_steps": result.skipped_steps,
            }
        else:
            return {
                "status": "completed" if result.success else "failed",
                "success": result.success,
                "total_steps": result.total_steps,
                "completed_steps": result.completed_steps,
                "failed_step": result.failed_step,
                "skipped_steps": result.skipped_steps,
                "error": result.error_message,
            }

    finally:
        loop.close()
