import json
import logging

from google import genai
from sqlalchemy.orm import Session

from app.config import settings
from app.models import TestPlan, TestSession

logger = logging.getLogger(__name__)

# Create Gemini client
client = genai.Client(api_key=settings.GEMINI_API_KEY)

PLAN_GENERATION_PROMPT = """You are a QA automation expert. Given a user's test case description, create a detailed step-by-step plan for browser automation testing.

User's test case description:
{prompt}

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


async def generate_plan(db: Session, session: TestSession) -> TestPlan:
	"""Generate a test plan using Gemini 2.0 Flash."""
	try:
		prompt = PLAN_GENERATION_PROMPT.format(prompt=session.prompt)

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


def get_plan_as_task(plan: TestPlan) -> str:
	"""Convert a test plan to a task string for browser-use agent."""
	steps = plan.steps_json.get("steps", []) if plan.steps_json else []

	if not steps:
		return plan.plan_text

	task_lines = [f"Execute the following test plan:\n"]
	for step in steps:
		step_num = step.get("step_number", "")
		description = step.get("description", "")
		details = step.get("details", "")
		task_lines.append(f"{step_num}. {description}: {details}")

	return "\n".join(task_lines)
