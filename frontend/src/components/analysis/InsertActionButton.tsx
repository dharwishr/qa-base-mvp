import { useState } from 'react';
import { Plus, Clock, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface InsertActionButtonProps {
  // For action mode (insert within existing step)
  stepId?: string;
  insertAtIndex?: number;
  onInsertAction?: (
    stepId: string,
    actionIndex: number,
    actionName: string,
    params: Record<string, unknown>
  ) => Promise<void>;

  // For step mode (insert new step)
  sessionId?: string;
  insertAtStepNumber?: number;
  onInsertStep?: (
    sessionId: string,
    stepNumber: number,
    actionName: string,
    params: Record<string, unknown>
  ) => Promise<void>;

  mode?: 'action' | 'step';
  disabled?: boolean;
}

export default function InsertActionButton({
  stepId,
  insertAtIndex,
  onInsertAction,
  sessionId,
  insertAtStepNumber,
  onInsertStep,
  mode = 'action',
  disabled = false,
}: InsertActionButtonProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isInserting, setIsInserting] = useState(false);
  const [duration, setDuration] = useState('1');
  const [error, setError] = useState<string | null>(null);

  const handleInsert = async () => {
    const durationSeconds = parseFloat(duration);
    if (isNaN(durationSeconds) || durationSeconds <= 0) {
      setError('Please enter a valid duration');
      return;
    }

    setIsInserting(true);
    setError(null);

    try {
      const params = { duration: durationSeconds };

      if (mode === 'action' && stepId !== undefined && insertAtIndex !== undefined && onInsertAction) {
        await onInsertAction(stepId, insertAtIndex, 'wait', params);
      } else if (mode === 'step' && sessionId && insertAtStepNumber !== undefined && onInsertStep) {
        await onInsertStep(sessionId, insertAtStepNumber, 'wait', params);
      }

      setIsPopoverOpen(false);
      setDuration('1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to insert action');
    } finally {
      setIsInserting(false);
    }
  };

  if (disabled) {
    return null;
  }

  return (
    <div className="relative group/insert">
      {/* Insert button container - visible on hover */}
      <div className="h-1 flex items-center justify-center opacity-0 group-hover/insert:opacity-100 transition-opacity">
        <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
        <button
          onClick={() => setIsPopoverOpen(true)}
          className="mx-1 w-4 h-4 rounded-full bg-muted hover:bg-primary/10 border border-muted-foreground/30 flex items-center justify-center transition-colors"
          title={mode === 'action' ? 'Insert action here' : 'Insert step here'}
        >
          <Plus className="h-2.5 w-2.5 text-muted-foreground" />
        </button>
        <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
      </div>

      {/* Popover */}
      {isPopoverOpen && (
        <div className="absolute z-50 left-1/2 -translate-x-1/2 top-4 w-64 bg-background rounded-lg shadow-xl border overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border-b border-blue-200">
            <Clock className="h-4 w-4 text-blue-600" />
            <span className="font-medium text-blue-800 text-sm">Insert Wait Action</span>
            <button
              onClick={() => {
                setIsPopoverOpen(false);
                setError(null);
              }}
              disabled={isInserting}
              className="ml-auto p-0.5 hover:bg-blue-100 rounded disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5 text-blue-600" />
            </button>
          </div>

          {/* Content */}
          <div className="p-3 space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Duration (seconds)
              </label>
              <Input
                type="number"
                min="0.1"
                step="0.1"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                disabled={isInserting}
                className="h-8 text-sm"
                placeholder="1"
                autoFocus
              />
            </div>

            {error && (
              <p className="text-xs text-destructive bg-destructive/10 px-2 py-1 rounded">
                {error}
              </p>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsPopoverOpen(false);
                  setError(null);
                }}
                disabled={isInserting}
                className="h-7 text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleInsert}
                disabled={isInserting}
                className="h-7 text-xs"
              >
                {isInserting ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Inserting...
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3 mr-1" />
                    Insert
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
