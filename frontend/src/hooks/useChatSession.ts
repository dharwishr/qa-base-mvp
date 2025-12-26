import { useCallback, useEffect, useRef, useState } from 'react';
import { analysisApi } from '../services/api';
import { getAuthToken } from '../contexts/AuthContext';
import { config } from '../config';
import type { TestSession, LlmModel } from '../types/analysis';
import type {
  TimelineMessage,
  ChatMode,
  PlanStep,
} from '../types/chat';

// Helper to create messages with unique IDs
function createTimelineMessage<T extends TimelineMessage>(
  type: T['type'],
  data: Omit<T, 'id' | 'timestamp' | 'type'>
): T {
  return {
    id: crypto.randomUUID(),
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

interface UseChatSessionReturn {
  // State
  messages: TimelineMessage[];
  sessionId: string | null;
  currentSession: TestSession | null;
  browserSessionId: string | null;
  browserSession: BrowserSessionInfo | null;
  mode: ChatMode;
  selectedLlm: LlmModel;
  headless: boolean;
  isGeneratingPlan: boolean;
  isExecuting: boolean;
  isPlanPending: boolean;
  selectedStepId: string | null;
  error: string | null;

  // Actions
  sendMessage: (text: string, messageMode: ChatMode) => Promise<void>;
  approvePlan: (planId: string) => Promise<void>;
  rejectPlan: (planId: string, reason?: string) => Promise<void>;
  injectCommand: (text: string) => void;
  stopExecution: () => Promise<void>;
  resetSession: () => void;
  endBrowserSession: () => Promise<void>;
  setMode: (mode: ChatMode) => void;
  setSelectedLlm: (llm: LlmModel) => void;
  setHeadless: (headless: boolean) => void;
  setSelectedStepId: (stepId: string | null) => void;
}

const POLL_INTERVAL = 2000;
const INACTIVITY_TIMEOUT = 3 * 60 * 1000; // 3 minutes

export function useChatSession(): UseChatSessionReturn {
  // Core state
  const [messages, setMessages] = useState<TimelineMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [browserSession, setBrowserSession] = useState<BrowserSessionInfo | null>(null);
  const [mode, setMode] = useState<ChatMode>('plan');
  const [selectedLlm, setSelectedLlm] = useState<LlmModel>('gemini-2.5-flash');
  const [headless, setHeadless] = useState(false); // Default to live browser view
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPlanPending, setIsPlanPending] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setPendingPlanId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<TestSession | null>(null);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStepCountRef = useRef(0);
  const browserPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inactivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Stop browser session polling
  const stopBrowserPolling = useCallback(() => {
    if (browserPollIntervalRef.current) {
      clearInterval(browserPollIntervalRef.current);
      browserPollIntervalRef.current = null;
    }
  }, []);

  // Clear inactivity timeout
  const clearInactivityTimeout = useCallback(() => {
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
      inactivityTimeoutRef.current = null;
    }
  }, []);

  // Poll for browser session
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

  // Poll for session updates
  const pollSession = useCallback(async () => {
    if (!sessionId) return;

    try {
      const session = await analysisApi.getSession(sessionId);
      const steps = await analysisApi.getSteps(sessionId);

      // Update session status
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

        // Reset inactivity timer on new activity
        clearInactivityTimeout();
        if (browserSession) {
          inactivityTimeoutRef.current = setTimeout(async () => {
            console.log('Browser session inactive for 3 minutes, stopping...');
            if (sessionId) {
              try {
                await fetch(`${config.API_URL}/api/analysis/sessions/${sessionId}/end-browser`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${getAuthToken()}` },
                });
                setBrowserSession(null);
                stopBrowserPolling();
                setMessages((prev) => [
                  ...prev,
                  createTimelineMessage('system', { content: 'Browser session stopped due to inactivity' }),
                ]);
              } catch (e) {
                console.error('Error ending browser session due to inactivity:', e);
              }
            }
          }, INACTIVITY_TIMEOUT);
        }
      }

      // Handle completion states
      if (session.status === 'completed') {
        setIsExecuting(false);
        stopPolling();
        // Don't stop browser polling - keep browser alive
        setMessages((prev) => [
          ...prev,
          createTimelineMessage('system', {
            content: `Test completed successfully with ${steps.length} steps`,
          }),
        ]);
        // Update plan status to 'executing' -> show as done
        setMessages((prev) =>
          prev.map((msg) =>
            msg.type === 'plan' && msg.status === 'executing'
              ? { ...msg, status: 'approved' as const }
              : msg
          )
        );
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
  }, [sessionId, stopPolling, browserSession, clearInactivityTimeout, stopBrowserPolling]);

  // Start polling
  const startPolling = useCallback(() => {
    stopPolling();
    pollSession();
    pollIntervalRef.current = setInterval(pollSession, POLL_INTERVAL);
  }, [pollSession, stopPolling]);

  // Persist message to backend
  const persistMessage = useCallback(async (
    targetSessionId: string,
    messageType: string,
    content?: string,
    msgMode?: ChatMode
  ) => {
    try {
      await analysisApi.createMessage(targetSessionId, {
        message_type: messageType as 'user' | 'assistant' | 'plan' | 'step' | 'error' | 'system',
        content,
        mode: msgMode,
      });
    } catch (e) {
      console.error('Error persisting message:', e);
    }
  }, []);

  // Check if session can be continued (completed, failed, or stopped)
  const canContinueSession = useCallback(() => {
    return sessionId && ['completed', 'failed', 'stopped'].includes(sessionStatus || '');
  }, [sessionId, sessionStatus]);

  // Send a message (handles both plan and act modes)
  const sendMessage = useCallback(
    async (text: string, messageMode: ChatMode) => {
      setError(null);

      // Add user message to timeline
      const userMessage = createTimelineMessage('user', {
        content: text,
        mode: messageMode,
      });
      setMessages((prev) => [...prev, userMessage]);

      if (isExecuting) {
        // If already executing, inject command via WebSocket
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({ command: 'inject_command', content: text })
          );
          setMessages((prev) => [
            ...prev,
            createTimelineMessage('assistant', {
              content: 'Command received. Processing...',
            }),
          ]);
        }
        return;
      }

      // Check if we should continue an existing session
      const shouldContinue = canContinueSession();

      if (messageMode === 'plan') {
        // Plan mode: Generate plan first
        setIsGeneratingPlan(true);
        setMessages((prev) => [
          ...prev,
          createTimelineMessage('assistant', {
            content: shouldContinue ? 'Generating continuation plan...' : 'Generating test plan...',
          }),
        ]);

        try {
          let session: TestSession;

          if (shouldContinue && sessionId) {
            // Continue existing session with a new plan
            session = await analysisApi.continueSession(sessionId, text, selectedLlm, 'plan');
            // DON'T clear step messages - keep existing steps
          } else {
            // Create new session
            session = await analysisApi.createSession(text, selectedLlm, headless);
            setSessionId(session.id);
            // Clear old step messages when creating a new session
            setMessages((prev) => prev.filter((msg) => msg.type !== 'step'));
            lastStepCountRef.current = 0;
          }

          setCurrentSession(session);
          setSessionStatus(session.status);

          // Persist user message to backend now that we have a session
          await persistMessage(session.id, 'user', text, messageMode);

          if (session.status === 'plan_ready' && session.plan) {
            // Extract plan steps
            const planSteps: PlanStep[] = session.plan.steps_json?.steps || [];

            // Create plan message
            const planMessage = createTimelineMessage('plan', {
              planId: session.id,
              planText: session.plan.plan_text,
              planSteps,
              status: 'pending' as const,
            });

            const loadingText = shouldContinue ? 'Generating continuation plan...' : 'Generating test plan...';
            setMessages((prev) => [
              ...prev.filter((m) => m.type !== 'assistant' || m.content !== loadingText),
              planMessage,
            ]);
            setIsPlanPending(true);
            setPendingPlanId(session.id);
          } else {
            setMessages((prev) => [
              ...prev,
              createTimelineMessage('error', {
                content: 'Failed to generate plan',
              }),
            ]);
          }
        } catch (e) {
          console.error('Error creating/continuing session:', e);
          setMessages((prev) => [
            ...prev,
            createTimelineMessage('error', {
              content: e instanceof Error ? e.message : 'Failed to generate plan',
            }),
          ]);
        } finally {
          setIsGeneratingPlan(false);
        }
      } else {
        // Act mode: Execute directly without planning
        setMessages((prev) => [
          ...prev,
          createTimelineMessage('assistant', {
            content: shouldContinue ? 'Continuing execution...' : 'Starting direct execution...',
          }),
        ]);

        try {
          let session: TestSession;
          let targetSessionId: string;

          if (shouldContinue && sessionId) {
            // Continue existing session in act mode
            session = await analysisApi.continueSession(sessionId, text, selectedLlm, 'act');
            targetSessionId = sessionId;
            // DON'T clear step messages - keep existing steps
          } else {
            // Create new session
            session = await analysisApi.createSession(text, selectedLlm, headless);
            setSessionId(session.id);
            targetSessionId = session.id;
            // Clear old step messages when creating a new session
            setMessages((prev) => prev.filter((msg) => msg.type !== 'step'));
            lastStepCountRef.current = 0;
          }

          setCurrentSession(session);
          setSessionStatus(session.status);

          // Persist user message to backend now that we have a session
          await persistMessage(targetSessionId, 'user', text, messageMode);

          // Execute immediately (session should be in approved state for act mode continuation)
          if (session.status === 'approved' || session.status === 'plan_ready') {
            if (session.status === 'plan_ready') {
              await analysisApi.approvePlan(targetSessionId);
            }
            await analysisApi.startExecution(targetSessionId);

            setIsExecuting(true);
            startPolling();

            // Start browser polling if not headless
            if (!headless) {
              startBrowserPolling(targetSessionId);
            }

            const loadingText = shouldContinue ? 'Continuing execution...' : 'Starting direct execution...';
            setMessages((prev) => [
              ...prev.filter((m) => m.type !== 'assistant' || m.content !== loadingText),
              createTimelineMessage('system', {
                content: shouldContinue ? 'Continuing execution...' : 'Execution started',
              }),
            ]);
          }
        } catch (e) {
          console.error('Error starting/continuing execution:', e);
          setMessages((prev) => [
            ...prev,
            createTimelineMessage('error', {
              content: e instanceof Error ? e.message : 'Failed to start execution',
            }),
          ]);
        }
      }
    },
    [isExecuting, selectedLlm, headless, startPolling, startBrowserPolling, persistMessage, canContinueSession, sessionId, sessionStatus]
  );

  // Approve a plan
  const approvePlan = useCallback(
    async (planId: string) => {
      if (!sessionId || sessionId !== planId) return;

      setError(null);

      try {
        // Update plan message status
        setMessages((prev) =>
          prev.map((msg) =>
            msg.type === 'plan' && msg.planId === planId
              ? { ...msg, status: 'executing' as const }
              : msg
          )
        );

        setIsPlanPending(false);
        setPendingPlanId(null);

        // Approve and start execution
        await analysisApi.approvePlan(sessionId);
        await analysisApi.startExecution(sessionId);

        setIsExecuting(true);
        lastStepCountRef.current = 0;
        startPolling();

        // Start browser polling if not headless
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

  // Reject a plan
  const rejectPlan = useCallback(async (planId: string, reason?: string) => {
    if (!sessionId) return;

    try {
      // Call backend API to persist rejection
      await analysisApi.rejectPlan(sessionId, reason);

      setMessages((prev) =>
        prev.map((msg) =>
          msg.type === 'plan' && msg.planId === planId
            ? { ...msg, status: 'rejected' as const }
            : msg
        )
      );
      setIsPlanPending(false);
      setPendingPlanId(null);

      setMessages((prev) => [
        ...prev,
        createTimelineMessage('system', {
          content: 'Plan rejected. You can describe a new test case.',
        }),
      ]);
    } catch (e) {
      console.error('Error rejecting plan:', e);
      setMessages((prev) => [
        ...prev,
        createTimelineMessage('error', {
          content: e instanceof Error ? e.message : 'Failed to reject plan',
        }),
      ]);
    }
  }, [sessionId]);

  // Inject command during execution (via WebSocket or polling)
  const injectCommand = useCallback((text: string) => {
    // For now, this is handled in sendMessage when isExecuting is true
    // Future: implement proper WebSocket command injection
    console.log('Inject command:', text);
  }, []);

  // Stop execution
  const stopExecution = useCallback(async () => {
    if (!sessionId) return;

    try {
      await analysisApi.stopExecution(sessionId);
      setIsExecuting(false);
      stopPolling();
      // Don't stop browser polling

      setMessages((prev) => [
        ...prev,
        createTimelineMessage('system', {
          content: 'Execution stopped',
        }),
      ]);
    } catch (e) {
      console.error('Error stopping execution:', e);
      setMessages((prev) => [
        ...prev,
        createTimelineMessage('error', {
          content: e instanceof Error ? e.message : 'Failed to stop execution',
        }),
      ]);
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
      clearInactivityTimeout();
    } catch (e) {
      console.error('Error ending browser session:', e);
    }
  }, [sessionId, stopBrowserPolling, clearInactivityTimeout]);

  // Reset inactivity timer - called on user activity
  const resetInactivityTimer = useCallback(() => {
    clearInactivityTimeout();

    // Only set timeout if we have an active browser session
    if (browserSession) {
      inactivityTimeoutRef.current = setTimeout(async () => {
        console.log('Browser session inactive for 3 minutes, stopping...');
        // End the browser session due to inactivity
        if (sessionId) {
          try {
            await fetch(`${config.API_URL}/api/analysis/sessions/${sessionId}/end-browser`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${getAuthToken()}`,
              },
            });
            setBrowserSession(null);
            stopBrowserPolling();
            setMessages((prev) => [
              ...prev,
              createTimelineMessage('system', {
                content: 'Browser session stopped due to inactivity',
              }),
            ]);
          } catch (e) {
            console.error('Error ending browser session due to inactivity:', e);
          }
        }
      }, INACTIVITY_TIMEOUT);
    }
  }, [browserSession, sessionId, clearInactivityTimeout, stopBrowserPolling]);

  // Reset session
  const resetSession = useCallback(() => {
    stopPolling();
    stopBrowserPolling();
    clearInactivityTimeout();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setMessages([]);
    setSessionId(null);
    setSessionStatus(null);
    setCurrentSession(null);
    setBrowserSession(null);
    setIsGeneratingPlan(false);
    setIsExecuting(false);
    setIsPlanPending(false);
    setPendingPlanId(null);
    setSelectedStepId(null);
    setError(null);
    lastStepCountRef.current = 0;
  }, [stopPolling, stopBrowserPolling, clearInactivityTimeout]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
      stopBrowserPolling();
      clearInactivityTimeout();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [stopPolling, stopBrowserPolling, clearInactivityTimeout]);

  // Start/reset inactivity timer when browser session becomes active
  useEffect(() => {
    if (browserSession) {
      resetInactivityTimer();
    }
    return () => {
      clearInactivityTimeout();
    };
  }, [browserSession, resetInactivityTimer, clearInactivityTimeout]);

  return {
    // State
    messages,
    sessionId,
    currentSession,
    browserSessionId: browserSession?.id ?? null,
    browserSession,
    mode,
    selectedLlm,
    headless,
    isGeneratingPlan,
    isExecuting,
    isPlanPending,
    selectedStepId,
    error,

    // Actions
    sendMessage,
    approvePlan,
    rejectPlan,
    injectCommand,
    stopExecution,
    resetSession,
    endBrowserSession,
    setMode,
    setSelectedLlm,
    setHeadless,
    setSelectedStepId,
  };
}
