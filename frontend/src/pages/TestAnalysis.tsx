import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { List, LayoutList, FileCode, Loader2, ExternalLink } from "lucide-react"
import StepList, { type TestStep as DisplayTestStep } from "@/components/analysis/StepList"
import ConfigPanel from "@/components/analysis/ConfigPanel"
import BrowserPreview from "@/components/analysis/BrowserPreview"
import LiveBrowserView from "@/components/LiveBrowserView"
import ActionFooter from "@/components/analysis/ActionFooter"
import { analysisApi, scriptsApi, settingsApi, getScreenshotUrl } from "@/services/api"
import { getAuthToken } from "@/contexts/AuthContext"
import { useSessionSubscription } from "@/hooks/useSessionSubscription"
import type { TestSession, LlmModel } from "@/types/analysis"
import { Textarea } from "@/components/ui/textarea" // Added import
import { Button } from "@/components/ui/button" // Added import
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card" // Added import
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
    const [selectedLlm, setSelectedLlm] = useState<LlmModel>('gemini-3.0-flash')
    const [headless, setHeadless] = useState(true) // Default to headless mode

    // Fetch system settings to get the default model
    useEffect(() => {
        const fetchDefaultModel = async () => {
            try {
                const settings = await settingsApi.getSettings()
                if (settings.default_analysis_model) {
                    setSelectedLlm(settings.default_analysis_model as LlmModel)
                }
            } catch (e) {
                console.error('Error fetching system settings:', e)
                // Keep the default model if fetch fails
            }
        }
        fetchDefaultModel()
    }, [])
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

    // Reset to try again - clears steps/messages from backend, keeps prompt for editing
    const handleReset = async () => {
        // If there's a session, reset it in the backend first
        if (session?.id) {
            try {
                const resetSession = await analysisApi.resetSession(session.id)
                // Set the original prompt in the input box for editing
                setPrompt(resetSession.prompt || "")
            } catch (e) {
                console.error('Error resetting session:', e)
                // Continue with frontend reset even if backend fails
            }
        }

        // Clear the subscription state (steps, status, etc.)
        clear()

        // Reset frontend state but keep the prompt (already set above)
        setSession(null)
        setAnalysisState('idle')
        setError(null)
        setSelectedStepId(null)
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
                    {/* Input Section - Initial State */}
                    {analysisState === 'idle' && (
                        <div className="p-4 space-y-4">
                            <Card>
                                <CardHeader className="pb-3">
                                    <CardTitle>New Test Analysis</CardTitle>
                                    <CardDescription>
                                        Describe what you want to test.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <Textarea
                                        placeholder="E.g., Go to example.com and verify the login flow..."
                                        value={prompt}
                                        onChange={(e) => setPrompt(e.target.value)}
                                        className="min-h-[100px]"
                                    />
                                </CardContent>
                                <CardFooter>
                                    <Button
                                        onClick={handleGenerate}
                                        disabled={!prompt.trim()}
                                        className="w-full"
                                    >
                                        Generate Plan
                                    </Button>
                                </CardFooter>
                            </Card>
                        </div>
                    )}

                    {/* Generating State */}
                    {analysisState === 'generating_plan' && (
                        <div className="p-4 flex items-center justify-center h-full">
                            <div className="text-center space-y-3">
                                <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                                <p className="text-sm text-muted-foreground">Generating test plan...</p>
                            </div>
                        </div>
                    )}

                    {/* Plan Display & Approval */}
                    {analysisState === 'plan_ready' && session?.plan && (
                        <div className="p-4 h-full overflow-hidden flex flex-col">
                            <Card className="flex flex-col h-full border-blue-200 bg-blue-50/10">
                                <CardHeader className="pb-2 bg-blue-50/20 border-b border-blue-100">
                                    <CardTitle className="text-lg text-blue-900">Review Plan</CardTitle>
                                </CardHeader>
                                <CardContent className="flex-1 overflow-y-auto pt-4 space-y-4">
                                    <div className="text-sm text-foreground/80 whitespace-pre-wrap">
                                        {session.plan.plan_text}
                                    </div>
                                    {planSteps.length > 0 && (
                                        <div className="space-y-2 pt-2">
                                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Proposed Steps</div>
                                            <div className="space-y-2">
                                                {planSteps.map((step, idx) => (
                                                    <div key={idx} className="text-sm p-3 bg-background rounded-md border shadow-sm">
                                                        <span className="font-medium text-blue-600 mr-2">{step.step_number}.</span>
                                                        {step.description}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                                <CardFooter className="pt-4 border-t gap-2 bg-background/50">
                                    <Button
                                        onClick={handleReset}
                                        variant="outline"
                                        className="flex-1"
                                    >
                                        Edit
                                    </Button>
                                    <Button
                                        onClick={handleApprove}
                                        className="flex-1 bg-blue-600 hover:bg-blue-700"
                                    >
                                        Approve & Execute
                                    </Button>
                                </CardFooter>
                            </Card>
                        </div>
                    )}

                    {/* Executing State */}
                    {analysisState === 'executing' && (
                        <div className="p-4 border-b bg-yellow-50/10">
                            <Card className="border-yellow-200 bg-yellow-50/20 shadow-none">
                                <CardContent className="p-4 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />
                                        <div className="text-sm font-medium text-yellow-900">
                                            Executing Step {displaySteps.length + 1}...
                                        </div>
                                    </div>
                                    <Button
                                        onClick={stopExecution}
                                        variant="destructive"
                                        size="sm"
                                        className="h-8"
                                    >
                                        Stop
                                    </Button>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* Stopped State */}
                    {analysisState === 'stopped' && (
                        <div className="p-4 border-b space-y-3 bg-orange-50/10">
                            <Card className="border-orange-200 bg-orange-50/20 shadow-none">
                                <CardHeader className="p-4 pb-2">
                                    <CardTitle className="text-base text-orange-900">Execution Stopped</CardTitle>
                                    <CardDescription className="text-orange-700/80">
                                        Test execution was stopped manually.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="p-4 pt-2">
                                    <div className="flex gap-2">
                                        {displaySteps.length > 0 && (
                                            linkedScript ? (
                                                <Button
                                                    onClick={handleOpenScript}
                                                    className="flex-1 gap-2 bg-orange-600 hover:bg-orange-700 text-white"
                                                >
                                                    <ExternalLink className="h-4 w-4" />
                                                    View Script
                                                </Button>
                                            ) : (
                                                <Button
                                                    onClick={handleGenerateScript}
                                                    disabled={generatingScript}
                                                    className="flex-1 gap-2 bg-orange-600 hover:bg-orange-700 text-white"
                                                >
                                                    {generatingScript ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCode className="h-4 w-4" />}
                                                    Save as Script
                                                </Button>
                                            )
                                        )}
                                        <Button
                                            onClick={handleReset}
                                            variant="outline"
                                            className="flex-1 border-orange-200 hover:bg-orange-100"
                                        >
                                            New Test
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* Completed State */}
                    {analysisState === 'completed' && (
                        <div className="p-4 border-b space-y-3 bg-green-50/10">
                            <Card className="border-green-200 bg-green-50/20 shadow-none">
                                <CardHeader className="p-4 pb-2">
                                    <CardTitle className="text-base text-green-900">Test Completed</CardTitle>
                                    <CardDescription className="text-green-700/80">
                                        All steps executed successfully.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="p-4 pt-2">
                                    <div className="flex gap-2">
                                        {linkedScript ? (
                                            <Button
                                                onClick={handleOpenScript}
                                                className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white"
                                            >
                                                <ExternalLink className="h-4 w-4" />
                                                View Script
                                            </Button>
                                        ) : (
                                            <Button
                                                onClick={handleGenerateScript}
                                                disabled={generatingScript}
                                                className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white"
                                            >
                                                {generatingScript ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCode className="h-4 w-4" />}
                                                Save as Script
                                            </Button>
                                        )}
                                        <Button
                                            onClick={handleReset}
                                            variant="outline"
                                            className="flex-1 border-green-200 hover:bg-green-100"
                                        >
                                            New Test
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* Failed State */}
                    {(analysisState === 'failed' || error) && (
                        <div className="p-4 border-b bg-red-50/10">
                            <Card className="border-red-200 bg-red-50/20 shadow-none">
                                <CardHeader className="p-4 pb-2">
                                    <CardTitle className="text-base text-red-900">Test Failed</CardTitle>
                                </CardHeader>
                                <CardContent className="p-4 pt-0">
                                    {error && <p className="text-sm text-red-700 mb-3">{error}</p>}
                                    <Button
                                        onClick={handleReset}
                                        variant="outline"
                                        className="w-full border-red-200 hover:bg-red-100 text-red-900"
                                    >
                                        Try Again
                                    </Button>
                                </CardContent>
                            </Card>
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
