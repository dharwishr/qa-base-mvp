# QA Test Failure Handling Strategy

## Current Behavior

During **test case analysis** (plan mode), the QA agent explores the application and generates test cases. Currently, if an assertion fails during this phase, it can interrupt the analysis workflow.

**Desired Behavior**: During analysis, assertions should be **recorded but not fail** the execution. Failures should only occur during **test execution** (act mode) when running the generated scripts.

---

## Changes Already Implemented

### System Prompt Changes (Completed)

The QA system prompts have been updated to use different language for plan vs act mode:

**File**: `browser_use/agent/system_prompts/system_prompt_qa_plan.md`

| Before (Strict) | After (Soft) |
|-----------------|--------------|
| `CRITICAL RULES` | `IMPORTANT GUIDELINES` |
| `NEVER navigate to external websites` | `Stay within the target application - avoid external websites` |
| `NEVER use... search engine` | `Do not use search engines - explore the app directly` |
| `If you are truly stuck, STOP and report the blocker` | `If you cannot find an element, try scrolling, waiting, or navigating` |
| `THESE RULES ARE NON-NEGOTIABLE. Violating them means test failure.` | `These guidelines help you focus on the application under test.` |

**File**: `browser_use/agent/system_prompts/system_prompt_qa_act.md`

Act mode retains strict language as appropriate for test execution:
- "CRITICAL RULES - YOU MUST FOLLOW THESE AT ALL TIMES"
- "If a step fails, STOP and report the failure"
- "THESE RULES ARE NON-NEGOTIABLE. Violating them means test failure."

This ensures:
- **Plan Mode**: Agent explores freely, records observations, doesn't fail on issues
- **Act Mode**: Agent executes precisely, fails fast on any deviation

---

## Proposed Solution

### 1. Mode-Aware Assertion Behavior

Modify assertion actions to behave differently based on the mode:

| Mode | Assertion Behavior |
|------|-------------------|
| **Plan Mode** | Log assertion result, continue execution regardless of pass/fail |
| **Act Mode** | Fail execution if assertion fails |

### 2. Implementation Approach

#### Option A: Soft Assertions in Plan Mode

Add a `soft_assert` flag to the QAAgent that controls whether assertions should fail execution:

```python
# In browser_use/agent/qa_agent.py

class QAAgent(Agent):
    def __init__(self, ..., mode: Literal['plan', 'act'] = 'act'):
        self.mode = mode
        self.soft_assertions = (mode == 'plan')  # Don't fail on assertions in plan mode
        
        # Create tools with soft assertion mode
        if tools is None:
            tools = QATools(
                target_domain=self.target_domain,
                mode=mode,
                soft_assertions=self.soft_assertions,
            )
```

#### Option B: Separate Observation Actions for Plan Mode

Create "observe" actions for plan mode that record without asserting:

```python
# Plan Mode Actions (non-failing)
- observe_text(text: str) -> Records if text is present
- observe_element(index: int) -> Records if element exists
- observe_url(pattern: str) -> Records current URL state

# Act Mode Actions (failing)
- assert_text(text: str) -> Fails if text not present
- assert_element(index: int) -> Fails if element not visible
- assert_url(pattern: str) -> Fails if URL doesn't match
```

#### Option C: Wrap Assertions with Try-Catch in Plan Mode (Recommended)

Modify the assertion actions in `tools/service.py` to catch failures in plan mode:

```python
# In browser_use/tools/service.py

async def assert_text(params: AssertTextAction, browser_session: BrowserSession):
    """Verify text is visible, optionally within a specific element."""
    
    # Check if we're in soft assertion mode (plan mode)
    soft_mode = getattr(browser_session, '_soft_assertions', False)
    
    # ... existing text checking logic ...
    
    if found:
        memory = f"✓ Verified text '{params.text[:50]}' is visible"
        return ActionResult(extracted_content=memory, long_term_memory=memory)
    else:
        if soft_mode:
            # Plan mode: log observation, don't fail
            memory = f"⚠ Observation: Text '{params.text[:50]}' NOT found (will be verified during execution)"
            return ActionResult(
                extracted_content=memory,
                long_term_memory=memory,
                # Note: NOT setting error - this allows execution to continue
            )
        else:
            # Act mode: fail the assertion
            return ActionResult(error=f"✗ Text '{params.text[:50]}' not found on page")
```

---

## Detailed Implementation Plan

### Phase 1: Add Soft Assertion Mode to QATools

**File**: `browser_use/tools/qa_tools.py`

```python
class QATools(Tools):
    def __init__(
        self,
        target_domain: str | None = None,
        mode: Literal['plan', 'act'] = 'act',
        soft_assertions: bool | None = None,  # New parameter
        ...
    ):
        # Default: soft assertions in plan mode, hard assertions in act mode
        if soft_assertions is None:
            soft_assertions = (mode == 'plan')
        
        self.soft_assertions = soft_assertions
        self.mode = mode
        ...
```

### Phase 2: Pass Soft Assertion Mode to Browser Session

**File**: `browser_use/agent/qa_agent.py`

```python
class QAAgent(Agent):
    async def run(self, *args, **kwargs):
        # Set soft assertion mode on browser session before running
        if self.browser_session:
            self.browser_session._soft_assertions = self.tools.soft_assertions
        return await super().run(*args, **kwargs)
```

### Phase 3: Modify Assertion Actions to Check Mode

**File**: `browser_use/tools/service.py`

For each assertion action, add the soft mode check:

```python
@self.registry.action(
    'Assert text is visible on page.',
    param_model=AssertTextAction,
)
async def assert_text(params: AssertTextAction, browser_session: BrowserSession):
    soft_mode = getattr(browser_session, '_soft_assertions', False)
    
    # ... perform check ...
    
    if not found:
        if soft_mode:
            # Observation mode - continue execution
            return ActionResult(
                extracted_content=f"⚠ Text '{params.text}' not found (observation recorded)",
                long_term_memory=f"Observed: text '{params.text}' missing"
            )
        else:
            # Strict mode - fail execution
            return ActionResult(error=f"✗ Assertion failed: text '{params.text}' not found")
```

### Phase 4: Update Recording to Capture Observation Results

**File**: `backend/app/services/recording_hooks.py`

Modify recording hooks to distinguish between:
- Passed assertions (✓)
- Failed assertions in plan mode (⚠ observations)
- Failed assertions in act mode (✗)

```python
def record_assert_text(
    expected_text: str,
    partial_match: bool = True,
    passed: bool = True,  # New parameter
    observation_only: bool = False,  # New parameter
    description: str | None = None,
) -> PlaywrightStep | None:
    recorder = get_current_recorder()
    if not recorder:
        return None
    
    # Mark as observation if in plan mode
    step = recorder.record_assert_text_visible(
        expected_text=expected_text,
        partial_match=partial_match,
        description=description,
    )
    
    # Add metadata for observation mode
    if observation_only and step:
        step.metadata = {"observation_only": True, "passed": passed}
    
    return step
```

---

## Script Generation Updates

When generating scripts from sessions that ran in plan mode:

### Option 1: Include All Observations as Assertions

Convert all observations to assertions in the generated script. The script will verify them during execution.

```python
def _convert_action_to_playwright_step(action, index: int, url: str | None) -> dict[str, Any] | None:
    # ... existing logic ...
    
    # Handle observations from plan mode
    if action_name.startswith("observe"):
        # Convert observations to assertions for the script
        return _convert_observation_to_assertion(action, index)
```

### Option 2: Mark Observations as Optional

Add an `optional` flag to assertion steps:

```python
{
    "index": 5,
    "action": "assert",
    "assertion": {
        "assertion_type": "text_visible",
        "expected_value": "Welcome",
        "optional": True,  # Won't fail the test run if this fails
    },
    "description": "Verify welcome message (optional)",
}
```

### Option 3: Separate Verification from Execution

Generate two types of steps in the script:
1. **Action steps**: Must succeed
2. **Verification steps**: Optional, logged but don't fail

---

## UI/UX Considerations

### During Analysis (Plan Mode)

Display observation results with different styling:

```
Step 3: ⚠ Observation: Text 'Login successful' not found
        → Will be verified during test execution
        
Step 4: ✓ Observation: Element 'Submit button' found
        → Captured for test script
```

### In Generated Test Cases

Show which steps are assertions vs observations:

```
Test Case: Login Flow
├─ Step 1: Navigate to https://example.com/login
├─ Step 2: Fill username field
├─ Step 3: Fill password field  
├─ Step 4: Click login button
├─ Step 5: [VERIFY] Text 'Welcome' is visible    ← Generated from observation
└─ Step 6: [VERIFY] URL contains '/dashboard'    ← Generated from observation
```

---

## Configuration Options

Allow users to configure assertion behavior:

```python
# In session/test configuration
{
    "assertion_mode": "soft",      # soft | strict
    "fail_on_first_error": false,  # Continue after failures
    "record_observations": true,   # Record even failed checks
    "convert_observations": true,  # Convert to assertions in script
}
```

---

## Migration Path

1. **Immediate** (no code changes): Don't use assertion actions during plan mode - use `extract` action instead to gather information

2. **Short term**: Implement Option C (wrap assertions with try-catch) - minimal code changes

3. **Long term**: Implement full observation system with UI support

---

## Files to Modify

| File | Changes |
|------|---------|
| `browser_use/tools/qa_tools.py` | Add `soft_assertions` parameter |
| `browser_use/tools/service.py` | Modify assertion actions to check mode |
| `browser_use/agent/qa_agent.py` | Pass soft assertion mode to browser session |
| `backend/app/services/recording_hooks.py` | Add observation metadata to recordings |
| `backend/app/routers/scripts.py` | Handle observations when generating scripts |
| `frontend/` | Update UI to show observations differently |

---

## Example: Soft Assertion Implementation

Here's a complete example of implementing soft assertions for `assert_text`:

```python
# browser_use/tools/service.py

@self.registry.action(
    'Assert text is visible on page.',
    param_model=AssertTextAction,
)
async def assert_text(params: AssertTextAction, browser_session: BrowserSession):
    """Verify text is visible. In plan mode, records observation without failing."""
    
    # Check if we're in soft assertion mode
    soft_mode = getattr(browser_session, '_soft_assertions', False)
    
    cdp_session = await browser_session.get_or_create_cdp_session()
    
    # ... existing text checking logic ...
    
    # Perform the text comparison
    if params.partial_match:
        found = params.text.lower() in text_content.lower()
    else:
        found = params.text.lower() == text_content.lower()
    
    # Record for script generation (always record, regardless of result)
    if RECORDING_ENABLED:
        record_assert_text(
            expected_text=params.text,
            partial_match=params.partial_match,
            passed=found,
            observation_only=soft_mode,
        )
    
    if found:
        memory = f"✓ Verified text '{params.text[:50]}' is visible"
        return ActionResult(extracted_content=memory, long_term_memory=memory)
    else:
        if soft_mode:
            # Plan mode: record as observation, continue
            memory = f"⚠ Observation: Text '{params.text[:50]}' not found"
            logger.info(f"Soft assertion (observation): {memory}")
            return ActionResult(
                extracted_content=memory,
                long_term_memory=f"[OBSERVATION] {memory} - will verify during execution"
            )
        else:
            # Act mode: fail
            return ActionResult(error=f"✗ Text '{params.text[:50]}' not found on page")
```

---

## Summary

The recommended approach is **Option C: Wrap Assertions with Try-Catch** because:

1. Minimal code changes required
2. Backward compatible
3. Recording still works
4. Clear distinction between plan mode (observations) and act mode (assertions)
5. Generated scripts will have proper assertions for execution
