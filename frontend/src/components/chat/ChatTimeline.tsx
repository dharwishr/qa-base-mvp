import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import ChatMessage from './ChatMessage';
import type { TimelineMessage } from '@/types/chat';

interface ChatTimelineProps {
  messages: TimelineMessage[];
  isLoading?: boolean;
  loadingText?: string;
  onApprove?: (planId: string) => void;
  onReject?: (planId: string) => void;
  onStepSelect?: (stepId: string) => void;
  selectedStepId?: string | null;
  onUndoToStep?: (stepNumber: number) => void;
  totalSteps?: number;
}

export default function ChatTimeline({
  messages,
  isLoading = false,
  loadingText = 'Processing...',
  onApprove,
  onReject,
  onStepSelect,
  selectedStepId,
  onUndoToStep,
  totalSteps = 0,
}: ChatTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4"
    >
      {/* Empty state */}
      {messages.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
          <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </div>
          <h3 className="font-medium text-foreground mb-1">Start a test</h3>
          <p className="text-sm max-w-xs">
            Describe what you want to test and I'll help you create and execute
            test steps.
          </p>
        </div>
      )}

      {/* Messages */}
      {messages.map((message) => (
        <ChatMessage
          key={message.id}
          message={message}
          onApprove={onApprove}
          onReject={onReject}
          onStepSelect={onStepSelect}
          isSelected={
            message.type === 'step' && message.step.id === selectedStepId
          }
          onUndoToStep={onUndoToStep}
          totalSteps={totalSteps}
        />
      ))}

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex justify-start">
          <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 rounded-2xl">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{loadingText}</span>
          </div>
        </div>
      )}

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
}
