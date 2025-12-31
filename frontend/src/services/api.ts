import type { ActModeResponse, ChatMessage, ChatMessageCreate, ExecuteResponse, ExecutionLog, LlmModel, RecordingMode, RecordingStatusResponse, ReplayResponse, StepAction, TestPlan, TestSession, TestSessionListItem, TestStep, UndoResponse } from '../types/analysis';
import type { PlaywrightScript, PlaywrightScriptListItem, TestRun, RunStep, CreateScriptRequest, StartRunRequest, StartRunResponse } from '../types/scripts';
import { getAuthToken, handleUnauthorized } from '../contexts/AuthContext';
import { config, getWsUrl } from '../config';

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
   * Create a new test session with the given prompt, LLM model, and headless option.
   * This will also generate a plan using Gemini.
   */
  async createSession(prompt: string, llmModel: LlmModel = 'gemini-2.5-flash', headless: boolean = true): Promise<TestSession> {
    const response = await fetch(`${API_BASE}/api/analysis/sessions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ prompt, llm_model: llmModel, headless }),
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
   * Delete a single step and renumber remaining steps.
   */
  async deleteStep(stepId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/analysis/steps/${stepId}`, {
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

  /**
   * Stop a running test execution by revoking the Celery task.
   */
  async stopExecution(sessionId: string): Promise<{ status: string; message: string }> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/stop`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      }
    );
    return handleResponse<{ status: string; message: string }>(response);
  },

  /**
   * End the browser session for a test session.
   * This cleans up browser resources while keeping the test session data.
   */
  async endBrowserSession(sessionId: string): Promise<{ status: string; message: string }> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/end-browser`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      }
    );
    return handleResponse<{ status: string; message: string }>(response);
  },

  /**
   * Get all chat messages for a test session.
   */
  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/messages`,
      {
        headers: getAuthHeaders(),
      }
    );
    return handleResponse<ChatMessage[]>(response);
  },

  /**
   * Create a new chat message for a test session.
   */
  async createMessage(sessionId: string, message: ChatMessageCreate): Promise<ChatMessage> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(message),
      }
    );
    return handleResponse<ChatMessage>(response);
  },

  /**
   * Reject a plan and allow re-planning.
   */
  async rejectPlan(sessionId: string, reason?: string): Promise<TestSession> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/reject`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason }),
      }
    );
    return handleResponse<TestSession>(response);
  },

  /**
   * Continue an existing session with a new task.
   * This allows adding more tasks to a completed session without creating a new one.
   */
  async continueSession(sessionId: string, prompt: string, llmModel: LlmModel = 'gemini-2.5-flash', mode: 'plan' | 'act' = 'act'): Promise<TestSession> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/continue`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ prompt, llm_model: llmModel, mode }),
      }
    );
    return handleResponse<TestSession>(response);
  },

  /**
   * Execute a single action in act mode.
   * This executes one browser action and returns immediately without iterative planning.
   */
  async executeActMode(sessionId: string, task: string): Promise<ActModeResponse> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/act`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ task }),
      }
    );
    return handleResponse<ActModeResponse>(response);
  },

  /**
   * Undo to a specific step in a test session.
   * This will delete all steps after the target step and replay steps 1 through target_step_number
   * in the current browser session.
   * 
   * Note: This does NOT revert any changes made to the application under test.
   * It only repositions the browser state by replaying the earlier steps.
   */
  async undoToStep(sessionId: string, targetStepNumber: number): Promise<UndoResponse> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/undo`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ target_step_number: targetStepNumber }),
      }
    );
    return handleResponse<UndoResponse>(response);
  },

  /**
   * Replay all steps in an existing test session.
   * This starts a new browser session and replays all recorded steps.
   * Use this to re-initiate an older test case analysis session.
   */
  async replaySession(sessionId: string, headless: boolean = false): Promise<ReplayResponse> {
    // Use AbortController for timeout - replay can take a while for many steps
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout

    try {
      const response = await fetch(
        `${API_BASE}/api/analysis/sessions/${sessionId}/replay`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ headless }),
          signal: controller.signal,
        }
      );
      return handleResponse<ReplayResponse>(response);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Replay timed out after 5 minutes. Please try again.');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  /**
   * Update the title of a test session.
   */
  async updateSessionTitle(sessionId: string, title: string): Promise<TestSession> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/title`,
      {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ title }),
      }
    );
    return handleResponse<TestSession>(response);
  },

  /**
   * Start recording user interactions in the live browser.
   * This captures clicks, typing, scrolling, and other user actions as test steps.
   *
   * @param sessionId - The test session ID
   * @param browserSessionId - The browser session ID to record from
   * @param recordingMode - Recording mode: 'playwright' (default, blur-based input) or 'cdp' (legacy)
   */
  async startRecording(
    sessionId: string,
    browserSessionId: string,
    recordingMode: RecordingMode = 'playwright'
  ): Promise<RecordingStatusResponse> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/recording/start`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          browser_session_id: browserSessionId,
          recording_mode: recordingMode,
        }),
      }
    );
    return handleResponse<RecordingStatusResponse>(response);
  },

  /**
   * Stop recording user interactions.
   */
  async stopRecording(sessionId: string): Promise<RecordingStatusResponse> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/recording/stop`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      }
    );
    return handleResponse<RecordingStatusResponse>(response);
  },

  /**
   * Get current recording status for a session.
   */
  async getRecordingStatus(sessionId: string): Promise<RecordingStatusResponse> {
    const response = await fetch(
      `${API_BASE}/api/analysis/sessions/${sessionId}/recording/status`,
      {
        headers: getAuthHeaders(),
      }
    );
    return handleResponse<RecordingStatusResponse>(response);
  },

  /**
   * Update the text value for a type_text action.
   * This allows editing recorded input text.
   */
  async updateActionText(actionId: string, text: string): Promise<StepAction> {
    const response = await fetch(
      `${API_BASE}/api/analysis/actions/${actionId}/text`,
      {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ text }),
      }
    );
    return handleResponse<StepAction>(response);
  },

  /**
   * Update step action fields (xpath, css_selector, text).
   * Only allowed when session is in post-execution state (completed, failed, stopped, paused).
   */
  async updateAction(
    actionId: string,
    updates: { element_xpath?: string; css_selector?: string; text?: string }
  ): Promise<StepAction> {
    const response = await fetch(
      `${API_BASE}/api/analysis/actions/${actionId}`,
      {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates),
      }
    );
    return handleResponse<StepAction>(response);
  },
};

/**
 * Get the WebSocket URL for a session.
 */
export function getWebSocketUrl(sessionId: string): string {
  return getWsUrl(`/api/analysis/ws/${sessionId}`);
}

/**
 * Get the URL for a screenshot given its file path.
 */
export function getScreenshotUrl(screenshotPath: string): string {
  const token = getAuthToken();
  const baseUrl = `${API_BASE}/api/analysis/screenshot?path=${encodeURIComponent(screenshotPath)}`;
  return token ? `${baseUrl}&token=${encodeURIComponent(token)}` : baseUrl;
}

/**
 * Scripts API - Playwright scripts and test runs
 */
export const scriptsApi = {
  /**
   * List all Playwright scripts.
   */
  async listScripts(): Promise<PlaywrightScriptListItem[]> {
    const response = await fetch(`${API_BASE}/scripts`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<PlaywrightScriptListItem[]>(response);
  },

  /**
   * Get a script by ID with run history.
   */
  async getScript(scriptId: string): Promise<PlaywrightScript> {
    const response = await fetch(`${API_BASE}/scripts/${scriptId}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<PlaywrightScript>(response);
  },

  /**
   * Create a new script from a completed session.
   */
  async createScript(request: CreateScriptRequest): Promise<PlaywrightScript> {
    const response = await fetch(`${API_BASE}/scripts`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(request),
    });
    return handleResponse<PlaywrightScript>(response);
  },

  /**
   * Delete a script and its runs.
   */
  async deleteScript(scriptId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/scripts/${scriptId}`, {
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
   * Start a test run for a script.
   */
  async startRun(scriptId: string, request: StartRunRequest = {}): Promise<StartRunResponse> {
    const response = await fetch(`${API_BASE}/scripts/${scriptId}/run`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(request),
    });
    return handleResponse<StartRunResponse>(response);
  },

  /**
   * List all runs for a script.
   */
  async listRuns(scriptId: string): Promise<TestRun[]> {
    const response = await fetch(`${API_BASE}/scripts/${scriptId}/runs`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<TestRun[]>(response);
  },
};

/**
 * Runs API - Test run results
 */
export const runsApi = {
  /**
   * Get a run by ID with step results.
   */
  async getRun(runId: string): Promise<TestRun> {
    const response = await fetch(`${API_BASE}/runs/${runId}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<TestRun>(response);
  },

  /**
   * Get all steps for a run.
   */
  async getRunSteps(runId: string): Promise<RunStep[]> {
    const response = await fetch(`${API_BASE}/runs/${runId}/steps`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<RunStep[]>(response);
  },
};

/**
 * Get the WebSocket URL for a test run.
 */
export function getRunWebSocketUrl(runId: string): string {
  return getWsUrl(`/runs/${runId}/ws`);
}

/**
 * Discovery API - Module discovery sessions
 */
export const discoveryApi = {
  /**
   * Create a new discovery session and start crawling.
   */
  async createSession(request: {
    url: string;
    username?: string;
    password?: string;
    max_steps?: number;
  }): Promise<{ session_id: string; status: string; message: string }> {
    const response = await fetch(`${API_BASE}/api/discovery/sessions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(request),
    });
    return handleResponse(response);
  },

  /**
   * List all discovery sessions.
   */
  async listSessions(): Promise<Array<{
    id: string;
    url: string;
    status: string;
    total_steps: number;
    duration_seconds: number;
    module_count: number;
    created_at: string;
  }>> {
    const response = await fetch(`${API_BASE}/api/discovery/sessions`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(response);
  },

  /**
   * Get a discovery session with its modules.
   */
  async getSession(sessionId: string): Promise<{
    id: string;
    url: string;
    username?: string;
    max_steps: number;
    status: string;
    total_steps: number;
    duration_seconds: number;
    error?: string;
    created_at: string;
    updated_at: string;
    modules: Array<{
      id: string;
      name: string;
      url: string;
      summary: string;
      created_at: string;
    }>;
  }> {
    const response = await fetch(`${API_BASE}/api/discovery/sessions/${sessionId}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(response);
  },

  /**
   * Delete a discovery session.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/discovery/sessions/${sessionId}`, {
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
};

// ============================================
// Browser API
// ============================================

export interface BrowserSession {
  id: string;
  phase: string;
  status: string;
  cdp_url: string | null;
  novnc_url: string | null;
  live_view_url: string | null;
  created_at: string;
  expires_at: string | null;
  test_session_id: string | null;
  test_run_id: string | null;
  error_message: string | null;
}

export const browserApi = {
  /**
   * List all browser sessions.
   */
  async listSessions(phase?: string, activeOnly: boolean = true): Promise<BrowserSession[]> {
    const params = new URLSearchParams();
    if (phase) params.set('phase', phase);
    if (activeOnly) params.set('active_only', 'true');

    const response = await fetch(`${API_BASE}/browser/sessions?${params}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<BrowserSession[]>(response);
  },

  /**
   * Stop a browser session.
   */
  async stopSession(sessionId: string): Promise<{ status: string; session_id: string }> {
    const response = await fetch(`${API_BASE}/browser/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return handleResponse(response);
  },

  /**
   * Touch a browser session to keep it alive (reset inactivity timer).
   */
  async touchSession(sessionId: string): Promise<{ status: string; session_id: string }> {
    const response = await fetch(`${API_BASE}/browser/sessions/${sessionId}/touch`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse(response);
  },

  /**
   * Stop all browser sessions (kill all browsers).
   */
  async stopAllSessions(): Promise<{ status: string; stopped_count: number }> {
    const response = await fetch(`${API_BASE}/browser/sessions/stop-all`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse(response);
  },
};

/**
 * Speech API - Voice input transcription
 */
export const speechApi = {
  /**
   * Transcribe audio to text using Google Cloud Speech-to-Text.
   * @param audioData Base64 encoded audio data (WebM/Opus format)
   * @param languageCode BCP-47 language code (default: en-US)
   */
  async transcribe(audioData: string, languageCode: string = 'en-US'): Promise<{
    transcript: string;
    confidence: number;
    is_final: boolean;
  }> {
    const response = await fetch(`${API_BASE}/api/speech/transcribe`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ audio_data: audioData, language_code: languageCode }),
    });
    return handleResponse(response);
  },
};

export { ApiError };

