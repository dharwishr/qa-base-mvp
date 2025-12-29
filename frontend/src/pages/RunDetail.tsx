import { useState, useEffect, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { ArrowLeft, RefreshCw, CheckCircle, XCircle, Zap, Clock, MousePointer, Type, Globe, Scroll, AlertTriangle, ChevronDown, ChevronRight, ShieldCheck, Code, Copy, Check, Monitor, Timer } from "lucide-react"
import { runsApi, scriptsApi, getScreenshotUrl, getRunWebSocketUrl } from "@/services/api"
import type { TestRun, RunStep, WSRunMessage, PlaywrightScript } from "@/types/scripts"
import { getAuthToken } from "@/contexts/AuthContext"
import { generatePlaywrightCode } from "@/utils/playwrightCodeGen"
import LiveBrowserView from "@/components/LiveBrowserView"

const STATUS_COLORS: Record<string, string> = {
    'pending': 'bg-gray-100 text-gray-700 border-gray-200',
    'running': 'bg-yellow-100 text-yellow-700 border-yellow-200',
    'passed': 'bg-green-100 text-green-700 border-green-200',
    'failed': 'bg-red-100 text-red-700 border-red-200',
    'healed': 'bg-purple-100 text-purple-700 border-purple-200',
    'skipped': 'bg-gray-100 text-gray-500 border-gray-200',
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
    'pending': null,
    'running': <RefreshCw className="h-4 w-4 animate-spin" />,
    'passed': <CheckCircle className="h-4 w-4" />,
    'failed': <XCircle className="h-4 w-4" />,
    'healed': <Zap className="h-4 w-4" />,
    'skipped': null,
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
    'goto': <Globe className="h-4 w-4" />,
    'click': <MousePointer className="h-4 w-4" />,
    'fill': <Type className="h-4 w-4" />,
    'scroll': <Scroll className="h-4 w-4" />,
    'wait': <Clock className="h-4 w-4" />,
    'assert': <ShieldCheck className="h-4 w-4 text-blue-600" />,
    'hover': <MousePointer className="h-4 w-4 text-purple-500" />,
    'select': <Type className="h-4 w-4 text-green-500" />,
    'press': <Type className="h-4 w-4 text-orange-500" />,
}

function formatDuration(ms: number | null): string {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
}

function calculateRunDuration(startedAt: string | null, completedAt: string | null): string {
    if (!startedAt) return '-'
    const start = new Date(startedAt).getTime()
    const end = completedAt ? new Date(completedAt).getTime() : Date.now()
    const durationMs = end - start

    if (durationMs < 1000) return `${durationMs}ms`
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`
    const minutes = Math.floor(durationMs / 60000)
    const seconds = ((durationMs % 60000) / 1000).toFixed(0)
    return `${minutes}m ${seconds}s`
}

function formatDate(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })
}

export default function RunDetail() {
    const { scriptId, runId } = useParams<{ scriptId: string; runId: string }>()
    const navigate = useNavigate()
    const [run, setRun] = useState<TestRun | null>(null)
    const [steps, setSteps] = useState<RunStep[]>([])
    const [script, setScript] = useState<PlaywrightScript | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [selectedStep, setSelectedStep] = useState<RunStep | null>(null)
    const [expandedHealing, setExpandedHealing] = useState<string | null>(null)
    const [showCode, setShowCode] = useState(false)
    const [copied, setCopied] = useState(false)
    const [browserSession, setBrowserSession] = useState<{ id: string; liveViewUrl: string } | null>(null)
    const wsRef = useRef<WebSocket | null>(null)

    const fetchRun = async () => {
        if (!runId) return
        setLoading(true)
        setError(null)
        try {
            const data = await runsApi.getRun(runId)
            setRun(data)
            if (data.run_steps) {
                setSteps(data.run_steps)
                if (data.run_steps.length > 0 && !selectedStep) {
                    setSelectedStep(data.run_steps[data.run_steps.length - 1])
                }
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load run')
        } finally {
            setLoading(false)
        }
    }

    const fetchScript = async () => {
        if (!scriptId) return
        try {
            const data = await scriptsApi.getScript(scriptId)
            setScript(data)
        } catch (e) {
            console.error('Failed to fetch script:', e)
        }
    }

    const copyCode = async () => {
        if (!script) return
        const code = generatePlaywrightCode(script.steps_json, script.name)
        await navigator.clipboard.writeText(code)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    // WebSocket for live updates - only connect for pending/running runs
    useEffect(() => {
        // Only connect to WebSocket if run is pending or running
        // Completed runs don't need WebSocket - just display existing data
        if (!runId || !run) return
        if (run.status !== 'pending' && run.status !== 'running') return

        const token = getAuthToken()
        const wsUrl = getRunWebSocketUrl(runId) + (token ? `?token=${encodeURIComponent(token)}` : '')

        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onmessage = (event) => {
            try {
                const message: WSRunMessage = JSON.parse(event.data)

                if (message.type === 'browser_session_started') {
                    // Live browser session started
                    setBrowserSession({
                        id: message.session_id,
                        liveViewUrl: message.live_view_url,
                    })
                } else if (message.type === 'run_step_completed') {
                    const step = message.step
                    setSteps(prev => {
                        const existing = prev.findIndex(s => s.step_index === step.step_index)
                        if (existing >= 0) {
                            const updated = [...prev]
                            updated[existing] = step
                            return updated
                        }
                        return [...prev, step]
                    })
                    setSelectedStep(step)
                } else if (message.type === 'run_completed') {
                    setRun(message.run)
                    // Clear browser session on completion
                    setBrowserSession(null)
                } else if (message.type === 'error') {
                    setError(message.message)
                }
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e)
            }
        }

        ws.onerror = () => {
            console.error('WebSocket error')
        }

        ws.onclose = () => {
            console.log('WebSocket closed')
        }

        return () => {
            ws.close()
        }
    }, [runId, run?.status])

    useEffect(() => {
        fetchRun()
        fetchScript()
    }, [runId, scriptId])

    if (loading && !run) {
        return (
            <div className="p-6">
                <div className="flex items-center justify-center h-64">
                    <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </div>
        )
    }

    if (error && !run) {
        return (
            <div className="p-6">
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                    {error}
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                    <button
                        onClick={() => navigate(`/scripts/${scriptId}`)}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 w-9"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-3">
                            Test Run
                            {run && (
                                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${STATUS_COLORS[run.status]}`}>
                                    {STATUS_ICONS[run.status]}
                                    {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                                </span>
                            )}
                        </h1>
                        {run && (
                            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${run.runner_type === 'cdp' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                                    {run.runner_type === 'cdp' ? 'CDP Runner' : 'Playwright Runner'}
                                </span>
                                <span>Started: {run.started_at ? formatDate(run.started_at) : 'Pending'}</span>
                                {run.completed_at && <span>Completed: {formatDate(run.completed_at)}</span>}
                            </div>
                        )}
                    </div>
                </div>
                <button
                    onClick={fetchRun}
                    className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-3"
                >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                </button>
            </div>

            {/* Stats */}
            {run && (
                <div className="grid grid-cols-5 gap-4">
                    <div className="rounded-lg border bg-card p-4">
                        <p className="text-sm text-muted-foreground">Total Steps</p>
                        <p className="text-2xl font-bold">{run.total_steps}</p>
                    </div>
                    <div className="rounded-lg border bg-green-50 border-green-200 p-4">
                        <p className="text-sm text-green-700">Passed</p>
                        <p className="text-2xl font-bold text-green-700">{run.passed_steps}</p>
                    </div>
                    <div className="rounded-lg border bg-purple-50 border-purple-200 p-4">
                        <p className="text-sm text-purple-700">Healed</p>
                        <p className="text-2xl font-bold text-purple-700">{run.healed_steps}</p>
                    </div>
                    <div className="rounded-lg border bg-red-50 border-red-200 p-4">
                        <p className="text-sm text-red-700">Failed</p>
                        <p className="text-2xl font-bold text-red-700">{run.failed_steps}</p>
                    </div>
                    <div className="rounded-lg border bg-blue-50 border-blue-200 p-4">
                        <div className="flex items-center gap-1.5 text-sm text-blue-700">
                            <Timer className="h-4 w-4" />
                            Duration
                        </div>
                        <p className="text-2xl font-bold text-blue-700">
                            {calculateRunDuration(run.started_at, run.completed_at)}
                        </p>
                    </div>
                </div>
            )}

            {/* Error Message */}
            {run?.error_message && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="font-medium">Run Failed</p>
                        <p className="text-sm mt-1">{run.error_message}</p>
                    </div>
                </div>
            )}

            {/* Playwright Code Toggle */}
            {script && (
                <div className="rounded-lg border bg-card shadow-sm">
                    <div 
                        className="border-b px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-muted/30"
                        onClick={() => setShowCode(!showCode)}
                    >
                        <div className="flex items-center gap-2">
                            <Code className="h-5 w-5 text-blue-600" />
                            <h2 className="font-semibold">Playwright Code</h2>
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                {script.steps_json.length} steps
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {showCode && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); copyCode(); }}
                                    className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-8 px-3"
                                >
                                    {copied ? (
                                        <>
                                            <Check className="h-4 w-4 mr-1.5 text-green-600" />
                                            Copied!
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="h-4 w-4 mr-1.5" />
                                            Copy Code
                                        </>
                                    )}
                                </button>
                            )}
                            <ChevronDown className={`h-5 w-5 transition-transform ${showCode ? 'rotate-180' : ''}`} />
                        </div>
                    </div>
                    {showCode && (
                        <div className="p-4 bg-gray-900 rounded-b-lg overflow-x-auto">
                            <pre className="text-sm text-gray-100 font-mono whitespace-pre">
                                {generatePlaywrightCode(script.steps_json, script.name)}
                            </pre>
                        </div>
                    )}
                </div>
            )}



            {/* Steps and Screenshot */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Steps List */}
                <div className="rounded-lg border bg-card shadow-sm">
                    <div className="border-b px-4 py-3">
                        <h2 className="font-semibold">Steps</h2>
                    </div>
                    <div className="divide-y max-h-[600px] overflow-y-auto">
                        {steps.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground">
                                {run?.status === 'running' ? (
                                    <>
                                        <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                                        <p>Waiting for steps...</p>
                                    </>
                                ) : (
                                    <p>No steps recorded</p>
                                )}
                            </div>
                        ) : (
                            steps.map((step) => (
                                <div
                                    key={step.id}
                                    onClick={() => setSelectedStep(step)}
                                    className={`px-4 py-3 cursor-pointer transition-colors ${
                                        selectedStep?.id === step.id ? 'bg-muted' : 'hover:bg-muted/30'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${STATUS_COLORS[step.status]}`}>
                                                {STATUS_ICONS[step.status] || step.step_index + 1}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-muted-foreground">
                                                        {ACTION_ICONS[step.action] || null}
                                                    </span>
                                                    <span className="font-medium text-sm capitalize">{step.action}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <span className="text-xs text-muted-foreground">
                                            {formatDuration(step.duration_ms)}
                                        </span>
                                    </div>

                                    {/* Selector Used */}
                                    {step.selector_used && (
                                        <p className="text-xs text-muted-foreground mt-1 ml-10 font-mono truncate">
                                            {step.selector_used}
                                        </p>
                                    )}

                                    {/* Error */}
                                    {step.error_message && (
                                        <p className="text-xs text-red-600 mt-1 ml-10">
                                            {step.error_message}
                                        </p>
                                    )}

                                    {/* Healing Info */}
                                    {step.heal_attempts && step.heal_attempts.length > 0 && step.status === 'healed' && (
                                        <div className="mt-2 ml-10">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setExpandedHealing(expandedHealing === step.id ? null : step.id)
                                                }}
                                                className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700"
                                            >
                                                {expandedHealing === step.id ? (
                                                    <ChevronDown className="h-3 w-3" />
                                                ) : (
                                                    <ChevronRight className="h-3 w-3" />
                                                )}
                                                <Zap className="h-3 w-3" />
                                                Self-healed ({step.heal_attempts.length} attempts)
                                            </button>
                                            {expandedHealing === step.id && (
                                                <div className="mt-2 space-y-1 text-xs">
                                                    {step.heal_attempts.map((attempt, idx) => (
                                                        <div key={idx} className={`flex items-center gap-2 ${attempt.success ? 'text-green-600' : 'text-red-600'}`}>
                                                            {attempt.success ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                                            <span className="font-mono truncate">{attempt.selector}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Live Browser View (when running) OR Screenshot (when complete) */}
                <div className="rounded-lg border bg-card shadow-sm">
                    <div className="border-b px-4 py-3 flex items-center justify-between">
                        <h2 className="font-semibold flex items-center gap-2">
                            {run?.status === 'running' && browserSession ? (
                                <>
                                    <Monitor className="h-5 w-5 text-green-500" />
                                    Live Browser
                                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded animate-pulse font-normal">
                                        Connected
                                    </span>
                                </>
                            ) : run?.status === 'running' ? (
                                <>
                                    <Monitor className="h-5 w-5 text-yellow-500" />
                                    Live Browser
                                    <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                                </>
                            ) : (
                                <>
                                    Screenshot
                                    {selectedStep && (
                                        <span className="text-muted-foreground font-normal">
                                            Step {selectedStep.step_index + 1}
                                        </span>
                                    )}
                                </>
                            )}
                        </h2>
                    </div>
                    <div className="p-4">
                        {run?.status === 'running' ? (
                            browserSession ? (
                                <LiveBrowserView
                                    sessionId={browserSession.id}
                                    liveViewUrl={browserSession.liveViewUrl}
                                    className="min-h-[400px]"
                                />
                            ) : (
                                <div className="flex items-center justify-center h-64 bg-muted/30 rounded-lg">
                                    <div className="text-center">
                                        <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground" />
                                        <p className="text-muted-foreground">Waiting for browser session...</p>
                                    </div>
                                </div>
                            )
                        ) : selectedStep?.screenshot_path ? (
                            <img
                                src={getScreenshotUrl(selectedStep.screenshot_path)}
                                alt={`Step ${selectedStep.step_index + 1} screenshot`}
                                className="w-full rounded-lg border shadow-sm"
                            />
                        ) : (
                            <div className="flex items-center justify-center h-64 bg-muted/30 rounded-lg">
                                <p className="text-muted-foreground">
                                    {selectedStep ? 'No screenshot available' : 'Select a step to view screenshot'}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
