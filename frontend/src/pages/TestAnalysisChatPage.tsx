import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RotateCcw, Square, Settings2, Bot, Monitor, EyeOff, AlertCircle, X, FileCode, List, LayoutList, ExternalLink, Play, Pause, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ChatTimeline from '@/components/chat/ChatTimeline';
import ChatInput from '@/components/chat/ChatInput';
import LiveBrowserView from '@/components/LiveBrowserView';
import UndoConfirmDialog from '@/components/analysis/UndoConfirmDialog';
import DeleteStepDialog from '@/components/analysis/DeleteStepDialog';
import { useChatSession, type ReplayFailure } from '@/hooks/useChatSession';
import { getScreenshotUrl, scriptsApi, analysisApi } from '@/services/api';
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
    // Pause/Stop
    pauseExecution,
    stopAll,
    // Existing session
    isLoading,
    isReplaying,
    replayFailure,
    loadExistingSession,
    replaySession,
    forkFromStep,
    clearReplayFailure,
  } = useChatSession();

  // Load existing session from URL parameter
  useEffect(() => {
    if (urlSessionId && urlSessionId !== sessionId) {
      loadExistingSession(urlSessionId);
    }
  }, [urlSessionId, sessionId, loadExistingSession]);

  // Determine if "Generate Script" button should show
  const canGenerateScript = (sessionStatus === 'completed' || sessionStatus === 'stopped') &&
    messages.some(m => m.type === 'step');

  // Determine if "Re-initiate Browser" button should show
  const canReinitieBrowser = sessionStatus &&
    ['completed', 'failed', 'stopped'].includes(sessionStatus) &&
    totalSteps > 0 &&
    !browserSession &&
    !isReplaying;

  // Get session title
  const sessionTitle = currentSession?.title || 'Test Analysis';

  const [showSettings, setShowSettings] = useState(false);
  const [leftWidth, setLeftWidth] = useState(450);
  const [isResizing, setIsResizing] = useState(false);
  const [isInteractionEnabled, setIsInteractionEnabled] = useState(false);
  const [simpleMode, setSimpleMode] = useState(false);
  const [linkedScript, setLinkedScript] = useState<Pick<PlaywrightScript, 'id' | 'session_id'> | null>(null);
  const [stepToDelete, setStepToDelete] = useState<{ id: string; stepNumber: number } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

  return (
    <div
      className={`flex h-[calc(100vh-3.5rem)] bg-background ${isResizing ? 'cursor-col-resize select-none' : ''
        }`}
      onMouseMove={resize}
      onMouseUp={stopResizing}
      onMouseLeave={stopResizing}
    >
      {/* Left Panel - Chat */}
      <div
        className="flex flex-col border-r bg-background"
        style={{ width: `${leftWidth}px` }}
      >
        {/* Header */}
        <div className="flex flex-col px-4 py-3 border-b bg-muted/20 gap-2">
          {/* Row 1: Title and Settings */}
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm line-clamp-2 leading-tight" title={sessionTitle}>
              {sessionTitle}
            </h2>
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
            {/* Pause Button - Shows when AI is executing or Run Till End is active */}
            {(isExecuting || isRunningTillEnd) && (
              <Button
                size="sm"
                variant="outline"
                onClick={pauseExecution}
                className="h-7 text-xs border-amber-500 text-amber-600 hover:bg-amber-50"
              >
                <Pause className="h-3 w-3 mr-1" />
                Pause
              </Button>
            )}
            {/* Stop Button - Stops everything including browser */}
            {(isExecuting || isRunningTillEnd || browserSession) && (
              <Button
                size="sm"
                variant="destructive"
                onClick={stopAll}
                className="h-7 text-xs"
              >
                <Square className="h-3 w-3 mr-1" />
                Stop
              </Button>
            )}
            {(messages.length > 0 || sessionId) && !isExecuting && !isRunningTillEnd && (
              <Button
                size="sm"
                variant="outline"
                onClick={resetSession}
                className="h-7 text-xs"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset
              </Button>
            )}
            {totalSteps > 0 && !isExecuting && !isRunningTillEnd && browserSession && (
              <Button
                size="sm"
                variant="default"
                onClick={startRunTillEnd}
                className="h-7 text-xs"
              >
                <Play className="h-3 w-3 mr-1" />
                Run Till End
              </Button>
            )}
            {/* Re-initiate Browser - for completed/stopped sessions without active browser */}
            {canReinitieBrowser && (
              <Button
                size="sm"
                variant="default"
                onClick={() => replaySession(false)}
                disabled={isReplaying}
                className="h-7 text-xs"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${isReplaying ? 'animate-spin' : ''}`} />
                {isReplaying ? 'Starting...' : 'Re-initiate Browser'}
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
        />
      </div>

      {/* Resizer */}
      <div
        className={`w-1 cursor-col-resize hover:bg-primary/50 transition-colors ${isResizing ? 'bg-primary' : 'bg-transparent'
          }`}
        onMouseDown={startResizing}
      />

      {/* Right Panel - Browser View */}
      <div className="flex-1 flex flex-col bg-muted/10">
        {/* Browser View */}
        {!headless && browserSession ? (
          <LiveBrowserView
            sessionId={browserSession.id}
            liveViewUrl={browserSession.liveViewUrl}
            novncUrl={browserSession.novncUrl}
            onClose={endBrowserSession}
            onStopBrowser={endBrowserSession}
            className="flex-1 m-4"
            isRecording={isRecording}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
            canRecord={!!sessionId && !!browserSession?.id && !isExecuting}
            isAIExecuting={isExecuting}
            isInteractionEnabled={isInteractionEnabled}
            onToggleInteraction={() => setIsInteractionEnabled(!isInteractionEnabled)}
          />
        ) : !headless && isExecuting ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                Starting live browser...
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Browser mockup frame */}
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="w-full max-w-4xl mx-auto">
                {/* Browser chrome */}
                <div className="bg-muted/50 rounded-t-lg border border-b-0 p-2 flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-400" />
                    <div className="w-3 h-3 rounded-full bg-yellow-400" />
                    <div className="w-3 h-3 rounded-full bg-green-400" />
                  </div>
                  <div className="flex-1 bg-background rounded px-3 py-1 text-xs text-muted-foreground truncate">
                    {selectedStep?.url || 'https://example.com'}
                  </div>
                </div>

                {/* Content area */}
                <div className="border rounded-b-lg bg-background min-h-[400px] flex items-center justify-center relative overflow-hidden">
                  {screenshotUrl ? (
                    <img
                      src={screenshotUrl}
                      alt="Screenshot"
                      className="max-w-full max-h-[500px] object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="text-center text-muted-foreground">
                      <Monitor className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p className="font-medium">Browser Preview</p>
                      <p className="text-sm mt-1">
                        {messages.length === 0
                          ? 'Start a test to see browser activity'
                          : 'Select a step to view its screenshot'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Queue Failure Dialog */}
      {queueFailure && (
        <QueueFailureDialog
          failure={queueFailure}
          onProceed={processRemainingQueue}
          onCancel={clearQueueAndProceed}
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
