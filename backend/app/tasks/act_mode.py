"""Celery task for act mode execution.

Act mode allows executing a single action/task without a full test plan.
This task wraps the act mode execution with event publishing for
persistence and real-time streaming.
"""

import asyncio
import logging

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import TestSession
from app.services.event_publisher import (
    AnalysisEventPublisher,
    check_cancelled,
)

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="execute_act_mode")
def execute_act_mode(
    self,
    session_id: str,
    task: str,
    previous_context: str | None = None,
) -> dict:
    """Execute a single action in act mode via Celery.

    Args:
        session_id: The test session ID
        task: The task/action to perform
        previous_context: Optional context from previous actions

    Returns:
        Dict with act mode results:
        {
            "status": "completed" | "failed" | "cancelled",
            "step_id": str | None,
            "thinking": str | None,
            "actions": list[dict],
            "screenshot_path": str | None,
            "error": str | None
        }
    """
    from app.services.browser_service import execute_act_mode_sync

    db = SessionLocal()
    publisher = None

    try:
        # Get session
        session = db.query(TestSession).filter(TestSession.id == session_id).first()
        if not session:
            logger.error(f"Session {session_id} not found")
            return {
                "status": "failed",
                "error": f"Session {session_id} not found",
                "step_id": None,
                "thinking": None,
                "actions": [],
                "screenshot_path": None,
            }

        # Initialize event publisher
        publisher = AnalysisEventPublisher(db, session_id)

        # Check if cancelled before starting
        if check_cancelled(session_id):
            logger.info(f"Act mode cancelled before start for session {session_id}")
            publisher.act_mode_failed("Cancelled by user")
            return {
                "status": "cancelled",
                "step_id": None,
                "thinking": None,
                "actions": [],
                "screenshot_path": None,
            }

        # Publish act mode started
        publisher.act_mode_started(task)

        logger.info(f"Starting act mode for session {session_id}: {task[:100]}...")

        # Execute using existing sync function
        result = execute_act_mode_sync(
            db=db,
            session=session,
            task=task,
            previous_context=previous_context,
        )

        # Check if cancelled after execution
        if check_cancelled(session_id):
            logger.info(f"Act mode cancelled after execution for session {session_id}")
            return {
                "status": "cancelled",
                "step_id": result.get("step_id"),
                "thinking": result.get("thinking"),
                "actions": result.get("result", []),
                "screenshot_path": result.get("screenshot_path"),
            }

        # Get step ID from result (the step created during execution)
        step_id = result.get("step_id")

        # Convert actions from result format
        actions = []
        if result.get("result"):
            for action in result["result"]:
                actions.append({
                    "action_name": action.get("action", "unknown"),
                    "success": action.get("success", True),
                    "error": action.get("error"),
                })

        if result.get("success", False):
            # Publish completion
            publisher.act_mode_completed(
                step_id=step_id or "",
                thinking=result.get("thinking"),
                actions=actions,
                screenshot_path=result.get("screenshot_path"),
            )

            return {
                "status": "completed",
                "step_id": step_id,
                "thinking": result.get("thinking"),
                "evaluation": result.get("evaluation"),
                "memory": result.get("memory"),
                "next_goal": result.get("next_goal"),
                "actions": actions,
                "screenshot_path": result.get("screenshot_path"),
                "browser_state": result.get("browser_state", {}),
                "browser_session_id": result.get("browser_session_id"),
            }
        else:
            # Publish failure
            error = result.get("error", "Unknown error")
            publisher.act_mode_failed(error)

            return {
                "status": "failed",
                "step_id": step_id,
                "thinking": result.get("thinking"),
                "actions": actions,
                "screenshot_path": result.get("screenshot_path"),
                "error": error,
            }

    except Exception as e:
        logger.error(f"Act mode task failed for session {session_id}: {e}")

        if publisher:
            publisher.act_mode_failed(str(e))

        return {
            "status": "failed",
            "step_id": None,
            "thinking": None,
            "actions": [],
            "screenshot_path": None,
            "error": str(e),
        }

    finally:
        if publisher:
            publisher.close()
        db.close()
