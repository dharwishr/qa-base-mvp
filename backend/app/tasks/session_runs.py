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
import re
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
from app.services.text_generator import generate_auto_text

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
            "source_action_id": action.id,
        }

    elif "click" in action_name:
        selectors = _build_selectors(action)
        return {
            "index": index,
            "action": "click",
            "selectors": selectors,
            "element_context": _build_element_context(action),
            "description": action.element_name or "Click element",
            "source_action_id": action.id,
        }

    elif "input" in action_name or "type" in action_name or "fill" in action_name:
        selectors = _build_selectors(action)
        # Check if auto-generate text is enabled for this action
        if action.auto_generate_text:
            text_value = generate_auto_text(action.element_name)
            logger.info(f"Auto-generated text for '{action.element_name}': {text_value}")
        else:
            text_value = params.get("text", "")
        return {
            "index": index,
            "action": "fill",
            "selectors": selectors,
            "value": text_value,
            "element_context": _build_element_context(action),
            "description": f"Fill with '{text_value[:20] if text_value else ''}'",
            "source_action_id": action.id,
        }

    elif "scroll" in action_name:
        return {
            "index": index,
            "action": "scroll",
            "direction": "down" if params.get("down", True) else "up",
            "amount": int(params.get("pages", 1) * 500),
            "description": "Scroll page",
            "source_action_id": action.id,
        }

    elif "wait" in action_name:
        return {
            "index": index,
            "action": "wait",
            "timeout": params.get("seconds", 1) * 1000,
            "description": f"Wait {params.get('seconds', 1)} seconds",
            "source_action_id": action.id,
        }

    elif "select" in action_name:
        selectors = _build_selectors(action)
        return {
            "index": index,
            "action": "select",
            "selectors": selectors,
            "value": params.get("value", ""),
            "description": f"Select '{params.get('value', '')}'",
            "source_action_id": action.id,
        }

    elif "press" in action_name or "key" in action_name:
        return {
            "index": index,
            "action": "press",
            "key": params.get("key", "Enter"),
            "description": f"Press {params.get('key', 'Enter')}",
            "source_action_id": action.id,
        }

    elif "hover" in action_name:
        selectors = _build_selectors(action)
        return {
            "index": index,
            "action": "hover",
            "selectors": selectors,
            "element_context": _build_element_context(action),
            "description": action.element_name or "Hover element",
            "source_action_id": action.id,
        }

    # Handle assertion/verification actions
    elif action_name.startswith("assert") or "verify" in action_name:
        return _convert_assert_action(action, index)

    return None


# Patterns for dynamic values that should be replaced with wildcards
# Order matters: more specific patterns should come first
DYNAMIC_PATTERNS = [
    # UUIDs: 550e8400-e29b-41d4-a716-446655440000 (check first, most specific)
    (r'\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b', '*'),
    # ISO timestamps: 2024-01-15T10:30:00Z, 2024-01-15 10:30:00
    (r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?', '*'),
    # Complex reference numbers with multiple parts: INV-2024-001, ORD-123-456
    (r'\b[A-Z]{2,5}(?:[-#][A-Z0-9]+)+\b', '*'),
    # Simple reference numbers: PUR0201, ORD12345, REF#123
    (r'\b[A-Z]{2,5}[-#]?\d{3,10}\b', '*'),
    # Date formats: 01/15/2024, 15-01-2024
    (r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b', '*'),
    # Date formats: Jan 15, 2024, January 15 2024
    (r'\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b', '*'),
    # Time formats: 10:30:00, 10:30 AM
    (r'\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b', '*'),
    # Amounts with currency: $123.45, €100.00
    (r'[$€£¥]\s*[\d,]+\.?\d*', '*'),
    (r'\b(?:USD|EUR|GBP|INR)\s*[\d,]+\.?\d*', '*'),
    # Sequential IDs in parentheses: (Ref: PUR0201), (ID: 123)
    (r'\((?:Ref|ID|No|#)[:\s]*[A-Z0-9-]+\)', '(*)'),
    # Prefix IDs: ID: 123, No: 456, #789
    (r'\b(?:ID|No|#)[:\s]*\d+\b', '*'),
    # Order/ticket numbers: Order #12345, Invoice INV-123
    (r'\b(?:Order|Ticket|Invoice|Receipt|Transaction)[:\s#-]*[A-Z0-9-]+\b', '*'),
]


def _make_assertion_dynamic(text: str) -> tuple[str, str]:
    """Convert assertion text to use wildcards for dynamic values.

    Args:
        text: The original assertion text

    Returns:
        Tuple of (processed_text, pattern_type)
        - If dynamic patterns found: (text_with_wildcards, "wildcard")
        - If no dynamic patterns: (original_text, "substring")
    """
    if not text:
        return text, "substring"

    modified_text = text
    has_dynamic = False

    for pattern, replacement in DYNAMIC_PATTERNS:
        new_text = re.sub(pattern, replacement, modified_text)
        if new_text != modified_text:
            has_dynamic = True
            modified_text = new_text

    # Clean up multiple consecutive wildcards
    modified_text = re.sub(r'\*+', '*', modified_text)

    if has_dynamic:
        logger.debug(f"Made assertion dynamic: '{text[:50]}...' -> '{modified_text[:50]}...'")
        return modified_text, "wildcard"

    return text, "substring"


def _convert_assert_action(action: StepAction, index: int) -> dict[str, Any] | None:
    """Convert assertion actions to PlaywrightStep format."""
    action_name = action.action_name.lower()
    params = action.action_params or {}

    # Build selectors if element_xpath available (for all assertion types)
    selectors = _build_selectors(action) if action.element_xpath else None
    element_context = _build_element_context(action) if action.element_xpath else None

    # Assert text visible
    if "text" in action_name:
        raw_text = params.get("text", params.get("expected_value", ""))

        # If pattern_type is not explicitly set, auto-detect dynamic values
        if "pattern_type" not in params:
            expected_text, pattern_type = _make_assertion_dynamic(raw_text)
        else:
            expected_text = raw_text
            pattern_type = params.get("pattern_type", "substring")

        partial_match = params.get("partial_match", True)
        return {
            "index": index,
            "action": "assert",
            "selectors": selectors,  # Include selectors if available
            "element_context": element_context,
            "assertion": {
                "assertion_type": "text_visible",
                "expected_value": expected_text,
                "partial_match": partial_match,
                "case_sensitive": params.get("case_sensitive", False),  # Default case-insensitive
                "pattern_type": pattern_type,
            },
            "description": f"Assert text visible: '{expected_text[:40]}...'" if len(expected_text) > 40 else f"Assert text visible: '{expected_text}'",
            "source_action_id": action.id,
        }

    # Assert element visible
    elif "element" in action_name or "visible" in action_name:
        return {
            "index": index,
            "action": "assert",
            "selectors": selectors,
            "assertion": {
                "assertion_type": "element_visible",
            },
            "element_context": element_context,
            "description": action.element_name or "Assert element is visible",
            "source_action_id": action.id,
        }

    # Assert URL
    elif "url" in action_name:
        expected_url = params.get("url", params.get("expected_value", ""))
        exact_match = params.get("exact_match", False)
        pattern_type = params.get("pattern_type", "substring" if not exact_match else "exact")
        return {
            "index": index,
            "action": "assert",
            "assertion": {
                "assertion_type": "url_contains" if not exact_match else "url_equals",
                "expected_value": expected_url,
                "partial_match": not exact_match,
                "pattern_type": pattern_type,
            },
            "description": f"Assert URL {'contains' if not exact_match else 'equals'}: {expected_url}",
            "source_action_id": action.id,
        }

    # Generic assertion (fallback)
    raw_text = action.extracted_content or params.get("text", "")
    expected_text, pattern_type = _make_assertion_dynamic(raw_text)

    return {
        "index": index,
        "action": "assert",
        "selectors": selectors,
        "element_context": element_context,
        "assertion": {
            "assertion_type": "text_visible",
            "expected_value": expected_text,
            "partial_match": True,
            "case_sensitive": False,
            "pattern_type": pattern_type,
        },
        "description": action.element_name or "Verify assertion",
        "source_action_id": action.id,
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
    """Build element context from action for self-healing."""
    params = action.action_params or {}

    # Try to extract tag name from xpath if not provided
    tag_name = params.get("tag_name")
    if not tag_name and action.element_xpath:
        # Extract last element name from xpath (e.g., ".../a[2]" -> "a")
        import re
        match = re.search(r'/([a-z]+)(?:\[[^\]]+\])?$', action.element_xpath, re.IGNORECASE)
        if match:
            tag_name = match.group(1)

    return {
        "tag_name": tag_name or "element",
        "text_content": action.element_name or params.get("text_content"),
        "aria_label": params.get("aria_label"),
        "placeholder": params.get("placeholder"),
        "role": params.get("role"),
        "classes": params.get("classes", []),
    }


def _is_password_field(element_name: str | None, placeholder: str | None) -> bool:
    """Check if a field appears to be a password field based on its name or placeholder."""
    indicators = ['password', 'pwd', 'secret', 'passcode', 'pin']
    for text in [element_name, placeholder]:
        if text and any(ind in text.lower() for ind in indicators):
            return True
    return False


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

            # Get step data for context
            step_data = steps_json[step_index] if step_index < len(steps_json) else {}
            element_context = step_data.get('element_context', {}) or {}
            selectors = step_data.get('selectors', {}) or {}

            # Extract xpath (remove 'xpath=' prefix if present)
            primary_selector = selectors.get('primary', '')
            element_xpath = primary_selector[6:] if primary_selector.startswith('xpath=') else primary_selector

            # Get CSS from fallbacks
            css_selector = next((s for s in selectors.get('fallbacks', []) if s and not s.startswith('xpath=')), None)

            # Detect password fields
            element_name = element_context.get('text_content') or step_data.get('description')
            is_password = _is_password_field(element_name, element_context.get('placeholder'))

            # Create RunStep with 'running' status immediately
            run_step = RunStep(
                run_id=run_id,
                step_index=step_index,
                action=step_data.get('action', 'unknown'),
                status='running',
                element_name=element_name,
                element_xpath=element_xpath if element_xpath else None,
                css_selector=css_selector,
                input_value=step_data.get('value') if step_data.get('action') == 'fill' else None,
                is_password=is_password,
                source_action_id=step_data.get('source_action_id'),
            )
            db.add(run_step)
            db.commit()
            live_publisher.publish_step_update(step_index, 'running', step_data.get('action', 'unknown'), None)

        def on_step_complete(step_index: int, result: StepResult):
            # Get original step data for additional context
            step_data = steps_json[step_index] if step_index < len(steps_json) else {}

            # Find the existing RunStep created in on_step_start
            existing_run_step = db.query(RunStep).filter(
                RunStep.run_id == run_id,
                RunStep.step_index == step_index
            ).first()

            if existing_run_step:
                # Update existing record
                existing_run_step.action = result.action
                existing_run_step.status = result.status
                existing_run_step.selector_used = result.selector_used
                existing_run_step.screenshot_path = result.screenshot_path
                existing_run_step.duration_ms = result.duration_ms
                existing_run_step.error_message = result.error_message
                existing_run_step.heal_attempts = [ha.__dict__ for ha in result.heal_attempts] if result.heal_attempts else None
            else:
                # Fallback: create new (shouldn't happen normally)
                element_context = step_data.get('element_context', {}) or {}
                selectors = step_data.get('selectors', {}) or {}
                primary_selector = selectors.get('primary', '')
                element_xpath = primary_selector[6:] if primary_selector.startswith('xpath=') else primary_selector
                css_selector = next((s for s in selectors.get('fallbacks', []) if s and not s.startswith('xpath=')), None)
                element_name = element_context.get('text_content') or step_data.get('description')
                is_password = _is_password_field(element_name, element_context.get('placeholder'))

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
                    element_name=element_name,
                    element_xpath=element_xpath if element_xpath else None,
                    css_selector=css_selector,
                    input_value=step_data.get('value') if result.action == 'fill' else None,
                    is_password=is_password,
                    source_action_id=step_data.get('source_action_id'),
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

        # Mark any 'running' steps as 'failed'
        try:
            running_steps = db.query(RunStep).filter(
                RunStep.run_id == run_id,
                RunStep.status == 'running'
            ).all()
            for step in running_steps:
                step.status = 'failed'
                step.error_message = str(e)
            if running_steps:
                db.commit()
                logger.info(f"Marked {len(running_steps)} running steps as failed for run {run_id}")
        except Exception as step_err:
            logger.error(f"Failed to update running steps: {step_err}")

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
