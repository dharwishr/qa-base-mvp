import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send, FileText, Zap, Mic, Square, Loader2, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatMode } from '@/types/chat';
import { useVoiceInput } from '@/hooks/useVoiceInput';

interface ChatInputProps {
  onSend: (message: string, mode: ChatMode) => void;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  disabled?: boolean;
  placeholder?: string;
  isExecuting?: boolean;
  initialValue?: string;
  onInitialValueConsumed?: () => void;
}

export default function ChatInput({
  onSend,
  mode,
  onModeChange,
  disabled = false,
  placeholder = 'Describe what you want to test...',
  isExecuting = false,
  initialValue,
  onInitialValueConsumed,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [hintModeEnabled, setHintModeEnabled] = useState(false);

  // Set initial value when provided (e.g., after reset)
  useEffect(() => {
    if (initialValue) {
      setInput(initialValue);
      onInitialValueConsumed?.();
    }
  }, [initialValue, onInitialValueConsumed]);

  // Reset hint mode when execution ends
  useEffect(() => {
    if (!isExecuting) {
      setHintModeEnabled(false);
    }
  }, [isExecuting]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Voice input hook
  const {
    isListening,
    isProcessing,
    error: voiceError,
    isSupported: isVoiceSupported,
    unsupportedReason,
    startListening,
    stopListening,
  } = useVoiceInput({
    onTranscript: (text) => {
      setInput((prev) => {
        const trimmed = prev.trim();
        return trimmed ? `${trimmed} ${text}` : text;
      });
    },
    onError: (error) => {
      console.error('Voice input error:', error);
    },
  });

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

  // During execution, input is blocked unless hint mode is enabled
  const isBlocked = disabled || (isExecuting && !hintModeEnabled);

  const handleSend = () => {
    const trimmed = input.trim();
    if (trimmed && !isBlocked) {
      // When executing with hint mode, send as 'hint' mode
      const sendMode: ChatMode = (isExecuting && hintModeEnabled) ? 'hint' : mode;
      onSend(trimmed, sendMode);
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isBlocked) {
        handleSend();
      }
    }
  };

  const handleMicClick = async () => {
    if (isListening) {
      await stopListening();
    } else {
      await startListening();
    }
  };

  const dynamicPlaceholder = isExecuting
    ? (hintModeEnabled
      ? 'Send a hint to help the AI (e.g., "Try clicking the login button")...'
      : 'Enable Hint Mode to send guidance to the AI...')
    : mode === 'plan'
    ? 'Describe your test case to generate a plan...'
    : 'Describe what you want the browser to do...';

  return (
    <div className="border-t bg-background p-4">
      {/* Mode Toggle */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-muted-foreground">Mode:</span>
        {isExecuting ? (
          /* During execution: show Hint Mode toggle */
          <button
            type="button"
            onClick={() => setHintModeEnabled(!hintModeEnabled)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors cursor-pointer ${
              hintModeEnabled
                ? 'bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-700'
                : 'bg-muted border-border hover:border-amber-300 dark:hover:border-amber-700'
            }`}
          >
            <Lightbulb className={`h-4 w-4 ${hintModeEnabled ? 'text-amber-500' : 'text-muted-foreground'}`} />
            <span className={`text-xs font-medium ${hintModeEnabled ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>
              Hint Mode
            </span>
            <div className={`ml-1 w-8 h-4 rounded-full transition-colors ${
              hintModeEnabled ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'
            }`}>
              <div className={`w-3 h-3 rounded-full bg-white shadow-sm transform transition-transform mt-0.5 ${
                hintModeEnabled ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'
              }`} />
            </div>
          </button>
        ) : (
          /* Normal: show Plan/Act toggle */
          <div className="inline-flex rounded-lg border bg-muted p-0.5">
            <button
              type="button"
              onClick={() => onModeChange('plan')}
              disabled={disabled}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'plan'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <FileText className="h-3.5 w-3.5" />
              Plan
            </button>
            <button
              type="button"
              onClick={() => onModeChange('act')}
              disabled={disabled}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'act'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Zap className="h-3.5 w-3.5" />
              Act
            </button>
          </div>
        )}
        <span className="text-xs text-muted-foreground ml-2">
          {isExecuting
            ? (hintModeEnabled ? 'Send guidance to help the AI' : 'Enable to send hints during execution')
            : mode === 'plan'
            ? 'Generate a plan first, then execute'
            : 'Execute actions directly'}
        </span>

        {/* Listening indicator */}
        {isListening && (
          <div className="flex items-center gap-2 ml-auto text-red-500">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            <span className="text-xs font-medium">Listening...</span>
          </div>
        )}

        {/* Voice error indicator */}
        {voiceError && !isListening && (
          <span className="text-xs text-red-500 ml-auto">{voiceError}</span>
        )}
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
        {/* Mic button */}
        <Button
          size="icon"
          variant={isListening ? "destructive" : "outline"}
          onClick={handleMicClick}
          disabled={isBlocked || isProcessing || !isVoiceSupported}
          className="h-11 w-11 rounded-xl flex-shrink-0"
          title={unsupportedReason || (isListening ? "Stop recording" : "Start voice input")}
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isListening ? (
            <Square className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </Button>
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
