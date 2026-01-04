from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


# ============================================
# Test Runner Enums
# ============================================

class BrowserType(str, Enum):
	"""Supported browser types for test runs."""
	CHROMIUM = "chromium"
	FIREFOX = "firefox"
	WEBKIT = "webkit"
	EDGE = "edge"


class Resolution(str, Enum):
	"""Standard screen resolutions for test runs."""
	FHD = "1920x1080"
	HD = "1366x768"
	WXGA = "1600x900"


class IsolationMode(str, Enum):
	"""Container isolation modes for test runs."""
	CONTEXT = "context"      # Reuse container, fresh browser context (default)
	EPHEMERAL = "ephemeral"  # New container per run, destroyed after


# Request schemas
class CreateSessionRequest(BaseModel):
	prompt: str = Field(..., min_length=1, description="The QA task prompt")
	llm_model: str = Field(
		default="gemini-2.5-flash",
		description="LLM model for browser automation: browser-use-llm | gemini-2.0-flash | gemini-2.5-flash | gemini-3.0-flash | gemini-2.5-computer-use"
	)
	headless: bool = Field(
		default=True,
		description="If True (default), run in headless mode with screenshots only. If False, show live browser view."
	)


class ContinueSessionRequest(BaseModel):
	"""Request to continue an existing session with a new task."""
	prompt: str = Field(..., min_length=1, description="The new task prompt to continue with")
	llm_model: str = Field(
		default="gemini-2.5-flash",
		description="LLM model for browser automation"
	)
	mode: str = Field(
		default="act",
		description="Execution mode: 'plan' generates a new plan, 'act' executes directly"
	)


class UpdateStepActionTextRequest(BaseModel):
	"""Request to update the text value for a type_text action."""
	text: str = Field(..., description="The new text value for the action")


class UpdateStepActionRequest(BaseModel):
	"""Request to update step action fields (xpath, css_selector, text)."""
	element_xpath: str | None = Field(None, description="XPath selector for the element")
	css_selector: str | None = Field(None, description="CSS selector for the element")
	text: str | None = Field(None, description="Input text (for type_text actions only)")


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
	# Approval tracking
	approval_status: str = "pending"
	approval_timestamp: datetime | None = None
	rejection_reason: str | None = None

	class Config:
		from_attributes = True


class TestSessionResponse(BaseModel):
	id: str
	prompt: str
	title: str | None = None
	llm_model: str
	headless: bool = True
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
	title: str | None = None
	llm_model: str
	status: str
	created_at: datetime
	updated_at: datetime
	step_count: int = 0

	class Config:
		from_attributes = True


class UpdateSessionTitleRequest(BaseModel):
	"""Request to update a session's title."""
	title: str = Field(..., min_length=1, max_length=100, description="The new title for the session")


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


class WSInitialState(WSMessage):
	"""Server sends initial session state on subscribe."""
	type: str = "initial_state"
	session: TestSessionResponse
	steps: list[TestStepResponse] = []


class WSStatusChanged(WSMessage):
	"""Server sends when session status changes."""
	type: str = "status_changed"
	status: str
	previous_status: str | None = None


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
# Chat Message Schemas
# ============================================

class ChatMessageBase(BaseModel):
	"""Base schema for chat messages."""
	message_type: str = Field(..., description="Message type: user | assistant | plan | step | error | system")
	content: str | None = Field(None, description="Text content for text messages")
	mode: str | None = Field(None, description="Mode for user messages: plan | act")


class ChatMessageCreate(ChatMessageBase):
	"""Request to create a chat message."""
	pass


class ChatMessageResponse(ChatMessageBase):
	"""Response for a chat message."""
	id: str
	session_id: str
	sequence_number: int
	plan_id: str | None = None
	step_id: str | None = None
	created_at: datetime

	class Config:
		from_attributes = True


class RejectPlanRequest(BaseModel):
	"""Request to reject a plan."""
	reason: str | None = Field(None, description="Optional reason for rejection")


class UpdatePlanRequest(BaseModel):
	"""Request to update plan steps manually."""
	steps: list[dict[str, Any]] = Field(..., description="Updated plan steps array")
	user_prompt: str | None = Field(None, description="Optional user instructions to save with the plan")


class RegeneratePlanRequest(BaseModel):
	"""Request to regenerate plan using AI with user's edits as context."""
	edited_steps: list[dict[str, Any]] = Field(..., description="User's edited steps")
	user_prompt: str = Field(..., min_length=1, description="User's refinement instructions for AI")


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
	headless: bool = True

	# Run Configuration
	browser_type: str = "chromium"  # chromium | firefox | webkit | edge
	resolution_width: int = 1920
	resolution_height: int = 1080
	screenshots_enabled: bool = True
	recording_enabled: bool = True
	network_recording_enabled: bool = False
	performance_metrics_enabled: bool = True

	# Output
	video_path: str | None = None
	duration_ms: int | None = None  # Total run duration

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


class NetworkRequestResponse(BaseModel):
	"""Response for a captured network request."""
	id: str
	step_index: int | None = None
	url: str
	method: str
	resource_type: str | None = None
	status_code: int | None = None
	response_size_bytes: int | None = None
	timing_dns_ms: float | None = None
	timing_connect_ms: float | None = None
	timing_ssl_ms: float | None = None
	timing_ttfb_ms: float | None = None
	timing_download_ms: float | None = None
	timing_total_ms: float | None = None
	started_at: datetime
	completed_at: datetime | None = None

	class Config:
		from_attributes = True


class ConsoleLogResponse(BaseModel):
	"""Response for a captured browser console log."""
	id: str
	step_index: int | None = None
	level: str  # log, info, warn, error, debug
	message: str
	source: str | None = None
	line_number: int | None = None
	column_number: int | None = None
	timestamp: datetime

	class Config:
		from_attributes = True


class TestRunDetailResponse(TestRunResponse):
	"""Detailed response for a test run with steps, network requests, and console logs."""
	run_steps: list[RunStepResponse] = []
	network_requests: list[NetworkRequestResponse] = []
	console_logs: list[ConsoleLogResponse] = []


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
	"""Request to start a test run with configuration options.

	All runs execute on pre-warmed browser containers from the container pool.
	"""
	# Browser & Display Configuration
	browser_type: BrowserType = Field(
		default=BrowserType.CHROMIUM,
		description="Browser to use: chromium | firefox | webkit | edge"
	)
	resolution: Resolution = Field(
		default=Resolution.FHD,
		description="Screen resolution: 1920x1080 | 1366x768 | 1600x900"
	)

	# Recording & Monitoring Options
	screenshots_enabled: bool = Field(
		default=True,
		description="Take screenshot after each step"
	)
	recording_enabled: bool = Field(
		default=True,
		description="Record video of test run (WebM format)"
	)
	network_recording_enabled: bool = Field(
		default=False,
		description="Record network requests and responses"
	)
	performance_metrics_enabled: bool = Field(
		default=True,
		description="Measure asset loading times and performance metrics"
	)


class StartRunResponse(BaseModel):
	"""Response after starting a test run."""
	run_id: str
	status: str
	celery_task_id: str | None = Field(
		default=None,
		description="Celery task ID for tracking execution"
	)


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


# ============================================
# Act Mode Schemas
# ============================================

class ActModeRequest(BaseModel):
	"""Request to execute a single action in act mode."""
	task: str = Field(..., min_length=1, description="The action to execute (e.g., 'click the login button')")


class ActModeResponse(BaseModel):
	"""Response from act mode execution."""
	success: bool
	action_taken: str | None = None
	thinking: str | None = None
	evaluation: str | None = None
	memory: str | None = None
	next_goal: str | None = None
	result: list[dict[str, Any]] = []
	browser_state: dict[str, Any] = {}
	screenshot_path: str | None = None
	browser_session_id: str | None = None
	error: str | None = None


# ============================================
# Benchmark Schemas
# ============================================

class CreateBenchmarkRequest(BaseModel):
	"""Request to create a new benchmark session."""
	prompt: str = Field(..., min_length=1, description="The test case prompt to benchmark")
	models: list[str] = Field(..., min_length=1, max_length=3, description="List of up to 3 LLM models to benchmark")
	headless: bool = Field(default=True, description="Run browsers in headless mode")
	mode: str = Field(default="auto", description="Execution mode: auto | plan | act")


class BenchmarkModelRunResponse(BaseModel):
	"""Response for a single model run within a benchmark."""
	id: str
	llm_model: str
	test_session_id: str | None = None
	celery_task_id: str | None = None
	status: str
	started_at: datetime | None = None
	completed_at: datetime | None = None
	total_steps: int = 0
	duration_seconds: float = 0.0
	error: str | None = None
	created_at: datetime

	class Config:
		from_attributes = True


class BenchmarkSessionResponse(BaseModel):
	"""Response for a benchmark session."""
	id: str
	prompt: str
	title: str | None = None
	selected_models: list[str]
	headless: bool = True
	mode: str = "auto"
	status: str
	created_at: datetime
	updated_at: datetime
	model_runs: list[BenchmarkModelRunResponse] = []

	class Config:
		from_attributes = True


class BenchmarkSessionListResponse(BaseModel):
	"""Response for listing benchmark sessions."""
	id: str
	prompt: str
	title: str | None = None
	selected_models: list[str]
	status: str
	mode: str = "auto"  # auto | plan | act
	created_at: datetime
	updated_at: datetime
	model_run_count: int = 0
	completed_count: int = 0

	class Config:
		from_attributes = True


class StartBenchmarkResponse(BaseModel):
	"""Response after starting benchmark execution."""
	benchmark_id: str
	status: str
	task_ids: list[str]


# ============================================
# Undo Schemas
# ============================================

class UndoRequest(BaseModel):
	"""Request to undo steps in a test session."""
	target_step_number: int = Field(
		...,
		ge=1,
		description="The step number to undo to (inclusive). All steps after this will be removed and the browser will replay from step 1 to this step."
	)


class UndoResponse(BaseModel):
	"""Response from an undo operation."""
	success: bool
	target_step_number: int
	steps_removed: int = Field(..., description="Number of steps that were deleted from the session")
	steps_replayed: int = Field(..., description="Number of steps that were replayed in the browser")
	replay_status: str = Field(..., description="Status of the replay: passed | failed | healed | partial")
	error_message: str | None = None
	failed_at_step: int | None = Field(None, description="If replay failed, the step index where it failed")
	actual_step_number: int | None = Field(None, description="The actual step number the session ended at (for partial undo)")
	user_message: str | None = Field(None, description="Human-readable message to display in the chat")


# ============================================
# Run Till End Schemas
# ============================================

class WSRunTillEndStarted(WSMessage):
	"""Server sends when Run Till End execution starts."""
	type: str = "run_till_end_started"
	total_steps: int


class WSRunTillEndProgress(WSMessage):
	"""Server sends progress updates during Run Till End."""
	type: str = "run_till_end_progress"
	current_step: int
	total_steps: int
	status: str = Field(..., description="Status: running | completed")


class WSRunTillEndPaused(WSMessage):
	"""Server sends when Run Till End pauses on a failure."""
	type: str = "run_till_end_paused"
	failed_step: int
	error_message: str
	options: list[str] = Field(default_factory=lambda: ["auto_heal", "undo", "skip"])


class WSRunTillEndCompleted(WSMessage):
	"""Server sends when Run Till End completes."""
	type: str = "run_till_end_completed"
	success: bool
	total_steps: int
	completed_steps: int
	skipped_steps: list[int] = []
	error_message: str | None = None
	cancelled: bool = False


class WSStepSkipped(WSMessage):
	"""Server sends when a step is skipped during Run Till End."""
	type: str = "step_skipped"
	step_number: int


# ============================================
# Replay Session Schemas
# ============================================

class ReplaySessionRequest(BaseModel):
	"""Request to replay all steps in an existing session."""
	headless: bool = Field(
		default=False,
		description="If True, run in headless mode. If False, show live browser view."
	)


class ReplaySessionResponse(BaseModel):
	"""Response from a replay session operation."""
	success: bool
	total_steps: int = Field(..., description="Total number of steps in the session")
	steps_replayed: int = Field(..., description="Number of steps that were successfully replayed")
	replay_status: str = Field(..., description="Status of the replay: passed | failed | healed | partial")
	error_message: str | None = None
	failed_at_step: int | None = Field(None, description="If replay failed, the step number where it failed")
	browser_session_id: str | None = Field(None, description="The browser session ID for live view")
	user_message: str | None = Field(None, description="Human-readable message to display in the chat")


# ============================================
# User Recording Schemas
# ============================================

# Recording mode type: 'cdp' (browser-use CDP) or 'playwright' (Playwright browser server)
RecordingMode = Literal['cdp', 'playwright', 'browser_use']


class StartRecordingRequest(BaseModel):
	"""Request to start recording user interactions."""
	browser_session_id: str = Field(..., description="ID of the browser session to record from")
	recording_mode: RecordingMode = Field(
		default='playwright',
		description="Recording mode: 'playwright' (blur-based input), 'browser_use' (semantic selectors), or 'cdp' (legacy keystroke capture)"
	)


class RecordingStatusResponse(BaseModel):
	"""Response with recording status information."""
	is_recording: bool
	session_id: str
	browser_session_id: str | None = None
	steps_recorded: int = 0
	started_at: datetime | None = None
	recording_mode: RecordingMode | None = None


# ============================================
# Speech-to-Text Schemas
# ============================================

class SpeechToTextRequest(BaseModel):
	"""Request to transcribe audio to text."""
	audio_data: str = Field(..., description="Base64 encoded audio data")
	language_code: str = Field(default="en-US", description="Language code for transcription")


class SpeechToTextResponse(BaseModel):
	"""Response with transcription result."""
	transcript: str
	confidence: float
	is_final: bool = True


# ============================================
# System Settings Schemas
# ============================================

class SystemSettingsRequest(BaseModel):
	"""Request to update system settings."""
	isolation_mode: IsolationMode = Field(
		default=IsolationMode.CONTEXT,
		description="Container isolation mode: 'context' (reuse container) or 'ephemeral' (new container per run)"
	)


class SystemSettingsResponse(BaseModel):
	"""Response for system settings."""
	isolation_mode: IsolationMode = IsolationMode.CONTEXT
	updated_at: datetime | None = None

	class Config:
		from_attributes = True
