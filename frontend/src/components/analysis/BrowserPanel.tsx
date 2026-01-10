import { useState, useEffect, useCallback } from 'react';
import { Monitor, Image, FileText, Play, FlaskConical } from 'lucide-react';
import LiveBrowserView from '@/components/LiveBrowserView';
import LogsView, { type LogEntry } from './LogsView';
import ExecuteTab from './ExecuteTab';
import { ScreenshotWithZoom } from '@/components/ui/screenshot-fullscreen-modal';
import { cn } from '@/lib/utils';
import { analysisApi } from '@/services/api';
import type { RecordingMode } from '@/types/analysis';
import type { TestRun, StartRunRequest } from '@/types/scripts';

// Top-level tab types
type MainTabType = 'analysis' | 'execute';
// Nested analysis tab types
type AnalysisTabType = 'browser' | 'screenshot' | 'logs';

interface BrowserPanelProps {
  sessionId: string | null;
  browserSession: {
    id: string;
    liveViewUrl?: string;
    novncUrl?: string;
  } | null;
  headless: boolean;
  isExecuting: boolean;
  isWaitingForBrowser?: boolean;  // True when browser is starting (e.g., recording mode)
  screenshotUrl: string | null;
  selectedStepUrl?: string;
  messagesCount: number;
  // Recording props
  isRecording: boolean;
  currentRecordingMode: RecordingMode | null;
  onStartRecording: (mode: RecordingMode) => Promise<void>;
  onStopRecording: () => Promise<void>;
  canRecord: boolean;
  // Interaction props
  isInteractionEnabled: boolean;
  onToggleInteraction: () => void;
  // Browser control
  onEndBrowserSession: () => Promise<void>;
  // Execute tab props
  sessionRuns: TestRun[];
  selectedRunId: string | null;
  onSelectRun: (runId: string | null) => void;
  onStartSessionRun: (config: StartRunRequest) => Promise<void>;
  onRefreshRuns: () => Promise<void>;
  isStartingRun: boolean;
  onActionClick?: (sourceActionId: string | null) => void;
  className?: string;
}

export default function BrowserPanel({
  sessionId,
  browserSession,
  headless,
  isExecuting,
  isWaitingForBrowser = false,
  screenshotUrl,
  selectedStepUrl,
  messagesCount,
  isRecording,
  currentRecordingMode,
  onStartRecording,
  onStopRecording,
  canRecord,
  isInteractionEnabled,
  onToggleInteraction,
  onEndBrowserSession,
  sessionRuns,
  selectedRunId,
  onSelectRun,
  onStartSessionRun,
  onRefreshRuns,
  isStartingRun,
  onActionClick,
  className,
}: BrowserPanelProps) {
  const [mainTab, setMainTab] = useState<MainTabType>('analysis');
  const [analysisTab, setAnalysisTab] = useState<AnalysisTabType>('browser');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isScreenshotFullscreen, setIsScreenshotFullscreen] = useState(false);

  // Fetch logs from backend
  const fetchLogs = useCallback(async () => {
    if (!sessionId) return;

    setIsLoadingLogs(true);
    try {
      const response = await analysisApi.getLogs(sessionId);
      const formattedLogs: LogEntry[] = response.map((log) => ({
        id: log.id,
        timestamp: log.created_at,
        level: (log.level?.toUpperCase() || 'INFO') as LogEntry['level'],
        logger: log.source || 'app',
        message: log.message,
      }));
      setLogs(formattedLogs);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setIsLoadingLogs(false);
    }
  }, [sessionId]);

  // Fetch logs when switching to logs tab or session changes
  useEffect(() => {
    if (mainTab === 'analysis' && analysisTab === 'logs' && sessionId) {
      fetchLogs();
    }
  }, [mainTab, analysisTab, sessionId, fetchLogs]);

  // Auto-refresh logs while executing
  useEffect(() => {
    if (mainTab === 'analysis' && analysisTab === 'logs' && isExecuting && sessionId) {
      const interval = setInterval(fetchLogs, 2000);
      return () => clearInterval(interval);
    }
  }, [mainTab, analysisTab, isExecuting, sessionId, fetchLogs]);

  // Clear logs
  const clearLogs = () => {
    setLogs([]);
  };

  // Determine which tabs to show
  const showBrowserTab = !headless;

  // Set default analysis tab if browser tab is hidden
  useEffect(() => {
    if (!showBrowserTab && analysisTab === 'browser') {
      setAnalysisTab('screenshot');
    }
  }, [showBrowserTab, analysisTab]);

  const analysisTabs = [
    ...(showBrowserTab
      ? [{ id: 'browser' as AnalysisTabType, label: 'Live Browser', icon: Monitor }]
      : []),
    { id: 'screenshot' as AnalysisTabType, label: 'Screenshots', icon: Image },
    { id: 'logs' as AnalysisTabType, label: 'Logs', icon: FileText },
  ];

  const mainTabs = [
    { id: 'analysis' as MainTabType, label: 'Analysis', icon: FlaskConical },
    { id: 'execute' as MainTabType, label: 'Execute', icon: Play },
  ];

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Main Tab Bar (Analysis / Execute) */}
      <div className="flex items-center border-b bg-muted/50 px-2">
        {mainTabs.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              mainTab === tab.id
                ? 'border-primary text-primary bg-background'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
            )}
            onClick={() => setMainTab(tab.id)}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
            {tab.id === 'execute' && sessionRuns.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-muted rounded-full">
                {sessionRuns.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 overflow-hidden">
        {/* Analysis Tab */}
        {mainTab === 'analysis' && (
          <div className="flex flex-col h-full">
            {/* Nested Tab Bar (Browser / Screenshot / Logs) */}
            <div className="flex items-center border-b bg-muted/30 px-2">
              {analysisTabs.map((tab) => (
                <button
                  key={tab.id}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                    analysisTab === tab.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
                  )}
                  onClick={() => setAnalysisTab(tab.id)}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                  {tab.id === 'logs' && logs.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 text-xs bg-muted rounded-full">
                      {logs.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Analysis Tab Content */}
            <div className="flex-1 overflow-hidden">
              {/* Browser Tab */}
              {analysisTab === 'browser' && showBrowserTab && (
                <div className="h-full">
                  {browserSession ? (
                    <LiveBrowserView
                      sessionId={browserSession.id}
                      liveViewUrl={browserSession.liveViewUrl}
                      novncUrl={browserSession.novncUrl}
                      onClose={onEndBrowserSession}
                      onStopBrowser={onEndBrowserSession}
                      className="h-full"
                      isRecording={isRecording}
                      onStartRecording={onStartRecording}
                      onStopRecording={onStopRecording}
                      canRecord={canRecord}
                      isAIExecuting={isExecuting}
                      currentRecordingMode={currentRecordingMode}
                      isInteractionEnabled={isInteractionEnabled}
                      onToggleInteraction={onToggleInteraction}
                    />
                  ) : isExecuting || isWaitingForBrowser ? (
                    <div className="h-full flex items-center justify-center">
                      <div className="text-center">
                        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                        <p className="text-sm text-muted-foreground">
                          {isWaitingForBrowser ? 'Starting browser and navigating to URL...' : 'Starting live browser...'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                      <div className="text-center">
                        <Monitor className="h-12 w-12 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">No Active Browser</p>
                        <p className="text-sm mt-1">Start execution to see the live browser</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Screenshot Tab */}
              {analysisTab === 'screenshot' && (
                <div className="h-full flex flex-col p-2">
                  <div className="w-full h-full flex flex-col">
                    {/* Browser chrome */}
                    <div className="bg-muted/50 rounded-t-lg border border-b-0 p-2 flex items-center gap-2 flex-shrink-0">
                      <div className="flex gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-red-400" />
                        <div className="w-3 h-3 rounded-full bg-yellow-400" />
                        <div className="w-3 h-3 rounded-full bg-green-400" />
                      </div>
                      <div className="flex-1 bg-background rounded px-3 py-1 text-xs text-muted-foreground truncate">
                        {selectedStepUrl || 'https://example.com'}
                      </div>
                    </div>

                    {/* Content area */}
                    <div className="border rounded-b-lg bg-background flex-1 flex items-center justify-center relative overflow-hidden">
                      {screenshotUrl ? (
                        <ScreenshotWithZoom
                          imageUrl={screenshotUrl}
                          alt="Screenshot"
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                          isOpen={isScreenshotFullscreen}
                          onOpenChange={setIsScreenshotFullscreen}
                        />
                      ) : (
                        <div className="text-center text-muted-foreground">
                          <Image className="h-12 w-12 mx-auto mb-3 opacity-30" />
                          <p className="font-medium">Screenshot Preview</p>
                          <p className="text-sm mt-1">
                            {messagesCount === 0
                              ? 'Start a test to see browser activity'
                              : 'Select a step to view its screenshot'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Logs Tab */}
              {analysisTab === 'logs' && (
                <LogsView
                  logs={logs}
                  isLoading={isLoadingLogs}
                  onRefresh={fetchLogs}
                  onClear={clearLogs}
                  className="h-full"
                  autoScroll={isExecuting}
                />
              )}
            </div>
          </div>
        )}

        {/* Execute Tab */}
        {mainTab === 'execute' && (
          <ExecuteTab
            sessionId={sessionId}
            runs={sessionRuns}
            selectedRunId={selectedRunId}
            onSelectRun={onSelectRun}
            onStartRun={onStartSessionRun}
            onRefreshRuns={onRefreshRuns}
            isStartingRun={isStartingRun}
            onActionClick={onActionClick}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}
