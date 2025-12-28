import { useCallback, useEffect, useRef, useState } from 'react';
import { analysisApi } from '../services/api';
import type { TestStep, SessionStatus, StepAction } from '../types/analysis';

interface UseAnalysisPollingReturn {
  steps: TestStep[];
  status: SessionStatus | null;
  isExecuting: boolean;
  isCompleted: boolean;
  isStopped: boolean;
  success: boolean | null;
  error: string | null;
  startExecution: () => Promise<void>;
  stopExecution: () => Promise<void>;
  clear: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  updateStepAction: (stepId: string, updatedAction: StepAction) => void;
}

const POLL_INTERVAL = 2000; // 2 seconds

export function useAnalysisPolling(sessionId: string | null): UseAnalysisPollingReturn {
  const [steps, setSteps] = useState<TestStep[]>([]);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const [success, setSuccess] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStepCountRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const pollSession = useCallback(async () => {
    if (!sessionId) return;

    try {
      // Get session status
      const session = await analysisApi.getSession(sessionId);
      setStatus(session.status);

      // Get steps
      const sessionSteps = await analysisApi.getSteps(sessionId);

      // Only update if we have new steps
      if (sessionSteps.length !== lastStepCountRef.current) {
        setSteps(sessionSteps);
        lastStepCountRef.current = sessionSteps.length;
      }

      // Update execution state based on session status
      if (session.status === 'running' || session.status === 'queued') {
        setIsExecuting(true);
        setIsCompleted(false);
        setIsStopped(false);
      } else if (session.status === 'completed') {
        setIsExecuting(false);
        setIsCompleted(true);
        setIsStopped(false);
        setSuccess(true);
        stopPolling(); // Stop polling when completed
      } else if (session.status === 'stopped') {
        setIsExecuting(false);
        setIsCompleted(false);
        setIsStopped(true);
        setSuccess(null);
        stopPolling(); // Stop polling when stopped
      } else if (session.status === 'failed') {
        setIsExecuting(false);
        setIsCompleted(true);
        setSuccess(false);
        stopPolling(); // Stop polling when failed
      }
    } catch (e) {
      console.error('Error polling session:', e);
      setError(e instanceof Error ? e.message : 'Failed to poll session');
    }
  }, [sessionId, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling(); // Clear any existing interval

    // Poll immediately
    pollSession();

    // Then poll at interval
    pollIntervalRef.current = setInterval(pollSession, POLL_INTERVAL);
  }, [pollSession, stopPolling]);

  const startExecution = useCallback(async () => {
    if (!sessionId) {
      setError('No session ID');
      return;
    }

    try {
      // Reset state
      setSteps([]);
      lastStepCountRef.current = 0;
      setIsExecuting(true);
      setIsCompleted(false);
      setSuccess(null);
      setError(null);

      // Start execution via API
      await analysisApi.startExecution(sessionId);

      // Start polling for updates
      startPolling();
    } catch (e) {
      console.error('Error starting execution:', e);
      setError(e instanceof Error ? e.message : 'Failed to start execution');
      setIsExecuting(false);
    }
  }, [sessionId, startPolling]);

  const stopExecution = useCallback(async () => {
    if (!sessionId) {
      setError('No session ID');
      return;
    }

    try {
      // Stop execution via API
      await analysisApi.stopExecution(sessionId);

      // Stop polling and update state
      stopPolling();
      setIsExecuting(false);
      setIsStopped(true);
    } catch (e) {
      console.error('Error stopping execution:', e);
      setError(e instanceof Error ? e.message : 'Failed to stop execution');
    }
  }, [sessionId, stopPolling]);

  const clear = useCallback(async () => {
    if (sessionId) {
      try {
        await analysisApi.clearSteps(sessionId);
      } catch (e) {
        console.error('Failed to clear steps on backend:', e);
      }
    }
    setSteps([]);
    lastStepCountRef.current = 0;
    setIsCompleted(false);
    setIsStopped(false);
    setSuccess(null);
    setError(null);
  }, [sessionId]);

  const updateStepAction = useCallback((stepId: string, updatedAction: StepAction) => {
    setSteps(prevSteps =>
      prevSteps.map(step =>
        step.id === stepId
          ? {
              ...step,
              actions: step.actions.map(action =>
                action.id === updatedAction.id ? updatedAction : action
              )
            }
          : step
      )
    );
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  // Reset state when sessionId changes
  useEffect(() => {
    setSteps([]);
    lastStepCountRef.current = 0;
    setStatus(null);
    setIsExecuting(false);
    setIsCompleted(false);
    setIsStopped(false);
    setSuccess(null);
    setError(null);
    stopPolling();
  }, [sessionId, stopPolling]);

  return {
    steps,
    status,
    isExecuting,
    isCompleted,
    isStopped,
    success,
    error,
    startExecution,
    stopExecution,
    clear,
    startPolling,
    stopPolling,
    updateStepAction,
  };
}
