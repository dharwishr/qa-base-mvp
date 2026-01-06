import json
import logging

from google import genai
from sqlalchemy.orm import Session

from app.config import settings
from app.models import TestPlan, TestSession, TestStep

logger = logging.getLogger(__name__)

# Create Gemini client
client = genai.Client(api_key=settings.GEMINI_API_KEY)


def should_include_verification(prompt: str) -> bool:
	"""Check if the user's prompt indicates they want verification steps."""
	verification_keywords = [
		'verify', 'assert', 'check', 'validate', 'confirm', 'ensure',
		'verification', 'assertion', 'validation', 'confirmation'
	]
	prompt_lower = prompt.lower()
	return any(keyword in prompt_lower for keyword in verification_keywords)

VERIFICATION_INSTRUCTIONS = """
VERIFICATION STEPS (action_type="verify"):
Include verification steps after key actions to validate expected outcomes. This is essential for proper QA test cases.

Examples of verify steps:
- Verify text is visible: {{"action_type": "verify", "description": "Verify login success message", "details": "Assert text 'Welcome back' is visible on the page"}}
- Verify element appears: {{"action_type": "verify", "description": "Verify dashboard loaded", "details": "Assert the dashboard container element is visible"}}
- Verify URL changed: {{"action_type": "verify", "description": "Verify redirected to dashboard", "details": "Assert URL contains '/dashboard'"}}
- Verify form value: {{"action_type": "verify", "description": "Verify search input populated", "details": "Assert the search field contains 'test query'"}}

QA BEST PRACTICE: Always include at least one verification step after completing a key action (e.g., after login verify success message appears, after form submit verify confirmation).
"""

PLAN_GENERATION_PROMPT = """You are a QA automation expert. Given a user's test case description, create a detailed step-by-step plan for browser automation testing.

{execution_context}

User's request:
{prompt}

{continuation_instruction}

Generate a clear, actionable test plan with numbered steps. Each step should be a specific browser action that can be automated.

AVAILABLE ACTION TYPES:
- navigate: Go to a URL
- click: Click on an element (button, link, etc.)
- type: Enter text into an input field
- scroll: Scroll the page up or down
- wait: Wait for a specified time
- hover: Hover over an element
- select: Select option from dropdown
- verify: Assert/verify expected results (only if user requests verification)
{verification_section}
Return the response in the following JSON format:
{{
    "plan_text": "A human-readable summary of the test plan",
    "steps": [
        {{
            "step_number": 1,
            "description": "Navigate to the website",
            "action_type": "navigate",
            "details": "Go to https://example.com"
        }},
        {{
            "step_number": 2,
            "description": "Click login button",
            "action_type": "click",
            "details": "Find and click the login button"
        }}
    ]
}}

Be specific and practical.{verification_reminder}
{navigation_warning}
"""


def build_execution_context(db: Session, session: TestSession) -> str:
	"""Build minimal context for plan generation - just current browser state.

	For continuation plans, only includes:
	- Current URL and page title (from last step)
	- Brief summary of last completed action

	Does NOT include step history, previous plans, or chat history to avoid
	confusing the LLM into repeating already-completed steps.

	Args:
		db: Database session
		session: Test session

	Returns:
		Context string to include in the prompt
	"""
	context_parts = []

	# Get last step only (not multiple steps)
	last_step = db.query(TestStep).filter(
		TestStep.session_id == session.id
	).order_by(TestStep.step_number.desc()).first()

	if last_step:
		# Current browser state
		if last_step.url:
			context_parts.append(f"Current URL: {last_step.url}")
		if last_step.page_title:
			context_parts.append(f"Current Page: {last_step.page_title}")

		# Brief summary of last action only
		if last_step.next_goal:
			context_parts.append(f"Just completed: {last_step.next_goal}")

	return "\n".join(context_parts) if context_parts else ""


async def generate_plan(db: Session, session: TestSession, task_prompt: str | None = None) -> TestPlan:
	"""Generate a test plan using Gemini 2.0 Flash.

	Args:
		db: Database session
		session: Test session
		task_prompt: Optional specific prompt to use for plan generation.
			If provided, this is used instead of session.prompt.
			Use this for continuation plans to pass only the new request.
	"""
	try:
		# Use provided task_prompt or fall back to session.prompt
		plan_prompt = task_prompt if task_prompt else session.prompt

		# For continuation plans (task_prompt provided), include current browser
		# state so the LLM knows not to add navigation steps.
		is_continuation = task_prompt is not None

		if is_continuation:
			# Include current browser state for continuations so LLM knows where we are
			execution_context = build_execution_context(db, session)
			continuation_instruction = """IMPORTANT: This is a CONTINUATION of an existing test session.
A browser session is already active and on the page shown above.
Generate additional steps to perform the user's new request FROM THE CURRENT PAGE STATE.
Do NOT include any navigate/go_to_url steps - the browser is already on the correct page."""
			navigation_warning = """CRITICAL: Do NOT include any navigation steps (navigate, go_to_url, open URL, etc.) in this plan.
The browser is already positioned on the correct page. Start directly with the user's requested actions."""
			logger.info(f"Generating CONTINUATION plan (with context) for: {plan_prompt[:100]}...")
		else:
			# For new sessions, build context (will be empty anyway for new session)
			execution_context = build_execution_context(db, session)
			continuation_instruction = ""
			navigation_warning = ""
			logger.info(f"Generating NEW session plan for: {plan_prompt[:100]}...")

		# Only include verification instructions if user explicitly requests verification
		include_verification = should_include_verification(plan_prompt)
		verification_section = VERIFICATION_INSTRUCTIONS if include_verification else ""
		verification_reminder = " Include verification steps after every key action to ensure proper test coverage." if include_verification else ""

		prompt = PLAN_GENERATION_PROMPT.format(
			execution_context=execution_context,
			prompt=plan_prompt,
			continuation_instruction=continuation_instruction,
			navigation_warning=navigation_warning,
			verification_section=verification_section,
			verification_reminder=verification_reminder
		)
		logger.debug(f"Full prompt to LLM:\n{prompt}")

		response = client.models.generate_content(
			model="gemini-2.0-flash",
			contents=prompt,
		)

		# Extract response text
		response_text = response.text

		# Try to parse as JSON
		try:
			# Remove markdown code blocks if present
			if response_text.startswith("```"):
				lines = response_text.split("\n")
				# Remove first and last lines (```json and ```)
				response_text = "\n".join(lines[1:-1])

			plan_data = json.loads(response_text)
			plan_text = plan_data.get("plan_text", response_text)
			steps_json = plan_data.get("steps", [])
		except json.JSONDecodeError:
			# If not valid JSON, use raw text
			plan_text = response_text
			steps_json = []

		# Create and save the plan
		plan = TestPlan(
			session_id=session.id,
			plan_text=plan_text,
			steps_json={"steps": steps_json},
		)
		db.add(plan)

		# Update session status
		session.status = "plan_ready"
		db.commit()
		db.refresh(plan)

		logger.info(f"Generated plan for session {session.id}")
		return plan

	except Exception as e:
		logger.error(f"Error generating plan: {e}")
		session.status = "failed"
		db.commit()
		raise


def generate_plan_sync(db: Session, session: TestSession, task_prompt: str | None = None) -> TestPlan:
	"""Synchronous version of generate_plan for Celery workers.

	Args:
		db: Database session
		session: Test session
		task_prompt: Optional specific prompt to use for plan generation.
	"""
	try:
		plan_prompt = task_prompt if task_prompt else session.prompt

		is_continuation = task_prompt is not None

		if is_continuation:
			# Include current browser state for continuations so LLM knows where we are
			execution_context = build_execution_context(db, session)
			continuation_instruction = """IMPORTANT: This is a CONTINUATION of an existing test session.
A browser session is already active and on the page shown above.
Generate additional steps to perform the user's new request FROM THE CURRENT PAGE STATE.
Do NOT include any navigate/go_to_url steps - the browser is already on the correct page."""
			navigation_warning = """CRITICAL: Do NOT include any navigation steps (navigate, go_to_url, open URL, etc.) in this plan.
The browser is already positioned on the correct page. Start directly with the user's requested actions."""
			logger.info(f"Generating CONTINUATION plan (with context) for: {plan_prompt[:100]}...")
		else:
			execution_context = build_execution_context(db, session)
			continuation_instruction = ""
			navigation_warning = ""
			logger.info(f"Generating NEW session plan for: {plan_prompt[:100]}...")

		# Only include verification instructions if user explicitly requests verification
		include_verification = should_include_verification(plan_prompt)
		verification_section = VERIFICATION_INSTRUCTIONS if include_verification else ""
		verification_reminder = " Include verification steps after every key action to ensure proper test coverage." if include_verification else ""

		prompt = PLAN_GENERATION_PROMPT.format(
			execution_context=execution_context,
			prompt=plan_prompt,
			continuation_instruction=continuation_instruction,
			navigation_warning=navigation_warning,
			verification_section=verification_section,
			verification_reminder=verification_reminder
		)
		logger.debug(f"Full prompt to LLM:\n{prompt}")

		response = client.models.generate_content(
			model="gemini-2.0-flash",
			contents=prompt,
		)

		response_text = response.text

		try:
			if response_text.startswith("```"):
				lines = response_text.split("\n")
				response_text = "\n".join(lines[1:-1])

			plan_data = json.loads(response_text)
			plan_text = plan_data.get("plan_text", response_text)
			steps_json = plan_data.get("steps", [])
		except json.JSONDecodeError:
			plan_text = response_text
			steps_json = []

		plan = TestPlan(
			session_id=session.id,
			plan_text=plan_text,
			steps_json={"steps": steps_json},
		)
		db.add(plan)

		session.status = "plan_ready"
		db.commit()
		db.refresh(plan)

		logger.info(f"Generated plan for session {session.id}")
		return plan

	except Exception as e:
		logger.error(f"Error generating plan: {e}")
		session.status = "failed"
		db.commit()
		raise


def get_plan_as_task(plan: TestPlan, is_continuation: bool = False) -> str:
	"""Convert a test plan to a task string for browser-use agent.

	Args:
		plan: The test plan to convert
		is_continuation: If True, tells the agent this is a continuation task
			and it should NOT navigate away from the current page state.
	"""
	steps = plan.steps_json.get("steps", []) if plan.steps_json else []

	if not steps:
		# For continuations with no structured steps, add the continuation instruction
		if is_continuation:
			return f"""IMPORTANT: You are continuing from an existing browser session.
The browser is already open with a page loaded. Do NOT navigate away, go to any URL, or reset the browser.
Execute the following task from the CURRENT page state:

{plan.plan_text}

CRITICAL: Do NOT use go_to_url, navigate, or any action that changes the current page URL.
Work only with elements on the current page."""
		return plan.plan_text

	task_lines = []

	if is_continuation:
		# Tell the agent to continue from current state with strong emphasis
		task_lines.append("=" * 60)
		task_lines.append("CONTINUATION MODE - READ CAREFULLY:")
		task_lines.append("=" * 60)
		task_lines.append("You are continuing from an existing browser session.")
		task_lines.append("The browser is ALREADY open with a page loaded.")
		task_lines.append("")
		task_lines.append("CRITICAL RULES:")
		task_lines.append("1. Do NOT use go_to_url action")
		task_lines.append("2. Do NOT navigate to any URL")
		task_lines.append("3. Do NOT reset or refresh the page")
		task_lines.append("4. Work ONLY with elements on the current page")
		task_lines.append("5. If you see a 'navigate' step below, SKIP IT - you're already there")
		task_lines.append("=" * 60)
		task_lines.append("")

	task_lines.append("Execute the following test plan:\n")
	for step in steps:
		step_num = step.get("step_number", "")
		description = step.get("description", "")
		details = step.get("details", "")
		action_type = step.get("action_type", "").lower()

		# For continuations, mark navigation steps as skip
		if is_continuation and action_type in ("navigate", "go_to_url", "open"):
			task_lines.append(f"{step_num}. [SKIP - ALREADY ON PAGE] {description}: {details}")
		else:
			task_lines.append(f"{step_num}. {description}: {details}")

	if is_continuation:
		task_lines.append("")
		task_lines.append("Remember: Do NOT navigate away from the current page!")

	return "\n".join(task_lines)


def update_plan_steps(
	db: Session,
	plan: TestPlan,
	steps: list[dict],
	user_prompt: str | None = None
) -> TestPlan:
	"""Update a plan with manually edited steps.

	Args:
		db: Database session
		plan: The test plan to update
		steps: Updated list of step dictionaries
		user_prompt: Optional user instructions to save with the plan

	Returns:
		Updated TestPlan
	"""
	# Renumber steps sequentially
	for i, step in enumerate(steps):
		step["step_number"] = i + 1

	# Update steps_json
	plan.steps_json = {"steps": steps}

	# Generate a brief plan_text summary (don't duplicate all steps - they're shown separately)
	num_steps = len(steps)
	if num_steps > 0:
		first_step = steps[0].get("description", "")
		last_step = steps[-1].get("description", "") if num_steps > 1 else ""
		if num_steps == 1:
			plan.plan_text = f"Test plan with 1 step: {first_step}"
		elif num_steps == 2:
			plan.plan_text = f"Test plan with 2 steps: {first_step} → {last_step}"
		else:
			plan.plan_text = f"Test plan with {num_steps} steps: {first_step} → ... → {last_step}"
	else:
		plan.plan_text = "Empty test plan"

	# Store user_prompt if provided (in a new field or as part of steps_json)
	if user_prompt:
		if plan.steps_json is None:
			plan.steps_json = {}
		plan.steps_json["user_prompt"] = user_prompt

	db.commit()
	db.refresh(plan)

	logger.info(f"Updated plan {plan.id} with {len(steps)} steps")
	return plan


PLAN_REGENERATE_PROMPT = """You are a QA automation expert. The user has manually edited a test plan and wants you to refine it based on their changes and additional instructions.

Original test case:
{original_prompt}

User's edited plan (steps):
{edited_steps}

User's refinement instructions:
{user_prompt}

Based on the user's edits and instructions, generate an improved test plan. Keep the user's edits in mind and incorporate their feedback.

Return the response in the following JSON format:
{{
    "plan_text": "A human-readable summary of the improved test plan",
    "steps": [
        {{
            "step_number": 1,
            "description": "Step description",
            "action_type": "navigate|click|type|scroll|wait|verify|etc",
            "details": "Detailed instructions for this step"
        }}
    ]
}}

Be specific and practical. Include verification steps where appropriate."""


async def regenerate_plan_with_context(
	db: Session,
	session: TestSession,
	plan: TestPlan,
	edited_steps: list[dict],
	user_prompt: str
) -> TestPlan:
	"""Regenerate a plan using AI with user's edits as context.

	Args:
		db: Database session
		session: Test session
		plan: Existing plan to update
		edited_steps: User's edited steps
		user_prompt: User's refinement instructions

	Returns:
		Updated TestPlan
	"""
	try:
		# Format edited steps for prompt
		edited_steps_text = json.dumps(edited_steps, indent=2)

		prompt = PLAN_REGENERATE_PROMPT.format(
			original_prompt=session.prompt,
			edited_steps=edited_steps_text,
			user_prompt=user_prompt
		)

		logger.info(f"Regenerating plan for session {session.id} with user edits...")
		logger.debug(f"Regeneration prompt:\n{prompt}")

		response = client.models.generate_content(
			model="gemini-2.0-flash",
			contents=prompt,
		)

		response_text = response.text

		# Try to parse as JSON
		try:
			# Remove markdown code blocks if present
			if response_text.startswith("```"):
				lines = response_text.split("\n")
				response_text = "\n".join(lines[1:-1])

			plan_data = json.loads(response_text)
			plan_text = plan_data.get("plan_text", response_text)
			steps_json = plan_data.get("steps", [])
		except json.JSONDecodeError:
			# If not valid JSON, use raw text
			plan_text = response_text
			steps_json = []

		# Update existing plan
		plan.plan_text = plan_text
		plan.steps_json = {"steps": steps_json, "user_prompt": user_prompt}

		db.commit()
		db.refresh(plan)

		logger.info(f"Regenerated plan {plan.id} for session {session.id}")
		return plan

	except Exception as e:
		logger.error(f"Error regenerating plan: {e}")
		raise
