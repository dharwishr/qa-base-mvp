"""
Script Recorder - Captures browser-use actions and generates Playwright-compatible scripts.

This module hooks into browser-use execution to record actions with multiple selectors
for robust replay and self-healing capabilities.
"""

from dataclasses import dataclass, field
from typing import Any
from pydantic import BaseModel


class SelectorSet(BaseModel):
	"""Multiple selectors for the same element, ordered by preference."""
	primary: str
	fallbacks: list[str] = []
	
	def all_selectors(self) -> list[str]:
		"""Return all selectors in order of preference."""
		return [self.primary] + self.fallbacks


class ElementContext(BaseModel):
	"""Context about the element for self-healing."""
	tag_name: str
	text_content: str | None = None
	aria_label: str | None = None
	placeholder: str | None = None
	role: str | None = None
	classes: list[str] = []
	nearby_text: str | None = None
	parent_tag: str | None = None
	

class AssertionConfig(BaseModel):
	"""Configuration for assertion/verification steps."""
	assertion_type: str  # text_visible | text_contains | element_visible | element_count | url_contains | url_equals | value_equals
	expected_value: str | None = None  # Expected text, URL, value, etc.
	expected_count: int | None = None  # For element_count assertions
	case_sensitive: bool = False  # Default to case-insensitive for flexibility
	partial_match: bool = True  # For text assertions - substring match (default True for better matching)
	pattern_type: str = "substring"  # "exact" | "substring" | "wildcard" | "regex"


class PlaywrightStep(BaseModel):
	"""A single recorded step that can be replayed with Playwright."""
	index: int
	action: str  # goto | click | fill | select | scroll | wait | press | hover | assert
	url: str | None = None  # For goto action
	selectors: SelectorSet | None = None  # For element actions
	value: str | None = None  # For fill/select actions
	key: str | None = None  # For press action
	direction: str | None = None  # For scroll: up | down
	amount: int | None = None  # For scroll: pixels or pages
	timeout: int = 30000  # Default 30s timeout
	wait_for: str | None = None  # networkidle | domcontentloaded | load
	element_context: ElementContext | None = None  # For self-healing
	description: str | None = None  # Human-readable description
	assertion: AssertionConfig | None = None  # For assert actions


@dataclass
class ScriptRecorder:
	"""Records browser actions during AI analysis for later replay."""
	
	steps: list[PlaywrightStep] = field(default_factory=list)
	_step_index: int = 0
	
	def record_goto(
		self,
		url: str,
		wait_for: str = "domcontentloaded",
	) -> PlaywrightStep:
		"""Record a navigation action."""
		step = PlaywrightStep(
			index=self._step_index,
			action="goto",
			url=url,
			wait_for=wait_for,
			description=f"Navigate to {url}",
		)
		self.steps.append(step)
		self._step_index += 1
		return step
	
	def record_click(
		self,
		xpath: str,
		css_selector: str | None = None,
		element_context: ElementContext | None = None,
		description: str | None = None,
	) -> PlaywrightStep:
		"""Record a click action with multiple selectors."""
		fallbacks = []
		if css_selector:
			fallbacks.append(css_selector)
		
		if element_context:
			if element_context.text_content:
				fallbacks.append(f"text={element_context.text_content}")
			if element_context.aria_label:
				fallbacks.append(f"[aria-label=\"{element_context.aria_label}\"]")
			if element_context.role:
				role_selector = f"role={element_context.role}"
				if element_context.text_content:
					role_selector += f"[name=\"{element_context.text_content}\"]"
				fallbacks.append(role_selector)
		
		step = PlaywrightStep(
			index=self._step_index,
			action="click",
			selectors=SelectorSet(primary=f"xpath={xpath}", fallbacks=fallbacks),
			element_context=element_context,
			description=description or "Click element",
		)
		self.steps.append(step)
		self._step_index += 1
		return step
	
	def record_fill(
		self,
		xpath: str,
		value: str,
		css_selector: str | None = None,
		element_context: ElementContext | None = None,
		description: str | None = None,
	) -> PlaywrightStep:
		"""Record a fill/type action."""
		fallbacks = []
		if css_selector:
			fallbacks.append(css_selector)
		
		if element_context:
			if element_context.placeholder:
				fallbacks.append(f"[placeholder=\"{element_context.placeholder}\"]")
			if element_context.aria_label:
				fallbacks.append(f"[aria-label=\"{element_context.aria_label}\"]")
		
		step = PlaywrightStep(
			index=self._step_index,
			action="fill",
			selectors=SelectorSet(primary=f"xpath={xpath}", fallbacks=fallbacks),
			value=value,
			element_context=element_context,
			description=description or f"Fill with '{value[:20]}...'" if len(value) > 20 else f"Fill with '{value}'",
		)
		self.steps.append(step)
		self._step_index += 1
		return step
	
	def record_select(
		self,
		xpath: str,
		value: str,
		css_selector: str | None = None,
		element_context: ElementContext | None = None,
		description: str | None = None,
	) -> PlaywrightStep:
		"""Record a dropdown select action."""
		fallbacks = []
		if css_selector:
			fallbacks.append(css_selector)
		
		step = PlaywrightStep(
			index=self._step_index,
			action="select",
			selectors=SelectorSet(primary=f"xpath={xpath}", fallbacks=fallbacks),
			value=value,
			element_context=element_context,
			description=description or f"Select '{value}'",
		)
		self.steps.append(step)
		self._step_index += 1
		return step
	
	def record_press(
		self,
		key: str,
		xpath: str | None = None,
		css_selector: str | None = None,
		description: str | None = None,
	) -> PlaywrightStep:
		"""Record a key press action."""
		selectors = None
		if xpath:
			fallbacks = [css_selector] if css_selector else []
			selectors = SelectorSet(primary=f"xpath={xpath}", fallbacks=fallbacks)
		
		step = PlaywrightStep(
			index=self._step_index,
			action="press",
			selectors=selectors,
			key=key,
			description=description or f"Press {key}",
		)
		self.steps.append(step)
		self._step_index += 1
		return step
	
	def record_scroll(
		self,
		direction: str,
		amount: int = 500,
		description: str | None = None,
	) -> PlaywrightStep:
		"""Record a scroll action."""
		step = PlaywrightStep(
			index=self._step_index,
			action="scroll",
			direction=direction,
			amount=amount,
			description=description or f"Scroll {direction} by {amount}px",
		)
		self.steps.append(step)
		self._step_index += 1
		return step
	
	def record_wait(
		self,
		timeout: int = 1000,
		description: str | None = None,
	) -> PlaywrightStep:
		"""Record a wait action."""
		step = PlaywrightStep(
			index=self._step_index,
			action="wait",
			timeout=timeout,
			description=description or f"Wait {timeout}ms",
		)
		self.steps.append(step)
		self._step_index += 1
		return step
	
	def record_hover(
		self,
		xpath: str,
		css_selector: str | None = None,
		element_context: ElementContext | None = None,
		description: str | None = None,
	) -> PlaywrightStep:
		"""Record a hover action."""
		fallbacks = []
		if css_selector:
			fallbacks.append(css_selector)
		
		step = PlaywrightStep(
			index=self._step_index,
			action="hover",
			selectors=SelectorSet(primary=f"xpath={xpath}", fallbacks=fallbacks),
			element_context=element_context,
			description=description or "Hover over element",
		)
		self.steps.append(step)
		self._step_index += 1
		return step
	
	def record_assert_text_visible(
		self,
		expected_text: str,
		xpath: str | None = None,
		css_selector: str | None = None,
		partial_match: bool = False,
		case_sensitive: bool = True,
		description: str | None = None,
	) -> PlaywrightStep:
		"""Record an assertion that text is visible on the page."""
		selectors = None
		if xpath:
			fallbacks = [css_selector] if css_selector else []
			selectors = SelectorSet(primary=f"xpath={xpath}", fallbacks=fallbacks)
		
		step = PlaywrightStep(
			index=self._step_index,
			action="assert",
			selectors=selectors,
			assertion=AssertionConfig(
				assertion_type="text_visible",
				expected_value=expected_text,
				partial_match=partial_match,
				case_sensitive=case_sensitive,
			),
			description=description or f"Assert text visible: '{expected_text[:30]}...' " if len(expected_text) > 30 else f"Assert text visible: '{expected_text}'",
		)
		self.steps.append(step)
		self._step_index += 1
		return step
	
	def record_assert_element_visible(
		self,
		xpath: str,
		css_selector: str | None = None,
		element_context: ElementContext | None = None,
		description: str | None = None,
	) -> PlaywrightStep:
		"""Record an assertion that an element is visible."""
		fallbacks = []
		if css_selector:
			fallbacks.append(css_selector)
		
		step = PlaywrightStep(
			index=self._step_index,
			action="assert",
			selectors=SelectorSet(primary=f"xpath={xpath}", fallbacks=fallbacks),
			element_context=element_context,
			assertion=AssertionConfig(
				assertion_type="element_visible",
			),
			description=description or "Assert element is visible",
		)
		self.steps.append(step)
		self._step_index += 1
		return step
	
	def record_assert_url(
		self,
		expected_url: str,
		partial_match: bool = True,
		description: str | None = None,
	) -> PlaywrightStep:
		"""Record an assertion about the current URL."""
		assertion_type = "url_contains" if partial_match else "url_equals"
		
		step = PlaywrightStep(
			index=self._step_index,
			action="assert",
			assertion=AssertionConfig(
				assertion_type=assertion_type,
				expected_value=expected_url,
				partial_match=partial_match,
			),
			description=description or f"Assert URL {'contains' if partial_match else 'equals'}: {expected_url}",
		)
		self.steps.append(step)
		self._step_index += 1
		return step
	
	def record_assert_value(
		self,
		xpath: str,
		expected_value: str,
		css_selector: str | None = None,
		element_context: ElementContext | None = None,
		description: str | None = None,
	) -> PlaywrightStep:
		"""Record an assertion about an input's value."""
		fallbacks = []
		if css_selector:
			fallbacks.append(css_selector)
		
		step = PlaywrightStep(
			index=self._step_index,
			action="assert",
			selectors=SelectorSet(primary=f"xpath={xpath}", fallbacks=fallbacks),
			element_context=element_context,
			assertion=AssertionConfig(
				assertion_type="value_equals",
				expected_value=expected_value,
			),
			description=description or f"Assert value equals: '{expected_value}'",
		)
		self.steps.append(step)
		self._step_index += 1
		return step
	
	def record_assert_element_count(
		self,
		xpath: str,
		expected_count: int,
		css_selector: str | None = None,
		description: str | None = None,
	) -> PlaywrightStep:
		"""Record an assertion about the number of matching elements."""
		fallbacks = []
		if css_selector:
			fallbacks.append(css_selector)
		
		step = PlaywrightStep(
			index=self._step_index,
			action="assert",
			selectors=SelectorSet(primary=f"xpath={xpath}", fallbacks=fallbacks),
			assertion=AssertionConfig(
				assertion_type="element_count",
				expected_count=expected_count,
			),
			description=description or f"Assert {expected_count} elements found",
		)
		self.steps.append(step)
		self._step_index += 1
		return step

	def to_json(self) -> list[dict[str, Any]]:
		"""Export recorded steps as JSON for storage."""
		return [step.model_dump(exclude_none=True) for step in self.steps]
	
	@classmethod
	def from_json(cls, steps_json: list[dict[str, Any]]) -> "ScriptRecorder":
		"""Load recorded steps from JSON."""
		recorder = cls()
		recorder.steps = [PlaywrightStep(**step) for step in steps_json]
		recorder._step_index = len(recorder.steps)
		return recorder
	
	def clear(self) -> None:
		"""Clear all recorded steps."""
		self.steps = []
		self._step_index = 0


# Global recorder instance - will be set during test execution
_current_recorder: ScriptRecorder | None = None


def get_current_recorder() -> ScriptRecorder | None:
	"""Get the current script recorder if recording is active."""
	return _current_recorder


def set_current_recorder(recorder: ScriptRecorder | None) -> None:
	"""Set the current script recorder."""
	global _current_recorder
	_current_recorder = recorder


def start_recording() -> ScriptRecorder:
	"""Start a new recording session."""
	recorder = ScriptRecorder()
	set_current_recorder(recorder)
	return recorder


def stop_recording() -> ScriptRecorder | None:
	"""Stop recording and return the recorder."""
	recorder = get_current_recorder()
	set_current_recorder(None)
	return recorder
