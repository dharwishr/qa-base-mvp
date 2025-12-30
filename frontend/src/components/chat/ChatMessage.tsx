import { useState } from 'react';
import {
  User,
  Bot,
  AlertCircle,
  Info,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  RotateCcw,
  Check,
  X,
  SkipForward,
  Trash2,
} from 'lucide-react';
import { SimpleActionRow } from '@/components/analysis/StepList';
import StepFailureOptions from '@/components/analysis/StepFailureOptions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type {
  TimelineMessage,
  UserMessage,
  AssistantMessage,
  PlanMessage,
  StepMessage,
  ErrorMessage,
  SystemMessage,
  RunTillEndPausedState,
} from '@/types/chat';

interface ChatMessageProps {
  message: TimelineMessage;
  onApprove?: (planId: string) => void;
  onReject?: (planId: string) => void;
  onStepSelect?: (stepId: string) => void;
  isSelected?: boolean;
  onUndoToStep?: (stepNumber: number) => void;
  totalSteps?: number;
  simpleMode?: boolean;
  stepIndex?: number;
  startingActionNumber?: number;
  // Run Till End props
  runTillEndPaused?: RunTillEndPausedState | null;
  skippedSteps?: number[];
  onSkipStep?: (stepNumber: number) => void;
  onContinueRunTillEnd?: () => void;
  currentExecutingStepNumber?: number | null;
  // Delete step props
  onDeleteStep?: (stepId: string, stepNumber: number) => void;
  canDeleteSteps?: boolean;
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// User message component - right-aligned
function UserMessageBubble({ message }: { message: UserMessage }) {
  return (
    <div className="flex justify-end">
      <div className="flex items-start gap-2 max-w-[80%]">
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-xs text-muted-foreground">
              {formatTime(message.timestamp)}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {message.mode === 'plan' ? 'Plan' : 'Act'}
            </span>
          </div>
          <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2">
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
          <User className="h-4 w-4 text-primary" />
        </div>
      </div>
    </div>
  );
}

// Assistant message component - left-aligned
function AssistantMessageBubble({ message }: { message: AssistantMessage }) {
  return (
    <div className="flex justify-start">
      <div className="flex items-start gap-2 max-w-[80%]">
        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
          <Bot className="h-4 w-4 text-secondary-foreground" />
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-1">
            {formatTime(message.timestamp)}
          </span>
          <div className="bg-secondary text-secondary-foreground rounded-2xl rounded-tl-sm px-4 py-2">
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Plan message component - shows plan with approve/reject buttons
function PlanMessageCard({
  message,
  onApprove,
  onReject,
}: {
  message: PlanMessage;
  onApprove?: (planId: string) => void;
  onReject?: (planId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const isPending = message.status === 'pending';
  const isApproved = message.status === 'approved';
  const isRejected = message.status === 'rejected';
  const isExecuting = message.status === 'executing';

  return (
    <div className="flex justify-start">
      <div className="flex items-start gap-2 w-full min-w-0">
        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
          <FileText className="h-4 w-4 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs text-muted-foreground mb-1 block">
            {formatTime(message.timestamp)}
          </span>
          <Card
            className={`border-l-4 ${isApproved || isExecuting
              ? 'border-l-green-500'
              : isRejected
                ? 'border-l-red-500'
                : 'border-l-blue-500'
              }`}
          >
            <CardContent className="p-4">
              {/* Header */}
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">Generated Plan</span>
                  {isApproved && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                      Approved
                    </span>
                  )}
                  {isExecuting && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 flex items-center gap-1">
                      <Clock className="h-3 w-3 animate-pulse" />
                      Executing
                    </span>
                  )}
                  {isRejected && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                      Rejected
                    </span>
                  )}
                </div>
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {/* Plan Content */}
              {isExpanded && (
                <div className="mt-3 space-y-3">
                  {/* Plan Text */}
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/30 p-3 rounded">
                    {message.planText}
                  </div>

                  {/* Plan Steps */}
                  {message.planSteps.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground">
                        Steps:
                      </div>
                      {message.planSteps.map((step) => (
                        <div
                          key={step.step_number}
                          className="text-xs pl-2 border-l-2 border-blue-300 py-1"
                        >
                          <span className="font-medium">
                            {step.step_number}.
                          </span>{' '}
                          {step.description}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action Buttons - only show when pending */}
                  {isPending && (
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        className="flex-1 bg-green-600 hover:bg-green-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          onApprove?.(message.planId);
                        }}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Approve & Execute
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-300 text-red-600 hover:bg-red-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          onReject?.(message.planId);
                        }}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Step message component - reuses StepList card styling
function StepMessageCard({
  message,
  onStepSelect,
  isSelected,
  onUndoToStep,
  totalSteps = 0,
  simpleMode = false,
  stepIndex,
  startingActionNumber = 0,
  runTillEndPaused,
  skippedSteps = [],
  onSkipStep,
  onContinueRunTillEnd,
  currentExecutingStepNumber,
  onDeleteStep,
  canDelete = false,
}: {
  message: StepMessage;
  onStepSelect?: (stepId: string) => void;
  isSelected?: boolean;
  onUndoToStep?: (stepNumber: number) => void;
  totalSteps?: number;
  simpleMode?: boolean;
  stepIndex?: number;
  startingActionNumber?: number;
  runTillEndPaused?: RunTillEndPausedState | null;
  skippedSteps?: number[];
  onSkipStep?: (stepNumber: number) => void;
  onContinueRunTillEnd?: () => void;
  currentExecutingStepNumber?: number | null;
  onDeleteStep?: (stepId: string, stepNumber: number) => void;
  canDelete?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showUndoHint, setShowUndoHint] = useState(false);
  const step = message.step;

  // Use stepIndex (1-based position in timeline) when available, otherwise fall back to step.step_number
  const displayStepNumber = stepIndex ?? step.step_number;

  const hasDetails = step.thinking || step.evaluation || step.actions?.length;
  const canUndo = onUndoToStep && step.step_number < totalSteps && step.status === 'completed';

  // Run Till End: check if this step is skipped, has failure options, or is currently executing
  const isStepSkipped = skippedSteps.includes(step.step_number);
  const showFailureOptions = runTillEndPaused?.stepNumber === step.step_number;
  const isCurrentlyExecuting = currentExecutingStepNumber === step.step_number;

  const StatusIcon = () => {
    // Show executing animation for currently executing step
    if (isCurrentlyExecuting) {
      return <Clock className="h-4 w-4 text-blue-500 animate-pulse" />;
    }
    // Show skipped icon for skipped steps
    if (isStepSkipped) {
      return <SkipForward className="h-4 w-4 text-gray-400" />;
    }
    switch (step.status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'running':
        return <Clock className="h-4 w-4 text-yellow-500 animate-pulse" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  if (simpleMode) {
    const actions = step.actions || []

    // Filter out file operation actions in simple mode
    const filteredActions = actions.filter(action => {
      const actionName = action.action_name?.toLowerCase() || '';
      return !['replace_file', 'read_file', 'write_file'].includes(actionName);
    });

    // Skip steps without relevant actions in simple mode
    if (filteredActions.length === 0) {
      return null;
    }

    return (
      <div className="flex justify-start w-full group" data-step-number={step.step_number}>
        <div className="space-y-1.5 w-full">
          {filteredActions.map((action, idx) => {
            const actionNumber = startingActionNumber + idx + 1;
            return (
              <div key={action.id || idx} className="flex items-start gap-2">
                <span className="font-mono text-muted-foreground text-sm w-6 pt-2 flex-shrink-0 text-right">
                  {actionNumber}
                </span>
                <div className="flex-1">
                  <SimpleActionRow
                    action={action}
                  />
                </div>
                {/* Delete button - only show on first action row, when canDelete */}
                {idx === 0 && canDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-red-600 hover:text-red-700 hover:bg-red-50 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteStep?.(step.id, step.step_number);
                    }}
                    title="Delete step"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    )
  }

  // Determine border color based on status, skipped state, and executing state
  const getBorderColor = () => {
    if (isCurrentlyExecuting) return 'border-l-blue-500';
    if (isStepSkipped) return 'border-l-gray-400';
    switch (step.status) {
      case 'completed': return 'border-l-green-500';
      case 'failed': return 'border-l-red-500';
      case 'running': return 'border-l-yellow-500';
      default: return 'border-l-primary/50';
    }
  };

  // Determine background color for the status icon
  const getStatusBgColor = () => {
    if (isCurrentlyExecuting) return 'bg-blue-100';
    if (isStepSkipped) return 'bg-gray-100';
    switch (step.status) {
      case 'completed': return 'bg-green-100';
      case 'failed': return 'bg-red-100';
      case 'running': return 'bg-yellow-100';
      default: return 'bg-muted';
    }
  };

  return (
    <div className="flex justify-start" data-step-number={step.step_number}>
      <div className="flex items-start gap-2 w-full min-w-0">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${getStatusBgColor()}`}
        >
          <StatusIcon />
        </div>
        <div className="flex-1 min-w-0 overflow-hidden">
          <span className="text-xs text-muted-foreground mb-1 block">
            Step {displayStepNumber} - {formatTime(message.timestamp)}
            {isStepSkipped && <span className="ml-2 text-gray-400">(Skipped)</span>}
            {isCurrentlyExecuting && <span className="ml-2 text-blue-600 font-medium animate-pulse">(Running...)</span>}
          </span>
          <Card
            className={`border-l-4 cursor-pointer transition-all ${getBorderColor()} ${isStepSkipped ? 'opacity-60' : ''
              } ${isCurrentlyExecuting ? 'ring-2 ring-blue-300 bg-blue-50' : ''} ${isSelected && !isCurrentlyExecuting ? 'ring-2 ring-primary bg-primary/5' : 'hover:bg-muted/30'}`}
            onClick={() => onStepSelect?.(step.id)}
          >
            <CardContent className="p-3 overflow-hidden">
              {/* Main Row */}
              <div
                className="flex items-start gap-3"
                onClick={(e) => {
                  if (hasDetails) {
                    e.stopPropagation();
                    setIsExpanded(!isExpanded);
                  }
                }}
              >
                <div className="flex-1 min-w-0 overflow-hidden">
                  <p className="text-sm font-medium break-words">
                    {step.next_goal || `Step ${displayStepNumber}`}
                  </p>
                  {step.url && (
                    <div className="flex items-center gap-1 mt-1 min-w-0">
                      <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs text-muted-foreground truncate">
                        {step.url}
                      </span>
                    </div>
                  )}
                </div>
                {hasDetails && (
                  <div className="pt-0.5">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                )}
              </div>

              {/* Expanded Details */}
              {isExpanded && hasDetails && (
                <div className="mt-3 pt-3 border-t space-y-3">
                  {step.thinking && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">
                        Thinking
                      </div>
                      <div className="text-xs bg-muted/50 p-2 rounded whitespace-pre-wrap">
                        {step.thinking}
                      </div>
                    </div>
                  )}

                  {step.evaluation && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">
                        Evaluation
                      </div>
                      <div className="text-xs bg-muted/50 p-2 rounded">
                        {step.evaluation}
                      </div>
                    </div>
                  )}

                  {step.actions && step.actions.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">
                        Actions ({step.actions.length})
                      </div>
                      <div className="space-y-1">
                        {step.actions.map((action, idx) => (
                          <div
                            key={action.id || idx}
                            className={`text-xs p-2 rounded flex items-center gap-2 ${action.result_success
                              ? 'bg-green-50'
                              : action.result_error
                                ? 'bg-red-50'
                                : 'bg-muted/50'
                              }`}
                          >
                            {action.result_success !== null &&
                              (action.result_success ? (
                                <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                              ) : (
                                <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                              ))}
                            <span className="font-mono">{action.action_name}</span>
                            {action.element_name && (
                              <span className="text-muted-foreground">
                                → {action.element_name}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {step.error && (
                    <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                      Error: {step.error}
                    </div>
                  )}
                </div>
              )}

              {/* Undo button - shown on hover when this isn't the last step */}
              {canUndo && !showFailureOptions && (
                <div
                  className="mt-2 pt-2 border-t flex justify-end"
                  onMouseEnter={() => setShowUndoHint(true)}
                  onMouseLeave={() => setShowUndoHint(false)}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUndoToStep?.(step.step_number);
                    }}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Undo till here
                  </Button>
                  {showUndoHint && (
                    <span className="text-xs text-muted-foreground self-center ml-2">
                      Removes steps {step.step_number + 1}–{totalSteps}
                    </span>
                  )}
                </div>
              )}

              {/* Run Till End failure options - shown inline when this step failed */}
              {showFailureOptions && runTillEndPaused && (
                <StepFailureOptions
                  stepNumber={step.step_number}
                  error={runTillEndPaused.error}
                  isSkipped={runTillEndPaused.isSkipped}
                  onUndo={() => onUndoToStep?.(step.step_number)}
                  onSkip={() => onSkipStep?.(step.step_number)}
                  onContinue={() => onContinueRunTillEnd?.()}
                />
              )}

              {/* Delete button - shown when canDelete is true and no failure options */}
              {canDelete && !showFailureOptions && (
                <div className="mt-2 pt-2 border-t flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteStep?.(step.id, step.step_number);
                    }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Error message component
function ErrorMessageBubble({ message }: { message: ErrorMessage }) {
  return (
    <div className="flex justify-start">
      <div className="flex items-start gap-2 max-w-[80%]">
        <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
          <AlertCircle className="h-4 w-4 text-red-600" />
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-1">
            {formatTime(message.timestamp)}
          </span>
          <div className="bg-red-50 text-red-700 rounded-2xl rounded-tl-sm px-4 py-2 border border-red-200">
            <p className="text-sm">{message.content}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// System message component - centered, muted
function SystemMessageBubble({ message }: { message: SystemMessage }) {
  return (
    <div className="flex justify-center">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-full">
        <Info className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{message.content}</span>
      </div>
    </div>
  );
}

// Main ChatMessage component
export default function ChatMessage({
  message,
  onApprove,
  onReject,
  onStepSelect,
  isSelected,
  onUndoToStep,
  totalSteps,
  simpleMode,
  stepIndex,
  startingActionNumber,
  runTillEndPaused,
  skippedSteps,
  onSkipStep,
  onContinueRunTillEnd,
  currentExecutingStepNumber,
  onDeleteStep,
  canDeleteSteps,
}: ChatMessageProps) {
  switch (message.type) {
    case 'user':
      return <UserMessageBubble message={message} />;
    case 'assistant':
      return <AssistantMessageBubble message={message} />;
    case 'plan':
      return (
        <PlanMessageCard
          message={message}
          onApprove={onApprove}
          onReject={onReject}
        />
      );
    case 'step':
      return (
        <StepMessageCard
          message={message}
          onStepSelect={onStepSelect}
          isSelected={isSelected}
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
          canDelete={canDeleteSteps}
        />
      );
    case 'error':
      return <ErrorMessageBubble message={message} />;
    case 'system':
      return <SystemMessageBubble message={message} />;
    default:
      return null;
  }
}
