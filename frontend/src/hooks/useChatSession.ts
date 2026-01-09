import { useCallback, useEffect, useRef, useState } from 'react';
import { analysisApi, scriptsApi, getWebSocketUrl } from '../services/api';
import { getAuthToken } from '../contexts/AuthContext';
import { config } from '../config';
import type {
  TestSession,
  LlmModel,
  WSMessage,
  WSInitialState,
  WSStepCompleted,
  WSCompleted,
  WSError,
  WSStatusChanged,
  WSRunTillEndStarted,
  WSRunTillEndProgress,
  WSRunTillEndPaused,
  WSRunTillEndCompleted,
  WSStepSkipped,
  WSExecutionPaused,
  WSAllStopped,
  ReplayResponse,
  RecordingMode,
} from '../types/analysis';
import type {
  TimelineMessage,
  ChatMode,
  PlanStep,
  QueuedMessage,
  QueueFailure,
  WaitingMessage,
  RunTillEndPausedState,
} from '../types/chat';
import type { TestRun, StartRunRequest } from '../types/scripts';

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
  data: Omit<T, 'id' | 'timestamp' | 'type'>,
  overrideTimestamp?: string
): T {
  return {
    id: generateUUID(),
    timestamp: overrideTimestamp || new Date().toISOString(),
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
  isStopping: boolean;
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
  currentRecordingMode: RecordingMode | null;
  wsConnectionMode: 'websocket' | 'polling' | 'disconnected';
  // Run Till End state
  isRunningTillEnd: boolean;
  runTillEndPaused: RunTillEndPausedState | null;
  skippedSteps: number[];
  currentExecutingStepNumber: number | null;
  // Existing session state
  isLoading: boolean;
  isReplaying: boolean;
  replayFailure: ReplayFailure | null;

  // Actions
  sendMessage: (text: string, messageMode: ChatMode) => Promise<void>;
  approvePlan: (planId: string) => Promise<void>;
  rejectPlan: (planId: string, reason?: string) => Promise<void>;
  injectCommand: (text: string) => void;
  stopExecution: () => Promise<void>;
  resetSession: () => Promise<string | null>;
  endBrowserSession: () => Promise<void>;
  clearQueueAndProceed: () => void;
  processRemainingQueue: () => void;
  generateScript: () => Promise<string | null>;
  undoToStep: (targetStepNumber: number) => void;
  confirmUndo: () => Promise<void>;
  cancelUndo: () => void;
  deleteStep: (stepId: string) => Promise<void>;
  startRecording: (mode?: RecordingMode) => Promise<void>;
  stopRecording: () => Promise<void>;
  setMode: (mode: ChatMode) => void;
  setSelectedLlm: (llm: LlmModel) => void;
  setHeadless: (headless: boolean) => void;
  setSelectedStepId: (stepId: string | null) => void;
  // Run Till End actions
  startRunTillEnd: () => void;
  skipFailedStep: (stepNumber: number) => void;
  continueRunTillEnd: () => void;
  cancelRunTillEnd: () => void;
  // Stop AI execution (keeps browser alive)
  stopAIExecution: () => void;
  // Existing session actions
  loadExistingSession: (id: string) => Promise<void>;
  replaySession: (startRecordingAfterReplay?: boolean, prepareOnly?: boolean) => Promise<void>;
  forkFromStep: (stepNumber: number) => Promise<void>;
  clearReplayFailure: () => void;
  // Plan editing state and actions
  isEditingPlan: boolean;
  editingPlanData: { planId: string; planText: string; planSteps: PlanStep[] } | null;
  openPlanEditor: (planId: string, planText: string, planSteps: PlanStep[]) => void;
  closePlanEditor: () => void;
  savePlanEdits: (steps: PlanStep[], userPrompt?: string) => Promise<void>;
  regeneratePlan: (steps: PlanStep[], userPrompt: string) => Promise<void>;
  // Session runs state and actions (Execute tab)
  sessionRuns: TestRun[];
  selectedRunId: string | null;
  isStartingRun: boolean;
  toggleActionEnabled: (actionId: string, enabled: boolean) => Promise<void>;
  startSessionRun: (config: StartRunRequest) => Promise<void>;
  refreshSessionRuns: () => Promise<void>;
  selectRun: (runId: string | null) => void;
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
  const [currentRecordingMode, setCurrentRecordingMode] = useState<RecordingMode | null>(null);
  const isRecordingRef = useRef(false);

  // Run Till End state
  const [isRunningTillEnd, setIsRunningTillEnd] = useState(false);
  const [runTillEndPaused, setRunTillEndPaused] = useState<RunTillEndPausedState | null>(null);
  const [skippedSteps, setSkippedSteps] = useState<number[]>([]);
  const [currentExecutingStepNumber, setCurrentExecutingStepNumber] = useState<number | null>(null);

  // Existing session state
  const [isLoading, setIsLoading] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayFailure, setReplayFailure] = useState<ReplayFailure | null>(null);
  const startRecordingAfterReplayRef = useRef(false);

  // Stop AI execution state
  const [isStopping, setIsStopping] = useState(false);

  // Plan editing state
  const [isEditingPlan, setIsEditingPlan] = useState(false);
  const [editingPlanData, setEditingPlanData] = useState<{
    planId: string;
    planText: string;
    planSteps: PlanStep[];
  } | null>(null);

  // Session runs state (Execute tab)
  const [sessionRuns, setSessionRuns] = useState<TestRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isStartingRun, setIsStartingRun] = useState(false);

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
  const wsReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsReconnectAttempts = useRef(0);
  const wsHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // WebSocket connection state
  const [wsConnectionMode, setWsConnectionMode] = useState<'websocket' | 'polling' | 'disconnected'>('disconnected');

  // WebSocket constants
  const WS_INITIAL_RECONNECT_DELAY = 1000;
  const WS_MAX_RECONNECT_DELAY = 16000;
  const WS_MAX_RECONNECT_ATTEMPTS = 5;
  const WS_HEARTBEAT_INTERVAL = 30000;

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Clear WebSocket timers
  const clearWsTimers = useCallback(() => {
    if (wsReconnectTimeoutRef.current) {
      clearTimeout(wsReconnectTimeoutRef.current);
      wsReconnectTimeoutRef.current = null;
    }
    if (wsHeartbeatRef.current) {
      clearInterval(wsHeartbeatRef.current);
      wsHeartbeatRef.current = null;
    }
  }, []);

  // Disconnect WebSocket
  const disconnectWebSocket = useCallback(() => {
    clearWsTimers();
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }
    setWsConnectionMode('disconnected');
  }, [clearWsTimers]);

  // Connect WebSocket for session
  const connectWebSocket = useCallback((targetSessionId: string) => {
    if (!targetSessionId || wsRef.current?.readyState === WebSocket.OPEN) return;

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(getWebSocketUrl(targetSessionId));
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('ChatSession WebSocket connected');
      setWsConnectionMode('websocket');
      wsReconnectAttempts.current = 0;

      // Stop polling fallback
      stopPolling();

      // Subscribe with initial state
      ws.send(JSON.stringify({ command: 'subscribe', include_initial_state: true }));

      // Start heartbeat
      wsHeartbeatRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ command: 'ping' }));
        }
      }, WS_HEARTBEAT_INTERVAL);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WSMessage;

        switch (message.type) {
          case 'initial_state': {
            const initMsg = message as WSInitialState;
            if (initMsg.session) {
              setCurrentSession(initMsg.session);
              setSessionStatus(initMsg.session.status);
            }
            if (initMsg.steps && initMsg.steps.length > lastStepCountRef.current) {
              const newSteps = initMsg.steps.slice(lastStepCountRef.current);
              setMessages((prev) => [
                ...prev,
                ...newSteps.map((step) => createTimelineMessage('step', { step })),
              ]);
              lastStepCountRef.current = initMsg.steps.length;
              if (newSteps.length > 0) {
                setSelectedStepId(newSteps[newSteps.length - 1].id);
              }
            }
            break;
          }

          case 'step_completed': {
            const stepMsg = message as WSStepCompleted;
            if (stepMsg.step) {
              setMessages((prev) => [...prev, createTimelineMessage('step', { step: stepMsg.step })]);
              lastStepCountRef.current++;
              setSelectedStepId(stepMsg.step.id);
            }
            break;
          }

          case 'status_changed': {
            const statusMsg = message as WSStatusChanged;
            setSessionStatus(statusMsg.status);
            break;
          }

          case 'completed': {
            const completeMsg = message as WSCompleted;
            setIsExecuting(false);
            // Update session status so canContinueSession() returns true
            setSessionStatus(completeMsg.success ? 'completed' : 'failed');
            setMessages((prev) => [
              ...prev,
              createTimelineMessage('system', {
                content: completeMsg.success
                  ? `Test completed successfully with ${completeMsg.total_steps} steps`
                  : 'Test execution failed',
              }),
            ]);
            // Update plan status
            setMessages((prev) =>
              prev.map((msg) =>
                msg.type === 'plan' && msg.status === 'executing'
                  ? { ...msg, status: 'approved' as const }
                  : msg
              )
            );
            break;
          }

          case 'error': {
            const errorMsg = message as WSError;
            setError(errorMsg.message);
            break;
          }

          case 'pong':
            // Heartbeat response
            break;

          // Run Till End message handlers
          case 'run_till_end_started': {
            const msg = message as WSRunTillEndStarted;
            setIsRunningTillEnd(true);
            setSkippedSteps([]);
            setCurrentExecutingStepNumber(null);
            setMessages(prev => [
              ...prev,
              createTimelineMessage('system', {
                content: `Run Till End started: executing ${msg.total_steps} steps...`,
              }),
            ]);
            break;
          }

          case 'run_till_end_progress': {
            const msg = message as WSRunTillEndProgress;
            // Set current executing step for highlighting
            setCurrentExecutingStepNumber(msg.current_step);
            break;
          }

          case 'run_till_end_paused': {
            const msg = message as WSRunTillEndPaused;
            setRunTillEndPaused({
              stepNumber: msg.failed_step,
              error: msg.error_message,
            });
            break;
          }

          case 'run_till_end_completed': {
            const msg = message as WSRunTillEndCompleted;
            setIsRunningTillEnd(false);
            setRunTillEndPaused(null);
            setCurrentExecutingStepNumber(null);
            // Update session status so canContinueSession() returns true
            setSessionStatus(msg.cancelled ? 'stopped' : msg.success ? 'completed' : 'failed');

            const statusText = msg.cancelled
              ? 'Run Till End cancelled'
              : msg.success
                ? `Run Till End completed: ${msg.completed_steps}/${msg.total_steps} steps successful`
                : `Run Till End stopped at step ${msg.completed_steps}`;

            const skippedText = msg.skipped_steps.length > 0
              ? ` (${msg.skipped_steps.length} skipped)`
              : '';

            setMessages(prev => [
              ...prev,
              createTimelineMessage(msg.success ? 'system' : 'error', {
                content: statusText + skippedText,
              }),
            ]);
            break;
          }

          case 'step_skipped': {
            const msg = message as WSStepSkipped;
            setSkippedSteps(prev => [...prev, msg.step_number]);
            break;
          }

          case 'execution_paused': {
            const msg = message as WSExecutionPaused;
            setIsStopping(false);  // Clear stopping state
            setIsExecuting(false);
            setIsRunningTillEnd(false);
            // Update session status so canContinueSession() returns true
            setSessionStatus('paused');
            // Add system message to timeline
            setMessages(prev => [
              ...prev,
              createTimelineMessage('system', {
                content: msg.message || 'Execution stopped. You can send new plan/act commands.',
              }),
            ]);
            break;
          }

          case 'all_stopped': {
            const msg = message as WSAllStopped;
            setIsStopping(false);  // Clear stopping state
            setIsExecuting(false);
            setIsRunningTillEnd(false);
            setBrowserSession(null);
            // Update session status so canContinueSession() returns true
            setSessionStatus('stopped');
            // Add system message
            setMessages(prev => [
              ...prev,
              createTimelineMessage('system', {
                content: msg.message || 'Execution and browser stopped. Re-initialize to continue.',
              }),
            ]);
            break;
          }
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    };

    ws.onclose = (event) => {
      console.log('ChatSession WebSocket closed:', event.code, event.reason);
      wsRef.current = null;
      clearWsTimers();

      // Attempt reconnection if not intentional close
      if (event.code !== 1000 && sessionIdRef.current) {
        if (wsReconnectAttempts.current >= WS_MAX_RECONNECT_ATTEMPTS) {
          console.log('Max WS reconnection attempts, falling back to polling');
          setWsConnectionMode('polling');
          // Start polling fallback
          pollSession();
          pollIntervalRef.current = setInterval(() => pollSession(), POLL_INTERVAL);
        } else {
          const delay = Math.min(
            WS_INITIAL_RECONNECT_DELAY * Math.pow(2, wsReconnectAttempts.current),
            WS_MAX_RECONNECT_DELAY
          );
          console.log(`WS reconnecting in ${delay}ms`);
          wsReconnectTimeoutRef.current = setTimeout(() => {
            wsReconnectAttempts.current++;
            const sid = sessionIdRef.current;
            if (sid) connectWebSocket(sid);
          }, delay);
        }
      }
    };

    ws.onerror = (event) => {
      console.error('ChatSession WebSocket error:', event);
    };
  }, [stopPolling, clearWsTimers]);

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
                // Persist message to backend so it shows when reopening session
                try {
                  await analysisApi.createMessage(currentSessionId, {
                    message_type: 'system',
                    content: 'Browser session stopped due to inactivity',
                  });
                } catch (persistError) {
                  console.error('Error persisting browser inactivity message:', persistError);
                }
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

  // Start real-time updates - tries WebSocket first, falls back to polling
  const startPolling = useCallback((overrideSessionId?: string) => {
    stopPolling();
    disconnectWebSocket();

    // If override provided, update the ref immediately
    if (overrideSessionId) {
      sessionIdRef.current = overrideSessionId;
    }

    const targetSessionId = overrideSessionId || sessionIdRef.current;
    if (!targetSessionId) return;

    // Try WebSocket first
    connectWebSocket(targetSessionId);

    // If WebSocket doesn't connect within 2 seconds, start polling as fallback
    setTimeout(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.log('WebSocket not connected, starting polling fallback');
        setWsConnectionMode('polling');
        pollSession(overrideSessionId);
        pollIntervalRef.current = setInterval(() => pollSession(), POLL_INTERVAL);
      }
    }, 2000);
  }, [pollSession, stopPolling, connectWebSocket, disconnectWebSocket]);

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

  // Check if session can be continued (completed, failed, stopped, or paused)
  const canContinueSession = useCallback(() => {
    return sessionId && ['completed', 'failed', 'stopped', 'paused'].includes(sessionStatus || '');
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
      console.log(`[CHAT] executeMessage: mode=${messageMode}, shouldContinue=${shouldContinue}, sessionId=${sessionId}, sessionStatus=${sessionStatus}`);

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
            console.log(`[CHAT] PLAN MODE: Continuing session ${sessionId} (keeping ${lastStepCountRef.current} existing steps)`);
            session = await analysisApi.continueSession(sessionId, text, selectedLlm, 'plan');
            // DON'T clear step messages - keep existing steps
          } else {
            // Create new session
            console.log(`[CHAT] PLAN MODE: Creating new session (shouldContinue=${shouldContinue}, sessionId=${sessionId})`);
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

            // Pre-connect WebSocket so it's ready when user approves (saves 100-300ms)
            if (!headless) {
              console.log('[WS] Pre-connecting WebSocket during plan review');
              connectWebSocket(session.id);
            }
          } else if (session.status === 'generating_plan') {
            // Plan is being generated asynchronously by Celery - poll for completion
            console.log('[CHAT] Plan generating asynchronously, polling for completion...');
            const pollForPlan = async () => {
              const maxAttempts = 60; // 2 minutes max
              for (let attempt = 0; attempt < maxAttempts; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // Poll every 2 seconds
                try {
                  const updatedSession = await analysisApi.getSession(session.id);
                  console.log(`[CHAT] Poll attempt ${attempt + 1}: status=${updatedSession.status}`);

                  if (updatedSession.status === 'plan_ready' && updatedSession.plan) {
                    // Plan is ready!
                    const planSteps: PlanStep[] = updatedSession.plan.steps_json?.steps || [];
                    const planMessage = createTimelineMessage('plan', {
                      planId: updatedSession.id,
                      planText: updatedSession.plan.plan_text,
                      planSteps,
                      status: 'pending' as const,
                    });

                    const loadingText = shouldContinue ? 'Generating continuation plan...' : 'Generating test plan...';
                    setMessages((prev) => [
                      ...prev.filter((m) => m.type !== 'assistant' || m.content !== loadingText),
                      planMessage,
                    ]);
                    setCurrentSession(updatedSession);
                    setSessionStatus(updatedSession.status);
                    setIsPlanPending(true);
                    setPendingPlanId(updatedSession.id);
                    setIsGeneratingPlan(false);

                    // Pre-connect WebSocket
                    if (!headless) {
                      console.log('[WS] Pre-connecting WebSocket during plan review');
                      connectWebSocket(updatedSession.id);
                    }
                    return;
                  } else if (updatedSession.status === 'failed' || updatedSession.status === 'cancelled') {
                    // Plan generation failed
                    throw new Error(`Plan generation ${updatedSession.status}`);
                  }
                } catch (pollError) {
                  console.error('Error polling for plan:', pollError);
                  throw pollError;
                }
              }
              // Timeout
              throw new Error('Plan generation timed out');
            };

            // Start polling in background
            pollForPlan().catch((pollError) => {
              console.error('Plan polling failed:', pollError);
              const loadingText = shouldContinue ? 'Generating continuation plan...' : 'Generating test plan...';
              setMessages((prev) => [
                ...prev.filter((m) => m.type !== 'assistant' || m.content !== loadingText),
                createTimelineMessage('error', {
                  content: pollError instanceof Error ? pollError.message : 'Failed to generate plan',
                }),
              ]);
              setIsGeneratingPlan(false);
              if (messageQueue.length > 0) {
                setQueueFailure({
                  error: pollError instanceof Error ? pollError.message : 'Failed to generate plan',
                  pendingMessages: [...messageQueue],
                });
              }
            });
            // Keep isGeneratingPlan true while polling
            return;
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
            // FIRST: Persist user message BEFORE making API call (for correct sequence_number)
            console.log(`[CHAT] ACT MODE: Continuing session ${sessionId} (keeping ${lastStepCountRef.current} existing steps)`);
            await persistMessage(sessionId, 'user', text, messageMode);

            // THEN: Continue existing session in act mode
            session = await analysisApi.continueSession(sessionId, text, selectedLlm, 'act');
            targetSessionId = sessionId;
            // DON'T clear step messages - keep existing steps
          } else {
            // Create new session - persist after we have session ID
            console.log(`[CHAT] ACT MODE: Creating new session (shouldContinue=${shouldContinue}, sessionId=${sessionId})`);
            session = await analysisApi.createSession(text, selectedLlm, headless);
            setSessionId(session.id);
            targetSessionId = session.id;
            // Persist user message now that we have a session
            await persistMessage(targetSessionId, 'user', text, messageMode);
            // Clear old step messages when creating a new session
            setMessages((prev) => prev.filter((msg) => msg.type !== 'step'));
            lastStepCountRef.current = 0;
          }

          setCurrentSession(session);
          setSessionStatus(session.status);

          // Execute immediately (session should be in approved state for act mode continuation)
          if (session.status === 'approved' || session.status === 'plan_ready') {
            if (session.status === 'plan_ready') {
              await analysisApi.approvePlan(targetSessionId);
            }

            setIsExecuting(true);

            // Connect WebSocket first, then send start command through it
            // This ensures we receive real-time step updates
            connectWebSocket(targetSessionId);

            // Wait a bit for WebSocket to connect, then send start or fall back to REST
            setTimeout(() => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ command: 'start' }));
              } else {
                // Fallback to REST API + polling
                analysisApi.startExecution(targetSessionId).then(() => {
                  startPolling(targetSessionId);
                });
              }
            }, 500);

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

      if (isExecuting && sessionId) {
        // During execution, treat all messages as hints
        const hintMode = 'hint';

        // Add user hint message to timeline
        const userMessage = createTimelineMessage('user', {
          content: text,
          mode: hintMode,
        });
        setMessages((prev) => [...prev, userMessage]);

        // Persist user hint to database
        try {
          await analysisApi.createMessage(sessionId, {
            message_type: 'user',
            content: text,
            mode: hintMode,
          });
        } catch (e) {
          console.error('Failed to persist hint message:', e);
        }

        // Send hint via WebSocket to inject into agent
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({ command: 'inject_command', content: text })
          );

          // Add system response to timeline
          const systemContent = 'Hint queued - will be applied at next step';
          setMessages((prev) => [
            ...prev,
            createTimelineMessage('system', {
              content: systemContent,
            }),
          ]);

          // Persist system response to database
          try {
            await analysisApi.createMessage(sessionId, {
              message_type: 'system',
              content: systemContent,
            });
          } catch (e) {
            console.error('Failed to persist system message:', e);
          }
        }
        return;
      }

      // Not busy, execute immediately
      await executeMessage(text, messageMode, true);
    },
    [isBusy, isExecuting, queueMessage, executeMessage, sessionId]
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

        // Approve the plan
        await analysisApi.approvePlan(sessionId);

        setIsExecuting(true);

        // Check if WebSocket is already connected (from early connection during plan review)
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          // Already connected - send start immediately (no delay needed)
          console.log('[WS] WebSocket already connected, sending start immediately');
          wsRef.current.send(JSON.stringify({ command: 'start' }));
        } else {
          // Not connected - connect and wait (with reduced delay)
          console.log('[WS] Connecting WebSocket for execution');
          connectWebSocket(sessionId);

          // Wait for WebSocket to connect, then send start or fall back to REST
          setTimeout(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ command: 'start' }));
            } else {
              // Fallback to REST API + polling
              analysisApi.startExecution(sessionId).then(() => {
                startPolling(sessionId);
              });
            }
          }, 200); // Reduced from 500ms since we only need connection time
        }

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

  // Plan editing functions
  const openPlanEditor = useCallback(
    (planId: string, planText: string, planSteps: PlanStep[]) => {
      setEditingPlanData({ planId, planText, planSteps });
      setIsEditingPlan(true);
    },
    []
  );

  const closePlanEditor = useCallback(() => {
    setIsEditingPlan(false);
    setEditingPlanData(null);
  }, []);

  const savePlanEdits = useCallback(
    async (steps: PlanStep[], userPrompt?: string) => {
      if (!sessionId || !editingPlanData) return;

      try {
        const updatedPlan = await analysisApi.updatePlan(sessionId, steps, userPrompt);

        // Update the plan message with new steps
        setMessages((prev) =>
          prev.map((msg) =>
            msg.type === 'plan' && msg.planId === editingPlanData.planId
              ? {
                  ...msg,
                  planText: updatedPlan.plan_text,
                  planSteps: updatedPlan.steps_json?.steps || [],
                }
              : msg
          )
        );

        closePlanEditor();

        setMessages((prev) => [
          ...prev,
          createTimelineMessage('system', {
            content: 'Plan updated successfully.',
          }),
        ]);
      } catch (e) {
        console.error('Error saving plan edits:', e);
        throw e;
      }
    },
    [sessionId, editingPlanData, closePlanEditor]
  );

  const regeneratePlan = useCallback(
    async (steps: PlanStep[], userPrompt: string) => {
      if (!sessionId || !editingPlanData) return;

      try {
        setIsGeneratingPlan(true);
        const regeneratedPlan = await analysisApi.regeneratePlan(sessionId, steps, userPrompt);

        // Update the plan message with regenerated content
        setMessages((prev) =>
          prev.map((msg) =>
            msg.type === 'plan' && msg.planId === editingPlanData.planId
              ? {
                  ...msg,
                  planText: regeneratedPlan.plan_text,
                  planSteps: regeneratedPlan.steps_json?.steps || [],
                }
              : msg
          )
        );

        closePlanEditor();

        setMessages((prev) => [
          ...prev,
          createTimelineMessage('system', {
            content: 'Plan regenerated with AI successfully.',
          }),
        ]);
      } catch (e) {
        console.error('Error regenerating plan:', e);
        throw e;
      } finally {
        setIsGeneratingPlan(false);
      }
    },
    [sessionId, editingPlanData, closePlanEditor]
  );

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
            // Persist message to backend so it shows when reopening session
            try {
              await analysisApi.createMessage(sessionId, {
                message_type: 'system',
                content: 'Browser session stopped due to inactivity',
              });
            } catch (persistError) {
              console.error('Error persisting browser inactivity message:', persistError);
            }
          } catch (e) {
            console.error('Error ending browser session due to inactivity:', e);
          }
        }
      }, INACTIVITY_TIMEOUT);
    }
  }, [browserSession, sessionId, clearInactivityTimeout, stopBrowserPolling]);

  // Reset session - clears steps/messages from backend, returns original prompt for editing
  const resetSession = useCallback(async (): Promise<string | null> => {
    let originalPrompt: string | null = null;

    // If there's a session, reset it in the backend first
    if (sessionId) {
      try {
        const resetResult = await analysisApi.resetSession(sessionId);
        originalPrompt = resetResult.prompt || null;
      } catch (e) {
        console.error('Error resetting session:', e);
        // Continue with frontend reset even if backend fails
      }
    }

    stopPolling();
    stopBrowserPolling();
    clearInactivityTimeout();
    disconnectWebSocket();

    setMessages([]);
    setSessionId(null);
    setSessionStatus(null);
    setCurrentSession(null);
    setBrowserSession(null);
    setIsGeneratingPlan(false);
    setIsExecuting(false);
    setIsStopping(false);
    setIsPlanPending(false);
    setPendingPlanId(null);
    setSelectedStepId(null);
    setError(null);
    setMessageQueue([]);
    setQueueFailure(null);
    setWsConnectionMode('disconnected');
    setIsRecording(false);
    setCurrentRecordingMode(null);
    setIsRunningTillEnd(false);
    setRunTillEndPaused(null);
    setSkippedSteps([]);
    setCurrentExecutingStepNumber(null);
    lastStepCountRef.current = 0;
    // Reset session runs state
    setSessionRuns([]);
    setSelectedRunId(null);
    setIsStartingRun(false);

    return originalPrompt;
  }, [sessionId, stopPolling, stopBrowserPolling, clearInactivityTimeout, disconnectWebSocket]);

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
      disconnectWebSocket();
    };
  }, [stopPolling, stopBrowserPolling, clearInactivityTimeout, disconnectWebSocket]);

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

  // Delete a single step
  const deleteStep = useCallback(async (stepId: string) => {
    if (!sessionId) return;

    try {
      const response = await fetch(`${config.API_URL}/api/analysis/steps/${stepId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete step');
      }

      // Update local state: remove step and renumber remaining
      setMessages((prev) => {
        const stepMessages = prev.filter((m) => m.type === 'step');
        const deletedIndex = stepMessages.findIndex((m) => m.type === 'step' && m.step.id === stepId);

        if (deletedIndex === -1) return prev;

        // Filter out the deleted step and renumber remaining steps
        return prev.map((msg) => {
          if (msg.type !== 'step') return msg;
          if (msg.step.id === stepId) return null;
          // Renumber: steps after deleted one get decremented
          const currentIndex = stepMessages.findIndex((m) => m.type === 'step' && m.step.id === msg.step.id);
          if (currentIndex > deletedIndex) {
            return {
              ...msg,
              step: {
                ...msg.step,
                step_number: msg.step.step_number - 1,
              },
            };
          }
          return msg;
        }).filter(Boolean) as TimelineMessage[];
      });

      // Update step count ref
      lastStepCountRef.current = Math.max(0, lastStepCountRef.current - 1);
    } catch (e) {
      console.error('Error deleting step:', e);
      setError(e instanceof Error ? e.message : 'Failed to delete step');
    }
  }, [sessionId]);

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
  // Supports multiple recording modes: 'playwright', 'browser_use', or 'cdp'
  const startRecording = useCallback(async (mode: RecordingMode = 'playwright') => {
    if (!sessionId || !browserSession?.id) return;

    try {
      const result = await analysisApi.startRecording(sessionId, browserSession.id, mode);
      setIsRecording(true);
      setCurrentRecordingMode(result.recording_mode || mode);
      // Start polling for steps during recording
      startPolling();
      const modeLabels: Record<RecordingMode, string> = {
        'playwright': 'Playwright',
        'browser_use': 'Browser-Use (semantic selectors)',
        'cdp': 'CDP (legacy)',
      };
      setMessages(prev => [
        ...prev,
        createTimelineMessage('system', {
          content: `Recording started (${modeLabels[result.recording_mode || mode]} mode). Your interactions with the browser will be captured.`,
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
      setCurrentRecordingMode(null);
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

  // Run Till End - start execution of all steps
  const startRunTillEnd = useCallback(() => {
    if (!sessionId || isRunningTillEnd) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'run_till_end' }));
    } else {
      setMessages(prev => [
        ...prev,
        createTimelineMessage('error', {
          content: 'WebSocket not connected. Please refresh the page.',
        }),
      ]);
    }
  }, [sessionId, isRunningTillEnd]);

  // Skip a failed step during Run Till End
  const skipFailedStep = useCallback((stepNumber: number) => {
    if (!sessionId || !runTillEndPaused) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'skip_step', step_number: stepNumber }));
      setSkippedSteps(prev => [...prev, stepNumber]);
      setRunTillEndPaused(prev => prev ? { ...prev, isSkipped: true } : null);
    }
  }, [sessionId, runTillEndPaused]);

  // Continue execution after skip
  const continueRunTillEnd = useCallback(() => {
    if (!sessionId) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'continue_run_till_end' }));
      setRunTillEndPaused(null);
    }
  }, [sessionId]);

  // Cancel Run Till End execution
  const cancelRunTillEnd = useCallback(() => {
    if (!sessionId) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'cancel_run_till_end' }));
    }
    setIsRunningTillEnd(false);
    setRunTillEndPaused(null);
  }, [sessionId]);

  // Stop AI execution (keeps browser alive)
  const stopAIExecution = useCallback(() => {
    if (!sessionId) return;

    setIsStopping(true);  // Show spinner immediately

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'pause_execution' }));
    }
  }, [sessionId]);

  // Load an existing session
  const loadExistingSession = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    setMessages([]);
    setReplayFailure(null);
    lastStepCountRef.current = 0;

    try {
      // Fetch session AND chat messages in parallel
      const [session, chatMessages] = await Promise.all([
        analysisApi.getSession(id),
        analysisApi.getMessages(id),
      ]);

      setSessionId(session.id);
      setSessionStatus(session.status);
      setCurrentSession(session);
      setSelectedLlm(session.llm_model);
      setHeadless(session.headless);

      // Build timeline messages from session data
      const timelineMessages: TimelineMessage[] = [];

      // If no stored chat messages, reconstruct from session data (backward compatibility)
      if (chatMessages.length === 0) {
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
      } else {
        // Use stored chat messages for timeline reconstruction
        // Sort by sequence_number first to ensure correct order
        const sortedMessages = [...chatMessages].sort((a, b) => a.sequence_number - b.sequence_number);

        for (const msg of sortedMessages) {
          // Use the original created_at timestamp from the database
          const originalTimestamp = msg.created_at;

          if (msg.message_type === 'user') {
            timelineMessages.push(
              createTimelineMessage('user', {
                content: msg.content || '',
                mode: (msg.mode || 'plan') as ChatMode,
              }, originalTimestamp)
            );
          } else if (msg.message_type === 'plan') {
            // Reconstruct plan message with current plan data for approval status
            const planSteps: PlanStep[] = session.plan?.steps_json?.steps || [];
            timelineMessages.push(
              createTimelineMessage('plan', {
                planId: session.id,
                planText: msg.content || session.plan?.plan_text || '',
                planSteps,
                status: session.plan?.approval_status === 'approved' ? 'approved' as const : 'pending' as const,
              }, originalTimestamp)
            );
          } else if (msg.message_type === 'system') {
            timelineMessages.push(
              createTimelineMessage('system', {
                content: msg.content || '',
              }, originalTimestamp)
            );
          } else if (msg.message_type === 'error') {
            timelineMessages.push(
              createTimelineMessage('error', {
                content: msg.content || '',
              }, originalTimestamp)
            );
          }
          // Note: 'step' messages are handled separately from session.steps
        }
      }

      // Add steps (always from session.steps for accurate step data)
      // Use the step's created_at timestamp to preserve order
      if (session.steps && session.steps.length > 0) {
        for (const step of session.steps) {
          timelineMessages.push(
            createTimelineMessage('step', { step }, step.created_at)
          );
        }
        lastStepCountRef.current = session.steps.length;

        // Select the last step
        setSelectedStepId(session.steps[session.steps.length - 1].id);
      }

      // Add completion message based on status (only if not already in chat messages)
      const hasCompletionMessage = chatMessages.some(
        (msg) => msg.message_type === 'system' &&
        (msg.content?.includes('completed') || msg.content?.includes('failed') || msg.content?.includes('stopped'))
      );

      if (!hasCompletionMessage) {
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
      }

      // Sort all timeline messages by timestamp to ensure correct order
      // For messages with equal timestamps, maintain a logical ordering:
      // user -> plan -> system -> step -> error
      const typeOrder: Record<string, number> = {
        'user': 0,
        'plan': 1,
        'system': 2,
        'step': 3,
        'error': 4,
      };
      timelineMessages.sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        const timeDiff = timeA - timeB;

        // Special case: if a user message (mode='plan') and plan message are within 60 seconds,
        // the user message should always come first (user prompt triggers plan generation).
        // This handles the case where the user message was persisted AFTER the plan was generated.
        const TIME_WINDOW_MS = 60000; // 60 seconds
        if (Math.abs(timeDiff) < TIME_WINDOW_MS) {
          const aIsUserPlan = a.type === 'user' && 'mode' in a && a.mode === 'plan';
          const bIsPlan = b.type === 'plan';
          const bIsUserPlan = b.type === 'user' && 'mode' in b && b.mode === 'plan';
          const aIsPlan = a.type === 'plan';

          // User message (plan mode) should come before plan message
          if (aIsUserPlan && bIsPlan) return -1;
          if (aIsPlan && bIsUserPlan) return 1;
        }

        if (timeDiff !== 0) return timeDiff;
        // If timestamps are equal, sort by type priority
        return (typeOrder[a.type] ?? 5) - (typeOrder[b.type] ?? 5);
      });

      setMessages(timelineMessages);

      // For running sessions, connect WebSocket for real-time updates
      if (['running', 'approved', 'executing'].includes(session.status)) {
        setIsExecuting(true);
        connectWebSocket(id);
      }

      // Start browser polling to detect active browser session (for returning to running sessions)
      if (!session.headless) {
        startBrowserPolling(id);
      }
    } catch (e) {
      console.error('Error loading session:', e);
      setError(e instanceof Error ? e.message : 'Failed to load session');
    } finally {
      setIsLoading(false);
    }
  }, [connectWebSocket, startBrowserPolling]);

  // Replay all steps in the session
  // If prepareOnly=true, only start the browser without replaying steps (useful for Run Till End with skip support)
  const replaySession = useCallback(async (startRecordingAfterReplay = false, prepareOnly = false) => {
    if (!sessionId) return;

    setIsReplaying(true);
    setError(null);
    setReplayFailure(null);
    startRecordingAfterReplayRef.current = startRecordingAfterReplay;

    setMessages((prev) => [
      ...prev,
      createTimelineMessage('system', {
        content: prepareOnly
          ? 'Starting browser for Run Till End...'
          : startRecordingAfterReplay
            ? 'Re-initiating session with recording... Starting browser and replaying steps.'
            : 'Re-initiating session... Starting browser and replaying steps.',
      }),
    ]);

    try {
      const result: ReplayResponse = await analysisApi.replaySession(sessionId, headless, prepareOnly);

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

          // Connect WebSocket for real-time updates
          connectWebSocket(sessionId);

          // Start recording if requested after successful replay
          if (startRecordingAfterReplay) {
            try {
              await analysisApi.startRecording(sessionId, result.browser_session_id, 'playwright');
              setIsRecording(true);
              startPolling(sessionId); // Start polling to capture recorded steps
              setMessages((prev) => [
                ...prev,
                createTimelineMessage('system', {
                  content: 'Recording started. Your interactions will be captured as new test steps.',
                }),
              ]);
            } catch (recordError) {
              console.error('Error starting recording:', recordError);
              setMessages((prev) => [
                ...prev,
                createTimelineMessage('error', {
                  content: 'Failed to start recording, but browser is ready for interaction.',
                }),
              ]);
            }
          }
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
            connectWebSocket(sessionId);
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
  }, [sessionId, headless, startBrowserPolling, connectWebSocket, startPolling]);

  // Fork from a specific step (keep steps up to that point)
  const forkFromStep = useCallback(async (stepNumber: number) => {
    if (!sessionId || !currentSession) return;

    setReplayFailure(null);
    setMessages((prev) => [
      ...prev,
      createTimelineMessage('system', {
        content: `Creating new test case from steps 1-${stepNumber}...`,
      }),
    ]);

    try {
      const result = await analysisApi.undoToStep(sessionId, stepNumber);

      if (result.success) {
        // Reload the session to get fresh data
        await loadExistingSession(sessionId);
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
  }, [sessionId, currentSession, loadExistingSession]);

  // Clear replay failure dialog
  const clearReplayFailure = useCallback(() => {
    setReplayFailure(null);
  }, []);

  // Toggle action enabled state
  const toggleActionEnabled = useCallback(async (actionId: string, enabled: boolean) => {
    try {
      const updatedAction = await analysisApi.toggleActionEnabled(actionId, enabled);
      // Update the action in local state (messages)
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.type !== 'step') return msg;
          const updatedActions = msg.step.actions?.map((action) =>
            action.id === actionId ? { ...action, is_enabled: updatedAction.is_enabled } : action
          );
          return {
            ...msg,
            step: {
              ...msg.step,
              actions: updatedActions,
            },
          };
        })
      );
    } catch (e) {
      console.error('Error toggling action enabled:', e);
      throw e;
    }
  }, []);

  // Refresh session runs list
  const refreshSessionRuns = useCallback(async () => {
    if (!sessionId) return;
    try {
      const runs = await analysisApi.listSessionRuns(sessionId);
      setSessionRuns(runs);
    } catch (e) {
      console.error('Error fetching session runs:', e);
    }
  }, [sessionId]);

  // Start a new session run
  const startSessionRun = useCallback(async (runConfig: StartRunRequest) => {
    if (!sessionId) return;
    setIsStartingRun(true);
    try {
      const response = await analysisApi.startSessionRun(sessionId, runConfig);
      // Refresh the runs list to include the new run
      await refreshSessionRuns();
      // Select the new run
      setSelectedRunId(response.run_id);
    } catch (e) {
      console.error('Error starting session run:', e);
      throw e;
    } finally {
      setIsStartingRun(false);
    }
  }, [sessionId, refreshSessionRuns]);

  // Select a run
  const selectRun = useCallback((runId: string | null) => {
    setSelectedRunId(runId);
  }, []);

  // Fetch session runs when session changes
  useEffect(() => {
    if (sessionId) {
      refreshSessionRuns();
    } else {
      setSessionRuns([]);
      setSelectedRunId(null);
    }
  }, [sessionId, refreshSessionRuns]);

  // Poll session runs when there's an active run (pending or running)
  useEffect(() => {
    const hasActiveRun = sessionRuns.some(
      run => run.status === 'pending' || run.status === 'running'
    );

    if (hasActiveRun && sessionId) {
      const interval = setInterval(async () => {
        await refreshSessionRuns();
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [sessionId, sessionRuns, refreshSessionRuns]);

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
    isStopping,
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
    currentRecordingMode,
    wsConnectionMode,
    // Run Till End state
    isRunningTillEnd,
    runTillEndPaused,
    skippedSteps,
    currentExecutingStepNumber,
    // Existing session state
    isLoading,
    isReplaying,
    replayFailure,

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
    deleteStep,
    startRecording,
    stopRecording,
    setMode,
    setSelectedLlm,
    setHeadless,
    setSelectedStepId,
    // Run Till End actions
    startRunTillEnd,
    skipFailedStep,
    continueRunTillEnd,
    cancelRunTillEnd,
    // Stop AI execution action
    stopAIExecution,
    // Existing session actions
    loadExistingSession,
    replaySession,
    forkFromStep,
    clearReplayFailure,
    // Plan editing state and actions
    isEditingPlan,
    editingPlanData,
    openPlanEditor,
    closePlanEditor,
    savePlanEdits,
    regeneratePlan,
    // Session runs state and actions (Execute tab)
    sessionRuns,
    selectedRunId,
    isStartingRun,
    toggleActionEnabled,
    startSessionRun,
    refreshSessionRuns,
    selectRun,
  };
}
