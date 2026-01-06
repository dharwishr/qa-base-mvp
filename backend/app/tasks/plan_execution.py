"""Celery task for test plan execution.

This task handles executing test plans using browser-use in a Celery worker,
enabling scalability, reliability, and resource isolation.

Note: This task coexists with the existing `run_test_analysis` task.
The difference is that this task integrates with the AnalysisEventPublisher
for persistent event logging and real-time streaming.
"""

import asyncio
import logging
from typing import Any

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import TestSession, TestStep
from app.services.event_publisher import (
    AnalysisEventPublisher,
    check_cancelled,
    check_stop_requested,
    clear_stop_requested,
)
from app.utils.log_handler import SessionLogHandler

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="execute_test_plan")
def execute_test_plan(self, session_id: str) -> dict:
    """Execute a test plan in a Celery worker.

    This task wraps the BrowserServiceSync execution and adds:
    - Event publishing to DB and Redis for persistence and real-time streaming
    - Stop/cancel checking via Redis flags
    - Proper status management

    Args:
        session_id: The test session ID to execute

    Returns:
        Dict with execution results:
        {
            "status": "completed" | "failed" | "paused" | "cancelled",
            "total_steps": int,
            "error": str | None
        }
    """
    from app.services.browser_service import BrowserServiceSync

    db = SessionLocal()
    publisher = None
    log_handler = None
    browser_use_logger = None
    app_logger = None

    try:
        # Get session
        session = db.query(TestSession).filter(TestSession.id == session_id).first()
        if not session:
            logger.error(f"Session {session_id} not found")
            return {"status": "failed", "error": f"Session {session_id} not found", "total_steps": 0}

        if not session.plan:
            logger.error(f"Session {session_id} has no plan")
            return {"status": "failed", "error": "Session has no plan", "total_steps": 0}

        # Initialize event publisher
        publisher = AnalysisEventPublisher(db, session_id)

        # Check if cancelled before starting
        if check_cancelled(session_id):
            logger.info(f"Execution cancelled before start for session {session_id}")
            session.status = "cancelled"
            session.execution_task_id = None
            db.commit()
            publisher.execution_cancelled()
            return {"status": "cancelled", "total_steps": 0}

        # Setup session-specific logging
        log_handler = SessionLogHandler(SessionLocal, session_id)
        log_handler.setLevel(logging.DEBUG)
        log_handler.setFormatter(
            logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
        )

        # Add handler to browser_use loggers
        browser_use_logger = logging.getLogger("browser_use")
        browser_use_logger.addHandler(log_handler)
        browser_use_logger.setLevel(logging.DEBUG)

        # Also capture app logs
        app_logger = logging.getLogger("app")
        app_logger.addHandler(log_handler)
        app_logger.setLevel(logging.DEBUG)

        try:
            # Update session status
            session.status = "running"
            session.execution_task_id = self.request.id
            db.commit()

            # Publish execution started event
            plan_steps = session.plan.steps_json.get("steps", []) if session.plan.steps_json else []
            publisher.execution_started(total_steps=len(plan_steps))

            logger.info(f"Starting test execution for session {session_id}")

            # Create service with stop check callback
            service = BrowserServiceSync(db, session)

            # Create a wrapper that checks stop/cancel flags and publishes events
            result = _execute_with_monitoring(
                db=db,
                session=session,
                service=service,
                publisher=publisher,
            )

            # Clear stop flag if set
            clear_stop_requested(session_id)

            # Update final status based on result
            if result.get("status") == "paused":
                session.status = "paused"
                publisher.execution_paused()
            elif result.get("status") == "cancelled":
                session.status = "cancelled"
                publisher.execution_cancelled()
            elif result.get("success", False):
                session.status = "completed"
                publisher.execution_completed(success=True, total_steps=result.get("total_steps", 0))
            else:
                session.status = "failed"
                publisher.execution_failed(result.get("error", "Unknown error"))

            session.execution_task_id = None
            db.commit()

            logger.info(f"Test execution completed for session {session_id}: {result}")
            return result

        finally:
            # Remove log handlers
            if browser_use_logger and log_handler:
                browser_use_logger.removeHandler(log_handler)
            if app_logger and log_handler:
                app_logger.removeHandler(log_handler)

    except Exception as e:
        logger.error(f"Execution task failed for session {session_id}: {e}")

        try:
            session = db.query(TestSession).filter(TestSession.id == session_id).first()
            if session:
                session.status = "failed"
                session.execution_task_id = None
                db.commit()

                if publisher:
                    publisher.execution_failed(str(e))
        except Exception:
            pass

        raise

    finally:
        if publisher:
            publisher.close()
        db.close()


def _execute_with_monitoring(
    db,
    session: TestSession,
    service: "BrowserServiceSync",
    publisher: AnalysisEventPublisher,
) -> dict:
    """Execute with stop/cancel monitoring and event publishing.

    This wraps the actual execution and:
    1. Checks for stop/cancel flags periodically
    2. Publishes step events as they complete
    3. Handles graceful stop when requested

    Args:
        db: Database session
        session: Test session
        service: BrowserServiceSync instance
        publisher: Event publisher

    Returns:
        Dict with execution results
    """
    session_id = session.id

    # Create a custom step callback to publish events
    original_on_step_end = getattr(service, '_on_step_end', None)

    def on_step_completed(step_data: dict):
        """Called when a step completes."""
        # Check for stop request
        if check_stop_requested(session_id):
            logger.info(f"Stop requested during execution for session {session_id}")
            service._stop_requested = True

        # Publish step completed event
        publisher.step_completed(
            step_number=step_data.get("step_number", 0),
            step_id=step_data.get("step_id", ""),
            thinking=step_data.get("thinking"),
            evaluation=step_data.get("evaluation"),
            memory=step_data.get("memory"),
            next_goal=step_data.get("next_goal"),
            actions=step_data.get("actions", []),
            screenshot_path=step_data.get("screenshot_path"),
            url=step_data.get("url"),
            page_title=step_data.get("page_title"),
            created_at=step_data.get("created_at"),
        )

        # Call original callback if exists
        if original_on_step_end:
            original_on_step_end(step_data)

    # Set the callback
    service._step_callback = on_step_completed

    # Execute
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(service.execute(session.plan))

        # Check final status
        if check_stop_requested(session_id):
            result["status"] = "paused"
        elif check_cancelled(session_id):
            result["status"] = "cancelled"
        else:
            result["status"] = "completed" if result.get("success", False) else "failed"

        return result
    finally:
        loop.close()
