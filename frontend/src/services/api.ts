import type { ExecuteResponse, ExecutionLog, LlmModel, TestPlan, TestSession, TestSessionListItem, TestStep } from '../types/analysis';

const API_BASE = 'http://localhost:8000';

class ApiError extends Error {
  public status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      errorData.detail || `HTTP error ${response.status}`
    );
  }
  return response.json();
}

export const analysisApi = {
  /**
   * List all test sessions ordered by creation date (newest first).
   */
  async listSessions(): Promise<TestSessionListItem[]> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions`);
    return handleResponse<TestSessionListItem[]>(response);
  },

  /**
   * Create a new test session with the given prompt and LLM model.
   * This will also generate a plan using Gemini.
   */
  async createSession(prompt: string, llmModel: LlmModel = 'gemini-2.5-flash'): Promise<TestSession> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, llm_model: llmModel }),
    });
    return handleResponse<TestSession>(response);
  },

  /**
   * Get a test session by ID with all details including plan and steps.
   */
  async getSession(sessionId: string): Promise<TestSession> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions/${sessionId}`);
    return handleResponse<TestSession>(response);
  },

  /**
   * Delete a test session and all related data.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      if (response.status === 204) return;
      await handleResponse(response);
    }
  },

  /**
   * Get the plan for a test session.
   */
  async getPlan(sessionId: string): Promise<TestPlan> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions/${sessionId}/plan`);
    return handleResponse<TestPlan>(response);
  },

  /**
   * Approve a plan and mark session as ready for execution.
   */
  async approvePlan(sessionId: string): Promise<TestSession> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/approve`,
      {
        method: 'POST',
      }
    );
    return handleResponse<TestSession>(response);
  },

  /**
   * Get all steps for a test session.
   */
  async getSteps(sessionId: string): Promise<TestStep[]> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions/${sessionId}/steps`);
    return handleResponse<TestStep[]>(response);
  },

  /**
   * Clear all steps for a test session.
   */
  async clearSteps(sessionId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions/${sessionId}/steps`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      // We reuse handleResponse but expect no content, so manual check or use generic if handleResponse handles 204
      if (response.status === 204) return;
      await handleResponse(response);
    }
  },

  /**
   * Start test execution via Celery task.
   */
  async startExecution(sessionId: string): Promise<ExecuteResponse> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/execute`,
      {
        method: 'POST',
      }
    );
    return handleResponse<ExecuteResponse>(response);
  },

  /**
   * Get execution logs for a session.
   */
  async getLogs(sessionId: string, level?: string): Promise<ExecutionLog[]> {
    const params = new URLSearchParams();
    if (level) {
      params.append('level', level);
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${API_BASE}/api/analysis/sessions/${sessionId}/logs${query}`);
    return handleResponse<ExecutionLog[]>(response);
  },
};

/**
 * Get the WebSocket URL for a session.
 */
export function getWebSocketUrl(sessionId: string): string {
  return `ws://localhost:8000/api/analysis/ws/${sessionId}`;
}

/**
 * Get the URL for a screenshot given its file path.
 */
export function getScreenshotUrl(screenshotPath: string): string {
  return `${API_BASE}/api/analysis/screenshot?path=${encodeURIComponent(screenshotPath)}`;
}

export { ApiError };
