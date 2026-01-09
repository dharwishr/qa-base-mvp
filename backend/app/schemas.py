from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, EmailStr


# ============================================
# User Role Enum
# ============================================

class UserRole(str, Enum):
	"""User roles in an organization."""
	OWNER = "owner"
	MEMBER = "member"


# ============================================
# Organization Schemas
# ============================================

class OrganizationBase(BaseModel):
	"""Base organization schema."""
	name: str = Field(..., min_length=1, max_length=256, description="Organization name")
	description: str | None = Field(None, description="Organization description")


class OrganizationCreate(OrganizationBase):
	"""Schema for creating organization (backend only)."""
	owner_email: str = Field(..., description="Email of the owner user")


class OrganizationUpdate(BaseModel):
	"""Schema for updating organization."""
	name: str | None = Field(None, min_length=1, max_length=256, description="Organization name")
	description: str | None = Field(None, description="Organization description")


class CreateOrganizationRequest(BaseModel):
	"""Request to create a new organization (owner-only)."""
	name: str = Field(..., min_length=1, max_length=256, description="Organization name")
	description: str | None = Field(None, description="Organization description")


class OrganizationResponse(OrganizationBase):
	"""Response schema for organization."""
	id: str
	slug: str
	created_at: datetime
	updated_at: datetime

	class Config:
		from_attributes = True


class OrganizationWithRoleResponse(OrganizationResponse):
	"""Organization response including user's role."""
	role: UserRole


# ============================================
# User Schemas
# ============================================

class UserBase(BaseModel):
	"""Base user schema."""
	name: str = Field(..., min_length=1, max_length=256, description="User name")
	email: str = Field(..., description="User email")


class UserCreate(UserBase):
	"""Schema for creating a user (signup)."""
	password: str = Field(..., min_length=8, description="User password (min 8 characters)")


class UserUpdate(BaseModel):
	"""Schema for updating user."""
	name: str | None = Field(None, min_length=1, max_length=256)


class UserResponse(BaseModel):
	"""Response schema for user."""
	id: str
	name: str
	email: str
	created_at: datetime
	updated_at: datetime

	class Config:
		from_attributes = True


class UserWithRoleResponse(UserResponse):
	"""User response including role in organization."""
	role: UserRole


class UserInOrganizationResponse(BaseModel):
	"""User info as seen in an organization."""
	id: str
	name: str
	email: str
	role: UserRole
	joined_at: datetime

	class Config:
		from_attributes = True


# ============================================
# User Organization Association Schemas
# ============================================

class AddUserToOrganizationRequest(BaseModel):
	"""Request to add a user to an organization."""
	email: str = Field(..., description="Email of the user to add")
	role: UserRole = Field(default=UserRole.MEMBER, description="Role for the user")


class UpdateUserRoleRequest(BaseModel):
	"""Request to update a user's role in an organization."""
	role: UserRole = Field(..., description="New role for the user")


# ============================================
# Auth Schemas (Login/Signup)
# ============================================

class SignupRequest(BaseModel):
	"""Request for user signup."""
	name: str = Field(..., min_length=1, max_length=256, description="User name")
	email: str = Field(..., description="User email")
	password: str = Field(..., min_length=8, description="User password")


class SignupResponse(BaseModel):
	"""Response after successful signup."""
	user: UserResponse
	message: str = "User created successfully. Please wait for an admin to add you to an organization."


class LoginRequest(BaseModel):
	"""Request for user login."""
	email: str
	password: str
	organization_id: str | None = Field(None, description="Organization to log into (required if user is in multiple orgs)")


class LoginResponse(BaseModel):
	"""Response after successful login."""
	access_token: str
	token_type: str = "bearer"
	user: UserResponse
	organization: OrganizationResponse
	role: UserRole
	organization_count: int = Field(1, description="Total number of organizations user belongs to")


class SelectOrganizationRequest(BaseModel):
	"""Request to select an organization after login."""
	organization_id: str


class CurrentUserResponse(BaseModel):
	"""Response for current authenticated user."""
	user: UserResponse
	organization: OrganizationResponse
	role: UserRole


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
		default="gemini-3.0-flash",
		description="LLM model for browser automation: browser-use-llm | gemini-2.0-flash | gemini-2.5-flash | gemini-3.0-flash | gemini-2.5-computer-use"
	)
	headless: bool = Field(
		default=True,
		description="If True (default), run in headless mode with screenshots only. If False, show live browser view."
	)


class CreateRecordingSessionRequest(BaseModel):
	"""Request to create a recording-mode session that skips plan generation."""
	start_url: str = Field(..., min_length=1, description="Starting URL to navigate to and begin recording")
	llm_model: str = Field(
		default="gemini-3.0-flash",
		description="LLM model for potential AI assistance later"
	)


class ContinueSessionRequest(BaseModel):
	"""Request to continue an existing session with a new task."""
	prompt: str = Field(..., min_length=1, description="The new task prompt to continue with")
	llm_model: str = Field(
		default="gemini-3.0-flash",
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
	"""Request to update step action fields (xpath, css_selector, text, assertion params)."""
	element_xpath: str | None = Field(None, description="XPath selector for the element")
	css_selector: str | None = Field(None, description="CSS selector for the element")
	text: str | None = Field(None, description="Input text (for type_text actions only)")
	# Assertion-specific fields
	expected_value: str | None = Field(None, description="Expected value for assert actions (text, URL, etc.)")
	pattern_type: str | None = Field(None, description="Pattern matching type: 'exact', 'substring', 'wildcard', 'regex'")
	case_sensitive: bool | None = Field(None, description="Whether the assertion should be case-sensitive")
	partial_match: bool | None = Field(None, description="Whether to use partial/substring matching")


class ToggleActionEnabledRequest(BaseModel):
	"""Request to toggle action enabled state."""
	enabled: bool = Field(..., description="Whether the action should be enabled for execution")


class InsertActionRequest(BaseModel):
	"""Request to insert a new action at a specific index within a step."""
	action_index: int = Field(..., ge=0, description="Index where the action should be inserted")
	action_name: str = Field(..., min_length=1, description="Action type (e.g., 'wait')")
	action_params: dict[str, Any] | None = Field(None, description="Action parameters")


class InsertStepRequest(BaseModel):
	"""Request to insert a new step with an action at a specific position."""
	step_number: int = Field(..., ge=1, description="Step number where to insert (1-based)")
	action_name: str = Field(..., min_length=1, description="Action type (e.g., 'wait')")
	action_params: dict[str, Any] | None = Field(None, description="Action parameters")


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
	is_enabled: bool = True  # Whether action should be included in script execution

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


class AnalysisPlanResponse(BaseModel):
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
	plan: AnalysisPlanResponse | None = None

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
	user_name: str | None = None
	user_email: str | None = None

	class Config:
		from_attributes = True


class PaginatedTestSessionsResponse(BaseModel):
	"""Paginated response for test sessions list."""
	items: list[TestSessionListResponse]
	total: int = Field(..., description="Total number of items matching the query")
	page: int = Field(..., description="Current page number (1-indexed)")
	page_size: int = Field(..., description="Number of items per page")
	total_pages: int = Field(..., description="Total number of pages")


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
	plan: AnalysisPlanResponse


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
	script_id: str | None = None  # Optional: run can be from script or session
	session_id: str | None = None  # Optional: run can be from session directly
	status: str
	runner_type: str = "playwright"  # playwright | cdp
	headless: bool = True
	celery_task_id: str | None = None  # Celery task ID for tracking

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
	user_name: str | None = None
	user_email: str | None = None

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
	user_name: str | None = None

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
	prepare_only: bool = Field(
		default=False,
		description="If True, only start the browser without replaying steps. Useful for Run Till End flow with skip support."
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
	default_analysis_model: str | None = Field(
		default=None,
		description="Default LLM model for test case analysis: browser-use-llm | gemini-2.0-flash | gemini-2.5-flash | gemini-3.0-flash | gemini-2.5-computer-use"
	)


class SystemSettingsResponse(BaseModel):
	"""Response for system settings."""
	isolation_mode: IsolationMode = IsolationMode.CONTEXT
	default_analysis_model: str = "gemini-3.0-flash"
	updated_at: datetime | None = None

	class Config:
		from_attributes = True


# Analysis Events (Celery task monitoring)

class AnalysisEventResponse(BaseModel):
	"""Response for an analysis event."""
	id: str
	session_id: str
	event_type: str
	event_data: dict | None = None
	created_at: datetime

	class Config:
		from_attributes = True


class TaskStatusResponse(BaseModel):
	"""Response for Celery task status."""
	task_id: str | None = None
	task_type: str | None = None  # plan_generation | execution | act_mode | run_till_end
	status: str  # pending | running | completed | failed | cancelled | paused
	progress: int = 0  # 0-100
	message: str | None = None
	error: str | None = None


class CancelTaskResponse(BaseModel):
	"""Response for task cancellation."""
	success: bool
	message: str
	task_id: str | None = None


# ============================================
# Test Plan Module Schemas
# ============================================

class CreateTestPlanRequest(BaseModel):
	"""Request to create a new test plan."""
	name: str = Field(..., min_length=1, max_length=256)
	url: str | None = Field(None, max_length=2048)
	description: str | None = None


class UpdateTestPlanRequest(BaseModel):
	"""Request to update a test plan."""
	name: str | None = Field(None, min_length=1, max_length=256)
	url: str | None = None
	description: str | None = None
	status: str | None = None  # active | archived


class UpdateTestPlanSettingsRequest(BaseModel):
	"""Request to update test plan default run settings."""
	default_run_type: str | None = None  # sequential | parallel
	browser_type: str | None = None  # chromium | firefox | webkit | edge
	resolution_width: int | None = None
	resolution_height: int | None = None
	headless: bool | None = None
	screenshots_enabled: bool | None = None
	recording_enabled: bool | None = None
	network_recording_enabled: bool | None = None
	performance_metrics_enabled: bool | None = None


class AddTestCasesRequest(BaseModel):
	"""Request to add test cases to a test plan."""
	test_session_ids: list[str] = Field(..., min_length=1)


class ReorderTestCasesRequest(BaseModel):
	"""Request to reorder test cases in a test plan."""
	test_case_orders: list[dict[str, Any]] = Field(..., description="List of {test_session_id, order}")


class RunTestPlanRequest(BaseModel):
	"""Request to run a test plan."""
	run_type: str = Field("sequential", description="sequential | parallel")
	# Optional overrides for run configuration
	browser_type: str | None = None
	resolution_width: int | None = None
	resolution_height: int | None = None
	headless: bool | None = None
	screenshots_enabled: bool | None = None
	recording_enabled: bool | None = None
	network_recording_enabled: bool | None = None
	performance_metrics_enabled: bool | None = None


class CreateScheduleRequest(BaseModel):
	"""Request to create a test plan schedule."""
	name: str = Field(..., min_length=1, max_length=256)
	schedule_type: str = Field(..., description="one_time | recurring")
	run_type: str = Field("sequential", description="sequential | parallel")
	one_time_at: datetime | None = None
	cron_expression: str | None = None
	timezone: str = "UTC"


class UpdateScheduleRequest(BaseModel):
	"""Request to update a test plan schedule."""
	name: str | None = Field(None, min_length=1, max_length=256)
	schedule_type: str | None = None
	run_type: str | None = None
	one_time_at: datetime | None = None
	cron_expression: str | None = None
	timezone: str | None = None
	is_active: bool | None = None


# Response Schemas

class TestPlanTestCaseResponse(BaseModel):
	"""Response for a test case in a test plan."""
	id: str
	test_session_id: str
	title: str | None = None
	prompt: str
	status: str
	order: int
	step_count: int = 0
	created_at: datetime

	class Config:
		from_attributes = True


class TestPlanResponse(BaseModel):
	"""Response for a test plan (list view)."""
	id: str
	name: str
	url: str | None = None
	description: str | None = None
	status: str
	test_case_count: int = 0
	last_run_status: str | None = None
	last_run_at: datetime | None = None
	# Default run settings
	default_run_type: str
	browser_type: str
	resolution_width: int
	resolution_height: int
	headless: bool
	screenshots_enabled: bool
	recording_enabled: bool
	network_recording_enabled: bool
	performance_metrics_enabled: bool
	# Metadata
	created_at: datetime
	updated_at: datetime
	user_name: str | None = None

	class Config:
		from_attributes = True


class TestPlanRunResultResponse(BaseModel):
	"""Response for a test plan run result."""
	id: str
	test_session_id: str | None = None
	test_session_title: str | None = None
	test_run_id: str | None = None
	order: int
	status: str
	duration_ms: int | None = None
	error_message: str | None = None
	started_at: datetime | None = None
	completed_at: datetime | None = None

	class Config:
		from_attributes = True


class TestPlanRunResponse(BaseModel):
	"""Response for a test plan run."""
	id: str
	test_plan_id: str
	status: str
	run_type: str
	# Run configuration
	browser_type: str
	resolution_width: int
	resolution_height: int
	headless: bool
	screenshots_enabled: bool
	recording_enabled: bool
	network_recording_enabled: bool
	performance_metrics_enabled: bool
	# Stats
	total_test_cases: int
	passed_test_cases: int
	failed_test_cases: int
	duration_ms: int | None = None
	started_at: datetime | None = None
	completed_at: datetime | None = None
	error_message: str | None = None
	created_at: datetime
	user_name: str | None = None
	celery_task_id: str | None = None

	class Config:
		from_attributes = True


class TestPlanRunDetailResponse(TestPlanRunResponse):
	"""Detailed response for a test plan run with results."""
	results: list[TestPlanRunResultResponse] = []


class TestPlanScheduleResponse(BaseModel):
	"""Response for a test plan schedule."""
	id: str
	test_plan_id: str
	name: str
	schedule_type: str
	run_type: str
	one_time_at: datetime | None = None
	cron_expression: str | None = None
	timezone: str
	is_active: bool
	last_run_at: datetime | None = None
	next_run_at: datetime | None = None
	created_at: datetime
	updated_at: datetime

	class Config:
		from_attributes = True


class TestPlanDetailResponse(TestPlanResponse):
	"""Detailed response for a test plan with test cases and recent runs."""
	test_cases: list[TestPlanTestCaseResponse] = []
	recent_runs: list[TestPlanRunResponse] = []
	schedules: list[TestPlanScheduleResponse] = []


class PaginatedTestPlansResponse(BaseModel):
	"""Paginated response for test plans."""
	items: list[TestPlanResponse]
	total: int
	page: int
	page_size: int
	total_pages: int


class StartTestPlanRunResponse(BaseModel):
	"""Response for starting a test plan run."""
	run_id: str
	status: str
	celery_task_id: str | None = None
