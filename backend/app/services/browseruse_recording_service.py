"""
Browser-Use Recording Service - Extension-style recording using semantic selectors.

This is inspired by browser-use/workflow-use recording approach:
- Semantic selector generation (multiple strategies for self-healing)
- Action intent detection (what the user is trying to accomplish)
- Grouped logical actions (form fills, navigation flows)
- DOM context preservation for replay reliability

Key differences from Playwright recording:
- Focuses on semantic selectors (text, aria, role) over positional
- Captures action intent/description for better replay understanding
- Groups related actions (e.g., form field + submit = form submission)
- More resilient to DOM changes through multiple selector strategies

Usage:
    service = BrowserUseRecordingService(db, test_session, browser_session)
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
from app.database import SessionLocal
from app.models import StepAction, TestSession, TestStep
from app.services.browser_orchestrator import BrowserSession as OrchestratorSession

logger = logging.getLogger(__name__)


async def _get_browser_ws_endpoint(browser_session: OrchestratorSession) -> str | None:
    """Get WebSocket endpoint for Playwright's connect() to browser server."""
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
                        logger.info(f"Got CDP WebSocket URL for BrowserUse recording: {fresh_url}")
                        return fresh_url
    except Exception as e:
        logger.warning(f"Error getting CDP URL: {e}")

    return None


@dataclass
class SemanticSelector:
    """
    Multiple selector strategies for self-healing replay.
    Inspired by workflow-use's selector approach.
    """
    # Primary selectors (most reliable)
    xpath: str | None = None
    css_selector: str | None = None
    
    # Semantic selectors (self-healing)
    text_selector: str | None = None  # getByText('...')
    role_selector: str | None = None  # getByRole('button', { name: '...' })
    label_selector: str | None = None  # getByLabel('...')
    placeholder_selector: str | None = None  # getByPlaceholder('...')
    test_id_selector: str | None = None  # getByTestId('...')
    
    # Fallback (least reliable)
    nth_selector: str | None = None  # nth-child based
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "xpath": self.xpath,
            "css_selector": self.css_selector,
            "text_selector": self.text_selector,
            "role_selector": self.role_selector,
            "label_selector": self.label_selector,
            "placeholder_selector": self.placeholder_selector,
            "test_id_selector": self.test_id_selector,
            "nth_selector": self.nth_selector,
        }
    
    def get_best_selector(self) -> tuple[str, str]:
        """Return the best available selector and its type."""
        # Priority order for self-healing
        if self.test_id_selector:
            return (self.test_id_selector, "test_id")
        if self.role_selector:
            return (self.role_selector, "role")
        if self.label_selector:
            return (self.label_selector, "label")
        if self.text_selector:
            return (self.text_selector, "text")
        if self.placeholder_selector:
            return (self.placeholder_selector, "placeholder")
        if self.css_selector:
            return (self.css_selector, "css")
        if self.xpath:
            return (self.xpath, "xpath")
        if self.nth_selector:
            return (self.nth_selector, "nth")
        return ("", "none")


@dataclass
class ElementContext:
    """Rich context about a DOM element for self-healing."""
    tag_name: str = "unknown"
    text_content: str | None = None
    inner_text: str | None = None
    aria_label: str | None = None
    aria_role: str | None = None
    role: str | None = None
    id: str | None = None
    name: str | None = None
    placeholder: str | None = None
    title: str | None = None
    alt: str | None = None
    href: str | None = None
    type: str | None = None
    value: str | None = None
    classes: list[str] = field(default_factory=list)
    data_testid: str | None = None
    # Position info
    x: int = 0
    y: int = 0
    width: int = 0
    height: int = 0
    # Parent context for disambiguation
    parent_tag: str | None = None
    parent_text: str | None = None
    # Sibling context
    prev_sibling_text: str | None = None
    next_sibling_text: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "tag_name": self.tag_name,
            "text_content": self.text_content,
            "inner_text": self.inner_text,
            "aria_label": self.aria_label,
            "aria_role": self.aria_role,
            "role": self.role,
            "id": self.id,
            "name": self.name,
            "placeholder": self.placeholder,
            "title": self.title,
            "alt": self.alt,
            "href": self.href,
            "type": self.type,
            "value": self.value,
            "classes": self.classes,
            "data_testid": self.data_testid,
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "parent_tag": self.parent_tag,
            "parent_text": self.parent_text,
            "prev_sibling_text": self.prev_sibling_text,
            "next_sibling_text": self.next_sibling_text,
        }


@dataclass
class ActionIntent:
    """Inferred intent of the user action for better replay understanding."""
    action_type: str  # click, input, select, submit, navigate, etc.
    description: str  # Human-readable description
    target_description: str  # What element was targeted
    category: str = "interaction"  # interaction, navigation, assertion, form
    is_form_related: bool = False
    form_field_name: str | None = None
    is_navigation: bool = False
    is_submission: bool = False


@dataclass
class RecordingState:
    """State of an active recording session."""
    test_session_id: str
    browser_session_id: str
    started_at: datetime
    steps_recorded: int = 0
    is_active: bool = True


# Global registry of active BrowserUse recordings
_active_browseruse_recordings: dict[str, "BrowserUseRecordingService"] = {}


def get_active_browseruse_recording(test_session_id: str) -> "BrowserUseRecordingService | None":
    """Get active BrowserUse recording for a test session."""
    return _active_browseruse_recordings.get(test_session_id)


# JavaScript for semantic element capture - inspired by workflow-use
BROWSERUSE_RECORDING_SCRIPT = '''
(function() {
    if (window.__buRecorderActive) return;
    window.__buRecorderActive = true;

    // Track active input for blur-based capture
    let activeInputElement = null;
    let activeInputInitialValue = '';
    
    // Action grouping for form submissions
    let pendingFormActions = [];
    let formSubmitTimeout = null;

    // Generate semantic selectors (workflow-use inspired)
    function generateSemanticSelectors(element) {
        const selectors = {};
        
        // XPath
        selectors.xpath = getXPath(element);
        
        // CSS Selector
        selectors.cssSelector = getCssSelector(element);
        
        // Text selector (for buttons, links, etc.)
        const visibleText = getVisibleText(element);
        if (visibleText && visibleText.length <= 50) {
            selectors.textSelector = `text=${visibleText}`;
        }
        
        // Role selector
        const role = element.getAttribute('role') || getImplicitRole(element);
        if (role) {
            const name = element.getAttribute('aria-label') || visibleText;
            if (name) {
                selectors.roleSelector = `role=${role}[name="${name}"]`;
            } else {
                selectors.roleSelector = `role=${role}`;
            }
        }
        
        // Label selector (for form inputs)
        const labelFor = findLabelFor(element);
        if (labelFor) {
            selectors.labelSelector = `label=${labelFor}`;
        }
        
        // Placeholder selector
        if (element.placeholder) {
            selectors.placeholderSelector = `placeholder=${element.placeholder}`;
        }
        
        // Test ID selector
        const testId = element.getAttribute('data-testid') || 
                       element.getAttribute('data-test-id') ||
                       element.getAttribute('data-cy') ||
                       element.getAttribute('data-test');
        if (testId) {
            selectors.testIdSelector = `testid=${testId}`;
        }
        
        // Nth selector as fallback
        selectors.nthSelector = getNthSelector(element);
        
        return selectors;
    }

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

    function getCssSelector(element) {
        if (!element) return '';
        if (element.id) {
            return `#${CSS.escape(element.id)}`;
        }

        const parts = [];
        let current = element;

        while (current && current !== document.body && parts.length < 5) {
            let selector = current.tagName.toLowerCase();

            if (current.id) {
                parts.unshift(`#${CSS.escape(current.id)}`);
                break;
            }

            // Add meaningful classes (skip generated ones)
            const classes = Array.from(current.classList || [])
                .filter(c => !c.match(/^(ng-|v-|_|css-|sc-|jsx-|emotion-|chakra-|mui-|ant-)/))
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

            // Add aria-label for buttons/links
            const ariaLabel = current.getAttribute('aria-label');
            if (!current.name && !classes.length && ariaLabel) {
                selector += `[aria-label="${CSS.escape(ariaLabel)}"]`;
            }
            
            // Add data-testid if present
            const testId = current.getAttribute('data-testid');
            if (testId) {
                selector += `[data-testid="${CSS.escape(testId)}"]`;
            }

            parts.unshift(selector);
            current = current.parentElement;
        }

        return parts.join(' > ');
    }

    function getVisibleText(element) {
        // Get visible text content (first line, trimmed)
        const text = (element.innerText || element.textContent || '').trim();
        const firstLine = text.split('\\n')[0].trim();
        return firstLine.substring(0, 100);
    }

    function getImplicitRole(element) {
        const tag = element.tagName.toLowerCase();
        const type = element.type;
        
        const roleMap = {
            'button': 'button',
            'a': 'link',
            'input[type=button]': 'button',
            'input[type=submit]': 'button',
            'input[type=checkbox]': 'checkbox',
            'input[type=radio]': 'radio',
            'input[type=text]': 'textbox',
            'input[type=email]': 'textbox',
            'input[type=password]': 'textbox',
            'input[type=search]': 'searchbox',
            'textarea': 'textbox',
            'select': 'combobox',
            'img': 'img',
            'nav': 'navigation',
            'main': 'main',
            'header': 'banner',
            'footer': 'contentinfo',
            'form': 'form',
            'table': 'table',
            'ul': 'list',
            'ol': 'list',
            'li': 'listitem',
        };
        
        if (tag === 'input' && type) {
            return roleMap[`input[type=${type}]`] || null;
        }
        return roleMap[tag] || null;
    }

    function findLabelFor(element) {
        // Check for associated label
        if (element.id) {
            const label = document.querySelector(`label[for="${element.id}"]`);
            if (label) {
                return (label.innerText || label.textContent || '').trim();
            }
        }
        
        // Check for parent label
        const parentLabel = element.closest('label');
        if (parentLabel) {
            return (parentLabel.innerText || parentLabel.textContent || '').trim();
        }
        
        // Check for aria-labelledby
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
            const labelEl = document.getElementById(labelledBy);
            if (labelEl) {
                return (labelEl.innerText || labelEl.textContent || '').trim();
            }
        }
        
        return null;
    }

    function getNthSelector(element) {
        const parent = element.parentElement;
        if (!parent) return element.tagName.toLowerCase();
        
        const siblings = Array.from(parent.children).filter(
            c => c.tagName === element.tagName
        );
        const index = siblings.indexOf(element) + 1;
        
        if (siblings.length === 1) {
            return `${element.tagName.toLowerCase()}`;
        }
        return `${element.tagName.toLowerCase()}:nth-of-type(${index})`;
    }

    function getElementContext(element, x, y) {
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement;
        const prevSibling = element.previousElementSibling;
        const nextSibling = element.nextElementSibling;
        
        return {
            tagName: element.tagName?.toLowerCase() || 'unknown',
            textContent: getVisibleText(element),
            innerText: (element.innerText || '').substring(0, 200),
            ariaLabel: element.getAttribute('aria-label'),
            ariaRole: element.getAttribute('role'),
            role: getImplicitRole(element),
            id: element.id || null,
            name: element.name || null,
            placeholder: element.placeholder || null,
            title: element.title || null,
            alt: element.alt || null,
            href: element.href || null,
            type: element.type || null,
            value: element.value || null,
            classes: Array.from(element.classList || []),
            dataTestid: element.getAttribute('data-testid') || 
                        element.getAttribute('data-test-id') ||
                        element.getAttribute('data-cy'),
            x: Math.round(x || rect.left + rect.width / 2),
            y: Math.round(y || rect.top + rect.height / 2),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            parentTag: parent?.tagName?.toLowerCase() || null,
            parentText: parent ? getVisibleText(parent).substring(0, 50) : null,
            prevSiblingText: prevSibling ? getVisibleText(prevSibling).substring(0, 30) : null,
            nextSiblingText: nextSibling ? getVisibleText(nextSibling).substring(0, 30) : null,
        };
    }

    function inferActionIntent(eventType, element, value) {
        const tag = element.tagName?.toLowerCase();
        const type = element.type?.toLowerCase();
        const text = getVisibleText(element);
        const ariaLabel = element.getAttribute('aria-label');
        const name = element.name;
        const role = getImplicitRole(element);
        
        let intent = {
            actionType: eventType,
            description: '',
            targetDescription: '',
            category: 'interaction',
            isFormRelated: false,
            formFieldName: null,
            isNavigation: false,
            isSubmission: false,
        };
        
        // Infer target description
        if (ariaLabel) {
            intent.targetDescription = ariaLabel;
        } else if (text && text.length <= 30) {
            intent.targetDescription = text;
        } else if (element.placeholder) {
            intent.targetDescription = element.placeholder;
        } else if (name) {
            intent.targetDescription = name;
        } else if (element.id) {
            intent.targetDescription = element.id;
        } else {
            intent.targetDescription = tag;
        }
        
        // Detect form-related actions
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            intent.isFormRelated = true;
            intent.category = 'form';
            intent.formFieldName = name || element.id || null;
        }
        
        // Detect navigation
        if (tag === 'a' && element.href) {
            intent.isNavigation = true;
            intent.category = 'navigation';
        }
        
        // Detect submission
        if ((tag === 'button' && (type === 'submit' || !type)) ||
            (tag === 'input' && type === 'submit') ||
            (role === 'button' && (text?.toLowerCase().includes('submit') || 
                                   text?.toLowerCase().includes('save') ||
                                   text?.toLowerCase().includes('send') ||
                                   text?.toLowerCase().includes('login') ||
                                   text?.toLowerCase().includes('sign')))) {
            intent.isSubmission = true;
            intent.category = 'form';
        }
        
        // Generate description
        switch (eventType) {
            case 'click':
                if (intent.isSubmission) {
                    intent.description = `Submit form by clicking "${intent.targetDescription}"`;
                } else if (intent.isNavigation) {
                    intent.description = `Navigate to "${intent.targetDescription}"`;
                } else if (role === 'button' || tag === 'button') {
                    intent.description = `Click button "${intent.targetDescription}"`;
                } else if (role === 'checkbox') {
                    intent.description = `Toggle checkbox "${intent.targetDescription}"`;
                } else if (role === 'radio') {
                    intent.description = `Select radio option "${intent.targetDescription}"`;
                } else {
                    intent.description = `Click on "${intent.targetDescription}"`;
                }
                break;
            case 'input':
                const maskedValue = type === 'password' ? '***' : (value || '').substring(0, 20);
                intent.description = `Enter "${maskedValue}" in ${intent.targetDescription}`;
                break;
            case 'select':
                intent.description = `Select "${value}" from ${intent.targetDescription}`;
                break;
            case 'keypress':
                intent.description = `Press ${value} key`;
                intent.category = 'keyboard';
                break;
            case 'scroll':
                intent.description = `Scroll page`;
                intent.category = 'navigation';
                break;
            default:
                intent.description = `${eventType} on ${intent.targetDescription}`;
        }
        
        return intent;
    }

    // Safe callback wrapper with error handling
    function safeRecordAction(info) {
        if (typeof window.__buRecordAction !== 'function') {
            console.warn('[BrowserUse Recording] Callback not available yet');
            return;
        }
        try {
            window.__buRecordAction(JSON.stringify(info));
        } catch (err) {
            console.error('[BrowserUse Recording] Error calling callback:', err);
        }
    }

    // Click handler
    document.addEventListener('click', function(e) {
        const target = e.target;
        const selectors = generateSemanticSelectors(target);
        const context = getElementContext(target, e.clientX, e.clientY);
        const intent = inferActionIntent('click', target, null);
        
        const info = {
            type: 'click',
            selectors: selectors,
            element: context,
            intent: intent,
            timestamp: Date.now(),
            url: window.location.href,
            pageTitle: document.title,
        };
        console.log('[BrowserUse Recording] Click captured:', intent.targetDescription);
        safeRecordAction(info);
    }, true);

    // Focus handler - track input start
    document.addEventListener('focus', function(e) {
        const target = e.target;
        if (!['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
        activeInputElement = target;
        activeInputInitialValue = target.value;
    }, true);

    // Blur handler - capture final input value
    document.addEventListener('blur', function(e) {
        const target = e.target;
        if (!['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
        if (target !== activeInputElement) return;

        const finalValue = target.value;
        if (finalValue !== activeInputInitialValue) {
            const selectors = generateSemanticSelectors(target);
            const context = getElementContext(target, 0, 0);
            const intent = inferActionIntent('input', target, finalValue);
            
            const info = {
                type: 'input',
                selectors: selectors,
                element: context,
                intent: intent,
                value: finalValue,
                timestamp: Date.now(),
                url: window.location.href,
                pageTitle: document.title,
            };
            console.log('[BrowserUse Recording] Input captured:', intent.targetDescription);
            safeRecordAction(info);
        }

        activeInputElement = null;
        activeInputInitialValue = '';
    }, true);

    // Select/dropdown handler
    document.addEventListener('change', function(e) {
        const target = e.target;
        if (target.tagName !== 'SELECT') return;

        const selectedOption = target.options[target.selectedIndex];
        const selectors = generateSemanticSelectors(target);
        const context = getElementContext(target, 0, 0);
        const intent = inferActionIntent('select', target, selectedOption?.text);
        
        const info = {
            type: 'select',
            selectors: selectors,
            element: context,
            intent: intent,
            value: target.value,
            selectedText: selectedOption?.text || '',
            timestamp: Date.now(),
            url: window.location.href,
            pageTitle: document.title,
        };
        console.log('[BrowserUse Recording] Select captured:', intent.targetDescription);
        safeRecordAction(info);
    }, true);

    // Keyboard handler - special keys only
    document.addEventListener('keydown', function(e) {
        const target = e.target;
        if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
            if (!['Enter', 'Escape', 'Tab'].includes(e.key)) {
                return;
            }
        }

        const specialKeys = ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 
                            'ArrowLeft', 'ArrowRight', 'Home', 'End', 
                            'PageUp', 'PageDown', 'Delete', 'Backspace'];
        const isSpecialKey = specialKeys.includes(e.key);
        const hasModifier = e.ctrlKey || e.metaKey || e.altKey;

        if (!isSpecialKey && !hasModifier) {
            return;
        }

        const modifiers = [];
        if (e.ctrlKey) modifiers.push('Ctrl');
        if (e.altKey) modifiers.push('Alt');
        if (e.shiftKey) modifiers.push('Shift');
        if (e.metaKey) modifiers.push('Meta');
        
        const keyCombo = modifiers.length > 0 
            ? modifiers.join('+') + '+' + e.key 
            : e.key;

        const selectors = generateSemanticSelectors(target);
        const context = getElementContext(target, 0, 0);
        const intent = inferActionIntent('keypress', target, keyCombo);
        
        const info = {
            type: 'keypress',
            selectors: selectors,
            element: context,
            intent: intent,
            key: e.key,
            code: e.code,
            keyCombo: keyCombo,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
            timestamp: Date.now(),
            url: window.location.href,
            pageTitle: document.title,
        };
        console.log('[BrowserUse Recording] Keypress captured:', keyCombo);
        safeRecordAction(info);
    }, true);

    // Scroll handler with debouncing
    let scrollTimeout = null;
    let scrollStartY = window.scrollY;
    document.addEventListener('scroll', function(e) {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(function() {
            const scrollDelta = window.scrollY - scrollStartY;
            if (Math.abs(scrollDelta) < 50) return; // Ignore tiny scrolls
            
            const intent = inferActionIntent('scroll', document.body, null);
            intent.description = scrollDelta > 0 
                ? `Scroll down ${Math.abs(scrollDelta)}px` 
                : `Scroll up ${Math.abs(scrollDelta)}px`;
            
            const info = {
                type: 'scroll',
                selectors: {},
                element: {},
                intent: intent,
                scrollX: window.scrollX,
                scrollY: window.scrollY,
                scrollDelta: scrollDelta,
                timestamp: Date.now(),
                url: window.location.href,
                pageTitle: document.title,
            };
            console.log('[BrowserUse Recording] Scroll captured:', scrollDelta);
            safeRecordAction(info);
            scrollStartY = window.scrollY;
        }, 500);
    }, true);

    console.log('[BrowserUse Recording] Semantic event listeners installed');
})();
'''


class BrowserUseRecordingService:
    """
    Captures user interactions using browser-use/workflow-use style semantic recording.
    
    Features:
    - Multiple selector strategies (semantic, positional, contextual)
    - Action intent detection for better replay understanding
    - Rich element context for self-healing
    - Form action grouping
    """

    CALLBACK_NAME = "__buRecordAction"

    def __init__(
        self,
        db: Session,
        test_session: TestSession,
        browser_session: OrchestratorSession,
    ):
        # Store IDs as strings to avoid detached session issues
        # The test_session object may become detached after the API request completes
        self._test_session_id = test_session.id
        self._browser_session_id = browser_session.id

        # Playwright objects
        self._playwright = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None

        self._current_step_number = 0
        self._is_recording = False
        self._state: RecordingState | None = None
        
        # Store browser session info needed for CDP connection
        self._browser_session_container_ip = browser_session.container_ip
        self._browser_session_cdp_host = browser_session.cdp_host
        self._browser_session_cdp_port = browser_session.cdp_port

        # Get current max step number
        existing_steps = db.query(TestStep).filter(
            TestStep.session_id == test_session.id
        ).order_by(TestStep.step_number.desc()).first()

        if existing_steps:
            self._current_step_number = existing_steps.step_number

    async def _get_cdp_http_endpoint(self) -> str | None:
        """Get HTTP endpoint for CDP connection (used by connect_over_cdp)."""
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

        # Return HTTP URL for connect_over_cdp (it handles getting the WS URL internally)
        cdp_http_url = f"http://{check_host}:{check_port}"
        
        # Verify the CDP endpoint is reachable
        try:
            async with aiohttp.ClientSession() as http_session:
                async with http_session.get(
                    f"{cdp_http_url}/json/version",
                    timeout=aiohttp.ClientTimeout(total=5)
                ) as resp:
                    if resp.status == 200:
                        logger.info(f"CDP endpoint verified: {cdp_http_url}")
                        return cdp_http_url
                    else:
                        logger.warning(f"CDP endpoint returned status {resp.status}")
                        return None
        except Exception as e:
            logger.warning(f"Error verifying CDP endpoint: {e}")
            return None

    async def start(self) -> RecordingState:
        """Start recording by connecting to the browser via CDP."""
        if self._is_recording:
            raise RuntimeError("Recording already in progress")

        logger.info(f"Starting BrowserUse recording for session {self._test_session_id}")

        try:
            # Get CDP endpoint - use HTTP URL for connect_over_cdp
            cdp_endpoint = await self._get_cdp_http_endpoint()
            if not cdp_endpoint:
                raise RuntimeError(f"Browser session {self._browser_session_id} has no CDP endpoint")

            logger.info(f"Connecting to browser via CDP: {cdp_endpoint}")

            self._playwright = await async_playwright().start()
            # Use connect_over_cdp for CDP-based connections (not connect which is for Playwright server)
            self._browser = await self._playwright.chromium.connect_over_cdp(cdp_endpoint)

            contexts = self._browser.contexts
            if not contexts:
                raise RuntimeError("No browser context available")

            self._context = contexts[0]
            pages = self._context.pages

            if not pages:
                raise RuntimeError("No page available in browser context")

            self._page = pages[0]
            logger.info(f"Connected to page: {self._page.url}")

            await self._setup_recording()

            self._is_recording = True
            self._state = RecordingState(
                test_session_id=self._test_session_id,
                browser_session_id=self._browser_session_id,
                started_at=datetime.utcnow(),
                steps_recorded=0,
            )

            _active_browseruse_recordings[self._test_session_id] = self

            logger.info(f"BrowserUse recording started for session {self._test_session_id}")
            return self._state

        except Exception as e:
            logger.error(f"Failed to start BrowserUse recording: {e}")
            await self._cleanup()
            raise

    async def stop(self) -> RecordingState:
        """Stop recording and cleanup."""
        logger.info(f"Stopping BrowserUse recording for session {self._test_session_id}")

        final_state = self._state
        if final_state:
            final_state.is_active = False

        await self._cleanup()

        if self._test_session_id in _active_browseruse_recordings:
            del _active_browseruse_recordings[self._test_session_id]

        logger.info(f"BrowserUse recording stopped. Total steps: {final_state.steps_recorded if final_state else 0}")
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
        """Set up event capture using Playwright's expose_function."""
        if not self._page:
            raise RuntimeError("Page not connected")

        # Expose the callback function to JavaScript
        logger.info(f"Exposing callback function: {self.CALLBACK_NAME}")
        await self._page.expose_function(self.CALLBACK_NAME, self._on_action_recorded)
        
        # Add init script for future page navigations
        await self._page.add_init_script(BROWSERUSE_RECORDING_SCRIPT)
        
        # Evaluate immediately on current page
        logger.info("Evaluating BrowserUse recording script on current page")
        await self._page.evaluate(BROWSERUSE_RECORDING_SCRIPT)
        
        # Verify the callback is available
        is_available = await self._page.evaluate(f"typeof window.{self.CALLBACK_NAME} === 'function'")
        logger.info(f"Callback function available in page: {is_available}")
        
        if not is_available:
            logger.error(f"CRITICAL: Callback function {self.CALLBACK_NAME} is NOT available in page!")
        
        logger.info("BrowserUse recording script injected successfully")

    async def _on_action_recorded(self, payload_str: str) -> None:
        """Handle events from the injected JavaScript."""
        try:
            payload = json.loads(payload_str)
            event_type = payload.get("type")

            logger.info(f"BrowserUse recording received event: {event_type}")

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
            logger.error(f"Error handling BrowserUse recording event: {e}", exc_info=True)

    def _parse_selectors(self, selectors_data: dict[str, Any]) -> SemanticSelector:
        """Parse selector data from JavaScript."""
        return SemanticSelector(
            xpath=selectors_data.get("xpath"),
            css_selector=selectors_data.get("cssSelector"),
            text_selector=selectors_data.get("textSelector"),
            role_selector=selectors_data.get("roleSelector"),
            label_selector=selectors_data.get("labelSelector"),
            placeholder_selector=selectors_data.get("placeholderSelector"),
            test_id_selector=selectors_data.get("testIdSelector"),
            nth_selector=selectors_data.get("nthSelector"),
        )

    def _parse_element_context(self, element_data: dict[str, Any]) -> ElementContext:
        """Parse element context from JavaScript."""
        return ElementContext(
            tag_name=element_data.get("tagName", "unknown"),
            text_content=element_data.get("textContent"),
            inner_text=element_data.get("innerText"),
            aria_label=element_data.get("ariaLabel"),
            aria_role=element_data.get("ariaRole"),
            role=element_data.get("role"),
            id=element_data.get("id"),
            name=element_data.get("name"),
            placeholder=element_data.get("placeholder"),
            title=element_data.get("title"),
            alt=element_data.get("alt"),
            href=element_data.get("href"),
            type=element_data.get("type"),
            value=element_data.get("value"),
            classes=element_data.get("classes", []),
            data_testid=element_data.get("dataTestid"),
            x=element_data.get("x", 0),
            y=element_data.get("y", 0),
            width=element_data.get("width", 0),
            height=element_data.get("height", 0),
            parent_tag=element_data.get("parentTag"),
            parent_text=element_data.get("parentText"),
            prev_sibling_text=element_data.get("prevSiblingText"),
            next_sibling_text=element_data.get("nextSiblingText"),
        )

    def _parse_intent(self, intent_data: dict[str, Any]) -> ActionIntent:
        """Parse action intent from JavaScript."""
        return ActionIntent(
            action_type=intent_data.get("actionType", "unknown"),
            description=intent_data.get("description", ""),
            target_description=intent_data.get("targetDescription", ""),
            category=intent_data.get("category", "interaction"),
            is_form_related=intent_data.get("isFormRelated", False),
            form_field_name=intent_data.get("formFieldName"),
            is_navigation=intent_data.get("isNavigation", False),
            is_submission=intent_data.get("isSubmission", False),
        )

    async def _handle_click(self, payload: dict[str, Any]) -> None:
        """Handle click event with semantic context."""
        selectors = self._parse_selectors(payload.get("selectors", {}))
        element = self._parse_element_context(payload.get("element", {}))
        intent = self._parse_intent(payload.get("intent", {}))

        await self._create_recorded_step(
            action_name="click_element",
            action_params={
                "x": element.x,
                "y": element.y,
            },
            selectors=selectors,
            element=element,
            intent=intent,
            payload=payload,
        )

    async def _handle_input(self, payload: dict[str, Any]) -> None:
        """Handle input event (blur-based)."""
        selectors = self._parse_selectors(payload.get("selectors", {}))
        element = self._parse_element_context(payload.get("element", {}))
        intent = self._parse_intent(payload.get("intent", {}))

        await self._create_recorded_step(
            action_name="type_text",
            action_params={
                "text": payload.get("value", ""),
            },
            selectors=selectors,
            element=element,
            intent=intent,
            payload=payload,
        )

    async def _handle_select(self, payload: dict[str, Any]) -> None:
        """Handle select/dropdown event."""
        selectors = self._parse_selectors(payload.get("selectors", {}))
        element = self._parse_element_context(payload.get("element", {}))
        intent = self._parse_intent(payload.get("intent", {}))

        await self._create_recorded_step(
            action_name="select_option",
            action_params={
                "value": payload.get("value", ""),
                "text": payload.get("selectedText", ""),
            },
            selectors=selectors,
            element=element,
            intent=intent,
            payload=payload,
        )

    async def _handle_keypress(self, payload: dict[str, Any]) -> None:
        """Handle keyboard event."""
        selectors = self._parse_selectors(payload.get("selectors", {}))
        element = self._parse_element_context(payload.get("element", {}))
        intent = self._parse_intent(payload.get("intent", {}))

        await self._create_recorded_step(
            action_name="press_key",
            action_params={
                "key": payload.get("key", ""),
                "key_combo": payload.get("keyCombo", ""),
                "ctrl": payload.get("ctrlKey", False),
                "alt": payload.get("altKey", False),
                "shift": payload.get("shiftKey", False),
                "meta": payload.get("metaKey", False),
            },
            selectors=selectors,
            element=element,
            intent=intent,
            payload=payload,
        )

    async def _handle_scroll(self, payload: dict[str, Any]) -> None:
        """Handle scroll event."""
        intent = self._parse_intent(payload.get("intent", {}))

        await self._create_recorded_step(
            action_name="scroll",
            action_params={
                "scroll_x": payload.get("scrollX", 0),
                "scroll_y": payload.get("scrollY", 0),
                "scroll_delta": payload.get("scrollDelta", 0),
            },
            selectors=SemanticSelector(),
            element=ElementContext(),
            intent=intent,
            payload=payload,
        )

    async def _create_recorded_step(
        self,
        action_name: str,
        action_params: dict[str, Any],
        selectors: SemanticSelector,
        element: ElementContext,
        intent: ActionIntent,
        payload: dict[str, Any],
    ) -> TestStep:
        """Create a TestStep + StepAction for a recorded user action.
        
        Uses a fresh database session to avoid detached instance issues
        when called asynchronously from the JavaScript callback.
        """
        self._current_step_number += 1
        step_number = self._current_step_number

        logger.info(f"BrowserUse recording step {step_number}: {action_name} - {intent.description}")

        url = payload.get("url")
        title = payload.get("pageTitle")

        screenshot_filename = await self._take_screenshot(step_number)

        # Use intent description as next_goal
        next_goal = intent.description or f"User action: {action_name}"

        # Create a fresh database session for this async callback
        # The original session may be closed/detached after the API request
        db = SessionLocal()
        try:
            # Create TestStep
            test_step = TestStep(
                session_id=self._test_session_id,
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

            db.add(test_step)
            db.flush()

            # Get best selector for element_xpath
            best_selector, selector_type = selectors.get_best_selector()

            # Create StepAction with rich context
            step_action = StepAction(
                step_id=test_step.id,
                action_index=0,
                action_name=action_name,
                action_params={
                    **action_params,
                    "source": "user",
                    "recording_mode": "browser_use",
                    # Semantic selectors for self-healing
                    "selectors": selectors.to_dict(),
                    "selector_type": selector_type,
                    # Rich element context
                    "element_context": element.to_dict(),
                    # Action intent
                    "intent": {
                        "action_type": intent.action_type,
                        "description": intent.description,
                        "target_description": intent.target_description,
                        "category": intent.category,
                        "is_form_related": intent.is_form_related,
                        "form_field_name": intent.form_field_name,
                        "is_navigation": intent.is_navigation,
                        "is_submission": intent.is_submission,
                    },
                },
                result_success=True,
                element_xpath=selectors.xpath,
                element_name=intent.target_description or element.text_content,
            )

            db.add(step_action)
            db.commit()

            if self._state:
                self._state.steps_recorded += 1

            logger.info(f"BrowserUse step {step_number} recorded: {action_name}")
            return test_step

        except Exception as e:
            logger.error(f"Failed to save BrowserUse recorded step {step_number}: {e}", exc_info=True)
            db.rollback()
            raise
        finally:
            db.close()

    async def _take_screenshot(self, step_number: int) -> str | None:
        """Take a screenshot and save it to disk."""
        if not self._page:
            return None

        try:
            filename = f"{self._test_session_id}_{step_number}.png"
            screenshots_dir = Path(settings.SCREENSHOTS_DIR)
            screenshots_dir.mkdir(parents=True, exist_ok=True)
            filepath = screenshots_dir / filename
            await self._page.screenshot(path=str(filepath))
            logger.debug(f"BrowserUse screenshot saved: {filename}")
            return filename
        except Exception as e:
            logger.warning(f"BrowserUse screenshot failed: {e}")
            return None

    async def _cleanup(self) -> None:
        """Cleanup resources."""
        self._is_recording = False

        if self._browser:
            try:
                await self._browser.close()
            except Exception as e:
                logger.warning(f"Error closing browser connection: {e}")
            self._browser = None

        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception as e:
                logger.warning(f"Error stopping Playwright: {e}")
            self._playwright = None

        self._context = None
        self._page = None
