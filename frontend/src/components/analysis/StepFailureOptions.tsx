import { AlertCircle, Wand2, RotateCcw, SkipForward, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface StepFailureOptionsProps {
  stepNumber: number;
  error: string;
  isSkipped?: boolean;
  onAutoHeal?: () => void; // Disabled for now
  onUndo: () => void;
  onSkip: () => void;
  onContinue: () => void;
}

export default function StepFailureOptions({
  stepNumber,
  error,
  isSkipped = false,
  onUndo,
  onSkip,
  onContinue,
}: StepFailureOptionsProps) {
  return (
    <div className="mt-2 p-3 bg-destructive/10 rounded-lg border border-destructive/20">
      <div className="flex items-center gap-2 mb-2">
        <AlertCircle className="h-4 w-4 text-destructive" />
        <span className="text-sm font-medium text-destructive">
          Step {stepNumber} Failed
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-3 font-mono break-all">
        {error}
      </p>
      <div className="flex flex-wrap gap-2">
        {isSkipped ? (
          // After skip - show Continue button
          <Button
            size="sm"
            variant="default"
            onClick={onContinue}
            className="h-7 text-xs"
          >
            <Play className="h-3 w-3 mr-1" />
            Continue
          </Button>
        ) : (
          // Before skip - show action options
          <>
            <Button
              size="sm"
              variant="outline"
              disabled
              title="Coming soon"
              className="h-7 text-xs"
            >
              <Wand2 className="h-3 w-3 mr-1" />
              Auto Heal
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onUndo}
              className="h-7 text-xs"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Undo Till Here
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={onSkip}
              className="h-7 text-xs"
            >
              <SkipForward className="h-3 w-3 mr-1" />
              Skip
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
