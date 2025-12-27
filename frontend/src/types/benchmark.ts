// Benchmark types matching backend schemas
import type { LlmModel, TestStep } from './analysis';

export type BenchmarkMode = 'auto' | 'plan' | 'act';

export type BenchmarkModelRunStatus = 
  | 'pending' 
  | 'planning' 
  | 'plan_ready' 
  | 'approved' 
  | 'rejected' 
  | 'queued' 
  | 'running' 
  | 'completed' 
  | 'failed';

export interface BenchmarkModelRun {
  id: string;
  llm_model: LlmModel;
  test_session_id: string | null;
  celery_task_id: string | null;
  status: BenchmarkModelRunStatus;
  started_at: string | null;
  completed_at: string | null;
  total_steps: number;
  duration_seconds: number;
  error: string | null;
  created_at: string;
}

export type BenchmarkSessionStatus = 
  | 'pending' 
  | 'planning' 
  | 'plan_ready' 
  | 'running' 
  | 'completed' 
  | 'failed';

export interface BenchmarkSession {
  id: string;
  prompt: string;
  title: string | null;
  selected_models: LlmModel[];
  headless: boolean;
  mode: BenchmarkMode;
  status: BenchmarkSessionStatus;
  created_at: string;
  updated_at: string;
  model_runs: BenchmarkModelRun[];
}

export interface BenchmarkSessionListItem {
  id: string;
  prompt: string;
  title: string | null;
  selected_models: LlmModel[];
  status: 'pending' | 'planning' | 'plan_ready' | 'running' | 'completed' | 'failed';
  mode: BenchmarkMode;
  created_at: string;
  updated_at: string;
  model_run_count: number;
  completed_count: number;
}

export interface CreateBenchmarkRequest {
  prompt: string;
  models: LlmModel[];
  headless: boolean;
  mode: BenchmarkMode;
}

export interface StartBenchmarkResponse {
  benchmark_id: string;
  status: string;
  task_ids: string[];
}

// Model run with steps for display
export interface BenchmarkModelRunWithSteps extends BenchmarkModelRun {
  steps: TestStep[];
}

// Browser session info for a model run
export interface ModelBrowserSession {
  modelRunId: string;
  llmModel: LlmModel;
  browserSessionId: string | null;
  liveViewUrl?: string;
  novncUrl?: string;
}
