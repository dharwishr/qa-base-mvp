import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RotateCcw,
  Square,
  Settings2,
  Bot,
  Monitor,
  EyeOff,
  Play,
  Plus,
  X,
  FileCode,
  CheckCircle,
  Loader2,
  Zap,
  FileText,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import BenchmarkModelPanel from '@/components/benchmark/BenchmarkModelPanel';
import { useBenchmarkSession } from '@/hooks/useBenchmarkSession';
import { scriptsApi } from '@/services/api';
import type { LlmModel } from '@/types/analysis';

const LLM_OPTIONS: { value: LlmModel; label: string }[] = [
  { value: 'browser-use-llm', label: 'Browser Use LLM' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash' },
  { value: 'gemini-3.0-pro', label: 'Gemini 3.0 Pro' },
  { value: 'gemini-2.5-computer-use', label: 'Gemini 2.5 Computer Use' },
];

export default function BenchmarkPage() {
  const navigate = useNavigate();
  const {
    benchmarkSession,
    benchmarkId,
    modelRunStates,
    selectedModels,
    headless,
    mode,
    isCreating,
    isRunning,
    error,
    setSelectedModels,
    setHeadless,
    setMode,
    createAndStartBenchmark,
    stopBenchmark,
    resetBenchmark,
    setSelectedStepId,
    approvePlan,
    rejectPlan,
    executeApprovedPlans,
    sendAction,
  } = useBenchmarkSession();

  const [prompt, setPrompt] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [showSettings, setShowSettings] = useState(true);
  const [generatingScriptFor, setGeneratingScriptFor] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    await createAndStartBenchmark(prompt.trim());
  };

  const handleAddModel = (model: LlmModel) => {
    if (selectedModels.length >= 3) return;
    if (selectedModels.includes(model)) return;
    setSelectedModels([...selectedModels, model]);
  };

  const handleRemoveModel = (model: LlmModel) => {
    setSelectedModels(selectedModels.filter((m) => m !== model));
  };

  const handleGenerateScript = async (modelRunId: string, testSessionId: string, modelName: string) => {
    setGeneratingScriptFor(modelRunId);
    try {
      const scriptName = `Benchmark: ${benchmarkSession?.title || 'Untitled'} - ${modelName}`;
      const script = await scriptsApi.createScript({
        session_id: testSessionId,
        name: scriptName,
        description: `Generated from benchmark comparison with ${modelName}`,
      });
      navigate(`/scripts/${script.id}`);
    } catch (e) {
      console.error('Error generating script:', e);
    } finally {
      setGeneratingScriptFor(null);
    }
  };

  const availableModels = LLM_OPTIONS.filter(
    (opt) => !selectedModels.includes(opt.value)
  );

  const hasStarted = benchmarkId !== null;
  const isComplete = benchmarkSession?.status === 'completed';
  const isPlanReady = benchmarkSession?.status === 'plan_ready';
  const hasApprovedRuns = Array.from(modelRunStates.values()).some(
    (s) => s.modelRun.status === 'approved'
  );

  const handleSendAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionInput.trim()) return;
    await sendAction(actionInput.trim());
    setActionInput('');
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] bg-background">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
        <div className="flex items-center gap-3">
          <h1 className="font-semibold text-lg">LLM Benchmark</h1>
          {benchmarkSession && (
            <span className="text-sm text-muted-foreground truncate max-w-md">
              {benchmarkSession.title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <Button
              size="sm"
              variant="destructive"
              onClick={stopBenchmark}
              className="h-8"
            >
              <Square className="h-3 w-3 mr-1" />
              Stop All
            </Button>
          )}
          {hasStarted && !isRunning && (
            <Button
              size="sm"
              variant="outline"
              onClick={resetBenchmark}
              className="h-8"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              New Benchmark
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowSettings(!showSettings)}
            className="h-8 w-8 p-0"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Settings Panel (collapsible) - Only show before starting */}
      {showSettings && !hasStarted && (
        <div className="px-4 py-4 border-b bg-muted/10 space-y-4">
          {/* Model Selection */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Select Models (up to 3)</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedModels.map((model) => {
                const opt = LLM_OPTIONS.find((o) => o.value === model);
                return (
                  <div
                    key={model}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-sm"
                  >
                    {opt?.label || model}
                    <button
                      onClick={() => handleRemoveModel(model)}
                      className="hover:bg-primary/20 rounded p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
              {selectedModels.length < 3 && availableModels.length > 0 && (
                <div className="relative">
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        handleAddModel(e.target.value as LlmModel);
                        e.target.value = '';
                      }
                    }}
                    className="h-8 pl-8 pr-3 rounded-lg border bg-background text-sm appearance-none cursor-pointer"
                  >
                    <option value="">Add model...</option>
                    {availableModels.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <Plus className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              )}
            </div>
          </div>

          {/* Execution Mode Toggle */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Mode:</span>
              <div className="inline-flex rounded-lg border bg-muted p-0.5">
                <button
                  type="button"
                  onClick={() => setMode('auto')}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    mode === 'auto'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Zap className="h-3.5 w-3.5" />
                  Auto
                </button>
                <button
                  type="button"
                  onClick={() => setMode('plan')}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    mode === 'plan'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Plan
                </button>
                <button
                  type="button"
                  onClick={() => setMode('act')}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    mode === 'act'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Send className="h-3.5 w-3.5" />
                  Act
                </button>
              </div>
            </div>

            {/* Browser Mode Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Browser:</span>
              <div className="inline-flex rounded-lg border bg-muted p-0.5">
                <button
                  type="button"
                  onClick={() => setHeadless(true)}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    headless
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  Headless
                </button>
                <button
                  type="button"
                  onClick={() => setHeadless(false)}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    !headless
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Monitor className="h-3.5 w-3.5" />
                  Live
                </button>
              </div>
            </div>
          </div>

          {/* Prompt Input */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                mode === 'act'
                  ? 'Describe the initial context or starting URL for interactive testing...'
                  : 'Describe your test case to benchmark across models...'
              }
              rows={3}
              className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {mode === 'auto' && 'Auto mode: Generate plan, auto-approve, and execute in parallel'}
                {mode === 'plan' && 'Plan mode: Generate plans first, approve/reject, then execute'}
                {mode === 'act' && 'Act mode: Send actions interactively to all models in parallel'}
              </p>
              <Button
                type="submit"
                disabled={isCreating || !prompt.trim() || selectedModels.length === 0}
                className="h-9"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    {mode === 'act' ? 'Start Act Mode' : mode === 'plan' ? 'Generate Plans' : 'Start Benchmark'}
                  </>
                )}
              </Button>
            </div>
          </form>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Model Panels - Grid layout based on number of models */}
      {hasStarted && (
        <div className="flex-1 p-4 overflow-hidden">
          <div
            className={`grid h-full gap-4 ${
              modelRunStates.size === 1
                ? 'grid-cols-1'
                : modelRunStates.size === 2
                ? 'grid-cols-2'
                : 'grid-cols-3'
            }`}
          >
            {Array.from(modelRunStates.values()).map((state) => (
              <div key={state.modelRun.id} className="flex flex-col min-h-0">
                <BenchmarkModelPanel
                  modelRunState={state}
                  headless={headless}
                  onStepSelect={setSelectedStepId}
                  onApprovePlan={mode === 'plan' ? approvePlan : undefined}
                  onRejectPlan={mode === 'plan' ? rejectPlan : undefined}
                />
                {/* Generate Script Button - Only show when completed with steps */}
                {state.modelRun.status === 'completed' &&
                  state.modelRun.test_session_id &&
                  state.steps.length > 0 && (
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          handleGenerateScript(
                            state.modelRun.id,
                            state.modelRun.test_session_id!,
                            state.modelRun.llm_model
                          )
                        }
                        disabled={generatingScriptFor === state.modelRun.id}
                        className="h-7 text-xs"
                      >
                        {generatingScriptFor === state.modelRun.id ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <FileCode className="h-3 w-3 mr-1" />
                            Save as Script
                          </>
                        )}
                      </Button>
                    </div>
                  )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state when not started */}
      {!hasStarted && !showSettings && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <Bot className="h-16 w-16 mx-auto mb-4 opacity-30" />
            <h3 className="font-medium text-foreground mb-2">LLM Benchmark Mode</h3>
            <p className="text-sm max-w-md mx-auto">
              Compare up to 3 LLM models side-by-side on the same test case.
              <br />
              Click the settings icon to configure and start a benchmark.
            </p>
          </div>
        </div>
      )}

      {/* Plan Mode: Execute approved plans button */}
      {isPlanReady && hasApprovedRuns && (
        <div className="px-4 py-3 border-t bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium">Plans Ready</span>
              <span className="text-xs text-muted-foreground">
                {Array.from(modelRunStates.values()).filter(s => s.modelRun.status === 'approved').length} approved,{' '}
                {Array.from(modelRunStates.values()).filter(s => s.modelRun.status === 'plan_ready').length} pending
              </span>
            </div>
            <Button
              size="sm"
              onClick={executeApprovedPlans}
              disabled={!hasApprovedRuns}
              className="h-8"
            >
              <Play className="h-3 w-3 mr-1" />
              Execute Approved Plans
            </Button>
          </div>
        </div>
      )}

      {/* Act Mode: Action input bar */}
      {hasStarted && benchmarkSession?.mode === 'act' && !isComplete && (
        <div className="px-4 py-3 border-t bg-muted/20">
          <form onSubmit={handleSendAction} className="flex items-center gap-3">
            <div className="flex-1">
              <input
                type="text"
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                placeholder="Type an action to execute on all models..."
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <Button type="submit" size="sm" disabled={!actionInput.trim()} className="h-9">
              <Send className="h-4 w-4 mr-1" />
              Send
            </Button>
          </form>
        </div>
      )}

      {/* Summary when complete */}
      {isComplete && (
        <div className="px-4 py-3 border-t bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium">Benchmark Complete</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {Array.from(modelRunStates.values()).map((state) => (
                <span key={state.modelRun.id} className="flex items-center gap-1">
                  <span className="font-medium">{state.modelRun.llm_model}:</span>
                  <span>
                    {state.modelRun.total_steps} steps in{' '}
                    {state.modelRun.duration_seconds.toFixed(1)}s
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
