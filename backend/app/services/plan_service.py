import json
import logging

from google import genai
from sqlalchemy.orm import Session

from app.config import settings
from app.models import TestPlan, TestSession, TestStep

logger = logging.getLogger(__name__)

# Create Gemini client
client = genai.Client(api_key=settings.GEMINI_API_KEY)

PLAN_GENERATION_PROMPT = """You are a QA automation expert. Given a user's test case description, create a detailed step-by-step plan for browser automation testing.

{execution_context}

User's request:
{prompt}

{continuation_instruction}

Generate a clear, actionable test plan with numbered steps. Each step should be a specific browser action that can be automated (e.g., navigate to URL, click button, fill form, verify text).

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

Be specific and practical. Include verification steps where appropriate.
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

		# For continuation plans (task_prompt provided), don't include any
		# previous context - generate a fresh plan from the new prompt only.
		# The browser-use agent will handle the actual browser state.
		is_continuation = task_prompt is not None

		if is_continuation:
			# No execution context for continuations - clean slate
			execution_context = ""
			continuation_instruction = """Note: A browser session is already active from previous tasks.
Generate a complete plan for this new task as a standalone request."""
			logger.info(f"Generating CONTINUATION plan (no context) for: {plan_prompt[:100]}...")
		else:
			# For new sessions, build context (will be empty anyway for new session)
			execution_context = build_execution_context(db, session)
			continuation_instruction = ""
			logger.info(f"Generating NEW session plan for: {plan_prompt[:100]}...")

		prompt = PLAN_GENERATION_PROMPT.format(
			execution_context=execution_context,
			prompt=plan_prompt,
			continuation_instruction=continuation_instruction
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


def get_plan_as_task(plan: TestPlan, is_continuation: bool = False) -> str:
	"""Convert a test plan to a task string for browser-use agent.

	Args:
		plan: The test plan to convert
		is_continuation: If True, tells the agent this is a continuation task
			and it should NOT navigate away from the current page state.
	"""
	steps = plan.steps_json.get("steps", []) if plan.steps_json else []

	if not steps:
		return plan.plan_text

	task_lines = []

	if is_continuation:
		# Tell the agent to continue from current state
		task_lines.append("IMPORTANT: You are continuing from an existing browser session.")
		task_lines.append("The browser is already open with a page loaded. Do NOT navigate away or reset.")
		task_lines.append("Start executing from the current page state.\n")

	task_lines.append("Execute the following test plan:\n")
	for step in steps:
		step_num = step.get("step_number", "")
		description = step.get("description", "")
		details = step.get("details", "")
		task_lines.append(f"{step_num}. {description}: {details}")

	return "\n".join(task_lines)
