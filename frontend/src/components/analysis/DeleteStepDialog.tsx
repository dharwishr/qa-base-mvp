import { AlertTriangle, X, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DeleteStepDialogProps {
  stepNumber: number;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteStepDialog({
  stepNumber,
  isLoading = false,
  onConfirm,
  onCancel,
}: DeleteStepDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border-b border-red-200">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <h3 className="font-semibold text-red-800">Delete Step {stepNumber}?</h3>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="ml-auto p-1 hover:bg-red-100 rounded disabled:opacity-50"
          >
            <X className="h-4 w-4 text-red-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-sm text-foreground">
            Are you sure you want to delete Step {stepNumber}?
          </p>

          <p className="text-sm text-muted-foreground">
            This action cannot be undone. The step and all its actions will be permanently removed.
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
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
