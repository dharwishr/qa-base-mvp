import { useEffect, useState } from 'react';
import { RotateCcw, Square, Settings2, Bot, Monitor, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ChatTimeline from '@/components/chat/ChatTimeline';
import ChatInput from '@/components/chat/ChatInput';
import LiveBrowserView from '@/components/LiveBrowserView';
import { useChatSession } from '@/hooks/useChatSession';
import { getScreenshotUrl } from '@/services/api';
import type { LlmModel } from '@/types/analysis';

const LLM_OPTIONS: { value: LlmModel; label: string }[] = [
  { value: 'browser-use-llm', label: 'Browser Use LLM' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash' },
  { value: 'gemini-3.0-pro', label: 'Gemini 3.0 Pro' },
  { value: 'gemini-2.5-computer-use', label: 'Gemini 2.5 Computer Use' },
];

export default function TestAnalysisChatPage() {
  const {
    messages,
    sessionId,
    currentSession,
    browserSession,
    mode,
    selectedLlm,
    headless,
    isGeneratingPlan,
    isExecuting,
    isPlanPending,
    selectedStepId,
    sendMessage,
    approvePlan,
    rejectPlan,
    stopExecution,
    resetSession,
    endBrowserSession,
    setMode,
    setSelectedLlm,
    setHeadless,
    setSelectedStepId,
  } = useChatSession();

  // Get session title
  const sessionTitle = currentSession?.title || 'Test Analysis';

  const [showSettings, setShowSettings] = useState(false);
  const [leftWidth, setLeftWidth] = useState(450);
  const [isResizing, setIsResizing] = useState(false);

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
  const loadingText = isGeneratingPlan
    ? 'Generating test plan...'
    : isExecuting
    ? 'Executing test...'
    : '';

  return (
    <div
      className={`flex h-[calc(100vh-3.5rem)] bg-background ${
        isResizing ? 'cursor-col-resize select-none' : ''
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
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
          <h2 className="font-semibold text-sm truncate max-w-[200px]" title={sessionTitle}>
            {sessionTitle}
          </h2>
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
            {(messages.length > 0 || sessionId) && !isExecuting && (
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
                  disabled={isExecuting || isGeneratingPlan}
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
          </div>
        )}

        {/* Chat Timeline */}
        <ChatTimeline
          messages={messages}
          isLoading={isGeneratingPlan || (isExecuting && messages.filter(m => m.type === 'step').length === 0)}
          loadingText={loadingText}
          onApprove={approvePlan}
          onReject={rejectPlan}
          onStepSelect={setSelectedStepId}
          selectedStepId={selectedStepId}
        />

        {/* Chat Input */}
        <ChatInput
          onSend={sendMessage}
          mode={mode}
          onModeChange={setMode}
          disabled={isGeneratingPlan || isPlanPending}
          isExecuting={isExecuting}
          placeholder={
            isExecuting
              ? 'Send additional instructions...'
              : mode === 'plan'
              ? 'Describe your test case...'
              : 'Describe what you want to do...'
          }
        />
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
    </div>
  );
}
