import { useState, useRef, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import { Pencil, Check, X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface EditableTextProps {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  className?: string;
  disabled?: boolean;
}

export default function EditableText({ value, onSave, className, disabled }: EditableTextProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update editValue when value prop changes (e.g., from external update)
  useEffect(() => {
    if (!isEditing) {
      setEditValue(value);
    }
  }, [value, isEditing]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) {
      setIsEditing(true);
      setError(null);
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(false);
    setEditValue(value);
    setError(null);
  };

  const handleSave = async (e?: React.MouseEvent | KeyboardEvent<HTMLInputElement>) => {
    e?.stopPropagation();
    if (editValue === value) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave(editValue);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave(e);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsEditing(false);
      setEditValue(value);
      setError(null);
    }
  };

  if (isEditing) {
    return (
      <div
        className={cn("flex items-center gap-1", className)}
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-6 text-xs px-1.5 py-0.5 w-40"
          disabled={isSaving}
        />
        {isSaving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <button
              onClick={(e) => handleSave(e)}
              className="p-0.5 hover:bg-green-100 rounded transition-colors"
              title="Save (Enter)"
            >
              <Check className="h-3.5 w-3.5 text-green-600" />
            </button>
            <button
              onClick={handleCancel}
              className="p-0.5 hover:bg-red-100 rounded transition-colors"
              title="Cancel (Esc)"
            >
              <X className="h-3.5 w-3.5 text-red-600" />
            </button>
          </>
        )}
        {error && (
          <span className="text-[10px] text-red-500 ml-1">{error}</span>
        )}
      </div>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 group cursor-pointer",
        disabled && "cursor-default",
        className
      )}
      onClick={handleStartEdit}
      title={disabled ? undefined : "Click to edit"}
    >
      <span className="text-blue-600 font-mono">"{value}"</span>
      {!disabled && (
        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </span>
  );
}
