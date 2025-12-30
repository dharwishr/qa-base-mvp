import { ChevronDown, ChevronRight, ExternalLink, CheckCircle, XCircle, Clock, Trash2, Circle, Bot, MousePointer, Type, Globe, Eye, Play, ArrowUp, ChevronUp, AlertTriangle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { useState } from "react"
import type { TestStep as AnalysisTestStep, StepAction } from "@/types/analysis"
import { analysisApi } from "@/services/api"
import EditableText from "./EditableText"

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
    onActionUpdate?: (stepId: string, updatedAction: StepAction) => void
    onDeleteStep?: (stepId: string) => Promise<void>
    isExecuting?: boolean
    simpleMode?: boolean
}

// Action type to icon mapping
export function getActionIcon(actionName: string) {
    const iconClass = "h-4 w-4"
    switch (actionName?.toLowerCase()) {
        case 'click':
        case 'click_element':
            return <MousePointer className={`${iconClass} text-blue-500`} />
        case 'type':
        case 'type_text':
        case 'input_text':
        case 'input':
        case 'fill':
            return <Type className={`${iconClass} text-green-500`} />
        case 'go_to_url':
        case 'navigate':
        case 'goto':
            return <Globe className={`${iconClass} text-purple-500`} />
        case 'scroll':
        case 'scroll_down':
        case 'scroll_up':
            return <ArrowUp className={`${iconClass} text-orange-500`} />
        case 'wait':
        case 'sleep':
            return <Clock className={`${iconClass} text-yellow-500`} />
        case 'screenshot':
        case 'extract':
            return <Eye className={`${iconClass} text-teal-500`} />
        case 'select':
        case 'select_option':
        case 'dropdown':
            return <ChevronDown className={`${iconClass} text-indigo-500`} />
        case 'done':
            return <CheckCircle className={`${iconClass} text-green-600`} />
        default:
            return <Play className={`${iconClass} text-gray-500`} />
    }
}

// Simple action row component for compact view
// Simple action row component for compact view
export interface SimpleActionRowProps {
    action: StepAction
    onTextUpdate?: (newText: string) => Promise<void>
}

export function SimpleActionRow({ action, onTextUpdate }: SimpleActionRowProps) {
    const [selectorOpen, setSelectorOpen] = useState(false)

    // Check if this is a text input action (various naming conventions)
    const isTypeTextAction = ['type_text', 'input_text', 'type', 'input', 'fill'].includes(action.action_name?.toLowerCase() || '')

    // Get the text value - could be in different fields depending on the source
    const textValue = isTypeTextAction
        ? (action.action_params?.text as string) ||
        (action.action_params?.value as string) ||
        (action.action_params?.input as string) ||
        null
        : null

    // Get XPath and CSS selector from action params
    const xpath = action.element_xpath || (action.action_params?.xpath as string) || null
    const cssSelector = (action.action_params?.cssSelector as string) || (action.action_params?.selector as string) || null
    const hasSelectorsOrParams = xpath || cssSelector || (action.action_params && Object.keys(action.action_params).length > 0)

    // Get element name or derive from action - check multiple possible fields
    const elementName = action.element_name ||
        (action.action_params?.element as string) ||
        (action.action_params?.field as string) ||
        (action.action_params?.label as string) ||
        (action.action_params?.placeholder as string) ||
        null

    // Get URL for navigation actions
    const navigateUrl = (action.action_name === 'go_to_url' || action.action_name === 'navigate' || action.action_name === 'goto')
        ? (action.action_params?.url as string)
        : null

    // Get selected option for select/dropdown actions
    const isSelectAction = ['select', 'select_option', 'dropdown'].includes(action.action_name?.toLowerCase() || '')
    const selectedOption = isSelectAction
        ? (action.action_params?.option as string) ||
        (action.action_params?.value as string) ||
        (action.action_params?.text as string) ||
        null
        : null

    return (
        <div className="border rounded-lg bg-background overflow-hidden">
            <div
                className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 transition-colors"
            >
                {/* Status Icon */}
                <div className="flex-shrink-0">
                    {action.result_success !== null ? (
                        action.result_success ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                            <XCircle className="h-4 w-4 text-red-500" />
                        )
                    ) : (
                        <Circle className="h-4 w-4 text-gray-300" />
                    )}
                </div>

                {/* Action Type Icon */}
                <div className="flex-shrink-0">
                    {getActionIcon(action.action_name)}
                </div>

                {/* Element/Field Name */}
                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    {elementName && (
                        <span className="font-medium text-sm truncate">{elementName}</span>
                    )}
                    {!elementName && navigateUrl && (
                        <span className="text-sm text-muted-foreground truncate">{navigateUrl}</span>
                    )}
                    {!elementName && !navigateUrl && (
                        <span className="text-sm font-mono text-muted-foreground">{action.action_name}</span>
                    )}

                    {/* Input Value for type_text/input actions */}
                    {isTypeTextAction && textValue !== null && (
                        <span className="flex items-center gap-1 text-sm">
                            <span className="text-muted-foreground">:</span>
                            {onTextUpdate ? (
                                <EditableText
                                    value={textValue}
                                    onSave={onTextUpdate}
                                    className="inline"
                                />
                            ) : (
                                <span className="font-mono bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-xs border border-blue-200">"{textValue}"</span>
                            )}
                        </span>
                    )}

                    {/* Show placeholder when input action has no text value yet */}
                    {isTypeTextAction && textValue === null && (
                        <span className="text-xs text-muted-foreground italic">(no input value)</span>
                    )}

                    {/* Selected option for select actions */}
                    {isSelectAction && selectedOption && (
                        <span className="flex items-center gap-1 text-sm">
                            <span className="text-muted-foreground">→</span>
                            <span className="font-mono bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded text-xs border border-purple-200">"{selectedOption}"</span>
                        </span>
                    )}
                </div>

                {/* Selector Dropdown Toggle */}
                {hasSelectorsOrParams && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            setSelectorOpen(!selectorOpen)
                        }}
                        className="flex-shrink-0 p-1 hover:bg-muted rounded transition-colors"
                        title="Show details"
                    >
                        {selectorOpen ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                    </button>
                )}
            </div>

            {/* Selector Dropdown Content */}
            {selectorOpen && (
                <div className="px-3 py-2 border-t bg-muted/20 space-y-1.5">
                    {xpath && (
                        <div className="flex items-start gap-2">
                            <span className="text-[10px] font-medium text-muted-foreground uppercase w-12 flex-shrink-0 pt-0.5">XPath</span>
                            <code className="text-xs break-all bg-muted/50 px-1.5 py-0.5 rounded flex-1">{xpath}</code>
                        </div>
                    )}
                    {cssSelector && (
                        <div className="flex items-start gap-2">
                            <span className="text-[10px] font-medium text-muted-foreground uppercase w-12 flex-shrink-0 pt-0.5">CSS</span>
                            <code className="text-xs break-all bg-muted/50 px-1.5 py-0.5 rounded flex-1">{cssSelector}</code>
                        </div>
                    )}
                    {/* Show all action params for debugging/completeness */}
                    {action.action_params && Object.keys(action.action_params).length > 0 && (
                        <div className="flex items-start gap-2 pt-1 border-t border-muted/30">
                            <span className="text-[10px] font-medium text-muted-foreground uppercase w-12 flex-shrink-0 pt-0.5">Params</span>
                            <code className="text-xs break-all bg-muted/50 px-1.5 py-0.5 rounded flex-1">
                                {JSON.stringify(action.action_params, null, 2)}
                            </code>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
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

export default function StepList({ steps, selectedStepId, onStepSelect, onClear, onActionUpdate, onDeleteStep, isExecuting = false, simpleMode = false }: StepListProps) {
    const [expandedSteps, setExpandedSteps] = useState<Set<string | number>>(new Set())
    const [stepToDelete, setStepToDelete] = useState<TestStep | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)

    // Calculate action numbers for simple mode (sequential across all steps)
    const getActionNumber = (stepIndex: number, actionIndex: number): number => {
        let count = 0
        for (let i = 0; i < stepIndex; i++) {
            count += steps[i].actions?.length || 0
        }
        return count + actionIndex + 1
    }

    const handleDeleteClick = (e: React.MouseEvent, step: TestStep) => {
        e.stopPropagation()
        setStepToDelete(step)
    }

    const handleConfirmDelete = async () => {
        if (!stepToDelete || !onDeleteStep) return
        setIsDeleting(true)
        try {
            await onDeleteStep(String(stepToDelete.id))
            setStepToDelete(null)
        } catch (error) {
            console.error('Failed to delete step:', error)
        } finally {
            setIsDeleting(false)
        }
    }

    const handleCancelDelete = () => {
        setStepToDelete(null)
    }

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

                    // Simple Mode: Show actions directly as compact rows with sequential numbering
                    if (simpleMode) {
                        const actions = step.actions || []

                        // Filter out file operation actions in simple mode
                        const filteredActions = actions.filter(action => {
                            const actionName = action.action_name?.toLowerCase() || '';
                            return !['replace_file', 'read_file', 'write_file'].includes(actionName);
                        });

                        if (filteredActions.length === 0) {
                            return null // Skip steps without relevant actions in simple mode
                        }
                        return (
                            <div key={step.id} className="space-y-1.5">
                                {filteredActions.map((action, actionIdx) => {
                                    const handleTextUpdate = async (newText: string) => {
                                        const updatedAction = await analysisApi.updateActionText(action.id, newText)
                                        onActionUpdate?.(String(step.id), updatedAction)
                                    }
                                    const actionNumber = getActionNumber(index, actionIdx)
                                    return (
                                        <div key={action.id || actionIdx} className="flex items-start gap-2 group">
                                            <span className="font-mono text-muted-foreground text-sm w-6 pt-2 flex-shrink-0 text-right">
                                                {actionNumber}
                                            </span>
                                            <div className="flex-1">
                                                <SimpleActionRow
                                                    action={action}
                                                    onTextUpdate={handleTextUpdate}
                                                />
                                            </div>
                                            {onDeleteStep && (
                                                <button
                                                    onClick={(e) => handleDeleteClick(e, step)}
                                                    disabled={isExecuting}
                                                    className="p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 mt-1 opacity-0 group-hover:opacity-100"
                                                    title={isExecuting ? "Cannot delete while executing" : "Delete step"}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )
                    }

                    // Detailed Mode (default): Show full step cards with expandable details
                    return (
                        <div key={step.id}>
                            <Card
                                className={`group border-l-4 transition-all cursor-pointer ${step.status === 'completed' ? 'border-l-green-500' :
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

                                        {/* Delete Button */}
                                        {onDeleteStep && (
                                            <button
                                                onClick={(e) => handleDeleteClick(e, step)}
                                                disabled={isExecuting}
                                                className="p-1 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                title={isExecuting ? "Cannot delete while executing" : "Delete step"}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        )}

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

                                                            const isTypeTextAction = ['type_text', 'input_text', 'type', 'input', 'fill'].includes(action.action_name?.toLowerCase() || '')
                                                            const textValue = isTypeTextAction
                                                                ? (action.action_params?.text as string) ||
                                                                (action.action_params?.value as string) ||
                                                                (action.action_params?.input as string) ||
                                                                null
                                                                : null

                                                            const handleTextUpdate = async (newText: string) => {
                                                                const updatedAction = await analysisApi.updateActionText(action.id, newText)
                                                                onActionUpdate?.(String(step.id), updatedAction)
                                                            }

                                                            return (
                                                                <div
                                                                    key={action.id || idx}
                                                                    className={`text-xs p-2 rounded flex items-center gap-2 flex-wrap ${action.result_success ? 'bg-green-50' :
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
                                                                    {/* Display and allow editing of text for type_text actions */}
                                                                    {isTypeTextAction && textValue !== null && (
                                                                        <EditableText
                                                                            value={textValue}
                                                                            onSave={handleTextUpdate}
                                                                            className="ml-1"
                                                                        />
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

            {/* Delete Confirmation Dialog */}
            {stepToDelete && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-background rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                                <AlertTriangle className="h-5 w-5 text-red-600" />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-semibold text-foreground">
                                    Delete Step {stepToDelete.step_number}?
                                </h3>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    Are you sure you want to delete this step? Deleting steps may cause the test case to fail during execution as subsequent steps may depend on this action.
                                </p>
                            </div>
                        </div>
                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                onClick={handleCancelDelete}
                                disabled={isDeleting}
                                className="px-4 py-2 text-sm font-medium rounded-md border border-input bg-background hover:bg-muted transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirmDelete}
                                disabled={isDeleting}
                                className="px-4 py-2 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                            >
                                {isDeleting ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
