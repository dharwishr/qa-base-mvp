"""
User Recording Service - Captures user interactions from live browser sessions via CDP.

Features:
- Connects to existing browser session via CDP
- Injects JavaScript event listeners to capture user interactions
- Records actions as TestStep + StepAction records
- Takes screenshots after each action
- Supports: clicks, typing, keyboard shortcuts, dropdowns, scrolling, hover
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
from typing import Any, Callable

import aiohttp
from browser_use.browser.session import BrowserSession
from browser_use.actor.page import Page
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import StepAction, TestSession, TestStep
from app.services.browser_orchestrator import BrowserSession as OrchestratorSession

logger = logging.getLogger(__name__)


async def _get_cdp_ws_url(browser_session: OrchestratorSession) -> str | None:
    """
    Fetch fresh CDP WebSocket URL from the browser's /json/version endpoint.
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
                        logger.info(f"Got CDP WebSocket URL: {fresh_url}")
                        return fresh_url
    except Exception as e:
        logger.warning(f"Error getting CDP URL: {e}")

    return None


@dataclass
class ElementInfo:
    """Information about a DOM element captured during user interaction."""

    xpath: str | None = None
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
        """Convert to dictionary for JSON serialization.

        Returns all fields including extra context for debugging.
        """
        return {
            "xpath": self.xpath,
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
        """Convert to dictionary compatible with ElementContext model.

        Only includes fields that ElementContext expects for replay.
        """
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


# Global registry of active recordings
_active_recordings: dict[str, "UserRecordingService"] = {}


def get_active_recording(test_session_id: str) -> "UserRecordingService | None":
    """Get active recording for a test session."""
    return _active_recordings.get(test_session_id)


class UserRecordingService:
    """
    Captures user interactions from a live browser session via CDP events.

    Uses CDP's Runtime.addBinding to inject JavaScript that captures DOM events
    and reports them back for recording as test steps.
    """

    # Binding name for the recording callback
    BINDING_NAME = "__qaRecordAction"

    # Debounce settings
    INPUT_DEBOUNCE_MS = 500
    SCROLL_DEBOUNCE_MS = 500

    def __init__(
        self,
        db: Session,
        test_session: TestSession,
        browser_session: OrchestratorSession,
    ):
        # Store IDs as strings to avoid detached session issues
        self._test_session_id = test_session.id
        self._browser_session_id = browser_session.id
        
        # Store browser session info needed for CDP connection
        self._browser_session_container_ip = browser_session.container_ip
        self._browser_session_cdp_host = browser_session.cdp_host
        self._browser_session_cdp_port = browser_session.cdp_port
        
        self._browser: BrowserSession | None = None
        self._session_id: str | None = None
        self._target_id: str | None = None
        self._page: Page | None = None
        self._current_step_number = 0
        self._is_recording = False
        self._state: RecordingState | None = None
        self._binding_registered = False
        self._script_injected = False
        self._pending_input: dict[str, Any] | None = None
        self._input_debounce_task: asyncio.Task | None = None
        self._pending_scroll: dict[str, Any] | None = None
        self._scroll_debounce_task: asyncio.Task | None = None

        # Get current max step number
        existing_steps = db.query(TestStep).filter(
            TestStep.session_id == test_session.id
        ).order_by(TestStep.step_number.desc()).first()

        if existing_steps:
            self._current_step_number = existing_steps.step_number

    async def _get_cdp_ws_url(self) -> str | None:
        """Get CDP WebSocket URL using stored session info."""
        running_in_docker = os.path.exists("/.dockerenv")

        if running_in_docker and self._browser_session_container_ip:
            check_host = self._browser_session_container_ip
            check_port = 9222
        elif self._browser_session_cdp_port:
            check_host = self._browser_session_cdp_host
            check_port = self._browser_session_cdp_port
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
                            if running_in_docker and self._browser_session_container_ip:
                                fresh_url = re.sub(
                                    r'ws://[^/]+',
                                    f'ws://{self._browser_session_container_ip}:9222',
                                    ws_url
                                )
                            else:
                                fresh_url = re.sub(
                                    r'ws://[^/]+',
                                    f'ws://{self._browser_session_cdp_host}:{self._browser_session_cdp_port}',
                                    ws_url
                                )
                            logger.info(f"Got CDP WebSocket URL: {fresh_url}")
                            return fresh_url
        except Exception as e:
            logger.warning(f"Error getting CDP URL: {e}")

        return None

    async def start(self) -> RecordingState:
        """
        Start recording by connecting to the browser and setting up event capture.

        Returns:
            RecordingState with recording session info
        """
        if self._is_recording:
            raise RuntimeError("Recording already in progress")

        logger.info(f"Starting user recording for session {self._test_session_id}")

        try:
            # Connect to browser via CDP - fetch fresh URL from /json/version
            cdp_url = await self._get_cdp_ws_url()
            if not cdp_url:
                raise RuntimeError(f"Browser session {self._browser_session_id} has no CDP URL - browser may not be ready")

            logger.info(f"Connecting to CDP at: {cdp_url}")

            # Create BrowserSession connected to existing browser
            self._browser = BrowserSession(cdp_url=cdp_url)
            await self._browser.start()

            # Get the current page target and create a Page actor
            self._target_id = self._browser.agent_focus_target_id
            if not self._target_id:
                raise RuntimeError("Failed to get browser target ID")

            cdp_session = await self._browser.get_or_create_cdp_session(
                target_id=self._target_id, focus=True
            )
            self._session_id = cdp_session.session_id
            self._page = Page(self._browser, self._target_id, self._session_id)

            logger.info(f"Connected to page with session ID: {self._session_id}")

            # Set up recording
            await self._setup_recording()

            # Update state
            self._is_recording = True
            self._state = RecordingState(
                test_session_id=self._test_session_id,
                browser_session_id=self._browser_session_id,
                started_at=datetime.utcnow(),
                steps_recorded=0,
            )

            # Register in global registry
            _active_recordings[self._test_session_id] = self

            logger.info(f"User recording started for session {self._test_session_id}")
            return self._state

        except Exception as e:
            logger.error(f"Failed to start recording: {e}")
            await self._cleanup()
            raise

    async def stop(self) -> RecordingState:
        """
        Stop recording and cleanup.

        Returns:
            Final RecordingState
        """
        logger.info(f"Stopping user recording for session {self._test_session_id}")

        # Flush any pending debounced events
        await self._flush_pending_events()

        # Get final state
        final_state = self._state
        if final_state:
            final_state.is_active = False

        # Cleanup
        await self._cleanup()

        # Remove from registry
        if self._test_session_id in _active_recordings:
            del _active_recordings[self._test_session_id]

        logger.info(f"User recording stopped. Total steps: {final_state.steps_recorded if final_state else 0}")
        return final_state or RecordingState(
            test_session_id=self._test_session_id,
            browser_session_id=self._browser_session_id,
            started_at=datetime.utcnow(),
            is_active=False,
        )

    def get_status(self) -> RecordingState | None:
        """Get current recording status."""
        return self._state

    async def _setup_recording(self) -> None:
        """Set up CDP binding and inject recording script."""
        if not self._page or not self._session_id:
            raise RuntimeError("Browser not connected")

        cdp_client = self._page._client

        # Add binding for JavaScript callback
        logger.debug(f"Adding CDP binding: {self.BINDING_NAME}")
        await cdp_client.send.Runtime.addBinding(
            params={"name": self.BINDING_NAME},
            session_id=self._session_id,
        )
        self._binding_registered = True

        # Register handler for binding calls (not async)
        cdp_client.register.Runtime.bindingCalled(
            self._on_binding_called,
        )

        # Inject recording script
        await self._inject_recording_script()

    async def _inject_recording_script(self) -> None:
        """Inject JavaScript that captures user events."""
        if not self._page or not self._session_id:
            return

        cdp_client = self._page._client

        script = '''
        (function() {
            if (window.__qaRecorderActive) return;
            window.__qaRecorderActive = true;

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

            // Extract element info
            function getElementInfo(target, x, y) {
                return {
                    xpath: getXPath(target),
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
                window.__qaRecordAction(JSON.stringify(info));
            }, true);

            // Input handler (debounced on backend)
            document.addEventListener('input', function(e) {
                const target = e.target;
                if (!['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

                const info = {
                    type: 'input',
                    element: getElementInfo(target, 0, 0),
                    value: target.value,
                    timestamp: Date.now(),
                };
                window.__qaRecordAction(JSON.stringify(info));
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
                window.__qaRecordAction(JSON.stringify(info));
            }, true);

            // Keyboard handler for special keys
            document.addEventListener('keydown', function(e) {
                // Only capture Enter, Tab, Escape, or modifier combos
                const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete'];
                if (!specialKeys.includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
                window.__qaRecordAction(JSON.stringify(info));
            }, true);

            // Scroll handler (debounced on backend)
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
                    window.__qaRecordAction(JSON.stringify(info));
                }, 300);
            }, true);

            console.log('[QA Recording] Event listeners installed');
        })();
        '''

        # Add script to evaluate on new documents (for navigation)
        await cdp_client.send.Page.addScriptToEvaluateOnNewDocument(
            params={"source": script},
            session_id=self._session_id,
        )

        # Also evaluate immediately for current page
        await cdp_client.send.Runtime.evaluate(
            params={"expression": script},
            session_id=self._session_id,
        )

        self._script_injected = True
        logger.info("Recording script injected successfully")

    async def _on_binding_called(self, event: dict[str, Any], session_id: str | None = None) -> None:
        """Handle events from the injected JavaScript."""
        try:
            binding_name = event.get("name")
            if binding_name != self.BINDING_NAME:
                return

            payload_str = event.get("payload", "{}")
            payload = json.loads(payload_str)
            event_type = payload.get("type")

            logger.debug(f"Received event: {event_type}")

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
            logger.error(f"Error handling event: {e}", exc_info=True)

    async def _handle_click(self, payload: dict[str, Any]) -> None:
        """Handle click event."""
        element_data = payload.get("element", {})
        element_info = ElementInfo(
            xpath=element_data.get("xpath"),
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

        await self._create_recorded_step(
            action_name="click_element",
            action_params={
                "x": element_info.x,
                "y": element_info.y,
            },
            element_info=element_info,
        )

    async def _handle_input(self, payload: dict[str, Any]) -> None:
        """Handle input event with debouncing."""
        # Store pending input and reset debounce timer
        self._pending_input = payload

        if self._input_debounce_task:
            self._input_debounce_task.cancel()

        self._input_debounce_task = asyncio.create_task(
            self._flush_input_after_debounce()
        )

    async def _flush_input_after_debounce(self) -> None:
        """Flush pending input after debounce period."""
        await asyncio.sleep(self.INPUT_DEBOUNCE_MS / 1000)

        if self._pending_input:
            payload = self._pending_input
            self._pending_input = None

            element_data = payload.get("element", {})
            element_info = ElementInfo(
                xpath=element_data.get("xpath"),
                tag_name=element_data.get("tagName", "unknown"),
                text_content=element_data.get("textContent"),
                aria_label=element_data.get("ariaLabel"),
                role=element_data.get("role"),
                id=element_data.get("id"),
                name=element_data.get("name"),
                placeholder=element_data.get("placeholder"),
                classes=element_data.get("classes", []),
            )

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
        element_info = ElementInfo(
            xpath=element_data.get("xpath"),
            tag_name=element_data.get("tagName", "unknown"),
            text_content=element_data.get("textContent"),
            aria_label=element_data.get("ariaLabel"),
            role=element_data.get("role"),
            id=element_data.get("id"),
            name=element_data.get("name"),
            placeholder=element_data.get("placeholder"),
            classes=element_data.get("classes", []),
        )

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
        element_info = ElementInfo(
            xpath=element_data.get("xpath"),
            tag_name=element_data.get("tagName", "unknown"),
            text_content=element_data.get("textContent"),
            aria_label=element_data.get("ariaLabel"),
            role=element_data.get("role"),
            id=element_data.get("id"),
            name=element_data.get("name"),
            placeholder=element_data.get("placeholder"),
            classes=element_data.get("classes", []),
        )

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
        """Handle scroll event with debouncing."""
        # Store pending scroll
        self._pending_scroll = payload

        if self._scroll_debounce_task:
            self._scroll_debounce_task.cancel()

        self._scroll_debounce_task = asyncio.create_task(
            self._flush_scroll_after_debounce()
        )

    async def _flush_scroll_after_debounce(self) -> None:
        """Flush pending scroll after debounce period."""
        await asyncio.sleep(self.SCROLL_DEBOUNCE_MS / 1000)

        if self._pending_scroll:
            payload = self._pending_scroll
            self._pending_scroll = None

            await self._create_recorded_step(
                action_name="scroll",
                action_params={
                    "scroll_x": payload.get("scrollX", 0),
                    "scroll_y": payload.get("scrollY", 0),
                },
                element_info=None,
            )

    async def _flush_pending_events(self) -> None:
        """Flush any pending debounced events."""
        if self._input_debounce_task:
            self._input_debounce_task.cancel()
            if self._pending_input:
                await self._flush_input_after_debounce()

        if self._scroll_debounce_task:
            self._scroll_debounce_task.cancel()
            if self._pending_scroll:
                await self._flush_scroll_after_debounce()

    async def _create_recorded_step(
        self,
        action_name: str,
        action_params: dict[str, Any],
        element_info: ElementInfo | None,
    ) -> TestStep:
        """Create a TestStep + StepAction for a recorded user action.
        
        Uses a fresh database session to avoid detached instance issues
        when called asynchronously from the CDP callback.
        """

        # Increment step number
        self._current_step_number += 1
        step_number = self._current_step_number

        logger.info(f"Recording step {step_number}: {action_name}")

        # Skip URL/title/screenshot for user-recorded steps to avoid CDP conflicts
        # The user is watching the live browser anyway, so these aren't critical
        url = None
        title = None
        screenshot_filename = None

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

        # Create a fresh database session for this async callback
        db = SessionLocal()
        try:
            logger.info(f"Step {step_number}: Saving to database...")
            # Create TestStep
            test_step = TestStep(
                session_id=self._test_session_id,
                step_number=step_number,
                url=url,
                page_title=title,
                thinking=None,  # No AI thinking for user actions
                evaluation=None,
                memory=None,
                next_goal=next_goal,
                screenshot_path=screenshot_filename,
                status="completed",
            )

            db.add(test_step)
            db.flush()

            # Create StepAction with rich element context
            # Use element_context_dict for replay compatibility, store full info separately
            step_action = StepAction(
                step_id=test_step.id,
                action_index=0,
                action_name=action_name,
                action_params={
                    **action_params,
                    "source": "user",  # Mark as user-recorded
                    "recording_mode": "cdp",
                    "element_context": element_info.to_element_context_dict() if element_info else None,
                    "raw_element_info": element_info.to_dict() if element_info else None,  # Full info for debugging
                },
                result_success=True,
                element_xpath=element_info.xpath if element_info else None,
                element_name=(
                    element_info.aria_label
                    or (element_info.text_content[:50] if element_info and element_info.text_content else None)
                ) if element_info else None,
            )

            db.add(step_action)
            db.commit()

            # Update state
            if self._state:
                self._state.steps_recorded += 1

            logger.info(f"Step {step_number} recorded: {action_name}")
            return test_step

        except Exception as e:
            logger.error(f"Failed to save recorded step {step_number}: {e}", exc_info=True)
            db.rollback()
            raise
        finally:
            db.close()

    async def _take_screenshot(self, step_number: int) -> str | None:
        """Take a screenshot and save it to disk."""
        if not self._page or not self._session_id:
            return None

        try:
            cdp_client = self._page._client

            # Capture screenshot via CDP
            result = await cdp_client.send.Page.captureScreenshot(
                params={"format": "png"},
                session_id=self._session_id,
            )

            screenshot_data = result.get("data")
            if not screenshot_data:
                return None

            # Generate filename
            filename = f"{self._test_session_id}_{step_number}.png"

            # Ensure screenshots directory exists
            screenshots_dir = Path(settings.SCREENSHOTS_DIR)
            screenshots_dir.mkdir(parents=True, exist_ok=True)

            # Save to file
            filepath = screenshots_dir / filename
            with open(filepath, "wb") as f:
                f.write(base64.b64decode(screenshot_data))

            logger.debug(f"Screenshot saved: {filename}")
            return filename

        except Exception as e:
            logger.error(f"Screenshot failed: {e}")
            return None

    async def _cleanup(self) -> None:
        """Cleanup resources."""
        self._is_recording = False

        # Cancel any pending tasks
        if self._input_debounce_task:
            self._input_debounce_task.cancel()
        if self._scroll_debounce_task:
            self._scroll_debounce_task.cancel()

        # Close browser session (we're just disconnecting, not stopping the browser)
        if self._browser:
            try:
                # Don't stop the browser, just disconnect our CDP connection
                await self._browser.stop()
            except Exception as e:
                logger.warning(f"Error closing browser session: {e}")
            self._browser = None

        self._session_id = None
        self._target_id = None
        self._page = None
        self._binding_registered = False
        self._script_injected = False
