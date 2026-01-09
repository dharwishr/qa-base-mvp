import { useCallback, useEffect, useRef, useState } from 'react';
import { analysisApi, getWebSocketUrl } from '../services/api';
import type {
  TestStep,
  TestSession,
  SessionStatus,
  StepAction,
  WSMessage,
  WSInitialState,
  WSStatusChanged,
  WSStepCompleted,
  WSCompleted,
  WSError,
} from '../types/analysis';

interface UseSessionSubscriptionOptions {
  sessionId: string | null;
  autoConnect?: boolean;
  autoFetchInitial?: boolean;
}

interface UseSessionSubscriptionReturn {
  // State
  session: TestSession | null;
  steps: TestStep[];
  status: SessionStatus | null;
  isConnected: boolean;
  isExecuting: boolean;
  isCompleted: boolean;
  isStopped: boolean;
  isPaused: boolean;
  success: boolean | null;
  error: string | null;
  connectionMode: 'websocket' | 'polling' | 'disconnected';

  // Actions
  connect: () => void;
  disconnect: () => void;
  subscribe: (includeInitialState?: boolean) => void;
  startExecution: () => Promise<void>;
  stopExecution: () => Promise<void>;
  pauseExecution: () => Promise<void>;
  resumeExecution: () => Promise<void>;
  sendCommand: (command: string, data?: Record<string, unknown>) => void;
  refreshFromServer: () => Promise<void>;
  updateStepAction: (stepId: string, updatedAction: StepAction) => void;
  deleteStep: (stepId: string) => Promise<void>;
  clear: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 16000;
const MAX_RECONNECT_ATTEMPTS = 5;
const POLLING_INTERVAL = 2000;
const RECONNECT_WHILE_POLLING_INTERVAL = 30000;
const HEARTBEAT_INTERVAL = 30000;

export function useSessionSubscription(
  options: UseSessionSubscriptionOptions
): UseSessionSubscriptionReturn {
  const { sessionId, autoConnect = true, autoFetchInitial = true } = options;

  // State
  const [session, setSession] = useState<TestSession | null>(null);
  const [steps, setSteps] = useState<TestStep[]>([]);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [success, setSuccess] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<'websocket' | 'polling' | 'disconnected'>('disconnected');

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectWhilePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStepCountRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);

  // Keep sessionIdRef in sync
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Helper: Update status-derived state
  const updateStatusState = useCallback((newStatus: SessionStatus | string | null) => {
    setStatus(newStatus as SessionStatus);

    if (newStatus === 'running' || newStatus === 'queued') {
      setIsExecuting(true);
      setIsCompleted(false);
      setIsStopped(false);
      setIsPaused(false);
    } else if (newStatus === 'completed') {
      setIsExecuting(false);
      setIsCompleted(true);
      setIsStopped(false);
      setIsPaused(false);
      setSuccess(true);
    } else if (newStatus === 'stopped') {
      setIsExecuting(false);
      setIsCompleted(false);
      setIsStopped(true);
      setIsPaused(false);
      setSuccess(null);
    } else if (newStatus === 'paused') {
      setIsExecuting(false);
      setIsCompleted(false);
      setIsStopped(false);
      setIsPaused(true);
      setSuccess(null);
    } else if (newStatus === 'failed') {
      setIsExecuting(false);
      setIsCompleted(true);
      setIsStopped(false);
      setIsPaused(false);
      setSuccess(false);
    }
  }, []);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Polling fallback
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;

    const poll = async () => {
      const targetSessionId = sessionIdRef.current;
      if (!targetSessionId) return;

      try {
        const [sessionData, stepsData] = await Promise.all([
          analysisApi.getSession(targetSessionId),
          analysisApi.getSteps(targetSessionId),
        ]);

        setSession(sessionData);
        updateStatusState(sessionData.status);

        if (stepsData.length !== lastStepCountRef.current) {
          setSteps(stepsData);
          lastStepCountRef.current = stepsData.length;
        }

        // Stop polling if terminal state reached
        if (['completed', 'stopped', 'failed'].includes(sessionData.status)) {
          stopPolling();
        }
      } catch (e) {
        console.error('Polling error:', e);
      }
    };

    poll();
    pollIntervalRef.current = setInterval(poll, POLLING_INTERVAL);
    setConnectionMode('polling');
  }, [updateStatusState, stopPolling]);

  // Clear all timers
  const clearAllTimers = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (reconnectWhilePollingRef.current) {
      clearInterval(reconnectWhilePollingRef.current);
      reconnectWhilePollingRef.current = null;
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    stopPolling();
  }, [stopPolling]);

  // Disconnect WebSocket
  const disconnect = useCallback(() => {
    clearAllTimers();

    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }

    setIsConnected(false);
    setConnectionMode('disconnected');
  }, [clearAllTimers]);

  // Send command over WebSocket
  const sendCommand = useCallback((command: string, data?: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command, ...data }));
    } else {
      console.warn('WebSocket not connected, cannot send command');
    }
  }, []);

  // Manual subscribe
  const subscribe = useCallback((includeInitialState = true) => {
    sendCommand('subscribe', { include_initial_state: includeInitialState });
  }, [sendCommand]);

  // WebSocket connection
  const connect = useCallback(() => {
    const targetSessionId = sessionIdRef.current;
    if (!targetSessionId || wsRef.current?.readyState === WebSocket.OPEN) return;

    // Close any existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(getWebSocketUrl(targetSessionId));
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      setError(null);
      setConnectionMode('websocket');
      reconnectAttempts.current = 0;

      // Stop polling fallback if active
      stopPolling();
      if (reconnectWhilePollingRef.current) {
        clearInterval(reconnectWhilePollingRef.current);
        reconnectWhilePollingRef.current = null;
      }

      // Subscribe with initial state
      if (autoFetchInitial) {
        ws.send(JSON.stringify({ command: 'subscribe', include_initial_state: true }));
      }

      // Start heartbeat
      heartbeatIntervalRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ command: 'ping' }));
        }
      }, HEARTBEAT_INTERVAL);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WSMessage;

        switch (message.type) {
          case 'initial_state': {
            const initMsg = message as WSInitialState;
            if (initMsg.session) {
              setSession(initMsg.session);
              updateStatusState(initMsg.session.status);
            }
            if (initMsg.steps) {
              setSteps(initMsg.steps);
              lastStepCountRef.current = initMsg.steps.length;
            }
            break;
          }

          case 'step_started':
            // Optional: Update UI to show step is starting
            break;

          case 'step_completed': {
            const stepMsg = message as WSStepCompleted;
            if (stepMsg.step) {
              setSteps((prev) => [...prev, stepMsg.step]);
              lastStepCountRef.current++;
            }
            break;
          }

          case 'status_changed': {
            const statusMsg = message as WSStatusChanged;
            if (statusMsg.status) {
              updateStatusState(statusMsg.status);
            }
            break;
          }

          case 'completed': {
            const completeMsg = message as WSCompleted;
            setIsExecuting(false);
            setIsCompleted(true);
            if (completeMsg.success !== undefined) {
              setSuccess(completeMsg.success);
            }
            break;
          }

          case 'error': {
            const errorMsg = message as WSError;
            if (errorMsg.message) {
              setError(errorMsg.message);
            }
            setIsExecuting(false);
            break;
          }

          case 'pong':
            // Heartbeat response - connection is alive
            break;
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    };

    ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      setIsConnected(false);
      wsRef.current = null;

      // Clear heartbeat
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }

      // Attempt reconnection if not intentional close and we still have a session
      if (event.code !== 1000 && sessionIdRef.current) {
        // Attempt reconnection with exponential backoff
        if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
          console.log('Max reconnection attempts reached, falling back to polling');
          setConnectionMode('polling');
          startPolling();

          // Try to reconnect periodically while polling
          reconnectWhilePollingRef.current = setInterval(() => {
            reconnectAttempts.current = 0;
            connect();
          }, RECONNECT_WHILE_POLLING_INTERVAL);
        } else {
          const delay = Math.min(
            INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current),
            MAX_RECONNECT_DELAY
          );

          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connect();
          }, delay);
        }
      }
    };

    ws.onerror = (event) => {
      console.error('WebSocket error:', event);
      // onclose will be called after this
    };
  }, [autoFetchInitial, stopPolling, startPolling, updateStatusState]);

  // Fetch from server (REST fallback)
  const refreshFromServer = useCallback(async () => {
    const targetSessionId = sessionIdRef.current;
    if (!targetSessionId) return;

    try {
      const [sessionData, stepsData] = await Promise.all([
        analysisApi.getSession(targetSessionId),
        analysisApi.getSteps(targetSessionId),
      ]);

      setSession(sessionData);
      setSteps(stepsData);
      updateStatusState(sessionData.status);
      lastStepCountRef.current = stepsData.length;
    } catch (e) {
      console.error('Error refreshing from server:', e);
      setError(e instanceof Error ? e.message : 'Failed to fetch session');
    }
  }, [updateStatusState]);

  // Start execution
  const startExecution = useCallback(async () => {
    const targetSessionId = sessionIdRef.current;
    if (!targetSessionId) {
      setError('No session ID');
      return;
    }

    try {
      setSteps([]);
      lastStepCountRef.current = 0;
      setIsExecuting(true);
      setIsCompleted(false);
      setIsStopped(false);
      setSuccess(null);
      setError(null);

      // If WebSocket is connected, send start command through WebSocket
      // This ensures we receive real-time step updates
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ command: 'start' }));
      } else {
        // Fallback to REST API + polling
        await analysisApi.startExecution(targetSessionId);
        startPolling();
      }
    } catch (e) {
      console.error('Error starting execution:', e);
      setError(e instanceof Error ? e.message : 'Failed to start execution');
      setIsExecuting(false);
    }
  }, [startPolling]);

  // Stop execution
  const stopExecution = useCallback(async () => {
    const targetSessionId = sessionIdRef.current;
    if (!targetSessionId) return;

    try {
      await analysisApi.stopExecution(targetSessionId);
      setIsExecuting(false);
      setIsStopped(true);
    } catch (e) {
      console.error('Error stopping execution:', e);
      setError(e instanceof Error ? e.message : 'Failed to stop execution');
    }
  }, []);

  // Pause execution (resumable)
  const pauseExecution = useCallback(async () => {
    const targetSessionId = sessionIdRef.current;
    if (!targetSessionId) return;

    try {
      await analysisApi.pauseExecution(targetSessionId);
      // Note: Status will be updated via WebSocket/polling when agent actually pauses
    } catch (e) {
      console.error('Error pausing execution:', e);
      setError(e instanceof Error ? e.message : 'Failed to pause execution');
    }
  }, []);

  // Resume execution from paused state
  const resumeExecution = useCallback(async () => {
    const targetSessionId = sessionIdRef.current;
    if (!targetSessionId) return;

    try {
      await analysisApi.resumeExecution(targetSessionId);
      setIsPaused(false);
      setIsExecuting(true);
      setStatus('queued');
    } catch (e) {
      console.error('Error resuming execution:', e);
      setError(e instanceof Error ? e.message : 'Failed to resume execution');
    }
  }, []);

  // Update step action
  const updateStepAction = useCallback((stepId: string, updatedAction: StepAction) => {
    setSteps((prevSteps) =>
      prevSteps.map((step) =>
        step.id === stepId
          ? {
              ...step,
              actions: step.actions.map((action) =>
                action.id === updatedAction.id ? updatedAction : action
              ),
            }
          : step
      )
    );
  }, []);

  // Delete a single step
  const deleteStep = useCallback(async (stepId: string) => {
    try {
      // Call API to delete the step
      await analysisApi.deleteStep(stepId);

      // Update local state: remove the step and renumber remaining steps
      setSteps((prevSteps) => {
        const stepIndex = prevSteps.findIndex((s) => s.id === stepId);
        if (stepIndex === -1) return prevSteps;

        // Remove the step
        const newSteps = prevSteps.filter((s) => s.id !== stepId);

        // Renumber remaining steps
        return newSteps.map((step, idx) => ({
          ...step,
          step_number: idx + 1,
        }));
      });

      lastStepCountRef.current = Math.max(0, lastStepCountRef.current - 1);
    } catch (e) {
      console.error('Failed to delete step:', e);
      setError(e instanceof Error ? e.message : 'Failed to delete step');
      throw e;
    }
  }, []);

  // Clear steps
  const clear = useCallback(async () => {
    const targetSessionId = sessionIdRef.current;
    if (targetSessionId) {
      try {
        await analysisApi.clearSteps(targetSessionId);
      } catch (e) {
        console.error('Failed to clear steps:', e);
      }
    }
    setSteps([]);
    lastStepCountRef.current = 0;
    setIsCompleted(false);
    setIsStopped(false);
    setSuccess(null);
    setError(null);
  }, []);

  // Auto-connect on mount or sessionId change
  useEffect(() => {
    if (autoConnect && sessionId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [sessionId, autoConnect, connect, disconnect]);

  // Reset state when sessionId changes
  useEffect(() => {
    setSession(null);
    setSteps([]);
    setStatus(null);
    setIsExecuting(false);
    setIsCompleted(false);
    setIsStopped(false);
    setSuccess(null);
    setError(null);
    lastStepCountRef.current = 0;
  }, [sessionId]);

  return {
    session,
    steps,
    status,
    isConnected,
    isExecuting,
    isCompleted,
    isStopped,
    isPaused,
    success,
    error,
    connectionMode,
    connect,
    disconnect,
    subscribe,
    startExecution,
    stopExecution,
    pauseExecution,
    resumeExecution,
    sendCommand,
    refreshFromServer,
    updateStepAction,
    deleteStep,
    clear,
    startPolling,
    stopPolling,
  };
}
