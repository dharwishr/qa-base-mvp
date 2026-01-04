"""
Playwright Runner - Executes recorded scripts without AI using pure Playwright.

Features:
- Runs test scripts without LLM calls (zero token cost)
- Self-healing with fallback selectors
- Live screenshots at each step
- Detailed step-by-step results
- Multi-browser support (Chromium, Firefox, WebKit, Edge)
- Video recording (WebM format)
- Network request monitoring
- Console log capture
"""

import asyncio
import logging
import os
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from playwright.async_api import (
    async_playwright,
    Page,
    Browser,
    BrowserContext,
    Locator,
    TimeoutError as PlaywrightTimeout,
    expect,
    ConsoleMessage,
    Request,
    Response,
)

from app.services.script_recorder import PlaywrightStep, SelectorSet, ElementContext, AssertionConfig
from app.services.base_runner import (
    BaseRunner,
    HealAttempt,
    StepResult,
    RunResult,
    StepStartCallback,
    StepCompleteCallback,
)

# Type aliases for new callbacks
NetworkEventCallback = Callable[[str, dict], Any]  # (event_type, data)
ConsoleLogCallback = Callable[[dict], Any]  # (log_data)

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
		video_dir: str = "data/videos/runs",
		on_step_start: StepStartCallback | None = None,
		on_step_complete: StepCompleteCallback | None = None,
		cdp_url: str | None = None,
		# New configuration options
		browser_type: str = "chromium",  # chromium | firefox | webkit | edge
		resolution: tuple[int, int] = (1920, 1080),
		screenshots_enabled: bool = True,
		recording_enabled: bool = True,
		network_recording_enabled: bool = False,
		performance_metrics_enabled: bool = True,
		# New callbacks
		on_network_request: NetworkEventCallback | None = None,
		on_console_log: ConsoleLogCallback | None = None,
		# Run ID for video naming
		run_id: str | None = None,
	):
		super().__init__(headless, screenshot_dir, on_step_start, on_step_complete)

		self._playwright = None
		self._browser: Browser | None = None
		self._context: BrowserContext | None = None
		self._page: Page | None = None
		self._cdp_url = cdp_url  # Remote browser URL (CDP or WebSocket)
		self._run_id = run_id  # Run ID for video naming

		# New configuration
		self._browser_type = browser_type
		self._resolution = resolution
		self._screenshots_enabled = screenshots_enabled
		self._recording_enabled = recording_enabled
		self._network_recording_enabled = network_recording_enabled
		self._performance_metrics_enabled = performance_metrics_enabled

		# Video recording
		self._video_dir = Path(video_dir)
		self._video_dir.mkdir(parents=True, exist_ok=True)
		self._video_path: str | None = None

		# Callbacks
		self._on_network_request = on_network_request
		self._on_console_log = on_console_log

		# Track current step for correlating network/console events
		self._current_step_index: int | None = None

		# Network request tracking for timing
		self._pending_requests: dict[str, dict] = {}

	async def __aenter__(self) -> "PlaywrightRunner":
		await self._setup(self._run_id)
		return self

	async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
		await self._teardown()
	
	def _get_browser_launcher(self):
		"""Get the appropriate browser launcher based on browser type."""
		if self._browser_type == "chromium":
			return self._playwright.chromium
		elif self._browser_type == "firefox":
			return self._playwright.firefox
		elif self._browser_type == "webkit":
			return self._playwright.webkit
		elif self._browser_type == "edge":
			# Edge is Chromium-based, use chromium channel
			return self._playwright.chromium
		else:
			logger.warning(f"Unknown browser type '{self._browser_type}', falling back to chromium")
			return self._playwright.chromium

	def _get_context_options(self, run_id: str | None = None) -> dict:
		"""Build context options with resolution, video recording, etc."""
		options = {
			"viewport": {"width": self._resolution[0], "height": self._resolution[1]},
		}

		# Add video recording if enabled
		if self._recording_enabled and run_id:
			options["record_video_dir"] = str(self._video_dir)
			options["record_video_size"] = {
				"width": self._resolution[0],
				"height": self._resolution[1]
			}

		return options

	async def _setup_event_listeners(self):
		"""Set up event listeners for network and console monitoring."""
		if not self._page:
			return

		# Console log listener
		if self._on_console_log:
			self._page.on("console", self._handle_console_message)

		# Network request listeners
		if self._network_recording_enabled and self._on_network_request:
			self._page.on("request", self._handle_request)
			self._page.on("response", self._handle_response)
			self._page.on("requestfailed", self._handle_request_failed)

	async def _handle_console_message(self, msg: ConsoleMessage):
		"""Handle browser console messages."""
		if not self._on_console_log:
			return

		try:
			location = msg.location
			data = {
				"level": msg.type,  # log, info, warn, error, debug
				"message": msg.text,
				"source": location.get("url") if location else None,
				"line_number": location.get("lineNumber") if location else None,
				"column_number": location.get("columnNumber") if location else None,
				"step_index": self._current_step_index,
				"timestamp": datetime.utcnow().isoformat(),
			}
			await self._call_callback(self._on_console_log, data)
		except Exception as e:
			logger.warning(f"Error handling console message: {e}")

	async def _handle_request(self, request: Request):
		"""Handle outgoing network requests."""
		if not self._on_network_request:
			return

		try:
			request_id = request.url + str(id(request))
			self._pending_requests[request_id] = {
				"url": request.url,
				"method": request.method,
				"resource_type": request.resource_type,
				"headers": await request.all_headers(),
				"post_data": request.post_data,
				"step_index": self._current_step_index,
				"started_at": datetime.utcnow().isoformat(),
			}
		except Exception as e:
			logger.warning(f"Error handling request: {e}")

	async def _handle_response(self, response: Response):
		"""Handle network responses with timing."""
		if not self._on_network_request:
			return

		try:
			request = response.request
			request_id = request.url + str(id(request))
			request_data = self._pending_requests.pop(request_id, {})

			# Get timing information (request.timing is a property, not a method)
			timing = request.timing if hasattr(request, 'timing') else {}

			data = {
				"url": response.url,
				"method": request.method,
				"resource_type": request.resource_type,
				"status_code": response.status,
				"response_headers": await response.all_headers(),
				"step_index": request_data.get("step_index", self._current_step_index),
				"started_at": request_data.get("started_at"),
				"completed_at": datetime.utcnow().isoformat(),
				# Timing breakdown (if available)
				"timing_dns_ms": timing.get("domainLookupEnd", 0) - timing.get("domainLookupStart", 0) if timing else None,
				"timing_connect_ms": timing.get("connectEnd", 0) - timing.get("connectStart", 0) if timing else None,
				"timing_ssl_ms": timing.get("secureConnectionStart", 0) if timing else None,
				"timing_ttfb_ms": timing.get("responseStart", 0) - timing.get("requestStart", 0) if timing else None,
				"timing_download_ms": timing.get("responseEnd", 0) - timing.get("responseStart", 0) if timing else None,
			}

			# Try to get response size
			try:
				body = await response.body()
				data["response_size_bytes"] = len(body) if body else 0
			except Exception:
				data["response_size_bytes"] = None

			await self._call_callback(self._on_network_request, "response", data)
		except Exception as e:
			logger.warning(f"Error handling response: {e}")

	async def _handle_request_failed(self, request: Request):
		"""Handle failed network requests."""
		if not self._on_network_request:
			return

		try:
			request_id = request.url + str(id(request))
			request_data = self._pending_requests.pop(request_id, {})

			data = {
				"url": request.url,
				"method": request.method,
				"resource_type": request.resource_type,
				"status_code": 0,  # Failed
				"step_index": request_data.get("step_index", self._current_step_index),
				"started_at": request_data.get("started_at"),
				"completed_at": datetime.utcnow().isoformat(),
				"error": request.failure if hasattr(request, 'failure') else "Request failed",
			}
			await self._call_callback(self._on_network_request, "failed", data)
		except Exception as e:
			logger.warning(f"Error handling failed request: {e}")

	async def _setup(self, run_id: str | None = None):
		"""Initialize browser - connect to containerized browser via Playwright browser server.

		All test runs use pre-warmed browser containers from the container pool.
		All browsers use Playwright's browser server with connect() for consistent behavior.
		"""
		if not self._cdp_url:
			raise RuntimeError(
				"Browser URL is required. Test runs must use containerized browsers from the pool. "
				"Ensure the container pool is initialized and a container is acquired before running."
			)

		logger.info(f"Initializing Playwright browser (type: {self._browser_type}, resolution: {self._resolution})...")
		self._playwright = await async_playwright().start()

		# Connect to containerized browser via Playwright's browser server
		# All browsers use connect() for consistent behavior
		browser_launcher = self._get_browser_launcher()

		try:
			logger.info(f"Connecting to container browser via WebSocket: {self._cdp_url}")
			self._browser = await asyncio.wait_for(
				browser_launcher.connect(self._cdp_url),
				timeout=30.0
			)
			logger.info("WebSocket connection established successfully")
		except asyncio.TimeoutError:
			raise RuntimeError(f"Timeout connecting to browser at {self._cdp_url}")
		except Exception as e:
			raise RuntimeError(f"Failed to connect to browser at {self._cdp_url}: {e}")

		# Always create a fresh context with proper video recording options
		# This ensures clean state and enables video recording for each run
		logger.debug("Creating new browser context with video recording")
		context_options = self._get_context_options(run_id)
		self._context = await self._browser.new_context(**context_options)
		self._page = await self._context.new_page()

		# Wait for page to be ready
		await asyncio.sleep(0.5)
		logger.info(f"Page ready, current URL: {self._page.url}")

		# Set up event listeners for network and console monitoring
		await self._setup_event_listeners()

		logger.info("Browser initialized successfully")
	
	async def _teardown(self):
		"""Clean up browser and finalize video recording."""
		logger.info("Cleaning up browser...")
		try:
			# Context may already be closed by run() for video finalization
			if self._context:
				await self._context.close()
				self._context = None
			if self._browser:
				await self._browser.close()
				self._browser = None
			if self._playwright:
				await self._playwright.stop()
				self._playwright = None
			logger.info("Browser cleanup complete")
		except Exception as e:
			logger.error(f"Error during browser cleanup: {e}")

	def get_video_path(self) -> str | None:
		"""Get the path to the recorded video (available after teardown)."""
		return self._video_path
	
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

		# Store run_id for video path correlation
		self._run_id = run_id

		try:
			for step in steps:
				# Track current step for network/console event correlation
				self._current_step_index = step.index

				logger.debug(f"Executing step {step.index}: {step.action}")
				if self.on_step_start:
					await self._call_callback(self.on_step_start, step.index, step)

				step_result = await self._execute_step(step, run_id)
				result.step_results.append(step_result)

				# Small delay between steps for stability
				await asyncio.sleep(0.3)

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
			self._current_step_index = None

			# Calculate total duration
			if result.started_at and result.completed_at:
				duration = (result.completed_at - result.started_at).total_seconds() * 1000
				result.duration_ms = int(duration)

			# Finalize video and get path (need to close context first)
			if self._recording_enabled and self._page:
				try:
					video = self._page.video
					if video:
						# Close context to finalize video file
						if self._context:
							await self._context.close()
							self._context = None
						# Get the video path
						self._video_path = await video.path()
						result.video_path = str(self._video_path)
						logger.info(f"Video recorded to: {self._video_path}")
				except Exception as e:
					logger.warning(f"Could not finalize video: {e}")

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
	
	async def _take_screenshot(self, run_id: str, step_index: int, is_error: bool = False) -> str | None:
		"""Take a screenshot and return the path relative to base screenshots dir."""
		# Skip screenshots if disabled (but always take error screenshots)
		if not self._screenshots_enabled and not is_error:
			return None

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
	video_dir: str = "data/videos/runs",
	on_step_start: StepStartCallback | None = None,
	on_step_complete: StepCompleteCallback | None = None,
	cdp_url: str | None = None,
	# New configuration options
	browser_type: str = "chromium",
	resolution: tuple[int, int] = (1920, 1080),
	screenshots_enabled: bool = True,
	recording_enabled: bool = True,
	network_recording_enabled: bool = False,
	performance_metrics_enabled: bool = True,
	on_network_request: NetworkEventCallback | None = None,
	on_console_log: ConsoleLogCallback | None = None,
) -> tuple[RunResult, str | None]:
	"""
	Convenience function to run a script from JSON.

	Returns:
		Tuple of (RunResult, video_path or None)
	"""
	steps = [PlaywrightStep(**step) for step in steps_json]

	runner = PlaywrightRunner(
		headless=headless,
		screenshot_dir=screenshot_dir,
		video_dir=video_dir,
		on_step_start=on_step_start,
		on_step_complete=on_step_complete,
		cdp_url=cdp_url,
		browser_type=browser_type,
		resolution=resolution,
		screenshots_enabled=screenshots_enabled,
		recording_enabled=recording_enabled,
		network_recording_enabled=network_recording_enabled,
		performance_metrics_enabled=performance_metrics_enabled,
		on_network_request=on_network_request,
		on_console_log=on_console_log,
	)

	# Setup with run_id for video naming
	await runner._setup(run_id)
	try:
		result = await runner.run(steps, run_id)
	finally:
		await runner._teardown()

	return result, runner.get_video_path()
