import { useCallback, useEffect, useRef, useState } from 'react';
import { analysisApi, scriptsApi } from '../services/api';
import { getAuthToken } from '../contexts/AuthContext';
import { config } from '../config';
import type { TestSession, LlmModel } from '../types/analysis';
import type {
  TimelineMessage,
  ChatMode,
  PlanStep,
  QueuedMessage,
  QueueFailure,
  WaitingMessage,
} from '../types/chat';

// Generate UUID with fallback for non-secure contexts (HTTP)
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Helper to create messages with unique IDs
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

interface UseChatSessionReturn {
  // State
  messages: TimelineMessage[];
  sessionId: string | null;
  sessionStatus: string | null;
  currentSession: TestSession | null;
  browserSessionId: string | null;
  browserSession: BrowserSessionInfo | null;
  mode: ChatMode;
  selectedLlm: LlmModel;
  headless: boolean;
  isGeneratingPlan: boolean;
  isExecuting: boolean;
  isPlanPending: boolean;
  isBusy: boolean;
  messageQueue: QueuedMessage[];
  queueFailure: QueueFailure | null;
  selectedStepId: string | null;
  error: string | null;
  isUndoing: boolean;
  undoTargetStep: number | null;
  totalSteps: number;
  isRecording: boolean;

  // Actions
  sendMessage: (text: string, messageMode: ChatMode) => Promise<void>;
  approvePlan: (planId: string) => Promise<void>;
  rejectPlan: (planId: string, reason?: string) => Promise<void>;
  injectCommand: (text: string) => void;
  stopExecution: () => Promise<void>;
  resetSession: () => void;
  endBrowserSession: () => Promise<void>;
  clearQueueAndProceed: () => void;
  processRemainingQueue: () => void;
  generateScript: () => Promise<string | null>;
  undoToStep: (targetStepNumber: number) => void;
  confirmUndo: () => Promise<void>;
  cancelUndo: () => void;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
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

  // Queue state for message queuing
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const [queueFailure, setQueueFailure] = useState<QueueFailure | null>(null);

  // Undo state
  const [isUndoing, setIsUndoing] = useState(false);
  const [undoTargetStep, setUndoTargetStep] = useState<number | null>(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);

  // Keep recording ref in sync
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Computed busy state
  const isBusy = isGeneratingPlan || isExecuting || isPlanPending || isUndoing;

  // Computed total steps count
  const totalSteps = messages.filter(m => m.type === 'step').length;

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

  // Ref to track current session ID for polling (avoids stale closure issues)
  const sessionIdRef = useRef<string | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Poll for session updates
  const pollSession = useCallback(async (overrideSessionId?: string) => {
    const targetSessionId = overrideSessionId || sessionIdRef.current;
    if (!targetSessionId) return;

    try {
      const session = await analysisApi.getSession(targetSessionId);
      const steps = await analysisApi.getSteps(targetSessionId);

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
            const currentSessionId = sessionIdRef.current;
            if (currentSessionId) {
              try {
                await fetch(`${config.API_URL}/api/analysis/sessions/${currentSessionId}/end-browser`, {
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

      // Handle completion states - but skip if recording (we want to keep polling for new recorded steps)
      if (!isRecordingRef.current) {
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
      }
    } catch (e) {
      console.error('Error polling session:', e);
    }
  }, [stopPolling, browserSession, clearInactivityTimeout, stopBrowserPolling]);

  // Start polling - accepts optional session ID for new sessions where state hasn't updated yet
  const startPolling = useCallback((overrideSessionId?: string) => {
    stopPolling();
    // If override provided, update the ref immediately so interval callbacks use it
    if (overrideSessionId) {
      sessionIdRef.current = overrideSessionId;
    }
    pollSession(overrideSessionId);
    pollIntervalRef.current = setInterval(() => pollSession(), POLL_INTERVAL);
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

  // Queue a message when busy
  const queueMessage = useCallback((text: string, queueMode: ChatMode) => {
    const queuedMsg: QueuedMessage = {
      id: generateUUID(),
      text,
      mode: queueMode,
      timestamp: new Date().toISOString(),
    };

    setMessageQueue(prev => [...prev, queuedMsg]);

    // Show waiting message in timeline
    setMessages(prev => [
      ...prev,
      createTimelineMessage<WaitingMessage>('waiting', {
        content: `Waiting for current task to complete... (Position: ${messageQueue.length + 1})`,
        queuePosition: messageQueue.length + 1,
        queuedMessageId: queuedMsg.id,
      }),
    ]);
  }, [messageQueue.length]);

  // Clear queue and proceed (user chose to discard queued messages)
  const clearQueueAndProceed = useCallback(() => {
    setMessageQueue([]);
    setQueueFailure(null);
    // Remove waiting messages
    setMessages(prev => prev.filter(m => m.type !== 'waiting'));
  }, []);

  // Process remaining queue (user chose to continue after failure)
  const processRemainingQueue = useCallback(() => {
    setQueueFailure(null);
    // Queue will be processed by the effect below
  }, []);

  // Internal function to execute a message (used by both direct calls and queue processing)
  const executeMessage = useCallback(
    async (text: string, messageMode: ChatMode, addUserMessage = true) => {
      setError(null);

      // Add user message to timeline if requested
      if (addUserMessage) {
        const userMessage = createTimelineMessage('user', {
          content: text,
          mode: messageMode,
        });
        setMessages((prev) => [...prev, userMessage]);
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
            // Handle failure with queue
            if (messageQueue.length > 0) {
              setQueueFailure({
                error: 'Failed to generate plan',
                pendingMessages: [...messageQueue],
              });
            }
          }
        } catch (e) {
          console.error('Error creating/continuing session:', e);
          const errorMsg = e instanceof Error ? e.message : 'Failed to generate plan';
          setMessages((prev) => [
            ...prev,
            createTimelineMessage('error', {
              content: errorMsg,
            }),
          ]);
          // Handle failure with queue
          if (messageQueue.length > 0) {
            setQueueFailure({
              error: errorMsg,
              pendingMessages: [...messageQueue],
            });
          }
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
            startPolling(targetSessionId);

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
          const errorMsg = e instanceof Error ? e.message : 'Failed to start execution';
          setMessages((prev) => [
            ...prev,
            createTimelineMessage('error', {
              content: errorMsg,
            }),
          ]);
          // Handle failure with queue
          if (messageQueue.length > 0) {
            setQueueFailure({
              error: errorMsg,
              pendingMessages: [...messageQueue],
            });
          }
        }
      }
    },
    [sessionId, selectedLlm, headless, startPolling, startBrowserPolling, persistMessage, canContinueSession, messageQueue]
  );

  // Send a message (handles both plan and act modes)
  const sendMessage = useCallback(
    async (text: string, messageMode: ChatMode) => {
      // If busy (generating plan or plan pending), queue the message
      if (isBusy && !isExecuting) {
        // Add user message to timeline
        const userMessage = createTimelineMessage('user', {
          content: text,
          mode: messageMode,
        });
        setMessages((prev) => [...prev, userMessage]);

        // Queue the message
        queueMessage(text, messageMode);
        return;
      }

      if (isExecuting) {
        // Add user message to timeline
        const userMessage = createTimelineMessage('user', {
          content: text,
          mode: messageMode,
        });
        setMessages((prev) => [...prev, userMessage]);

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

      // Not busy, execute immediately
      await executeMessage(text, messageMode, true);
    },
    [isBusy, isExecuting, queueMessage, executeMessage]
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
        // DON'T reset lastStepCountRef - it should already have the correct count
        // from previous steps (for continuations) or be 0 (for new sessions).
        // Resetting to 0 would cause ALL steps to be re-fetched including old ones.
        startPolling(sessionId);

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
    setMessageQueue([]);
    setQueueFailure(null);
    lastStepCountRef.current = 0;
  }, [stopPolling, stopBrowserPolling, clearInactivityTimeout]);

  // Generate test script from session steps
  const generateScript = useCallback(async (): Promise<string | null> => {
    if (!sessionId || !currentSession) return null;

    try {
      // Auto-generate name from session title or prompt
      const scriptName = currentSession.title ||
        currentSession.prompt?.slice(0, 50) ||
        `Test Script ${new Date().toISOString()}`;

      const script = await scriptsApi.createScript({
        session_id: sessionId,
        name: scriptName,
        description: `Generated from test analysis session`,
      });

      return script.id;
    } catch (e) {
      console.error('Error generating script:', e);
      setError(e instanceof Error ? e.message : 'Failed to generate script');
      return null;
    }
  }, [sessionId, currentSession]);

  // Effect to process queue when not busy
  useEffect(() => {
    const processNextInQueue = async () => {
      if (messageQueue.length === 0 || isBusy || queueFailure) return;

      const [nextMessage, ...remaining] = messageQueue;
      setMessageQueue(remaining);

      // Remove waiting message for this queued message
      setMessages(prev => prev.filter(
        m => m.type !== 'waiting' ||
             (m as WaitingMessage).queuedMessageId !== nextMessage.id
      ));

      // Add user message for the queued message (was already shown when queued)
      // but we need to execute it now
      await executeMessage(nextMessage.text, nextMessage.mode, false);
    };

    if (!isBusy && messageQueue.length > 0 && !queueFailure) {
      processNextInQueue();
    }
  }, [isBusy, messageQueue, queueFailure, executeMessage]);

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

  // Undo to step - opens confirmation dialog
  const undoToStep = useCallback((targetStepNumber: number) => {
    setUndoTargetStep(targetStepNumber);
  }, []);

  // Cancel undo - closes confirmation dialog
  const cancelUndo = useCallback(() => {
    setUndoTargetStep(null);
  }, []);

  // Confirm undo - actually performs the undo operation
  const confirmUndo = useCallback(async () => {
    if (!sessionId || undoTargetStep === null) return;

    setIsUndoing(true);
    setError(null);

    try {
      const result = await analysisApi.undoToStep(sessionId, undoTargetStep);

      // Determine which step number we actually ended up at
      let finalStepNumber: number | null = null;
      let statusMessage: string;
      let messageType: 'system' | 'error' = 'system';

      if (result.success) {
        finalStepNumber = undoTargetStep;
        statusMessage = result.user_message || `Undo completed. Removed ${result.steps_removed} steps and replayed ${result.steps_replayed} steps.${
          result.replay_status === 'healed' ? ' (Some selectors were auto-healed)' : ''
        }`;
      } else if (result.replay_status === 'partial') {
        finalStepNumber = result.actual_step_number ?? 0;
        statusMessage = result.user_message || `Undo partially completed. Replay failed at step ${(result.failed_at_step ?? 0) + 1}. Session is now at step ${finalStepNumber}.`;
        messageType = 'error';
      } else {
        // Complete failure - just show error, don't modify steps
        setMessages(prev => [
          ...prev,
          createTimelineMessage('error', {
            content: result.user_message || `Undo failed: ${result.error_message || 'Unknown error'}${
              result.failed_at_step !== null ? ` (failed at step ${result.failed_at_step})` : ''
            }`,
          }),
        ]);
        return;
      }

      // Fetch fresh steps from backend to ensure UI matches database state
      const freshSteps = await analysisApi.getSteps(sessionId);

      // Rebuild messages: keep non-step messages, replace step messages with fresh data
      setMessages(prev => {
        const nonStepMessages = prev.filter(m => m.type !== 'step');
        const stepMessages = freshSteps.map(step => createTimelineMessage('step', { step }));
        return [
          ...nonStepMessages,
          ...stepMessages,
          createTimelineMessage(messageType, { content: statusMessage }),
        ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      });

      // Update step count ref to match fresh steps
      lastStepCountRef.current = freshSteps.length;

      // Select the last step
      if (freshSteps.length > 0) {
        setSelectedStepId(freshSteps[freshSteps.length - 1].id);
      }

    } catch (e) {
      console.error('Error during undo:', e);
      setMessages(prev => [
        ...prev,
        createTimelineMessage('error', {
          content: e instanceof Error ? e.message : 'Failed to undo steps',
        }),
      ]);
    } finally {
      setIsUndoing(false);
      setUndoTargetStep(null);
    }
  }, [sessionId, undoTargetStep]);

  // Start recording user interactions
  // Uses Playwright recording mode by default (blur-based input capture, better backspace handling)
  const startRecording = useCallback(async () => {
    if (!sessionId || !browserSession?.id) return;

    try {
      // Use 'playwright' mode (default) - captures final input values on blur, handles backspace correctly
      const result = await analysisApi.startRecording(sessionId, browserSession.id, 'playwright');
      setIsRecording(true);
      // Start polling for steps during recording
      startPolling();
      setMessages(prev => [
        ...prev,
        createTimelineMessage('system', {
          content: `Recording started (${result.recording_mode || 'playwright'} mode). Your interactions with the browser will be captured.`,
        }),
      ]);
    } catch (e) {
      console.error('Error starting recording:', e);
      setMessages(prev => [
        ...prev,
        createTimelineMessage('error', {
          content: e instanceof Error ? e.message : 'Failed to start recording',
        }),
      ]);
    }
  }, [sessionId, browserSession?.id, startPolling]);

  // Stop recording user interactions
  const stopRecording = useCallback(async () => {
    if (!sessionId) return;

    try {
      await analysisApi.stopRecording(sessionId);
      setIsRecording(false);
      // Stop polling when recording stops
      stopPolling();
      setMessages(prev => [
        ...prev,
        createTimelineMessage('system', {
          content: 'Recording stopped.',
        }),
      ]);
    } catch (e) {
      console.error('Error stopping recording:', e);
      setMessages(prev => [
        ...prev,
        createTimelineMessage('error', {
          content: e instanceof Error ? e.message : 'Failed to stop recording',
        }),
      ]);
    }
  }, [sessionId, stopPolling]);

  return {
    // State
    messages,
    sessionId,
    sessionStatus,
    currentSession,
    browserSessionId: browserSession?.id ?? null,
    browserSession,
    mode,
    selectedLlm,
    headless,
    isGeneratingPlan,
    isExecuting,
    isPlanPending,
    isBusy,
    messageQueue,
    queueFailure,
    selectedStepId,
    error,
    isUndoing,
    undoTargetStep,
    totalSteps,
    isRecording,

    // Actions
    sendMessage,
    approvePlan,
    rejectPlan,
    injectCommand,
    stopExecution,
    resetSession,
    endBrowserSession,
    clearQueueAndProceed,
    processRemainingQueue,
    generateScript,
    undoToStep,
    confirmUndo,
    cancelUndo,
    startRecording,
    stopRecording,
    setMode,
    setSelectedLlm,
    setHeadless,
    setSelectedStepId,
  };
}
