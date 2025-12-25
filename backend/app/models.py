from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def generate_uuid() -> str:
	return str(uuid4())


class TestSession(Base):
	"""Main session for a test case analysis."""

	__tablename__ = "test_sessions"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	prompt: Mapped[str] = mapped_column(Text, nullable=False)
	llm_model: Mapped[str] = mapped_column(
		String(50), nullable=False, default="gemini-2.5-flash"
	)  # browser-use-llm | gemini-2.5-flash | gemini-3.0-flash | gemini-2.5-computer-use
	status: Mapped[str] = mapped_column(
		String(20), nullable=False, default="pending_plan"
	)  # pending_plan | plan_ready | approved | queued | running | completed | failed
	celery_task_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
	updated_at: Mapped[datetime] = mapped_column(
		DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
	)

	# Relationships
	plan: Mapped["TestPlan | None"] = relationship(
		"TestPlan", back_populates="session", uselist=False
	)
	steps: Mapped[list["TestStep"]] = relationship(
		"TestStep", back_populates="session", order_by="TestStep.step_number"
	)
	logs: Mapped[list["ExecutionLog"]] = relationship(
		"ExecutionLog", back_populates="session", cascade="all, delete-orphan"
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


class PlaywrightScript(Base):
	"""Generated Playwright script from AI analysis - can be run without AI."""

	__tablename__ = "playwright_scripts"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
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
		"TestRun", back_populates="script", order_by="TestRun.created_at.desc()"
	)


class TestRun(Base):
	"""A single execution of a PlaywrightScript (no AI involved)."""

	__tablename__ = "test_runs"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
	script_id: Mapped[str] = mapped_column(
		String(36), ForeignKey("playwright_scripts.id"), nullable=False
	)
	status: Mapped[str] = mapped_column(
		String(20), nullable=False, default="pending"
	)  # pending | running | passed | failed | healed
	runner_type: Mapped[str] = mapped_column(
		String(20), nullable=False, default="playwright"
	)  # playwright | cdp
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
	run_steps: Mapped[list["RunStep"]] = relationship(
		"RunStep", back_populates="run", order_by="RunStep.step_index", cascade="all, delete-orphan"
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
