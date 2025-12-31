import { useState, useEffect } from 'react';
import { X, Save, Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { StepAction } from '@/types/analysis';

interface ActionEditDialogProps {
  action: StepAction;
  isOpen: boolean;
  onSave: (updates: { element_xpath?: string; css_selector?: string; text?: string }) => Promise<void>;
  onCancel: () => void;
}

export default function ActionEditDialog({
  action,
  isOpen,
  onSave,
  onCancel,
}: ActionEditDialogProps) {
  const [xpath, setXpath] = useState('');
  const [cssSelector, setCssSelector] = useState('');
  const [text, setText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if this is a text input action
  const isTextAction = ['type_text', 'input_text', 'type', 'input', 'fill'].includes(
    action.action_name?.toLowerCase() || ''
  );

  // Initialize form values when action changes
  useEffect(() => {
    if (action) {
      setXpath(action.element_xpath || '');
      setCssSelector(
        (action.action_params?.css_selector as string) ||
        (action.action_params?.cssSelector as string) ||
        (action.action_params?.selector as string) ||
        ''
      );
      setText(
        (action.action_params?.text as string) ||
        (action.action_params?.value as string) ||
        ''
      );
      setError(null);
    }
  }, [action]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const updates: { element_xpath?: string; css_selector?: string; text?: string } = {};

      // Only include fields that changed
      const originalXpath = action.element_xpath || '';
      const originalCss =
        (action.action_params?.css_selector as string) ||
        (action.action_params?.cssSelector as string) ||
        (action.action_params?.selector as string) ||
        '';
      const originalText =
        (action.action_params?.text as string) ||
        (action.action_params?.value as string) ||
        '';

      if (xpath !== originalXpath) {
        updates.element_xpath = xpath;
      }
      if (cssSelector !== originalCss) {
        updates.css_selector = cssSelector;
      }
      if (isTextAction && text !== originalText) {
        updates.text = text;
      }

      if (Object.keys(updates).length > 0) {
        await onSave(updates);
      }
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border-b border-blue-200">
          <Pencil className="h-5 w-5 text-blue-600" />
          <h3 className="font-semibold text-blue-800">
            Edit Action: {action.action_name}
          </h3>
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="ml-auto p-1 hover:bg-blue-100 rounded disabled:opacity-50"
          >
            <X className="h-4 w-4 text-blue-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* XPath Field */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              XPath Selector
            </label>
            <Input
              value={xpath}
              onChange={(e) => setXpath(e.target.value)}
              placeholder="//button[@id='submit']"
              disabled={isSaving}
              className="font-mono text-sm"
            />
          </div>

          {/* CSS Selector Field */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              CSS Selector
            </label>
            <Input
              value={cssSelector}
              onChange={(e) => setCssSelector(e.target.value)}
              placeholder="#submit, .btn-primary"
              disabled={isSaving}
              className="font-mono text-sm"
            />
          </div>

          {/* Text/Input Value Field - Only for type_text actions */}
          {isTextAction && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Input Value
              </label>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Enter text value..."
                disabled={isSaving}
              />
            </div>
          )}

          {/* Error Message */}
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
              {error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-4 py-3 bg-muted/20 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-1" />
                Save
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
