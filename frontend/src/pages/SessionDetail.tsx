import { useState, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { ArrowLeft, Bot } from "lucide-react"
import StepList, { type TestStep as DisplayTestStep } from "@/components/analysis/StepList"
import BrowserPreview from "@/components/analysis/BrowserPreview"
import { analysisApi, getScreenshotUrl } from "@/services/api"
import type { TestSession, LlmModel } from "@/types/analysis"

const STATUS_COLORS: Record<string, string> = {
    'pending_plan': 'bg-gray-100 text-gray-700',
    'plan_ready': 'bg-blue-100 text-blue-700',
    'approved': 'bg-purple-100 text-purple-700',
    'running': 'bg-yellow-100 text-yellow-700',
    'completed': 'bg-green-100 text-green-700',
    'failed': 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
    'pending_plan': 'Pending Plan',
    'plan_ready': 'Plan Ready',
    'approved': 'Approved',
    'running': 'Running',
    'completed': 'Completed',
    'failed': 'Failed',
}

const LLM_LABELS: Record<LlmModel, string> = {
    'browser-use-llm': 'Browser Use LLM',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-3.0-flash': 'Gemini 3.0 Flash',
    'gemini-3.0-pro': 'Gemini 3.0 Pro',
    'gemini-2.5-computer-use': 'Gemini 2.5 Computer Use',
}

function formatDate(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

export default function SessionDetail() {
    const { sessionId } = useParams<{ sessionId: string }>()
    const navigate = useNavigate()
    const [session, setSession] = useState<TestSession | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [selectedStepId, setSelectedStepId] = useState<string | number | null>(null)

    useEffect(() => {
        if (!sessionId) return

        const fetchSession = async () => {
            setLoading(true)
            setError(null)
            try {
                const data = await analysisApi.getSession(sessionId)
                setSession(data)

                // Default to last step's screenshot
                if (data.steps && data.steps.length > 0) {
                    const lastStep = data.steps[data.steps.length - 1]
                    setSelectedStepId(lastStep.id)
                }
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to load session')
            } finally {
                setLoading(false)
            }
        }

        fetchSession()
    }, [sessionId])

    // Convert steps to display format
    const displaySteps: DisplayTestStep[] = (session?.steps || []).map((step) => ({
        ...step,
        description: step.next_goal || `Step ${step.step_number}`,
    }))

    // Get the selected step data
    const selectedStep = displaySteps.find((s) => s.id === selectedStepId)

    // Build screenshot URL for selected step
    const screenshotUrl = selectedStep?.screenshot_path
        ? getScreenshotUrl(selectedStep.screenshot_path)
        : null

    // Handle step selection
    const handleStepSelect = (step: DisplayTestStep) => {
        setSelectedStepId(step.id)
    }

    if (loading) {
        return (
            <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
                <div className="text-muted-foreground">Loading session...</div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-4">
                <div className="text-red-600">{error}</div>
                <button
                    onClick={() => navigate('/test-cases')}
                    className="inline-flex items-center text-sm text-primary hover:underline"
                >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back to Test Cases
                </button>
            </div>
        )
    }

    if (!session) {
        return (
            <div className="flex h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-4">
                <div className="text-muted-foreground">Session not found</div>
                <button
                    onClick={() => navigate('/test-cases')}
                    className="inline-flex items-center text-sm text-primary hover:underline"
                >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back to Test Cases
                </button>
            </div>
        )
    }

    return (
        <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-background">
            <div className="flex flex-1 overflow-hidden">
                {/* Left Panel */}
                <div className="w-[400px] border-r flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="p-4 border-b space-y-3 bg-muted/10">
                        <button
                            onClick={() => navigate('/test-cases')}
                            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ArrowLeft className="h-4 w-4 mr-1" />
                            Back to Test Cases
                        </button>

                        {/* Session Info */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[session.status] || 'bg-gray-100 text-gray-700'}`}>
                                    {STATUS_LABELS[session.status] || session.status}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {formatDate(session.created_at)}
                                </span>
                            </div>
                            <p className="text-sm">{session.prompt}</p>
                        </div>
                    </div>

                    {/* Plan Display */}
                    {session.plan && (
                        <div className="p-4 border-b bg-blue-50/50 max-h-[200px] overflow-y-auto">
                            <div className="text-xs font-medium text-muted-foreground mb-2">Plan</div>
                            <div className="text-xs whitespace-pre-wrap">
                                {session.plan.plan_text}
                            </div>
                        </div>
                    )}

                    {/* Step List */}
                    <StepList
                        steps={displaySteps}
                        selectedStepId={selectedStepId}
                        onStepSelect={handleStepSelect}
                    />
                </div>

                {/* Right Panel */}
                <div className="flex-1 flex flex-col bg-muted/10">
                    {/* LLM Info Bar */}
                    <div className="flex items-center gap-2 p-4 border-b bg-background">
                        <Bot className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                            Model: {LLM_LABELS[session.llm_model] || session.llm_model}
                        </span>
                    </div>

                    {/* Screenshot Preview */}
                    <BrowserPreview
                        screenshotUrl={screenshotUrl}
                        currentUrl={selectedStep?.url}
                        pageTitle={selectedStep?.page_title}
                    />
                </div>
            </div>
        </div>
    )
}
