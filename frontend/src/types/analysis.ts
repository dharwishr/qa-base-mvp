// Analysis types matching backend schemas

export interface StepAction {
  id: string;
  action_index: number;
  action_name: string;
  action_params: Record<string, unknown> | null;
  result_success: boolean | null;
  result_error: string | null;
  extracted_content: string | null;
  element_xpath: string | null;
  element_name: string | null;
  is_enabled: boolean;  // Whether action should be included in script execution
}

export interface TestStep {
  id: string;
  step_number: number;
  url: string | null;
  page_title: string | null;
  thinking: string | null;
  evaluation: string | null;
  memory: string | null;
  next_goal: string | null;
  screenshot_path: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error: string | null;
  created_at: string;
  actions: StepAction[];
}

export interface TestPlan {
  id: string;
  plan_text: string;
  steps_json: {
    steps: Array<{
      step_number: number;
      description: string;
      action_type: string;
      details: string;
    }>;
  } | null;
  created_at: string;
  // Approval tracking
  approval_status: 'pending' | 'approved' | 'rejected';
  approval_timestamp: string | null;
  rejection_reason: string | null;
}

export type LlmModel = 'browser-use-llm' | 'gemini-2.0-flash' | 'gemini-2.5-flash' | 'gemini-2.5-pro' | 'gemini-3.0-flash' | 'gemini-3.0-pro' | 'gemini-2.5-computer-use';

export type SessionStatus = 'pending_plan' | 'generating_plan' | 'plan_ready' | 'approved' | 'queued' | 'running' | 'completed' | 'failed' | 'stopped' | 'paused' | 'cancelled' | 'recording_ready';

export interface TestSession {
  id: string;
  prompt: string;
  title: string | null;
  llm_model: LlmModel;
  headless: boolean;
  status: SessionStatus;
  celery_task_id: string | null;
  created_at: string;
  updated_at: string;
  plan: TestPlan | null;
  steps?: TestStep[];
}

export interface TestSessionListItem {
  id: string;
  prompt: string;
  title: string | null;
  llm_model: LlmModel;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  step_count: number;
  user_name: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export type PaginatedTestSessions = PaginatedResponse<TestSessionListItem>;

export interface ExecuteResponse {
  task_id: string;
  status: string;
}

export interface ExecutionLog {
  id: string;
  level: string;
  message: string;
  source: string | null;
  created_at: string;
}

// WebSocket message types
export type WSMessageType =
  | 'step_started'
  | 'step_completed'
  | 'completed'
  | 'error'
  | 'plan_generated'
  | 'pong'
  | 'initial_state'
  | 'status_changed';

export interface WSStepStarted {
  type: 'step_started';
  step_number: number;
  goal: string | null;
}

export interface WSStepCompleted {
  type: 'step_completed';
  step: TestStep;
}

export interface WSCompleted {
  type: 'completed';
  success: boolean;
  total_steps: number;
}

export interface WSError {
  type: 'error';
  message: string;
}

export interface WSPong {
  type: 'pong';
}

export interface WSBrowserSessionStarted {
  type: 'browser_session_started';
  session_id: string | null;
  cdp_url?: string;
  live_view_url?: string;
  headless: boolean;
  fallback?: boolean;
}

export interface WSInitialState {
  type: 'initial_state';
  session: TestSession;
  steps: TestStep[];
}

export interface WSStatusChanged {
  type: 'status_changed';
  status: SessionStatus;
  previous_status: SessionStatus | null;
}

// Run Till End WebSocket messages
export interface WSRunTillEndStarted {
  type: 'run_till_end_started';
  total_steps: number;
}

export interface WSRunTillEndProgress {
  type: 'run_till_end_progress';
  current_step: number;
  total_steps: number;
  status: 'running' | 'completed';
}

export interface WSRunTillEndPaused {
  type: 'run_till_end_paused';
  failed_step: number;
  error_message: string;
  options: string[];
}

export interface WSRunTillEndCompleted {
  type: 'run_till_end_completed';
  success: boolean;
  total_steps: number;
  completed_steps: number;
  skipped_steps: number[];
  error_message?: string;
  cancelled?: boolean;
}

export interface WSStepSkipped {
  type: 'step_skipped';
  step_number: number;
}

// Pause/Stop WebSocket messages
export interface WSExecutionPaused {
  type: 'execution_paused';
  step_number: number;
  message: string;
}

export interface WSAllStopped {
  type: 'all_stopped';
  message: string;
}

export type WSMessage =
  | WSStepStarted
  | WSStepCompleted
  | WSCompleted
  | WSError
  | WSPong
  | WSBrowserSessionStarted
  | WSInitialState
  | WSStatusChanged
  | WSRunTillEndStarted
  | WSRunTillEndProgress
  | WSRunTillEndPaused
  | WSRunTillEndCompleted
  | WSStepSkipped
  | WSExecutionPaused
  | WSAllStopped;

// Chat message types
export type ChatMessageType = 'user' | 'assistant' | 'plan' | 'step' | 'error' | 'system' | 'hint';
export type ChatMode = 'plan' | 'act' | 'hint';

export interface ChatMessageCreate {
  message_type: ChatMessageType;
  content?: string;
  mode?: ChatMode;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  message_type: ChatMessageType;
  content: string | null;
  mode: ChatMode | null;
  sequence_number: number;
  plan_id: string | null;
  step_id: string | null;
  created_at: string;
}

// Act mode response from single-step execution
export interface ActModeResponse {
  success: boolean;
  action_taken: string | null;
  thinking: string | null;
  evaluation: string | null;
  memory: string | null;
  next_goal: string | null;
  result: Array<Record<string, unknown>>;
  browser_state: {
    url: string | null;
    title: string | null;
  };
  screenshot_path: string | null;
  browser_session_id: string | null;
  error: string | null;
}

// Undo types
export interface UndoRequest {
  target_step_number: number;
}

export interface UndoResponse {
  success: boolean;
  target_step_number: number;
  steps_removed: number;
  steps_replayed: number;
  replay_status: 'passed' | 'failed' | 'healed' | 'partial';
  error_message: string | null;
  failed_at_step: number | null;
  actual_step_number: number | null;
  user_message: string | null;
}

// Replay types
export interface ReplayRequest {
  headless: boolean;
}

export interface ReplayResponse {
  success: boolean;
  total_steps: number;
  steps_replayed: number;
  replay_status: 'passed' | 'failed' | 'healed' | 'partial';
  error_message: string | null;
  failed_at_step: number | null;
  browser_session_id: string | null;
  user_message: string | null;
}

// Recording types
export type RecordingMode = 'cdp' | 'playwright' | 'browser_use';

export interface RecordingStatusResponse {
  is_recording: boolean;
  session_id: string;
  browser_session_id: string | null;
  steps_recorded: number;
  started_at: string | null;
  recording_mode: RecordingMode | null;
}

// Insert action/step request types
export interface InsertActionRequest {
  action_index: number;
  action_name: string;
  action_params: Record<string, unknown>;
}

export interface InsertStepRequest {
  step_number: number;
  action_name: string;
  action_params: Record<string, unknown>;
}
