from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# Request schemas
class CreateSessionRequest(BaseModel):
	prompt: str = Field(..., min_length=1, description="The QA task prompt")
	llm_model: str = Field(
		default="gemini-2.5-flash",
		description="LLM model for browser automation: browser-use-llm | gemini-2.5-flash | gemini-3.0-flash | gemini-2.5-computer-use"
	)


# Response schemas
class StepActionResponse(BaseModel):
	id: str
	action_index: int
	action_name: str
	action_params: dict[str, Any] | None = None
	result_success: bool | None = None
	result_error: str | None = None
	extracted_content: str | None = None
	element_xpath: str | None = None
	element_name: str | None = None

	class Config:
		from_attributes = True


class TestStepResponse(BaseModel):
	id: str
	step_number: int
	url: str | None = None
	page_title: str | None = None
	thinking: str | None = None
	evaluation: str | None = None
	memory: str | None = None
	next_goal: str | None = None
	screenshot_path: str | None = None
	status: str
	error: str | None = None
	created_at: datetime
	actions: list[StepActionResponse] = []

	class Config:
		from_attributes = True


class TestPlanResponse(BaseModel):
	id: str
	plan_text: str
	steps_json: dict[str, Any] | None = None
	created_at: datetime

	class Config:
		from_attributes = True


class TestSessionResponse(BaseModel):
	id: str
	prompt: str
	llm_model: str
	status: str
	celery_task_id: str | None = None
	created_at: datetime
	updated_at: datetime
	plan: TestPlanResponse | None = None

	class Config:
		from_attributes = True


class TestSessionListResponse(BaseModel):
	"""Response schema for listing sessions with step count."""
	id: str
	prompt: str
	llm_model: str
	status: str
	created_at: datetime
	updated_at: datetime
	step_count: int = 0

	class Config:
		from_attributes = True


class TestSessionDetailResponse(TestSessionResponse):
	steps: list[TestStepResponse] = []


# WebSocket message schemas
class WSMessage(BaseModel):
	type: str


class WSStepStarted(WSMessage):
	type: str = "step_started"
	step_number: int
	goal: str | None = None


class WSStepCompleted(WSMessage):
	type: str = "step_completed"
	step: TestStepResponse


class WSCompleted(WSMessage):
	type: str = "completed"
	success: bool
	total_steps: int


class WSError(WSMessage):
	type: str = "error"
	message: str


class WSPlanGenerated(WSMessage):
	type: str = "plan_generated"
	plan: TestPlanResponse


# Execution response schemas
class ExecuteResponse(BaseModel):
	task_id: str
	status: str


class StopResponse(BaseModel):
	status: str
	message: str


class ExecutionLogResponse(BaseModel):
	id: str
	level: str
	message: str
	source: str | None = None
	created_at: datetime

	class Config:
		from_attributes = True


# ============================================
# Playwright Script & Test Run Schemas
# ============================================

class CreateScriptRequest(BaseModel):
	"""Request to create a Playwright script from a session."""
	session_id: str = Field(..., description="ID of the test session to generate script from")
	name: str = Field(..., min_length=1, description="Name for the script")
	description: str | None = Field(None, description="Optional description")


class RunStepResponse(BaseModel):
	"""Response for a single step in a test run."""
	id: str
	step_index: int
	action: str
	status: str
	selector_used: str | None = None
	screenshot_path: str | None = None
	duration_ms: int | None = None
	error_message: str | None = None
	heal_attempts: list[dict[str, Any]] | None = None
	created_at: datetime

	class Config:
		from_attributes = True


class TestRunResponse(BaseModel):
	"""Response for a test run."""
	id: str
	script_id: str
	status: str
	runner_type: str = "playwright"  # playwright | cdp
	started_at: datetime | None = None
	completed_at: datetime | None = None
	total_steps: int
	passed_steps: int
	failed_steps: int
	healed_steps: int
	error_message: str | None = None
	created_at: datetime

	class Config:
		from_attributes = True


class TestRunDetailResponse(TestRunResponse):
	"""Detailed response for a test run with steps."""
	run_steps: list[RunStepResponse] = []


class PlaywrightScriptResponse(BaseModel):
	"""Response for a Playwright script."""
	id: str
	session_id: str
	name: str
	description: str | None = None
	steps_json: list[dict[str, Any]]
	created_at: datetime
	updated_at: datetime

	class Config:
		from_attributes = True


class PlaywrightScriptListResponse(BaseModel):
	"""Response for listing scripts."""
	id: str
	session_id: str
	name: str
	description: str | None = None
	step_count: int = 0
	run_count: int = 0
	last_run_status: str | None = None
	created_at: datetime
	updated_at: datetime

	class Config:
		from_attributes = True


class PlaywrightScriptDetailResponse(PlaywrightScriptResponse):
	"""Detailed response for a script with runs."""
	runs: list[TestRunResponse] = []


class StartRunRequest(BaseModel):
	"""Request to start a test run."""
	headless: bool = Field(default=True, description="Run browser in headless mode")
	runner: str = Field(default="playwright", description="Runner type: 'playwright' or 'cdp'")


class StartRunResponse(BaseModel):
	"""Response after starting a test run."""
	run_id: str
	status: str


# WebSocket messages for test runs
class WSRunStepStarted(WSMessage):
	type: str = "run_step_started"
	step_index: int
	action: str
	description: str | None = None


class WSRunStepCompleted(WSMessage):
	type: str = "run_step_completed"
	step: RunStepResponse


class WSRunCompleted(WSMessage):
	type: str = "run_completed"
	run: TestRunResponse
