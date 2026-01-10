import { useEffect, useRef, useCallback, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import ChatMessage from './ChatMessage';
import InsertActionButton from '@/components/analysis/InsertActionButton';
import type { TimelineMessage, RunTillEndPausedState, PlanStep } from '@/types/chat';

interface ChatTimelineProps {
  messages: TimelineMessage[];
  isLoading?: boolean;
  loadingText?: string;
  onApprove?: (planId: string) => void;
  onReject?: (planId: string) => void;
  onEditPlan?: (planId: string, planText: string, planSteps: PlanStep[]) => void;
  onStepSelect?: (stepId: string) => void;
  selectedStepId?: string | null;
  onActionSelect?: (actionId: string) => void;
  selectedActionId?: string | null;
  highlightedActionId?: string | null;
  onUndoToStep?: (stepNumber: number) => void;
  totalSteps?: number;
  simpleMode?: boolean;
  // Run Till End props
  runTillEndPaused?: RunTillEndPausedState | null;
  skippedSteps?: number[];
  onSkipStep?: (stepNumber: number) => void;
  onContinueRunTillEnd?: () => void;
  currentExecutingStepNumber?: number | null;
  // Delete step props
  onDeleteStep?: (stepId: string, stepNumber: number) => void;
  canDeleteSteps?: boolean;
  // Edit action props
  sessionStatus?: string;
  onActionUpdate?: (stepId: string, actionId: string, updates: { element_xpath?: string; css_selector?: string; text?: string }) => Promise<void>;
  // Toggle action enabled props
  onToggleActionEnabled?: (actionId: string, enabled: boolean) => Promise<void>;
  // Toggle auto-generate text props
  onToggleAutoGenerate?: (actionId: string, enabled: boolean) => Promise<void>;
  // Insert action/step props
  onInsertAction?: (stepId: string, actionIndex: number, actionName: string, params: Record<string, unknown>) => Promise<void>;
  onInsertStep?: (sessionId: string, stepNumber: number, actionName: string, params: Record<string, unknown>) => Promise<void>;
  sessionId?: string;
}

export default function ChatTimeline({
  messages,
  isLoading = false,
  loadingText = 'Processing...',
  onApprove,
  onReject,
  onEditPlan,
  onStepSelect,
  selectedStepId,
  onActionSelect,
  selectedActionId,
  highlightedActionId,
  onUndoToStep,
  totalSteps = 0,
  simpleMode = false,
  runTillEndPaused,
  skippedSteps = [],
  onSkipStep,
  onContinueRunTillEnd,
  currentExecutingStepNumber,
  onDeleteStep,
  canDeleteSteps,
  sessionStatus,
  onActionUpdate,
  onToggleActionEnabled,
  onToggleAutoGenerate,
  onInsertAction,
  onInsertStep,
  sessionId,
}: ChatTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom helper - ensures the bottom of the last message is visible
  const scrollToBottom = useCallback(() => {
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    });
  }, []);

  // Generate a signature of the last message to detect content changes
  const lastMessageSignature = useMemo(() => {
    if (messages.length === 0) return '';
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.type === 'plan') {
      return `plan-${lastMsg.id}-${lastMsg.status}-${lastMsg.planSteps.length}`;
    }
    if (lastMsg.type === 'step') {
      return `step-${lastMsg.id}-${lastMsg.step.status}-${lastMsg.step.actions?.length || 0}`;
    }
    return `${lastMsg.type}-${lastMsg.id}`;
  }, [messages]);

  // Auto-scroll when messages change (new message, content update, or loading state)
  // Track previous messages length to detect deletions
  const prevMessagesLengthRef = useRef(messages.length);

  // Auto-scroll when messages change (new message, content update, or loading state)
  useEffect(() => {
    // Only scroll if messages were added or updated, not if deleted (length decreased)
    if (messages.length >= prevMessagesLengthRef.current || isLoading) {
      scrollToBottom();
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length, lastMessageSignature, isLoading, scrollToBottom]);

  // Auto-scroll to failed step when Run Till End pauses
  useEffect(() => {
    if (runTillEndPaused) {
      const stepElement = document.querySelector(
        `[data-step-number="${runTillEndPaused.stepNumber}"]`
      );
      if (stepElement) {
        stepElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [runTillEndPaused]);

  // Auto-scroll to currently executing step during Run Till End
  useEffect(() => {
    if (currentExecutingStepNumber) {
      const stepElement = document.querySelector(
        `[data-step-number="${currentExecutingStepNumber}"]`
      );
      if (stepElement) {
        stepElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentExecutingStepNumber]);

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
      {messages.map((message, index) => {
        // Calculate step index (1-based) for step messages
        let stepIndex: number | undefined;
        let startingActionNumber: number | undefined;
        let isFirstStep = false;
        if (message.type === 'step') {
          const previousStepMessages = messages
            .slice(0, index)
            .filter((m) => m.type === 'step');
          stepIndex = previousStepMessages.length + 1;
          isFirstStep = previousStepMessages.length === 0;
          // Calculate starting action number (sum of all actions in previous steps)
          startingActionNumber = previousStepMessages.reduce((sum, m) => {
            if (m.type === 'step') {
              return sum + (m.step.actions?.length || 0);
            }
            return sum;
          }, 0);
        }

        // Check if editing is allowed
        const canEdit = sessionStatus ? ['completed', 'failed', 'stopped', 'paused'].includes(sessionStatus) : false;

        return (
          <div key={message.id}>
            {/* Insert step button before first step */}
            {simpleMode && isFirstStep && canEdit && sessionId && onInsertStep && (
              <InsertActionButton
                sessionId={sessionId}
                insertAtStepNumber={1}
                onInsertStep={onInsertStep}
                mode="step"
              />
            )}
            <ChatMessage
              message={message}
              onApprove={onApprove}
              onReject={onReject}
              onEditPlan={onEditPlan}
              onStepSelect={onStepSelect}
              isSelected={
                message.type === 'step' && message.step.id === selectedStepId
              }
              onActionSelect={onActionSelect}
              selectedActionId={selectedActionId}
              highlightedActionId={highlightedActionId}
              onUndoToStep={onUndoToStep}
              totalSteps={totalSteps}
              simpleMode={simpleMode}
              stepIndex={stepIndex}
              startingActionNumber={startingActionNumber}
              runTillEndPaused={runTillEndPaused}
              skippedSteps={skippedSteps}
              onSkipStep={onSkipStep}
              onContinueRunTillEnd={onContinueRunTillEnd}
              currentExecutingStepNumber={currentExecutingStepNumber}
              onDeleteStep={onDeleteStep}
              canDeleteSteps={canDeleteSteps}
              sessionStatus={sessionStatus}
              onActionUpdate={onActionUpdate}
              onToggleActionEnabled={onToggleActionEnabled}
              onToggleAutoGenerate={onToggleAutoGenerate}
              onInsertAction={onInsertAction}
            />
          </div>
        );
      })}

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
