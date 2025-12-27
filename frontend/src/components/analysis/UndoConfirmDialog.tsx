import { AlertTriangle, X, RotateCcw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UndoConfirmDialogProps {
  targetStepNumber: number;
  totalSteps: number;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function UndoConfirmDialog({
  targetStepNumber,
  totalSteps,
  isLoading = false,
  onConfirm,
  onCancel,
}: UndoConfirmDialogProps) {
  const stepsToRemove = totalSteps - targetStepNumber;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border-b border-amber-200">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <h3 className="font-semibold text-amber-800">Undo to Step {targetStepNumber}?</h3>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="ml-auto p-1 hover:bg-amber-100 rounded disabled:opacity-50"
          >
            <X className="h-4 w-4 text-amber-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-sm text-foreground">
            This will:
          </p>
          
          <ul className="text-sm text-muted-foreground space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-amber-600 mt-0.5">•</span>
              <span>
                Remove steps {targetStepNumber + 1}–{totalSteps} from this analysis
                {stepsToRemove === 1 ? ' (1 step)' : ` (${stepsToRemove} steps)`}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-600 mt-0.5">•</span>
              <span>
                Re-run steps 1–{targetStepNumber} in the current browser, starting from the original page
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-600 mt-0.5">•</span>
              <span>
                <strong>No AI tokens will be used</strong> — this is a direct replay
              </span>
            </li>
          </ul>

          <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
            <p className="text-xs text-amber-800">
              <strong>Important:</strong> This cannot revert changes to the application's backend 
              (e.g., records already created or deleted). It only repositions the browser state.
            </p>
          </div>

          <p className="text-xs text-muted-foreground italic">
            Replay may take a moment and can fail if the application state has changed since the original run.
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-4 py-3 bg-muted/20 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={isLoading}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Replaying...
              </>
            ) : (
              <>
                <RotateCcw className="h-4 w-4 mr-1" />
                Undo and Replay
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
