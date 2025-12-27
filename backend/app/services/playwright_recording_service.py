"""
Playwright Recording Service - Alternative recording mode using Playwright's CDP connection.

Key improvements over CDP/browser-use approach:
- Uses Playwright's connect_over_cdp() which attaches cleanly without session conflicts
- Blur-based input capture - records final value when user leaves input field (not each keystroke)
- Backspace/delete are part of final value, not separate steps
- Generates CSS selectors alongside XPath for better replay reliability

Usage:
    service = PlaywrightRecordingService(db, test_session, browser_session)
    await service.start()
    # ... user interacts with browser ...
    await service.stop()
"""

import asyncio
import base64
import json
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import aiohttp
from playwright.async_api import async_playwright, Browser, BrowserContext, Page
from sqlalchemy.orm import Session

from app.config import settings
from app.models import StepAction, TestSession, TestStep
from app.services.browser_orchestrator import BrowserSession as OrchestratorSession

logger = logging.getLogger(__name__)


async def _get_cdp_endpoint(browser_session: OrchestratorSession) -> str | None:
    """
    Get CDP WebSocket endpoint for Playwright's connect_over_cdp().
    """
    running_in_docker = os.path.exists("/.dockerenv")

    if running_in_docker and browser_session.container_ip:
        check_host = browser_session.container_ip
        check_port = 9222
    elif browser_session.cdp_port:
        check_host = browser_session.cdp_host
        check_port = browser_session.cdp_port
    else:
        logger.warning("No CDP port or container IP available")
        return None

    cdp_http_url = f"http://{check_host}:{check_port}"

    try:
        async with aiohttp.ClientSession() as http_session:
            async with http_session.get(
                f"{cdp_http_url}/json/version",
                timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                if resp.status == 200:
                    version_info = await resp.json()
                    ws_url = version_info.get("webSocketDebuggerUrl")
                    if ws_url:
                        # Replace host in URL with correct address
                        if running_in_docker and browser_session.container_ip:
                            fresh_url = re.sub(
                                r'ws://[^/]+',
                                f'ws://{browser_session.container_ip}:9222',
                                ws_url
                            )
                        else:
                            fresh_url = re.sub(
                                r'ws://[^/]+',
                                f'ws://{browser_session.cdp_host}:{browser_session.cdp_port}',
                                ws_url
                            )
                        logger.info(f"Got CDP WebSocket URL for Playwright: {fresh_url}")
                        return fresh_url
    except Exception as e:
        logger.warning(f"Error getting CDP URL: {e}")

    return None


@dataclass
class ElementInfo:
    """Information about a DOM element captured during user interaction."""

    xpath: str | None = None
    css_selector: str | None = None
    tag_name: str = "unknown"
    text_content: str | None = None
    aria_label: str | None = None
    role: str | None = None
    id: str | None = None
    name: str | None = None
    placeholder: str | None = None
    classes: list[str] = field(default_factory=list)
    x: int = 0
    y: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "xpath": self.xpath,
            "css_selector": self.css_selector,
            "tag_name": self.tag_name,
            "text_content": self.text_content,
            "aria_label": self.aria_label,
            "role": self.role,
            "id": self.id,
            "name": self.name,
            "placeholder": self.placeholder,
            "classes": self.classes,
            "x": self.x,
            "y": self.y,
        }

    def to_element_context_dict(self) -> dict[str, Any]:
        """Convert to dictionary compatible with ElementContext model for replay."""
        return {
            "tag_name": self.tag_name,
            "text_content": self.text_content,
            "aria_label": self.aria_label,
            "placeholder": self.placeholder,
            "role": self.role,
            "classes": self.classes,
        }


@dataclass
class RecordingState:
    """State of an active recording session."""

    test_session_id: str
    browser_session_id: str
    started_at: datetime
    steps_recorded: int = 0
    is_active: bool = True


# Global registry of active Playwright recordings
_active_playwright_recordings: dict[str, "PlaywrightRecordingService"] = {}


def get_active_playwright_recording(test_session_id: str) -> "PlaywrightRecordingService | None":
    """Get active Playwright recording for a test session."""
    return _active_playwright_recordings.get(test_session_id)


# JavaScript to inject for event capture with blur-based input handling
RECORDING_SCRIPT = '''
(function() {
    if (window.__pwRecorderActive) return;
    window.__pwRecorderActive = true;

    // Track active input to capture on blur
    let activeInputElement = null;
    let activeInputInitialValue = '';

    // Generate XPath for an element
    function getXPath(element) {
        if (!element) return '';
        if (element.id) return `//*[@id="${element.id}"]`;

        const parts = [];
        while (element && element.nodeType === Node.ELEMENT_NODE) {
            let index = 0;
            let sibling = element.previousSibling;
            while (sibling) {
                if (sibling.nodeType === Node.ELEMENT_NODE &&
                    sibling.tagName === element.tagName) {
                    index++;
                }
                sibling = sibling.previousSibling;
            }
            const tagName = element.tagName.toLowerCase();
            const part = index > 0 ? `${tagName}[${index + 1}]` : tagName;
            parts.unshift(part);
            element = element.parentElement;
        }
        return '/' + parts.join('/');
    }

    // Generate CSS selector for an element
    function getCssSelector(element) {
        if (!element) return '';

        // Best case: has an ID
        if (element.id) {
            return `#${CSS.escape(element.id)}`;
        }

        // Try to build unique selector
        const parts = [];
        let current = element;

        while (current && current !== document.body && parts.length < 5) {
            let selector = current.tagName.toLowerCase();

            // Add ID if available
            if (current.id) {
                parts.unshift(`#${CSS.escape(current.id)}`);
                break;
            }

            // Add meaningful class
            const classes = Array.from(current.classList || [])
                .filter(c => !c.match(/^(ng-|v-|_|css-)/))  // Filter generated classes
                .slice(0, 2);
            if (classes.length > 0) {
                selector += '.' + classes.map(c => CSS.escape(c)).join('.');
            }

            // Add name or type for inputs
            if (current.name) {
                selector += `[name="${CSS.escape(current.name)}"]`;
            } else if (current.type && current.tagName === 'INPUT') {
                selector += `[type="${current.type}"]`;
            }

            // Add aria-label if no other attributes
            if (!current.name && !classes.length && current.getAttribute('aria-label')) {
                selector += `[aria-label="${CSS.escape(current.getAttribute('aria-label'))}"]`;
            }

            parts.unshift(selector);
            current = current.parentElement;
        }

        return parts.join(' > ');
    }

    // Extract element info
    function getElementInfo(target, x, y) {
        return {
            xpath: getXPath(target),
            cssSelector: getCssSelector(target),
            tagName: target.tagName?.toLowerCase() || 'unknown',
            textContent: (target.textContent || '').substring(0, 100).trim(),
            ariaLabel: target.getAttribute('aria-label'),
            role: target.getAttribute('role'),
            id: target.id || null,
            name: target.name || null,
            placeholder: target.placeholder || null,
            classes: Array.from(target.classList || []),
            x: x,
            y: y,
        };
    }

    // Click handler
    document.addEventListener('click', function(e) {
        const info = {
            type: 'click',
            element: getElementInfo(e.target, e.clientX, e.clientY),
            timestamp: Date.now(),
        };
        window.__pwRecordAction(JSON.stringify(info));
    }, true);

    // Focus handler - track when user focuses an input
    document.addEventListener('focus', function(e) {
        const target = e.target;
        if (!['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

        // Remember the element and its initial value
        activeInputElement = target;
        activeInputInitialValue = target.value;
    }, true);

    // Blur handler - capture final input value when user leaves field
    document.addEventListener('blur', function(e) {
        const target = e.target;
        if (!['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
        if (target !== activeInputElement) return;

        const finalValue = target.value;

        // Only record if value actually changed
        if (finalValue !== activeInputInitialValue) {
            const info = {
                type: 'input',
                element: getElementInfo(target, 0, 0),
                value: finalValue,
                timestamp: Date.now(),
            };
            window.__pwRecordAction(JSON.stringify(info));
        }

        activeInputElement = null;
        activeInputInitialValue = '';
    }, true);

    // Select/dropdown handler
    document.addEventListener('change', function(e) {
        const target = e.target;
        if (target.tagName !== 'SELECT') return;

        const selectedOption = target.options[target.selectedIndex];
        const info = {
            type: 'select',
            element: getElementInfo(target, 0, 0),
            value: target.value,
            selectedText: selectedOption?.text || '',
            timestamp: Date.now(),
        };
        window.__pwRecordAction(JSON.stringify(info));
    }, true);

    // Keyboard handler - only capture special keys (not regular typing)
    document.addEventListener('keydown', function(e) {
        // Don't capture regular typing in inputs - blur handler does that
        const target = e.target;
        if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
            // Only capture Enter (form submit), Escape, Tab
            if (!['Enter', 'Escape', 'Tab'].includes(e.key)) {
                return;
            }
        }

        // For non-input elements, capture all navigation keys and shortcuts
        const specialKeys = ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];
        const isSpecialKey = specialKeys.includes(e.key);
        const hasModifier = e.ctrlKey || e.metaKey || e.altKey;

        if (!isSpecialKey && !hasModifier) {
            return;
        }

        const info = {
            type: 'keypress',
            element: getElementInfo(e.target, 0, 0),
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
            timestamp: Date.now(),
        };
        window.__pwRecordAction(JSON.stringify(info));
    }, true);

    // Scroll handler with debouncing
    let scrollTimeout = null;
    document.addEventListener('scroll', function(e) {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(function() {
            const info = {
                type: 'scroll',
                scrollX: window.scrollX,
                scrollY: window.scrollY,
                timestamp: Date.now(),
            };
            window.__pwRecordAction(JSON.stringify(info));
        }, 500);  // 500ms debounce
    }, true);

    console.log('[Playwright Recording] Event listeners installed (blur-based input)');
})();
'''


class PlaywrightRecordingService:
    """
    Captures user interactions using Playwright's CDP connection.

    Key differences from CDP-based UserRecordingService:
    - Uses Playwright's connect_over_cdp() for cleaner browser attachment
    - Blur-based input capture (final value on blur, not each keystroke)
    - Generates CSS selectors alongside XPath
    - No session conflicts with existing browser-use sessions
    """

    # Function name exposed to JavaScript
    CALLBACK_NAME = "__pwRecordAction"

    def __init__(
        self,
        db: Session,
        test_session: TestSession,
        browser_session: OrchestratorSession,
    ):
        self.db = db
        self.test_session = test_session
        self.browser_session = browser_session

        # Playwright objects
        self._playwright = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None

        self._current_step_number = 0
        self._is_recording = False
        self._state: RecordingState | None = None

        # Get current max step number from existing steps
        existing_steps = db.query(TestStep).filter(
            TestStep.session_id == test_session.id
        ).order_by(TestStep.step_number.desc()).first()

        if existing_steps:
            self._current_step_number = existing_steps.step_number

    async def start(self) -> RecordingState:
        """
        Start recording by connecting to the browser via Playwright's CDP connection.

        Returns:
            RecordingState with recording session info
        """
        if self._is_recording:
            raise RuntimeError("Recording already in progress")

        logger.info(f"Starting Playwright recording for session {self.test_session.id}")

        try:
            # Get CDP endpoint
            cdp_url = await _get_cdp_endpoint(self.browser_session)
            if not cdp_url:
                raise RuntimeError(f"Browser session {self.browser_session.id} has no CDP URL")

            logger.info(f"Connecting Playwright to CDP: {cdp_url}")

            # Connect via Playwright
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.connect_over_cdp(cdp_url)

            # Get the default context and page
            contexts = self._browser.contexts
            if not contexts:
                raise RuntimeError("No browser context available")

            self._context = contexts[0]
            pages = self._context.pages

            if not pages:
                raise RuntimeError("No page available in browser context")

            self._page = pages[0]
            logger.info(f"Connected to page: {self._page.url}")

            # Set up recording
            await self._setup_recording()

            # Update state
            self._is_recording = True
            self._state = RecordingState(
                test_session_id=self.test_session.id,
                browser_session_id=self.browser_session.id,
                started_at=datetime.utcnow(),
                steps_recorded=0,
            )

            # Register in global registry
            _active_playwright_recordings[self.test_session.id] = self

            logger.info(f"Playwright recording started for session {self.test_session.id}")
            return self._state

        except Exception as e:
            logger.error(f"Failed to start Playwright recording: {e}")
            await self._cleanup()
            raise

    async def stop(self) -> RecordingState:
        """
        Stop recording and cleanup.

        Returns:
            Final RecordingState
        """
        logger.info(f"Stopping Playwright recording for session {self.test_session.id}")

        # Get final state
        final_state = self._state
        if final_state:
            final_state.is_active = False

        # Cleanup
        await self._cleanup()

        # Remove from registry
        if self.test_session.id in _active_playwright_recordings:
            del _active_playwright_recordings[self.test_session.id]

        logger.info(f"Playwright recording stopped. Total steps: {final_state.steps_recorded if final_state else 0}")
        return final_state or RecordingState(
            test_session_id=self.test_session.id,
            browser_session_id=self.browser_session.id,
            started_at=datetime.utcnow(),
            is_active=False,
        )

    def get_status(self) -> RecordingState | None:
        """Get current recording status."""
        return self._state

    async def _setup_recording(self) -> None:
        """Set up event capture using Playwright's expose_function."""
        if not self._page:
            raise RuntimeError("Page not connected")

        # Expose callback function to JavaScript
        await self._page.expose_function(self.CALLBACK_NAME, self._on_action_recorded)

        # Inject recording script
        await self._page.add_init_script(RECORDING_SCRIPT)

        # Also evaluate immediately for current page
        await self._page.evaluate(RECORDING_SCRIPT)

        logger.info("Playwright recording script injected")

    async def _on_action_recorded(self, payload_str: str) -> None:
        """Handle events from the injected JavaScript."""
        try:
            payload = json.loads(payload_str)
            event_type = payload.get("type")

            logger.debug(f"Playwright recording received event: {event_type}")

            if event_type == "click":
                await self._handle_click(payload)
            elif event_type == "input":
                await self._handle_input(payload)
            elif event_type == "select":
                await self._handle_select(payload)
            elif event_type == "keypress":
                await self._handle_keypress(payload)
            elif event_type == "scroll":
                await self._handle_scroll(payload)
            else:
                logger.warning(f"Unknown event type: {event_type}")

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse event payload: {e}")
        except Exception as e:
            logger.error(f"Error handling Playwright recording event: {e}", exc_info=True)

    async def _handle_click(self, payload: dict[str, Any]) -> None:
        """Handle click event."""
        element_data = payload.get("element", {})
        element_info = self._parse_element_info(element_data)

        await self._create_recorded_step(
            action_name="click_element",
            action_params={
                "x": element_info.x,
                "y": element_info.y,
            },
            element_info=element_info,
        )

    async def _handle_input(self, payload: dict[str, Any]) -> None:
        """Handle input event (blur-based, contains final value)."""
        element_data = payload.get("element", {})
        element_info = self._parse_element_info(element_data)

        await self._create_recorded_step(
            action_name="type_text",
            action_params={
                "text": payload.get("value", ""),
            },
            element_info=element_info,
        )

    async def _handle_select(self, payload: dict[str, Any]) -> None:
        """Handle select/dropdown event."""
        element_data = payload.get("element", {})
        element_info = self._parse_element_info(element_data)

        await self._create_recorded_step(
            action_name="select_option",
            action_params={
                "value": payload.get("value", ""),
                "text": payload.get("selectedText", ""),
            },
            element_info=element_info,
        )

    async def _handle_keypress(self, payload: dict[str, Any]) -> None:
        """Handle keyboard event."""
        element_data = payload.get("element", {})
        element_info = self._parse_element_info(element_data)

        # Build key description
        key = payload.get("key", "")
        modifiers = []
        if payload.get("ctrlKey"):
            modifiers.append("Ctrl")
        if payload.get("altKey"):
            modifiers.append("Alt")
        if payload.get("shiftKey"):
            modifiers.append("Shift")
        if payload.get("metaKey"):
            modifiers.append("Meta")

        key_combo = "+".join(modifiers + [key]) if modifiers else key

        await self._create_recorded_step(
            action_name="press_key",
            action_params={
                "key": key,
                "key_combo": key_combo,
                "ctrl": payload.get("ctrlKey", False),
                "alt": payload.get("altKey", False),
                "shift": payload.get("shiftKey", False),
                "meta": payload.get("metaKey", False),
            },
            element_info=element_info,
        )

    async def _handle_scroll(self, payload: dict[str, Any]) -> None:
        """Handle scroll event."""
        await self._create_recorded_step(
            action_name="scroll",
            action_params={
                "scroll_x": payload.get("scrollX", 0),
                "scroll_y": payload.get("scrollY", 0),
            },
            element_info=None,
        )

    def _parse_element_info(self, element_data: dict[str, Any]) -> ElementInfo:
        """Parse element data from JavaScript into ElementInfo."""
        return ElementInfo(
            xpath=element_data.get("xpath"),
            css_selector=element_data.get("cssSelector"),
            tag_name=element_data.get("tagName", "unknown"),
            text_content=element_data.get("textContent"),
            aria_label=element_data.get("ariaLabel"),
            role=element_data.get("role"),
            id=element_data.get("id"),
            name=element_data.get("name"),
            placeholder=element_data.get("placeholder"),
            classes=element_data.get("classes", []),
            x=element_data.get("x", 0),
            y=element_data.get("y", 0),
        )

    async def _create_recorded_step(
        self,
        action_name: str,
        action_params: dict[str, Any],
        element_info: ElementInfo | None,
    ) -> TestStep:
        """Create a TestStep + StepAction for a recorded user action."""

        # Increment step number
        self._current_step_number += 1
        step_number = self._current_step_number

        logger.info(f"Playwright recording step {step_number}: {action_name}")

        # Get current URL and title from page (Playwright handles this cleanly)
        url = None
        title = None
        try:
            url = self._page.url if self._page else None
            title = await self._page.title() if self._page else None
        except Exception as e:
            logger.debug(f"Could not get URL/title: {e}")

        # Take screenshot
        screenshot_filename = await self._take_screenshot(step_number)

        # Build description
        element_desc = ""
        if element_info:
            if element_info.aria_label:
                element_desc = f" on '{element_info.aria_label}'"
            elif element_info.text_content:
                text_preview = element_info.text_content[:30]
                element_desc = f" on '{text_preview}'"
            elif element_info.id:
                element_desc = f" on #{element_info.id}"

        if action_name == "type_text":
            next_goal = f"User typed: {action_params.get('text', '')[:50]}"
        elif action_name == "click_element":
            next_goal = f"User clicked{element_desc}"
        elif action_name == "select_option":
            next_goal = f"User selected '{action_params.get('text', '')}'{element_desc}"
        elif action_name == "press_key":
            next_goal = f"User pressed {action_params.get('key_combo', action_params.get('key', ''))}"
        elif action_name == "scroll":
            next_goal = f"User scrolled to ({action_params.get('scroll_x', 0)}, {action_params.get('scroll_y', 0)})"
        else:
            next_goal = f"User action: {action_name}"

        try:
            logger.info(f"Playwright step {step_number}: Saving to database...")

            # Create TestStep
            test_step = TestStep(
                session_id=self.test_session.id,
                step_number=step_number,
                url=url,
                page_title=title,
                thinking=None,
                evaluation=None,
                memory=None,
                next_goal=next_goal,
                screenshot_path=screenshot_filename,
                status="completed",
            )

            self.db.add(test_step)
            self.db.flush()

            # Create StepAction with rich element context
            step_action = StepAction(
                step_id=test_step.id,
                action_index=0,
                action_name=action_name,
                action_params={
                    **action_params,
                    "source": "user",
                    "recording_mode": "playwright",
                    "element_context": element_info.to_element_context_dict() if element_info else None,
                    "raw_element_info": element_info.to_dict() if element_info else None,
                },
                result_success=True,
                element_xpath=element_info.xpath if element_info else None,
                element_name=(
                    element_info.aria_label
                    or (element_info.text_content[:50] if element_info and element_info.text_content else None)
                ) if element_info else None,
            )

            self.db.add(step_action)
            self.db.commit()

            # Update state
            if self._state:
                self._state.steps_recorded += 1

            logger.info(f"Playwright step {step_number} recorded: {action_name}")
            return test_step

        except Exception as e:
            logger.error(f"Failed to save Playwright recorded step {step_number}: {e}", exc_info=True)
            self.db.rollback()
            raise

    async def _take_screenshot(self, step_number: int) -> str | None:
        """Take a screenshot and save it to disk."""
        if not self._page:
            return None

        try:
            # Generate filename
            filename = f"{self.test_session.id}_{step_number}.png"

            # Ensure screenshots directory exists
            screenshots_dir = Path(settings.SCREENSHOTS_DIR)
            screenshots_dir.mkdir(parents=True, exist_ok=True)

            # Save screenshot
            filepath = screenshots_dir / filename
            await self._page.screenshot(path=str(filepath))

            logger.debug(f"Playwright screenshot saved: {filename}")
            return filename

        except Exception as e:
            logger.warning(f"Playwright screenshot failed: {e}")
            return None

    async def _cleanup(self) -> None:
        """Cleanup resources."""
        self._is_recording = False

        # Disconnect from browser (don't close it, just disconnect)
        if self._browser:
            try:
                # Note: We're using connect_over_cdp, so close() just disconnects
                await self._browser.close()
            except Exception as e:
                logger.warning(f"Error closing Playwright browser connection: {e}")
            self._browser = None

        # Stop playwright
        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception as e:
                logger.warning(f"Error stopping Playwright: {e}")
            self._playwright = None

        self._context = None
        self._page = None
