"""Event publisher service for analysis events.

This service provides a unified interface for:
1. Logging events to the database (AnalysisEvent table) for persistence
2. Publishing events to Redis pub/sub for real-time WebSocket streaming

Usage:
    publisher = AnalysisEventPublisher(db, session_id)
    publisher.plan_started()
    publisher.plan_progress(50, "Calling LLM...")
    publisher.plan_completed(plan_id, plan_text, steps)
"""

import json
import logging
from datetime import datetime
from typing import Any

import redis
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AnalysisEvent

logger = logging.getLogger(__name__)


class AnalysisEventPublisher:
    """Publishes analysis events to both DB and Redis for persistence and real-time streaming."""

    def __init__(self, db: Session, session_id: str):
        """Initialize the event publisher.

        Args:
            db: SQLAlchemy database session
            session_id: Test session ID to publish events for
        """
        self.db = db
        self.session_id = session_id
        self._redis: redis.Redis | None = None
        self.channel = f"analysis_events:{session_id}"

    @property
    def redis_client(self) -> redis.Redis:
        """Lazy-load Redis client."""
        if self._redis is None:
            self._redis = redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)
        return self._redis

    def publish(self, event_type: str, data: dict[str, Any] | None = None) -> AnalysisEvent:
        """Publish an event to both DB and Redis.

        Args:
            event_type: Type of event (e.g., 'plan_started', 'step_completed')
            data: Optional event data payload

        Returns:
            The created AnalysisEvent record
        """
        # 1. Save to database for persistence
        event = AnalysisEvent(
            session_id=self.session_id,
            event_type=event_type,
            event_data=data or {},
        )
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)

        # 2. Publish to Redis for real-time streaming
        message = {
            "type": event_type,
            "session_id": self.session_id,
            "timestamp": event.created_at.isoformat(),
            **(data or {}),
        }
        try:
            self.redis_client.publish(self.channel, json.dumps(message))
            logger.debug(f"Published event {event_type} for session {self.session_id}")
        except Exception as e:
            logger.error(f"Failed to publish event to Redis: {e}")
            # Don't raise - DB persistence succeeded, Redis is best-effort

        return event

    def close(self) -> None:
        """Close Redis connection."""
        if self._redis is not None:
            self._redis.close()
            self._redis = None

    # =====================================
    # Plan Generation Events
    # =====================================

    def plan_started(self) -> AnalysisEvent:
        """Publish plan generation started event."""
        return self.publish("plan_started", {"progress": 0, "message": "Starting plan generation..."})

    def plan_progress(self, progress: int, message: str) -> AnalysisEvent:
        """Publish plan generation progress event.

        Args:
            progress: Progress percentage (0-100)
            message: Progress message to display
        """
        return self.publish("plan_progress", {"progress": progress, "message": message})

    def plan_completed(self, plan_id: str, plan_text: str, steps: list[dict]) -> AnalysisEvent:
        """Publish plan generation completed event.

        Args:
            plan_id: ID of the generated plan
            plan_text: Human-readable plan summary
            steps: List of plan steps
        """
        return self.publish("plan_completed", {
            "progress": 100,
            "plan_id": plan_id,
            "plan_text": plan_text,
            "steps": steps,
        })

    def plan_failed(self, error: str) -> AnalysisEvent:
        """Publish plan generation failed event.

        Args:
            error: Error message
        """
        return self.publish("plan_failed", {"error": error})

    def plan_cancelled(self) -> AnalysisEvent:
        """Publish plan generation cancelled event."""
        return self.publish("plan_cancelled", {"message": "Plan generation cancelled by user"})

    # =====================================
    # Execution Events
    # =====================================

    def execution_started(self, total_steps: int | None = None) -> AnalysisEvent:
        """Publish execution started event.

        Args:
            total_steps: Total number of steps to execute (if known)
        """
        return self.publish("execution_started", {"total_steps": total_steps})

    def step_started(self, step_number: int) -> AnalysisEvent:
        """Publish step started event.

        Args:
            step_number: The step number being executed
        """
        return self.publish("step_started", {"step_number": step_number})

    def step_completed(
        self,
        step_number: int,
        step_id: str,
        thinking: str | None = None,
        evaluation: str | None = None,
        memory: str | None = None,
        next_goal: str | None = None,
        actions: list[dict] | None = None,
        screenshot_path: str | None = None,
        url: str | None = None,
        page_title: str | None = None,
        created_at: str | None = None,
    ) -> AnalysisEvent:
        """Publish step completed event.

        Args:
            step_number: The step number that completed
            step_id: The step ID in the database
            thinking: LLM's reasoning for the step
            evaluation: Result evaluation
            memory: Memory from LLM
            next_goal: Next goal determined by LLM
            actions: List of actions performed
            screenshot_path: Path to screenshot
            url: Current page URL
            page_title: Current page title
            created_at: Step creation timestamp
        """
        # Format step as expected by frontend (matches TestStep interface)
        step = {
            "id": step_id,
            "step_number": step_number,
            "url": url,
            "page_title": page_title,
            "thinking": thinking,
            "evaluation": evaluation,
            "memory": memory,
            "next_goal": next_goal,
            "screenshot_path": screenshot_path,
            "status": "completed",
            "error": None,
            "created_at": created_at or datetime.utcnow().isoformat(),
            "actions": actions or [],
        }
        return self.publish("step_completed", {"step": step})

    def step_failed(self, step_number: int, error: str) -> AnalysisEvent:
        """Publish step failed event.

        Args:
            step_number: The step number that failed
            error: Error message
        """
        return self.publish("step_failed", {"step_number": step_number, "error": error})

    def action_executed(
        self,
        step_number: int,
        action_index: int,
        action_name: str,
        success: bool,
        error: str | None = None,
    ) -> AnalysisEvent:
        """Publish individual action executed event.

        Args:
            step_number: The step number
            action_index: Index of the action within the step
            action_name: Name of the action (e.g., 'click_element')
            success: Whether the action succeeded
            error: Error message if failed
        """
        return self.publish("action_executed", {
            "step_number": step_number,
            "action_index": action_index,
            "action_name": action_name,
            "success": success,
            "error": error,
        })

    def execution_completed(self, success: bool, total_steps: int) -> AnalysisEvent:
        """Publish execution completed event.

        Args:
            success: Whether execution completed successfully
            total_steps: Total number of steps executed
        """
        # Use "completed" type to match frontend WSCompleted interface
        return self.publish("completed", {"success": success, "total_steps": total_steps})

    def execution_failed(self, error: str) -> AnalysisEvent:
        """Publish execution failed event.

        Args:
            error: Error message
        """
        return self.publish("execution_failed", {"error": error})

    def execution_paused(self) -> AnalysisEvent:
        """Publish execution paused event (user stopped execution, browser stays alive)."""
        return self.publish("execution_paused", {"message": "Execution paused by user"})

    def execution_cancelled(self) -> AnalysisEvent:
        """Publish execution cancelled event (task fully cancelled)."""
        return self.publish("execution_cancelled", {"message": "Execution cancelled"})

    # =====================================
    # Act Mode Events
    # =====================================

    def act_mode_started(self, task: str) -> AnalysisEvent:
        """Publish act mode started event.

        Args:
            task: The task being executed
        """
        return self.publish("act_mode_started", {"task": task})

    def act_mode_completed(
        self,
        step_id: str,
        thinking: str | None = None,
        actions: list[dict] | None = None,
        screenshot_path: str | None = None,
    ) -> AnalysisEvent:
        """Publish act mode completed event.

        Args:
            step_id: The step ID created
            thinking: LLM reasoning
            actions: Actions performed
            screenshot_path: Path to screenshot
        """
        return self.publish("act_mode_completed", {
            "step_id": step_id,
            "thinking": thinking,
            "actions": actions or [],
            "screenshot_path": screenshot_path,
        })

    def act_mode_failed(self, error: str) -> AnalysisEvent:
        """Publish act mode failed event.

        Args:
            error: Error message
        """
        return self.publish("act_mode_failed", {"error": error})

    # =====================================
    # Run Till End Events
    # =====================================

    def run_till_end_started(self, total_steps: int) -> AnalysisEvent:
        """Publish run-till-end started event.

        Args:
            total_steps: Total number of steps to replay
        """
        return self.publish("run_till_end_started", {"total_steps": total_steps})

    def run_till_end_progress(self, current_step: int, total_steps: int) -> AnalysisEvent:
        """Publish run-till-end progress event.

        Args:
            current_step: Current step being executed
            total_steps: Total number of steps
        """
        return self.publish("run_till_end_progress", {
            "current_step": current_step,
            "total_steps": total_steps,
        })

    def run_till_end_paused(self, step_number: int, error: str) -> AnalysisEvent:
        """Publish run-till-end paused event (failed at a step).

        Args:
            step_number: The step that failed
            error: Error message
        """
        return self.publish("run_till_end_paused", {"step_number": step_number, "error": error})

    def run_till_end_completed(self, success: bool, skipped_steps: list[int] | None = None) -> AnalysisEvent:
        """Publish run-till-end completed event.

        Args:
            success: Whether all steps passed
            skipped_steps: List of step numbers that were skipped
        """
        return self.publish("run_till_end_completed", {
            "success": success,
            "skipped_steps": skipped_steps or [],
        })

    # =====================================
    # Status Change Events
    # =====================================

    def status_changed(self, old_status: str, new_status: str) -> AnalysisEvent:
        """Publish session status changed event.

        Args:
            old_status: Previous status
            new_status: New status
        """
        return self.publish("status_changed", {"old_status": old_status, "new_status": new_status})


# =====================================
# Utility Functions
# =====================================

def check_stop_requested(session_id: str) -> bool:
    """Check if stop has been requested for this session via Redis flag.

    This is used by Celery tasks to check if the user has requested to stop execution.
    The flag is set by FastAPI when the user clicks the stop button.

    Args:
        session_id: The session ID to check

    Returns:
        True if stop was requested, False otherwise
    """
    try:
        r = redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)
        result = r.get(f"stop_execution:{session_id}")
        return result is not None
    except Exception as e:
        logger.error(f"Failed to check stop flag in Redis: {e}")
        return False


def set_stop_requested(session_id: str, ttl_seconds: int = 300) -> bool:
    """Set the stop flag for a session in Redis.

    Args:
        session_id: The session ID to set stop flag for
        ttl_seconds: Time-to-live for the flag (default 5 minutes)

    Returns:
        True if flag was set successfully, False otherwise
    """
    try:
        r = redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)
        r.set(f"stop_execution:{session_id}", "1", ex=ttl_seconds)
        logger.info(f"Set stop flag for session {session_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to set stop flag in Redis: {e}")
        return False


def clear_stop_requested(session_id: str) -> bool:
    """Clear the stop flag for a session in Redis.

    Args:
        session_id: The session ID to clear stop flag for

    Returns:
        True if flag was cleared successfully, False otherwise
    """
    try:
        r = redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)
        r.delete(f"stop_execution:{session_id}")
        logger.info(f"Cleared stop flag for session {session_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to clear stop flag in Redis: {e}")
        return False


def check_cancelled(session_id: str) -> bool:
    """Check if task has been cancelled for this session via Redis flag.

    This is different from stop_requested - cancel fully terminates the task,
    while stop_requested gracefully pauses after current step.

    Args:
        session_id: The session ID to check

    Returns:
        True if cancelled, False otherwise
    """
    try:
        r = redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)
        result = r.get(f"cancel:{session_id}")
        return result is not None
    except Exception as e:
        logger.error(f"Failed to check cancel flag in Redis: {e}")
        return False


def set_cancelled(session_id: str, ttl_seconds: int = 300) -> bool:
    """Set the cancel flag for a session in Redis.

    Args:
        session_id: The session ID to set cancel flag for
        ttl_seconds: Time-to-live for the flag (default 5 minutes)

    Returns:
        True if flag was set successfully, False otherwise
    """
    try:
        r = redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)
        r.set(f"cancel:{session_id}", "1", ex=ttl_seconds)
        logger.info(f"Set cancel flag for session {session_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to set cancel flag in Redis: {e}")
        return False


def clear_cancelled(session_id: str) -> bool:
    """Clear the cancel flag for a session in Redis.

    Args:
        session_id: The session ID to clear cancel flag for

    Returns:
        True if flag was cleared successfully, False otherwise
    """
    try:
        r = redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)
        r.delete(f"cancel:{session_id}")
        logger.info(f"Cleared cancel flag for session {session_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to clear cancel flag in Redis: {e}")
        return False


# =====================================
# Pause Execution (Resumable pause during AI execution)
# =====================================

def check_pause_requested(session_id: str) -> bool:
    """Check if pause has been requested for this session via Redis flag.

    This is different from stop_requested - pause allows resumption,
    while stop is terminal.

    Args:
        session_id: The session ID to check

    Returns:
        True if pause was requested, False otherwise
    """
    try:
        r = redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)
        result = r.get(f"pause_execution:{session_id}")
        return result is not None
    except Exception as e:
        logger.error(f"Failed to check pause flag in Redis: {e}")
        return False


def set_pause_requested(session_id: str, ttl_seconds: int = 300) -> bool:
    """Set the pause flag for a session in Redis.

    Args:
        session_id: The session ID to set pause flag for
        ttl_seconds: Time-to-live for the flag (default 5 minutes)

    Returns:
        True if flag was set successfully, False otherwise
    """
    try:
        r = redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)
        r.set(f"pause_execution:{session_id}", "1", ex=ttl_seconds)
        logger.info(f"Set pause flag for session {session_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to set pause flag in Redis: {e}")
        return False


def clear_pause_requested(session_id: str) -> bool:
    """Clear the pause flag for a session in Redis.

    Args:
        session_id: The session ID to clear pause flag for

    Returns:
        True if flag was cleared successfully, False otherwise
    """
    try:
        r = redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)
        r.delete(f"pause_execution:{session_id}")
        logger.info(f"Cleared pause flag for session {session_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to clear pause flag in Redis: {e}")
        return False


# =====================================
# User Prompt Injection (Hints during execution)
# =====================================

def push_user_prompt(session_id: str, prompt: str, ttl_seconds: int = 600) -> bool:
    """Push a user prompt/hint to the injection queue.

    Used to inject guidance/hints during AI execution. The agent will
    pick up these prompts and include them in the LLM context.

    Args:
        session_id: The session ID to push prompt for
        prompt: The user's prompt/hint text
        ttl_seconds: Time-to-live for the queue (default 10 minutes)

    Returns:
        True if prompt was pushed successfully, False otherwise
    """
    try:
        r = redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)
        key = f"user_prompt_queue:{session_id}"
        r.rpush(key, prompt)
        r.expire(key, ttl_seconds)
        logger.info(f"Pushed user prompt for session {session_id}: {prompt[:50]}...")
        return True
    except Exception as e:
        logger.error(f"Failed to push user prompt to Redis: {e}")
        return False


def pop_user_prompts(session_id: str) -> list[str]:
    """Pop all pending user prompts from the queue.

    Returns all queued prompts and removes them from the queue.
    Called by the agent before each step to check for guidance.

    Args:
        session_id: The session ID to pop prompts for

    Returns:
        List of prompt strings (empty if none queued)
    """
    try:
        r = redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)
        key = f"user_prompt_queue:{session_id}"
        prompts = []
        while True:
            prompt = r.lpop(key)
            if prompt is None:
                break
            prompts.append(prompt)
        if prompts:
            logger.info(f"Popped {len(prompts)} user prompt(s) for session {session_id}")
        return prompts
    except Exception as e:
        logger.error(f"Failed to pop user prompts from Redis: {e}")
        return []


def clear_user_prompt_queue(session_id: str) -> bool:
    """Clear the user prompt queue for a session.

    Called when execution completes to clean up any remaining prompts.

    Args:
        session_id: The session ID to clear prompt queue for

    Returns:
        True if queue was cleared successfully, False otherwise
    """
    try:
        r = redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)
        r.delete(f"user_prompt_queue:{session_id}")
        logger.info(f"Cleared user prompt queue for session {session_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to clear user prompt queue in Redis: {e}")
        return False
