"""
Single-step execution service for act mode.

This service executes single browser actions without the iterative feedback loops
that the browser-use Agent typically uses. It's designed for "act mode" where users
issue one command at a time and see immediate results.

Uses QAAgent for strict QA mode behavior - no external searches, domain restrictions.
"""

import logging
import re
import shutil
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import Session

from app.config import settings
from app.models import TestSession, TestStep, StepAction
from app.services.browser_service import get_llm_for_model
from app.services.browser_orchestrator import (
	get_orchestrator,
	BrowserSession as OrchestratorSession,
	BrowserPhase,
)

if TYPE_CHECKING:
	from browser_use import BrowserSession
	from browser_use.agent.service import Agent
	from browser_use.agent.views import AgentStepInfo

logger = logging.getLogger(__name__)


def extract_target_url_from_context(url: str | None, previous_context: str | None) -> str | None:
	"""Extract target URL from current URL or previous context."""
	if url:
		return url

	if previous_context:
		url_match = re.search(r'https?://[^\s<>"{}|\\^`\[\]]+', previous_context)
		if url_match:
			return url_match.group(0)

	return None


class SingleStepActService:
	"""
	Service for executing single-step browser actions without iterative loops.

	The browser-use Agent is designed for multi-step task completion with iterative
	feedback. In "act mode", we need single actions that execute immediately and
	return results without planning ahead.
	"""

	def __init__(
		self,
		db: Session,
		session: TestSession,
		browser_session: "BrowserSession",
		llm_model: str = "gemini-2.5-flash"
	):
		self.db = db
		self.session = session
		self.browser_session = browser_session
		self.llm_model = llm_model

	async def execute_single_action(
		self,
		task: str,
		previous_context: str | None = None
	) -> dict[str, Any]:
		"""
		Execute a single action based on the task.

		Args:
			task: The user's action request (e.g., "click the login button")
			previous_context: Optional context from previous execution results

		Returns:
			dict with keys: success, action_taken, thinking, result, browser_state, error
		"""
		from browser_use.agent.qa_agent import QAAgent
		from browser_use.agent.views import AgentStepInfo

		try:
			# Get current browser state BEFORE action
			browser_state_before = await self.browser_session.get_browser_state_summary(
				include_screenshot=True
			)

			logger.info(f"Single step: Current URL: {browser_state_before.url}, Title: {browser_state_before.title}")

			# Extract target URL for domain restrictions
			target_url = extract_target_url_from_context(browser_state_before.url, previous_context)

			# Build enhanced task with context
			enhanced_task = self._build_single_step_task(
				task=task,
				url=browser_state_before.url,
				title=browser_state_before.title,
				previous_context=previous_context
			)

			# Initialize LLM
			llm = get_llm_for_model(self.llm_model)

			# Create QA agent with single-step configuration and domain restrictions
			agent = QAAgent(
				task=enhanced_task,
				llm=llm,
				browser_session=self.browser_session,
				target_url=target_url,
				mode='act',  # Test execution mode
				use_vision=True,
				max_failures=1,  # Fail fast for single actions
				max_actions_per_step=1,  # Only one action per step
				use_thinking=True,  # Still want to see reasoning
			)

			# Execute exactly ONE step
			step_info = AgentStepInfo(step_number=0, max_steps=1)
			await agent.step(step_info)

			# Get results from agent state
			model_output = agent.state.last_model_output
			result = agent.state.last_result

			# Get browser state AFTER action
			browser_state_after = await self.browser_session.get_browser_state_summary(
				include_screenshot=True
			)

			# Extract action summary
			action_taken = self._extract_action_summary(model_output)

			# Save screenshot
			screenshot_path = None
			if browser_state_after.screenshot_path:
				screenshot_path = await self._save_screenshot(browser_state_after.screenshot_path)

			logger.info(f"Single step completed: {action_taken}")

			return {
				"success": True,
				"action_taken": action_taken,
				"thinking": model_output.current_state.thinking if model_output and model_output.current_state else None,
				"evaluation": model_output.current_state.evaluation_previous_goal if model_output and model_output.current_state else None,
				"memory": model_output.current_state.memory if model_output and model_output.current_state else None,
				"next_goal": model_output.current_state.next_goal if model_output and model_output.current_state else None,
				"result": [r.model_dump() if hasattr(r, 'model_dump') else str(r) for r in result] if result else [],
				"browser_state": {
					"url": browser_state_after.url,
					"title": browser_state_after.title,
				},
				"screenshot_path": screenshot_path,
				"error": None,
			}

		except Exception as e:
			logger.error(f"Single step execution failed: {e}")

			# Try to get current browser state for error response
			error_browser_state = {"url": None, "title": None}
			try:
				current_state = await self.browser_session.get_browser_state_summary()
				error_browser_state = {
					"url": current_state.url,
					"title": current_state.title,
				}
			except Exception:
				pass

			return {
				"success": False,
				"action_taken": None,
				"thinking": None,
				"evaluation": None,
				"memory": None,
				"next_goal": None,
				"result": [],
				"browser_state": error_browser_state,
				"screenshot_path": None,
				"error": str(e),
			}

	def _build_single_step_task(
		self,
		task: str,
		url: str | None,
		title: str | None,
		previous_context: str | None
	) -> str:
		"""Build task string with current browser context."""
		context_parts = []

		if url:
			context_parts.append(f"Current URL: {url}")
		if title:
			context_parts.append(f"Page Title: {title}")
		if previous_context:
			context_parts.append(f"Previous action context: {previous_context}")

		context = "\n".join(context_parts) if context_parts else "No context available"

		return f"""Execute this SINGLE action immediately:
{task}

Current browser state:
{context}

IMPORTANT RULES:
1. Execute ONLY ONE action to accomplish the user's request
2. Do NOT plan multiple steps ahead
3. Do NOT use the 'done' action unless the user explicitly asked to finish
4. Report exactly what action you took and what happened
5. If the action cannot be performed, explain why clearly"""

	def _get_single_step_system_extension(self) -> str:
		"""Get system prompt extension for single-step mode."""
		return """
=== SINGLE-STEP MODE ACTIVE ===

You are operating in SINGLE-STEP MODE. This means:

1. EXECUTE ONE ACTION ONLY
   - The user gives you one command at a time
   - Execute that single action and report what happened
   - Do NOT plan or execute multiple actions

2. NO ITERATIVE PLANNING
   - Do NOT think about "what to do next"
   - Do NOT set goals for future steps
   - Focus ONLY on the current user request

3. IMMEDIATE FEEDBACK
   - After executing the action, the user will see the result
   - They will then give you the next command
   - You don't need to remember or plan beyond this step

4. NO 'done' ACTION
   - Do NOT use the 'done' action unless the user explicitly said "finish" or "done"
   - Each action request is independent

5. CLEAR REPORTING
   - State clearly what action you took
   - Report any errors or issues immediately
   - Be specific about element interactions (what you clicked, what you typed, etc.)
"""

	def _extract_action_summary(self, model_output) -> str | None:
		"""Extract a human-readable action summary from model output."""
		if not model_output or not model_output.action:
			return None

		actions = []
		for action in model_output.action:
			try:
				action_data = action.model_dump(exclude_none=True, exclude_unset=True)
				if action_data:
					# Get the action name (first key that's not metadata)
					action_name = None
					action_params = None
					for key, value in action_data.items():
						if value is not None and key not in ('id', 'type'):
							action_name = key
							action_params = value
							break

					if action_name:
						if isinstance(action_params, dict):
							params_str = ", ".join(f"{k}={v}" for k, v in action_params.items() if v is not None)
							actions.append(f"{action_name}({params_str})")
						else:
							actions.append(f"{action_name}({action_params})")
			except Exception as e:
				logger.warning(f"Failed to extract action summary: {e}")
				continue

		return ", ".join(actions) if actions else None

	async def _save_screenshot(self, temp_screenshot_path: str) -> str | None:
		"""Save screenshot to persistent storage."""
		try:
			from sqlalchemy import func

			# Get next step number
			max_step = self.db.query(func.max(TestStep.step_number)).filter(
				TestStep.session_id == self.session.id
			).scalar()
			step_number = (max_step or 0) + 1

			temp_path = Path(temp_screenshot_path)
			if temp_path.exists():
				screenshot_filename = f"{self.session.id}_{step_number}.png"
				dest_dir = Path(settings.SCREENSHOTS_DIR)
				dest_dir.mkdir(parents=True, exist_ok=True)
				dest_path = dest_dir / screenshot_filename
				shutil.copy2(temp_path, dest_path)
				logger.info(f"Screenshot saved to {dest_path}")
				return screenshot_filename
		except Exception as e:
			logger.error(f"Failed to save screenshot: {e}")

		return None


async def execute_single_step(
	db: Session,
	session: TestSession,
	browser_session: "BrowserSession",
	task: str,
	previous_context: str | None = None,
) -> dict[str, Any]:
	"""
	Convenience function to execute a single step.

	Args:
		db: Database session
		session: Test session
		browser_session: Browser session from browser-use
		task: User's action request
		previous_context: Optional context from previous actions

	Returns:
		dict with execution results
	"""
	service = SingleStepActService(
		db=db,
		session=session,
		browser_session=browser_session,
		llm_model=session.llm_model
	)
	return await service.execute_single_action(task, previous_context)
