import type {
  BenchmarkSession,
  BenchmarkSessionListItem,
  BenchmarkModelRun,
  CreateBenchmarkRequest,
  StartBenchmarkResponse,
} from '../types/benchmark';
import type { TestPlan, ActModeResponse } from '../types/analysis';
import type { TestStep } from '../types/analysis';
import { getAuthToken, handleUnauthorized } from '../contexts/AuthContext';
import { config } from '../config';

const API_BASE = config.API_URL;

class ApiError extends Error {
  public status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

function getAuthHeaders(): HeadersInit {
  const token = getAuthToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    handleUnauthorized();
    throw new ApiError(401, 'Unauthorized');
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      errorData.detail || `HTTP error ${response.status}`
    );
  }
  return response.json();
}

export const benchmarkApi = {
  /**
   * List all benchmark sessions ordered by creation date (newest first).
   */
  async listSessions(): Promise<BenchmarkSessionListItem[]> {
    const response = await fetch(`${API_BASE}/api/benchmark/sessions`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<BenchmarkSessionListItem[]>(response);
  },

  /**
   * Create a new benchmark session with selected models.
   */
  async createSession(request: CreateBenchmarkRequest): Promise<BenchmarkSession> {
    const response = await fetch(`${API_BASE}/api/benchmark/sessions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(request),
    });
    return handleResponse<BenchmarkSession>(response);
  },

  /**
   * Get a benchmark session by ID with all model runs.
   */
  async getSession(benchmarkId: string): Promise<BenchmarkSession> {
    const response = await fetch(`${API_BASE}/api/benchmark/sessions/${benchmarkId}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<BenchmarkSession>(response);
  },

  /**
   * Delete a benchmark session and all related data.
   */
  async deleteSession(benchmarkId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/benchmark/sessions/${benchmarkId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      if (response.status === 204) return;
      if (response.status === 401) {
        handleUnauthorized();
        throw new ApiError(401, 'Unauthorized');
      }
      await handleResponse(response);
    }
  },

  /**
   * Start all model runs for a benchmark session in parallel.
   */
  async startBenchmark(benchmarkId: string): Promise<StartBenchmarkResponse> {
    const response = await fetch(`${API_BASE}/api/benchmark/sessions/${benchmarkId}/start`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse<StartBenchmarkResponse>(response);
  },

  /**
   * Stop all running model runs for a benchmark session.
   */
  async stopBenchmark(benchmarkId: string): Promise<{ status: string; stopped_count: number }> {
    const response = await fetch(`${API_BASE}/api/benchmark/sessions/${benchmarkId}/stop`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse<{ status: string; stopped_count: number }>(response);
  },

  /**
   * Get a specific model run by ID.
   */
  async getModelRun(benchmarkId: string, modelRunId: string): Promise<BenchmarkModelRun> {
    const response = await fetch(
      `${API_BASE}/api/benchmark/sessions/${benchmarkId}/runs/${modelRunId}`,
      {
        headers: getAuthHeaders(),
      }
    );
    return handleResponse<BenchmarkModelRun>(response);
  },

  /**
   * Get all steps for a specific model run.
   */
  async getModelRunSteps(benchmarkId: string, modelRunId: string): Promise<TestStep[]> {
    const response = await fetch(
      `${API_BASE}/api/benchmark/sessions/${benchmarkId}/runs/${modelRunId}/steps`,
      {
        headers: getAuthHeaders(),
      }
    );
    return handleResponse<TestStep[]>(response);
  },

  // ============================================
  // Plan Mode APIs
  // ============================================

  /**
   * Start plan generation for all models (Plan mode).
   */
  async startPlan(benchmarkId: string): Promise<StartBenchmarkResponse> {
    const response = await fetch(`${API_BASE}/api/benchmark/sessions/${benchmarkId}/start-plan`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse<StartBenchmarkResponse>(response);
  },

  /**
   * Get the plan for a specific model run.
   */
  async getModelRunPlan(benchmarkId: string, modelRunId: string): Promise<TestPlan | null> {
    const response = await fetch(
      `${API_BASE}/api/benchmark/sessions/${benchmarkId}/runs/${modelRunId}/plan`,
      {
        headers: getAuthHeaders(),
      }
    );
    return handleResponse<TestPlan | null>(response);
  },

  /**
   * Approve a model run's plan.
   */
  async approvePlan(benchmarkId: string, modelRunId: string): Promise<{ status: string; model_run_id: string }> {
    const response = await fetch(
      `${API_BASE}/api/benchmark/sessions/${benchmarkId}/runs/${modelRunId}/approve-plan`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      }
    );
    return handleResponse<{ status: string; model_run_id: string }>(response);
  },

  /**
   * Reject a model run's plan.
   */
  async rejectPlan(benchmarkId: string, modelRunId: string): Promise<{ status: string; model_run_id: string }> {
    const response = await fetch(
      `${API_BASE}/api/benchmark/sessions/${benchmarkId}/runs/${modelRunId}/reject-plan`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      }
    );
    return handleResponse<{ status: string; model_run_id: string }>(response);
  },

  /**
   * Execute all approved plans.
   */
  async executeApproved(benchmarkId: string): Promise<StartBenchmarkResponse> {
    const response = await fetch(`${API_BASE}/api/benchmark/sessions/${benchmarkId}/execute-approved`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse<StartBenchmarkResponse>(response);
  },

  // ============================================
  // Act Mode APIs
  // ============================================

  /**
   * Start act mode for a benchmark session.
   */
  async startAct(benchmarkId: string): Promise<{ status: string; benchmark_id: string }> {
    const response = await fetch(`${API_BASE}/api/benchmark/sessions/${benchmarkId}/start-act`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse<{ status: string; benchmark_id: string }>(response);
  },

  /**
   * Execute a single action on a specific model run (Act mode).
   */
  async actOnModelRun(
    benchmarkId: string,
    modelRunId: string,
    action: string,
    previousContext?: string
  ): Promise<ActModeResponse> {
    const response = await fetch(
      `${API_BASE}/api/benchmark/sessions/${benchmarkId}/runs/${modelRunId}/act`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ action, previous_context: previousContext }),
      }
    );
    return handleResponse<ActModeResponse>(response);
  },

  // ============================================
  // Per-Model Chat APIs
  // ============================================

  /**
   * Continue a model run with a new prompt (allows per-model chat).
   */
  async continueModelRun(
    benchmarkId: string,
    modelRunId: string,
    prompt: string,
    mode: 'plan' | 'act'
  ): Promise<BenchmarkModelRun> {
    const response = await fetch(
      `${API_BASE}/api/benchmark/sessions/${benchmarkId}/runs/${modelRunId}/continue`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ prompt, mode }),
      }
    );
    return handleResponse<BenchmarkModelRun>(response);
  },
};

export { ApiError };
