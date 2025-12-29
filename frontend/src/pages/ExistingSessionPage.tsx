import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Square, Settings2, Bot, Monitor, EyeOff, ArrowLeft, FileCode, List, LayoutList, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ChatTimeline from '@/components/chat/ChatTimeline';
import ChatInput from '@/components/chat/ChatInput';
import LiveBrowserView from '@/components/LiveBrowserView';
import UndoConfirmDialog from '@/components/analysis/UndoConfirmDialog';
import ReplayFailureDialog from '@/components/analysis/ReplayFailureDialog';
import { useExistingSession } from '@/hooks/useExistingSession';
import { getScreenshotUrl, scriptsApi } from '@/services/api';
import type { LlmModel } from '@/types/analysis';
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

export default function ExistingSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const {
    messages,
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
    isGeneratingPlan,
    selectedStepId,
    totalSteps,
    replayFailure,
    isRecording,
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
    startRecording,
    stopRecording,
    setMode,
    setSelectedLlm,
    setHeadless,
    setSelectedStepId,
  } = useExistingSession();

  const [showSettings, setShowSettings] = useState(false);
  const [leftWidth, setLeftWidth] = useState(450);
  const [isResizing, setIsResizing] = useState(false);
  const [undoTargetStep, setUndoTargetStep] = useState<number | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  const [simpleMode, setSimpleMode] = useState(false);
  const [linkedScript, setLinkedScript] = useState<Pick<PlaywrightScript, 'id' | 'session_id'> | null>(null);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isInteractionEnabled, setIsInteractionEnabled] = useState(false);

  // Load session on mount
  useEffect(() => {
    if (sessionId) {
      loadSession(sessionId);
    }
  }, [sessionId, loadSession]);

  // Check for existing script linked to this session
  useEffect(() => {
    const checkForLinkedScript = async () => {
      if (!sessionId) return;
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

  // Determine if "Generate Script" button should show
  const canGenerateScript = sessionStatus === 'completed' &&
    messages.some(m => m.type === 'step');

  // Get session title
  const sessionTitle = currentSession?.title || 'Test Analysis';

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
      const newWidth = e.clientX - 64;
      if (newWidth > 300 && newWidth < 700) {
        setLeftWidth(newWidth);
      }
    }
  };

  // Undo handlers
  const handleUndoToStep = (targetStepNumber: number) => {
    setUndoTargetStep(targetStepNumber);
  };

  const confirmUndo = async () => {
    if (undoTargetStep === null) return;
    setIsUndoing(true);
    try {
      await undoToStep(undoTargetStep);
    } finally {
      setIsUndoing(false);
      setUndoTargetStep(null);
    }
  };

  const cancelUndo = () => {
    setUndoTargetStep(null);
  };

  // Loading text for timeline
  const loadingText = isReplaying
    ? `Starting browser and replaying ${totalSteps} step${totalSteps !== 1 ? 's' : ''}...`
    : isGeneratingPlan
      ? 'Processing request...'
      : isExecuting
        ? 'Executing test...'
        : '';

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading session...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-[calc(100vh-3.5rem)] bg-background ${isResizing ? 'cursor-col-resize select-none' : ''}`}
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
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/test-cases')}
              className="p-1 hover:bg-muted rounded transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h2 className="font-semibold text-sm truncate max-w-[180px]" title={sessionTitle}>
              {sessionTitle}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {isExecuting && (
              <Button
                size="sm"
                variant="destructive"
                onClick={stopExecution}
                className="h-7 text-xs"
              >
                <Square className="h-3 w-3 mr-1" />
                Stop
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
                disabled={isGeneratingScript}
                onClick={async () => {
                  if (!currentSession) return;
                  setIsGeneratingScript(true);
                  try {
                    const scriptName = currentSession.title ||
                      currentSession.prompt?.slice(0, 50) ||
                      `Test Script ${new Date().toISOString()}`;
                    const script = await scriptsApi.createScript({
                      session_id: currentSession.id,
                      name: scriptName,
                      description: `Generated from test analysis session`,
                    });
                    if (script) {
                      setLinkedScript(script);
                      navigate(`/scripts/${script.id}`);
                    }
                  } finally {
                    setIsGeneratingScript(false);
                  }
                }}
                className="h-7 text-xs"
              >
                <FileCode className="h-3 w-3 mr-1" />
                {isGeneratingScript ? 'Generating...' : 'Generate Script'}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowSettings(!showSettings)}
              className="h-7 w-7 p-0"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
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
                disabled={isExecuting || isReplaying}
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
                  disabled={isExecuting || isReplaying}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    headless
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
                  disabled={isExecuting || isReplaying}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    !headless
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
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    !simpleMode
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
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    simpleMode
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
          isLoading={isReplaying || isGeneratingPlan || (isExecuting && messages.filter(m => m.type === 'step').length === 0)}
          loadingText={loadingText}
          onApprove={approvePlan}
          onReject={rejectPlan}
          onStepSelect={setSelectedStepId}
          selectedStepId={selectedStepId}
          onUndoToStep={handleUndoToStep}
          totalSteps={totalSteps}
          simpleMode={simpleMode}
        />

        {/* Chat Input with Re-initiate Button */}
        <div className="border-t bg-background">
          {/* Re-initiate Session Button */}
          {!browserSession && !isExecuting && !isReplaying && totalSteps > 0 && (
            <div className="px-4 pt-3 space-y-2">
              <Button
                onClick={() => replaySession(false)}
                disabled={isReplaying}
                className="w-full"
                variant="secondary"
              >
                <Monitor className="h-4 w-4 mr-2" />
                Re-initiate Browser
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Replay {totalSteps} steps, then continue testing
              </p>
            </div>
          )}
          
          <ChatInput
            onSend={sendMessage}
            mode={mode}
            onModeChange={setMode}
            disabled={isReplaying || isPlanPending || isGeneratingPlan}
            isExecuting={isExecuting}
            placeholder={
              isGeneratingPlan
                ? 'Processing your request...'
                : isExecuting
                  ? 'Send additional instructions...'
                  : !browserSession
                    ? 'Re-initiate session to interact with the browser...'
                    : mode === 'plan'
                      ? 'Describe your test case...'
                      : 'Describe what you want to do...'
            }
          />
        </div>
      </div>

      {/* Resizer */}
      <div
        className={`w-1 cursor-col-resize hover:bg-primary/50 transition-colors ${
          isResizing ? 'bg-primary' : 'bg-transparent'
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
        ) : !headless && isReplaying ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin h-10 w-10 border-3 border-primary border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-base font-medium text-foreground mb-1">
                Starting Browser
              </p>
              <p className="text-sm text-muted-foreground">
                Replaying {totalSteps} step{totalSteps !== 1 ? 's' : ''}...
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                This may take a moment
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
                          ? 'Loading session...'
                          : totalSteps === 0
                            ? 'No steps recorded in this session'
                            : 'Select a step to view its screenshot'}
                      </p>
                      {totalSteps > 0 && !browserSession && (
                        <Button
                          onClick={() => replaySession(false)}
                          disabled={isReplaying}
                          variant="outline"
                          className="mt-4"
                        >
                          <Monitor className="h-4 w-4 mr-2" />
                          Re-initiate Browser
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Replay Failure Dialog */}
      {replayFailure && (
        <ReplayFailureDialog
          failedAtStep={replayFailure.failedAtStep}
          totalSteps={replayFailure.totalSteps}
          errorMessage={replayFailure.errorMessage}
          onFork={forkFromStep}
          onUndo={(stepNumber) => {
            clearReplayFailure();
            undoToStep(stepNumber);
          }}
          onCancel={clearReplayFailure}
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
    </div>
  );
}
