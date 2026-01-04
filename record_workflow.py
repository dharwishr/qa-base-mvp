#!/usr/bin/env python3
"""
Simple workflow recorder using browser_use.

Usage:
    python record_workflow.py [--url https://example.com] [--output workflow.json]

This script:
1. Launches a browser using browser_use
2. Connects via CDP to inject recording scripts
3. Records user clicks, inputs, and navigation
4. Saves the workflow as JSON when you press Ctrl+C
"""

import asyncio
import json
import signal
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any

# Add parent dir to path to import local browser_use
sys.path.insert(0, str(Path(__file__).parent))

from browser_use.browser.session import BrowserSession
from browser_use.browser.profile import BrowserProfile


@dataclass
class RecordedAction:
    """A single recorded browser action."""
    action_type: str  # click, input, select, navigate, scroll, keypress
    timestamp: str
    url: str
    page_title: str
    # Element info
    xpath: str | None = None
    css_selector: str | None = None
    tag_name: str | None = None
    text_content: str | None = None
    aria_label: str | None = None
    element_id: str | None = None
    element_name: str | None = None
    placeholder: str | None = None
    # Action-specific data
    input_value: str | None = None
    click_x: int | None = None
    click_y: int | None = None
    key: str | None = None
    scroll_x: int | None = None
    scroll_y: int | None = None


@dataclass
class Workflow:
    """A recorded workflow containing multiple actions."""
    name: str
    start_url: str
    recorded_at: str
    actions: list[RecordedAction] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "start_url": self.start_url,
            "recorded_at": self.recorded_at,
            "actions": [asdict(a) for a in self.actions]
        }

    def save(self, path: str | Path):
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=2)
        print(f"\n✓ Workflow saved to {path}")


# JavaScript to inject for recording
RECORDING_SCRIPT = """
(function() {
    if (window.__workflowRecorderInstalled) return;
    window.__workflowRecorderInstalled = true;

    function getXPath(element) {
        if (!element) return null;
        if (element.id) return '//*[@id="' + element.id + '"]';
        if (element === document.body) return '/html/body';

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
            const part = index > 0 ? tagName + '[' + (index + 1) + ']' : tagName;
            parts.unshift(part);
            element = element.parentElement;
        }
        return '/' + parts.join('/');
    }

    function getCssSelector(element) {
        if (!element) return null;
        if (element.id) return '#' + element.id;

        let path = [];
        while (element && element.nodeType === 1) {
            let selector = element.tagName.toLowerCase();
            if (element.className && typeof element.className === 'string') {
                const classes = element.className.trim().split(/\\s+/).filter(c => c && !c.includes(':'));
                if (classes.length > 0) {
                    selector += '.' + classes.slice(0, 2).join('.');
                }
            }
            path.unshift(selector);
            element = element.parentElement;
            if (path.length > 4) break;
        }
        return path.join(' > ');
    }

    function getElementInfo(element, x, y) {
        if (!element) return {};
        const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : {x:0,y:0,width:0,height:0};
        return {
            xpath: getXPath(element),
            css_selector: getCssSelector(element),
            tag_name: element.tagName ? element.tagName.toLowerCase() : 'unknown',
            text_content: (element.textContent || '').trim().substring(0, 100),
            aria_label: element.getAttribute ? element.getAttribute('aria-label') : null,
            element_id: element.id || null,
            element_name: element.name || null,
            placeholder: element.placeholder || null,
            x: x || Math.round(rect.x),
            y: y || Math.round(rect.y)
        };
    }

    // Click handler
    document.addEventListener('click', function(e) {
        const info = getElementInfo(e.target, e.clientX, e.clientY);
        window.__recordWorkflowAction(JSON.stringify({
            action_type: 'click',
            ...info,
            click_x: e.clientX,
            click_y: e.clientY
        }));
    }, true);

    // Input handler (on blur to capture final value)
    document.addEventListener('blur', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            const info = getElementInfo(e.target, 0, 0);
            if (e.target.value) {
                window.__recordWorkflowAction(JSON.stringify({
                    action_type: 'input',
                    ...info,
                    input_value: e.target.type === 'password' ? '***' : e.target.value
                }));
            }
        }
    }, true);

    // Select change handler
    document.addEventListener('change', function(e) {
        if (e.target.tagName === 'SELECT') {
            const info = getElementInfo(e.target, 0, 0);
            const selectedOption = e.target.options[e.target.selectedIndex];
            window.__recordWorkflowAction(JSON.stringify({
                action_type: 'select',
                ...info,
                input_value: e.target.value,
                text_content: selectedOption ? selectedOption.text : e.target.value
            }));
        }
    }, true);

    // Keyboard handler for special keys
    document.addEventListener('keydown', function(e) {
        if (['Enter', 'Escape', 'Tab', 'Backspace', 'Delete'].includes(e.key) || e.ctrlKey || e.metaKey) {
            const info = getElementInfo(e.target, 0, 0);
            window.__recordWorkflowAction(JSON.stringify({
                action_type: 'keypress',
                ...info,
                key: e.key
            }));
        }
    }, true);

    // Scroll handler (debounced)
    let scrollTimeout = null;
    document.addEventListener('scroll', function(e) {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(function() {
            window.__recordWorkflowAction(JSON.stringify({
                action_type: 'scroll',
                scroll_x: Math.round(window.scrollX),
                scroll_y: Math.round(window.scrollY)
            }));
        }, 300);
    }, true);

    console.log('[Workflow Recorder] Recording started...');
})();
"""


class WorkflowRecorder:
    """Records browser actions into a workflow using CDP."""

    BINDING_NAME = "__recordWorkflowAction"

    def __init__(self, start_url: str = "https://example.com", workflow_name: str = "Recorded Workflow"):
        self.start_url = start_url
        self.workflow = Workflow(
            name=workflow_name,
            start_url=start_url,
            recorded_at=datetime.now().isoformat()
        )
        self.browser_session: BrowserSession | None = None
        self._stop_event = asyncio.Event()
        self._current_url = start_url
        self._current_title = ""
        self._session_id: str | None = None

    async def _on_binding_called(self, event: dict[str, Any], session_id: str | None = None) -> None:
        """Handle events from the injected JavaScript."""
        try:
            binding_name = event.get("name")
            if binding_name != self.BINDING_NAME:
                return

            payload_str = event.get("payload", "{}")
            action_data = json.loads(payload_str)

            action = RecordedAction(
                action_type=action_data.get("action_type", "unknown"),
                timestamp=datetime.now().isoformat(),
                url=self._current_url,
                page_title=self._current_title,
                xpath=action_data.get("xpath"),
                css_selector=action_data.get("css_selector"),
                tag_name=action_data.get("tag_name"),
                text_content=action_data.get("text_content"),
                aria_label=action_data.get("aria_label"),
                element_id=action_data.get("element_id"),
                element_name=action_data.get("element_name"),
                placeholder=action_data.get("placeholder"),
                input_value=action_data.get("input_value"),
                click_x=action_data.get("click_x"),
                click_y=action_data.get("click_y"),
                key=action_data.get("key"),
                scroll_x=action_data.get("scroll_x"),
                scroll_y=action_data.get("scroll_y"),
            )
            self.workflow.actions.append(action)

            # Pretty print the action
            action_desc = action.action_type
            if action.tag_name:
                action_desc += f" on <{action.tag_name}>"
            if action.text_content:
                text = action.text_content[:30] + "..." if len(action.text_content) > 30 else action.text_content
                action_desc += f" '{text}'"
            if action.input_value:
                action_desc += f" = '{action.input_value}'"
            if action.key:
                action_desc += f" [{action.key}]"

            print(f"  → Recorded: {action_desc}")

        except Exception as e:
            print(f"  ⚠ Error handling action: {e}")

    async def _inject_recording_script(self) -> None:
        """Inject the recording script via CDP."""
        if not self.browser_session or not self._session_id:
            return

        cdp_client = self.browser_session.cdp_client

        # Add script to evaluate on new documents (for navigation)
        await cdp_client.send.Page.addScriptToEvaluateOnNewDocument(
            params={"source": RECORDING_SCRIPT},
            session_id=self._session_id,
        )

        # Also evaluate immediately for current page
        await cdp_client.send.Runtime.evaluate(
            params={"expression": RECORDING_SCRIPT},
            session_id=self._session_id,
        )

        print("  ✓ Recording script injected")

    async def _setup_recording(self) -> None:
        """Set up CDP binding and inject recording script."""
        if not self.browser_session:
            raise RuntimeError("Browser not connected")

        # Get the current page and session
        page = await self.browser_session.get_current_page()
        if not page:
            raise RuntimeError("No page available")

        self._session_id = await page.session_id
        cdp_client = self.browser_session.cdp_client

        # Add binding for JavaScript callback
        print("  Setting up CDP binding...")
        await cdp_client.send.Runtime.addBinding(
            params={"name": self.BINDING_NAME},
            session_id=self._session_id,
        )

        # Register handler for binding calls
        cdp_client.register.Runtime.bindingCalled(self._on_binding_called)

        # Inject recording script
        await self._inject_recording_script()

    async def start(self):
        """Start recording browser actions."""
        print("\n" + "=" * 60)
        print("  WORKFLOW RECORDER (using browser_use)")
        print("=" * 60)
        print(f"\n  Starting URL: {self.start_url}")
        print("  Press Ctrl+C to stop recording and save the workflow\n")

        # Create browser profile
        profile = BrowserProfile(
            headless=False,
            disable_security=True,
        )

        # Create and start browser session
        self.browser_session = BrowserSession(browser_profile=profile)
        await self.browser_session.start()

        print("  ✓ Browser launched")

        # Navigate to start URL
        page = await self.browser_session.get_current_page()
        if page:
            await page.goto(self.start_url)
            await asyncio.sleep(2)  # Wait for page to load
            self._current_url = self.start_url
            self._current_title = await self.browser_session.get_current_page_title()
            print(f"  ✓ Navigated to {self.start_url}")

        # Set up recording
        await self._setup_recording()

        # Record initial navigation action
        self.workflow.actions.append(RecordedAction(
            action_type="navigate",
            timestamp=datetime.now().isoformat(),
            url=self.start_url,
            page_title=self._current_title
        ))

        print("\n  Recording... Interact with the browser.\n")
        print("-" * 60)

        # Keep running until stopped
        try:
            while not self._stop_event.is_set():
                await asyncio.sleep(0.5)

                # Update current URL on navigation
                if self.browser_session:
                    try:
                        new_url = await self.browser_session.get_current_page_url()
                        if new_url and new_url != self._current_url and new_url != "about:blank":
                            self._current_url = new_url
                            self._current_title = await self.browser_session.get_current_page_title()

                            # Record navigation
                            self.workflow.actions.append(RecordedAction(
                                action_type="navigate",
                                timestamp=datetime.now().isoformat(),
                                url=new_url,
                                page_title=self._current_title
                            ))
                            print(f"  → Recorded: navigate to {new_url}")
                    except Exception:
                        pass

        except asyncio.CancelledError:
            pass

    async def stop(self):
        """Stop recording and cleanup."""
        self._stop_event.set()

        if self.browser_session:
            await self.browser_session.stop()

        print("-" * 60)
        print(f"\n  ✓ Recording stopped. Captured {len(self.workflow.actions)} actions.\n")

    def save_workflow(self, output_path: str = "workflow.json"):
        """Save the workflow to a JSON file."""
        self.workflow.save(output_path)


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Record browser actions into a workflow")
    parser.add_argument("--url", default="https://example.com", help="Starting URL")
    parser.add_argument("--output", "-o", default="workflow.json", help="Output file path")
    parser.add_argument("--name", "-n", default="Recorded Workflow", help="Workflow name")
    args = parser.parse_args()

    recorder = WorkflowRecorder(start_url=args.url, workflow_name=args.name)

    # Handle Ctrl+C gracefully
    loop = asyncio.get_event_loop()

    def signal_handler():
        print("\n\n  Stopping recorder...")
        asyncio.create_task(recorder.stop())

    loop.add_signal_handler(signal.SIGINT, signal_handler)

    try:
        await recorder.start()
    except Exception as e:
        print(f"\n  Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await recorder.stop()
        recorder.save_workflow(args.output)


if __name__ == "__main__":
    asyncio.run(main())
