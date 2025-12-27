import { useCallback, useEffect, useRef, useState } from 'react';
import { analysisApi } from '../services/api';
import { getAuthToken } from '../contexts/AuthContext';
import { config } from '../config';
import type { TestSession, LlmModel, ReplayResponse } from '../types/analysis';
import type {
  TimelineMessage,
  ChatMode,
  PlanStep,
} from '../types/chat';

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function createTimelineMessage<T extends TimelineMessage>(
  type: T['type'],
  data: Omit<T, 'id' | 'timestamp' | 'type'>
): T {
  return {
    id: generateUUID(),
    timestamp: new Date().toISOString(),
    type,
    ...data,
  } as T;
}

interface BrowserSessionInfo {
  id: string;
  liveViewUrl?: string;
  novncUrl?: string;
}

export interface ReplayFailure {
  failedAtStep: number;
  totalSteps: number;
  errorMessage: string;
}

interface UseExistingSessionReturn {
  // State
  messages: TimelineMessage[];
  sessionId: string | null;
  sessionStatus: string | null;
  currentSession: TestSession | null;
  browserSession: BrowserSessionInfo | null;
  mode: ChatMode;
  selectedLlm: LlmModel;
  headless: boolean;
  isLoading: boolean;
  isReplaying: boolean;
  isExecuting: boolean;
  isPlanPending: boolean;
  selectedStepId: string | null;
  error: string | null;
  totalSteps: number;
  replayFailure: ReplayFailure | null;

  // Actions
  loadSession: (id: string) => Promise<void>;
  replaySession: () => Promise<void>;
  sendMessage: (text: string, messageMode: ChatMode) => Promise<void>;
  approvePlan: (planId: string) => Promise<void>;
  rejectPlan: (planId: string, reason?: string) => Promise<void>;
  stopExecution: () => Promise<void>;
  endBrowserSession: () => Promise<void>;
  forkFromStep: (stepNumber: number) => Promise<void>;
  undoToStep: (stepNumber: number) => Promise<void>;
  clearReplayFailure: () => void;
  setMode: (mode: ChatMode) => void;
  setSelectedLlm: (llm: LlmModel) => void;
  setHeadless: (headless: boolean) => void;
  setSelectedStepId: (stepId: string | null) => void;
}

const POLL_INTERVAL = 2000;

export function useExistingSession(): UseExistingSessionReturn {
  const [messages, setMessages] = useState<TimelineMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<TestSession | null>(null);
  const [browserSession, setBrowserSession] = useState<BrowserSessionInfo | null>(null);
  const [mode, setMode] = useState<ChatMode>('act');
  const [selectedLlm, setSelectedLlm] = useState<LlmModel>('gemini-2.5-flash');
  const [headless, setHeadless] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPlanPending, setIsPlanPending] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replayFailure, setReplayFailure] = useState<ReplayFailure | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStepCountRef = useRef(0);

  const totalSteps = messages.filter(m => m.type === 'step').length;

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const stopBrowserPolling = useCallback(() => {
    if (browserPollIntervalRef.current) {
      clearInterval(browserPollIntervalRef.current);
      browserPollIntervalRef.current = null;
    }
  }, []);

  const startBrowserPolling = useCallback((testSessionId: string) => {
    stopBrowserPolling();

    const checkBrowserSession = async () => {
      try {
        const response = await fetch(
          `${config.API_URL}/browser/sessions?phase=analysis&active_only=true`,
          {
            headers: {
              Authorization: `Bearer ${getAuthToken()}`,
            },
          }
        );
        if (response.ok) {
          const sessions = await response.json();
          const matching = sessions.find(
            (s: { test_session_id: string }) => s.test_session_id === testSessionId
          );
          if (matching) {
            setBrowserSession({
              id: matching.id,
              liveViewUrl: `/browser/sessions/${matching.id}/view`,
              novncUrl: matching.novnc_url,
            });
          }
        }
      } catch (e) {
        console.error('Error checking browser session:', e);
      }
    };

    checkBrowserSession();
    browserPollIntervalRef.current = setInterval(checkBrowserSession, 3000);
  }, [stopBrowserPolling]);

  // Load an existing session
  const loadSession = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    setMessages([]);
    setReplayFailure(null);

    try {
      const session = await analysisApi.getSession(id);
      setSessionId(session.id);
      setSessionStatus(session.status);
      setCurrentSession(session);
      setSelectedLlm(session.llm_model);
      setHeadless(session.headless);

      // Build timeline messages from session data
      const timelineMessages: TimelineMessage[] = [];

      // Add user message (original prompt)
      timelineMessages.push(
        createTimelineMessage('user', {
          content: session.prompt,
          mode: 'plan' as ChatMode,
        })
      );

      // Add plan if exists
      if (session.plan) {
        const planSteps: PlanStep[] = session.plan.steps_json?.steps || [];
        timelineMessages.push(
          createTimelineMessage('plan', {
            planId: session.id,
            planText: session.plan.plan_text,
            planSteps,
            status: session.plan.approval_status === 'approved' ? 'approved' as const : 'pending' as const,
          })
        );
      }

      // Add steps
      if (session.steps && session.steps.length > 0) {
        for (const step of session.steps) {
          timelineMessages.push(
            createTimelineMessage('step', { step })
          );
        }
        lastStepCountRef.current = session.steps.length;

        // Select the last step
        setSelectedStepId(session.steps[session.steps.length - 1].id);
      }

      // Add completion message based on status
      if (session.status === 'completed') {
        timelineMessages.push(
          createTimelineMessage('system', {
            content: `Test completed successfully with ${session.steps?.length || 0} steps`,
          })
        );
      } else if (session.status === 'failed') {
        timelineMessages.push(
          createTimelineMessage('system', {
            content: 'Test execution failed',
          })
        );
      } else if (session.status === 'stopped') {
        timelineMessages.push(
          createTimelineMessage('system', {
            content: `Test stopped after ${session.steps?.length || 0} steps`,
          })
        );
      }

      setMessages(timelineMessages);
    } catch (e) {
      console.error('Error loading session:', e);
      setError(e instanceof Error ? e.message : 'Failed to load session');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Replay all steps in the session
  const replaySession = useCallback(async () => {
    if (!sessionId) return;

    setIsReplaying(true);
    setError(null);
    setReplayFailure(null);

    setMessages((prev) => [
      ...prev,
      createTimelineMessage('system', {
        content: 'Re-initiating session... Starting browser and replaying steps.',
      }),
    ]);

    try {
      const result: ReplayResponse = await analysisApi.replaySession(sessionId, headless);

      if (result.success) {
        setMessages((prev) => [
          ...prev,
          createTimelineMessage('system', {
            content: result.user_message || `Successfully replayed all ${result.total_steps} steps.`,
          }),
        ]);

        // Start browser polling if we have a browser session
        if (result.browser_session_id) {
          setBrowserSession({
            id: result.browser_session_id,
            liveViewUrl: `/browser/sessions/${result.browser_session_id}/view`,
          });
          startBrowserPolling(sessionId);
        }
      } else {
        // Handle failure - show dialog for user choice
        if (result.failed_at_step !== null) {
          setReplayFailure({
            failedAtStep: result.failed_at_step,
            totalSteps: result.total_steps,
            errorMessage: result.error_message || 'Replay failed',
          });

          setMessages((prev) => [
            ...prev,
            createTimelineMessage('error', {
              content: result.user_message || `Replay failed at step ${result.failed_at_step}: ${result.error_message}`,
            }),
          ]);

          // Still set browser session if available (for partial replay)
          if (result.browser_session_id) {
            setBrowserSession({
              id: result.browser_session_id,
              liveViewUrl: `/browser/sessions/${result.browser_session_id}/view`,
            });
            startBrowserPolling(sessionId);
          }
        } else {
          setMessages((prev) => [
            ...prev,
            createTimelineMessage('error', {
              content: result.error_message || 'Replay failed',
            }),
          ]);
        }
      }
    } catch (e) {
      console.error('Error replaying session:', e);
      const errorMsg = e instanceof Error ? e.message : 'Failed to replay session';
      setError(errorMsg);
      setMessages((prev) => [
        ...prev,
        createTimelineMessage('error', {
          content: errorMsg,
        }),
      ]);
    } finally {
      setIsReplaying(false);
    }
  }, [sessionId, headless, startBrowserPolling]);

  // Fork from a specific step (create new session with steps up to that point)
  const forkFromStep = useCallback(async (stepNumber: number) => {
    if (!sessionId || !currentSession) return;

    setReplayFailure(null);
    setMessages((prev) => [
      ...prev,
      createTimelineMessage('system', {
        content: `Creating new test case from steps 1-${stepNumber}...`,
      }),
    ]);

    // For now, we'll just undo to that step in the current session
    // In a full implementation, you would create a new session with copied steps
    try {
      const result = await analysisApi.undoToStep(sessionId, stepNumber);
      
      if (result.success) {
        // Reload the session to get fresh data
        await loadSession(sessionId);
        setMessages((prev) => [
          ...prev,
          createTimelineMessage('system', {
            content: `Session updated to step ${stepNumber}. You can continue from here.`,
          }),
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          createTimelineMessage('error', {
            content: result.user_message || 'Failed to fork session',
          }),
        ]);
      }
    } catch (e) {
      console.error('Error forking session:', e);
      setMessages((prev) => [
        ...prev,
        createTimelineMessage('error', {
          content: e instanceof Error ? e.message : 'Failed to fork session',
        }),
      ]);
    }
  }, [sessionId, currentSession, loadSession]);

  // Undo to a specific step
  const undoToStep = useCallback(async (stepNumber: number) => {
    if (!sessionId) return;

    setReplayFailure(null);
    setMessages((prev) => [
      ...prev,
      createTimelineMessage('system', {
        content: `Undoing to step ${stepNumber}...`,
      }),
    ]);

    try {
      const result = await analysisApi.undoToStep(sessionId, stepNumber);
      
      if (result.success) {
        // Reload the session to get fresh data
        await loadSession(sessionId);
        setMessages((prev) => [
          ...prev,
          createTimelineMessage('system', {
            content: result.user_message || `Successfully undid to step ${stepNumber}.`,
          }),
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          createTimelineMessage('error', {
            content: result.user_message || 'Failed to undo',
          }),
        ]);
      }
    } catch (e) {
      console.error('Error undoing to step:', e);
      setMessages((prev) => [
        ...prev,
        createTimelineMessage('error', {
          content: e instanceof Error ? e.message : 'Failed to undo',
        }),
      ]);
    }
  }, [sessionId, loadSession]);

  const clearReplayFailure = useCallback(() => {
    setReplayFailure(null);
  }, []);

  // Continue session with new message
  const sendMessage = useCallback(
    async (text: string, messageMode: ChatMode) => {
      if (!sessionId) return;

      setError(null);

      // Add user message to timeline
      const userMessage = createTimelineMessage('user', {
        content: text,
        mode: messageMode,
      });
      setMessages((prev) => [...prev, userMessage]);

      try {
        // Continue the existing session
        const session = await analysisApi.continueSession(sessionId, text, selectedLlm, messageMode);
        setCurrentSession(session);
        setSessionStatus(session.status);

        if (messageMode === 'plan' && session.status === 'plan_ready' && session.plan) {
          const planSteps: PlanStep[] = session.plan.steps_json?.steps || [];
          setMessages((prev) => [
            ...prev,
            createTimelineMessage('plan', {
              planId: session.id,
              planText: session.plan!.plan_text,
              planSteps,
              status: 'pending' as const,
            }),
          ]);
          setIsPlanPending(true);
        } else if (session.status === 'approved') {
          // Start execution
          await analysisApi.startExecution(sessionId);
          setIsExecuting(true);
          startPolling();
          if (!headless) {
            startBrowserPolling(sessionId);
          }
        }
      } catch (e) {
        console.error('Error sending message:', e);
        setMessages((prev) => [
          ...prev,
          createTimelineMessage('error', {
            content: e instanceof Error ? e.message : 'Failed to continue session',
          }),
        ]);
      }
    },
    [sessionId, selectedLlm, headless, startBrowserPolling]
  );

  // Poll for session updates during execution
  const pollSession = useCallback(async () => {
    if (!sessionId) return;

    try {
      const session = await analysisApi.getSession(sessionId);
      const steps = await analysisApi.getSteps(sessionId);

      setSessionStatus(session.status);
      setCurrentSession(session);

      // Add new steps as messages
      if (steps.length > lastStepCountRef.current) {
        const newSteps = steps.slice(lastStepCountRef.current);
        setMessages((prev) => [
          ...prev,
          ...newSteps.map((step) =>
            createTimelineMessage('step', { step })
          ),
        ]);
        lastStepCountRef.current = steps.length;

        // Auto-select latest step
        if (newSteps.length > 0) {
          setSelectedStepId(newSteps[newSteps.length - 1].id);
        }
      }

      // Handle completion states
      if (session.status === 'completed') {
        setIsExecuting(false);
        stopPolling();
        setMessages((prev) => [
          ...prev,
          createTimelineMessage('system', {
            content: `Test completed successfully with ${steps.length} steps`,
          }),
        ]);
      } else if (session.status === 'stopped') {
        setIsExecuting(false);
        stopPolling();
        setMessages((prev) => [
          ...prev,
          createTimelineMessage('system', {
            content: `Test stopped after ${steps.length} steps`,
          }),
        ]);
      } else if (session.status === 'failed') {
        setIsExecuting(false);
        stopPolling();
        setMessages((prev) => [
          ...prev,
          createTimelineMessage('error', {
            content: 'Test execution failed',
          }),
        ]);
      }
    } catch (e) {
      console.error('Error polling session:', e);
    }
  }, [sessionId, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollSession();
    pollIntervalRef.current = setInterval(pollSession, POLL_INTERVAL);
  }, [pollSession, stopPolling]);

  // Approve plan
  const approvePlan = useCallback(
    async (planId: string) => {
      if (!sessionId || sessionId !== planId) return;

      try {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.type === 'plan' && msg.planId === planId
              ? { ...msg, status: 'executing' as const }
              : msg
          )
        );

        setIsPlanPending(false);
        await analysisApi.approvePlan(sessionId);
        await analysisApi.startExecution(sessionId);

        setIsExecuting(true);
        startPolling();

        if (!headless) {
          startBrowserPolling(sessionId);
        }

        setMessages((prev) => [
          ...prev,
          createTimelineMessage('system', {
            content: 'Execution started',
          }),
        ]);
      } catch (e) {
        console.error('Error approving plan:', e);
        setMessages((prev) => [
          ...prev,
          createTimelineMessage('error', {
            content: e instanceof Error ? e.message : 'Failed to approve plan',
          }),
        ]);
      }
    },
    [sessionId, headless, startPolling, startBrowserPolling]
  );

  // Reject plan
  const rejectPlan = useCallback(async (planId: string, reason?: string) => {
    if (!sessionId) return;

    try {
      await analysisApi.rejectPlan(sessionId, reason);

      setMessages((prev) =>
        prev.map((msg) =>
          msg.type === 'plan' && msg.planId === planId
            ? { ...msg, status: 'rejected' as const }
            : msg
        )
      );
      setIsPlanPending(false);

      setMessages((prev) => [
        ...prev,
        createTimelineMessage('system', {
          content: 'Plan rejected. You can describe a new test case.',
        }),
      ]);
    } catch (e) {
      console.error('Error rejecting plan:', e);
    }
  }, [sessionId]);

  // Stop execution
  const stopExecution = useCallback(async () => {
    if (!sessionId) return;

    try {
      await analysisApi.stopExecution(sessionId);
      setIsExecuting(false);
      stopPolling();

      setMessages((prev) => [
        ...prev,
        createTimelineMessage('system', {
          content: 'Execution stopped',
        }),
      ]);
    } catch (e) {
      console.error('Error stopping execution:', e);
    }
  }, [sessionId, stopPolling]);

  // End browser session
  const endBrowserSession = useCallback(async () => {
    if (!sessionId) return;

    try {
      await fetch(`${config.API_URL}/api/analysis/sessions/${sessionId}/end-browser`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
        },
      });
      setBrowserSession(null);
      stopBrowserPolling();
    } catch (e) {
      console.error('Error ending browser session:', e);
    }
  }, [sessionId, stopBrowserPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
      stopBrowserPolling();
    };
  }, [stopPolling, stopBrowserPolling]);

  return {
    messages,
    sessionId,
    sessionStatus,
    currentSession,
    browserSession,
    mode,
    selectedLlm,
    headless,
    isLoading,
    isReplaying,
    isExecuting,
    isPlanPending,
    selectedStepId,
    error,
    totalSteps,
    replayFailure,

    loadSession,
    replaySession,
    sendMessage,
    approvePlan,
    rejectPlan,
    stopExecution,
    endBrowserSession,
    forkFromStep,
    undoToStep,
    clearReplayFailure,
    setMode,
    setSelectedLlm,
    setHeadless,
    setSelectedStepId,
  };
}
