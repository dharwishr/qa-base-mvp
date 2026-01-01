import { useCallback, useEffect, useRef, useState } from 'react';
import { benchmarkApi } from '../services/benchmarkApi';
import { getAuthToken } from '../contexts/AuthContext';
import { config } from '../config';
import type { LlmModel, TestStep, TestPlan } from '../types/analysis';
import type {
  BenchmarkSession,
  BenchmarkModelRun,
  ModelBrowserSession,
  BenchmarkMode,
} from '../types/benchmark';
import type { TimelineMessage, ChatMode, PlanStep, PlanStatus } from '../types/chat';

// Generate UUID with fallback for non-secure contexts (HTTP)
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

// Per-model state
export interface ModelRunState {
  modelRun: BenchmarkModelRun;
  messages: TimelineMessage[];
  steps: TestStep[];
  plan: TestPlan | null;
  browserSession: ModelBrowserSession | null;
  selectedStepId: string | null;
  lastStepCount: number;
}

interface UseBenchmarkSessionReturn {
  // State
  benchmarkSession: BenchmarkSession | null;
  benchmarkId: string | null;
  modelRunStates: Map<string, ModelRunState>;
  selectedModels: LlmModel[];
  headless: boolean;
  mode: BenchmarkMode;
  isCreating: boolean;
  isRunning: boolean;
  isPlanning: boolean;
  error: string | null;
  // Per-model state
  modelModes: Map<string, ChatMode>;
  modelGeneratingPlan: Map<string, boolean>;
  modelExecuting: Map<string, boolean>;

  // Actions
  setSelectedModels: (models: LlmModel[]) => void;
  setHeadless: (headless: boolean) => void;
  setMode: (mode: BenchmarkMode) => void;
  createAndStartBenchmark: (prompt: string) => Promise<void>;
  stopBenchmark: () => Promise<void>;
  resetBenchmark: () => void;
  setSelectedStepId: (modelRunId: string, stepId: string | null) => void;
  // Plan mode actions
  approvePlan: (modelRunId: string) => Promise<void>;
  rejectPlan: (modelRunId: string) => Promise<void>;
  executeApprovedPlans: () => Promise<void>;
  // Act mode actions
  sendAction: (action: string) => Promise<void>;
  // Per-model chat actions
  sendModelMessage: (modelRunId: string, text: string, mode: ChatMode) => Promise<void>;
  setModelMode: (modelRunId: string, mode: ChatMode) => void;
}

const POLL_INTERVAL = 2000;

export function useBenchmarkSession(): UseBenchmarkSessionReturn {
  // Core state
  const [benchmarkSession, setBenchmarkSession] = useState<BenchmarkSession | null>(null);
  const [benchmarkId, setBenchmarkId] = useState<string | null>(null);
  const [modelRunStates, setModelRunStates] = useState<Map<string, ModelRunState>>(new Map());
  const [selectedModels, setSelectedModels] = useState<LlmModel[]>(['gemini-2.5-flash']);
  const [headless, setHeadless] = useState(false); // Default to live browser view
  const [mode, setMode] = useState<BenchmarkMode>('auto');
  const [isCreating, setIsCreating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-model state
  const [modelModes, setModelModes] = useState<Map<string, ChatMode>>(new Map());
  const [modelGeneratingPlan, setModelGeneratingPlan] = useState<Map<string, boolean>>(new Map());
  const [modelExecuting, setModelExecuting] = useState<Map<string, boolean>>(new Map());

  // Refs
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserPollIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const headlessRef = useRef(headless);
  
  // Keep headlessRef in sync
  headlessRef.current = headless;

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Stop browser polling for all models
  const stopAllBrowserPolling = useCallback(() => {
    browserPollIntervalsRef.current.forEach((interval) => {
      clearInterval(interval);
    });
    browserPollIntervalsRef.current.clear();
  }, []);

  // Poll for browser session for a specific model run
  const startBrowserPolling = useCallback((modelRunId: string, testSessionId: string, llmModel: LlmModel) => {
    // Stop existing polling for this model
    const existingInterval = browserPollIntervalsRef.current.get(modelRunId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

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
            setModelRunStates((prev) => {
              const newMap = new Map(prev);
              const state = newMap.get(modelRunId);
              if (state) {
                newMap.set(modelRunId, {
                  ...state,
                  browserSession: {
                    modelRunId,
                    llmModel,
                    browserSessionId: matching.id,
                    liveViewUrl: `/browser/sessions/${matching.id}/view`,
                    novncUrl: matching.novnc_url,
                  },
                });
              }
              return newMap;
            });
          }
        }
      } catch (e) {
        console.error('Error checking browser session:', e);
      }
    };

    checkBrowserSession();
    const interval = setInterval(checkBrowserSession, 3000);
    browserPollIntervalsRef.current.set(modelRunId, interval);
  }, []);

  // Poll for benchmark session updates
  const pollBenchmarkSession = useCallback(async () => {
    if (!benchmarkId) return;

    try {
      const session = await benchmarkApi.getSession(benchmarkId);
      setBenchmarkSession(session);

      // Fetch steps for all model runs in parallel
      const modelRunUpdates = await Promise.all(
        session.model_runs.map(async (modelRun) => {
          let steps: TestStep[] = [];
          if (modelRun.test_session_id) {
            try {
              steps = await benchmarkApi.getModelRunSteps(benchmarkId, modelRun.id);
              console.log(`[Benchmark Poll] Model ${modelRun.llm_model}: status=${modelRun.status}, test_session_id=${modelRun.test_session_id}, steps=${steps.length}`);
            } catch (e) {
              console.error(`Error fetching steps for model run ${modelRun.id}:`, e);
            }
          } else {
            console.log(`[Benchmark Poll] Model ${modelRun.llm_model}: status=${modelRun.status}, no test_session_id yet`);
          }

          let plan: TestPlan | null = null;
          // Fetch plan for plan_ready, approved, or running states (to retain plan info)
          if (['plan_ready', 'approved', 'running', 'completed'].includes(modelRun.status) && modelRun.test_session_id) {
            try {
              plan = await benchmarkApi.getModelRunPlan(benchmarkId, modelRun.id);
            } catch (e) {
              console.error(`Error fetching plan for model run ${modelRun.id}:`, e);
            }
          }

          return { modelRun, steps, plan };
        })
      );

      // Update all model run states in a single batch
      setModelRunStates((prev) => {
        const newMap = new Map(prev);

        for (const { modelRun, steps, plan } of modelRunUpdates) {
          const existingState = newMap.get(modelRun.id);
          const lastStepCount = existingState?.lastStepCount || 0;

          // Create new step messages for new steps
          const newStepMessages: TimelineMessage[] = [];
          if (steps.length > lastStepCount) {
            const newSteps = steps.slice(lastStepCount);
            for (const step of newSteps) {
              newStepMessages.push(createTimelineMessage('step', { step }));
            }
          }

          // Add system messages for status changes
          const statusMessages: TimelineMessage[] = [];
          const prevStatus = existingState?.modelRun.status;
          const hasStatusChanged = prevStatus !== modelRun.status;

          // Track if we already have a plan message in existing messages
          const hasPlanMessage = existingState?.messages.some(m => m.type === 'plan') || false;

          if (hasStatusChanged) {
            if (modelRun.status === 'queued') {
              statusMessages.push(createTimelineMessage('system', {
                content: `Queued for execution with ${modelRun.llm_model}...`,
              }));
            } else if (modelRun.status === 'planning') {
              statusMessages.push(createTimelineMessage('system', {
                content: `Generating plan with ${modelRun.llm_model}...`,
              }));
            } else if (modelRun.status === 'plan_ready' && plan && !hasPlanMessage) {
              // Add plan message to timeline when plan is ready
              const planSteps: PlanStep[] = plan.steps_json?.steps || [];
              statusMessages.push(createTimelineMessage('plan', {
                planId: plan.id,
                planText: plan.plan_text || '',
                planSteps,
                status: 'pending' as PlanStatus,
              }));
            } else if (modelRun.status === 'running') {
              statusMessages.push(createTimelineMessage('system', {
                content: `Starting execution with ${modelRun.llm_model}...`,
              }));
            } else if (modelRun.status === 'completed') {
              statusMessages.push(createTimelineMessage('system', {
                content: `Completed with ${modelRun.total_steps} steps in ${modelRun.duration_seconds.toFixed(1)}s`,
              }));
            } else if (modelRun.status === 'failed') {
              statusMessages.push(createTimelineMessage('error', {
                content: modelRun.error || 'Execution failed',
              }));
            }
          }

          // Update plan message status if it exists and status changed
          let updatedMessages = existingState?.messages || [];
          if (hasPlanMessage && hasStatusChanged) {
            updatedMessages = updatedMessages.map(m => {
              if (m.type === 'plan') {
                let newStatus: PlanStatus = (m as any).status;
                if (modelRun.status === 'approved' || modelRun.status === 'running' || modelRun.status === 'completed') {
                  newStatus = 'approved';
                } else if (modelRun.status === 'rejected') {
                  newStatus = 'rejected';
                }
                return { ...m, status: newStatus };
              }
              return m;
            });
          }

          // Start browser polling if running and not headless
          if (
            modelRun.status === 'running' &&
            modelRun.test_session_id &&
            !headlessRef.current &&
            !existingState?.browserSession
          ) {
            startBrowserPolling(modelRun.id, modelRun.test_session_id, modelRun.llm_model as LlmModel);
          }

          const newMessages = [
            ...updatedMessages,
            ...statusMessages,
            ...newStepMessages,
          ];
          
          console.log(`[Benchmark Poll] Model ${modelRun.llm_model}: prevStatus=${prevStatus}, newStatus=${modelRun.status}, newStepMsgs=${newStepMessages.length}, totalMsgs=${newMessages.length}`);

          const newState: ModelRunState = {
            modelRun,
            messages: newMessages,
            steps,
            plan: plan || existingState?.plan || null,
            browserSession: existingState?.browserSession || null,
            selectedStepId:
              newStepMessages.length > 0
                ? steps[steps.length - 1]?.id || existingState?.selectedStepId || null
                : existingState?.selectedStepId || null,
            lastStepCount: steps.length,
          };

          newMap.set(modelRun.id, newState);
        }

        return newMap;
      });

      // Check if benchmark is complete
      const allComplete = session.model_runs.every(
        (run) => run.status === 'completed' || run.status === 'failed'
      );
      if (allComplete && session.status !== 'pending') {
        setIsRunning(false);
        stopPolling();
        stopAllBrowserPolling();
      }
    } catch (e) {
      console.error('Error polling benchmark session:', e);
    }
  }, [benchmarkId, stopPolling, stopAllBrowserPolling, startBrowserPolling]);

  // Start polling
  const startPolling = useCallback(() => {
    stopPolling();
    pollBenchmarkSession();
    pollIntervalRef.current = setInterval(pollBenchmarkSession, POLL_INTERVAL);
  }, [pollBenchmarkSession, stopPolling]);

  // Create and start benchmark
  const createAndStartBenchmark = useCallback(
    async (prompt: string) => {
      if (selectedModels.length === 0) {
        setError('Please select at least one model');
        return;
      }

      if (selectedModels.length > 3) {
        setError('Maximum 3 models allowed');
        return;
      }

      setError(null);
      setIsCreating(true);

      try {
        // Create benchmark session
        const session = await benchmarkApi.createSession({
          prompt,
          models: selectedModels,
          headless,
          mode,
        });

        setBenchmarkSession(session);
        setBenchmarkId(session.id);

        // Initialize model run states with just the user message
        const initialStates = new Map<string, ModelRunState>();
        for (const modelRun of session.model_runs) {
          initialStates.set(modelRun.id, {
            modelRun,
            messages: [
              createTimelineMessage('user', { content: prompt, mode: 'plan' as ChatMode }),
            ],
            steps: [],
            plan: null,
            browserSession: null,
            selectedStepId: null,
            lastStepCount: 0,
          });
        }
        setModelRunStates(initialStates);

        // Start based on mode
        if (mode === 'auto') {
          await benchmarkApi.startBenchmark(session.id);
          setIsRunning(true);
        } else if (mode === 'plan') {
          await benchmarkApi.startPlan(session.id);
          setIsPlanning(true);
        } else if (mode === 'act') {
          await benchmarkApi.startAct(session.id);
          setIsRunning(true);
        }

        // Polling will start automatically via useEffect when benchmarkId changes
      } catch (e) {
        console.error('Error creating benchmark:', e);
        setError(e instanceof Error ? e.message : 'Failed to create benchmark');
      } finally {
        setIsCreating(false);
      }
    },
    [selectedModels, headless, mode, startPolling]
  );

  // Stop benchmark
  const stopBenchmark = useCallback(async () => {
    if (!benchmarkId) return;

    try {
      await benchmarkApi.stopBenchmark(benchmarkId);
      setIsRunning(false);
      stopPolling();
      stopAllBrowserPolling();

      // Update all model run states to show stopped
      setModelRunStates((prev) => {
        const newMap = new Map(prev);
        newMap.forEach((state, id) => {
          if (state.modelRun.status === 'running' || state.modelRun.status === 'queued') {
            newMap.set(id, {
              ...state,
              modelRun: { ...state.modelRun, status: 'failed', error: 'Stopped by user' },
              messages: [
                ...state.messages,
                createTimelineMessage('system', { content: 'Execution stopped by user' }),
              ],
            });
          }
        });
        return newMap;
      });
    } catch (e) {
      console.error('Error stopping benchmark:', e);
      setError(e instanceof Error ? e.message : 'Failed to stop benchmark');
    }
  }, [benchmarkId, stopPolling, stopAllBrowserPolling]);

  // Reset benchmark
  const resetBenchmark = useCallback(() => {
    stopPolling();
    stopAllBrowserPolling();
    setBenchmarkSession(null);
    setBenchmarkId(null);
    setModelRunStates(new Map());
    setIsRunning(false);
    setIsPlanning(false);
    setIsCreating(false);
    setError(null);
  }, [stopPolling, stopAllBrowserPolling]);

  // Set selected step for a model run
  const setSelectedStepId = useCallback((modelRunId: string, stepId: string | null) => {
    setModelRunStates((prev) => {
      const newMap = new Map(prev);
      const state = newMap.get(modelRunId);
      if (state) {
        newMap.set(modelRunId, { ...state, selectedStepId: stepId });
      }
      return newMap;
    });
  }, []);

  // ============================================
  // Plan Mode Actions
  // ============================================

  const approvePlan = useCallback(async (modelRunId: string) => {
    if (!benchmarkId) return;
    try {
      await benchmarkApi.approvePlan(benchmarkId, modelRunId);
      setModelRunStates((prev) => {
        const newMap = new Map(prev);
        const state = newMap.get(modelRunId);
        if (state) {
          newMap.set(modelRunId, {
            ...state,
            modelRun: { ...state.modelRun, status: 'approved' },
            messages: [
              ...state.messages,
              createTimelineMessage('system', { content: 'Plan approved' }),
            ],
          });
        }
        return newMap;
      });
    } catch (e) {
      console.error('Error approving plan:', e);
      setError(e instanceof Error ? e.message : 'Failed to approve plan');
    }
  }, [benchmarkId]);

  const rejectPlan = useCallback(async (modelRunId: string) => {
    if (!benchmarkId) return;
    try {
      await benchmarkApi.rejectPlan(benchmarkId, modelRunId);
      setModelRunStates((prev) => {
        const newMap = new Map(prev);
        const state = newMap.get(modelRunId);
        if (state) {
          newMap.set(modelRunId, {
            ...state,
            modelRun: { ...state.modelRun, status: 'rejected' },
            messages: [
              ...state.messages,
              createTimelineMessage('system', { content: 'Plan rejected' }),
            ],
          });
        }
        return newMap;
      });
    } catch (e) {
      console.error('Error rejecting plan:', e);
      setError(e instanceof Error ? e.message : 'Failed to reject plan');
    }
  }, [benchmarkId]);

  const executeApprovedPlans = useCallback(async () => {
    if (!benchmarkId) return;
    try {
      await benchmarkApi.executeApproved(benchmarkId);
      setIsPlanning(false);
      setIsRunning(true);
      
      // Update status for approved runs
      setModelRunStates((prev) => {
        const newMap = new Map(prev);
        newMap.forEach((state, id) => {
          if (state.modelRun.status === 'approved') {
            newMap.set(id, {
              ...state,
              modelRun: { ...state.modelRun, status: 'queued' },
              messages: [
                ...state.messages,
                createTimelineMessage('system', { content: 'Execution started' }),
              ],
            });
          }
        });
        return newMap;
      });
    } catch (e) {
      console.error('Error executing approved plans:', e);
      setError(e instanceof Error ? e.message : 'Failed to execute plans');
    }
  }, [benchmarkId]);

  // ============================================
  // Act Mode Actions
  // ============================================

  const sendAction = useCallback(async (action: string) => {
    if (!benchmarkId) return;

    // Add user message to all model runs
    setModelRunStates((prev) => {
      const newMap = new Map(prev);
      newMap.forEach((state, id) => {
        newMap.set(id, {
          ...state,
          messages: [
            ...state.messages,
            createTimelineMessage('user', { content: action, mode: 'act' as ChatMode }),
          ],
        });
      });
      return newMap;
    });

    // Execute action on all model runs in parallel
    const modelRunIds = Array.from(modelRunStates.keys());
    const results = await Promise.allSettled(
      modelRunIds.map((modelRunId) =>
        benchmarkApi.actOnModelRun(benchmarkId, modelRunId, action)
      )
    );

    // Update states with results
    results.forEach((result, index) => {
      const modelRunId = modelRunIds[index];
      if (result.status === 'fulfilled') {
        const response = result.value;
        setModelRunStates((prev) => {
          const newMap = new Map(prev);
          const state = newMap.get(modelRunId);
          if (state) {
            newMap.set(modelRunId, {
              ...state,
              messages: [
                ...state.messages,
                createTimelineMessage('system', {
                  content: response.action_taken || 'Action executed',
                }),
              ],
            });
          }
          return newMap;
        });
      } else {
        console.error(`Error executing action on ${modelRunId}:`, result.reason);
      }
    });
  }, [benchmarkId, modelRunStates]);

  // ============================================
  // Per-Model Chat Actions
  // ============================================

  // Set mode for a specific model
  const setModelMode = useCallback((modelRunId: string, newMode: ChatMode) => {
    setModelModes((prev) => {
      const newMap = new Map(prev);
      newMap.set(modelRunId, newMode);
      return newMap;
    });
  }, []);

  // Send message to a specific model run
  const sendModelMessage = useCallback(async (modelRunId: string, text: string, msgMode: ChatMode) => {
    if (!benchmarkId) return;

    const modelState = modelRunStates.get(modelRunId);
    if (!modelState) return;

    const testSessionId = modelState.modelRun.test_session_id;
    if (!testSessionId) {
      console.error('Cannot send message: no test session ID for model run');
      return;
    }

    // Add user message to timeline
    setModelRunStates((prev) => {
      const newMap = new Map(prev);
      const state = newMap.get(modelRunId);
      if (state) {
        newMap.set(modelRunId, {
          ...state,
          messages: [
            ...state.messages,
            createTimelineMessage('user', { content: text, mode: msgMode }),
          ],
        });
      }
      return newMap;
    });

    try {
      if (msgMode === 'plan') {
        // Set generating plan flag
        setModelGeneratingPlan((prev) => {
          const newMap = new Map(prev);
          newMap.set(modelRunId, true);
          return newMap;
        });

        // Call continue session API for plan mode
        await benchmarkApi.continueModelRun(benchmarkId, modelRunId, text, 'plan');

        // Add system message
        setModelRunStates((prev) => {
          const newMap = new Map(prev);
          const state = newMap.get(modelRunId);
          if (state) {
            newMap.set(modelRunId, {
              ...state,
              messages: [
                ...state.messages,
                createTimelineMessage('system', { content: 'Generating new plan...' }),
              ],
            });
          }
          return newMap;
        });
      } else {
        // Act mode - execute action directly
        setModelExecuting((prev) => {
          const newMap = new Map(prev);
          newMap.set(modelRunId, true);
          return newMap;
        });

        const response = await benchmarkApi.actOnModelRun(benchmarkId, modelRunId, text);

        setModelRunStates((prev) => {
          const newMap = new Map(prev);
          const state = newMap.get(modelRunId);
          if (state) {
            newMap.set(modelRunId, {
              ...state,
              messages: [
                ...state.messages,
                createTimelineMessage('system', {
                  content: response.action_taken || 'Action executed',
                }),
              ],
            });
          }
          return newMap;
        });

        setModelExecuting((prev) => {
          const newMap = new Map(prev);
          newMap.set(modelRunId, false);
          return newMap;
        });
      }
    } catch (e) {
      console.error(`Error sending message to model run ${modelRunId}:`, e);

      // Add error message
      setModelRunStates((prev) => {
        const newMap = new Map(prev);
        const state = newMap.get(modelRunId);
        if (state) {
          newMap.set(modelRunId, {
            ...state,
            messages: [
              ...state.messages,
              createTimelineMessage('error', {
                content: e instanceof Error ? e.message : 'Failed to send message',
              }),
            ],
          });
        }
        return newMap;
      });

      // Clear flags
      setModelGeneratingPlan((prev) => {
        const newMap = new Map(prev);
        newMap.set(modelRunId, false);
        return newMap;
      });
      setModelExecuting((prev) => {
        const newMap = new Map(prev);
        newMap.set(modelRunId, false);
        return newMap;
      });
    }
  }, [benchmarkId, modelRunStates]);

  // Start polling when benchmarkId is set (fixes stale closure issue)
  useEffect(() => {
    if (!benchmarkId) return;
    // benchmarkId is now committed to state, so pollBenchmarkSession has the correct ID
    startPolling();
    
    return () => {
      stopPolling();
    };
  }, [benchmarkId, startPolling, stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
      stopAllBrowserPolling();
    };
  }, [stopPolling, stopAllBrowserPolling]);

  return {
    benchmarkSession,
    benchmarkId,
    modelRunStates,
    selectedModels,
    headless,
    mode,
    isCreating,
    isRunning,
    isPlanning,
    error,
    // Per-model state
    modelModes,
    modelGeneratingPlan,
    modelExecuting,

    setSelectedModels,
    setHeadless,
    setMode,
    createAndStartBenchmark,
    stopBenchmark,
    resetBenchmark,
    setSelectedStepId,
    // Plan mode actions
    approvePlan,
    rejectPlan,
    executeApprovedPlans,
    // Act mode actions
    sendAction,
    // Per-model chat actions
    sendModelMessage,
    setModelMode,
  };
}
