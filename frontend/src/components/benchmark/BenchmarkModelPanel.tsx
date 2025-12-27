import { Monitor, CheckCircle, XCircle, Loader2, Clock, Check, X, FileText } from 'lucide-react';
import ChatTimeline from '@/components/chat/ChatTimeline';
import LiveBrowserView from '@/components/LiveBrowserView';
import { getScreenshotUrl } from '@/services/api';
import { Button } from '@/components/ui/button';
import type { ModelRunState } from '@/hooks/useBenchmarkSession';
import type { LlmModel } from '@/types/analysis';

interface BenchmarkModelPanelProps {
  modelRunState: ModelRunState;
  headless: boolean;
  onStepSelect: (modelRunId: string, stepId: string | null) => void;
  onApprovePlan?: (modelRunId: string) => void;
  onRejectPlan?: (modelRunId: string) => void;
}

const MODEL_LABELS: Record<LlmModel, string> = {
  'browser-use-llm': 'Browser Use LLM',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-3.0-flash': 'Gemini 3.0 Flash',
  'gemini-3.0-pro': 'Gemini 3.0 Pro',
  'gemini-2.5-computer-use': 'Gemini 2.5 Computer Use',
};

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
          <Clock className="h-3 w-3" />
          Pending
        </span>
      );
    case 'planning':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800">
          <Loader2 className="h-3 w-3 animate-spin" />
          Planning
        </span>
      );
    case 'plan_ready':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-orange-100 text-orange-800">
          <FileText className="h-3 w-3" />
          Plan Ready
        </span>
      );
    case 'approved':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800">
          <Check className="h-3 w-3" />
          Approved
        </span>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-800">
          <X className="h-3 w-3" />
          Rejected
        </span>
      );
    case 'queued':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800">
          <Clock className="h-3 w-3" />
          Queued
        </span>
      );
    case 'running':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800">
          <CheckCircle className="h-3 w-3" />
          Completed
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-800">
          <XCircle className="h-3 w-3" />
          Failed
        </span>
      );
    default:
      return null;
  }
}

export default function BenchmarkModelPanel({
  modelRunState,
  headless,
  onStepSelect,
  onApprovePlan,
  onRejectPlan,
}: BenchmarkModelPanelProps) {
  const { modelRun, messages, steps, plan, browserSession, selectedStepId } = modelRunState;
  const isPlanReady = modelRun.status === 'plan_ready';
  const llmModel = modelRun.llm_model as LlmModel;
  const modelLabel = MODEL_LABELS[llmModel] || llmModel;

  // Get selected step for screenshot display
  const selectedStep = steps.find((s) => s.id === selectedStepId);
  const screenshotUrl = selectedStep?.screenshot_path
    ? getScreenshotUrl(selectedStep.screenshot_path)
    : null;

  const isLoading = modelRun.status === 'running' && steps.length === 0;

  return (
    <div className="flex flex-col h-full border rounded-lg bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm truncate">{modelLabel}</h3>
          <StatusBadge status={modelRun.status} />
        </div>
        <div className="flex items-center gap-2">
          {/* Approve/Reject buttons for Plan mode */}
          {isPlanReady && onApprovePlan && onRejectPlan && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onApprovePlan(modelRun.id)}
                className="h-6 px-2 text-xs"
              >
                <Check className="h-3 w-3 mr-1 text-green-600" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRejectPlan(modelRun.id)}
                className="h-6 px-2 text-xs"
              >
                <X className="h-3 w-3 mr-1 text-red-600" />
                Reject
              </Button>
            </>
          )}
          {modelRun.status === 'completed' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{modelRun.total_steps} steps</span>
              <span>•</span>
              <span>{modelRun.duration_seconds.toFixed(1)}s</span>
            </div>
          )}
        </div>
      </div>

      {/* Plan display for Plan mode */}
      {isPlanReady && plan && (
        <div className="px-4 py-2 border-b bg-orange-50/50 max-h-24 overflow-y-auto">
          <div className="text-xs font-medium text-orange-800 mb-1">Generated Plan:</div>
          <div className="text-xs text-muted-foreground whitespace-pre-wrap">{plan.plan_text}</div>
        </div>
      )}

      {/* Content - Split view */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Chat Timeline */}
        <div className="w-1/2 flex flex-col border-r min-h-0">
          <ChatTimeline
            messages={messages}
            isLoading={isLoading}
            loadingText="Executing..."
            onStepSelect={(stepId) => onStepSelect(modelRun.id, stepId)}
            selectedStepId={selectedStepId}
          />
        </div>

        {/* Right: Browser View */}
        <div className="w-1/2 flex flex-col bg-muted/10 min-h-0">
          {!headless && browserSession?.browserSessionId ? (
            <LiveBrowserView
              sessionId={browserSession.browserSessionId}
              liveViewUrl={browserSession.liveViewUrl}
              novncUrl={browserSession.novncUrl}
              className="flex-1 m-2"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="w-full max-w-md mx-auto">
                {/* Browser chrome */}
                <div className="bg-muted/50 rounded-t-lg border border-b-0 p-2 flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-red-400" />
                    <div className="w-2 h-2 rounded-full bg-yellow-400" />
                    <div className="w-2 h-2 rounded-full bg-green-400" />
                  </div>
                  <div className="flex-1 bg-background rounded px-2 py-0.5 text-xs text-muted-foreground truncate">
                    {selectedStep?.url || 'https://example.com'}
                  </div>
                </div>

                {/* Content area */}
                <div className="border rounded-b-lg bg-background min-h-[200px] flex items-center justify-center relative overflow-hidden">
                  {screenshotUrl ? (
                    <img
                      src={screenshotUrl}
                      alt="Screenshot"
                      className="max-w-full max-h-[300px] object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="text-center text-muted-foreground p-4">
                      <Monitor className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-xs font-medium">Browser Preview</p>
                      <p className="text-xs mt-1">
                        {modelRun.status === 'pending' || modelRun.status === 'queued'
                          ? 'Waiting to start...'
                          : steps.length === 0
                          ? 'Starting browser...'
                          : 'Select a step to view'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
