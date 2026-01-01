import { useState } from 'react';
import { ChevronUp, ChevronDown, Trash2, Pencil, Check, X, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PlanStep } from '@/types/chat';

// Helper to check if step is a verification/assertion step
const isVerifyStep = (actionType: string) => {
  const verifyTypes = ['verify', 'assert', 'check', 'validate', 'expect'];
  return verifyTypes.some(v => actionType.toLowerCase().includes(v));
};

// Common action types for the dropdown
const ACTION_TYPES = [
  'navigate',
  'click',
  'type',
  'scroll',
  'wait',
  'verify',
  'hover',
  'select',
  'submit',
  'screenshot',
  'other',
];

interface EditablePlanStepProps {
  step: PlanStep;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (index: number, updates: Partial<PlanStep>) => void;
  onDelete: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

export default function EditablePlanStep({
  step,
  index,
  isFirst,
  isLast,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: EditablePlanStepProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedStep, setEditedStep] = useState<PlanStep>(step);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleStartEdit = () => {
    setEditedStep({ ...step });
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    onUpdate(index, editedStep);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditedStep({ ...step });
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (showDeleteConfirm) {
      onDelete(index);
      setShowDeleteConfirm(false);
    } else {
      setShowDeleteConfirm(true);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  if (isEditing) {
    return (
      <div className="border rounded-lg p-4 bg-blue-50/50 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
          <span>Step {step.step_number}</span>
          <span className="text-muted-foreground">- Editing</span>
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Description
          </label>
          <Input
            value={editedStep.description}
            onChange={(e) =>
              setEditedStep({ ...editedStep, description: e.target.value })
            }
            placeholder="Step description..."
            className="text-sm"
          />
        </div>

        {/* Action Type */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Action Type
          </label>
          <select
            value={editedStep.action_type}
            onChange={(e) =>
              setEditedStep({ ...editedStep, action_type: e.target.value })
            }
            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {ACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        {/* Details */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Details
          </label>
          <textarea
            value={editedStep.details}
            onChange={(e) =>
              setEditedStep({ ...editedStep, details: e.target.value })
            }
            placeholder="Detailed instructions..."
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>

        {/* Edit Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={handleCancelEdit}>
            <X className="h-3 w-3 mr-1" />
            Cancel
          </Button>
          <Button size="sm" onClick={handleSaveEdit}>
            <Check className="h-3 w-3 mr-1" />
            Save
          </Button>
        </div>
      </div>
    );
  }

  const isVerify = isVerifyStep(step.action_type);

  return (
    <div className={`group border rounded-lg p-3 transition-colors ${
      isVerify
        ? 'border-green-200 bg-green-50/50 hover:bg-green-50'
        : 'hover:bg-muted/30'
    }`}>
      <div className="flex items-start gap-3">
        {/* Move Buttons */}
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => onMoveUp(index)}
            disabled={isFirst}
            className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move up"
          >
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          </button>
          <button
            onClick={() => onMoveDown(index)}
            disabled={isLast}
            className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move down"
          >
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Step Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isVerify && (
              <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
            )}
            <span className={`text-sm font-semibold ${isVerify ? 'text-green-600' : 'text-blue-600'}`}>
              {step.step_number}.
            </span>
            <span className="text-sm font-medium">{step.description}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span className={`px-1.5 py-0.5 rounded ${
              isVerify ? 'bg-green-100 text-green-700' : 'bg-muted'
            }`}>
              {step.action_type}
            </span>
            {step.details && (
              <span className="truncate">{step.details}</span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleStartEdit}
            className="p-1.5 rounded hover:bg-blue-100"
            title="Edit step"
          >
            <Pencil className="h-4 w-4 text-blue-600" />
          </button>
          {showDeleteConfirm ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="destructive"
                className="h-7 px-2 text-xs"
                onClick={handleDelete}
              >
                Delete
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={handleCancelDelete}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <button
              onClick={handleDelete}
              className="p-1.5 rounded hover:bg-red-100"
              title="Delete step"
            >
              <Trash2 className="h-4 w-4 text-red-600" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
