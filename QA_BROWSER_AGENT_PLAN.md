# QA Browser Agent Transformation Plan

## Executive Summary

The current browser_use library is designed as a **general-purpose browser automation agent** - it excels at open-ended web tasks but lacks QA-specific constraints. This causes issues in your test automation platform:

1. **Agent searches on Google** when it should only interact with the target application
2. **Agent performs out-of-scope actions** (creative problem-solving vs. strict test execution)
3. **No distinction between Plan Mode vs Act Mode** requirements
4. **No verification/assertion framework** built into actions

This document outlines a comprehensive plan to transform browser_use into a **QA Browser Agent** optimized for test case analysis and execution.

---

## Part 1: Core Problem Analysis

### Current Issues Identified

| Issue | Root Cause | Location |
|-------|-----------|----------|
| Agent searches Google | `search` action exists and is encouraged in prompts | `tools/service.py:139-180`, `system_prompt.md:65-69` |
| Out-of-scope navigation | No domain restrictions enforced, prompts encourage "creative" solutions | `system_prompt.md:84-86` |
| No plan vs act mode | Single prompt handles both exploratory and execution tasks | `agent/prompts.py`, `system_prompts/` |
| No QA assertions | `done` action lacks verification semantics | `tools/service.py:done action` |
| No element stability checks | Actions execute without waiting for element stability | `tools/service.py:click/input` |

### Architecture Overview

```
Current Flow:
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│ User Task    │────►│ Agent (General) │────►│ Browser      │
│ "Test login" │     │ - Open prompts  │     │ - Any action │
└──────────────┘     │ - Creative mode │     │ - Any site   │
                     └─────────────────┘     └──────────────┘

Proposed Flow:
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│ QA Test Case │────►│ QA Agent        │────►│ Browser      │
│ with Steps   │     │ - Plan Mode     │     │ - Scoped     │
└──────────────┘     │ - Act Mode      │     │ - Verified   │
                     │ - Strict bounds │     │ - Stable     │
                     └─────────────────┘     └──────────────┘
```

---

## Part 2: QA Agent Modes

### Mode 1: Plan Mode (Test Case Analysis)

**Purpose**: Analyze application, discover test scenarios, generate test cases

**Behavior**:
- Exploratory navigation within target domain
- Element discovery and cataloging
- User flow mapping
- Test case generation from observations
- **Can** use search within application (e.g., search box on site)
- **Cannot** use external search engines
- **Focus**: Understanding, not executing

### Mode 2: Act Mode (Test Execution)

**Purpose**: Execute specific test steps with precision

**Behavior**:
- Follow exact test steps provided
- No deviation from plan
- Verify each action's result
- Record element selectors for replay
- **Cannot** navigate to external sites
- **Cannot** perform creative problem-solving
- **Focus**: Precision execution and verification

---

## Part 3: Implementation Plan

### Phase 1: Domain Scoping (Prevent Out-of-Scope Actions)

#### 1.1 Create QA Tools Registry

**File**: `browser_use/tools/qa_tools.py` (NEW)

```python
from browser_use.tools.service import Tools
from browser_use.agent.views import ActionResult

class QATools(Tools):
    """QA-specific tools with restricted actions."""
    
    def __init__(
        self,
        target_domain: str,
        mode: Literal['plan', 'act'] = 'act',
        exclude_actions: list[str] | None = None,
    ):
        # Default exclusions for QA mode
        qa_exclusions = [
            'search',  # No external search engines
        ]
        
        if mode == 'act':
            # Additional restrictions for act mode
            qa_exclusions.extend([
                # Only core interaction actions in act mode
            ])
        
        all_exclusions = list(set((exclude_actions or []) + qa_exclusions))
        super().__init__(exclude_actions=all_exclusions)
        
        self.target_domain = target_domain
        self.mode = mode
        
        # Override navigate to enforce domain restrictions
        self._register_qa_navigate()
        
        # Add QA-specific actions
        self._register_verify_action()
        self._register_assert_action()
```

#### 1.2 Modify BrowserSession for Domain Locking

**File**: `browser_use/browser/session.py`

The `allowed_domains` and `prohibited_domains` parameters already exist! We need to:

1. **Enforce at Agent level**: Pass target domain to browser session
2. **Block search engines**: Add to `prohibited_domains`

```python
# In browser_service.py when creating agent
browser_session = BrowserSession(
    cdp_url=...,
    allowed_domains=[target_url_domain],  # Lock to target
    prohibited_domains=['google.com', 'bing.com', 'duckduckgo.com'],  # Block search
)
```

#### 1.3 Remove/Replace Search Action for QA

**Current** (`tools/service.py:139`):
```python
@self.registry.action('', param_model=SearchAction)
async def search(params: SearchAction, browser_session: BrowserSession):
    # Searches Google/Bing/DuckDuckGo
```

**QA Replacement**:
```python
@self.registry.action('Search within the current application', param_model=AppSearchAction)
async def app_search(params: AppSearchAction, browser_session: BrowserSession):
    """Search using the application's search functionality, NOT external engines."""
    # Find search input on current page and use it
    # If no search input found, return error (don't fallback to Google)
```

---

### Phase 2: QA-Specific System Prompts

#### 2.1 Create QA System Prompt for Plan Mode

**File**: `browser_use/agent/system_prompts/system_prompt_qa_plan.md` (NEW)

```markdown
You are a QA Test Analyst AI agent designed to analyze web applications and generate test cases.

<intro>
Your mission is to UNDERSTAND and DOCUMENT the application under test:
1. Discover interactive elements and user flows
2. Identify testable scenarios and edge cases
3. Generate structured test cases with steps
4. Map element selectors for automation
5. Stay WITHIN the target application boundaries
</intro>

<strict_boundaries>
CRITICAL RULES - YOU MUST FOLLOW:
1. NEVER navigate to external websites
2. NEVER use Google, Bing, or any search engine
3. NEVER attempt to solve problems by searching the web
4. If you cannot proceed, STOP and report the blocker
5. All actions must be within the target application domain: {target_domain}
</strict_boundaries>

<qa_plan_mode>
In Plan Mode, you are ANALYZING, not executing tests:
1. Explore the application systematically
2. Document what you find (pages, elements, flows)
3. Generate test case ideas with rationale
4. Capture element attributes for later automation
5. Note any potential issues or risks
</qa_plan_mode>

<output>
Respond with structured analysis:
{{
  "thinking": "Your analysis of current state and next exploration step",
  "discovered": "What you found in this step (elements, flows, etc.)",
  "test_ideas": ["Potential test case 1", "Potential test case 2"],
  "next_exploration": "Where to explore next",
  "action": [...]
}}
</output>
```

#### 2.2 Create QA System Prompt for Act Mode

**File**: `browser_use/agent/system_prompts/system_prompt_qa_act.md` (NEW)

```markdown
You are a QA Test Executor AI agent designed to execute test steps with precision.

<intro>
Your mission is to EXECUTE test steps exactly as specified:
1. Follow each test step precisely
2. Verify the expected outcome after each action
3. Report pass/fail status with evidence
4. Record element selectors for reproducibility
5. NEVER deviate from the test plan
</intro>

<strict_boundaries>
CRITICAL RULES - YOU MUST FOLLOW:
1. Execute ONLY the steps provided in the test plan
2. NEVER navigate outside the application under test
3. NEVER use search engines or external sites
4. NEVER attempt creative problem-solving
5. If a step fails, STOP and report - do not try alternatives
6. If an element is not found, WAIT and RETRY, then FAIL
</strict_boundaries>

<qa_act_mode>
In Act Mode, you are EXECUTING with verification:
1. Read the current test step
2. Locate the exact element specified
3. Perform the action
4. VERIFY the expected result occurred
5. Record the outcome (pass/fail + evidence)
6. Move to next step or report failure
</qa_act_mode>

<verification_rules>
After EVERY action, you MUST verify:
- Did the expected change occur?
- Is the expected element/text/state present?
- Did any error messages appear?
- Is the page in the expected state?

If verification fails, mark the step as FAILED immediately.
</verification_rules>

<output>
{{
  "thinking": "Analysis of current step and verification plan",
  "step_execution": "What action was taken",
  "verification": "What was checked and the result",
  "step_result": "pass" | "fail",
  "failure_reason": "If failed, why (null if passed)",
  "element_selector": "XPath/CSS used for the element",
  "action": [...]
}}
</output>
```

---

### Phase 3: QA Agent Wrapper

#### 3.1 Create QAAgent Class

**File**: `browser_use/agent/qa_agent.py` (NEW)

```python
from browser_use.agent.service import Agent
from browser_use.tools.qa_tools import QATools
from browser_use.agent.prompts import SystemPrompt
from typing import Literal
from urllib.parse import urlparse

class QAAgent(Agent):
    """
    QA-specialized Agent with mode-aware behavior.
    
    Modes:
    - 'plan': Exploratory analysis, test case generation
    - 'act': Precise test execution with verification
    """
    
    def __init__(
        self,
        task: str,
        llm,
        target_url: str,
        mode: Literal['plan', 'act'] = 'act',
        test_steps: list[dict] | None = None,  # For act mode
        **kwargs
    ):
        self.mode = mode
        self.target_url = target_url
        self.target_domain = urlparse(target_url).netloc
        self.test_steps = test_steps or []
        
        # Create QA-specific tools
        qa_tools = QATools(
            target_domain=self.target_domain,
            mode=mode,
        )
        
        # Build mode-specific task
        enhanced_task = self._build_qa_task(task)
        
        # Get mode-specific system prompt
        system_prompt = self._get_qa_system_prompt()
        
        # Configure browser with domain restrictions
        browser_kwargs = kwargs.pop('browser_session_kwargs', {})
        browser_kwargs.setdefault('allowed_domains', [f'*.{self.target_domain}', self.target_domain])
        browser_kwargs.setdefault('prohibited_domains', ['google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com'])
        
        super().__init__(
            task=enhanced_task,
            llm=llm,
            tools=qa_tools,
            override_system_message=system_prompt,
            **kwargs
        )
    
    def _build_qa_task(self, task: str) -> str:
        if self.mode == 'plan':
            return f"""
TARGET APPLICATION: {self.target_url}
ALLOWED DOMAIN: {self.target_domain}

ANALYSIS TASK:
{task}

Remember: Stay within the target application. Do not use external search engines.
"""
        else:  # act mode
            steps_text = "\n".join([
                f"Step {i+1}: {s.get('description', s)}" 
                for i, s in enumerate(self.test_steps)
            ])
            return f"""
TARGET APPLICATION: {self.target_url}
ALLOWED DOMAIN: {self.target_domain}

EXECUTE THE FOLLOWING TEST STEPS:
{steps_text}

CRITICAL: Execute each step exactly. Verify after each action. Report failures immediately.
"""
    
    def _get_qa_system_prompt(self) -> str:
        if self.mode == 'plan':
            # Load QA plan prompt
            return self._load_qa_prompt('system_prompt_qa_plan.md')
        else:
            return self._load_qa_prompt('system_prompt_qa_act.md')
```

---

### Phase 4: Verification & Assertion Actions

#### 4.1 Add QA-Specific Actions

**File**: `browser_use/tools/qa_actions.py` (NEW)

```python
from browser_use.agent.views import ActionResult
from pydantic import BaseModel, Field

class VerifyTextAction(BaseModel):
    """Verify that specific text exists on the page."""
    text: str = Field(description="The text to verify exists on the page")
    exact_match: bool = Field(default=False, description="If true, text must match exactly. If false, partial match is allowed")

class VerifyElementAction(BaseModel):
    """Verify that an element exists and is visible."""
    index: int = Field(description="Index of the element to verify")
    
class VerifyUrlAction(BaseModel):
    """Verify the current URL matches expected."""
    expected_url: str = Field(description="Expected URL or URL pattern")
    partial: bool = Field(default=True, description="If true, checks if URL contains expected. If false, exact match")

class AssertAction(BaseModel):
    """Make a test assertion with pass/fail outcome."""
    condition: str = Field(description="The condition being asserted (for logging)")
    expected: str = Field(description="What was expected")
    actual: str = Field(description="What was actually observed")
    passed: bool = Field(description="Whether the assertion passed")

# Register these in QATools:
@self.registry.action('Verify that specific text exists on the page', param_model=VerifyTextAction)
async def verify_text(params: VerifyTextAction, browser_session):
    """Verify text presence - QA assertion action."""
    state = await browser_session.get_browser_state_summary()
    page_text = state.dom_state.llm_representation() if state.dom_state else ""
    
    if params.exact_match:
        found = params.text in page_text
    else:
        found = params.text.lower() in page_text.lower()
    
    if found:
        return ActionResult(
            extracted_content=f"✓ VERIFIED: Text '{params.text}' found on page",
            long_term_memory=f"Verification passed: '{params.text}' present"
        )
    else:
        return ActionResult(
            error=f"✗ VERIFICATION FAILED: Text '{params.text}' NOT found on page",
            long_term_memory=f"Verification FAILED: '{params.text}' not present"
        )

@self.registry.action('Record a test assertion result', param_model=AssertAction)
async def assert_result(params: AssertAction, browser_session):
    """Record a formal test assertion."""
    status = "PASS" if params.passed else "FAIL"
    msg = f"[{status}] {params.condition}\n  Expected: {params.expected}\n  Actual: {params.actual}"
    
    if params.passed:
        return ActionResult(
            extracted_content=msg,
            long_term_memory=f"Assertion {status}: {params.condition}"
        )
    else:
        return ActionResult(
            error=msg,
            long_term_memory=f"Assertion {status}: {params.condition}"
        )
```

---

### Phase 5: Integration with Your Backend

#### 5.1 Update browser_service.py

**File**: `backend/app/services/browser_service.py`

```python
# Replace current Agent instantiation with QAAgent

from browser_use.agent.qa_agent import QAAgent

# In execute() method:
if mode == 'plan':
    agent = QAAgent(
        task=task,
        llm=llm,
        target_url=plan.target_url,  # Add to TestPlan model
        mode='plan',
        browser_session=browser_session,
        use_vision=True,
    )
else:  # act mode
    agent = QAAgent(
        task=task,
        llm=llm,
        target_url=plan.target_url,
        mode='act',
        test_steps=plan.steps_json.get('steps', []),
        browser_session=browser_session,
        use_vision=True,
    )
```

#### 5.2 Update single_step_service.py

**File**: `backend/app/services/single_step_service.py`

```python
def _get_single_step_system_extension(self) -> str:
    """Get system prompt extension for single-step QA mode."""
    return """
=== QA SINGLE-STEP MODE ===

You are executing a SINGLE test action. Follow these rules:

1. EXECUTE EXACTLY ONE ACTION
   - Perform the requested action
   - Do NOT plan ahead or chain actions
   
2. STAY WITHIN THE APPLICATION
   - NEVER navigate to external sites
   - NEVER use search engines
   - Only interact with the current application
   
3. VERIFY THE RESULT
   - After the action, check if it succeeded
   - Report the outcome clearly
   
4. NO CREATIVE PROBLEM-SOLVING
   - If the action fails, report the failure
   - Do NOT try alternative approaches
   - The user will decide what to do next
"""
```

---

### Phase 6: Enhanced Recording for Replay

#### 6.1 Element Selector Recording

The codebase already has recording hooks in `app/services/recording_hooks.py`. Enhance these:

```python
# In recording_hooks.py
def record_click_element(node: EnhancedDOMTreeNode) -> None:
    """Record click with comprehensive selectors for replay."""
    record = {
        "action": "click",
        "selectors": {
            "xpath": node.x_path,
            "css": generate_css_selector(node),
            "text": node.ax_name,
            "index": node.highlight_index,
            "attributes": {
                "id": node.attributes.get("id"),
                "data-testid": node.attributes.get("data-testid"),
                "aria-label": node.attributes.get("aria-label"),
            }
        },
        "context": {
            "url": current_url,
            "page_title": current_title,
        }
    }
    # Store for script generation
```

---

## Part 4: Implementation Checklist

### Phase 1: Domain Scoping (Week 1)
- [ ] Create `QATools` class extending `Tools`
- [ ] Modify browser_service.py to pass `allowed_domains`
- [ ] Add `prohibited_domains` for search engines
- [ ] Remove/replace `search` action with app-only search
- [ ] Add domain validation in `navigate` action

### Phase 2: QA System Prompts (Week 1)
- [ ] Create `system_prompt_qa_plan.md`
- [ ] Create `system_prompt_qa_act.md`
- [ ] Update `prompts.py` to load QA prompts
- [ ] Add mode parameter to SystemPrompt class

### Phase 3: QA Agent Wrapper (Week 2)
- [ ] Create `QAAgent` class
- [ ] Implement mode-aware task building
- [ ] Add target domain extraction
- [ ] Integrate with existing Agent lifecycle

### Phase 4: Verification Actions (Week 2)
- [ ] Create `qa_actions.py` with verify/assert actions
- [ ] Register actions in QATools
- [ ] Add verification hooks to step callbacks
- [ ] Update action recording for assertions

### Phase 5: Backend Integration (Week 3)
- [ ] Update `browser_service.py` to use QAAgent
- [ ] Update `single_step_service.py` for QA mode
- [ ] Add `target_url` to TestPlan model
- [ ] Add `mode` parameter to API endpoints

### Phase 6: Enhanced Recording (Week 3)
- [ ] Enhance selector recording
- [ ] Add verification step recording
- [ ] Generate replayable test scripts
- [ ] Add failure screenshot/DOM capture

---

## Part 5: Quick Wins (Immediate Fixes)

If you need to fix the issues TODAY before the full implementation:

### Quick Fix 1: Block Search Engines Immediately

```python
# In browser_service.py, when creating BrowserSession:
browser_session = BrowserSession(
    cdp_url=...,
    prohibited_domains=['google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'ask.com'],
)
```

### Quick Fix 2: Remove Search Action

```python
# In browser_service.py, when creating Agent:
from browser_use import Tools

tools = Tools(exclude_actions=['search'])
agent = Agent(
    task=task,
    llm=llm,
    browser_session=browser_session,
    tools=tools,  # Use restricted tools
)
```

### Quick Fix 3: Add Strict System Prompt Extension

```python
# In browser_service.py:
strict_qa_rules = """
CRITICAL QA RULES - YOU MUST FOLLOW:
1. NEVER use search engines (Google, Bing, DuckDuckGo)
2. NEVER navigate outside the target application
3. If you cannot find an element, wait and retry - do NOT search for alternatives
4. Execute test steps exactly as specified
5. Report failures immediately - do not attempt workarounds
"""

agent = Agent(
    task=task,
    llm=llm,
    extend_system_message=strict_qa_rules,
)
```

---

## Summary

The transformation from generic browser agent to QA browser agent requires:

1. **Domain Restrictions**: Lock agent to target application
2. **Mode Separation**: Different prompts and tools for Plan vs Act
3. **Verification Framework**: Built-in assertions and checks
4. **Strict Boundaries**: Prevent creative problem-solving in execution
5. **Enhanced Recording**: Capture selectors for replay

The architecture already supports most of these changes through existing parameters (`allowed_domains`, `extend_system_message`, `exclude_actions`). The main work is creating the QA-specific wrapper classes and prompts.


while re initialzing the test case analysis, browser loading taking time even all the steps are already executed. 