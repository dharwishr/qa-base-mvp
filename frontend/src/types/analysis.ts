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

export type SessionStatus = 'pending_plan' | 'plan_ready' | 'approved' | 'queued' | 'running' | 'completed' | 'failed' | 'stopped';

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
}

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
  | 'pong';

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

export type WSMessage = WSStepStarted | WSStepCompleted | WSCompleted | WSError | WSPong | WSBrowserSessionStarted;

// Chat message types
export type ChatMessageType = 'user' | 'assistant' | 'plan' | 'step' | 'error' | 'system';
export type ChatMode = 'plan' | 'act';

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
