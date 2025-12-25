import { useCallback, useEffect, useRef, useState } from 'react';
import { getWebSocketUrl, analysisApi } from '../services/api';
import type { TestStep, WSMessage } from '../types/analysis';

interface UseAnalysisWebSocketReturn {
  steps: TestStep[];
  isConnected: boolean;
  isExecuting: boolean;
  isCompleted: boolean;
  success: boolean | null;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  startExecution: () => void;
  clear: () => Promise<void>;
}

export function useAnalysisWebSocket(sessionId: string | null): UseAnalysisWebSocketReturn {
  const [steps, setSteps] = useState<TestStep[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [success, setSuccess] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReconnectTimeout = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  };

  const disconnect = useCallback(() => {
    clearReconnectTimeout();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!sessionId) return;

    // Close existing connection
    disconnect();

    const ws = new WebSocket(getWebSocketUrl(sessionId));
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      setError(null);
    };

    ws.onclose = (event) => {
      console.log('WebSocket closed', event.code, event.reason);
      setIsConnected(false);
      wsRef.current = null;
    };

    ws.onerror = (event) => {
      console.error('WebSocket error', event);
      setError('WebSocket connection error');
    };

    ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        console.log('WebSocket message:', message);

        switch (message.type) {
          case 'step_started':
            // A new step is starting
            break;

          case 'step_completed':
            // Add the completed step to the list
            setSteps((prev) => [...prev, message.step]);
            break;

          case 'completed':
            setIsExecuting(false);
            setIsCompleted(true);
            setSuccess(message.success);
            break;

          case 'error':
            setError(message.message);
            setIsExecuting(false);
            break;

          case 'pong':
            // Heartbeat response
            break;
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    };
  }, [sessionId, disconnect]);

  const startExecution = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('WebSocket not connected');
      return;
    }

    // Reset state
    setSteps([]);
    setIsExecuting(true);
    setIsCompleted(false);
    setSuccess(null);
    setError(null);

    // Send start command
    wsRef.current.send(JSON.stringify({ command: 'start' }));
  }, []);

  const clear = useCallback(async () => {
    if (sessionId) {
      try {
        await analysisApi.clearSteps(sessionId);
      } catch (e) {
        console.error('Failed to clear steps on backend:', e);
      }
    }
    setSteps([]);
    setIsCompleted(false);
    setSuccess(null);
    setError(null);
  }, [sessionId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    steps,
    isConnected,
    isExecuting,
    isCompleted,
    success,
    error,
    connect,
    disconnect,
    startExecution,
    clear,
  };
}
