// Test Plan Module Types

export type TestPlanStatus = 'active' | 'archived';
export type TestPlanRunStatus = 'pending' | 'queued' | 'running' | 'passed' | 'failed' | 'cancelled';
export type TestPlanRunType = 'sequential' | 'parallel';
export type ScheduleType = 'one_time' | 'recurring';
export type BrowserType = 'chromium' | 'firefox' | 'webkit' | 'edge';

export interface TestPlan {
  id: string;
  name: string;
  url: string | null;
  description: string | null;
  status: TestPlanStatus;
  test_case_count: number;
  last_run_status: TestPlanRunStatus | null;
  last_run_at: string | null;
  // Default run settings
  default_run_type: TestPlanRunType;
  browser_type: BrowserType;
  resolution_width: number;
  resolution_height: number;
  headless: boolean;
  screenshots_enabled: boolean;
  recording_enabled: boolean;
  network_recording_enabled: boolean;
  performance_metrics_enabled: boolean;
  // Metadata
  created_at: string;
  updated_at: string;
  user_name: string | null;
}

export interface TestPlanTestCase {
  id: string;
  test_session_id: string;
  title: string | null;
  prompt: string;
  status: string;
  order: number;
  step_count: number;
  created_at: string;
}

export interface TestPlanDetail extends TestPlan {
  test_cases: TestPlanTestCase[];
  recent_runs: TestPlanRun[];
  schedules: TestPlanSchedule[];
}

export interface TestPlanRunResult {
  id: string;
  test_session_id: string | null;
  test_session_title: string | null;
  test_run_id: string | null;
  order: number;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  duration_ms: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface TestPlanRun {
  id: string;
  test_plan_id: string;
  status: TestPlanRunStatus;
  run_type: TestPlanRunType;
  // Run configuration
  browser_type: BrowserType;
  resolution_width: number;
  resolution_height: number;
  headless: boolean;
  screenshots_enabled: boolean;
  recording_enabled: boolean;
  network_recording_enabled: boolean;
  performance_metrics_enabled: boolean;
  // Stats
  total_test_cases: number;
  passed_test_cases: number;
  failed_test_cases: number;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  user_name: string | null;
  celery_task_id: string | null;
}

export interface TestPlanRunDetail extends TestPlanRun {
  results: TestPlanRunResult[];
}

export interface TestPlanSchedule {
  id: string;
  test_plan_id: string;
  name: string;
  schedule_type: ScheduleType;
  run_type: TestPlanRunType;
  one_time_at: string | null;
  cron_expression: string | null;
  timezone: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginatedTestPlans {
  items: TestPlan[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Request types
export interface CreateTestPlanRequest {
  name: string;
  url?: string;
  description?: string;
}

export interface UpdateTestPlanRequest {
  name?: string;
  url?: string;
  description?: string;
  status?: TestPlanStatus;
}

export interface UpdateTestPlanSettingsRequest {
  default_run_type?: TestPlanRunType;
  browser_type?: BrowserType;
  resolution_width?: number;
  resolution_height?: number;
  headless?: boolean;
  screenshots_enabled?: boolean;
  recording_enabled?: boolean;
  network_recording_enabled?: boolean;
  performance_metrics_enabled?: boolean;
}

export interface RunTestPlanRequest {
  run_type: TestPlanRunType;
  browser_type?: BrowserType;
  resolution_width?: number;
  resolution_height?: number;
  headless?: boolean;
  screenshots_enabled?: boolean;
  recording_enabled?: boolean;
  network_recording_enabled?: boolean;
  performance_metrics_enabled?: boolean;
}

export interface CreateScheduleRequest {
  name: string;
  schedule_type: ScheduleType;
  run_type?: TestPlanRunType;
  one_time_at?: string;
  cron_expression?: string;
  timezone?: string;
}

export interface UpdateScheduleRequest {
  name?: string;
  schedule_type?: ScheduleType;
  run_type?: TestPlanRunType;
  one_time_at?: string;
  cron_expression?: string;
  timezone?: string;
  is_active?: boolean;
}

export interface StartTestPlanRunResponse {
  run_id: string;
  status: string;
  celery_task_id: string | null;
}

export interface TestCaseOrder {
  test_session_id: string;
  order: number;
}
