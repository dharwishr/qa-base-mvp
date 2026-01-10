"""
Replay Builder - Converts StepAction records to PlaywrightStep format for replay.

This module provides the logic to reconstruct executable PlaywrightStep objects
from stored StepAction records, enabling undo/replay functionality.
"""

import logging
from typing import Any

from app.models import StepAction, TestStep
from app.services.script_recorder import (
    PlaywrightStep,
    SelectorSet,
    ElementContext,
    AssertionConfig,
)

logger = logging.getLogger(__name__)

# Mapping from StepAction.action_name to PlaywrightStep.action
ACTION_MAP = {
    # Navigation actions
    "go_to_url": "goto",
    "goto_url": "goto",
    "navigate": "goto",
    "open_url": "goto",
    # Click actions
    "click_element": "click",
    "click": "click",
    # Input actions
    "input_text": "fill",
    "type_text": "fill",
    "fill": "fill",
    "input": "fill",  # Common action name from browser-use
    # Select actions
    "select_option": "select",
    "select": "select",
    "select_dropdown": "select",  # Common action name from browser-use
    "select_dropdown_option": "select",
    # Keyboard actions
    "send_keys": "press",
    "press_key": "press",
    "press": "press",
    "keyboard": "press",
    # Scroll actions
    "scroll_down": "scroll",
    "scroll_up": "scroll",
    "scroll": "scroll",
    "scroll_element": "scroll",
    # Wait actions
    "wait": "wait",
    "wait_for": "wait",
    # Hover actions
    "hover": "hover",
    "hover_element": "hover",
    # Assert actions (from browser-use AI agent)
    "assert": "assert",
    "assert_text": "assert",
    "assert_text_visible": "assert",
    "assert_element_visible": "assert",
    "assert_url": "assert",
    "assert_value": "assert",
    "verify": "assert",  # Plan step type maps to assert
    # Skip non-replayable actions (file operations, etc.)
    # These return None and are logged as skipped
    # Note: Actions like 'write_file', 'replace_file', 'evaluate' are not replayable
    # as they are internal browser-use operations
}


def build_playwright_steps_for_session(
    steps: list[TestStep],
    upto_step_number: int,
) -> list[PlaywrightStep]:
    """
    Build PlaywrightStep list from TestStep/StepAction records.
    
    Args:
        steps: List of TestStep objects (should already be ordered by step_number)
        upto_step_number: Include steps up to and including this number
    
    Returns:
        List of PlaywrightStep objects ready for CDPRunner execution
    """
    filtered_steps = [s for s in steps if s.step_number <= upto_step_number]
    
    pw_steps: list[PlaywrightStep] = []
    step_index = 0
    
    for test_step in filtered_steps:
        # First, check if we need to add a navigation step based on URL change
        if test_step.url and step_index == 0:
            # First step should include navigation to the initial URL
            # This ensures replay starts from a known state
            goto_step = _create_goto_step(test_step.url, step_index)
            if goto_step:
                pw_steps.append(goto_step)
                step_index += 1
        
        # Process each action in this step
        if test_step.actions:
            for action in test_step.actions:
                # Skip failed actions
                if action.result_success is False:
                    continue

                pw_step = step_action_to_playwright_step(action, index=step_index)
                if pw_step:
                    pw_steps.append(pw_step)
                    step_index += 1
    
    logger.info(f"Built {len(pw_steps)} PlaywrightSteps from {len(filtered_steps)} TestSteps")
    return pw_steps


def _create_goto_step(url: str, index: int) -> PlaywrightStep | None:
    """Create a goto step for initial navigation."""
    if not url:
        return None
    
    return PlaywrightStep(
        index=index,
        action="goto",
        url=url,
        wait_for="domcontentloaded",
        description=f"Navigate to {url}",
    )


def step_action_to_playwright_step(
    sa: StepAction,
    index: int,
) -> PlaywrightStep | None:
    """
    Convert a single StepAction to a PlaywrightStep.
    
    Args:
        sa: The StepAction record from the database
        index: The step index for the PlaywrightStep
    
    Returns:
        PlaywrightStep object or None if action type is not supported
    """
    params = sa.action_params or {}
    action = ACTION_MAP.get(sa.action_name)
    
    if not action:
        logger.warning(f"Unknown action type: {sa.action_name}, skipping")
        return None
    
    # Build base step data
    base: dict[str, Any] = {
        "index": index,
        "action": action,
        "timeout": params.get("timeout_ms", 30000),
        "description": sa.element_name or params.get("description"),
    }
    
    # Build selector set from xpath and fallbacks
    selectors = _build_selectors(sa, params)
    
    # Build element context if available
    element_context = _build_element_context(params)
    
    # Map specific action types
    if action == "goto":
        url = params.get("url")
        if not url:
            logger.warning(f"goto action missing URL, skipping")
            return None
        base["url"] = url
        base["wait_for"] = params.get("wait_for", "domcontentloaded")
    
    elif action == "click":
        if not selectors:
            logger.warning(f"click action missing selectors, skipping")
            return None
        base["selectors"] = selectors
        base["element_context"] = element_context
    
    elif action == "fill":
        if not selectors:
            logger.warning(f"fill action missing selectors, skipping")
            return None
        value = params.get("value") or params.get("text") or ""
        base["selectors"] = selectors
        base["element_context"] = element_context
        base["value"] = value
    
    elif action == "select":
        if not selectors:
            logger.warning(f"select action missing selectors, skipping")
            return None
        value = params.get("value") or params.get("option") or ""
        base["selectors"] = selectors
        base["element_context"] = element_context
        base["value"] = value
    
    elif action == "press":
        key = params.get("key") or params.get("keys") or ""
        if not key:
            logger.warning(f"press action missing key, skipping")
            return None
        base["key"] = key
        if selectors:
            base["selectors"] = selectors
    
    elif action == "scroll":
        # Determine scroll direction from action name or params
        direction = params.get("direction", "down")
        if sa.action_name == "scroll_up":
            direction = "up"
        elif sa.action_name == "scroll_down":
            direction = "down"
        
        base["direction"] = direction
        base["amount"] = params.get("amount", 500)
    
    elif action == "wait":
        base["timeout"] = params.get("timeout_ms", params.get("timeout", 1000))
    
    elif action == "hover":
        if not selectors:
            logger.warning(f"hover action missing selectors, skipping")
            return None
        base["selectors"] = selectors
        base["element_context"] = element_context
    
    elif action == "assert":
        assertion = _build_assertion(params, sa.action_name)
        if not assertion:
            logger.warning(f"assert action missing assertion config for {sa.action_name}, skipping")
            return None
        base["assertion"] = assertion
        if selectors:
            base["selectors"] = selectors
        if element_context:
            base["element_context"] = element_context
    
    return PlaywrightStep(**base)


def _build_selectors(sa: StepAction, params: dict) -> SelectorSet | None:
    """Build SelectorSet from StepAction data."""
    primary = None
    fallbacks = []

    # Use xpath as primary selector
    if sa.element_xpath:
        xpath = sa.element_xpath
        # Ensure absolute xpaths have leading slash for Playwright compatibility
        # browser-use generates xpaths like "html/body/..." without leading slash
        if xpath.startswith("html"):
            xpath = "/" + xpath
        primary = f"xpath={xpath}"
    
    # Check for CSS selectors in params
    css_selectors = params.get("css_selectors", [])
    if isinstance(css_selectors, list):
        fallbacks.extend(css_selectors)
    elif isinstance(css_selectors, str) and css_selectors:
        fallbacks.append(css_selectors)
    
    # Add element-based fallback selectors
    if sa.element_name:
        # Try text-based selector
        fallbacks.append(f"text={sa.element_name}")
    
    # Check for index-based selector
    if params.get("index") is not None:
        index = params["index"]
        if primary:
            # This is already an xpath, the index should be included
            pass
        
    if not primary and not fallbacks:
        return None
    
    if not primary and fallbacks:
        # Use first fallback as primary
        primary = fallbacks.pop(0)
    
    return SelectorSet(primary=primary, fallbacks=fallbacks)


def _build_element_context(params: dict) -> ElementContext | None:
    """Build ElementContext from action params."""
    ec_dict = params.get("element_context")
    if ec_dict and isinstance(ec_dict, dict):
        try:
            return ElementContext(**ec_dict)
        except Exception as e:
            logger.warning(f"Failed to build ElementContext: {e}")
    
    # Try to build from individual params
    tag_name = params.get("tag_name")
    if tag_name:
        return ElementContext(
            tag_name=tag_name,
            text_content=params.get("text_content"),
            aria_label=params.get("aria_label"),
            placeholder=params.get("placeholder"),
            role=params.get("role"),
            classes=params.get("classes", []),
        )
    
    return None


def _build_assertion(params: dict, action_name: str = "") -> AssertionConfig | None:
    """Build AssertionConfig from action params.

    Args:
        params: Action parameters dict
        action_name: Original action name (e.g., 'assert_text', 'assert_url') to infer assertion type
    """
    assertion_type = params.get("assertion_type")
    expected_value = params.get("expected_value")

    # Infer assertion_type from action_name if not explicitly provided
    if not assertion_type:
        action_lower = action_name.lower()
        if "text" in action_lower:
            assertion_type = "text_visible"
            # Map 'text' param to expected_value
            expected_value = expected_value or params.get("text")
        elif "element" in action_lower or "visible" in action_lower:
            assertion_type = "element_visible"
        elif "url" in action_lower:
            assertion_type = "url_contains"
            expected_value = expected_value or params.get("url")
        elif "value" in action_lower:
            assertion_type = "value_equals"
            expected_value = expected_value or params.get("value")
        elif "verify" in action_lower:
            # Generic verify - try to infer from params
            if "text" in params:
                assertion_type = "text_visible"
                expected_value = params.get("text")
            elif "url" in params:
                assertion_type = "url_contains"
                expected_value = params.get("url")
            else:
                assertion_type = "element_visible"

    if not assertion_type:
        return None

    return AssertionConfig(
        assertion_type=assertion_type,
        expected_value=expected_value,
        expected_count=params.get("expected_count"),
        case_sensitive=params.get("case_sensitive", False),  # Default case-insensitive for flexibility
        partial_match=params.get("partial_match", True),  # Default to partial match for flexibility
        pattern_type=params.get("pattern_type", "substring"),  # Default to substring matching
    )
