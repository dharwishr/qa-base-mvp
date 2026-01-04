// Script and Test Run types matching backend schemas

// Enums for run configuration
export type BrowserType = 'chromium' | 'firefox' | 'webkit' | 'edge';
export type Resolution = '1920x1080' | '1366x768' | '1600x900';
export type IsolationMode = 'context' | 'ephemeral';

// System-wide settings
export interface SystemSettings {
  isolation_mode: IsolationMode;
  updated_at: string | null;
}

// Container pool stats
export interface PooledContainer {
  id: string;
  container_id: string;
  container_name: string;
  browser_type: BrowserType;
  status: 'starting' | 'ready' | 'in_use' | 'recycling' | 'error';
  cdp_port: number;
  cdp_ws_url: string | null;
  container_ip: string | null;
  created_at: string;
  last_used_at: string;
  use_count: number;
  current_run_id: string | null;
  error_message: string | null;
}

export interface ContainerPoolStats {
  initialized: boolean;
  pools: {
    [browserType: string]: {
      size: number;
      containers: PooledContainer[];
    };
  };
  in_use_count: number;
  in_use: PooledContainer[];
}

// Run configuration options
export interface RunConfiguration {
  browser_type: BrowserType;
  resolution: Resolution;
  screenshots_enabled: boolean;
  recording_enabled: boolean;
  network_recording_enabled: boolean;
  performance_metrics_enabled: boolean;
}

// Network request captured during a run
export interface NetworkRequest {
  id: string;
  run_id: string;
  step_index: number | null;
  url: string;
  method: string;
  resource_type: string;
  status_code: number | null;
  response_size_bytes: number | null;
  timing_dns_ms: number | null;
  timing_connect_ms: number | null;
  timing_ssl_ms: number | null;
  timing_ttfb_ms: number | null;
  timing_download_ms: number | null;
  timing_total_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
}

// Console log captured during a run
export interface ConsoleLog {
  id: string;
  run_id: string;
  step_index: number | null;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source: string | null;
  line_number: number | null;
  column_number: number | null;
  stack_trace: string | null;
  timestamp: string | null;
}

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

export interface TestRun {
  id: string;
  script_id: string;
  status: RunStatus;
  started_at: string | null;
  completed_at: string | null;
  total_steps: number;
  passed_steps: number;
  failed_steps: number;
  healed_steps: number;
  error_message: string | null;
  created_at: string;
  run_steps?: RunStep[];
  // New configuration fields
  browser_type: BrowserType;
  resolution_width: number;
  resolution_height: number;
  screenshots_enabled: boolean;
  recording_enabled: boolean;
  network_recording_enabled: boolean;
  performance_metrics_enabled: boolean;
  // New output fields
  video_path: string | null;
  duration_ms: number | null;
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
  browser_type?: BrowserType;
  resolution?: Resolution;
  screenshots_enabled?: boolean;
  recording_enabled?: boolean;
  network_recording_enabled?: boolean;
  performance_metrics_enabled?: boolean;
}

export interface StartRunResponse {
  run_id: string;
  status: string;
  celery_task_id: string | null;
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

export interface WSBrowserSessionStarted {
  type: 'browser_session_started';
  session_id: string;
  cdp_url: string;
  live_view_url: string;
}

export interface WSNetworkRequest {
  type: 'network_request';
  data: {
    url: string;
    method: string;
    status_code: number | null;
    timing_total_ms: number | null;
    resource_type: string;
  };
}

export interface WSConsoleLog {
  type: 'console_log';
  data: {
    level: string;
    message: string;
    source: string | null;
  };
}

export type WSRunMessage = WSRunStepStarted | WSRunStepCompleted | WSRunCompleted | WSRunError | WSBrowserSessionStarted | WSNetworkRequest | WSConsoleLog;
