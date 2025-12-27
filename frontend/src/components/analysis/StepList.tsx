import { ChevronDown, ChevronRight, ExternalLink, CheckCircle, XCircle, Clock, Trash2, Circle, Bot } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { useState } from "react"
import type { TestStep as AnalysisTestStep } from "@/types/analysis"

// Extended TestStep interface for display
export interface TestStep extends Omit<Partial<AnalysisTestStep>, 'id'> {
    id: string | number
    description: string
}

interface StepListProps {
    steps: TestStep[]
    setSteps?: (steps: TestStep[]) => void
    selectedStepId?: string | number | null
    onStepSelect?: (step: TestStep) => void
    onClear?: () => void
}

function StatusIcon({ status }: { status?: string }) {
    switch (status) {
        case 'completed':
            return <CheckCircle className="h-4 w-4 text-green-500" />
        case 'failed':
            return <XCircle className="h-4 w-4 text-red-500" />
        case 'running':
            return <Clock className="h-4 w-4 text-yellow-500 animate-pulse" />
        default:
            return <Clock className="h-4 w-4 text-muted-foreground" />
    }
}

export default function StepList({ steps, selectedStepId, onStepSelect, onClear }: StepListProps) {
    const [expandedSteps, setExpandedSteps] = useState<Set<string | number>>(new Set())

    const toggleExpand = (id: string | number) => {
        setExpandedSteps(prev => {
            const newSet = new Set(prev)
            if (newSet.has(id)) {
                newSet.delete(id)
            } else {
                newSet.add(id)
            }
            return newSet
        })
    }

    const hasDetails = (step: TestStep) => {
        return step.thinking || step.url || step.actions?.length
    }

    // Check if step is user-recorded (has any action with source: 'user')
    const isUserRecorded = (step: TestStep) => {
        return step.actions?.some(action =>
            action.action_params &&
            typeof action.action_params === 'object' &&
            'source' in action.action_params &&
            action.action_params.source === 'user'
        ) ?? false
    }

    return (
        <div className="flex flex-col flex-1 bg-background min-h-0">
            <div className="p-4 border-b flex justify-between items-center bg-muted/20">
                <h3 className="font-semibold text-sm">Execution Steps</h3>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{steps.length} steps</span>
                    {onClear && steps.length > 0 && (
                        <button
                            onClick={onClear}
                            className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded transition-colors"
                            title="Clear all steps"
                        >
                            <Trash2 className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
                {steps.map((step, index) => {
                    const isExpanded = expandedSteps.has(step.id)
                    const showDetails = hasDetails(step)
                    const isSelected = selectedStepId === step.id
                    const isUserStep = isUserRecorded(step)

                    return (
                        <div key={step.id}>
                            <Card
                                className={`border-l-4 transition-all cursor-pointer ${step.status === 'completed' ? 'border-l-green-500' :
                                    step.status === 'failed' ? 'border-l-red-500' :
                                        step.status === 'running' ? 'border-l-yellow-500' :
                                            'border-l-primary/50'
                                    } ${isSelected ? 'ring-2 ring-primary bg-primary/5' : 'hover:bg-muted/30'} ${isUserStep ? 'bg-red-50/30' : ''}`}
                                onClick={() => onStepSelect?.(step)}
                            >
                                <CardContent className="p-3">
                                    {/* Main Step Row */}
                                    <div
                                        className={`flex items-start gap-3 ${showDetails ? 'cursor-pointer' : ''}`}
                                        onClick={(e) => {
                                            if (showDetails) {
                                                e.stopPropagation()
                                                toggleExpand(step.id)
                                            }
                                        }}
                                    >
                                        {/* Step Number & Status */}
                                        <div className="flex items-center gap-2 pt-0.5">
                                            <span className="font-mono text-muted-foreground text-sm w-5">
                                                {step.step_number || index + 1}
                                            </span>
                                            <StatusIcon status={step.status} />
                                        </div>

                                        {/* Description */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-medium">{step.description}</p>
                                                {/* Source indicator */}
                                                {isUserStep ? (
                                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
                                                        <Circle className="h-2 w-2 fill-red-500" />
                                                        User
                                                    </span>
                                                ) : step.thinking ? (
                                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                                                        <Bot className="h-2 w-2" />
                                                        AI
                                                    </span>
                                                ) : null}
                                            </div>
                                            {step.url && (
                                                <div className="flex items-center gap-1 mt-1">
                                                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                                    <span className="text-xs text-muted-foreground truncate">
                                                        {step.url}
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Expand Toggle */}
                                        {showDetails && (
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
                                    {isExpanded && showDetails && (
                                        <div className="mt-3 pt-3 border-t space-y-3">
                                            {/* Thinking */}
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

                                            {/* Evaluation */}
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

                                            {/* Actions */}
                                            {step.actions && step.actions.length > 0 && (
                                                <div>
                                                    <div className="text-xs font-medium text-muted-foreground mb-1">
                                                        Actions ({step.actions.length})
                                                    </div>
                                                    <div className="space-y-1">
                                                        {step.actions.map((action, idx) => {
                                                            const isUserAction = action.action_params &&
                                                                typeof action.action_params === 'object' &&
                                                                'source' in action.action_params &&
                                                                action.action_params.source === 'user'

                                                            return (
                                                                <div
                                                                    key={action.id || idx}
                                                                    className={`text-xs p-2 rounded flex items-center gap-2 ${action.result_success ? 'bg-green-50' :
                                                                        action.result_error ? 'bg-red-50' : 'bg-muted/50'
                                                                        }`}
                                                                >
                                                                    {action.result_success !== null && (
                                                                        action.result_success ? (
                                                                            <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                                                                        ) : (
                                                                            <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                                                                        )
                                                                    )}
                                                                    <span className="font-mono">{action.action_name}</span>
                                                                    {action.element_name && (
                                                                        <span className="text-muted-foreground">
                                                                            → {action.element_name}
                                                                        </span>
                                                                    )}
                                                                    {isUserAction && (
                                                                        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-red-100 text-red-600">
                                                                            <Circle className="h-1.5 w-1.5 fill-red-500" />
                                                                            recorded
                                                                        </span>
                                                                    )}
                                                                    {action.result_error && (
                                                                        <span className="text-red-600 truncate">
                                                                            {action.result_error}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Error */}
                                            {step.error && (
                                                <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                                                    Error: {step.error}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    )
                })}
                {steps.length === 0 && (
                    <div className="text-center text-muted-foreground py-8">
                        No steps yet. Start a test to see execution steps.
                    </div>
                )}
            </div>
        </div>
    )
}
