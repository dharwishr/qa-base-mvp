import { useState, useEffect, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { ArrowLeft, RefreshCw, CheckCircle, XCircle, Zap, Clock, MousePointer, Type, Globe, Scroll, AlertTriangle, ChevronDown, ChevronRight, ShieldCheck, Code, Copy, Check, Timer, Wifi, Terminal, Video, Chrome } from "lucide-react"
import { runsApi, scriptsApi, getScreenshotUrl, getRunWebSocketUrl } from "@/services/api"
import type { TestRun, RunStep, PlaywrightScript, NetworkRequest, ConsoleLog } from "@/types/scripts"
import { getAuthToken } from "@/contexts/AuthContext"
import { generatePlaywrightCode } from "@/utils/playwrightCodeGen"

type Tab = 'steps' | 'network' | 'console' | 'video'

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
    const wsRef = useRef<WebSocket | null>(null)
    const networkScrollRef = useRef<HTMLDivElement | null>(null)
    const consoleScrollRef = useRef<HTMLDivElement | null>(null)
    // New state for tabs
    const [activeTab, setActiveTab] = useState<Tab>('steps')
    const [networkRequests, setNetworkRequests] = useState<NetworkRequest[]>([])
    const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([])
    const [loadingNetwork, setLoadingNetwork] = useState(false)
    const [loadingConsole, setLoadingConsole] = useState(false)

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

    const fetchNetworkRequests = async () => {
        if (!runId) return
        setLoadingNetwork(true)
        try {
            const data = await runsApi.getNetworkRequests(runId)
            setNetworkRequests(data)
        } catch (e) {
            console.error('Failed to fetch network requests:', e)
        } finally {
            setLoadingNetwork(false)
        }
    }

    const fetchConsoleLogs = async () => {
        if (!runId) return
        setLoadingConsole(true)
        try {
            const data = await runsApi.getConsoleLogs(runId)
            setConsoleLogs(data)
        } catch (e) {
            console.error('Failed to fetch console logs:', e)
        } finally {
            setLoadingConsole(false)
        }
    }

    // Fetch network/console data when tab changes
    useEffect(() => {
        if (activeTab === 'network' && networkRequests.length === 0) {
            fetchNetworkRequests()
        } else if (activeTab === 'console' && consoleLogs.length === 0) {
            fetchConsoleLogs()
        }
    }, [activeTab])

    // Auto-scroll network logs when new items arrive
    useEffect(() => {
        if (networkScrollRef.current && run?.status === 'running') {
            networkScrollRef.current.scrollTop = networkScrollRef.current.scrollHeight
        }
    }, [networkRequests.length])

    // Auto-scroll console logs when new items arrive
    useEffect(() => {
        if (consoleScrollRef.current && run?.status === 'running') {
            consoleScrollRef.current.scrollTop = consoleScrollRef.current.scrollHeight
        }
    }, [consoleLogs.length])

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
                const message = JSON.parse(event.data)

                if (message.type === 'run_step_completed') {
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
                } else if (message.type === 'error') {
                    setError(message.message)
                } else if (message.type === 'live_network') {
                    // Live network request from Redis pub/sub
                    const req = message.data
                    setNetworkRequests(prev => {
                        // Create a temporary ID for live requests
                        const liveReq: NetworkRequest = {
                            id: `live-${Date.now()}-${Math.random()}`,
                            run_id: runId || '',
                            step_index: req.step_index,
                            url: req.url || '',
                            method: req.method || 'GET',
                            resource_type: req.resource_type || 'other',
                            status_code: req.status_code,
                            response_size_bytes: req.response_size_bytes,
                            timing_total_ms: req.timing_total_ms,
                            timing_dns_ms: req.timing_dns_ms,
                            timing_connect_ms: req.timing_connect_ms,
                            timing_ssl_ms: req.timing_ssl_ms,
                            timing_ttfb_ms: req.timing_ttfb_ms,
                            timing_download_ms: req.timing_download_ms,
                            started_at: req.started_at || new Date().toISOString(),
                            completed_at: req.completed_at || new Date().toISOString(),
                        }
                        return [...prev, liveReq]
                    })
                } else if (message.type === 'live_console') {
                    // Live console log from Redis pub/sub
                    const log = message.data
                    setConsoleLogs(prev => {
                        const liveLog: ConsoleLog = {
                            id: `live-${Date.now()}-${Math.random()}`,
                            run_id: runId || '',
                            step_index: log.step_index,
                            level: log.level || 'log',
                            message: log.message || '',
                            source: log.source,
                            line_number: log.line_number,
                            column_number: log.column_number,
                            stack_trace: log.stack_trace,
                            timestamp: log.timestamp || new Date().toISOString(),
                        }
                        return [...prev, liveLog]
                    })
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

    // Polling fallback for running tests - ensures updates even if WebSocket fails
    useEffect(() => {
        if (!runId || !run) return
        if (run.status !== 'pending' && run.status !== 'running') return

        // Poll every 2 seconds as backup to WebSocket
        const pollInterval = setInterval(() => {
            fetchRun()
            // Also refresh network/console if those tabs are active
            if (activeTab === 'network') fetchNetworkRequests()
            if (activeTab === 'console') fetchConsoleLogs()
        }, 2000)

        return () => clearInterval(pollInterval)
    }, [runId, run?.status, activeTab])

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
                            <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-muted-foreground">
                                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                                    <Chrome className="h-3 w-3" />
                                    {run.browser_type?.charAt(0).toUpperCase() + run.browser_type?.slice(1) || 'Chromium'}
                                </span>
                                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                                    {run.resolution_width || 1920}x{run.resolution_height || 1080}
                                </span>
                                <span className="text-muted-foreground">•</span>
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



            {/* Tab Navigation */}
            <div className="border-b">
                <div className="flex gap-1">
                    <button
                        onClick={() => setActiveTab('steps')}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'steps'
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <CheckCircle className="h-4 w-4" />
                        Steps
                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{steps.length}</span>
                    </button>
                    {run?.network_recording_enabled && (
                        <button
                            onClick={() => setActiveTab('network')}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'network'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            <Wifi className="h-4 w-4" />
                            Network
                            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{networkRequests.length}</span>
                        </button>
                    )}
                    <button
                        onClick={() => setActiveTab('console')}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'console'
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Terminal className="h-4 w-4" />
                        Console
                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{consoleLogs.length}</span>
                    </button>
                    {run?.recording_enabled && run?.video_path && (
                        <button
                            onClick={() => setActiveTab('video')}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'video'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            <Video className="h-4 w-4" />
                            Video
                        </button>
                    )}
                </div>
            </div>

            {/* Tab Content */}
            {activeTab === 'steps' && (
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
                                        className={`px-4 py-3 cursor-pointer transition-colors ${selectedStep?.id === step.id ? 'bg-muted' : 'hover:bg-muted/30'
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

                    {/* Screenshot Panel */}
                    <div className="rounded-lg border bg-card shadow-sm">
                        <div className="border-b px-4 py-3 flex items-center justify-between">
                            <h2 className="font-semibold flex items-center gap-2">
                                Screenshot
                                {selectedStep && (
                                    <span className="text-muted-foreground font-normal">
                                        Step {selectedStep.step_index + 1}
                                    </span>
                                )}
                            </h2>
                        </div>
                        <div className="p-4">
                            {selectedStep?.screenshot_path ? (
                                <img
                                    src={getScreenshotUrl(selectedStep.screenshot_path)}
                                    alt={`Step ${selectedStep.step_index + 1} screenshot`}
                                    className="w-full rounded-lg border shadow-sm"
                                />
                            ) : run?.status === 'running' ? (
                                <div className="flex items-center justify-center h-64 bg-muted/30 rounded-lg">
                                    <div className="text-center">
                                        <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground" />
                                        <p className="text-muted-foreground">Test running on container...</p>
                                        <p className="text-xs text-muted-foreground mt-1">Screenshots will appear as steps complete</p>
                                    </div>
                                </div>
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
            )}

            {/* Network Tab */}
            {activeTab === 'network' && (
                <div className="rounded-lg border bg-card shadow-sm">
                    <div className="border-b px-4 py-3 flex items-center justify-between">
                        <h2 className="font-semibold">Network Requests</h2>
                        {run?.status === 'running' && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                                Live
                            </span>
                        )}
                    </div>
                    <div ref={networkScrollRef} className="divide-y max-h-[600px] overflow-y-auto">
                        {loadingNetwork ? (
                            <div className="p-8 text-center text-muted-foreground">
                                <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                                <p>Loading network requests...</p>
                            </div>
                        ) : networkRequests.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground">
                                <Wifi className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                {run?.status === 'running' ? (
                                    <>
                                        <p>Waiting for network requests...</p>
                                        <p className="text-xs mt-1">Requests will appear here in real-time</p>
                                    </>
                                ) : (
                                    <>
                                        <p>No network requests captured</p>
                                        <p className="text-xs mt-1">Enable network recording to capture API calls</p>
                                    </>
                                )}
                            </div>
                        ) : (
                            networkRequests.map((req) => (
                                <div key={req.id} className="px-4 py-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${req.method === 'GET' ? 'bg-green-100 text-green-700' :
                                                    req.method === 'POST' ? 'bg-blue-100 text-blue-700' :
                                                        req.method === 'PUT' ? 'bg-yellow-100 text-yellow-700' :
                                                            req.method === 'DELETE' ? 'bg-red-100 text-red-700' :
                                                                'bg-gray-100 text-gray-700'
                                                }`}>
                                                {req.method}
                                            </span>
                                            <span className={`text-xs ${req.status_code && req.status_code >= 200 && req.status_code < 300 ? 'text-green-600' :
                                                    req.status_code && req.status_code >= 400 ? 'text-red-600' :
                                                        'text-muted-foreground'
                                                }`}>
                                                {req.status_code || '-'}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            {req.timing_total_ms && <span>{req.timing_total_ms}ms</span>}
                                            {req.response_size_bytes && <span>{(req.response_size_bytes / 1024).toFixed(1)}KB</span>}
                                        </div>
                                    </div>
                                    <p className="text-sm text-muted-foreground mt-1 font-mono truncate">{req.url}</p>
                                    <span className="text-xs text-muted-foreground">{req.resource_type}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Console Tab */}
            {activeTab === 'console' && (
                <div className="rounded-lg border bg-card shadow-sm">
                    <div className="border-b px-4 py-3 flex items-center justify-between">
                        <h2 className="font-semibold">Console Logs</h2>
                        {run?.status === 'running' && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                                Live
                            </span>
                        )}
                    </div>
                    <div ref={consoleScrollRef} className="divide-y max-h-[600px] overflow-y-auto font-mono text-sm">
                        {loadingConsole ? (
                            <div className="p-8 text-center text-muted-foreground">
                                <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                                <p>Loading console logs...</p>
                            </div>
                        ) : consoleLogs.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground">
                                <Terminal className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                {run?.status === 'running' ? (
                                    <>
                                        <p>Waiting for console logs...</p>
                                        <p className="text-xs mt-1 font-sans">Logs will appear here in real-time</p>
                                    </>
                                ) : (
                                    <p>No console logs captured</p>
                                )}
                            </div>
                        ) : (
                            consoleLogs.map((log) => (
                                <div key={log.id} className={`px-4 py-2 ${log.level === 'error' ? 'bg-red-50' :
                                        log.level === 'warn' ? 'bg-yellow-50' :
                                            ''
                                    }`}>
                                    <div className="flex items-start gap-2">
                                        <span className={`inline-flex items-center rounded px-1 py-0.5 text-xs font-medium ${log.level === 'error' ? 'bg-red-100 text-red-700' :
                                                log.level === 'warn' ? 'bg-yellow-100 text-yellow-700' :
                                                    log.level === 'info' ? 'bg-blue-100 text-blue-700' :
                                                        'bg-gray-100 text-gray-700'
                                            }`}>
                                            {log.level}
                                        </span>
                                        <span className="flex-1 break-all">{log.message}</span>
                                    </div>
                                    {log.source && (
                                        <p className="text-xs text-muted-foreground mt-1 ml-12">
                                            {log.source}{log.line_number ? `:${log.line_number}` : ''}
                                        </p>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Video Tab */}
            {activeTab === 'video' && run?.video_path && (
                <div className="rounded-lg border bg-card shadow-sm">
                    <div className="border-b px-4 py-3">
                        <h2 className="font-semibold">Video Recording</h2>
                    </div>
                    <div className="p-4">
                        <video
                            controls
                            className="w-full rounded-lg border shadow-sm"
                            src={getScreenshotUrl(`videos/${run.video_path.split('/').pop()}`)}
                        >
                            Your browser does not support the video tag.
                        </video>
                        <p className="text-xs text-muted-foreground mt-2">
                            Video path: {run.video_path}
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}
