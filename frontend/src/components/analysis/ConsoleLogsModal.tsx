import { useState, useEffect, useCallback } from 'react';
import { X, Filter, ChevronDown, Download, Terminal, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { runsApi } from '@/services/api';
import type { ConsoleLog } from '@/types/scripts';

interface ConsoleLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  runId: string;
}

const LOG_LEVELS = ['all', 'log', 'info', 'warn', 'error', 'debug'] as const;

const LEVEL_COLORS: Record<string, string> = {
  log: 'text-gray-600',
  info: 'text-blue-600',
  warn: 'text-yellow-600',
  error: 'text-red-600',
  debug: 'text-gray-500',
};

const LEVEL_BG_COLORS: Record<string, string> = {
  log: 'bg-gray-50 dark:bg-gray-900/50',
  info: 'bg-blue-50 dark:bg-blue-900/30',
  warn: 'bg-yellow-50 dark:bg-yellow-900/30',
  error: 'bg-red-50 dark:bg-red-900/30',
  debug: 'bg-gray-50 dark:bg-gray-900/50',
};

const LEVEL_ICONS: Record<string, string> = {
  log: 'bg-gray-400',
  info: 'bg-blue-400',
  warn: 'bg-yellow-400',
  error: 'bg-red-500',
  debug: 'bg-gray-400',
};

export default function ConsoleLogsModal({ isOpen, onClose, runId }: ConsoleLogsModalProps) {
  const [logs, setLogs] = useState<ConsoleLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [filterText, setFilterText] = useState('');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());

  // Fetch logs
  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Note: filtering by level happens client-side since we want to toggle quickly
      const data = await runsApi.getConsoleLogs(runId);
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load console logs');
    } finally {
      setIsLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, fetchLogs]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  // Filter logs by level and text
  const filteredLogs = logs.filter((log) => {
    // Level filter
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    // Text filter
    if (!filterText) return true;
    const searchLower = filterText.toLowerCase();
    return (
      log.message.toLowerCase().includes(searchLower) ||
      log.source?.toLowerCase().includes(searchLower)
    );
  });

  // Toggle stack trace expansion
  const toggleStack = (logId: string) => {
    setExpandedStacks((prev) => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  };

  // Download logs
  const downloadLogs = () => {
    const content = filteredLogs
      .map((log) => {
        const source = log.source ? ` [${log.source}:${log.line_number || '?'}]` : '';
        return `[${log.timestamp}] [${log.level.toUpperCase()}]${source} ${log.message}`;
      })
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `console-logs-${runId.slice(0, 8)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return '';
    try {
      return new Date(timestamp).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return timestamp;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-background rounded-lg shadow-xl w-full max-w-4xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Browser Console Logs</h2>
            <span className="text-sm text-muted-foreground">
              ({filteredLogs.length} entries)
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30 shrink-0">
          {/* Level filter dropdown */}
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs gap-1.5"
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            >
              <Filter className="h-3.5 w-3.5" />
              {filterLevel.toUpperCase()}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            {showFilterDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-background border rounded-md shadow-lg z-10 py-1 min-w-[100px]">
                {LOG_LEVELS.map((level) => (
                  <button
                    key={level}
                    className={cn(
                      'w-full px-3 py-1.5 text-left text-xs hover:bg-muted capitalize',
                      filterLevel === level && 'bg-muted font-medium'
                    )}
                    onClick={() => {
                      setFilterLevel(level);
                      setShowFilterDropdown(false);
                    }}
                  >
                    {level}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Text search */}
          <input
            type="text"
            placeholder="Filter by message or source..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="flex-1 h-8 px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />

          {/* Action buttons */}
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={fetchLogs} disabled={isLoading}>
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={downloadLogs} disabled={filteredLogs.length === 0}>
            <Download className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto font-mono text-sm">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-48 text-destructive">
              <AlertCircle className="h-5 w-5 mr-2" />
              {error}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <Terminal className="h-10 w-10 mb-2 opacity-30" />
              <p>No console logs captured</p>
              <p className="text-xs mt-1">Console output will appear here when available</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className={cn('px-3 py-2 rounded', LEVEL_BG_COLORS[log.level] || 'bg-gray-50')}
                >
                  <div className="flex items-start gap-3">
                    {/* Level indicator */}
                    <span className={cn('shrink-0 w-2 h-2 rounded-full mt-1.5', LEVEL_ICONS[log.level])} />

                    {/* Timestamp */}
                    <span className="shrink-0 text-xs text-muted-foreground w-20">
                      {formatTimestamp(log.timestamp)}
                    </span>

                    {/* Level badge */}
                    <span className={cn('shrink-0 text-xs font-medium uppercase w-12', LEVEL_COLORS[log.level])}>
                      {log.level}
                    </span>

                    {/* Message and source */}
                    <div className="flex-1 min-w-0">
                      <p className="break-words whitespace-pre-wrap">{log.message}</p>
                      {log.source && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {log.source}
                          {log.line_number && `:${log.line_number}`}
                          {log.column_number && `:${log.column_number}`}
                        </p>
                      )}
                      {/* Stack trace (expandable) */}
                      {log.stack_trace && (
                        <div className="mt-2">
                          <button
                            onClick={() => toggleStack(log.id)}
                            className="text-xs text-muted-foreground hover:text-foreground underline"
                          >
                            {expandedStacks.has(log.id) ? 'Hide stack trace' : 'Show stack trace'}
                          </button>
                          {expandedStacks.has(log.id) && (
                            <pre className="mt-1 p-2 bg-muted/50 rounded text-xs overflow-x-auto">
                              {log.stack_trace}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
