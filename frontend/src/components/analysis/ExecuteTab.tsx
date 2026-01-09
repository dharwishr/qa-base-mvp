import { useState, useEffect } from 'react';
import {
  Play,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Monitor,
  Camera,
  Video,
  Wifi,
  Gauge,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Zap,
  ArrowLeft,
  // Action type icons
  MousePointer,
  Type,
  Globe,
  ArrowUp,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { runsApi, getScreenshotUrl } from '@/services/api';
import type { TestRun, RunStep, StartRunRequest, BrowserType, Resolution } from '@/types/scripts';

interface ExecuteTabProps {
  sessionId: string | null;
  runs: TestRun[];
  selectedRunId: string | null;
  onSelectRun: (runId: string | null) => void;
  onStartRun: (config: StartRunRequest) => Promise<void>;
  onRefreshRuns: () => Promise<void>;
  isStartingRun: boolean;
  className?: string;
}

const BROWSERS: { value: BrowserType; label: string }[] = [
  { value: 'chromium', label: 'Chrome' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'webkit', label: 'Safari' },
  { value: 'edge', label: 'Edge' },
];

const RESOLUTIONS: { value: Resolution; label: string; dimensions: string }[] = [
  { value: '1920x1080', label: 'Full HD', dimensions: '1920 x 1080' },
  { value: '1366x768', label: 'HD', dimensions: '1366 x 768' },
  { value: '1600x900', label: 'WXGA+', dimensions: '1600 x 900' },
];

function formatDuration(ms: number | null): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
    pending: { icon: Clock, color: 'text-gray-500 bg-gray-100', label: 'Pending' },
    queued: { icon: Clock, color: 'text-gray-500 bg-gray-100', label: 'Queued' },
    running: { icon: Loader2, color: 'text-blue-500 bg-blue-100', label: 'Running' },
    passed: { icon: CheckCircle, color: 'text-green-500 bg-green-100', label: 'Passed' },
    failed: { icon: XCircle, color: 'text-red-500 bg-red-100', label: 'Failed' },
    healed: { icon: Zap, color: 'text-purple-500 bg-purple-100', label: 'Healed' },
  };

  const statusConfig = config[status] || config.pending;
  const Icon = statusConfig.icon;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusConfig.color}`}>
      <Icon className={`h-3 w-3 ${status === 'running' ? 'animate-spin' : ''}`} />
      {statusConfig.label}
    </span>
  );
}

// Action type to icon mapping
function getActionIcon(actionName: string) {
  const iconClass = "h-4 w-4";
  switch (actionName?.toLowerCase()) {
    case 'click':
      return <MousePointer className={`${iconClass} text-blue-500`} />;
    case 'fill':
      return <Type className={`${iconClass} text-green-500`} />;
    case 'goto':
      return <Globe className={`${iconClass} text-purple-500`} />;
    case 'scroll':
      return <ArrowUp className={`${iconClass} text-orange-500`} />;
    case 'wait':
      return <Clock className={`${iconClass} text-yellow-500`} />;
    case 'assert':
      return <Eye className={`${iconClass} text-cyan-500`} />;
    default:
      return <Play className={`${iconClass} text-gray-500`} />;
  }
}

// Masked value display for passwords
function MaskedValue({ value, isPassword }: { value: string | null; isPassword: boolean }) {
  const [revealed, setRevealed] = useState(false);
  if (!value) return null;

  if (isPassword && !revealed) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setRevealed(true); }}
        className="font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded text-xs border hover:bg-gray-200 dark:hover:bg-gray-700"
        title="Click to reveal"
      >
        {'*'.repeat(8)}
      </button>
    );
  }
  return (
    <span className="font-mono bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-xs border border-blue-200 dark:border-blue-800">
      "{value}"
    </span>
  );
}

// Expandable selector display
function ExpandableSelector({ xpath, css }: { xpath: string | null; css: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!xpath && !css) return null;

  return (
    <div className="mt-1">
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? 'Hide selectors' : 'Show selectors'}
      </button>
      {expanded && (
        <div className="mt-1 p-2 bg-muted/30 rounded space-y-1 text-xs">
          {xpath && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-medium w-10 flex-shrink-0">XPath</span>
              <code className="break-all bg-muted/50 px-1.5 py-0.5 rounded flex-1">{xpath}</code>
            </div>
          )}
          {css && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-medium w-10 flex-shrink-0">CSS</span>
              <code className="break-all bg-muted/50 px-1.5 py-0.5 rounded flex-1">{css}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Run Detail View - shows steps, screenshots, etc.
function RunDetailView({ run, onBack }: { run: TestRun; onBack: () => void }) {
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [isLoadingSteps, setIsLoadingSteps] = useState(false);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  // Local run state for real-time updates (merged with prop)
  const [localRun, setLocalRun] = useState<TestRun>(run);

  // Update local run when prop changes
  useEffect(() => {
    setLocalRun(run);
  }, [run]);

  // Fetch steps when run changes
  useEffect(() => {
    const fetchSteps = async () => {
      setIsLoadingSteps(true);
      try {
        const runSteps = await runsApi.getRunSteps(run.id);
        setSteps(runSteps);
        if (runSteps.length > 0) {
          setSelectedStepIndex(0);
        }
      } catch (error) {
        console.error('Failed to fetch run steps:', error);
      } finally {
        setIsLoadingSteps(false);
      }
    };

    fetchSteps();
  }, [run.id]);

  // Poll for updates if run is in progress
  useEffect(() => {
    if (localRun.status === 'running' || localRun.status === 'pending') {
      const interval = setInterval(async () => {
        try {
          // Fetch both steps and run status in parallel for responsive updates
          const [runSteps, updatedRun] = await Promise.all([
            runsApi.getRunSteps(run.id),
            runsApi.getRun(run.id),
          ]);
          setSteps(runSteps);
          setLocalRun(updatedRun);
        } catch {
          // Ignore errors during polling
        }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [run.id, localRun.status]);

  const selectedStep = selectedStepIndex !== null ? steps[selectedStepIndex] : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-8 px-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">Run {localRun.id.slice(0, 8)}</span>
              <StatusBadge status={localRun.status} />
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {localRun.browser_type} | {localRun.resolution_width}x{localRun.resolution_height}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-5 gap-2 mt-3">
          <div className="text-center p-2 bg-background rounded border">
            <div className="text-lg font-semibold">{localRun.total_steps || steps.length}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="text-center p-2 bg-green-50 rounded border border-green-200">
            <div className="text-lg font-semibold text-green-600">{localRun.passed_steps || 0}</div>
            <div className="text-xs text-green-600">Passed</div>
          </div>
          <div className="text-center p-2 bg-red-50 rounded border border-red-200">
            <div className="text-lg font-semibold text-red-600">{localRun.failed_steps || 0}</div>
            <div className="text-xs text-red-600">Failed</div>
          </div>
          <div className="text-center p-2 bg-purple-50 rounded border border-purple-200">
            <div className="text-lg font-semibold text-purple-600">{localRun.healed_steps || 0}</div>
            <div className="text-xs text-purple-600">Healed</div>
          </div>
          <div className="text-center p-2 bg-background rounded border">
            <div className="text-lg font-semibold">{formatDuration(localRun.duration_ms)}</div>
            <div className="text-xs text-muted-foreground">Duration</div>
          </div>
        </div>
      </div>

      {/* Steps List and Screenshot */}
      <div className="flex-1 flex overflow-hidden">
        {/* Steps List */}
        <div className="w-1/2 border-r overflow-y-auto">
          {isLoadingSteps ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : steps.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {localRun.status === 'running' ? 'Waiting for steps...' : 'No steps recorded'}
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {steps.map((step, idx) => (
                <button
                  key={step.id}
                  onClick={() => setSelectedStepIndex(idx)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-lg transition-colors',
                    selectedStepIndex === idx
                      ? 'bg-primary/10 border border-primary/30'
                      : 'hover:bg-muted/50'
                  )}
                >
                  <div className="flex items-center gap-2">
                    {/* Status icon */}
                    {step.status === 'passed' && <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />}
                    {step.status === 'failed' && <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                    {step.status === 'healed' && <Zap className="h-4 w-4 text-purple-500 flex-shrink-0" />}
                    {step.status === 'running' && <Loader2 className="h-4 w-4 text-blue-500 animate-spin flex-shrink-0" />}
                    {step.status === 'pending' && <Clock className="h-4 w-4 text-gray-400 flex-shrink-0" />}

                    {/* Action type icon */}
                    <div className="flex-shrink-0">
                      {getActionIcon(step.action)}
                    </div>

                    {/* Step content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{idx + 1}.</span>
                        <span className="text-sm truncate">{step.element_name || step.action}</span>
                        {step.action === 'fill' && step.input_value && (
                          <MaskedValue value={step.input_value} isPassword={step.is_password} />
                        )}
                      </div>
                      <ExpandableSelector xpath={step.element_xpath} css={step.css_selector} />
                    </div>

                    {/* Duration */}
                    {step.duration_ms && (
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {formatDuration(step.duration_ms)}
                      </span>
                    )}
                  </div>
                  {step.error_message && (
                    <div className="mt-1 text-xs text-red-600 truncate">
                      {step.error_message}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Screenshot Preview */}
        <div className="w-1/2 flex items-center justify-center p-4 bg-muted/20">
          {selectedStep?.screenshot_path ? (
            <img
              src={getScreenshotUrl(selectedStep.screenshot_path)}
              alt={`Step ${selectedStepIndex !== null ? selectedStepIndex + 1 : ''} screenshot`}
              className="max-w-full max-h-full object-contain rounded shadow"
            />
          ) : (
            <div className="text-center text-muted-foreground">
              <Camera className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">
                {selectedStep ? 'No screenshot available' : 'Select a step to view screenshot'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Error message */}
      {localRun.error_message && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-sm text-red-700">
          <strong>Error:</strong> {localRun.error_message}
        </div>
      )}
    </div>
  );
}

export default function ExecuteTab({
  sessionId,
  runs,
  selectedRunId,
  onSelectRun,
  onStartRun,
  onRefreshRuns,
  isStartingRun,
  className,
}: ExecuteTabProps) {
  // Run config state
  const [browserType, setBrowserType] = useState<BrowserType>('chromium');
  const [resolution, setResolution] = useState<Resolution>('1920x1080');
  const [screenshotsEnabled, setScreenshotsEnabled] = useState(true);
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [networkRecordingEnabled, setNetworkRecordingEnabled] = useState(false);
  const [performanceMetricsEnabled, setPerformanceMetricsEnabled] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const handleStartRun = async () => {
    await onStartRun({
      browser_type: browserType,
      resolution,
      screenshots_enabled: screenshotsEnabled,
      recording_enabled: recordingEnabled,
      network_recording_enabled: networkRecordingEnabled,
      performance_metrics_enabled: performanceMetricsEnabled,
    });
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefreshRuns();
    } finally {
      setIsRefreshing(false);
    }
  };

  // If a run is selected, show the detail view
  const selectedRun = runs.find(r => r.id === selectedRunId);
  if (selectedRun) {
    return (
      <div className={className}>
        <RunDetailView run={selectedRun} onBack={() => onSelectRun(null)} />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Run Config Section */}
      <div className="p-4 border-b space-y-4 max-h-[50%] overflow-y-auto">
        <button
          onClick={() => setIsConfigOpen(!isConfigOpen)}
          className="flex items-center gap-2 font-medium text-sm w-full hover:bg-muted/50 p-1 rounded -ml-1 transition-colors"
        >
          {isConfigOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          Run Configuration
        </button>

        {isConfigOpen && (
          <div className="space-y-4 animate-in slide-in-from-top-2 duration-200">
            {/* Browser Selection */}
            <div>
              <label className="flex items-center gap-2 text-xs font-medium mb-2 text-muted-foreground">
                <Monitor className="h-3.5 w-3.5" />
                Browser
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {BROWSERS.map(browser => (
                  <button
                    key={browser.value}
                    onClick={() => setBrowserType(browser.value)}
                    className={`p-2 rounded border text-xs font-medium transition-colors ${browserType === browser.value
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border hover:border-primary/50'
                      }`}
                  >
                    {browser.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Resolution Selection */}
            <div>
              <label className="text-xs font-medium mb-2 block text-muted-foreground">Resolution</label>
              <div className="grid grid-cols-3 gap-1.5">
                {RESOLUTIONS.map(res => (
                  <button
                    key={res.value}
                    onClick={() => setResolution(res.value)}
                    className={`p-2 rounded border text-xs transition-colors ${resolution === res.value
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border hover:border-primary/50'
                      }`}
                  >
                    <div className="font-medium">{res.label}</div>
                    <div className="text-[10px] text-muted-foreground">{res.dimensions}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Toggle Options - Compact */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setScreenshotsEnabled(!screenshotsEnabled)}
                className={cn(
                  'flex items-center gap-2 p-2 rounded border text-xs',
                  screenshotsEnabled ? 'border-primary bg-primary/5' : 'border-border'
                )}
              >
                <Camera className="h-3.5 w-3.5" />
                <span>Screenshots</span>
                {screenshotsEnabled && <CheckCircle className="h-3.5 w-3.5 text-primary ml-auto" />}
              </button>
              <button
                onClick={() => setRecordingEnabled(!recordingEnabled)}
                className={cn(
                  'flex items-center gap-2 p-2 rounded border text-xs',
                  recordingEnabled ? 'border-primary bg-primary/5' : 'border-border'
                )}
              >
                <Video className="h-3.5 w-3.5" />
                <span>Video</span>
                {recordingEnabled && <CheckCircle className="h-3.5 w-3.5 text-primary ml-auto" />}
              </button>
              <button
                onClick={() => setNetworkRecordingEnabled(!networkRecordingEnabled)}
                className={cn(
                  'flex items-center gap-2 p-2 rounded border text-xs',
                  networkRecordingEnabled ? 'border-primary bg-primary/5' : 'border-border'
                )}
              >
                <Wifi className="h-3.5 w-3.5" />
                <span>Network</span>
                {networkRecordingEnabled && <CheckCircle className="h-3.5 w-3.5 text-primary ml-auto" />}
              </button>
              <button
                onClick={() => setPerformanceMetricsEnabled(!performanceMetricsEnabled)}
                className={cn(
                  'flex items-center gap-2 p-2 rounded border text-xs',
                  performanceMetricsEnabled ? 'border-primary bg-primary/5' : 'border-border'
                )}
              >
                <Gauge className="h-3.5 w-3.5" />
                <span>Metrics</span>
                {performanceMetricsEnabled && <CheckCircle className="h-3.5 w-3.5 text-primary ml-auto" />}
              </button>
            </div>
          </div>
        )}

        {/* Run Button */}
        <Button
          onClick={handleStartRun}
          disabled={isStartingRun || !sessionId}
          className="w-full bg-green-600 hover:bg-green-700"
        >
          {isStartingRun ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Run Test
            </>
          )}
        </Button>
      </div>

      {/* Run History Section */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          <h3 className="font-medium text-sm">Run History</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-7 px-2"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Play className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm">No runs yet</p>
              <p className="text-xs mt-1">Run a test to see results here</p>
            </div>
          ) : (
            <div className="divide-y">
              {runs.map(run => (
                <button
                  key={run.id}
                  onClick={() => onSelectRun(run.id)}
                  className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={run.status} />
                      <span className="text-xs text-muted-foreground">
                        {formatDate(run.created_at)}
                      </span>
                      {run.user_name && (
                        <span className="text-xs text-muted-foreground">
                          by {run.user_name}
                        </span>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{run.browser_type}</span>
                    <span>{run.resolution_width}x{run.resolution_height}</span>
                    {run.duration_ms && <span>{formatDuration(run.duration_ms)}</span>}
                  </div>
                  {run.total_steps > 0 && (
                    <div className="flex items-center gap-2 mt-1 text-xs">
                      <span className="text-green-600">{run.passed_steps} passed</span>
                      {run.failed_steps > 0 && <span className="text-red-600">{run.failed_steps} failed</span>}
                      {run.healed_steps > 0 && <span className="text-purple-600">{run.healed_steps} healed</span>}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
