import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { RotateCcw, Square, Settings2, Bot, Monitor, EyeOff, AlertCircle, X, FileCode, List, LayoutList, ExternalLink, Play, RefreshCw, Circle, CheckCircle, XCircle, PauseCircle, StopCircle, Clock, Loader2, Video } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { Button } from '@/components/ui/button';
import ChatTimeline from '@/components/chat/ChatTimeline';
import ChatInput from '@/components/chat/ChatInput';
import BrowserPanel from '@/components/analysis/BrowserPanel';
import UndoConfirmDialog from '@/components/analysis/UndoConfirmDialog';
import DeleteStepDialog from '@/components/analysis/DeleteStepDialog';
import PlanEditModal from '@/components/plan/PlanEditModal';
import { useChatSession, type ReplayFailure } from '@/hooks/useChatSession';
import { getScreenshotUrl, scriptsApi, analysisApi, settingsApi } from '@/services/api';
import type { LlmModel } from '@/types/analysis';
import type { QueueFailure } from '@/types/chat';
import type { PlaywrightScript } from '@/types/scripts';

const LLM_OPTIONS: { value: LlmModel; label: string }[] = [
  { value: 'browser-use-llm', label: 'Browser Use LLM' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash' },
  { value: 'gemini-3.0-pro', label: 'Gemini 3.0 Pro' },
  { value: 'gemini-2.5-computer-use', label: 'Gemini 2.5 Computer Use' },
];

const STATUS_COLORS: Record<string, string> = {
  'pending_plan': 'bg-gray-100 text-gray-700',
  'plan_ready': 'bg-blue-100 text-blue-700',
  'approved': 'bg-purple-100 text-purple-700',
  'queued': 'bg-orange-100 text-orange-700',
  'running': 'bg-yellow-100 text-yellow-700',
  'rerunning': 'bg-cyan-100 text-cyan-700',
  'completed': 'bg-green-100 text-green-700',
  'failed': 'bg-red-100 text-red-700',
  'stopped': 'bg-orange-100 text-orange-700',
  'paused': 'bg-amber-100 text-amber-700',
  'recording_ready': 'bg-purple-100 text-purple-700',
};

const STATUS_LABELS: Record<string, string> = {
  'pending_plan': 'Pending Plan',
  'plan_ready': 'Plan Ready',
  'approved': 'Approved',
  'queued': 'Queued',
  'running': 'Running',
  'rerunning': 'Re-Running',
  'completed': 'Completed',
  'failed': 'Failed',
  'stopped': 'Stopped',
  'paused': 'Paused',
  'recording_ready': 'Recording',
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'completed': return <CheckCircle className="h-3 w-3" />;
    case 'failed': return <XCircle className="h-3 w-3" />;
    case 'running': return <Clock className="h-3 w-3 animate-pulse" />;
    case 'rerunning': return <RefreshCw className="h-3 w-3 animate-spin" />;
    case 'queued': return <Clock className="h-3 w-3" />;
    case 'paused': return <PauseCircle className="h-3 w-3" />;
    case 'stopped': return <StopCircle className="h-3 w-3" />;
    case 'recording_ready': return <Video className="h-3 w-3" />;
    default: return <Circle className="h-3 w-3" />;
  }
};

// Queue failure dialog component
function QueueFailureDialog({
  failure,
  onProceed,
  onCancel,
}: {
  failure: QueueFailure;
  onProceed: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-destructive/10 border-b">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <h3 className="font-semibold text-destructive">Task Failed</h3>
          <button
            onClick={onCancel}
            className="ml-auto p-1 hover:bg-destructive/10 rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            The previous task failed with error:
          </p>
          <div className="bg-muted/50 rounded p-3 text-sm font-mono">
            {failure.error}
          </div>

          {failure.pendingMessages.length > 0 && (
            <>
              <p className="text-sm text-muted-foreground">
                You have {failure.pendingMessages.length} queued message{failure.pendingMessages.length > 1 ? 's' : ''} waiting:
              </p>
              <div className="space-y-2 max-h-32 overflow-auto">
                {failure.pendingMessages.map((msg, idx) => (
                  <div
                    key={msg.id}
                    className="bg-muted/30 rounded p-2 text-sm"
                  >
                    <span className="text-muted-foreground mr-2">{idx + 1}.</span>
                    <span className="truncate">{msg.text}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      ({msg.mode} mode)
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-4 py-3 bg-muted/20 border-t">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Discard Queue
          </Button>
          <Button size="sm" onClick={onProceed}>
            Continue Queue
          </Button>
        </div>
      </div>
    </div>
  );
}

// Replay failure dialog component
function ReplayFailureDialog({
  failure,
  onForkFromStep,
  onCancel,
}: {
  failure: ReplayFailure;
  onForkFromStep: (stepNumber: number) => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border-b">
          <AlertCircle className="h-5 w-5 text-amber-600" />
          <h3 className="font-semibold text-amber-600">Replay Failed</h3>
          <button
            onClick={onCancel}
            className="ml-auto p-1 hover:bg-amber-500/10 rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Replay failed at step {failure.failedAtStep} of {failure.totalSteps}:
          </p>
          <div className="bg-muted/50 rounded p-3 text-sm font-mono">
            {failure.errorMessage}
          </div>

          <p className="text-sm text-muted-foreground">
            You can continue from the last successful step ({failure.failedAtStep - 1})
            or dismiss this dialog to manually handle the situation.
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-4 py-3 bg-muted/20 border-t">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Dismiss
          </Button>
          {failure.failedAtStep > 1 && (
            <Button
              size="sm"
              onClick={() => onForkFromStep(failure.failedAtStep - 1)}
            >
              Continue from Step {failure.failedAtStep - 1}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TestAnalysisChatPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId: urlSessionId } = useParams<{ sessionId?: string }>();
  const {
    messages,
    sessionId,
    sessionStatus,
    currentSession,
    browserSession,
    mode,
    selectedLlm,
    headless,
    isGeneratingPlan,
    isExecuting,
    isStopping,
    isPlanPending,
    queueFailure,
    selectedStepId,
    isUndoing,
    undoTargetStep,
    totalSteps,
    sendMessage,
    approvePlan,
    rejectPlan,
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
    isRecording,
    currentRecordingMode,
    setMode,
    setSelectedLlm,
    setHeadless,
    setSelectedStepId,
    // Run Till End
    isRunningTillEnd,
    runTillEndPaused,
    skippedSteps,
    currentExecutingStepNumber,
    startRunTillEnd,
    skipFailedStep,
    continueRunTillEnd,
    // Stop AI execution
    stopAIExecution,
    // Existing session
    isLoading,
    isReplaying,
    replayFailure,
    loadExistingSession,
    replaySession,
    forkFromStep,
    clearReplayFailure,
    // Plan editing
    isEditingPlan,
    editingPlanData,
    openPlanEditor,
    closePlanEditor,
    savePlanEdits,
    regeneratePlan,
    // Session runs (Execute tab)
    sessionRuns,
    selectedRunId,
    isStartingRun,
    toggleActionEnabled,
    toggleAutoGenerateText,
    startSessionRun,
    refreshSessionRuns,
    selectRun,
  } = useChatSession();

  // Fetch system settings to get the default model (only on mount, not when loading existing session)
  useEffect(() => {
    const fetchDefaultModel = async () => {
      // Skip if we're loading an existing session (the session has its own model)
      if (urlSessionId) return;

      try {
        const settings = await settingsApi.getSettings();
        if (settings.default_analysis_model) {
          setSelectedLlm(settings.default_analysis_model as LlmModel);
        }
      } catch (e) {
        console.error('Error fetching system settings:', e);
        // Keep the default model if fetch fails
      }
    };
    fetchDefaultModel();
  }, [urlSessionId, setSelectedLlm]);

  // Load existing session from URL parameter
  useEffect(() => {
    if (urlSessionId && urlSessionId !== sessionId) {
      loadExistingSession(urlSessionId);
    }
  }, [urlSessionId, sessionId, loadExistingSession]);

  // Update URL when a new session is created (user started from /test-analysis without a session ID)
  useEffect(() => {
    if (sessionId && !urlSessionId) {
      navigate(`/test-analysis/${sessionId}`, { replace: true });
    }
  }, [sessionId, urlSessionId, navigate]);

  // Handle reset navigation state - populate input with original prompt
  useEffect(() => {
    const state = location.state as { initialPrompt?: string; resetTimestamp?: number } | null;
    if (state?.initialPrompt) {
      setInitialInputValue(state.initialPrompt);
      // Clear the navigation state to prevent re-triggering on future navigations
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  // Handle recording mode navigation state - create recording session
  const [isInitializingRecording, setIsInitializingRecording] = useState(false);
  useEffect(() => {
    const initializeRecordingMode = async () => {
      const state = location.state as { mode?: 'ai' | 'record'; startUrl?: string } | null;
      if (state?.mode !== 'record' || !state?.startUrl || sessionId || isInitializingRecording || urlSessionId) {
        return;
      }

      setIsInitializingRecording(true);
      try {
        // Create session in recording mode (no plan generation)
        const newSession = await analysisApi.createRecordingSession(state.startUrl, selectedLlm);
        // Load the created session
        await loadExistingSession(newSession.id);
        // Navigate to the session URL and clear the state
        navigate(`/test-analysis/${newSession.id}`, { replace: true, state: {} });
        toast.success('Recording session started');
      } catch (e) {
        console.error('Error initializing recording mode:', e);
        toast.error(e instanceof Error ? e.message : 'Failed to start recording session');
        // Clear the state to prevent re-triggering
        navigate('/test-analysis', { replace: true, state: {} });
      } finally {
        setIsInitializingRecording(false);
      }
    };

    initializeRecordingMode();
  }, [location.state, sessionId, isInitializingRecording, urlSessionId, selectedLlm, loadExistingSession, navigate]);

  // Track previous isStopping state to detect when stop completes
  const wasStoppingRef = useRef(false);

  // Show toast when stop completes
  useEffect(() => {
    if (wasStoppingRef.current && !isStopping && sessionStatus === 'paused') {
      toast.success('Execution stopped successfully');
    }
    wasStoppingRef.current = isStopping;
  }, [isStopping, sessionStatus]);

  // Determine if "Generate Script" button should show
  const canGenerateScript = (sessionStatus === 'completed' || sessionStatus === 'stopped') &&
    messages.some(m => m.type === 'step');

  // Get session title
  const sessionTitle = currentSession?.title || 'Test Analysis';

  const [showSettings, setShowSettings] = useState(false);
  const [leftWidth, setLeftWidth] = useState(450);
  const [isResizing, setIsResizing] = useState(false);
  const [isInteractionEnabled, setIsInteractionEnabled] = useState(false);
  const [simpleMode, setSimpleMode] = useState(true);
  const [linkedScript, setLinkedScript] = useState<Pick<PlaywrightScript, 'id' | 'session_id'> | null>(null);
  const [stepToDelete, setStepToDelete] = useState<{ id: string; stepNumber: number } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [initialInputValue, setInitialInputValue] = useState<string | undefined>(undefined);
  const [pendingRunTillEnd, setPendingRunTillEnd] = useState(false); // Flag to start Run Till End after browser is ready

  // Handle reset button click - clears data and populates input with original prompt
  const handleReset = useCallback(async () => {
    // Get the browser session ID before reset (for navigating to about:blank)
    const browserSessionIdToReset = browserSession?.id;

    // Reset session in backend and get original prompt
    const originalPrompt = await resetSession();

    // Navigate the browser to about:blank if it exists
    if (browserSessionIdToReset) {
      try {
        await fetch(`${import.meta.env.VITE_API_URL}/browser/sessions/${browserSessionIdToReset}/navigate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          },
          body: JSON.stringify({ url: 'about:blank' }),
        });
      } catch (e) {
        console.error('Error navigating browser to about:blank:', e);
      }
    }

    setLinkedScript(null);
    // Navigate to base URL with the original prompt in state
    navigate('/test-analysis', {
      replace: true,
      state: { initialPrompt: originalPrompt, resetTimestamp: Date.now() }
    });
  }, [resetSession, navigate, browserSession?.id]);

  // Clear initial input value after it's been consumed by ChatInput
  const handleInitialValueConsumed = useCallback(() => {
    setInitialInputValue(undefined);
  }, []);

  // Effect to start Run Till End after browser becomes available
  useEffect(() => {
    if (pendingRunTillEnd && browserSession && !isReplaying) {
      // Browser is now ready, start Run Till End
      setPendingRunTillEnd(false);
      // Small delay to ensure WebSocket is connected
      setTimeout(() => {
        startRunTillEnd();
      }, 300);
    }
  }, [pendingRunTillEnd, browserSession, isReplaying, startRunTillEnd]);

  // Combined Re Run handler - initializes browser if needed, then runs all steps with skip support
  // Uses "Run Till End" for step execution which provides skip/undo options when a step fails
  const handleReRun = useCallback(async () => {
    if (browserSession) {
      // Browser is live - run all steps directly via WebSocket
      startRunTillEnd();
    } else {
      // Browser not live - initialize browser first (prepareOnly=true), then use Run Till End
      // This ensures we have skip support when steps fail
      setPendingRunTillEnd(true); // Set flag to trigger Run Till End when browser is ready
      await replaySession(false, true); // prepareOnly=true - just start browser
    }
  }, [browserSession, startRunTillEnd, replaySession]);

  // Check for existing script linked to this session
  useEffect(() => {
    const checkForLinkedScript = async () => {
      if (!sessionId) {
        setLinkedScript(null);
        return;
      }
      try {
        const scripts = await scriptsApi.listScripts();
        const existingScript = scripts.find(s => s.session_id === sessionId);
        setLinkedScript(existingScript || null);
      } catch (e) {
        console.error('Error checking for linked script:', e);
      }
    };
    checkForLinkedScript();
  }, [sessionId]);

  // Get selected step for screenshot display
  const selectedStep = messages
    .filter((m) => m.type === 'step')
    .map((m) => (m.type === 'step' ? m.step : null))
    .find((s) => s?.id === selectedStepId);

  const screenshotUrl = selectedStep?.screenshot_path
    ? getScreenshotUrl(selectedStep.screenshot_path)
    : null;

  // Handle page unload - end browser session
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (sessionId && browserSession) {
        navigator.sendBeacon(
          `${import.meta.env.VITE_API_URL}/api/analysis/sessions/${sessionId}/end-browser`
        );
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [sessionId, browserSession]);

  // Resizing handlers
  const startResizing = () => setIsResizing(true);
  const stopResizing = () => setIsResizing(false);

  const resize = (e: React.MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX - 64; // Account for sidebar
      if (newWidth > 300 && newWidth < 700) {
        setLeftWidth(newWidth);
      }
    }
  };

  // Loading text for timeline
  const loadingText = isLoading
    ? 'Loading session...'
    : isReplaying
      ? 'Replaying steps...'
      : isGeneratingPlan
        ? 'Generating test plan...'
        : isExecuting
          ? 'Executing test...'
          : '';

  // Can delete steps when not busy
  const canDeleteSteps = !isExecuting && !isRunningTillEnd && !isRecording;

  // Handle delete step request (opens confirmation dialog)
  const handleDeleteStepRequest = (stepId: string, stepNumber: number) => {
    setStepToDelete({ id: stepId, stepNumber });
  };

  // Confirm delete step
  const handleConfirmDelete = async () => {
    if (!stepToDelete) return;
    setIsDeleting(true);
    await deleteStep(stepToDelete.id);
    setIsDeleting(false);
    setStepToDelete(null);
  };

  // Cancel delete step
  const handleCancelDelete = () => {
    setStepToDelete(null);
  };

  // Handle action update (xpath, css_selector, text)
  const handleActionUpdate = async (
    _stepId: string,
    actionId: string,
    updates: { element_xpath?: string; css_selector?: string; text?: string }
  ) => {
    await analysisApi.updateAction(actionId, updates);
    // Refresh the session to get updated action data
    if (sessionId) {
      await loadExistingSession(sessionId);
    }
  };

  // Handle insert action (insert new action within a step)
  const handleInsertAction = async (
    stepId: string,
    actionIndex: number,
    actionName: string,
    params: Record<string, unknown>
  ) => {
    await analysisApi.insertAction(stepId, {
      action_index: actionIndex,
      action_name: actionName,
      action_params: params,
    });
    // Refresh the session to get updated action data
    if (sessionId) {
      await loadExistingSession(sessionId);
    }
  };

  // Handle insert step (insert new step with action)
  const handleInsertStep = async (
    _sessionIdParam: string,
    stepNumber: number,
    actionName: string,
    params: Record<string, unknown>
  ) => {
    if (!sessionId) return;
    await analysisApi.insertStep(sessionId, {
      step_number: stepNumber,
      action_name: actionName,
      action_params: params,
    });
    // Refresh the session to get updated step data
    await loadExistingSession(sessionId);
  };

  return (
    <div
      className={`flex h-[calc(100vh-3.5rem)] bg-background ${isResizing ? 'cursor-col-resize select-none' : ''
        }`}
      onMouseMove={resize}
      onMouseUp={stopResizing}
      onMouseLeave={stopResizing}
    >
      {/* Toast notifications */}
      <Toaster position="top-right" richColors />

      {/* Recording mode initialization overlay */}
      {isInitializingRecording && (
        <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50">
          <div className="text-center space-y-4 p-6 bg-background rounded-lg shadow-lg border">
            <Video className="h-10 w-10 mx-auto text-purple-600 animate-pulse" />
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-purple-600" />
            <div>
              <p className="font-medium">Starting Recording Session</p>
              <p className="text-sm text-muted-foreground mt-1">
                Navigating to URL and starting browser...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Left Panel - Chat */}
      <div
        className="flex flex-col border-r bg-background"
        style={{ width: `${leftWidth}px` }}
      >
        {/* Header */}
        <div className="flex flex-col px-4 py-3 border-b bg-muted/20 gap-2">
          {/* Row 1: Title, Status and Settings */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <h2 className="font-semibold text-sm line-clamp-1 leading-tight" title={sessionTitle}>
                {sessionTitle}
              </h2>
              {sessionStatus && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_COLORS[sessionStatus] || 'bg-gray-100 text-gray-700'}`}>
                  {getStatusIcon(sessionStatus)}
                  {STATUS_LABELS[sessionStatus] || sessionStatus}
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowSettings(!showSettings)}
              className="h-7 w-7 p-0"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Row 2: Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Stop Button - Stops AI execution, keeps browser alive */}
            {(isExecuting || isRunningTillEnd || isStopping) && (
              <Button
                size="sm"
                variant="outline"
                onClick={stopAIExecution}
                disabled={isStopping}
                className="h-7 text-xs border-amber-500 text-amber-600 hover:bg-amber-50 disabled:opacity-70"
              >
                {isStopping ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Stopping...
                  </>
                ) : (
                  <>
                    <Square className="h-3 w-3 mr-1" />
                    Stop
                  </>
                )}
              </Button>
            )}
            {(messages.length > 0 || sessionId) && !isExecuting && !isRunningTillEnd && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleReset}
                className="h-7 text-xs"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset
              </Button>
            )}
            {/* Re Run - combines "Run Till End" and "Re-initiate Browser" */}
            {totalSteps > 0 && !isExecuting && !isRunningTillEnd && !isReplaying && (
              <Button
                size="sm"
                variant="default"
                onClick={handleReRun}
                disabled={isReplaying}
                className="h-7 text-xs"
              >
                {isReplaying ? (
                  <>
                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3 mr-1" />
                    Re Run
                  </>
                )}
              </Button>
            )}
            {linkedScript ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`/scripts/${linkedScript.id}`)}
                className="h-7 text-xs"
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                Open Script
              </Button>
            ) : canGenerateScript && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const scriptId = await generateScript();
                  if (scriptId) {
                    // Refresh linked script after generation
                    try {
                      const scripts = await scriptsApi.listScripts();
                      const newScript = scripts.find(s => s.id === scriptId);
                      if (newScript) setLinkedScript(newScript);
                    } catch (e) {
                      console.error('Error fetching new script:', e);
                    }
                    navigate(`/scripts/${scriptId}`);
                  }
                }}
                className="h-7 text-xs"
              >
                <FileCode className="h-3 w-3 mr-1" />
                Generate Script
              </Button>
            )}
          </div>
        </div>

        {/* Settings Panel (collapsible) */}
        {showSettings && (
          <div className="px-4 py-3 border-b bg-muted/10 space-y-3">
            {/* LLM Selection */}
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <select
                value={selectedLlm}
                onChange={(e) => setSelectedLlm(e.target.value as LlmModel)}
                disabled={isExecuting || isGeneratingPlan}
                className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
              >
                {LLM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Browser Mode Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Browser:</span>
              <div className="inline-flex rounded-lg border bg-muted p-0.5">
                <button
                  type="button"
                  onClick={() => setHeadless(true)}
                  disabled={isExecuting || isGeneratingPlan}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${headless
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                    } disabled:opacity-50`}
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  Headless
                </button>
                <button
                  type="button"
                  onClick={() => setHeadless(false)}
                  disabled={isExecuting || isGeneratingPlan}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${!headless
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                    } disabled:opacity-50`}
                >
                  <Monitor className="h-3.5 w-3.5" />
                  Live
                </button>
              </div>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">View:</span>
              <div className="inline-flex rounded-lg border bg-muted p-0.5">
                <button
                  type="button"
                  onClick={() => setSimpleMode(false)}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${!simpleMode
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                  <LayoutList className="h-3.5 w-3.5" />
                  Detailed
                </button>
                <button
                  type="button"
                  onClick={() => setSimpleMode(true)}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${simpleMode
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                  <List className="h-3.5 w-3.5" />
                  Simple
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Chat Timeline */}
        <ChatTimeline
          messages={messages}
          isLoading={isLoading || isReplaying || isGeneratingPlan || (isExecuting && messages.filter(m => m.type === 'step').length === 0)}
          loadingText={loadingText}
          onApprove={approvePlan}
          onReject={rejectPlan}
          onEditPlan={openPlanEditor}
          onStepSelect={setSelectedStepId}
          selectedStepId={selectedStepId}
          onUndoToStep={undoToStep}
          totalSteps={totalSteps}
          simpleMode={simpleMode}
          runTillEndPaused={runTillEndPaused}
          skippedSteps={skippedSteps}
          onSkipStep={skipFailedStep}
          onContinueRunTillEnd={continueRunTillEnd}
          currentExecutingStepNumber={currentExecutingStepNumber}
          onDeleteStep={handleDeleteStepRequest}
          canDeleteSteps={canDeleteSteps}
          sessionStatus={sessionStatus ?? undefined}
          onActionUpdate={handleActionUpdate}
          onToggleActionEnabled={toggleActionEnabled}
          onToggleAutoGenerate={toggleAutoGenerateText}
          onInsertAction={handleInsertAction}
          onInsertStep={handleInsertStep}
          sessionId={sessionId ?? undefined}
        />

        {/* Chat Input */}
        <ChatInput
          onSend={sendMessage}
          mode={mode}
          onModeChange={setMode}
          disabled={isLoading || isReplaying || isGeneratingPlan || isPlanPending || isRunningTillEnd}
          isExecuting={isExecuting}
          placeholder={
            isRunningTillEnd
              ? 'Running all steps... Please wait.'
              : isExecuting
                ? 'Send additional instructions...'
                : mode === 'plan'
                  ? 'Describe your test case...'
                  : 'Describe what you want to do...'
          }
          initialValue={initialInputValue}
          onInitialValueConsumed={handleInitialValueConsumed}
        />
      </div>

      {/* Resizer */}
      <div
        className={`w-1 cursor-col-resize hover:bg-primary/50 transition-colors ${isResizing ? 'bg-primary' : 'bg-transparent'
          }`}
        onMouseDown={startResizing}
      />

      {/* Right Panel - Browser View with Tabs */}
      <div className="flex-1 flex flex-col bg-muted/10">
        <BrowserPanel
          sessionId={sessionId}
          browserSession={browserSession}
          headless={headless}
          isExecuting={isExecuting}
          isWaitingForBrowser={sessionStatus === 'recording_ready' && !browserSession && !headless}
          screenshotUrl={screenshotUrl}
          selectedStepUrl={selectedStep?.url ?? undefined}
          messagesCount={messages.length}
          isRecording={isRecording}
          currentRecordingMode={currentRecordingMode}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          canRecord={!!sessionId && !!browserSession?.id && !isExecuting}
          isInteractionEnabled={isInteractionEnabled}
          onToggleInteraction={() => setIsInteractionEnabled(!isInteractionEnabled)}
          onEndBrowserSession={endBrowserSession}
          sessionRuns={sessionRuns}
          selectedRunId={selectedRunId}
          onSelectRun={selectRun}
          onStartSessionRun={startSessionRun}
          onRefreshRuns={refreshSessionRuns}
          isStartingRun={isStartingRun}
          className="flex-1"
        />
      </div>

      {/* Queue Failure Dialog */}
      {queueFailure && (
        <QueueFailureDialog
          failure={queueFailure}
          onProceed={processRemainingQueue}
          onCancel={clearQueueAndProceed}
        />
      )}

      {/* Plan Edit Modal */}
      {isEditingPlan && editingPlanData && (
        <PlanEditModal
          isOpen={isEditingPlan}
          planId={editingPlanData.planId}
          planText={editingPlanData.planText}
          planSteps={editingPlanData.planSteps}
          onClose={closePlanEditor}
          onSave={savePlanEdits}
          onRegenerate={regeneratePlan}
        />
      )}

      {/* Undo Confirmation Dialog */}
      {undoTargetStep !== null && (
        <UndoConfirmDialog
          targetStepNumber={undoTargetStep}
          totalSteps={totalSteps}
          isLoading={isUndoing}
          onConfirm={confirmUndo}
          onCancel={cancelUndo}
        />
      )}

      {/* Delete Step Confirmation Dialog */}
      {stepToDelete !== null && (
        <DeleteStepDialog
          stepNumber={stepToDelete.stepNumber}
          isLoading={isDeleting}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}

      {/* Replay Failure Dialog */}
      {replayFailure && (
        <ReplayFailureDialog
          failure={replayFailure}
          onForkFromStep={forkFromStep}
          onCancel={clearReplayFailure}
        />
      )}
    </div>
  );
}
