"""
Celery tasks for executing test runs from session actions directly.

This module handles session-based test execution (Execute tab) by:
1. Fetching enabled StepActions from the session
2. Converting them to Playwright steps
3. Executing via container pool
4. Saving results to the database

Unlike script-based runs, session runs use actions directly without
creating a PlaywrightScript intermediary.
"""

import asyncio
import logging
from datetime import datetime
from typing import Any

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import TestRun, RunStep, TestSession, TestStep, StepAction, NetworkRequest, ConsoleLog, SystemSettings
from app.services.container_pool import (
    get_container_pool,
    BrowserType,
    IsolationMode,
)
from app.services.runner_factory import create_runner
from app.services.base_runner import StepResult
from app.services.script_recorder import PlaywrightStep
from app.services.live_logs import LiveLogsPublisher

logger = logging.getLogger(__name__)


def get_isolation_mode(db) -> IsolationMode:
    """Get the system-wide isolation mode setting."""
    settings = db.query(SystemSettings).filter(SystemSettings.id == "default").first()
    if settings and settings.isolation_mode == "ephemeral":
        return IsolationMode.EPHEMERAL
    return IsolationMode.CONTEXT


def _convert_action_to_playwright_step(action: StepAction, index: int, url: str | None) -> dict[str, Any] | None:
    """Convert a StepAction to a PlaywrightStep dict.

    This is copied from scripts.py to avoid circular imports.
    """
    action_name = action.action_name.lower()
    params = action.action_params or {}

    # Map browser-use actions to Playwright actions
    if "navigate" in action_name or "goto" in action_name:
        return {
            "index": index,
            "action": "goto",
            "url": params.get("url", url),
            "wait_for": "domcontentloaded",
            "description": f"Navigate to {params.get('url', url)}",
        }

    elif "click" in action_name:
        selectors = _build_selectors(action)
        return {
            "index": index,
            "action": "click",
            "selectors": selectors,
            "element_context": _build_element_context(action),
            "description": action.element_name or "Click element",
        }

    elif "input" in action_name or "type" in action_name or "fill" in action_name:
        selectors = _build_selectors(action)
        return {
            "index": index,
            "action": "fill",
            "selectors": selectors,
            "value": params.get("text", ""),
            "element_context": _build_element_context(action),
            "description": f"Fill with '{params.get('text', '')[:20]}'",
        }

    elif "scroll" in action_name:
        return {
            "index": index,
            "action": "scroll",
            "direction": "down" if params.get("down", True) else "up",
            "amount": int(params.get("pages", 1) * 500),
            "description": "Scroll page",
        }

    elif "wait" in action_name:
        return {
            "index": index,
            "action": "wait",
            "timeout": params.get("seconds", 1) * 1000,
            "description": f"Wait {params.get('seconds', 1)} seconds",
        }

    elif "select" in action_name:
        selectors = _build_selectors(action)
        return {
            "index": index,
            "action": "select",
            "selectors": selectors,
            "value": params.get("value", ""),
            "description": f"Select '{params.get('value', '')}'",
        }

    elif "press" in action_name or "key" in action_name:
        return {
            "index": index,
            "action": "press",
            "key": params.get("key", "Enter"),
            "description": f"Press {params.get('key', 'Enter')}",
        }

    elif "hover" in action_name:
        selectors = _build_selectors(action)
        return {
            "index": index,
            "action": "hover",
            "selectors": selectors,
            "element_context": _build_element_context(action),
            "description": action.element_name or "Hover element",
        }

    # Handle assertion/verification actions
    elif action_name.startswith("assert") or "verify" in action_name:
        return _convert_assert_action(action, index)

    return None


def _convert_assert_action(action: StepAction, index: int) -> dict[str, Any] | None:
    """Convert assertion actions to PlaywrightStep format."""
    action_name = action.action_name.lower()
    params = action.action_params or {}

    # Assert text visible
    if "text" in action_name:
        expected_text = params.get("text", "")
        partial_match = params.get("partial_match", True)
        return {
            "index": index,
            "action": "assert",
            "assertion": {
                "assertion_type": "text_visible",
                "expected_value": expected_text,
                "partial_match": partial_match,
                "case_sensitive": not partial_match,
            },
            "description": f"Assert text visible: '{expected_text[:40]}...'" if len(expected_text) > 40 else f"Assert text visible: '{expected_text}'",
        }

    # Assert element visible
    elif "element" in action_name or "visible" in action_name:
        selectors = _build_selectors(action) if action.element_xpath else None
        return {
            "index": index,
            "action": "assert",
            "selectors": selectors,
            "assertion": {
                "assertion_type": "element_visible",
            },
            "element_context": _build_element_context(action),
            "description": action.element_name or "Assert element is visible",
        }

    # Assert URL
    elif "url" in action_name:
        expected_url = params.get("url", "")
        exact_match = params.get("exact_match", False)
        return {
            "index": index,
            "action": "assert",
            "assertion": {
                "assertion_type": "url_contains" if not exact_match else "url_equals",
                "expected_value": expected_url,
                "partial_match": not exact_match,
            },
            "description": f"Assert URL {'contains' if not exact_match else 'equals'}: {expected_url}",
        }

    # Generic assertion (fallback)
    return {
        "index": index,
        "action": "assert",
        "assertion": {
            "assertion_type": "text_visible",
            "expected_value": action.extracted_content or "",
            "partial_match": True,
        },
        "description": action.element_name or "Verify assertion",
    }


def _build_selectors(action: StepAction) -> dict[str, Any]:
    """Build selector set from action."""
    primary = action.element_xpath or "body"
    fallbacks = []

    # Add CSS selector if we can derive it
    params = action.action_params or {}
    if params.get("css_selector"):
        fallbacks.append(params["css_selector"])

    return {
        "primary": f"xpath={primary}" if not primary.startswith("xpath=") else primary,
        "fallbacks": fallbacks,
    }


def _build_element_context(action: StepAction) -> dict[str, Any] | None:
    """Build element context from action."""
    params = action.action_params or {}

    return {
        "tag_name": params.get("tag_name", "element"),
        "text_content": action.element_name,
        "aria_label": params.get("aria_label"),
        "placeholder": params.get("placeholder"),
    }


def _extract_enabled_steps_from_session(db, session: TestSession) -> list[dict[str, Any]]:
    """Extract Playwright steps from session's enabled actions only.

    Unlike _extract_steps_from_session in scripts.py, this function
    filters actions by is_enabled=True.
    """
    from sqlalchemy import or_

    steps = []
    step_index = 0

    # Fetch steps ordered by step_number
    test_steps = db.query(TestStep).filter(
        TestStep.session_id == session.id
    ).order_by(TestStep.step_number).all()

    logger.info(f"Session {session.id} has {len(test_steps)} test steps")

    for test_step in test_steps:
        # Fetch enabled actions ordered by action_index
        # Note: is_enabled defaults to True (1) for all actions
        # Filter only includes actions that are enabled (is_enabled != False)
        enabled_actions = db.query(StepAction).filter(
            StepAction.step_id == test_step.id,
            # Include actions where is_enabled is True or NULL (for backward compatibility)
            or_(StepAction.is_enabled == True, StepAction.is_enabled.is_(None))
        ).order_by(StepAction.action_index).all()

        logger.info(f"Step {test_step.step_number} has {len(enabled_actions)} enabled actions")

        for action in enabled_actions:
            logger.debug(f"Processing action: {action.action_name}, xpath: {action.element_xpath}, is_enabled: {action.is_enabled}")
            playwright_step = _convert_action_to_playwright_step(action, step_index, test_step.url)
            if playwright_step:
                steps.append(playwright_step)
                step_index += 1
            else:
                logger.warning(f"Could not convert action {action.action_name} to playwright step")

    logger.info(f"Extracted {len(steps)} steps from session {session.id}")
    return steps


@celery_app.task(bind=True, name="execute_session_run")
def execute_session_run(self, run_id: str) -> dict:
    """Execute a session-based test run using the container pool.

    Args:
        run_id: The test run ID to execute.

    Returns:
        Dict with execution results.
    """
    # Run the async execution in a new event loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(_execute_session_run_async(run_id, task=self))
    finally:
        loop.close()


async def _execute_session_run_async(run_id: str, task=None) -> dict:
    """Async implementation of session-based test run execution."""
    db = SessionLocal()
    container = None
    pool = get_container_pool()
    live_publisher = None

    try:
        # Get run record
        run = db.query(TestRun).filter(TestRun.id == run_id).first()
        if not run:
            raise ValueError(f"Run {run_id} not found")

        # Verify this is a session-based run
        if not run.session_id:
            raise ValueError(f"Run {run_id} has no session_id - not a session-based run")

        # Get session
        session = db.query(TestSession).filter(TestSession.id == run.session_id).first()
        if not session:
            raise ValueError(f"Session {run.session_id} not found")

        # Update run status
        run.status = "running"
        run.started_at = datetime.utcnow()
        if task is not None:
            run.celery_task_id = task.request.id
        db.commit()

        logger.info(f"Starting session run {run_id} for session {session.id}")

        # Extract enabled steps from session
        steps_json = _extract_enabled_steps_from_session(db, session)

        if not steps_json:
            raise ValueError("No enabled actions found in session")

        run.total_steps = len(steps_json)
        db.commit()

        # Get isolation mode from system settings
        isolation_mode = get_isolation_mode(db)

        # Parse browser type
        browser_type = BrowserType(run.browser_type or "chromium")

        # Acquire container from pool
        container = await pool.acquire(
            browser_type=browser_type,
            isolation_mode=isolation_mode,
            run_id=run_id,
            resolution=(run.resolution_width or 1920, run.resolution_height or 1080),
        )

        logger.info(f"Acquired container {container.container_name} for run {run_id}")

        # Prepare callbacks for saving network requests and console logs
        network_requests = []
        console_logs = []
        current_step_index = [0]  # Use list to allow modification in nested function

        # Create live logs publisher for real-time streaming
        live_publisher = LiveLogsPublisher(run_id)

        def on_network_request(event_type: str, data: dict):
            if run.network_recording_enabled and event_type in ("response", "failed"):
                data["step_index"] = current_step_index[0]
                network_requests.append(data)
                live_publisher.publish_network_request(data)
                logger.debug(f"Captured network request: {data.get('method')} {data.get('url', '')[:50]}")

        def on_console_log(data: dict):
            data["step_index"] = current_step_index[0]
            console_logs.append(data)
            live_publisher.publish_console_log(data)
            logger.debug(f"Captured console log: [{data.get('level')}] {data.get('message', '')[:50]}")

        def on_step_start(step_index: int, step):
            current_step_index[0] = step_index
            logger.debug(f"Run {run_id}: Starting step {step_index}")

        def on_step_complete(step_index: int, result: StepResult):
            run_step = RunStep(
                run_id=run_id,
                step_index=step_index,
                action=result.action,
                status=result.status,
                selector_used=result.selector_used,
                screenshot_path=result.screenshot_path,
                duration_ms=result.duration_ms,
                error_message=result.error_message,
                heal_attempts=[ha.__dict__ for ha in result.heal_attempts] if result.heal_attempts else None,
            )
            db.add(run_step)
            db.commit()
            live_publisher.publish_step_update(step_index, result.status, result.action, result.error_message)
            logger.debug(f"Run {run_id}: Step {step_index} completed with status {result.status}")

        # Create runner with container's CDP URL
        async with create_runner(
            runner_type="playwright",
            headless=True,
            cdp_url=container.cdp_ws_url,
            browser_type=run.browser_type or "chromium",
            resolution=(run.resolution_width or 1920, run.resolution_height or 1080),
            screenshots_enabled=run.screenshots_enabled,
            recording_enabled=run.recording_enabled,
            network_recording_enabled=run.network_recording_enabled,
            performance_metrics_enabled=run.performance_metrics_enabled,
            on_step_start=on_step_start,
            on_step_complete=on_step_complete,
            on_network_request=on_network_request,
            on_console_log=on_console_log,
            run_id=run_id,
            video_dir="/videos",
        ) as runner:
            # Execute the test - convert dict steps to PlaywrightStep objects
            steps = [PlaywrightStep(**step) for step in steps_json]
            result = await runner.run(steps, run_id)

        # Save network requests to database
        for req_data in network_requests:
            started_at = req_data.get("started_at")
            if isinstance(started_at, str):
                started_at = datetime.fromisoformat(started_at)
            completed_at = req_data.get("completed_at")
            if isinstance(completed_at, str):
                completed_at = datetime.fromisoformat(completed_at)

            network_req = NetworkRequest(
                run_id=run_id,
                step_index=req_data.get("step_index"),
                url=req_data.get("url", ""),
                method=req_data.get("method", "GET"),
                resource_type=req_data.get("resource_type", "other"),
                status_code=req_data.get("status_code"),
                response_size_bytes=req_data.get("response_size_bytes"),
                timing_dns_ms=req_data.get("timing_dns_ms"),
                timing_connect_ms=req_data.get("timing_connect_ms"),
                timing_ssl_ms=req_data.get("timing_ssl_ms"),
                timing_ttfb_ms=req_data.get("timing_ttfb_ms"),
                timing_download_ms=req_data.get("timing_download_ms"),
                timing_total_ms=req_data.get("timing_total_ms"),
                started_at=started_at,
                completed_at=completed_at,
            )
            db.add(network_req)

        # Save console logs to database
        for log_data in console_logs:
            timestamp = log_data.get("timestamp")
            if isinstance(timestamp, str):
                timestamp = datetime.fromisoformat(timestamp)

            console_log = ConsoleLog(
                run_id=run_id,
                step_index=log_data.get("step_index"),
                level=log_data.get("level", "log"),
                message=log_data.get("message", ""),
                source=log_data.get("source"),
                line_number=log_data.get("line_number"),
                column_number=log_data.get("column_number"),
                stack_trace=log_data.get("stack_trace"),
                timestamp=timestamp,
            )
            db.add(console_log)

        # Update run with final status
        run.status = result.status
        run.completed_at = result.completed_at
        run.passed_steps = result.passed_steps
        run.failed_steps = result.failed_steps
        run.healed_steps = result.healed_steps
        run.error_message = result.error_message
        run.video_path = result.video_path
        run.duration_ms = result.duration_ms
        db.commit()

        logger.info(f"Session run {run_id} completed: status={result.status}, duration={result.duration_ms}ms")

        return {
            "run_id": run_id,
            "status": result.status,
            "passed_steps": result.passed_steps,
            "failed_steps": result.failed_steps,
            "healed_steps": result.healed_steps,
            "duration_ms": result.duration_ms,
        }

    except Exception as e:
        logger.error(f"Session run {run_id} failed: {e}")

        # Update run status to failed
        try:
            run = db.query(TestRun).filter(TestRun.id == run_id).first()
            if run:
                run.status = "failed"
                run.error_message = str(e)
                run.completed_at = datetime.utcnow()
                db.commit()
        except Exception:
            pass

        raise

    finally:
        # Release container back to pool
        if container:
            try:
                isolation_mode = get_isolation_mode(db)
                await pool.release(container.id, isolation_mode)
                logger.info(f"Released container {container.container_name}")
            except Exception as e:
                logger.error(f"Failed to release container: {e}")

        # Close live logs publisher
        if live_publisher:
            try:
                live_publisher.close()
            except Exception:
                pass

        db.close()
