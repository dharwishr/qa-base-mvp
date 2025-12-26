import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send, FileText, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatMode } from '@/types/chat';

interface ChatInputProps {
  onSend: (message: string, mode: ChatMode) => void;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  disabled?: boolean;
  placeholder?: string;
  isExecuting?: boolean;
}

export default function ChatInput({
  onSend,
  mode,
  onModeChange,
  disabled = false,
  placeholder = 'Describe what you want to test...',
  isExecuting = false,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        150
      )}px`;
    }
  }, [input]);

  // Determine if input should be completely blocked
  const isBlocked = disabled || isExecuting;

  const handleSend = () => {
    const trimmed = input.trim();
    if (trimmed && !isBlocked) {
      onSend(trimmed, mode);
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Block Enter key when executing or disabled
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isBlocked) {
        handleSend();
      }
    }
  };

  // Dynamic placeholder based on mode and execution state
  const dynamicPlaceholder = isExecuting
    ? 'Waiting for execution to complete...'
    : mode === 'plan'
    ? 'Describe your test case to generate a plan...'
    : 'Describe what you want the browser to do...';

  return (
    <div className="border-t bg-background p-4">
      {/* Mode Toggle */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-muted-foreground">Mode:</span>
        <div className="inline-flex rounded-lg border bg-muted p-0.5">
          <button
            type="button"
            onClick={() => onModeChange('plan')}
            disabled={isBlocked}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              mode === 'plan'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            } ${isBlocked ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <FileText className="h-3.5 w-3.5" />
            Plan
          </button>
          <button
            type="button"
            onClick={() => onModeChange('act')}
            disabled={isBlocked}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              mode === 'act'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            } ${isBlocked ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Zap className="h-3.5 w-3.5" />
            Act
          </button>
        </div>
        <span className="text-xs text-muted-foreground ml-2">
          {isExecuting
            ? 'Please wait for execution to complete'
            : mode === 'plan'
            ? 'Generate a plan first, then execute'
            : 'Execute actions directly'}
        </span>
      </div>

      {/* Input Area */}
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || dynamicPlaceholder}
            disabled={isBlocked}
            rows={1}
            className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px] max-h-[150px]"
          />
        </div>
        <Button
          size="icon"
          onClick={handleSend}
          disabled={isBlocked || !input.trim()}
          className="h-11 w-11 rounded-xl flex-shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Helper text */}
      <div className="mt-2 text-xs text-muted-foreground">
        Press <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Enter</kbd>{' '}
        to send,{' '}
        <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Shift+Enter</kbd>{' '}
        for new line
      </div>
    </div>
  );
}
