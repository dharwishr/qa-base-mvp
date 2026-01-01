import { useState, useEffect } from 'react';
import { X, Save, Loader2, Sparkles, Plus, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EditablePlanStep from './EditablePlanStep';
import type { PlanStep } from '@/types/chat';

interface PlanEditModalProps {
  isOpen: boolean;
  planId: string;
  planText: string;
  planSteps: PlanStep[];
  onClose: () => void;
  onSave: (steps: PlanStep[], userPrompt?: string) => Promise<void>;
  onRegenerate: (steps: PlanStep[], userPrompt: string) => Promise<void>;
}

export default function PlanEditModal({
  isOpen,
  planId: _planId, // Used by parent for tracking, not needed here
  planText,
  planSteps,
  onClose,
  onSave,
  onRegenerate,
}: PlanEditModalProps) {
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [userPrompt, setUserPrompt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddStep, setShowAddStep] = useState(false);
  const [newStep, setNewStep] = useState<Partial<PlanStep>>({
    description: '',
    action_type: 'click',
    details: '',
  });

  // Initialize steps when modal opens
  useEffect(() => {
    if (isOpen && planSteps) {
      setSteps([...planSteps]);
      setUserPrompt('');
      setError(null);
    }
  }, [isOpen, planSteps]);

  const handleUpdateStep = (index: number, updates: Partial<PlanStep>) => {
    setSteps((prev) => {
      const newSteps = [...prev];
      newSteps[index] = { ...newSteps[index], ...updates };
      return newSteps;
    });
  };

  const handleDeleteStep = (index: number) => {
    setSteps((prev) => {
      const newSteps = prev.filter((_, i) => i !== index);
      // Renumber steps
      return newSteps.map((step, i) => ({ ...step, step_number: i + 1 }));
    });
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    setSteps((prev) => {
      const newSteps = [...prev];
      [newSteps[index - 1], newSteps[index]] = [newSteps[index], newSteps[index - 1]];
      // Renumber steps
      return newSteps.map((step, i) => ({ ...step, step_number: i + 1 }));
    });
  };

  const handleMoveDown = (index: number) => {
    if (index === steps.length - 1) return;
    setSteps((prev) => {
      const newSteps = [...prev];
      [newSteps[index], newSteps[index + 1]] = [newSteps[index + 1], newSteps[index]];
      // Renumber steps
      return newSteps.map((step, i) => ({ ...step, step_number: i + 1 }));
    });
  };

  const handleAddStep = () => {
    if (!newStep.description?.trim()) {
      setError('Step description is required');
      return;
    }

    const stepToAdd: PlanStep = {
      step_number: steps.length + 1,
      description: newStep.description.trim(),
      action_type: newStep.action_type || 'click',
      details: newStep.details?.trim() || '',
    };

    setSteps((prev) => [...prev, stepToAdd]);
    setNewStep({ description: '', action_type: 'click', details: '' });
    setShowAddStep(false);
    setError(null);
  };

  const handleSave = async () => {
    if (steps.length === 0) {
      setError('At least one step is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave(steps, userPrompt || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRegenerate = async () => {
    if (!userPrompt.trim()) {
      setError('Please provide instructions for AI to regenerate the plan');
      return;
    }

    setIsRegenerating(true);
    setError(null);

    try {
      await onRegenerate(steps, userPrompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate plan');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleClose = () => {
    if (isSaving || isRegenerating) return;
    onClose();
  };

  if (!isOpen) return null;

  const isLoading = isSaving || isRegenerating;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 bg-blue-50 border-b border-blue-200">
          <FileText className="h-5 w-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-blue-800">Edit Plan</h2>
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="ml-auto p-1.5 hover:bg-blue-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="h-5 w-5 text-blue-600" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Original Plan Text (read-only reference) */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Original Plan Summary
            </label>
            <div className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-lg whitespace-pre-wrap max-h-24 overflow-y-auto">
              {planText}
            </div>
          </div>

          {/* Steps List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                Steps ({steps.length})
              </label>
            </div>

            {steps.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No steps defined. Add a step to get started.
              </div>
            ) : (
              <div className="space-y-2">
                {steps.map((step, index) => (
                  <EditablePlanStep
                    key={`${step.step_number}-${index}`}
                    step={step}
                    index={index}
                    isFirst={index === 0}
                    isLast={index === steps.length - 1}
                    onUpdate={handleUpdateStep}
                    onDelete={handleDeleteStep}
                    onMoveUp={handleMoveUp}
                    onMoveDown={handleMoveDown}
                  />
                ))}
              </div>
            )}

            {/* Add Step */}
            {showAddStep ? (
              <div className="border-2 border-dashed border-blue-300 rounded-lg p-4 bg-blue-50/50 space-y-3">
                <div className="text-sm font-medium text-blue-700">
                  Add New Step
                </div>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={newStep.description || ''}
                    onChange={(e) =>
                      setNewStep({ ...newStep, description: e.target.value })
                    }
                    placeholder="Step description..."
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    autoFocus
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      value={newStep.action_type || 'click'}
                      onChange={(e) =>
                        setNewStep({ ...newStep, action_type: e.target.value })
                      }
                      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="navigate">navigate</option>
                      <option value="click">click</option>
                      <option value="type">type</option>
                      <option value="scroll">scroll</option>
                      <option value="wait">wait</option>
                      <option value="verify">verify</option>
                      <option value="hover">hover</option>
                      <option value="select">select</option>
                      <option value="other">other</option>
                    </select>
                    <input
                      type="text"
                      value={newStep.details || ''}
                      onChange={(e) =>
                        setNewStep({ ...newStep, details: e.target.value })
                      }
                      placeholder="Details (optional)"
                      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowAddStep(false)}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleAddStep}>
                    <Plus className="h-3 w-3 mr-1" />
                    Add Step
                  </Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddStep(true)}
                className="w-full border-2 border-dashed border-muted-foreground/30 rounded-lg py-3 text-sm text-muted-foreground hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Step
              </button>
            )}
          </div>

          {/* AI Prompt Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Additional Instructions for AI
              <span className="text-muted-foreground font-normal ml-1">
                (optional for save, required for regenerate)
              </span>
            </label>
            <textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              placeholder="Enter additional instructions or context for the AI to consider when regenerating the plan..."
              rows={3}
              disabled={isLoading}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none disabled:opacity-50"
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 bg-muted/20 border-t">
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleSave}
              disabled={isLoading || steps.length === 0}
              className="border-green-300 text-green-700 hover:bg-green-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
            <Button
              onClick={handleRegenerate}
              disabled={isLoading || !userPrompt.trim()}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isRegenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Regenerating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Regenerate with AI
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
