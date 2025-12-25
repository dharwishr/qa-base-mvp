// Script and Test Run types matching backend schemas

export interface SelectorSet {
  primary: string;
  fallbacks: string[];
}

export interface ElementContext {
  tag_name: string;
  text_content: string | null;
  aria_label: string | null;
  placeholder: string | null;
  role: string | null;
  classes: string[];
  nearby_text: string | null;
  parent_tag: string | null;
}

export interface AssertionConfig {
  assertion_type: 'text_visible' | 'text_contains' | 'element_visible' | 'element_count' | 'url_contains' | 'url_equals' | 'value_equals';
  expected_value?: string;
  expected_count?: number;
  case_sensitive?: boolean;
  partial_match?: boolean;
}

export interface PlaywrightStep {
  index: number;
  action: 'goto' | 'click' | 'fill' | 'select' | 'scroll' | 'wait' | 'press' | 'hover' | 'assert';
  url?: string;
  selectors?: SelectorSet;
  value?: string;
  key?: string;
  direction?: 'up' | 'down';
  amount?: number;
  timeout?: number;
  wait_for?: string;
  element_context?: ElementContext;
  description?: string;
  assertion?: AssertionConfig;
}

export interface HealAttempt {
  selector: string;
  success: boolean;
  error: string | null;
}

export interface RunStep {
  id: string;
  step_index: number;
  action: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'healed' | 'skipped';
  selector_used: string | null;
  screenshot_path: string | null;
  duration_ms: number | null;
  error_message: string | null;
  heal_attempts: HealAttempt[] | null;
  created_at: string;
}

export type RunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'healed';
export type RunnerType = 'playwright' | 'cdp';

export interface TestRun {
  id: string;
  script_id: string;
  status: RunStatus;
  runner_type: RunnerType;
  started_at: string | null;
  completed_at: string | null;
  total_steps: number;
  passed_steps: number;
  failed_steps: number;
  healed_steps: number;
  error_message: string | null;
  created_at: string;
  run_steps?: RunStep[];
}

export interface PlaywrightScript {
  id: string;
  session_id: string;
  name: string;
  description: string | null;
  steps_json: PlaywrightStep[];
  created_at: string;
  updated_at: string;
  runs?: TestRun[];
}

export interface PlaywrightScriptListItem {
  id: string;
  session_id: string;
  name: string;
  description: string | null;
  step_count: number;
  run_count: number;
  last_run_status: RunStatus | null;
  created_at: string;
  updated_at: string;
}

export interface CreateScriptRequest {
  session_id: string;
  name: string;
  description?: string;
}

export interface StartRunRequest {
  headless?: boolean;
  runner?: RunnerType;
}

export interface StartRunResponse {
  run_id: string;
  status: string;
}

// WebSocket message types for runs
export interface WSRunStepStarted {
  type: 'run_step_started';
  step_index: number;
  action: string;
  description: string | null;
}

export interface WSRunStepCompleted {
  type: 'run_step_completed';
  step: RunStep;
}

export interface WSRunCompleted {
  type: 'run_completed';
  run: TestRun;
}

export interface WSRunError {
  type: 'error';
  message: string;
}

export type WSRunMessage = WSRunStepStarted | WSRunStepCompleted | WSRunCompleted | WSRunError;
