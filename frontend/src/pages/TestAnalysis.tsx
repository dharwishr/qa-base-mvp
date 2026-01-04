import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { List, LayoutList, FileCode, Loader2, ExternalLink } from "lucide-react"
import StepList, { type TestStep as DisplayTestStep } from "@/components/analysis/StepList"
import ConfigPanel from "@/components/analysis/ConfigPanel"
import BrowserPreview from "@/components/analysis/BrowserPreview"
import LiveBrowserView from "@/components/LiveBrowserView"
import ActionFooter from "@/components/analysis/ActionFooter"
import { analysisApi, scriptsApi, getScreenshotUrl } from "@/services/api"
import { getAuthToken } from "@/contexts/AuthContext"
import { useSessionSubscription } from "@/hooks/useSessionSubscription"
import type { TestSession, LlmModel } from "@/types/analysis"
import type { PlaywrightScript } from "@/types/scripts"

interface BrowserSessionInfo {
    id: string
    liveViewUrl?: string
    novncUrl?: string
}

type AnalysisState = 'idle' | 'generating_plan' | 'plan_ready' | 'executing' | 'completed' | 'failed' | 'stopped'

export default function TestAnalysis() {
    const navigate = useNavigate()
    const [prompt, setPrompt] = useState("")
    const [session, setSession] = useState<TestSession | null>(null)
    const [analysisState, setAnalysisState] = useState<AnalysisState>('idle')
    const [error, setError] = useState<string | null>(null)
    const [selectedStepId, setSelectedStepId] = useState<string | number | null>(null)
    const [selectedLlm, setSelectedLlm] = useState<LlmModel>('gemini-2.5-flash')
    const [headless, setHeadless] = useState(true) // Default to headless mode
    const [browserSession, setBrowserSession] = useState<BrowserSessionInfo | null>(null)
    const [isRecording, setIsRecording] = useState(false)
    const [simpleMode, setSimpleMode] = useState(false)
    const [generatingScript, setGeneratingScript] = useState(false)
    const [linkedScript, setLinkedScript] = useState<Pick<PlaywrightScript, 'id' | 'session_id'> | null>(null)

    // Check for existing script linked to this session
    useEffect(() => {
        const checkForLinkedScript = async () => {
            if (!session?.id) {
                setLinkedScript(null)
                return
            }
            try {
                const scripts = await scriptsApi.listScripts()
                const existingScript = scripts.find(s => s.session_id === session.id)
                setLinkedScript(existingScript || null)
            } catch (e) {
                console.error('Error checking for linked script:', e)
            }
        }
        checkForLinkedScript()
    }, [session?.id])

    // WebSocket subscription hook with polling fallback
    const {
        steps: subscriptionSteps,
        isExecuting,
        isCompleted,
        isStopped,
        success,
        error: subscriptionError,
        startExecution,
        stopExecution,
        clear,
        updateStepAction,
        deleteStep,
    } = useSessionSubscription({
        sessionId: session?.id ?? null,
        autoConnect: true,
        autoFetchInitial: true,
    })

    // Convert subscription steps to display format
    const displaySteps: DisplayTestStep[] = subscriptionSteps.map((step) => ({
        ...step,
        description: step.next_goal || `Step ${step.step_number}`,
    }))

    // Auto-select the latest step when new steps come in
    useEffect(() => {
        if (displaySteps.length > 0) {
            const latestStep = displaySteps[displaySteps.length - 1]
            setSelectedStepId(latestStep.id)
        }
    }, [displaySteps.length])

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

    // Update analysis state based on polling state
    useEffect(() => {
        if (isExecuting) {
            setAnalysisState('executing')
        } else if (isStopped) {
            setAnalysisState('stopped')
        } else if (isCompleted) {
            setAnalysisState(success ? 'completed' : 'failed')
        }
    }, [isExecuting, isCompleted, isStopped, success])

    // Handle subscription errors
    useEffect(() => {
        if (subscriptionError) {
            setError(subscriptionError)
        }
    }, [subscriptionError])

    // Poll for browser session when in non-headless mode
    // Keep polling even after execution to allow recording
    useEffect(() => {
        if (!session?.id || headless) {
            return
        }

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
                    const matching = sessions.find((s: { test_session_id: string }) => s.test_session_id === session.id)
                    if (matching) {
                        setBrowserSession({
                            id: matching.id,
                            liveViewUrl: `/browser/sessions/${matching.id}/view`,
                            novncUrl: matching.novnc_url,
                        })
                    } else {
                        // Browser session no longer exists
                        setBrowserSession(null)
                    }
                }
            } catch (e) {
                console.error('Error checking browser session:', e)
            }
        }

        checkBrowserSession()
        const interval = setInterval(checkBrowserSession, 3000)

        return () => clearInterval(interval)
    }, [session?.id, headless])

    // Generate plan from prompt
    const handleGenerate = async () => {
        if (!prompt.trim()) return

        setError(null)
        setAnalysisState('generating_plan')

        try {
            const newSession = await analysisApi.createSession(prompt, selectedLlm, headless)
            setSession(newSession)

            if (newSession.status === 'plan_ready') {
                setAnalysisState('plan_ready')
            } else if (newSession.status === 'failed') {
                setAnalysisState('failed')
                setError('Failed to generate plan')
            }
        } catch (e) {
            console.error('Error creating session:', e)
            setError(e instanceof Error ? e.message : 'Failed to generate plan')
            setAnalysisState('failed')
        }
    }

    // Approve plan and start execution
    const handleApprove = async () => {
        if (!session) return

        setError(null)

        try {
            // Approve the plan
            const approvedSession = await analysisApi.approvePlan(session.id)
            setSession(approvedSession)

            // Start execution via Celery (will trigger polling)
            await startExecution()
        } catch (e) {
            console.error('Error approving plan:', e)
            setError(e instanceof Error ? e.message : 'Failed to approve plan')
        }
    }

    // Reset to try again - clears all data from backend and frontend
    const handleReset = async () => {
        // If there's a session, reset it in the backend first
        if (session?.id) {
            try {
                await analysisApi.resetSession(session.id)
            } catch (e) {
                console.error('Error resetting session:', e)
                // Continue with frontend reset even if backend fails
            }
        }

        // Clear the subscription state (steps, status, etc.)
        clear()

        // Reset all frontend state
        setSession(null)
        setAnalysisState('idle')
        setError(null)
        setPrompt("")
        setSelectedStepId(null)
        setSelectedLlm('gemini-2.5-flash')
        setIsRecording(false)
        setBrowserSession(null)
        setLinkedScript(null)
    }

    // Start recording user interactions
    // Uses Playwright mode by default (blur-based input capture, better backspace handling)
    const handleStartRecording = async () => {
        if (!session?.id || !browserSession?.id) return
        try {
            await analysisApi.startRecording(session.id, browserSession.id, 'playwright')
            setIsRecording(true)
        } catch (e) {
            console.error('Error starting recording:', e)
            setError(e instanceof Error ? e.message : 'Failed to start recording')
        }
    }

    // Stop recording user interactions
    const handleStopRecording = async () => {
        if (!session?.id) return
        try {
            await analysisApi.stopRecording(session.id)
            setIsRecording(false)
        } catch (e) {
            console.error('Error stopping recording:', e)
            setError(e instanceof Error ? e.message : 'Failed to stop recording')
        }
    }

    // Generate script from completed session
    const handleGenerateScript = async () => {
        if (!session?.id) return
        setGeneratingScript(true)
        try {
            const scriptName = session.title || prompt?.slice(0, 50) || `Test Script ${new Date().toISOString()}`
            const script = await scriptsApi.createScript({
                session_id: session.id,
                name: scriptName,
                description: `Generated from test analysis session`,
            })
            // Update linked script state
            setLinkedScript(script)
            // Navigate to the script detail page
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

    // Resizable panel state
    const [leftWidth, setLeftWidth] = useState(400)
    const [isResizing, setIsResizing] = useState(false)

    const startResizing = () => setIsResizing(true)
    const stopResizing = () => setIsResizing(false)

    const resize = (mouseMoveEvent: React.MouseEvent) => {
        if (isResizing) {
            const newWidth = mouseMoveEvent.clientX - 64
            if (newWidth > 250 && newWidth < 800) {
                setLeftWidth(newWidth)
            }
        }
    }

    // Get plan steps for display
    const planSteps = session?.plan?.steps_json?.steps || []

    // Tab state for switching between views
    const [activeTab, setActiveTab] = useState<'live' | 'screenshot'>('screenshot')

    // Auto-switch to live tab when execution starts or recording begins
    useEffect(() => {
        if (!headless && (isExecuting || isRecording || browserSession)) {
            setActiveTab('live')
        }
    }, [isExecuting, isRecording, browserSession, headless])

    return (
        <div
            className={`flex h-[calc(100vh-3.5rem)] flex-col bg-background ${isResizing ? 'cursor-col-resize select-none' : ''}`}
            onMouseMove={resize}
            onMouseUp={stopResizing}
            onMouseLeave={stopResizing}
        >
            <div className="flex flex-1 overflow-hidden">
                {/* Left Panel */}
                <div
                    className="border-r flex flex-col overflow-hidden hidden md:flex"
                    style={{ width: `${leftWidth}px` }}
                >
                    {/* Input Section */}
                    <div className="p-4 border-b space-y-2 bg-muted/10">
                        <textarea
                            className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                            placeholder="Describe your test case to generate steps..."
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            disabled={analysisState !== 'idle'}
                        />
                        {analysisState === 'idle' && (
                            <button
                                onClick={handleGenerate}
                                disabled={!prompt.trim()}
                                className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2"
                            >
                                Generate Plan
                            </button>
                        )}
                        {analysisState === 'generating_plan' && (
                            <div className="w-full h-9 flex items-center justify-center text-sm text-muted-foreground">
                                Generating plan...
                            </div>
                        )}
                    </div>

                    {/* Plan Display Section */}
                    {analysisState === 'plan_ready' && session?.plan && (
                        <div className="p-4 border-b space-y-3 bg-blue-50/50">
                            <div className="text-sm font-medium">Generated Plan</div>
                            <div className="text-sm text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                                {session.plan.plan_text}
                            </div>
                            {planSteps.length > 0 && (
                                <div className="space-y-1">
                                    <div className="text-xs font-medium text-muted-foreground">Steps:</div>
                                    {planSteps.map((step, idx) => (
                                        <div key={idx} className="text-xs pl-2 border-l-2 border-blue-300">
                                            {step.step_number}. {step.description}
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="flex gap-2">
                                <button
                                    onClick={handleApprove}
                                    className="flex-1 inline-flex items-center justify-center rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700 h-9 px-4 py-2"
                                >
                                    Approve & Execute
                                </button>
                                <button
                                    onClick={handleReset}
                                    className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-4 py-2"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Error Display */}
                    {error && (
                        <div className="p-4 bg-red-50 border-b border-red-200">
                            <div className="text-sm text-red-600">{error}</div>
                            <button
                                onClick={handleReset}
                                className="mt-2 text-sm text-red-600 underline"
                            >
                                Try again
                            </button>
                        </div>
                    )}

                    {/* Execution Status */}
                    {analysisState === 'executing' && (
                        <div className="p-4 border-b bg-yellow-50/50">
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-medium text-yellow-700">
                                    Executing test... ({displaySteps.length} steps completed)
                                </div>
                                <button
                                    onClick={stopExecution}
                                    className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 h-8 px-3 py-1"
                                >
                                    Stop
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Stopped Status */}
                    {analysisState === 'stopped' && (
                        <div className="p-4 border-b bg-orange-50/50 space-y-3">
                            <div className="text-sm font-medium text-orange-700">
                                Test execution stopped ({displaySteps.length} steps completed)
                            </div>
                            <div className="flex gap-2">
                                {displaySteps.length > 0 && (
                                    linkedScript ? (
                                        <button
                                            onClick={handleOpenScript}
                                            className="flex-1 inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 h-9 px-4 py-2"
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                            Open Script
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleGenerateScript}
                                            disabled={generatingScript}
                                            className="flex-1 inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 h-9 px-4 py-2 disabled:opacity-50"
                                        >
                                            {generatingScript ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Generating...
                                                </>
                                            ) : (
                                                <>
                                                    <FileCode className="h-4 w-4" />
                                                    Generate Script
                                                </>
                                            )}
                                        </button>
                                    )
                                )}
                                <button
                                    onClick={handleReset}
                                    className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-4 py-2"
                                >
                                    New Test
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Completion Status */}
                    {analysisState === 'completed' && (
                        <div className="p-4 border-b bg-green-50/50 space-y-3">
                            <div className="text-sm font-medium text-green-700">
                                Test completed successfully! ({displaySteps.length} steps)
                            </div>
                            <div className="flex gap-2">
                                {linkedScript ? (
                                    <button
                                        onClick={handleOpenScript}
                                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 h-9 px-4 py-2"
                                    >
                                        <ExternalLink className="h-4 w-4" />
                                        Open Script
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleGenerateScript}
                                        disabled={generatingScript}
                                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 h-9 px-4 py-2 disabled:opacity-50"
                                    >
                                        {generatingScript ? (
                                            <>
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Generating...
                                            </>
                                        ) : (
                                            <>
                                                <FileCode className="h-4 w-4" />
                                                Generate Script
                                            </>
                                        )}
                                    </button>
                                )}
                                <button
                                    onClick={handleReset}
                                    className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-4 py-2"
                                >
                                    New Test
                                </button>
                            </div>
                        </div>
                    )}

                    {analysisState === 'failed' && !error && (
                        <div className="p-4 border-b bg-red-50/50">
                            <div className="text-sm font-medium text-red-700">
                                Test failed
                            </div>
                            <button
                                onClick={handleReset}
                                className="mt-2 text-sm text-red-600 underline"
                            >
                                Try again
                            </button>
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
                            onClear={clear}
                            onActionUpdate={updateStepAction}
                            onDeleteStep={deleteStep}
                            isExecuting={isExecuting}
                            simpleMode={simpleMode}
                        />
                    </div>
                </div>

                {/* Resizer Handle */}
                <div
                    className={`w-1 cursor-col-resize hover:bg-primary transition-colors hidden md:block ${isResizing ? 'bg-primary' : 'bg-transparent'}`}
                    onMouseDown={startResizing}
                />

                {/* Right Panel */}
                <div className="flex-1 flex flex-col bg-muted/10">
                    <ConfigPanel
                        selectedLlm={selectedLlm}
                        onLlmChange={setSelectedLlm}
                        headless={headless}
                        onHeadlessChange={setHeadless}
                        disabled={analysisState !== 'idle'}
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                    />

                    {/* Tab Content */}
                    {activeTab === 'live' ? (
                        // Live Browser Tab
                        !headless && (isExecuting || isRecording || browserSession) ? (
                            browserSession ? (
                                <LiveBrowserView
                                    sessionId={browserSession.id}
                                    liveViewUrl={browserSession.liveViewUrl}
                                    novncUrl={browserSession.novncUrl}
                                    className="flex-1"
                                    isRecording={isRecording}
                                    onStartRecording={handleStartRecording}
                                    onStopRecording={handleStopRecording}
                                    canRecord={!!session?.id && !!browserSession?.id && !isExecuting}
                                    isAIExecuting={isExecuting}
                                />
                            ) : (
                                <div className="flex-1 flex items-center justify-center">
                                    <div className="text-center">
                                        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                                        <p className="text-sm text-muted-foreground">Starting live browser...</p>
                                    </div>
                                </div>
                            )
                        ) : (
                            <div className="flex-1 flex items-center justify-center p-8 text-center text-muted-foreground">
                                <div>
                                    <p className="mb-2">Live browser is not active.</p>
                                    {headless && (
                                        <p className="text-sm">
                                            Turn off "Headless Mode" in settings to see the live browser.
                                        </p>
                                    )}
                                </div>
                            </div>
                        )
                    ) : (
                        // Screenshot Tab
                        <BrowserPreview
                            screenshotUrl={screenshotUrl}
                            currentUrl={selectedStep?.url}
                            pageTitle={selectedStep?.page_title}
                        />
                    )}
                </div>
            </div>

            <ActionFooter llmModel={selectedLlm} />
        </div>
    )
}
