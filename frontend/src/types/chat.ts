// Chat and timeline types for the chat-based test analysis UI

import type { TestStep, TestPlan, LlmModel } from './analysis';

export type MessageType = 'user' | 'assistant' | 'plan' | 'step' | 'error' | 'system';

export type ChatMode = 'plan' | 'act';

export type PlanStatus = 'pending' | 'approved' | 'rejected' | 'executing';

// Plan step from plan_text (simplified version shown in plan message)
export interface PlanStep {
  step_number: number;
  description: string;
  action_type: string;
  details: string;
}

// Base message interface
interface BaseMessage {
  id: string;
  timestamp: string;
}

// User message - what the user typed
export interface UserMessage extends BaseMessage {
  type: 'user';
  content: string;
  mode: ChatMode;
}

// Assistant message - system responses, status updates
export interface AssistantMessage extends BaseMessage {
  type: 'assistant';
  content: string;
}

// Plan message - generated plan with approval buttons
export interface PlanMessage extends BaseMessage {
  type: 'plan';
  planId: string;
  planText: string;
  planSteps: PlanStep[];
  status: PlanStatus;
}

// Step message - execution step (wraps TestStep)
export interface StepMessage extends BaseMessage {
  type: 'step';
  step: TestStep;
}

// Error message
export interface ErrorMessage extends BaseMessage {
  type: 'error';
  content: string;
}

// System message - notifications, status changes
export interface SystemMessage extends BaseMessage {
  type: 'system';
  content: string;
}

// Waiting message - shown when message is queued
export interface WaitingMessage extends BaseMessage {
  type: 'waiting';
  content: string;
  queuePosition: number;
  queuedMessageId: string;
}

// Union type for all message types
export type TimelineMessage =
  | UserMessage
  | AssistantMessage
  | PlanMessage
  | StepMessage
  | ErrorMessage
  | SystemMessage
  | WaitingMessage;

// Queued message awaiting execution
export interface QueuedMessage {
  id: string;
  text: string;
  mode: ChatMode;
  timestamp: string;
}

// Queue failure state for user decision
export interface QueueFailure {
  error: string;
  pendingMessages: QueuedMessage[];
}

// Chat session state
export interface ChatSessionState {
  sessionId: string | null;
  browserSessionId: string | null;
  messages: TimelineMessage[];
  mode: ChatMode;
  selectedLlm: LlmModel;
  headless: boolean;
  isGeneratingPlan: boolean;
  isExecuting: boolean;
  isPlanPending: boolean;
  pendingPlanId: string | null;
  selectedStepId: string | null;
  error: string | null;
}

// WebSocket command types for interactive messaging
export interface WSInjectCommand {
  command: 'inject_command';
  content: string;
}

export interface WSCommandReceived {
  type: 'command_received';
  content: string;
}

export interface WSPlanGenerated {
  type: 'plan_generated';
  plan: TestPlan;
}

// Run Till End types (state for UI, not WS messages - WS messages are in analysis.ts)
export interface RunTillEndPausedState {
  stepNumber: number;
  error: string;
  isSkipped?: boolean; // true after user clicks Skip, shows Continue button
}

// Generate UUID with fallback for non-secure contexts (HTTP)
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Helper function to create messages
export function createMessage<T extends TimelineMessage>(
  type: T['type'],
  data: Omit<T, 'id' | 'timestamp' | 'type'>
): T {
  return {
    id: generateUUID(),
    timestamp: new Date().toISOString(),
    type,
    ...data,
  } as T;
}
