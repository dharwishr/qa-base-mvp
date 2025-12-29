import { useState, useEffect, useRef, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { ArrowLeft, Bot, Monitor, RefreshCw, List, LayoutList, FileCode, ExternalLink, Loader2 } from "lucide-react"
import StepList, { type TestStep as DisplayTestStep } from "@/components/analysis/StepList"
import BrowserPreview from "@/components/analysis/BrowserPreview"
import LiveBrowserView from "@/components/LiveBrowserView"
import { analysisApi, scriptsApi, getScreenshotUrl } from "@/services/api"
import { getAuthToken } from "@/contexts/AuthContext"
import type { TestSession, LlmModel, StepAction } from "@/types/analysis"
import type { PlaywrightScript } from "@/types/scripts"

const STATUS_COLORS: Record<string, string> = {
    'pending_plan': 'bg-gray-100 text-gray-700',
    'plan_ready': 'bg-blue-100 text-blue-700',
    'approved': 'bg-purple-100 text-purple-700',
    'running': 'bg-yellow-100 text-yellow-700',
    'queued': 'bg-orange-100 text-orange-700',
    'completed': 'bg-green-100 text-green-700',
    'failed': 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
    'pending_plan': 'Pending Plan',
    'plan_ready': 'Plan Ready',
    'approved': 'Approved',
    'running': 'Running',
    'queued': 'Queued',
    'completed': 'Completed',
    'failed': 'Failed',
}

const LLM_LABELS: Record<LlmModel, string> = {
    'browser-use-llm': 'Browser Use LLM',
    'gemini-2.0-flash': 'Gemini 2.0 Flash',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-3.0-flash': 'Gemini 3.0 Flash',
    'gemini-3.0-pro': 'Gemini 3.0 Pro',
    'gemini-2.5-computer-use': 'Gemini 2.5 Computer Use',
}

interface BrowserSessionInfo {
    id: string
    liveViewUrl?: string
    novncUrl?: string
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
    const [browserSession, setBrowserSession] = useState<BrowserSessionInfo | null>(null)
    const [simpleMode, setSimpleMode] = useState(false)
    const [linkedScript, setLinkedScript] = useState<Pick<PlaywrightScript, 'id' | 'session_id'> | null>(null)
    const [generatingScript, setGeneratingScript] = useState(false)
    const pollRef = useRef<number | null>(null)

    // Check for existing script linked to this session
    useEffect(() => {
        const checkForLinkedScript = async () => {
            if (!sessionId) return
            try {
                const scripts = await scriptsApi.listScripts()
                const existingScript = scripts.find(s => s.session_id === sessionId)
                setLinkedScript(existingScript || null)
            } catch (e) {
                console.error('Error checking for linked script:', e)
            }
        }
        checkForLinkedScript()
    }, [sessionId])

    // Fetch session data
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

    // Poll for updates when running/queued
    useEffect(() => {
        if (!sessionId || !session) return

        const isActive = session.status === 'running' || session.status === 'queued'
        if (!isActive) {
            if (pollRef.current) {
                clearInterval(pollRef.current)
                pollRef.current = null
            }
            return
        }

        const pollUpdates = async () => {
            try {
                const data = await analysisApi.getSession(sessionId)
                setSession(data)

                if (data.steps && data.steps.length > 0) {
                    const lastStep = data.steps[data.steps.length - 1]
                    setSelectedStepId(lastStep.id)
                }

                // Stop polling when complete
                if (data.status !== 'running' && data.status !== 'queued') {
                    if (pollRef.current) {
                        clearInterval(pollRef.current)
                        pollRef.current = null
                    }
                    setBrowserSession(null)
                }
            } catch (e) {
                console.error('Error polling session:', e)
            }
        }

        pollRef.current = window.setInterval(pollUpdates, 2000)

        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current)
                pollRef.current = null
            }
        }
    }, [sessionId, session?.status])

    // Listen for browser session via polling the browser API
    useEffect(() => {
        if (!sessionId || !session) return

        const isActive = session.status === 'running' || session.status === 'queued'
        if (!isActive) return

        const checkBrowserSession = async () => {
            try {
                const response = await fetch(
                    `${import.meta.env.VITE_API_URL}/browser/sessions?phase=analysis&active_only=true`,
                    {
                        headers: {
                            'Authorization': `Bearer ${getAuthToken()}`,
                        },
                    }
                )
                if (response.ok) {
                    const sessions = await response.json()
                    const matching = sessions.find((s: any) => s.test_session_id === sessionId)
                    if (matching) {
                        setBrowserSession({
                            id: matching.id,
                            liveViewUrl: `/browser/sessions/${matching.id}/view`,
                            novncUrl: matching.novnc_url,
                        })
                    }
                }
            } catch (e) {
                console.error('Error checking browser session:', e)
            }
        }

        checkBrowserSession()
        const interval = setInterval(checkBrowserSession, 3000)

        return () => clearInterval(interval)
    }, [sessionId, session?.status])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current)
            }
        }
    }, [])

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

    // Handle action update (for editable input text)
    const handleActionUpdate = useCallback((stepId: string, updatedAction: StepAction) => {
        if (!session) return
        setSession(prevSession => {
            if (!prevSession || !prevSession.steps) return prevSession
            return {
                ...prevSession,
                steps: prevSession.steps.map(step =>
                    step.id === stepId
                        ? {
                            ...step,
                            actions: step.actions.map(action =>
                                action.id === updatedAction.id ? updatedAction : action
                            )
                        }
                        : step
                )
            }
        })
    }, [session])

    // Handle step deletion
    const handleDeleteStep = useCallback(async (stepId: string) => {
        if (!session) return
        try {
            await analysisApi.deleteStep(stepId)
            // Update local state: remove the step and renumber remaining steps
            setSession(prevSession => {
                if (!prevSession || !prevSession.steps) return prevSession
                const newSteps = prevSession.steps
                    .filter(step => step.id !== stepId)
                    .map((step, idx) => ({ ...step, step_number: idx + 1 }))
                return { ...prevSession, steps: newSteps }
            })
        } catch (e) {
            console.error('Failed to delete step:', e)
            throw e
        }
    }, [session])

    // Generate script from session
    const handleGenerateScript = async () => {
        if (!session?.id) return
        setGeneratingScript(true)
        try {
            const scriptName = session.title || session.prompt?.slice(0, 50) || `Test Script ${new Date().toISOString()}`
            const script = await scriptsApi.createScript({
                session_id: session.id,
                name: scriptName,
                description: `Generated from test analysis session`,
            })
            setLinkedScript(script)
            navigate(`/scripts/${script.id}`)
        } catch (e) {
            console.error('Error generating script:', e)
            setError(e instanceof Error ? e.message : 'Failed to generate script')
        } finally {
            setGeneratingScript(false)
        }
    }

    // Open linked script
    const handleOpenScript = () => {
        if (linkedScript) {
            navigate(`/scripts/${linkedScript.id}`)
        }
    }

    // Check if session is actively running
    const isRunning = session?.status === 'running' || session?.status === 'queued'

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
                                    {isRunning && <RefreshCw className="h-3 w-3 mr-1 animate-spin" />}
                                    {STATUS_LABELS[session.status] || session.status}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {formatDate(session.created_at)}
                                </span>
                            </div>
                            <p className="text-sm">{session.prompt}</p>
                            {/* Script Button */}
                            {displaySteps.length > 0 && (
                                <div className="pt-2">
                                    {linkedScript ? (
                                        <button
                                            onClick={handleOpenScript}
                                            className="inline-flex items-center gap-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 h-7 px-3 py-1"
                                        >
                                            <ExternalLink className="h-3.5 w-3.5" />
                                            Open Script
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleGenerateScript}
                                            disabled={generatingScript || isRunning}
                                            className="inline-flex items-center gap-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 h-7 px-3 py-1 disabled:opacity-50"
                                        >
                                            {generatingScript ? (
                                                <>
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    Generating...
                                                </>
                                            ) : (
                                                <>
                                                    <FileCode className="h-3.5 w-3.5" />
                                                    Generate Script
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>
                            )}
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

                    {/* Step List with View Mode Toggle */}
                    <div className="flex flex-col flex-1 min-h-0">
                        {/* View Mode Toggle */}
                        <div className="px-4 py-2 border-b bg-muted/10 flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">View Mode</span>
                            <div className="flex items-center gap-1 bg-muted/30 rounded-md p-0.5">
                                <button
                                    onClick={() => setSimpleMode(false)}
                                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${!simpleMode ? 'bg-background shadow-sm' : 'hover:bg-background/50'}`}
                                    title="Detailed view"
                                >
                                    <LayoutList className="h-3.5 w-3.5" />
                                    Detailed
                                </button>
                                <button
                                    onClick={() => setSimpleMode(true)}
                                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${simpleMode ? 'bg-background shadow-sm' : 'hover:bg-background/50'}`}
                                    title="Simple view"
                                >
                                    <List className="h-3.5 w-3.5" />
                                    Simple
                                </button>
                            </div>
                        </div>
                        <StepList
                            steps={displaySteps}
                            selectedStepId={selectedStepId}
                            onStepSelect={handleStepSelect}
                            onActionUpdate={handleActionUpdate}
                            onDeleteStep={handleDeleteStep}
                            isExecuting={isRunning}
                            simpleMode={simpleMode}
                        />
                    </div>
                </div>

                {/* Right Panel */}
                <div className="flex-1 flex flex-col bg-muted/10">
                    {/* LLM Info Bar */}
                    <div className="flex items-center gap-2 p-4 border-b bg-background">
                        <Bot className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                            Model: {LLM_LABELS[session.llm_model] || session.llm_model}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded ${session.headless ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-600'}`}>
                            {session.headless ? 'Headless' : 'Live Browser'}
                        </span>
                        {isRunning && !session.headless && browserSession && (
                            <span className="ml-auto flex items-center gap-1.5 text-xs text-green-600">
                                <Monitor className="h-3.5 w-3.5" />
                                Connected
                            </span>
                        )}
                    </div>

                    {/* 
                        Headless mode: Always show screenshots (live during execution, history after)
                        Non-headless mode: Show live browser during execution, screenshots in history
                    */}
                    {isRunning && !session.headless ? (
                        // Non-headless running: Show live browser
                        browserSession ? (
                            <div className="flex-1 p-4">
                                <LiveBrowserView
                                    sessionId={browserSession.id}
                                    liveViewUrl={browserSession.liveViewUrl}
                                    novncUrl={browserSession.novncUrl}
                                    className="h-full"
                                />
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center">
                                <div className="text-center">
                                    <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-3 text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground">Starting browser...</p>
                                    <p className="text-xs text-muted-foreground mt-1">This may take a moment</p>
                                </div>
                            </div>
                        )
                    ) : (
                        // Headless mode OR completed: Show screenshots
                        <BrowserPreview
                            screenshotUrl={screenshotUrl}
                            currentUrl={selectedStep?.url}
                            pageTitle={selectedStep?.page_title}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}
