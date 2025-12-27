import { AlertCircle, X, GitBranch, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ReplayFailureDialogProps {
  failedAtStep: number;
  totalSteps: number;
  errorMessage: string;
  onFork: (stepNumber: number) => void;
  onUndo: (stepNumber: number) => void;
  onCancel: () => void;
}

export default function ReplayFailureDialog({
  failedAtStep,
  totalSteps,
  errorMessage,
  onFork,
  onUndo,
  onCancel,
}: ReplayFailureDialogProps) {
  const successfulSteps = failedAtStep - 1;
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-destructive/10 border-b">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <h3 className="font-semibold text-destructive">Replay Failed</h3>
          <button
            onClick={onCancel}
            className="ml-auto p-1 hover:bg-destructive/10 rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            The replay failed at step {failedAtStep} of {totalSteps}:
          </p>
          <div className="bg-muted/50 rounded p-3 text-sm font-mono break-words">
            {errorMessage}
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium">What would you like to do?</p>
            
            <div className="space-y-2">
              {successfulSteps > 0 && (
                <div className="flex items-start gap-3 p-3 bg-background rounded border">
                  <GitBranch className="h-5 w-5 text-primary mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Create new test case</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Fork this session with steps 1-{successfulSteps} (before the failure).
                      This preserves the original test case.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onFork(successfulSteps)}
                      className="mt-2"
                    >
                      <GitBranch className="h-3.5 w-3.5 mr-1.5" />
                      Fork to step {successfulSteps}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3 p-3 bg-background rounded border">
                <Undo2 className="h-5 w-5 text-orange-500 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Undo in current session</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Remove steps from {successfulSteps + 1} to {totalSteps} and continue from step {successfulSteps}.
                    This modifies the current test case.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onUndo(successfulSteps)}
                    className="mt-2"
                  >
                    <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                    Undo to step {successfulSteps}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-4 py-3 bg-muted/20 border-t">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Continue without action
          </Button>
        </div>
      </div>
    </div>
  );
}
