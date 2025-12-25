import type { ExecuteResponse, ExecutionLog, LlmModel, TestPlan, TestSession, TestSessionListItem, TestStep } from '../types/analysis';
import { getAuthToken, handleUnauthorized } from '../contexts/AuthContext';

const API_BASE = 'http://localhost:8005';

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

export const analysisApi = {
  /**
   * List all test sessions ordered by creation date (newest first).
   */
  async listSessions(): Promise<TestSessionListItem[]> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<TestSessionListItem[]>(response);
  },

  /**
   * Create a new test session with the given prompt and LLM model.
   * This will also generate a plan using Gemini.
   */
  async createSession(prompt: string, llmModel: LlmModel = 'gemini-2.5-flash'): Promise<TestSession> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ prompt, llm_model: llmModel }),
    });
    return handleResponse<TestSession>(response);
  },

  /**
   * Get a test session by ID with all details including plan and steps.
   */
  async getSession(sessionId: string): Promise<TestSession> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions/${sessionId}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<TestSession>(response);
  },

  /**
   * Delete a test session and all related data.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions/${sessionId}`, {
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
   * Get the plan for a test session.
   */
  async getPlan(sessionId: string): Promise<TestPlan> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions/${sessionId}/plan`, {
      headers: getAuthHeaders(),
    });
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
        headers: getAuthHeaders(),
      }
    );
    return handleResponse<TestSession>(response);
  },

  /**
   * Get all steps for a test session.
   */
  async getSteps(sessionId: string): Promise<TestStep[]> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions/${sessionId}/steps`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<TestStep[]>(response);
  },

  /**
   * Clear all steps for a test session.
   */
  async clearSteps(sessionId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions/${sessionId}/steps`, {
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
   * Start test execution via Celery task.
   */
  async startExecution(sessionId: string): Promise<ExecuteResponse> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/execute`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
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
    const response = await fetch(`${API_BASE}/api/analysis/sessions/${sessionId}/logs${query}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<ExecutionLog[]>(response);
  },
};

/**
 * Get the WebSocket URL for a session.
 */
export function getWebSocketUrl(sessionId: string): string {
  return `ws://localhost:8005/api/analysis/ws/${sessionId}`;
}

/**
 * Get the URL for a screenshot given its file path.
 */
export function getScreenshotUrl(screenshotPath: string): string {
  const token = getAuthToken();
  const baseUrl = `${API_BASE}/api/analysis/screenshot?path=${encodeURIComponent(screenshotPath)}`;
  return token ? `${baseUrl}&token=${encodeURIComponent(token)}` : baseUrl;
}

export { ApiError };
