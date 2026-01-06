import { useEffect, useRef, useState } from 'react';
import { Download, Trash2, Filter, RefreshCw, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  logger: string;
  message: string;
}

interface LogsViewProps {
  logs: LogEntry[];
  isLoading?: boolean;
  onRefresh?: () => void;
  onClear?: () => void;
  className?: string;
  autoScroll?: boolean;
}

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: 'text-gray-500',
  INFO: 'text-blue-600',
  WARNING: 'text-yellow-600',
  ERROR: 'text-red-600',
  CRITICAL: 'text-red-700 font-bold',
};

const LEVEL_BG_COLORS: Record<string, string> = {
  DEBUG: 'bg-gray-100',
  INFO: 'bg-blue-50',
  WARNING: 'bg-yellow-50',
  ERROR: 'bg-red-50',
  CRITICAL: 'bg-red-100',
};

export default function LogsView({
  logs,
  isLoading = false,
  onRefresh,
  onClear,
  className,
  autoScroll = true,
}: LogsViewProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [filterText, setFilterText] = useState('');
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    const matchesLevel = filterLevel === 'ALL' || log.level === filterLevel;
    const matchesText =
      !filterText ||
      log.message.toLowerCase().includes(filterText.toLowerCase()) ||
      log.logger.toLowerCase().includes(filterText.toLowerCase());
    return matchesLevel && matchesText;
  });

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && !isUserScrolling && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLogs.length, autoScroll, isUserScrolling]);

  // Detect user scrolling
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsUserScrolling(!isAtBottom);
  };

  // Download logs as text file
  const downloadLogs = () => {
    const content = filteredLogs
      .map((log) => `[${log.timestamp}] [${log.level}] [${log.logger}] ${log.message}`)
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      });
    } catch {
      return timestamp;
    }
  };

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        {/* Filter dropdown */}
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
          >
            <Filter className="h-3 w-3" />
            {filterLevel}
            <ChevronDown className="h-3 w-3" />
          </Button>
          {showFilterDropdown && (
            <div className="absolute top-full left-0 mt-1 bg-background border rounded-md shadow-lg z-10 py-1 min-w-[100px]">
              {['ALL', 'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'].map((level) => (
                <button
                  key={level}
                  className={cn(
                    'w-full px-3 py-1 text-left text-xs hover:bg-muted',
                    filterLevel === level && 'bg-muted'
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

        {/* Search input */}
        <input
          type="text"
          placeholder="Filter logs..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="flex-1 h-7 px-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        />

        {/* Action buttons */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onRefresh}
          disabled={isLoading}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={downloadLogs}
          disabled={filteredLogs.length === 0}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
        {onClear && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={onClear}
            disabled={logs.length === 0}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}

        {/* Log count */}
        <span className="text-xs text-muted-foreground ml-2">
          {filteredLogs.length} / {logs.length}
        </span>
      </div>

      {/* Logs container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto font-mono text-xs"
        onScroll={handleScroll}
      >
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {logs.length === 0 ? (
              <div className="text-center">
                <p className="font-medium">No logs yet</p>
                <p className="text-xs mt-1">Logs will appear here during execution</p>
              </div>
            ) : (
              <p>No logs match the current filter</p>
            )}
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {filteredLogs.map((log) => (
              <div
                key={log.id}
                className={cn(
                  'px-2 py-1 rounded flex gap-2 hover:bg-muted/50',
                  LEVEL_BG_COLORS[log.level]
                )}
              >
                <span className="text-muted-foreground shrink-0">
                  {formatTimestamp(log.timestamp)}
                </span>
                <span className={cn('shrink-0 w-16', LEVEL_COLORS[log.level])}>
                  [{log.level}]
                </span>
                <span className="text-muted-foreground shrink-0 max-w-[150px] truncate">
                  [{log.logger}]
                </span>
                <span className="break-all whitespace-pre-wrap">{log.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>

      {/* Auto-scroll indicator */}
      {isUserScrolling && filteredLogs.length > 0 && (
        <button
          className="absolute bottom-4 right-4 bg-primary text-primary-foreground px-3 py-1.5 rounded-full text-xs shadow-lg hover:bg-primary/90 transition-colors"
          onClick={() => {
            setIsUserScrolling(false);
            logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
