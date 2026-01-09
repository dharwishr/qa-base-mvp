"""
CDP Runner - Executes recorded scripts using Chrome DevTools Protocol via browser_use.

Features:
- Runs test scripts without LLM calls (zero token cost)
- Self-healing with fallback selectors
- Live screenshots at each step
- Uses browser_use's BrowserSession for browser management
"""

import asyncio
import base64
import logging
import re
import time
from datetime import datetime
from typing import Any

from browser_use.browser.session import BrowserSession
from browser_use.actor.page import Page
from browser_use.actor.element import Element
from browser_use.actor.mouse import Mouse

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


class CDPElementLocator:
    """A locator that tries multiple selectors until one works using CDP."""

    def __init__(
        self,
        page: Page,
        session_id: str,
        selectors: SelectorSet,
        element_context: ElementContext | None = None,
    ):
        self.page = page
        self.session_id = session_id
        self.selectors = selectors
        self.element_context = element_context
        self.heal_attempts: list[HealAttempt] = []
        self.successful_selector: str | None = None
        self.located_element: Element | None = None

    async def locate(self, timeout: int = 10000) -> Element | None:
        """Try to locate the element using fallback selectors.

        Args:
            timeout: Timeout in milliseconds (default 10 seconds)

        Returns:
            Element if found, None otherwise
        """
        all_selectors = self.selectors.all_selectors()
        # Use at least 3 seconds per selector attempt
        timeout_seconds = max(timeout / 1000, 3.0)

        for selector in all_selectors:
            try:
                element = await asyncio.wait_for(
                    self._find_element_by_selector(selector),
                    timeout=timeout_seconds
                )
                if element:
                    self.successful_selector = selector
                    self.located_element = element
                    self.heal_attempts.append(HealAttempt(selector=selector, success=True))
                    return element
            except asyncio.TimeoutError:
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
            element = await self._try_fuzzy_match(timeout)
            if element:
                return element

        return None

    async def _find_element_by_selector(self, selector: str) -> Element | None:
        """Find an element using a single selector.

        Supports:
        - xpath=... for XPath selectors
        - CSS selectors (default)
        - text=... for text-based selectors
        - role=... for ARIA role selectors
        """
        cdp_client = self.page._client

        if selector.startswith("xpath="):
            xpath = selector[6:]
            return await self._find_by_xpath(xpath)

        elif selector.startswith("text="):
            text = selector[5:]
            return await self._find_by_text(text)

        elif selector.startswith("role="):
            role_spec = selector[5:]
            return await self._find_by_role(role_spec)

        else:
            # CSS selector
            return await self._find_by_css(selector)

    async def _find_by_css(self, selector: str) -> Element | None:
        """Find element by CSS selector."""
        try:
            elements = await self.page.get_elements_by_css_selector(selector)
            if elements:
                return elements[0]
        except Exception as e:
            logger.debug(f"CSS selector '{selector}' failed: {e}")
        return None

    async def _find_by_xpath(self, xpath: str) -> Element | None:
        """Find element by XPath selector."""
        cdp_client = self.page._client

        try:
            # Escape quotes in xpath for JavaScript
            escaped_xpath = xpath.replace('"', '\\"')
            # Use Runtime.evaluate to find element by XPath
            result = await cdp_client.send.Runtime.evaluate(
                params={
                    'expression': f'''
                        (function() {{
                            const result = document.evaluate(
                                "{escaped_xpath}",
                                document,
                                null,
                                XPathResult.FIRST_ORDERED_NODE_TYPE,
                                null
                            );
                            return result.singleNodeValue;
                        }})()
                    ''',
                    'returnByValue': False,
                },
                session_id=self.session_id,
            )

            object_id = result.get('result', {}).get('objectId')
            if object_id:
                # Get backend node ID from the remote object
                node_result = await cdp_client.send.DOM.describeNode(
                    params={'objectId': object_id},
                    session_id=self.session_id
                )
                backend_node_id = node_result['node']['backendNodeId']
                return Element(self.page._browser_session, backend_node_id, self.session_id)

        except Exception as e:
            logger.debug(f"XPath '{xpath}' failed: {e}")

        return None

    async def _find_by_text(self, text: str) -> Element | None:
        """Find element by text content."""
        cdp_client = self.page._client

        try:
            # Escape text for JavaScript
            escaped_text = text.replace("'", "\\'").replace("\n", "\\n")

            result = await cdp_client.send.Runtime.evaluate(
                params={
                    'expression': f'''
                        (function() {{
                            const walker = document.createTreeWalker(
                                document.body,
                                NodeFilter.SHOW_ELEMENT,
                                null,
                                false
                            );
                            let node;
                            while (node = walker.nextNode()) {{
                                if (node.innerText && node.innerText.includes('{escaped_text}')) {{
                                    return node;
                                }}
                            }}
                            return null;
                        }})()
                    ''',
                    'returnByValue': False,
                },
                session_id=self.session_id,
            )

            object_id = result.get('result', {}).get('objectId')
            if object_id:
                node_result = await cdp_client.send.DOM.describeNode(
                    params={'objectId': object_id},
                    session_id=self.session_id
                )
                backend_node_id = node_result['node']['backendNodeId']
                return Element(self.page._browser_session, backend_node_id, self.session_id)

        except Exception as e:
            logger.debug(f"Text selector '{text}' failed: {e}")

        return None

    async def _find_by_role(self, role_spec: str) -> Element | None:
        """Find element by ARIA role."""
        # Parse role[name='...'] format
        match = re.match(r"(\w+)\[name=['\"](.+)['\"]\]", role_spec)
        if match:
            role = match.group(1)
            name = match.group(2)
            selector = f"[role='{role}'][aria-label='{name}'], [role='{role}']:has-text('{name}')"
        else:
            role = role_spec
            selector = f"[role='{role}']"

        return await self._find_by_css(selector)

    async def _try_fuzzy_match(self, timeout: int) -> Element | None:
        """Try to find element using fuzzy matching based on context."""
        ctx = self.element_context
        if not ctx:
            return None

        fuzzy_selectors = []

        # Try by text content
        if ctx.text_content:
            fuzzy_selectors.append(f"text={ctx.text_content}")

        # Try by aria-label
        if ctx.aria_label:
            fuzzy_selectors.append(f"[aria-label='{ctx.aria_label}']")

        # Try by placeholder
        if ctx.placeholder:
            fuzzy_selectors.append(f"[placeholder='{ctx.placeholder}']")

        # Try by tag + classes
        if ctx.tag_name and ctx.classes:
            class_selector = ".".join(ctx.classes[:2])  # Use first 2 classes
            fuzzy_selectors.append(f"{ctx.tag_name}.{class_selector}")

        timeout_seconds = (timeout / 2) / 1000  # Use half timeout for fuzzy

        for selector in fuzzy_selectors:
            try:
                element = await asyncio.wait_for(
                    self._find_element_by_selector(selector),
                    timeout=timeout_seconds
                )
                if element:
                    self.successful_selector = f"[HEALED] {selector}"
                    self.located_element = element
                    self.heal_attempts.append(HealAttempt(selector=selector, success=True))
                    return element
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
        return self.successful_selector != primary or self.successful_selector.startswith("[HEALED]")


class CDPRunner(BaseRunner):
    """Executes recorded scripts using CDP via browser_use."""

    def __init__(
        self,
        headless: bool = True,
        screenshot_dir: str = "data/screenshots/runs",
        on_step_start: StepStartCallback | None = None,
        on_step_complete: StepCompleteCallback | None = None,
        cdp_url: str | None = None,
    ):
        super().__init__(headless, screenshot_dir, on_step_start, on_step_complete)

        self._session: BrowserSession | None = None
        self._page: Page | None = None
        self._session_id: str | None = None
        self._cdp_url = cdp_url  # Remote browser CDP URL

    async def __aenter__(self) -> "CDPRunner":
        await self._setup()
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        await self._teardown()

    async def _setup(self):
        """Initialize browser using BrowserSession - connect to remote or launch local."""
        logger.info("Initializing CDP browser via BrowserSession...")

        if self._cdp_url:
            # Connect to remote browser via CDP URL
            logger.info(f"Connecting to remote browser via CDP: {self._cdp_url}")
            self._session = BrowserSession(cdp_url=self._cdp_url)
        else:
            # Launch local browser
            logger.info("Launching local CDP browser")
            self._session = BrowserSession(headless=self.headless)

        try:
            await asyncio.wait_for(self._session.start(), timeout=30.0)
            logger.info("BrowserSession started successfully")
        except asyncio.TimeoutError:
            raise RuntimeError(f"Timeout starting BrowserSession with CDP URL: {self._cdp_url}")
        except Exception as e:
            raise RuntimeError(f"Failed to start BrowserSession: {e}")

        # Wait for browser to be ready and get the page - retry up to 5 times
        target_id = None
        max_retries = 5
        for attempt in range(max_retries):
            target_id = self._session.agent_focus_target_id
            if target_id:
                logger.info(f"Got browser target ID: {target_id}")
                break
            logger.debug(f"Waiting for browser target ID (attempt {attempt + 1}/{max_retries})...")
            await asyncio.sleep(1.0)

        if not target_id:
            # Try to get any available target
            logger.warning("agent_focus_target_id not available, attempting to find any target...")
            try:
                # Get targets list from the browser
                targets = await self._session._client.send.Target.getTargets()
                page_targets = [t for t in targets.get('targetInfos', []) if t.get('type') == 'page']
                if page_targets:
                    target_id = page_targets[0].get('targetId')
                    logger.info(f"Found page target: {target_id}")
            except Exception as e:
                logger.warning(f"Could not get targets list: {e}")

        if not target_id:
            raise RuntimeError(
                f"Failed to get browser target ID after {max_retries} attempts. "
                f"CDP URL: {self._cdp_url}. Browser may not be ready or CDP connection failed."
            )

        # Create Page actor
        logger.debug(f"Creating CDP session for target: {target_id}")
        try:
            cdp_session = await self._session.get_or_create_cdp_session(target_id=target_id, focus=True)
            self._session_id = cdp_session.session_id
            self._page = Page(self._session, target_id, self._session_id)
            logger.info(f"CDP session created with session_id: {self._session_id}")
        except Exception as e:
            raise RuntimeError(f"Failed to create CDP session: {e}")

        # Set viewport size
        await self._page.set_viewport_size(1920, 1080)

        # Wait for page to be ready
        await asyncio.sleep(0.5)

        logger.info("CDP browser initialized successfully")

    async def _teardown(self):
        """Clean up browser."""
        logger.info("Cleaning up CDP browser...")
        try:
            if self._session:
                await self._session.kill()
            logger.info("CDP browser cleanup complete")
        except Exception as e:
            logger.error(f"Error during CDP browser cleanup: {e}")

    async def run(self, steps: list[PlaywrightStep], run_id: str) -> RunResult:
        """Execute a list of steps and return results."""
        logger.info(f"Starting CDP run {run_id} with {len(steps)} steps")
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

            logger.info(f"CDP run {run_id} completed with status: {result.status}")

        except Exception as e:
            result.status = "failed"
            result.error_message = str(e)
            logger.exception(f"CDP run {run_id} failed with error: {e}")
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
        await self._page.goto(step.url)
        # Wait for page to settle - use longer delay for page load
        await asyncio.sleep(2)
        # Wait for any pending network activity to settle
        await self._wait_for_page_idle()

    async def _execute_click(self, step: PlaywrightStep) -> CDPElementLocator:
        """Execute click with self-healing."""
        assert self._page and step.selectors and self._session_id

        # Wait for page to be stable before looking for elements
        await self._wait_for_page_idle()

        healer = CDPElementLocator(self._page, self._session_id, step.selectors, step.element_context)
        element = await healer.locate(timeout=step.timeout)

        if not element:
            # Retry once after a longer wait - elements might still be loading
            logger.debug(f"Element not found on first try, retrying after wait...")
            await asyncio.sleep(1)
            await self._wait_for_page_idle()
            element = await healer.locate(timeout=step.timeout)

        if not element:
            raise Exception(f"Could not find element to click. Tried selectors: {step.selectors.all_selectors()}")

        await element.click()
        # Wait for any navigation or dynamic content after click
        await asyncio.sleep(0.5)
        await self._wait_for_page_idle()
        return healer

    async def _execute_fill(self, step: PlaywrightStep) -> CDPElementLocator:
        """Execute fill with self-healing."""
        assert self._page and step.selectors and step.value is not None and self._session_id

        # Wait for page to be stable before looking for elements
        await self._wait_for_page_idle()

        healer = CDPElementLocator(self._page, self._session_id, step.selectors, step.element_context)
        element = await healer.locate(timeout=step.timeout)

        if not element:
            # Retry once after a longer wait
            logger.debug(f"Element not found on first try, retrying after wait...")
            await asyncio.sleep(1)
            await self._wait_for_page_idle()
            element = await healer.locate(timeout=step.timeout)

        if not element:
            raise Exception(f"Could not find element to fill. Tried selectors: {step.selectors.all_selectors()}")

        await element.fill(step.value, clear=True)
        return healer

    async def _execute_select(self, step: PlaywrightStep) -> CDPElementLocator:
        """Execute dropdown select with self-healing.

        Handles both native <select> elements and custom dropdowns (Select2, etc.).
        """
        assert self._page and step.selectors and step.value is not None and self._session_id

        healer = CDPElementLocator(self._page, self._session_id, step.selectors, step.element_context)
        element = await healer.locate(timeout=step.timeout)

        if not element:
            raise Exception(f"Could not find dropdown. Tried selectors: {step.selectors.all_selectors()}")

        cdp_client = self._page._client
        object_id = await element._get_remote_object_id()

        if not object_id:
            raise Exception("Could not get element reference for dropdown")

        # Check if this is a native <select> element
        tag_result = await cdp_client.send.Runtime.callFunctionOn(
            params={
                'functionDeclaration': 'function() { return this.tagName.toLowerCase(); }',
                'objectId': object_id,
                'returnByValue': True,
            },
            session_id=self._session_id,
        )
        tag_name = tag_result.get('result', {}).get('value', '')

        if tag_name == "select":
            return await self._select_native_option_cdp(element, step.value, healer)
        else:
            return await self._select_custom_dropdown_cdp(element, step.value, step.timeout, healer)

    async def _select_native_option_cdp(
        self, element, value: str, healer: 'CDPElementLocator'
    ) -> 'CDPElementLocator':
        """Select option from native <select> element using CDP."""
        assert self._session_id
        cdp_client = self._page._client
        object_id = await element._get_remote_object_id()

        escaped_value = value.replace("\\", "\\\\").replace('"', '\\"').replace("'", "\\'")

        await cdp_client.send.Runtime.callFunctionOn(
            params={
                'functionDeclaration': f'''
                    function() {{
                        const targetValue = "{escaped_value}";
                        const options = Array.from(this.options);

                        // Strategy 1: Match by value attribute
                        let option = options.find(o => o.value === targetValue);

                        // Strategy 2: Match by label (text content)
                        if (!option) {{
                            option = options.find(o => o.text === targetValue || o.textContent.trim() === targetValue);
                        }}

                        // Strategy 3: Case-insensitive match
                        if (!option) {{
                            const lowerTarget = targetValue.toLowerCase();
                            option = options.find(o =>
                                o.value.toLowerCase() === lowerTarget ||
                                o.text.toLowerCase() === lowerTarget
                            );
                        }}

                        // Strategy 4: Partial match
                        if (!option) {{
                            const lowerTarget = targetValue.toLowerCase();
                            option = options.find(o =>
                                o.text.toLowerCase().includes(lowerTarget) ||
                                lowerTarget.includes(o.text.toLowerCase().trim())
                            );
                        }}

                        if (option) {{
                            this.value = option.value;
                            this.dispatchEvent(new Event('change', {{ bubbles: true }}));
                            return true;
                        }}
                        return false;
                    }}
                ''',
                'objectId': object_id,
                'returnByValue': True,
            },
            session_id=self._session_id,
        )

        return healer

    async def _select_custom_dropdown_cdp(
        self, element, value: str, _timeout: int, healer: 'CDPElementLocator'
    ) -> 'CDPElementLocator':
        """Select option from custom dropdown (Select2, Choices.js, etc.) using CDP.

        Works by clicking to open the dropdown, then clicking the matching option.
        """
        assert self._session_id and self._page

        # Click to open the dropdown
        await element.click()
        await asyncio.sleep(0.3)  # Wait for animation

        cdp_client = self._page._client
        escaped_value = value.replace("\\", "\\\\").replace('"', '\\"').replace("'", "\\'")

        # Use JavaScript to find and click the option in custom dropdown
        result = await cdp_client.send.Runtime.evaluate(
            params={
                'expression': f'''
                    (function() {{
                        const targetValue = "{escaped_value}";
                        const lowerTarget = targetValue.toLowerCase();

                        // Common dropdown option selectors
                        const selectors = [
                            // Select2
                            '.select2-results__option',
                            '.select2-results li',
                            // Choices.js
                            '.choices__item--choice',
                            // Bootstrap
                            '.dropdown-menu.show li',
                            '.dropdown-item',
                            // Material UI
                            '.MuiMenuItem-root',
                            '[role="option"]',
                            // Ant Design
                            '.ant-select-item-option',
                            // Generic
                            '[role="listbox"] [role="option"]',
                        ];

                        for (const selector of selectors) {{
                            const options = document.querySelectorAll(selector);
                            for (const option of options) {{
                                const text = option.textContent.trim();
                                if (text === targetValue ||
                                    text.toLowerCase() === lowerTarget ||
                                    text.toLowerCase().includes(lowerTarget) ||
                                    lowerTarget.includes(text.toLowerCase())) {{
                                    option.click();
                                    return {{ success: true, matched: text }};
                                }}
                            }}
                        }}

                        return {{ success: false }};
                    }})()
                ''',
                'returnByValue': True,
            },
            session_id=self._session_id,
        )

        result_value = result.get('result', {}).get('value', {})
        if result_value.get('success'):
            healer.successful_selector = f"[CUSTOM_SELECT] matched: {result_value.get('matched', value)}"
            await asyncio.sleep(0.2)  # Wait for selection to register
            return healer

        # If nothing worked, press Escape and raise error
        await self._page.press("Escape")

        raise Exception(
            f"Could not select '{value}' from custom dropdown. "
            f"Tried Select2, Choices.js, Bootstrap, Material UI, and Ant Design selectors."
        )

    async def _execute_press(self, step: PlaywrightStep):
        """Execute key press."""
        assert self._page and step.key

        if step.selectors and self._session_id:
            # Focus element first if selector provided
            healer = CDPElementLocator(self._page, self._session_id, step.selectors, step.element_context)
            element = await healer.locate(timeout=step.timeout)
            if element:
                # Focus the element
                cdp_client = self._page._client
                await cdp_client.send.DOM.focus(
                    params={'backendNodeId': element._backend_node_id},
                    session_id=self._session_id
                )

        # Press the key
        await self._page.press(step.key)

    async def _execute_scroll(self, step: PlaywrightStep):
        """Execute scroll."""
        assert self._page and self._session_id

        amount = step.amount or 500
        if step.direction == "up":
            delta_y = -amount
        else:
            delta_y = amount

        mouse = Mouse(self._session, self._session_id)
        await mouse.scroll(delta_y=delta_y)
        await asyncio.sleep(0.3)  # Wait for scroll to complete

    async def _execute_wait(self, step: PlaywrightStep):
        """Execute wait."""
        timeout_seconds = step.timeout / 1000 if step.timeout else 1
        await asyncio.sleep(timeout_seconds)

    async def _execute_hover(self, step: PlaywrightStep) -> CDPElementLocator:
        """Execute hover with self-healing."""
        assert self._page and step.selectors and self._session_id

        healer = CDPElementLocator(self._page, self._session_id, step.selectors, step.element_context)
        element = await healer.locate(timeout=step.timeout)

        if not element:
            raise Exception(f"Could not find element to hover. Tried selectors: {step.selectors.all_selectors()}")

        await element.hover()
        return healer

    def _match_text_pattern(self, actual: str, expected: str, assertion: AssertionConfig) -> bool:
        """Match text based on pattern type.

        Args:
            actual: The actual text from the page
            expected: The expected pattern/text
            assertion: Assertion config with pattern_type and case_sensitive settings

        Returns:
            True if the pattern matches, False otherwise
        """
        pattern_type = getattr(assertion, 'pattern_type', 'substring')

        if pattern_type == "exact":
            if assertion.case_sensitive:
                return actual.strip() == expected.strip()
            return actual.strip().lower() == expected.strip().lower()
        elif pattern_type == "substring":
            if assertion.case_sensitive:
                return expected in actual
            return expected.lower() in actual.lower()
        elif pattern_type == "wildcard":
            # Convert wildcard (*) to regex pattern
            pattern = re.escape(expected).replace(r"\*", ".*")
            flags = 0 if assertion.case_sensitive else re.IGNORECASE
            return bool(re.search(pattern, actual, flags))
        elif pattern_type == "regex":
            flags = 0 if assertion.case_sensitive else re.IGNORECASE
            try:
                return bool(re.search(expected, actual, flags))
            except re.error:
                return False
        return False

    async def _execute_assertion(self, step: PlaywrightStep) -> dict[str, Any]:
        """Execute an assertion step."""
        assert self._page and step.assertion and self._session_id

        assertion = step.assertion
        result: dict[str, Any] = {"success": False, "heal_attempts": [], "selector_used": None}
        cdp_client = self._page._client
        pattern_type = getattr(assertion, 'pattern_type', 'substring')

        try:
            if assertion.assertion_type == "text_visible":
                expected = assertion.expected_value or ""
                timeout_ms = step.timeout or 10000
                poll_interval = 500  # Check every 500ms
                max_attempts = max(timeout_ms // poll_interval, 1)

                if step.selectors:
                    # Look for text within a specific element
                    healer = CDPElementLocator(self._page, self._session_id, step.selectors, step.element_context)
                    element = await healer.locate(timeout=step.timeout)
                    result["heal_attempts"] = healer.heal_attempts
                    result["selector_used"] = healer.successful_selector

                    if element:
                        # Check element text
                        object_id = await element._get_remote_object_id()
                        if object_id:
                            text_result = await cdp_client.send.Runtime.callFunctionOn(
                                params={
                                    'functionDeclaration': 'function() { return this.innerText || this.textContent || ""; }',
                                    'objectId': object_id,
                                    'returnByValue': True,
                                },
                                session_id=self._session_id,
                            )
                            actual_text = text_result.get('result', {}).get('value', '')
                            # Use pattern matching for element text
                            result["success"] = self._match_text_pattern(actual_text, expected, assertion)
                            if not result["success"]:
                                result["error"] = f"Text pattern '{expected}' not found. Got: '{actual_text[:100]}'"
                    else:
                        result["error"] = f"Could not find element containing text: {expected}"
                else:
                    # Look for text anywhere on page with polling (wait for dynamic content)
                    for attempt in range(max_attempts):
                        # Wait for page to be idle before checking
                        await self._wait_for_page_idle()

                        page_text_result = await cdp_client.send.Runtime.evaluate(
                            params={
                                'expression': 'document.body.innerText',
                                'returnByValue': True,
                            },
                            session_id=self._session_id,
                        )
                        page_text = page_text_result.get('result', {}).get('value', '')

                        if self._match_text_pattern(page_text, expected, assertion):
                            result["success"] = True
                            result["selector_used"] = f"text={expected} (pattern_type={pattern_type})"
                            break

                        # If not found and not last attempt, wait and retry
                        if attempt < max_attempts - 1:
                            await asyncio.sleep(poll_interval / 1000)

                    if not result["success"]:
                        result["error"] = f"Text '{expected}' not found on page after {max_attempts} attempts (pattern_type={pattern_type})"

            elif assertion.assertion_type == "element_visible":
                assert step.selectors
                healer = CDPElementLocator(self._page, self._session_id, step.selectors, step.element_context)
                element = await healer.locate(timeout=step.timeout)
                result["heal_attempts"] = healer.heal_attempts
                result["selector_used"] = healer.successful_selector

                if element:
                    # Check if element is visible
                    object_id = await element._get_remote_object_id()
                    if object_id:
                        visibility_result = await cdp_client.send.Runtime.callFunctionOn(
                            params={
                                'functionDeclaration': '''
                                    function() {
                                        const rect = this.getBoundingClientRect();
                                        const style = window.getComputedStyle(this);
                                        return rect.width > 0 && rect.height > 0 &&
                                               style.display !== 'none' &&
                                               style.visibility !== 'hidden' &&
                                               style.opacity !== '0';
                                    }
                                ''',
                                'objectId': object_id,
                                'returnByValue': True,
                            },
                            session_id=self._session_id,
                        )
                        result["success"] = visibility_result.get('result', {}).get('value', False)
                        if not result["success"]:
                            result["error"] = "Element exists but is not visible"
                else:
                    result["error"] = "Element not found"

            elif assertion.assertion_type == "url_contains":
                expected = assertion.expected_value or ""
                current_url = await self._page.get_url()
                result["success"] = expected in current_url
                result["selector_used"] = f"url contains {expected}"
                if not result["success"]:
                    result["error"] = f"URL '{current_url}' does not contain '{expected}'"

            elif assertion.assertion_type == "url_equals":
                expected = assertion.expected_value or ""
                current_url = await self._page.get_url()
                result["success"] = current_url == expected
                result["selector_used"] = f"url equals {expected}"
                if not result["success"]:
                    result["error"] = f"URL '{current_url}' does not equal '{expected}'"

            elif assertion.assertion_type == "value_equals":
                assert step.selectors
                expected = assertion.expected_value or ""
                healer = CDPElementLocator(self._page, self._session_id, step.selectors, step.element_context)
                element = await healer.locate(timeout=step.timeout)
                result["heal_attempts"] = healer.heal_attempts
                result["selector_used"] = healer.successful_selector

                if element:
                    object_id = await element._get_remote_object_id()
                    if object_id:
                        value_result = await cdp_client.send.Runtime.callFunctionOn(
                            params={
                                'functionDeclaration': 'function() { return this.value; }',
                                'objectId': object_id,
                                'returnByValue': True,
                            },
                            session_id=self._session_id,
                        )
                        actual_value = value_result.get('result', {}).get('value', '')
                        result["success"] = actual_value == expected
                        if not result["success"]:
                            result["error"] = f"Expected value '{expected}', got '{actual_value}'"
                else:
                    result["error"] = "Input element not found"

            elif assertion.assertion_type == "element_count":
                assert step.selectors and assertion.expected_count is not None
                # For count assertion, we need to find all matching elements
                selector = step.selectors.primary
                if selector.startswith("xpath="):
                    # XPath count
                    xpath = selector[6:]
                    escaped_xpath = xpath.replace('"', '\\"')
                    eval_result = await cdp_client.send.Runtime.evaluate(
                        params={
                            'expression': f'''
                                (function() {{
                                    const result = document.evaluate(
                                        "{escaped_xpath}",
                                        document,
                                        null,
                                        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                                        null
                                    );
                                    return result.snapshotLength;
                                }})()
                            ''',
                            'returnByValue': True,
                        },
                        session_id=self._session_id,
                    )
                    actual_count = eval_result.get('result', {}).get('value', 0)
                else:
                    # CSS count
                    elements = await self._page.get_elements_by_css_selector(selector)
                    actual_count = len(elements)

                result["success"] = actual_count == assertion.expected_count
                result["selector_used"] = selector
                if not result["success"]:
                    result["error"] = f"Expected {assertion.expected_count} elements, found {actual_count}"

            else:
                result["error"] = f"Unknown assertion type: {assertion.assertion_type}"

        except Exception as e:
            result["error"] = str(e)

        return result

    async def _wait_for_page_idle(self, timeout: float = 5.0):
        """Wait for the page to be idle (no pending network requests, DOM stable)."""
        try:
            cdp_client = self._page._client
            start_time = time.time()
            
            while (time.time() - start_time) < timeout:
                # Check document ready state
                result = await cdp_client.send.Runtime.evaluate(
                    params={
                        'expression': 'document.readyState',
                        'returnByValue': True,
                    },
                    session_id=self._session_id,
                )
                ready_state = result.get('result', {}).get('value', '')
                
                if ready_state == 'complete':
                    # Additional wait for any animations or delayed content
                    await asyncio.sleep(0.3)
                    return
                
                await asyncio.sleep(0.2)
                
        except Exception as e:
            logger.debug(f"Error waiting for page idle: {e}")
            # Don't fail the step, just continue
            await asyncio.sleep(0.5)

    async def _take_screenshot(self, run_id: str, step_index: int, is_error: bool = False) -> str:
        """Take a screenshot and return the path relative to base screenshots dir."""
        assert self._page

        suffix = "_error" if is_error else ""
        filename = f"{run_id}_step_{step_index:03d}{suffix}.png"
        filepath = self.screenshot_dir / filename

        # Get base64 screenshot from CDP
        base64_data = await self._page.screenshot(format='png')

        # Save to file
        with open(filepath, 'wb') as f:
            f.write(base64.b64decode(base64_data))

        # Return path relative to base screenshots directory
        return f"runs/{filename}"
