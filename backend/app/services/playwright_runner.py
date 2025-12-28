"""
Playwright Runner - Executes recorded scripts without AI using pure Playwright.

Features:
- Runs test scripts without LLM calls (zero token cost)
- Self-healing with fallback selectors
- Live screenshots at each step
- Detailed step-by-step results
"""

import asyncio
import logging
import re
import time
from datetime import datetime
from typing import Any

from playwright.async_api import async_playwright, Page, Browser, BrowserContext, Locator, TimeoutError as PlaywrightTimeout, expect

from app.services.script_recorder import PlaywrightStep, SelectorSet, ElementContext, AssertionConfig
from app.services.base_runner import (
    BaseRunner,
    HealAttempt,
    StepResult,
    RunResult,
    StepStartCallback,
    StepCompleteCallback,
)

logger = logging.getLogger(__name__)


class SelfHealingLocator:
	"""A locator that tries multiple selectors until one works."""
	
	def __init__(self, page: Page, selectors: SelectorSet, element_context: ElementContext | None = None):
		self.page = page
		self.selectors = selectors
		self.element_context = element_context
		self.heal_attempts: list[HealAttempt] = []
		self.successful_selector: str | None = None
	
	async def locate(self, timeout: int = 5000) -> Locator | None:
		"""Try to locate the element using fallback selectors."""
		all_selectors = self.selectors.all_selectors()
		
		for selector in all_selectors:
			try:
				locator = self.page.locator(selector)
				await locator.wait_for(state="visible", timeout=timeout)
				count = await locator.count()
				if count > 0:
					self.successful_selector = selector
					self.heal_attempts.append(HealAttempt(selector=selector, success=True))
					return locator
			except PlaywrightTimeout:
				self.heal_attempts.append(HealAttempt(
					selector=selector,
					success=False,
					error="Timeout waiting for element"
				))
			except Exception as e:
				self.heal_attempts.append(HealAttempt(
					selector=selector,
					success=False,
					error=str(e)
				))
		
		# Try fuzzy matching if element context is available
		if self.element_context:
			fuzzy_locator = await self._try_fuzzy_match(timeout)
			if fuzzy_locator:
				return fuzzy_locator
		
		return None
	
	async def _try_fuzzy_match(self, timeout: int) -> Locator | None:
		"""Try to find element using fuzzy matching based on context."""
		ctx = self.element_context
		if not ctx:
			return None
		
		fuzzy_selectors = []
		
		# Try by text content
		if ctx.text_content:
			fuzzy_selectors.append(f"text={ctx.text_content}")
			fuzzy_selectors.append(f"{ctx.tag_name}:has-text('{ctx.text_content}')")
		
		# Try by aria-label
		if ctx.aria_label:
			fuzzy_selectors.append(f"[aria-label='{ctx.aria_label}']")
		
		# Try by placeholder
		if ctx.placeholder:
			fuzzy_selectors.append(f"[placeholder='{ctx.placeholder}']")
		
		# Try by role
		if ctx.role:
			if ctx.text_content:
				fuzzy_selectors.append(f"role={ctx.role}[name='{ctx.text_content}']")
			else:
				fuzzy_selectors.append(f"role={ctx.role}")
		
		for selector in fuzzy_selectors:
			try:
				locator = self.page.locator(selector)
				await locator.wait_for(state="visible", timeout=timeout // 2)
				count = await locator.count()
				if count > 0:
					self.successful_selector = f"[HEALED] {selector}"
					self.heal_attempts.append(HealAttempt(selector=selector, success=True))
					return locator
			except Exception as e:
				self.heal_attempts.append(HealAttempt(
					selector=selector,
					success=False,
					error=str(e)
				))
		
		return None
	
	def was_healed(self) -> bool:
		"""Check if the locator required healing (used a fallback selector)."""
		if not self.successful_selector:
			return False
		primary = self.selectors.primary
		return self.successful_selector != primary


class PlaywrightRunner(BaseRunner):
	"""Executes recorded scripts using pure Playwright (no AI)."""

	def __init__(
		self,
		headless: bool = True,
		screenshot_dir: str = "data/screenshots/runs",
		on_step_start: StepStartCallback | None = None,
		on_step_complete: StepCompleteCallback | None = None,
		cdp_url: str | None = None,
	):
		super().__init__(headless, screenshot_dir, on_step_start, on_step_complete)

		self._playwright = None
		self._browser: Browser | None = None
		self._context: BrowserContext | None = None
		self._page: Page | None = None
		self._cdp_url = cdp_url  # Remote browser CDP URL

	async def __aenter__(self) -> "PlaywrightRunner":
		await self._setup()
		return self

	async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
		await self._teardown()
	
	async def _setup(self):
		"""Initialize browser - connect to remote CDP or launch local."""
		logger.info("Initializing Playwright browser...")
		self._playwright = await async_playwright().start()

		if self._cdp_url:
			# Connect to remote browser via CDP
			logger.info(f"Connecting to remote browser via CDP: {self._cdp_url}")
			try:
				# Use a timeout for the CDP connection
				self._browser = await asyncio.wait_for(
					self._playwright.chromium.connect_over_cdp(self._cdp_url),
					timeout=30.0
				)
				logger.info("CDP connection established successfully")
			except asyncio.TimeoutError:
				raise RuntimeError(f"Timeout connecting to CDP at {self._cdp_url}")
			except Exception as e:
				raise RuntimeError(f"Failed to connect to CDP at {self._cdp_url}: {e}")

			# Get existing context or create new one
			contexts = self._browser.contexts
			logger.debug(f"Found {len(contexts)} existing browser contexts")
			if contexts:
				self._context = contexts[0]
				pages = self._context.pages
				logger.debug(f"Found {len(pages)} existing pages in context")
				if pages:
					self._page = pages[0]
					# Navigate to about:blank to reset page state before starting
					logger.debug("Resetting existing page to about:blank")
					try:
						await self._page.goto("about:blank", timeout=5000)
					except Exception as e:
						logger.warning(f"Could not reset page to about:blank: {e}")
				else:
					logger.debug("Creating new page in existing context")
					self._page = await self._context.new_page()
			else:
				logger.debug("Creating new browser context")
				self._context = await self._browser.new_context(
					viewport={"width": 1920, "height": 1080}
				)
				self._page = await self._context.new_page()

			# Wait for page to be ready
			await asyncio.sleep(0.5)
			logger.info(f"Page ready, current URL: {self._page.url}")
		else:
			# Launch local browser
			logger.info("Launching local headless browser")
			self._browser = await self._playwright.chromium.launch(headless=self.headless)
			self._context = await self._browser.new_context(
				viewport={"width": 1920, "height": 1080}
			)
			self._page = await self._context.new_page()

		logger.info("Browser initialized successfully")
	
	async def _teardown(self):
		"""Clean up browser."""
		logger.info("Cleaning up browser...")
		try:
			if self._context:
				await self._context.close()
			if self._browser:
				await self._browser.close()
			if self._playwright:
				await self._playwright.stop()
			logger.info("Browser cleanup complete")
		except Exception as e:
			logger.error(f"Error during browser cleanup: {e}")
	
	async def run(self, steps: list[PlaywrightStep], run_id: str) -> RunResult:
		"""Execute a list of steps and return results."""
		logger.info(f"Starting run {run_id} with {len(steps)} steps")
		result = RunResult(
			status="running",
			total_steps=len(steps),
			passed_steps=0,
			failed_steps=0,
			healed_steps=0,
			started_at=datetime.utcnow(),
		)
		
		try:
			for step in steps:
				logger.debug(f"Executing step {step.index}: {step.action}")
				if self.on_step_start:
					await self._call_callback(self.on_step_start, step.index, step)
				
				step_result = await self._execute_step(step, run_id)
				result.step_results.append(step_result)
				
				logger.debug(f"Step {step.index} result: {step_result.status}")
				
				if step_result.status == "passed":
					result.passed_steps += 1
				elif step_result.status == "healed":
					result.healed_steps += 1
				elif step_result.status == "failed":
					result.failed_steps += 1
					result.error_message = step_result.error_message
					logger.warning(f"Step {step.index} failed: {step_result.error_message}")
					break
				
				if self.on_step_complete:
					await self._call_callback(self.on_step_complete, step.index, step_result)
			
			# Determine final status
			if result.failed_steps > 0:
				result.status = "failed"
			elif result.healed_steps > 0:
				result.status = "healed"
			else:
				result.status = "passed"
			
			logger.info(f"Run {run_id} completed with status: {result.status}")
				
		except Exception as e:
			result.status = "failed"
			result.error_message = str(e)
			logger.exception(f"Run {run_id} failed with error: {e}")
		finally:
			result.completed_at = datetime.utcnow()
		
		return result
	
	async def _execute_step(self, step: PlaywrightStep, run_id: str) -> StepResult:
		"""Execute a single step."""
		start_time = time.time()
		
		try:
			if step.action == "goto":
				await self._execute_goto(step)
				status = "passed"
				heal_attempts = []
				selector_used = None
				
			elif step.action == "click":
				locator_result = await self._execute_click(step)
				status = "healed" if locator_result.was_healed() else "passed"
				heal_attempts = locator_result.heal_attempts
				selector_used = locator_result.successful_selector
				
			elif step.action == "fill":
				locator_result = await self._execute_fill(step)
				status = "healed" if locator_result.was_healed() else "passed"
				heal_attempts = locator_result.heal_attempts
				selector_used = locator_result.successful_selector
				
			elif step.action == "select":
				locator_result = await self._execute_select(step)
				status = "healed" if locator_result.was_healed() else "passed"
				heal_attempts = locator_result.heal_attempts
				selector_used = locator_result.successful_selector
				
			elif step.action == "press":
				await self._execute_press(step)
				status = "passed"
				heal_attempts = []
				selector_used = None
				
			elif step.action == "scroll":
				await self._execute_scroll(step)
				status = "passed"
				heal_attempts = []
				selector_used = None
				
			elif step.action == "wait":
				await self._execute_wait(step)
				status = "passed"
				heal_attempts = []
				selector_used = None
				
			elif step.action == "hover":
				locator_result = await self._execute_hover(step)
				status = "healed" if locator_result.was_healed() else "passed"
				heal_attempts = locator_result.heal_attempts
				selector_used = locator_result.successful_selector
				
			elif step.action == "assert":
				assertion_result = await self._execute_assertion(step)
				status = "passed" if assertion_result["success"] else "failed"
				heal_attempts = assertion_result.get("heal_attempts", [])
				selector_used = assertion_result.get("selector_used")
				if not assertion_result["success"]:
					raise AssertionError(assertion_result.get("error", "Assertion failed"))
				
			else:
				raise ValueError(f"Unknown action: {step.action}")
			
			# Take screenshot after step
			screenshot_path = await self._take_screenshot(run_id, step.index)
			
			duration_ms = int((time.time() - start_time) * 1000)
			
			return StepResult(
				step_index=step.index,
				action=step.action,
				status=status,
				selector_used=selector_used,
				screenshot_path=screenshot_path,
				duration_ms=duration_ms,
				heal_attempts=[HealAttempt(**ha.__dict__) for ha in heal_attempts] if heal_attempts else [],
			)
			
		except Exception as e:
			duration_ms = int((time.time() - start_time) * 1000)
			logger.error(f"Step {step.index} ({step.action}) failed: {e}")
			
			screenshot_path = None
			try:
				screenshot_path = await self._take_screenshot(run_id, step.index, is_error=True)
			except Exception as screenshot_error:
				logger.warning(f"Failed to take error screenshot: {screenshot_error}")
			
			return StepResult(
				step_index=step.index,
				action=step.action,
				status="failed",
				screenshot_path=screenshot_path,
				duration_ms=duration_ms,
				error_message=str(e),
			)
	
	async def _execute_goto(self, step: PlaywrightStep):
		"""Execute navigation."""
		assert self._page and step.url
		wait_until = step.wait_for or "domcontentloaded"
		await self._page.goto(step.url, wait_until=wait_until, timeout=step.timeout)
	
	async def _execute_click(self, step: PlaywrightStep) -> SelfHealingLocator:
		"""Execute click with self-healing."""
		assert self._page and step.selectors
		
		healer = SelfHealingLocator(self._page, step.selectors, step.element_context)
		locator = await healer.locate(timeout=step.timeout)
		
		if not locator:
			raise Exception(f"Could not find element to click. Tried selectors: {step.selectors.all_selectors()}")
		
		await locator.click(timeout=step.timeout)
		return healer
	
	async def _execute_fill(self, step: PlaywrightStep) -> SelfHealingLocator:
		"""Execute fill with self-healing."""
		assert self._page and step.selectors and step.value is not None
		
		healer = SelfHealingLocator(self._page, step.selectors, step.element_context)
		locator = await healer.locate(timeout=step.timeout)
		
		if not locator:
			raise Exception(f"Could not find element to fill. Tried selectors: {step.selectors.all_selectors()}")
		
		await locator.fill(step.value, timeout=step.timeout)
		return healer
	
	async def _execute_select(self, step: PlaywrightStep) -> SelfHealingLocator:
		"""Execute dropdown select with self-healing."""
		assert self._page and step.selectors and step.value is not None
		
		healer = SelfHealingLocator(self._page, step.selectors, step.element_context)
		locator = await healer.locate(timeout=step.timeout)
		
		if not locator:
			raise Exception(f"Could not find dropdown. Tried selectors: {step.selectors.all_selectors()}")
		
		await locator.select_option(step.value, timeout=step.timeout)
		return healer
	
	async def _execute_press(self, step: PlaywrightStep):
		"""Execute key press."""
		assert self._page and step.key
		
		if step.selectors:
			healer = SelfHealingLocator(self._page, step.selectors, step.element_context)
			locator = await healer.locate(timeout=step.timeout)
			if locator:
				await locator.press(step.key)
				return
		
		await self._page.keyboard.press(step.key)
	
	async def _execute_scroll(self, step: PlaywrightStep):
		"""Execute scroll."""
		assert self._page
		
		amount = step.amount or 500
		if step.direction == "up":
			amount = -amount
		
		await self._page.mouse.wheel(0, amount)
		await asyncio.sleep(0.3)  # Wait for scroll to complete
	
	async def _execute_wait(self, step: PlaywrightStep):
		"""Execute wait."""
		timeout_seconds = step.timeout / 1000 if step.timeout else 1
		await asyncio.sleep(timeout_seconds)
	
	async def _execute_hover(self, step: PlaywrightStep) -> SelfHealingLocator:
		"""Execute hover with self-healing."""
		assert self._page and step.selectors
		
		healer = SelfHealingLocator(self._page, step.selectors, step.element_context)
		locator = await healer.locate(timeout=step.timeout)
		
		if not locator:
			raise Exception(f"Could not find element to hover. Tried selectors: {step.selectors.all_selectors()}")
		
		await locator.hover(timeout=step.timeout)
		return healer
	
	async def _execute_assertion(self, step: PlaywrightStep) -> dict[str, Any]:
		"""Execute an assertion step."""
		assert self._page and step.assertion
		
		assertion = step.assertion
		result: dict[str, Any] = {"success": False, "heal_attempts": [], "selector_used": None}
		
		try:
			if assertion.assertion_type == "text_visible":
				# Check if text is visible on page
				expected = assertion.expected_value or ""
				
				if step.selectors:
					# Look for text within a specific element
					healer = SelfHealingLocator(self._page, step.selectors, step.element_context)
					locator = await healer.locate(timeout=step.timeout)
					result["heal_attempts"] = healer.heal_attempts
					result["selector_used"] = healer.successful_selector
					
					if locator:
						if assertion.partial_match:
							await expect(locator).to_contain_text(expected, timeout=step.timeout)
						else:
							await expect(locator).to_have_text(expected, timeout=step.timeout)
						result["success"] = True
					else:
						result["error"] = f"Could not find element containing text: {expected}"
				else:
					# Look for text anywhere on page
					text_locator = self._page.get_by_text(expected, exact=not assertion.partial_match)
					await expect(text_locator.first).to_be_visible(timeout=step.timeout)
					result["success"] = True
					result["selector_used"] = f"text={expected}"
			
			elif assertion.assertion_type == "element_visible":
				assert step.selectors
				healer = SelfHealingLocator(self._page, step.selectors, step.element_context)
				locator = await healer.locate(timeout=step.timeout)
				result["heal_attempts"] = healer.heal_attempts
				result["selector_used"] = healer.successful_selector
				
				if locator:
					await expect(locator).to_be_visible(timeout=step.timeout)
					result["success"] = True
				else:
					result["error"] = "Element not found"
			
			elif assertion.assertion_type == "url_contains":
				expected = assertion.expected_value or ""
				# Use regex pattern for url_contains since Playwright's to_have_url glob doesn't support substring matching well
				pattern = re.compile(re.escape(expected))
				await expect(self._page).to_have_url(pattern, timeout=step.timeout)
				result["success"] = True
				result["selector_used"] = f"url contains {expected}"
			
			elif assertion.assertion_type == "url_equals":
				expected = assertion.expected_value or ""
				await expect(self._page).to_have_url(expected, timeout=step.timeout)
				result["success"] = True
				result["selector_used"] = f"url equals {expected}"
			
			elif assertion.assertion_type == "value_equals":
				assert step.selectors
				expected = assertion.expected_value or ""
				healer = SelfHealingLocator(self._page, step.selectors, step.element_context)
				locator = await healer.locate(timeout=step.timeout)
				result["heal_attempts"] = healer.heal_attempts
				result["selector_used"] = healer.successful_selector
				
				if locator:
					await expect(locator).to_have_value(expected, timeout=step.timeout)
					result["success"] = True
				else:
					result["error"] = "Input element not found"
			
			elif assertion.assertion_type == "element_count":
				assert step.selectors and assertion.expected_count is not None
				healer = SelfHealingLocator(self._page, step.selectors, step.element_context)
				locator = await healer.locate(timeout=step.timeout)
				result["heal_attempts"] = healer.heal_attempts
				result["selector_used"] = healer.successful_selector
				
				if locator:
					await expect(locator).to_have_count(assertion.expected_count, timeout=step.timeout)
					result["success"] = True
				else:
					result["error"] = f"Expected {assertion.expected_count} elements but none found"
			
			else:
				result["error"] = f"Unknown assertion type: {assertion.assertion_type}"
		
		except Exception as e:
			result["error"] = str(e)
		
		return result
	
	async def _take_screenshot(self, run_id: str, step_index: int, is_error: bool = False) -> str:
		"""Take a screenshot and return the path relative to base screenshots dir."""
		assert self._page
		
		suffix = "_error" if is_error else ""
		filename = f"{run_id}_step_{step_index:03d}{suffix}.png"
		filepath = self.screenshot_dir / filename
		
		await self._page.screenshot(path=str(filepath), full_page=False)
		
		# Return path relative to base screenshots directory (data/screenshots)
		# The API expects paths like "runs/xxx.png" not "data/screenshots/runs/xxx.png"
		return f"runs/{filename}"


async def run_script(
	steps_json: list[dict[str, Any]],
	run_id: str,
	headless: bool = True,
	screenshot_dir: str = "data/screenshots/runs",
	on_step_start: StepStartCallback | None = None,
	on_step_complete: StepCompleteCallback | None = None,
) -> RunResult:
	"""Convenience function to run a script from JSON."""
	steps = [PlaywrightStep(**step) for step in steps_json]
	
	async with PlaywrightRunner(
		headless=headless,
		screenshot_dir=screenshot_dir,
		on_step_start=on_step_start,
		on_step_complete=on_step_complete,
	) as runner:
		return await runner.run(steps, run_id)
