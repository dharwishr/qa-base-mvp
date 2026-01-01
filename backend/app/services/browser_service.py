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
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import ChatMessage, StepAction, TestPlan, TestSession, TestStep
from app.schemas import StepActionResponse, TestStepResponse, WSCompleted, WSError, WSStepCompleted, WSStepStarted
from app.services.browser_orchestrator import (
	get_orchestrator,
	BrowserSession as OrchestratorSession,
	BrowserPhase,
	BrowserSessionStatus,
)

if TYPE_CHECKING:
	from browser_use.agent.service import Agent
	from browser_use.agent.views import AgentHistory, AgentHistoryList
	from browser_use.llm.base import BaseChatModel

logger = logging.getLogger(__name__)

# Flag to enable/disable remote browser orchestration
USE_REMOTE_BROWSER = True


class StopExecutionException(Exception):
	"""Raised when execution is stopped by user (pause or stop)."""
	pass


# Service registry to track active BrowserService instances
_active_browser_services: dict[str, "BrowserService"] = {}


def register_browser_service(session_id: str, service: "BrowserService") -> None:
	"""Register an active BrowserService for a session."""
	_active_browser_services[session_id] = service
	logger.info(f"Registered BrowserService for session {session_id}")


def get_active_browser_service(session_id: str) -> "BrowserService | None":
	"""Get the active BrowserService for a session."""
	return _active_browser_services.get(session_id)


def unregister_browser_service(session_id: str) -> None:
	"""Unregister a BrowserService for a session."""
	if session_id in _active_browser_services:
		del _active_browser_services[session_id]
		logger.info(f"Unregistered BrowserService for session {session_id}")


def get_llm_for_model(llm_model: str) -> "BaseChatModel":
	"""Get the LLM instance based on the model selection."""
	from app.config import settings
	from browser_use.llm.browser_use.chat import ChatBrowserUse
	from browser_use.llm.google.chat import ChatGoogle

	if llm_model == "browser-use-llm":
		return ChatBrowserUse(model="bu-latest", api_key=settings.BROWSER_USE_API_KEY)
	elif llm_model == "gemini-2.0-flash":
		return ChatGoogle(model="gemini-2.0-flash", api_key=settings.GEMINI_API_KEY)
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
		# Store immutable session data as plain values to avoid DetachedInstanceError
		# when the WebSocket closes and the SQLAlchemy session becomes invalid
		self._session_id: str = str(session.id)
		self._llm_model: str = session.llm_model
		self._headless: bool = getattr(session, 'headless', True)
		# Initialize step counter from max existing step number for this session
		# This ensures continuation executions don't restart step numbering from 1
		max_step = db.query(func.max(TestStep.step_number)).filter(
			TestStep.session_id == session.id
		).scalar()
		self.current_step_number = max_step or 0
		self.browser_session_id: str | None = None  # Remote browser session ID
		self._stop_requested = False  # Flag for graceful stop (pause/stop)

	async def send_ws_message(self, message: dict[str, Any]) -> None:
		"""Send a message through the WebSocket."""
		try:
			await self.websocket.send_json(message)
		except Exception as e:
			logger.error(f"Error sending WebSocket message: {e}")

	def request_stop(self) -> None:
		"""Request graceful stop after current step completes."""
		self._stop_requested = True
		logger.info(f"Stop requested for session {self._session_id}")

	def _create_chat_message(self, content: str, msg_type: str = "system") -> None:
		"""Helper to create a chat message for the session."""
		try:
			max_seq = self.db.query(func.max(ChatMessage.sequence_number)).filter(
				ChatMessage.session_id == self._session_id
			).scalar() or 0

			msg = ChatMessage(
				session_id=self._session_id,
				message_type=msg_type,
				content=content,
				sequence_number=max_seq + 1
			)
			self.db.add(msg)
			self.db.commit()
		except Exception as e:
			logger.error(f"Error creating chat message: {e}")

	def _update_session_status(self, status: str) -> None:
		"""Helper to update session status using raw SQL to avoid detached instance issues."""
		try:
			from app.models import TestSession as TestSessionModel
			self.db.query(TestSessionModel).filter(TestSessionModel.id == self._session_id).update(
				{"status": status}, synchronize_session=False
			)
			self.db.commit()
		except Exception as e:
			logger.error(f"Error updating session status: {e}")

	def _extract_target_url(self, plan: TestPlan) -> str | None:
		"""Extract the target URL from a test plan.

		Looks for:
		1. URL in the first navigate step
		2. URL pattern in the plan text
		"""
		import re

		# Try to find URL in steps
		if plan.steps_json:
			steps = plan.steps_json.get("steps", [])
			for step in steps:
				action_type = step.get("action_type", "").lower()
				if action_type in ("navigate", "go_to_url", "open"):
					details = step.get("details", "")
					# Extract URL from details
					url_match = re.search(r'https?://[^\s<>"{}|\\^`\[\]]+', details)
					if url_match:
						return url_match.group(0)

		# Try to find URL in plan_text
		if plan.plan_text:
			url_match = re.search(r'https?://[^\s<>"{}|\\^`\[\]]+', plan.plan_text)
			if url_match:
				return url_match.group(0)

		logger.warning("Could not extract target URL from plan")
		return None

	async def on_step_start(self, agent: "Agent") -> None:
		"""Called when a step starts."""
		# Check if stop was requested - raise exception to gracefully exit
		if self._stop_requested:
			logger.info(f"Stop requested, halting execution at step {self.current_step_number + 1}")
			raise StopExecutionException("Execution paused by user")

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
			# Touch browser session to prevent cleanup during long executions
			if self.browser_session_id:
				orchestrator = get_orchestrator()
				await orchestrator.touch_session(self.browser_session_id)

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
					screenshot_filename = f"{self._session_id}_{self.current_step_number}.png"
					dest_dir = Path(settings.SCREENSHOTS_DIR)
					dest_dir.mkdir(parents=True, exist_ok=True)
					dest_path = dest_dir / screenshot_filename
					shutil.copy2(temp_path, dest_path)
					logger.info(f"Screenshot saved to {dest_path}")

			# Create TestStep record
			test_step = TestStep(
				session_id=self._session_id,
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

	async def execute(self, plan: TestPlan, max_steps: int = 100) -> None:
		"""Execute the test plan using browser-use."""
		browser_session = None
		remote_session: OrchestratorSession | None = None

		# Register this service for pause/stop control
		register_browser_service(self._session_id, self)

		try:
			# Update session status using helper method
			self._update_session_status("running")

			# Import browser-use components (using QAAgent for test automation)
			from browser_use import BrowserSession
			from browser_use.agent.qa_agent import QAAgent
			from browser_use.tools.qa_tools import QATools

			# Get task from plan
			from app.services.plan_service import get_plan_as_task

			# Check if this is a continuation (session has previous steps)
			is_continuation = self.current_step_number > 0
			task = get_plan_as_task(plan, is_continuation=is_continuation)
			logger.info(f"[EXECUTION] is_continuation={is_continuation}, existing_steps={self.current_step_number}")
			if is_continuation:
				logger.info(f"[EXECUTION] CONTINUATION MODE: Browser will NOT navigate away from current page")

			# Initialize LLM based on session's selected model (use cached value)
			llm = get_llm_for_model(self._llm_model)
			logger.info(f"Using LLM model: {self._llm_model}")

			# Determine browser mode based on session.headless setting (use cached value)
			use_headless = self._headless
			logger.info(f"Browser mode: {'headless' if use_headless else 'live browser'}")

			# Initialize browser session based on headless setting
			if not use_headless:
				# Non-headless mode: use remote browser with live view
				try:
					orchestrator = get_orchestrator()

					# FIRST: Check if browser session already exists for this test session
					# Include non-active sessions to detect pre-warming in progress
					existing_sessions = await orchestrator.list_sessions(phase=BrowserPhase.ANALYSIS, active_only=False)
					existing_session = next(
						(s for s in existing_sessions if s.test_session_id == self._session_id),
						None
					)

					if existing_session:
						# Session found - check if it's ready or still pre-warming
						if existing_session.status in (BrowserSessionStatus.PENDING, BrowserSessionStatus.STARTING):
							# Pre-warming in progress - wait for it to complete
							logger.info(f"Found pre-warming browser session {existing_session.id}, waiting for it to be ready...")
							wait_start = asyncio.get_event_loop().time()
							max_wait = 30  # Wait up to 30 seconds for pre-warm to complete
							while existing_session.status in (BrowserSessionStatus.PENDING, BrowserSessionStatus.STARTING):
								if asyncio.get_event_loop().time() - wait_start > max_wait:
									logger.warning(f"Timeout waiting for pre-warmed session {existing_session.id}, creating new one")
									existing_session = None
									break
								await asyncio.sleep(0.5)
								# Refresh session status
								existing_session = orchestrator._sessions.get(existing_session.id)
								if not existing_session:
									logger.warning(f"Pre-warming session disappeared, creating new one")
									break

					if existing_session and existing_session.cdp_url:
						# REUSE existing browser session
						logger.info(f"Reusing existing browser session: {existing_session.id}, CDP: {existing_session.cdp_url}")
						remote_session = existing_session
						self.browser_session_id = existing_session.id

						# Touch session to prevent cleanup during execution
						await orchestrator.touch_session(existing_session.id)

						# Connect to existing browser via CDP
						browser_session = BrowserSession(
							cdp_url=existing_session.cdp_url,
							viewport={'width': 1920, 'height': 1080}
						)

						# Send live view URL to frontend (reusing existing session)
						await self.send_ws_message({
							"type": "browser_session_started",
							"session_id": remote_session.id,
							"cdp_url": remote_session.cdp_url,
							"live_view_url": f"/browser/sessions/{remote_session.id}/view",
							"headless": False,
							"reused": True,
						})
					else:
						# CREATE new browser session (no existing one found)
						remote_session = await orchestrator.create_session(
							phase=BrowserPhase.ANALYSIS,
							test_session_id=self._session_id,
						)
						self.browser_session_id = remote_session.id

						# Send live view URL to frontend
						await self.send_ws_message({
							"type": "browser_session_started",
							"session_id": remote_session.id,
							"cdp_url": remote_session.cdp_url,
							"live_view_url": f"/browser/sessions/{remote_session.id}/view",
							"headless": False,
						})

						logger.info(f"Created new remote browser session: {remote_session.id}, CDP: {remote_session.cdp_url}")

						# Connect to remote browser via CDP with 1920x1080 viewport
						browser_session = BrowserSession(
							cdp_url=remote_session.cdp_url,
							viewport={'width': 1920, 'height': 1080}
						)

				except Exception as e:
					logger.warning(f"Failed to create/reuse remote browser, falling back to local headless: {e}")
					browser_session = BrowserSession(headless=True, viewport={'width': 1920, 'height': 1080})
					# Notify frontend we're falling back to headless
					await self.send_ws_message({
						"type": "browser_session_started",
						"session_id": None,
						"headless": True,
						"fallback": True,
					})
			else:
				# Headless mode: use local headless browser (faster, no live view)
				browser_session = BrowserSession(headless=True, viewport={'width': 1920, 'height': 1080})
				# Notify frontend we're in headless mode (screenshots only)
				await self.send_ws_message({
					"type": "browser_session_started",
					"session_id": None,
					"headless": True,
				})

			# Extract target URL from plan for domain restrictions
			target_url = self._extract_target_url(plan)

			# Get test steps from plan for QAAgent
			test_steps = plan.steps_json.get("steps", []) if plan.steps_json else []

			# Create QA agent with domain restrictions and test automation focus
			agent = QAAgent(
				task=task,
				llm=llm,
				browser_session=browser_session,
				target_url=target_url,
				mode='act',  # Test execution mode
				test_steps=test_steps,
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
			self._update_session_status("completed" if success else "failed")

			# Send completion message
			await self.send_ws_message(
				WSCompleted(
					success=success,
					total_steps=len(history.history),
				).model_dump()
			)
			# Persist completion message for session history
			if success:
				self._create_chat_message(f"Test completed successfully with {len(history.history)} steps")
			else:
				self._create_chat_message("Test execution failed", "error")

			logger.info(f"Test execution completed. Success: {success}, Steps: {len(history.history)}")

		except StopExecutionException:
			# User requested pause - don't mark as failed, set to paused
			logger.info(f"Execution paused by user for session {self._session_id}")
			self._update_session_status("paused")

			await self.send_ws_message({
				"type": "execution_paused",
				"step_number": self.current_step_number,
				"message": "Execution paused. You can send new plan/act commands.",
			})
			# Persist paused message for session history
			self._create_chat_message("Execution paused. You can send new plan/act commands.")

		except Exception as e:
			logger.error(f"Error executing test: {e}")
			self._update_session_status("failed")

			await self.send_ws_message(WSError(message=str(e)).model_dump())
			# Persist error message for session history
			self._create_chat_message(f"Execution error: {str(e)}", "error")
			raise

		finally:
			# Unregister this service
			unregister_browser_service(self._session_id)
			# ALWAYS stop the browser_use BrowserSession to clean up CDP connection
			# This does NOT kill the browser - it just disconnects the CDP client
			# The browser container stays alive for reuse via the orchestrator
			if browser_session:
				try:
					await browser_session.stop()
					logger.info("Stopped browser_use session (CDP connection cleaned up, browser still alive)")
				except Exception as e:
					logger.error(f"Error stopping browser session: {e}")

			# Remote browser session (container) stays alive for user interaction
			# and will be reused when the next execution connects via CDP
			# Cleanup happens via:
			# 1. User clicking "Stop Browser" button
			# 2. Frontend calling end-browser API on page close
			# 3. Inactivity timeout (3 minutes, handled by frontend)
			if remote_session:
				logger.info(f"Remote browser session still alive for reuse: {remote_session.id}")


async def execute_test(db: Session, session: TestSession, plan: TestPlan, websocket: WebSocket) -> None:
	"""Execute a test plan and stream results via WebSocket."""
	service = BrowserService(db, session, websocket)
	await service.execute(plan)


class BrowserServiceSync:
	"""Browser service without WebSocket dependency for Celery workers."""

	def __init__(self, db: Session, session: TestSession):
		self.db = db
		self.session = session
		# Store immutable session data as plain values to avoid DetachedInstanceError
		self._session_id: str = str(session.id)
		self._llm_model: str = session.llm_model
		self._headless: bool = getattr(session, 'headless', True)
		# Initialize step counter from max existing step number for this session
		# This ensures continuation executions don't restart step numbering from 1
		max_step = db.query(func.max(TestStep.step_number)).filter(
			TestStep.session_id == session.id
		).scalar()
		self.current_step_number = max_step or 0
		self.browser_session_id: str | None = None  # Remote browser session ID

	def _create_chat_message(self, content: str, msg_type: str = "system") -> None:
		"""Helper to create a chat message for the session."""
		try:
			max_seq = self.db.query(func.max(ChatMessage.sequence_number)).filter(
				ChatMessage.session_id == self._session_id
			).scalar() or 0

			msg = ChatMessage(
				session_id=self._session_id,
				message_type=msg_type,
				content=content,
				sequence_number=max_seq + 1
			)
			self.db.add(msg)
			self.db.commit()
		except Exception as e:
			logger.error(f"Error creating chat message: {e}")

	def _update_session_status(self, status: str) -> None:
		"""Helper to update session status using raw SQL to avoid detached instance issues."""
		try:
			from app.models import TestSession as TestSessionModel
			self.db.query(TestSessionModel).filter(TestSessionModel.id == self._session_id).update(
				{"status": status}, synchronize_session=False
			)
			self.db.commit()
		except Exception as e:
			logger.error(f"Error updating session status: {e}")

	async def on_step_start(self, agent: "Agent") -> None:
		"""Called when a step starts."""
		self.current_step_number += 1
		logger.info(f"Step {self.current_step_number} started")

	async def on_step_end(self, agent: "Agent") -> None:
		"""Called when a step ends. Save step data to DB."""
		try:
			# Touch browser session to prevent cleanup during long executions
			if self.browser_session_id:
				orchestrator = get_orchestrator()
				await orchestrator.touch_session(self.browser_session_id)

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
					screenshot_filename = f"{self._session_id}_{self.current_step_number}.png"
					dest_dir = Path(settings.SCREENSHOTS_DIR)
					dest_dir.mkdir(parents=True, exist_ok=True)
					dest_path = dest_dir / screenshot_filename
					shutil.copy2(temp_path, dest_path)
					logger.info(f"Screenshot saved to {dest_path}")

			# Create TestStep record
			test_step = TestStep(
				session_id=self._session_id,
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

	async def execute(self, plan: TestPlan, max_steps: int = 100) -> dict:
		"""Execute the test plan using browser-use."""
		browser_session = None
		remote_session: OrchestratorSession | None = None

		try:
			# Update session status using helper method
			self._update_session_status("running")

			# Import browser-use components
			from browser_use import Agent, BrowserSession

			# Get task from plan
			from app.services.plan_service import get_plan_as_task

			# Check if this is a continuation (session has previous steps)
			is_continuation = self.current_step_number > 0
			task = get_plan_as_task(plan, is_continuation=is_continuation)
			logger.info(f"[EXECUTION] is_continuation={is_continuation}, existing_steps={self.current_step_number}")
			if is_continuation:
				logger.info(f"[EXECUTION] CONTINUATION MODE: Browser will NOT navigate away from current page")

			# Initialize LLM based on session's selected model (use cached value)
			llm = get_llm_for_model(self._llm_model)
			logger.info(f"Using LLM model: {self._llm_model}")

			# Determine browser mode based on session.headless setting (use cached value)
			use_headless = self._headless
			logger.info(f"Browser mode: {'headless' if use_headless else 'live browser'}")

			# Variable for remote session cleanup
			remote_session = None

			# Initialize browser session based on headless setting
			if not use_headless:
				# Non-headless mode: use test-browser container with live VNC view
				try:
					orchestrator = get_orchestrator()

					# FIRST: Check if browser session already exists for this test session
					# Include non-active sessions to detect pre-warming in progress
					existing_sessions = await orchestrator.list_sessions(phase=BrowserPhase.ANALYSIS, active_only=False)
					existing_session = next(
						(s for s in existing_sessions if s.test_session_id == self._session_id),
						None
					)

					if existing_session:
						# Session found - check if it's ready or still pre-warming
						if existing_session.status in (BrowserSessionStatus.PENDING, BrowserSessionStatus.STARTING):
							# Pre-warming in progress - wait for it to complete
							logger.info(f"Found pre-warming browser session {existing_session.id}, waiting for it to be ready...")
							wait_start = asyncio.get_event_loop().time()
							max_wait = 30  # Wait up to 30 seconds for pre-warm to complete
							while existing_session.status in (BrowserSessionStatus.PENDING, BrowserSessionStatus.STARTING):
								if asyncio.get_event_loop().time() - wait_start > max_wait:
									logger.warning(f"Timeout waiting for pre-warmed session {existing_session.id}, creating new one")
									existing_session = None
									break
								await asyncio.sleep(0.5)
								# Refresh session status
								existing_session = orchestrator._sessions.get(existing_session.id)
								if not existing_session:
									logger.warning(f"Pre-warming session disappeared, creating new one")
									break

					if existing_session and existing_session.cdp_url:
						# REUSE existing browser session
						logger.info(f"Reusing existing browser session: {existing_session.id}, CDP: {existing_session.cdp_url}")
						remote_session = existing_session
						self.browser_session_id = existing_session.id

						# Touch session to prevent cleanup during execution
						await orchestrator.touch_session(existing_session.id)

						# Connect to existing browser via CDP
						browser_session = BrowserSession(
							cdp_url=existing_session.cdp_url,
							viewport={'width': 1920, 'height': 1080}
						)
					else:
						# CREATE new browser session (no existing one found)
						remote_session = await orchestrator.create_session(
							phase=BrowserPhase.ANALYSIS,
							test_session_id=self._session_id,
						)
						self.browser_session_id = remote_session.id
						logger.info(f"Created new remote browser session: {remote_session.id}, CDP: {remote_session.cdp_url}")

						# Connect browser-use to the browser via CDP directly
						cdp_url = remote_session.cdp_url
						if not cdp_url:
							raise Exception("CDP URL not available from remote session")

						logger.info(f"Connecting to browser via CDP: {cdp_url}")
						browser_session = BrowserSession(
							cdp_url=cdp_url,
							viewport={'width': 1920, 'height': 1080}
						)
				except Exception as e:
					logger.warning(f"Failed to create/reuse remote browser, falling back to local headless: {e}")
					browser_session = BrowserSession(headless=True, viewport={'width': 1920, 'height': 1080})
			else:
				# Headless mode: use local headless browser (faster, no live view)
				browser_session = BrowserSession(headless=True, viewport={'width': 1920, 'height': 1080})

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

			# Update session status using helper method
			self._update_session_status("completed" if success else "failed")

			# Persist completion message for session history
			if success:
				self._create_chat_message(f"Test completed successfully with {len(history.history)} steps")
			else:
				self._create_chat_message("Test execution failed", "error")

			logger.info(f"Test execution completed. Success: {success}, Steps: {len(history.history)}")

			return {
				"success": success,
				"total_steps": len(history.history),
				"browser_session_id": remote_session.id if remote_session else None,
			}

		except Exception as e:
			logger.error(f"Error executing test: {e}")
			self._update_session_status("failed")
			# Persist error message for session history
			self._create_chat_message(f"Execution error: {str(e)}", "error")
			raise

		finally:
			# ALWAYS stop the browser_use BrowserSession to clean up CDP connection
			# This does NOT kill the browser - it just disconnects the CDP client
			# The browser container stays alive for reuse via the orchestrator
			if browser_session:
				try:
					await browser_session.stop()
					logger.info("Stopped browser_use session (CDP connection cleaned up, browser still alive)")
				except Exception as e:
					logger.error(f"Error stopping browser session: {e}")

			# Remote browser session (container) stays alive for user interaction
			# and will be reused when the next execution connects via CDP
			# Cleanup happens via:
			# 1. User clicking "Stop Browser" button
			# 2. Frontend calling end-browser API on page close
			# 3. Inactivity timeout (3 minutes, handled by frontend)
			if remote_session:
				logger.info(f"Remote browser session still alive for reuse: {remote_session.id}")

	async def execute_act_mode(self, task: str, previous_context: str | None = None) -> dict[str, Any]:
		"""Execute a single action in act mode.

		Args:
			task: The user's action request (e.g., "click the login button")
			previous_context: Optional context from previous execution results

		Returns:
			dict with execution results including action_taken, thinking, browser_state, etc.
		"""
		from browser_use import BrowserSession

		from app.services.single_step_service import execute_single_step

		browser_session = None
		remote_session: OrchestratorSession | None = None

		try:
			# Determine browser mode based on session.headless setting
			use_headless = getattr(self.session, 'headless', True)
			logger.info(f"Act mode - Browser mode: {'headless' if use_headless else 'live browser'}")

			# Initialize browser session based on headless setting
			if not use_headless:
				# Non-headless mode: use remote browser with live view
				try:
					orchestrator = get_orchestrator()

					# Check if browser session already exists for this test session
					# Include non-active sessions to detect pre-warming in progress
					existing_sessions = await orchestrator.list_sessions(phase=BrowserPhase.ANALYSIS, active_only=False)
					existing_session = next(
						(s for s in existing_sessions if s.test_session_id == self._session_id),
						None
					)

					if existing_session:
						# Session found - check if it's ready or still pre-warming
						if existing_session.status in (BrowserSessionStatus.PENDING, BrowserSessionStatus.STARTING):
							# Pre-warming in progress - wait for it to complete
							logger.info(f"Act mode - Found pre-warming browser session {existing_session.id}, waiting...")
							wait_start = asyncio.get_event_loop().time()
							max_wait = 30
							while existing_session.status in (BrowserSessionStatus.PENDING, BrowserSessionStatus.STARTING):
								if asyncio.get_event_loop().time() - wait_start > max_wait:
									logger.warning(f"Act mode - Timeout waiting for pre-warmed session {existing_session.id}")
									existing_session = None
									break
								await asyncio.sleep(0.5)
								existing_session = orchestrator._sessions.get(existing_session.id)
								if not existing_session:
									break

					if existing_session and existing_session.cdp_url:
						# REUSE existing browser session
						logger.info(f"Act mode - Reusing existing browser session: {existing_session.id}")
						remote_session = existing_session
						self.browser_session_id = existing_session.id

						# Touch session to prevent cleanup during execution
						await orchestrator.touch_session(existing_session.id)

						# Connect to existing browser via CDP
						browser_session = BrowserSession(
							cdp_url=existing_session.cdp_url,
							viewport={'width': 1920, 'height': 1080}
						)
					else:
						# CREATE new browser session
						remote_session = await orchestrator.create_session(
							phase=BrowserPhase.ANALYSIS,
							test_session_id=self._session_id,
						)
						self.browser_session_id = remote_session.id
						logger.info(f"Act mode - Created new browser session: {remote_session.id}")

						# Connect browser-use to the browser via CDP
						browser_session = BrowserSession(
							cdp_url=remote_session.cdp_url,
							viewport={'width': 1920, 'height': 1080}
						)
				except Exception as e:
					logger.warning(f"Act mode - Failed to use remote browser, falling back to headless: {e}")
					browser_session = BrowserSession(headless=True, viewport={'width': 1920, 'height': 1080})
			else:
				# Headless mode: use local headless browser
				browser_session = BrowserSession(headless=True, viewport={'width': 1920, 'height': 1080})

			# Execute single action using SingleStepActService
			result = await execute_single_step(
				db=self.db,
				session=self.session,
				browser_session=browser_session,
				task=task,
				previous_context=previous_context,
			)

			# Add browser session ID to result for frontend reference
			result["browser_session_id"] = remote_session.id if remote_session else None

			logger.info(f"Act mode - Action completed: {result.get('action_taken')}")

			return result

		except Exception as e:
			logger.error(f"Act mode execution failed: {e}")
			return {
				"success": False,
				"action_taken": None,
				"thinking": None,
				"evaluation": None,
				"memory": None,
				"next_goal": None,
				"result": [],
				"browser_state": {"url": None, "title": None},
				"screenshot_path": None,
				"browser_session_id": remote_session.id if remote_session else None,
				"error": str(e),
			}

		finally:
			# ALWAYS stop the browser_use BrowserSession to clean up CDP connection
			# This does NOT kill the browser - it just disconnects the CDP client
			# The browser container stays alive for reuse via the orchestrator
			if browser_session:
				try:
					await browser_session.stop()
					logger.info("Act mode - Stopped browser_use session (CDP cleaned up, browser still alive)")
				except Exception as e:
					logger.error(f"Act mode - Error stopping browser session: {e}")

			# Remote browser session (container) stays alive for next action
			# Cleanup happens via user action or inactivity timeout
			if remote_session:
				logger.info(f"Act mode - Remote browser session still alive: {remote_session.id}")


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


def execute_act_mode_sync(
	db: Session,
	session: TestSession,
	task: str,
	previous_context: str | None = None
) -> dict:
	"""Execute a single action synchronously (for Act mode API).

	Args:
		db: Database session.
		session: Test session to execute on.
		task: The action to perform.
		previous_context: Optional context from previous actions.

	Returns:
		Dict with execution results.
	"""
	import asyncio

	from app.services.single_step_service import execute_single_step
	from browser_use import BrowserSession

	from app.services.browser_orchestrator import (
		get_orchestrator,
		BrowserPhase,
	)

	async def _execute():
		browser_session = None
		remote_session = None

		try:
			use_headless = getattr(session, 'headless', True)
			logger.info(f"Act mode sync - Browser mode: {'headless' if use_headless else 'live browser'}")

			if not use_headless:
				try:
					orchestrator = get_orchestrator()
					existing_sessions = await orchestrator.list_sessions(phase=BrowserPhase.ANALYSIS)
					existing_session = next(
						(s for s in existing_sessions if s.test_session_id == session.id),
						None
					)

					if existing_session and existing_session.cdp_url:
						logger.info(f"Act mode sync - Reusing browser session: {existing_session.id}")
						remote_session = existing_session
						browser_session = BrowserSession(
							cdp_url=existing_session.cdp_url,
							viewport={'width': 1920, 'height': 1080}
						)
					else:
						remote_session = await orchestrator.create_session(
							phase=BrowserPhase.ANALYSIS,
							test_session_id=session.id,
						)
						logger.info(f"Act mode sync - Created browser session: {remote_session.id}")
						browser_session = BrowserSession(
							cdp_url=remote_session.cdp_url,
							viewport={'width': 1920, 'height': 1080}
						)
				except Exception as e:
					logger.warning(f"Act mode sync - Failed to use remote browser: {e}")
					browser_session = BrowserSession(headless=True, viewport={'width': 1920, 'height': 1080})
			else:
				browser_session = BrowserSession(headless=True, viewport={'width': 1920, 'height': 1080})

			result = await execute_single_step(
				db=db,
				session=session,
				browser_session=browser_session,
				task=task,
				previous_context=previous_context,
			)

			result["browser_session_id"] = remote_session.id if remote_session else None
			return result

		except Exception as e:
			logger.error(f"Act mode sync execution failed: {e}")
			return {
				"success": False,
				"action_taken": None,
				"thinking": None,
				"evaluation": None,
				"memory": None,
				"next_goal": None,
				"result": [],
				"browser_state": {"url": None, "title": None},
				"screenshot_path": None,
				"browser_session_id": remote_session.id if remote_session else None,
				"error": str(e),
			}

		finally:
			# ALWAYS stop the browser_use BrowserSession to clean up CDP connection
			# This does NOT kill the browser - it just disconnects the CDP client
			if browser_session:
				try:
					await browser_session.stop()
					logger.info("Act mode sync - Stopped browser_use session (CDP cleaned up)")
				except Exception as e:
					logger.error(f"Act mode sync - Error stopping browser session: {e}")

			if remote_session:
				logger.info(f"Act mode sync - Remote browser session still alive: {remote_session.id}")

	loop = asyncio.new_event_loop()
	asyncio.set_event_loop(loop)
	try:
		return loop.run_until_complete(_execute())
	finally:
		loop.close()
