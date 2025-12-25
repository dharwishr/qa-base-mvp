import asyncio
import logging
import shutil
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

# Add browser_use to Python path BEFORE any browser_use imports
_browser_use_path = str(Path(__file__).resolve().parent.parent.parent.parent)
if _browser_use_path not in sys.path:
	sys.path.insert(0, _browser_use_path)

from fastapi import WebSocket
from sqlalchemy.orm import Session

from app.models import StepAction, TestPlan, TestSession, TestStep
from app.schemas import StepActionResponse, TestStepResponse, WSCompleted, WSError, WSStepCompleted, WSStepStarted

if TYPE_CHECKING:
	from browser_use.agent.service import Agent
	from browser_use.agent.views import AgentHistory, AgentHistoryList
	from browser_use.llm.base import BaseChatModel

logger = logging.getLogger(__name__)


def get_llm_for_model(llm_model: str) -> "BaseChatModel":
	"""Get the LLM instance based on the model selection."""
	from app.config import settings
	from browser_use.llm.browser_use.chat import ChatBrowserUse
	from browser_use.llm.google.chat import ChatGoogle

	if llm_model == "browser-use-llm":
		return ChatBrowserUse(model="bu-latest", api_key=settings.BROWSER_USE_API_KEY)
	elif llm_model == "gemini-2.5-flash":
		return ChatGoogle(model="gemini-2.5-flash", api_key=settings.GEMINI_API_KEY)
	elif llm_model == "gemini-2.5-pro":
		return ChatGoogle(model="gemini-2.5-pro", api_key=settings.GEMINI_API_KEY)
	elif llm_model == "gemini-3.0-flash":
		return ChatGoogle(model="gemini-3-flash-preview", api_key=settings.GEMINI_API_KEY)
	elif llm_model == "gemini-3.0-pro":
		return ChatGoogle(model="gemini-3-pro-preview", api_key=settings.GEMINI_API_KEY)
	elif llm_model == "gemini-2.5-computer-use":
		return ChatGoogle(model="gemini-2.5-flash", api_key=settings.GEMINI_API_KEY)
	else:
		# Default to browser-use-llm
		return ChatBrowserUse(model="bu-latest", api_key=settings.BROWSER_USE_API_KEY)


class BrowserService:
	"""Service for executing tests using browser-use."""

	def __init__(self, db: Session, session: TestSession, websocket: WebSocket):
		self.db = db
		self.session = session
		self.websocket = websocket
		self.current_step_number = 0

	async def send_ws_message(self, message: dict[str, Any]) -> None:
		"""Send a message through the WebSocket."""
		try:
			await self.websocket.send_json(message)
		except Exception as e:
			logger.error(f"Error sending WebSocket message: {e}")

	async def on_step_start(self, agent: "Agent") -> None:
		"""Called when a step starts."""
		self.current_step_number += 1
		logger.info(f"Step {self.current_step_number} started")

		# Send step started message
		await self.send_ws_message(
			WSStepStarted(
				step_number=self.current_step_number,
				goal=None,  # Will be filled after LLM response
			).model_dump()
		)

	async def on_step_end(self, agent: "Agent") -> None:
		"""Called when a step ends. Save step data to DB and send to WebSocket."""
		try:
			# Get the latest history item
			if not agent.history.history:
				return

			history_item: "AgentHistory" = agent.history.history[-1]

			# Extract data from history item
			model_output = history_item.model_output
			state = history_item.state
			results = history_item.result

			# Copy screenshot to persistent storage
			screenshot_filename = None
			if state and state.screenshot_path:
				from app.config import settings
				temp_path = Path(state.screenshot_path)
				if temp_path.exists():
					screenshot_filename = f"{self.session.id}_{self.current_step_number}.png"
					dest_dir = Path(settings.SCREENSHOTS_DIR)
					dest_dir.mkdir(parents=True, exist_ok=True)
					dest_path = dest_dir / screenshot_filename
					shutil.copy2(temp_path, dest_path)
					logger.info(f"Screenshot saved to {dest_path}")

			# Create TestStep record
			test_step = TestStep(
				session_id=self.session.id,
				step_number=self.current_step_number,
				url=state.url if state else None,
				page_title=state.title if state else None,
				thinking=model_output.current_state.thinking if model_output and model_output.current_state else None,
				evaluation=model_output.current_state.evaluation_previous_goal if model_output and model_output.current_state else None,
				memory=model_output.current_state.memory if model_output and model_output.current_state else None,
				next_goal=model_output.current_state.next_goal if model_output and model_output.current_state else None,
				screenshot_path=screenshot_filename,  # Store only filename, not full path
				status="completed",
			)

			self.db.add(test_step)
			self.db.flush()  # Get the step ID

			# Create StepAction records
			actions_response = []
			if model_output and model_output.action:
				for idx, action in enumerate(model_output.action):
					# Get action name and params
					action_data = action.model_dump(exclude_unset=True)
					action_name = next(iter(action_data.keys()), "unknown")
					action_params = action_data.get(action_name, {})

					# Get result for this action
					result = results[idx] if idx < len(results) else None
					result_success = None
					result_error = None
					extracted_content = None

					if result:
						result_success = result.error is None
						result_error = result.error
						extracted_content = result.extracted_content

					# Get interacted element info
					element_xpath = None
					element_name = None
					if state and state.interacted_element and idx < len(state.interacted_element):
						element = state.interacted_element[idx]
						if element:
							element_xpath = element.x_path if hasattr(element, "x_path") else None
							element_name = element.ax_name if hasattr(element, "ax_name") else None

					step_action = StepAction(
						step_id=test_step.id,
						action_index=idx,
						action_name=action_name,
						action_params=action_params if isinstance(action_params, dict) else {},
						result_success=result_success,
						result_error=result_error,
						extracted_content=extracted_content,
						element_xpath=element_xpath,
						element_name=element_name,
					)
					self.db.add(step_action)
					self.db.flush()  # Get the action ID

					actions_response.append(
						StepActionResponse(
							id=step_action.id,
							action_index=idx,
							action_name=action_name,
							action_params=action_params if isinstance(action_params, dict) else {},
							result_success=result_success,
							result_error=result_error,
							extracted_content=extracted_content,
							element_xpath=element_xpath,
							element_name=element_name,
						)
					)

			self.db.commit()
			self.db.refresh(test_step)

			# Send step completed message
			step_response = TestStepResponse(
				id=test_step.id,
				step_number=test_step.step_number,
				url=test_step.url,
				page_title=test_step.page_title,
				thinking=test_step.thinking,
				evaluation=test_step.evaluation,
				memory=test_step.memory,
				next_goal=test_step.next_goal,
				screenshot_path=test_step.screenshot_path,
				status=test_step.status,
				error=test_step.error,
				created_at=test_step.created_at,
				actions=actions_response,
			)

			await self.send_ws_message(WSStepCompleted(step=step_response).model_dump(mode="json"))

			logger.info(f"Step {self.current_step_number} completed and saved")

		except Exception as e:
			logger.error(f"Error in on_step_end: {e}")
			raise

	async def execute(self, plan: TestPlan, max_steps: int = 20) -> None:
		"""Execute the test plan using browser-use."""
		try:
			# Update session status
			self.session.status = "running"
			self.db.commit()

			# Import browser-use components
			from browser_use import Agent, BrowserSession

			# Get task from plan
			from app.services.plan_service import get_plan_as_task

			task = get_plan_as_task(plan)

			# Initialize LLM based on session's selected model
			llm = get_llm_for_model(self.session.llm_model)
			logger.info(f"Using LLM model: {self.session.llm_model}")

			# Initialize browser session (headless mode for Docker/server)
			browser_session = BrowserSession(headless=True)

			# Create agent
			agent = Agent(
				task=task,
				llm=llm,
				browser_session=browser_session,
				use_vision=True,
				max_failures=3,
			)

			# Run agent with callbacks
			history = await agent.run(
				max_steps=max_steps,
				on_step_start=self.on_step_start,
				on_step_end=self.on_step_end,
			)

			# Check if successful
			success = history.is_successful() if history.is_done() else False

			# Update session status
			self.session.status = "completed" if success else "failed"
			self.db.commit()

			# Send completion message
			await self.send_ws_message(
				WSCompleted(
					success=success,
					total_steps=len(history.history),
				).model_dump()
			)

			logger.info(f"Test execution completed. Success: {success}, Steps: {len(history.history)}")

		except Exception as e:
			logger.error(f"Error executing test: {e}")
			self.session.status = "failed"
			self.db.commit()

			await self.send_ws_message(WSError(message=str(e)).model_dump())
			raise

		finally:
			# Clean up browser session
			try:
				if "browser_session" in locals():
					await browser_session.stop()
			except Exception as e:
				logger.error(f"Error stopping browser session: {e}")


async def execute_test(db: Session, session: TestSession, plan: TestPlan, websocket: WebSocket) -> None:
	"""Execute a test plan and stream results via WebSocket."""
	service = BrowserService(db, session, websocket)
	await service.execute(plan)


class BrowserServiceSync:
	"""Browser service without WebSocket dependency for Celery workers."""

	def __init__(self, db: Session, session: TestSession):
		self.db = db
		self.session = session
		self.current_step_number = 0

	async def on_step_start(self, agent: "Agent") -> None:
		"""Called when a step starts."""
		self.current_step_number += 1
		logger.info(f"Step {self.current_step_number} started")

	async def on_step_end(self, agent: "Agent") -> None:
		"""Called when a step ends. Save step data to DB."""
		try:
			# Get the latest history item
			if not agent.history.history:
				return

			history_item: "AgentHistory" = agent.history.history[-1]

			# Extract data from history item
			model_output = history_item.model_output
			state = history_item.state
			results = history_item.result

			# Copy screenshot to persistent storage
			screenshot_filename = None
			if state and state.screenshot_path:
				from app.config import settings

				temp_path = Path(state.screenshot_path)
				if temp_path.exists():
					screenshot_filename = f"{self.session.id}_{self.current_step_number}.png"
					dest_dir = Path(settings.SCREENSHOTS_DIR)
					dest_dir.mkdir(parents=True, exist_ok=True)
					dest_path = dest_dir / screenshot_filename
					shutil.copy2(temp_path, dest_path)
					logger.info(f"Screenshot saved to {dest_path}")

			# Create TestStep record
			test_step = TestStep(
				session_id=self.session.id,
				step_number=self.current_step_number,
				url=state.url if state else None,
				page_title=state.title if state else None,
				thinking=model_output.current_state.thinking if model_output and model_output.current_state else None,
				evaluation=model_output.current_state.evaluation_previous_goal if model_output and model_output.current_state else None,
				memory=model_output.current_state.memory if model_output and model_output.current_state else None,
				next_goal=model_output.current_state.next_goal if model_output and model_output.current_state else None,
				screenshot_path=screenshot_filename,
				status="completed",
			)

			self.db.add(test_step)
			self.db.flush()

			# Create StepAction records
			if model_output and model_output.action:
				for idx, action in enumerate(model_output.action):
					# Get action name and params
					action_data = action.model_dump(exclude_unset=True)
					action_name = next(iter(action_data.keys()), "unknown")
					action_params = action_data.get(action_name, {})

					# Get result for this action
					result = results[idx] if idx < len(results) else None
					result_success = None
					result_error = None
					extracted_content = None

					if result:
						result_success = result.error is None
						result_error = result.error
						extracted_content = result.extracted_content

					# Get interacted element info
					element_xpath = None
					element_name = None
					if state and state.interacted_element and idx < len(state.interacted_element):
						element = state.interacted_element[idx]
						if element:
							element_xpath = element.x_path if hasattr(element, "x_path") else None
							element_name = element.ax_name if hasattr(element, "ax_name") else None

					step_action = StepAction(
						step_id=test_step.id,
						action_index=idx,
						action_name=action_name,
						action_params=action_params if isinstance(action_params, dict) else {},
						result_success=result_success,
						result_error=result_error,
						extracted_content=extracted_content,
						element_xpath=element_xpath,
						element_name=element_name,
					)
					self.db.add(step_action)

			self.db.commit()
			logger.info(f"Step {self.current_step_number} completed and saved")

		except Exception as e:
			logger.error(f"Error in on_step_end: {e}")
			raise

	async def execute(self, plan: TestPlan, max_steps: int = 20) -> dict:
		"""Execute the test plan using browser-use."""
		try:
			# Update session status
			self.session.status = "running"
			self.db.commit()

			# Import browser-use components
			from browser_use import Agent, BrowserSession

			# Get task from plan
			from app.services.plan_service import get_plan_as_task

			task = get_plan_as_task(plan)

			# Initialize LLM based on session's selected model
			llm = get_llm_for_model(self.session.llm_model)
			logger.info(f"Using LLM model: {self.session.llm_model}")

			# Initialize browser session (headless mode for Docker/server)
			browser_session = BrowserSession(headless=True)

			# Create agent
			agent = Agent(
				task=task,
				llm=llm,
				browser_session=browser_session,
				use_vision=True,
				max_failures=3,
			)

			# Run agent with callbacks
			history = await agent.run(
				max_steps=max_steps,
				on_step_start=self.on_step_start,
				on_step_end=self.on_step_end,
			)

			# Check if successful
			success = history.is_successful() if history.is_done() else False

			# Update session status
			self.session.status = "completed" if success else "failed"
			self.db.commit()

			logger.info(f"Test execution completed. Success: {success}, Steps: {len(history.history)}")

			return {
				"success": success,
				"total_steps": len(history.history),
			}

		except Exception as e:
			logger.error(f"Error executing test: {e}")
			self.session.status = "failed"
			self.db.commit()
			raise

		finally:
			# Clean up browser session
			try:
				if "browser_session" in locals():
					await browser_session.stop()
			except Exception as e:
				logger.error(f"Error stopping browser session: {e}")


def execute_test_sync(db: Session, session: TestSession, plan: TestPlan) -> dict:
	"""Execute test synchronously (for Celery worker).

	Runs the async execution in a new event loop.
	"""
	import asyncio

	service = BrowserServiceSync(db, session)

	# Run in new event loop for async agent
	loop = asyncio.new_event_loop()
	asyncio.set_event_loop(loop)
	try:
		return loop.run_until_complete(service.execute(plan))
	finally:
		loop.close()
