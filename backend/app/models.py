from datetime import datetime
from typing import Any
from uuid import uuid4
import re

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text, Boolean, Enum as SQLEnum, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def generate_uuid() -> str:
	return str(uuid4())


def generate_slug(name: str) -> str:
	"""Generate a URL-friendly slug from a name."""
	slug = name.lower().strip()
	slug = re.sub(r'[^\w\s-]', '', slug)
	slug = re.sub(r'[-\s]+', '-', slug)
	return slug[:50]


# ============================================
# Organization & User Models
# ============================================

class Organization(Base):
	"""Organization/tenant model for multi-tenancy."""

	__tablename__ = "organizations"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	name: Mapped[str] = mapped_column(String(256), nullable=False)
	slug: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
	description: Mapped[str | None] = mapped_column(Text, nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
	updated_at: Mapped[datetime] = mapped_column(
		DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
	)

	# Relationships
	user_associations: Mapped[list["UserOrganization"]] = relationship(
		"UserOrganization", back_populates="organization", cascade="all, delete-orphan"
	)


class User(Base):
	"""User model for authentication."""

	__tablename__ = "users"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	name: Mapped[str] = mapped_column(String(256), nullable=False)
	email: Mapped[str] = mapped_column(String(256), nullable=False, unique=True, index=True)
	password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
	updated_at: Mapped[datetime] = mapped_column(
		DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
	)

	# Relationships
	organization_associations: Mapped[list["UserOrganization"]] = relationship(
		"UserOrganization", back_populates="user", cascade="all, delete-orphan"
	)


class UserOrganization(Base):
	"""Association table for User-Organization many-to-many with role."""

	__tablename__ = "user_organizations"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	user_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
	)
	organization_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
	)
	role: Mapped[str] = mapped_column(
		String(20), nullable=False, default="member"
	)  # owner | member
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
	updated_at: Mapped[datetime] = mapped_column(
		DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
	)

	# Unique constraint: user can only be in an org once
	__table_args__ = (
		UniqueConstraint('user_id', 'organization_id', name='uq_user_organization'),
	)

	# Relationships
	user: Mapped["User"] = relationship("User", back_populates="organization_associations")
	organization: Mapped["Organization"] = relationship("Organization", back_populates="user_associations")


class TestSession(Base):
	"""Main session for a test case analysis."""

	__tablename__ = "test_sessions"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	organization_id: Mapped[str | None] = mapped_column(
		String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True
	)
	user_id: Mapped[str | None] = mapped_column(
		String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
	)
	prompt: Mapped[str] = mapped_column(Text, nullable=False)
	title: Mapped[str | None] = mapped_column(String(200), nullable=True)  # Auto-generated from first prompt
	llm_model: Mapped[str] = mapped_column(
		String(50), nullable=False, default="gemini-2.5-flash"
	)  # browser-use-llm | gemini-2.0-flash | gemini-2.5-flash | gemini-3.0-flash | gemini-2.5-computer-use
	headless: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)  # True = headless (default), False = live browser
	status: Mapped[str] = mapped_column(
		String(20), nullable=False, default="pending_plan"
	)  # pending_plan | generating_plan | plan_ready | approved | queued | running | completed | failed | paused | cancelled
	celery_task_id: Mapped[str | None] = mapped_column(String(50), nullable=True)

	# Celery task IDs for different task types
	plan_task_id: Mapped[str | None] = mapped_column(String(50), nullable=True)  # Plan generation task
	execution_task_id: Mapped[str | None] = mapped_column(String(50), nullable=True)  # Plan execution task

	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
	updated_at: Mapped[datetime] = mapped_column(
		DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
	)

	# Relationships
	organization: Mapped["Organization | None"] = relationship("Organization")
	user: Mapped["User | None"] = relationship("User")
	plan: Mapped["TestPlan | None"] = relationship(
		"TestPlan", back_populates="session", uselist=False
	)
	steps: Mapped[list["TestStep"]] = relationship(
		"TestStep", back_populates="session", order_by="TestStep.step_number"
	)
	logs: Mapped[list["ExecutionLog"]] = relationship(
		"ExecutionLog", back_populates="session", cascade="all, delete-orphan"
	)
	messages: Mapped[list["ChatMessage"]] = relationship(
		"ChatMessage", back_populates="session", cascade="all, delete-orphan",
		order_by="ChatMessage.sequence_number"
	)
	events: Mapped[list["AnalysisEvent"]] = relationship(
		"AnalysisEvent", back_populates="session", cascade="all, delete-orphan",
		order_by="AnalysisEvent.created_at"
	)


class TestPlan(Base):
	"""Generated plan from LLM."""

	__tablename__ = "test_plans"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	session_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("test_sessions.id"), nullable=False
	)
	plan_text: Mapped[str] = mapped_column(Text, nullable=False)
	steps_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

	# Approval tracking
	approval_status: Mapped[str] = mapped_column(
		String(20), nullable=False, default="pending"
	)  # pending | approved | rejected
	approval_timestamp: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
	rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

	# Relationships
	session: Mapped["TestSession"] = relationship("TestSession", back_populates="plan")


class TestStep(Base):
	"""Each step from browser-use execution."""

	__tablename__ = "test_steps"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	session_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("test_sessions.id"), nullable=False
	)
	step_number: Mapped[int] = mapped_column(Integer, nullable=False)
	url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
	page_title: Mapped[str | None] = mapped_column(String(512), nullable=True)
	thinking: Mapped[str | None] = mapped_column(Text, nullable=True)
	evaluation: Mapped[str | None] = mapped_column(Text, nullable=True)
	memory: Mapped[str | None] = mapped_column(Text, nullable=True)
	next_goal: Mapped[str | None] = mapped_column(Text, nullable=True)
	screenshot_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
	status: Mapped[str] = mapped_column(
		String(20), nullable=False, default="pending"
	)  # pending | running | completed | failed
	error: Mapped[str | None] = mapped_column(Text, nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

	# Relationships
	session: Mapped["TestSession"] = relationship("TestSession", back_populates="steps")
	actions: Mapped[list["StepAction"]] = relationship(
		"StepAction", back_populates="step", order_by="StepAction.action_index"
	)


class StepAction(Base):
	"""Actions within a step."""

	__tablename__ = "step_actions"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	step_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("test_steps.id"), nullable=False
	)
	action_index: Mapped[int] = mapped_column(Integer, nullable=False)
	action_name: Mapped[str] = mapped_column(
		String(100), nullable=False
	)  # click_element, type_text, etc.
	action_params: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
	result_success: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
	result_error: Mapped[str | None] = mapped_column(Text, nullable=True)
	extracted_content: Mapped[str | None] = mapped_column(Text, nullable=True)
	element_xpath: Mapped[str | None] = mapped_column(String(1024), nullable=True)
	element_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

	# Relationships
	step: Mapped["TestStep"] = relationship("TestStep", back_populates="actions")


class ExecutionLog(Base):
	"""Logs captured during test execution."""

	__tablename__ = "execution_logs"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	session_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("test_sessions.id"), nullable=False
	)
	level: Mapped[str] = mapped_column(String(20), nullable=False)  # DEBUG | INFO | WARNING | ERROR
	message: Mapped[str] = mapped_column(Text, nullable=False)
	source: Mapped[str | None] = mapped_column(String(100), nullable=True)  # logger name
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

	# Relationships
	session: Mapped["TestSession"] = relationship("TestSession", back_populates="logs")


class AnalysisEvent(Base):
	"""Persistent log of all analysis events for replay and live display.

	Events are logged to DB for persistence AND published to Redis for real-time streaming.
	This enables:
	- Reconnection: Client can fetch past events from DB
	- Live display: New events streamed via WebSocket
	- Debugging: Full audit trail of analysis execution
	"""

	__tablename__ = "analysis_events"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	session_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("test_sessions.id"), nullable=False, index=True
	)
	event_type: Mapped[str] = mapped_column(
		String(50), nullable=False
	)  # plan_started | plan_progress | plan_completed | step_started | step_completed | etc.
	event_data: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=True)  # Full event payload
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

	# Relationships
	session: Mapped["TestSession"] = relationship("TestSession", back_populates="events")


class PlaywrightScript(Base):
	"""Generated Playwright script from AI analysis - can be run without AI."""

	__tablename__ = "playwright_scripts"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	organization_id: Mapped[str | None] = mapped_column(
		String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True
	)
	user_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
	)
	session_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("test_sessions.id"), nullable=False
	)
	name: Mapped[str] = mapped_column(String(256), nullable=False)
	description: Mapped[str | None] = mapped_column(Text, nullable=True)
	steps_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
	updated_at: Mapped[datetime] = mapped_column(
		DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
	)

	# Relationships
	session: Mapped["TestSession"] = relationship("TestSession", backref="scripts")
	runs: Mapped[list["TestRun"]] = relationship(
		"TestRun", back_populates="script", order_by="TestRun.created_at.desc()", cascade="all, delete-orphan"
	)


class TestRun(Base):
	"""A single execution of a PlaywrightScript (no AI involved)."""

	__tablename__ = "test_runs"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	script_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("playwright_scripts.id"), nullable=False
	)
	user_id: Mapped[str | None] = mapped_column(
		String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
	)
	status: Mapped[str] = mapped_column(
		String(20), nullable=False, default="pending"
	)  # pending | running | passed | failed | healed
	runner_type: Mapped[str] = mapped_column(
		String(20), nullable=False, default="playwright"
	)  # playwright | cdp
	headless: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)  # True = headless (default), False = live browser

	# Run Configuration (NEW)
	browser_type: Mapped[str] = mapped_column(
		String(20), nullable=False, default="chromium"
	)  # chromium | firefox | webkit | edge
	resolution_width: Mapped[int] = mapped_column(Integer, nullable=False, default=1920)
	resolution_height: Mapped[int] = mapped_column(Integer, nullable=False, default=1080)
	screenshots_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
	recording_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
	network_recording_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
	performance_metrics_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

	# Output paths (NEW)
	video_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
	duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)  # Total run duration

	started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
	completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
	total_steps: Mapped[int] = mapped_column(Integer, default=0)
	passed_steps: Mapped[int] = mapped_column(Integer, default=0)
	failed_steps: Mapped[int] = mapped_column(Integer, default=0)
	healed_steps: Mapped[int] = mapped_column(Integer, default=0)
	error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

	# Relationships
	script: Mapped["PlaywrightScript"] = relationship("PlaywrightScript", back_populates="runs")
	user: Mapped["User | None"] = relationship("User")
	run_steps: Mapped[list["RunStep"]] = relationship(
		"RunStep", back_populates="run", order_by="RunStep.step_index", cascade="all, delete-orphan"
	)
	network_requests: Mapped[list["NetworkRequest"]] = relationship(
		"NetworkRequest", back_populates="run", order_by="NetworkRequest.started_at", cascade="all, delete-orphan"
	)
	console_logs: Mapped[list["ConsoleLog"]] = relationship(
		"ConsoleLog", back_populates="run", order_by="ConsoleLog.timestamp", cascade="all, delete-orphan"
	)


class RunStep(Base):
	"""Result of each step in a TestRun."""

	__tablename__ = "run_steps"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	run_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("test_runs.id"), nullable=False
	)
	step_index: Mapped[int] = mapped_column(Integer, nullable=False)
	action: Mapped[str] = mapped_column(String(50), nullable=False)  # goto | click | fill | etc.
	status: Mapped[str] = mapped_column(
		String(20), nullable=False, default="pending"
	)  # pending | running | passed | failed | healed | skipped
	selector_used: Mapped[str | None] = mapped_column(Text, nullable=True)
	screenshot_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
	duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
	error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
	heal_attempts: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

	# Relationships
	run: Mapped["TestRun"] = relationship("TestRun", back_populates="run_steps")


class ChatMessage(Base):
	"""Chat message for test analysis session."""

	__tablename__ = "chat_messages"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	session_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("test_sessions.id"), nullable=False
	)

	# Message type: 'user' | 'assistant' | 'plan' | 'step' | 'error' | 'system'
	message_type: Mapped[str] = mapped_column(String(20), nullable=False)

	# Content for text messages
	content: Mapped[str | None] = mapped_column(Text, nullable=True)

	# For user messages: 'plan' | 'act'
	mode: Mapped[str | None] = mapped_column(String(10), nullable=True)

	# Sequence for ordering
	sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)

	# Optional references for plan/step messages
	plan_id: Mapped[str | None] = mapped_column(
		String(36), ForeignKey("test_plans.id"), nullable=True
	)
	step_id: Mapped[str | None] = mapped_column(
		String(36), ForeignKey("test_steps.id"), nullable=True
	)

	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

	# Relationships
	session: Mapped["TestSession"] = relationship("TestSession", back_populates="messages")


class DiscoverySession(Base):
	"""Session for module discovery - crawls a website to identify application modules."""

	__tablename__ = "discovery_sessions"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	organization_id: Mapped[str | None] = mapped_column(
		String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True
	)
	user_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
	)
	url: Mapped[str] = mapped_column(String(2048), nullable=False)  # Target URL to crawl
	username: Mapped[str | None] = mapped_column(String(256), nullable=True)  # Optional login
	password: Mapped[str | None] = mapped_column(String(256), nullable=True)
	max_steps: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
	status: Mapped[str] = mapped_column(
		String(20), nullable=False, default="pending"
	)  # pending | queued | running | completed | failed
	celery_task_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
	total_steps: Mapped[int] = mapped_column(Integer, default=0)
	duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
	error: Mapped[str | None] = mapped_column(Text, nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
	updated_at: Mapped[datetime] = mapped_column(
		DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
	)

	# Relationships
	modules: Mapped[list["DiscoveredModule"]] = relationship(
		"DiscoveredModule", back_populates="session", cascade="all, delete-orphan"
	)


class DiscoveredModule(Base):
	"""A discovered application module from the discovery crawl."""

	__tablename__ = "discovered_modules"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	session_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("discovery_sessions.id"), nullable=False
	)
	name: Mapped[str] = mapped_column(String(256), nullable=False)
	url: Mapped[str] = mapped_column(String(2048), nullable=False)
	summary: Mapped[str] = mapped_column(Text, nullable=False)
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

	# Relationships
	session: Mapped["DiscoverySession"] = relationship("DiscoverySession", back_populates="modules")


class BenchmarkSession(Base):
	"""Main benchmark session for comparing LLM models on a test case."""

	__tablename__ = "benchmark_sessions"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	organization_id: Mapped[str | None] = mapped_column(
		String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True
	)
	user_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
	)
	prompt: Mapped[str] = mapped_column(Text, nullable=False)
	title: Mapped[str | None] = mapped_column(String(200), nullable=True)
	selected_models: Mapped[list[str]] = mapped_column(JSON, nullable=False)
	headless: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
	mode: Mapped[str] = mapped_column(
		String(20), nullable=False, default="auto"
	)  # auto | plan | act
	status: Mapped[str] = mapped_column(
		String(20), nullable=False, default="pending"
	)  # pending | planning | plan_ready | running | completed | failed
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
	updated_at: Mapped[datetime] = mapped_column(
		DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
	)

	# Relationships
	model_runs: Mapped[list["BenchmarkModelRun"]] = relationship(
		"BenchmarkModelRun", back_populates="benchmark_session", cascade="all, delete-orphan"
	)


class BenchmarkModelRun(Base):
	"""Each model run within a benchmark session."""

	__tablename__ = "benchmark_model_runs"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	benchmark_session_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("benchmark_sessions.id"), nullable=False
	)
	llm_model: Mapped[str] = mapped_column(String(50), nullable=False)
	test_session_id: Mapped[str | None] = mapped_column(
		String(36), ForeignKey("test_sessions.id"), nullable=True
	)
	celery_task_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
	status: Mapped[str] = mapped_column(
		String(20), nullable=False, default="pending"
	)  # pending | planning | plan_ready | approved | rejected | queued | running | completed | failed
	started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
	completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
	total_steps: Mapped[int] = mapped_column(Integer, default=0)
	duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
	error: Mapped[str | None] = mapped_column(Text, nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

	# Relationships
	benchmark_session: Mapped["BenchmarkSession"] = relationship(
		"BenchmarkSession", back_populates="model_runs"
	)
	test_session: Mapped["TestSession | None"] = relationship("TestSession")


class NetworkRequest(Base):
	"""Captured network request/response during test run."""

	__tablename__ = "network_requests"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	run_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("test_runs.id"), nullable=False
	)
	step_index: Mapped[int | None] = mapped_column(Integer, nullable=True)  # Which step triggered this

	# Request details
	url: Mapped[str] = mapped_column(String(4096), nullable=False)
	method: Mapped[str] = mapped_column(String(10), nullable=False)  # GET, POST, etc.
	resource_type: Mapped[str | None] = mapped_column(String(50), nullable=True)  # document, xhr, fetch, script, etc.
	request_headers: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
	request_body: Mapped[str | None] = mapped_column(Text, nullable=True)

	# Response details
	status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
	response_headers: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
	response_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)

	# Timing breakdown (Performance API style)
	timing_dns_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
	timing_connect_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
	timing_ssl_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
	timing_ttfb_ms: Mapped[float | None] = mapped_column(Float, nullable=True)  # Time to first byte
	timing_download_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
	timing_total_ms: Mapped[float | None] = mapped_column(Float, nullable=True)

	started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
	completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

	# Relationships
	run: Mapped["TestRun"] = relationship("TestRun", back_populates="network_requests")


class ConsoleLog(Base):
	"""Browser console log captured during test run."""

	__tablename__ = "console_logs"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	run_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("test_runs.id"), nullable=False
	)
	step_index: Mapped[int | None] = mapped_column(Integer, nullable=True)

	level: Mapped[str] = mapped_column(String(20), nullable=False)  # log, info, warn, error, debug
	message: Mapped[str] = mapped_column(Text, nullable=False)
	source: Mapped[str | None] = mapped_column(String(2048), nullable=True)  # URL of source
	line_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
	column_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
	stack_trace: Mapped[str | None] = mapped_column(Text, nullable=True)

	timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

	# Relationships
	run: Mapped["TestRun"] = relationship("TestRun", back_populates="console_logs")


class SystemSettings(Base):
	"""System-wide configuration settings (singleton table)."""

	__tablename__ = "system_settings"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default="default")  # Single row
	isolation_mode: Mapped[str] = mapped_column(
		String(20), nullable=False, default="context"
	)  # context | ephemeral
	updated_at: Mapped[datetime] = mapped_column(
		DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
	)
