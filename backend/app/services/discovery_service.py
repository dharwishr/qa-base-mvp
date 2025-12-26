"""
Discovery service for module discovery using browser-use agent.
"""
import asyncio
import logging
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

# Add browser_use to Python path BEFORE any browser_use imports
_browser_use_path = str(Path(__file__).resolve().parent.parent.parent.parent)
if _browser_use_path not in sys.path:
	sys.path.insert(0, _browser_use_path)

from sqlalchemy.orm import Session

from app.models import DiscoverySession, DiscoveredModule
from app.config import settings

if TYPE_CHECKING:
	from browser_use.agent.service import Agent

logger = logging.getLogger(__name__)


def get_discovery_llm():
	"""Get the LLM instance for discovery (uses Gemini 2.5 Flash)."""
	from browser_use.llm.google.chat import ChatGoogle
	return ChatGoogle(model="gemini-2.5-flash", api_key=settings.GEMINI_API_KEY)


def construct_discovery_prompt(session: DiscoverySession) -> str:
	"""Construct the agent prompt for module discovery."""
	prompt = f"Navigate to {session.url}."

	if session.username and session.password:
		prompt += f"\n\nIf a login screen appears, use username: '{session.username}' and password: '{session.password}'."

	prompt += """

	As you navigate, identify distinct 'modules' or pages of the application.
	A module is a unique page with a specific purpose (e.g., Dashboard, Settings, User Profile).

	When you find a link to a potential new module:
	1. Navigate to that page.
	2. Analyze the page content to understand its purpose.
	3. IMMEDIATELY use the 'register_module' tool to report it with a summary based on the ACTUAL page content.

	Do not register a module without visiting it first.
	Do not wait until the end of the task to report modules.

	At the end of the task, just provide a summary of what you did.
	"""
	return prompt


class DiscoveryServiceSync:
	"""Service for running module discovery in Celery worker."""

	def __init__(self, db: Session, session: DiscoverySession):
		self.db = db
		self.session = session
		self.current_step_number = 0
		self.discovered_modules: list[DiscoveredModule] = []

	async def on_step_start(self, agent: "Agent") -> None:
		"""Called when a step starts."""
		self.current_step_number += 1
		logger.info(f"Discovery step {self.current_step_number} started")

	async def on_step_end(self, agent: "Agent") -> None:
		"""Called when a step ends."""
		logger.info(f"Discovery step {self.current_step_number} completed")

	async def execute(self) -> dict:
		"""Execute module discovery crawl."""
		browser_session = None

		try:
			# Update session status
			self.session.status = "running"
			self.db.commit()

			# Import browser-use components
			from browser_use import Agent, BrowserSession, Controller

			# Initialize LLM
			llm = get_discovery_llm()
			logger.info("Using Gemini 2.5 Flash for discovery")

			# Construct discovery prompt
			task_prompt = construct_discovery_prompt(self.session)

			# Create controller with register_module action
			controller = Controller()

			@controller.action("Register a discovered module")
			def register_module(name: str, url: str, summary: str):
				"""
				Register a discovered module with its name, URL, and a short summary.
				Use this immediately when you find a new module.
				"""
				module = DiscoveredModule(
					session_id=self.session.id,
					name=name,
					url=url,
					summary=summary,
				)
				self.db.add(module)
				self.db.commit()
				self.discovered_modules.append(module)
				logger.info(f"Registered module: {name} at {url}")
				return f"Registered module: {name}"

			# Create headless browser session
			browser_session = BrowserSession(
				headless=True,
				viewport={"width": 1920, "height": 1080}
			)

			# Create agent with controller
			agent = Agent(
				task=task_prompt,
				llm=llm,
				browser_session=browser_session,
				controller=controller,
				use_vision=True,
				max_failures=3,
			)

			# Run agent
			history = await agent.run(
				max_steps=self.session.max_steps,
				on_step_start=self.on_step_start,
				on_step_end=self.on_step_end,
			)

			# Check if successful
			success = history.is_successful() if history.is_done() else False

			# Update session
			self.session.status = "completed" if success else "failed"
			self.session.total_steps = len(history.history)
			self.session.duration_seconds = history.total_duration_seconds()
			self.db.commit()

			logger.info(
				f"Discovery completed. Success: {success}, "
				f"Steps: {len(history.history)}, "
				f"Modules found: {len(self.discovered_modules)}"
			)

			return {
				"success": success,
				"total_steps": len(history.history),
				"modules_found": len(self.discovered_modules),
				"duration_seconds": history.total_duration_seconds(),
			}

		except Exception as e:
			logger.error(f"Error during discovery: {e}")
			self.session.status = "failed"
			self.session.error = str(e)
			self.db.commit()
			raise

		finally:
			if browser_session:
				try:
					await browser_session.stop()
					logger.info("Stopped browser session")
				except Exception as e:
					logger.error(f"Error stopping browser session: {e}")


def execute_discovery_sync(db: Session, session: DiscoverySession) -> dict:
	"""Execute discovery synchronously (for Celery worker).

	Runs the async execution in a new event loop.
	"""
	service = DiscoveryServiceSync(db, session)

	# Run in new event loop for async agent
	loop = asyncio.new_event_loop()
	asyncio.set_event_loop(loop)
	try:
		return loop.run_until_complete(service.execute())
	finally:
		loop.close()
