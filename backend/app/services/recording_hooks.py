"""
Recording Hooks - Integrates script recording with browser-use actions.

This module provides functions to capture browser-use actions and convert them
to PlaywrightSteps for later replay.
"""

import logging
from typing import Any

from browser_use.dom.views import EnhancedDOMTreeNode
from browser_use.dom.utils import generate_css_selector_for_element

from app.services.script_recorder import (
	ElementContext,
	PlaywrightStep,
	get_current_recorder,
	AssertionConfig,
)

logger = logging.getLogger(__name__)


def extract_element_context(node: EnhancedDOMTreeNode) -> ElementContext:
	"""Extract context from an EnhancedDOMTreeNode for self-healing."""
	attrs = node.attributes or {}
	
	text_content = None
	if hasattr(node, 'text') and node.text:
		text_content = node.text.strip()[:100]
	
	classes = []
	if 'class' in attrs:
		classes = attrs['class'].split()[:5]
	
	nearby_text = None
	if node.parent_node and hasattr(node.parent_node, 'text') and node.parent_node.text:
		nearby_text = node.parent_node.text.strip()[:50]
	
	parent_tag = None
	if node.parent_node:
		parent_tag = node.parent_node.node_name.lower()
	
	return ElementContext(
		tag_name=node.tag_name,
		text_content=text_content,
		aria_label=attrs.get('aria-label'),
		placeholder=attrs.get('placeholder'),
		role=attrs.get('role'),
		classes=classes,
		nearby_text=nearby_text,
		parent_tag=parent_tag,
	)


def record_navigation(url: str, new_tab: bool = False) -> PlaywrightStep | None:
	"""Record a navigation action."""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	logger.debug(f"Recording navigation to: {url}")
	return recorder.record_goto(url)


def record_click_element(node: EnhancedDOMTreeNode) -> PlaywrightStep | None:
	"""Record a click action on an element."""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	xpath = node.xpath
	css_selector = generate_css_selector_for_element(node)
	element_context = extract_element_context(node)
	
	description = f"Click {element_context.tag_name}"
	if element_context.text_content:
		description = f"Click '{element_context.text_content[:30]}'"
	elif element_context.aria_label:
		description = f"Click '{element_context.aria_label[:30]}'"
	
	logger.debug(f"Recording click: {description}")
	return recorder.record_click(
		xpath=xpath,
		css_selector=css_selector,
		element_context=element_context,
		description=description,
	)


def record_input_text(node: EnhancedDOMTreeNode, text: str, is_sensitive: bool = False) -> PlaywrightStep | None:
	"""Record a text input action."""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	xpath = node.xpath
	css_selector = generate_css_selector_for_element(node)
	element_context = extract_element_context(node)
	
	display_text = "<sensitive>" if is_sensitive else text
	description = f"Type '{display_text[:20]}...' into {element_context.tag_name}" if len(display_text) > 20 else f"Type '{display_text}'"
	
	logger.debug(f"Recording input: {description}")
	return recorder.record_fill(
		xpath=xpath,
		value=text,
		css_selector=css_selector,
		element_context=element_context,
		description=description,
	)


def record_select_option(node: EnhancedDOMTreeNode, value: str) -> PlaywrightStep | None:
	"""Record a dropdown selection action."""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	xpath = node.xpath
	css_selector = generate_css_selector_for_element(node)
	element_context = extract_element_context(node)
	
	description = f"Select '{value}' from dropdown"
	
	logger.debug(f"Recording select: {description}")
	return recorder.record_select(
		xpath=xpath,
		value=value,
		css_selector=css_selector,
		element_context=element_context,
		description=description,
	)


def record_key_press(key: str, node: EnhancedDOMTreeNode | None = None) -> PlaywrightStep | None:
	"""Record a key press action."""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	xpath = None
	css_selector = None
	
	if node:
		xpath = node.xpath
		css_selector = generate_css_selector_for_element(node)
	
	logger.debug(f"Recording key press: {key}")
	return recorder.record_press(
		key=key,
		xpath=xpath,
		css_selector=css_selector,
		description=f"Press {key}",
	)


def record_scroll(direction: str, amount: int = 500) -> PlaywrightStep | None:
	"""Record a scroll action."""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	logger.debug(f"Recording scroll: {direction} by {amount}px")
	return recorder.record_scroll(
		direction=direction,
		amount=amount,
	)


def record_wait(seconds: int) -> PlaywrightStep | None:
	"""Record a wait action."""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	logger.debug(f"Recording wait: {seconds}s")
	return recorder.record_wait(
		timeout=seconds * 1000,
		description=f"Wait {seconds} seconds",
	)


def record_assert_text(
	expected_text: str,
	partial_match: bool = True,
	description: str | None = None,
) -> PlaywrightStep | None:
	"""Record a text assertion from extract/done actions."""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	logger.debug(f"Recording assertion: text '{expected_text[:50]}...'")
	return recorder.record_assert_text_visible(
		expected_text=expected_text,
		partial_match=partial_match,
		description=description or f"Verify text: '{expected_text[:40]}...' " if len(expected_text) > 40 else f"Verify text: '{expected_text}'",
	)


def record_assert_url(
	expected_url: str,
	partial_match: bool = True,
) -> PlaywrightStep | None:
	"""Record a URL assertion."""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	logger.debug(f"Recording assertion: URL contains '{expected_url}'")
	return recorder.record_assert_url(
		expected_url=expected_url,
		partial_match=partial_match,
	)


def record_assert_element_visible(
	node,  # EnhancedDOMTreeNode
	description: str | None = None,
) -> PlaywrightStep | None:
	"""Record an element visibility assertion."""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	xpath = node.xpath
	css_selector = generate_css_selector_for_element(node)
	element_context = extract_element_context(node)
	
	logger.debug(f"Recording assertion: element visible")
	return recorder.record_assert_element_visible(
		xpath=xpath,
		css_selector=css_selector,
		element_context=element_context,
		description=description,
	)


def record_done_verification(
	extracted_content: str | None,
	success: bool,
	current_url: str | None = None,
) -> PlaywrightStep | None:
	"""Record verification from a 'done' action - typically the final assertion.
	
	Note: We intentionally do NOT record text assertions from 'done' actions because
	the extracted_content is typically LLM commentary (e.g., "Task completed", 
	"Successfully logged in") rather than actual page text that can be verified.
	
	Recording these as assertions would cause test failures during replay since
	the LLM's response text is not visible on the page.
	"""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	# We skip text assertions for 'done' actions because:
	# 1. The content is usually LLM-generated summary, not actual page text
	# 2. Verifying LLM text against page content always fails
	# 3. The test already succeeded if the AI agent completed
	
	# Note: URL verification is also skipped because the final URL
	# depends on the flow and may vary between runs
	
	logger.debug(f"Done action recorded (success={success}), no assertion added - actions themselves validate the flow")
	return None


def record_extract_verification(
	query: str,
	extracted_content: str | None,
) -> PlaywrightStep | None:
	"""Record verification from an 'extract' action."""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	if extracted_content:
		# Extract a meaningful portion of the content for assertion
		# Limit to first 200 chars to keep assertions reasonable
		assertion_text = extracted_content[:200].strip()
		if len(assertion_text) > 50:
			# Try to find a clean break point
			for sep in ['\n', '. ', ', ']:
				idx = assertion_text.find(sep)
				if 20 < idx < 150:
					assertion_text = assertion_text[:idx]
					break
		
		logger.debug(f"Recording extract verification for query: '{query}'")
		return recorder.record_assert_text_visible(
			expected_text=assertion_text,
			partial_match=True,
			description=f"Verify extracted: {query[:40]}",
		)
	
	return None


def record_navigation_verification(
	url: str,
	expected_title: str | None = None,
) -> PlaywrightStep | None:
	"""Record URL verification after navigation."""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	logger.debug(f"Recording navigation verification for URL: '{url}'")
	return recorder.record_assert_url(
		expected_url=url,
		partial_match=True,
	)


def record_click_verification(
	node,  # EnhancedDOMTreeNode
	expected_result: str | None = None,
) -> PlaywrightStep | None:
	"""Record verification that a click had the expected effect."""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	# For now, we record element visibility verification
	# In future, could check for state changes, new elements, etc.
	xpath = node.xpath
	css_selector = generate_css_selector_for_element(node)
	element_context = extract_element_context(node)
	
	logger.debug(f"Recording click verification for element")
	return recorder.record_assert_element_visible(
		xpath=xpath,
		css_selector=css_selector,
		element_context=element_context,
		description=f"Verify element clickable: {element_context.text_content[:30] if element_context.text_content else element_context.tag_name}",
	)


def record_input_verification(
	node,  # EnhancedDOMTreeNode  
	expected_value: str,
	is_sensitive: bool = False,
) -> PlaywrightStep | None:
	"""Record verification that input was successful."""
	recorder = get_current_recorder()
	if not recorder:
		return None
	
	if is_sensitive:
		# Don't record sensitive values in assertions
		return None
	
	xpath = node.xpath
	css_selector = generate_css_selector_for_element(node)
	element_context = extract_element_context(node)
	
	logger.debug(f"Recording input verification")
	return recorder.record_assert_value(
		xpath=xpath,
		expected_value=expected_value,
		css_selector=css_selector,
		element_context=element_context,
		description=f"Verify input value: '{expected_value[:20]}{'...' if len(expected_value) > 20 else ''}'",
	)
