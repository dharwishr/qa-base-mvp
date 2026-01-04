import { useState, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { ArrowLeft, Play, RefreshCw, CheckCircle, XCircle, Zap, Clock, MousePointer, Type, Globe, Scroll, ShieldCheck, Video } from "lucide-react"
import { scriptsApi } from "@/services/api"
import type { PlaywrightScript, PlaywrightStep, TestRun, RunStatus, StartRunRequest } from "@/types/scripts"
import RunConfigModal from "@/components/RunConfigModal"

const STATUS_COLORS: Record<RunStatus, string> = {
    'pending': 'bg-gray-100 text-gray-700',
    'running': 'bg-yellow-100 text-yellow-700',
    'passed': 'bg-green-100 text-green-700',
    'failed': 'bg-red-100 text-red-700',
    'healed': 'bg-purple-100 text-purple-700',
}

const STATUS_LABELS: Record<RunStatus, string> = {
    'pending': 'Pending',
    'running': 'Running',
    'passed': 'Passed',
    'failed': 'Failed',
    'healed': 'Healed',
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

function calculateRunDuration(startedAt: string | null, completedAt: string | null): string | null {
    if (!startedAt) return null
    const start = new Date(startedAt).getTime()
    const end = completedAt ? new Date(completedAt).getTime() : Date.now()
    const durationMs = end - start
    if (durationMs < 1000) return `${durationMs}ms`
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`
    const minutes = Math.floor(durationMs / 60000)
    const seconds = ((durationMs % 60000) / 1000).toFixed(0)
    return `${minutes}m ${seconds}s`
}



export default function ScriptDetail() {
    const { scriptId } = useParams<{ scriptId: string }>()
    const navigate = useNavigate()
    const [script, setScript] = useState<PlaywrightScript | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [runningScript, setRunningScript] = useState(false)
    const [showConfigModal, setShowConfigModal] = useState(false)

    const fetchScript = async () => {
        if (!scriptId) return
        setLoading(true)
        setError(null)
        try {
            const data = await scriptsApi.getScript(scriptId)
            setScript(data)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load script')
        } finally {
            setLoading(false)
        }
    }

    const handleRunScript = async (config: StartRunRequest) => {
        if (!scriptId) return
        setRunningScript(true)
        try {
            const response = await scriptsApi.startRun(scriptId, config)
            setShowConfigModal(false)
            navigate(`/scripts/${scriptId}/runs/${response.run_id}`)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to start run')
            setRunningScript(false)
        }
    }

    useEffect(() => {
        fetchScript()
    }, [scriptId])

    if (loading) {
        return (
            <div className="p-6">
                <div className="flex items-center justify-center h-64">
                    <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </div>
        )
    }

    if (error || !script) {
        return (
            <div className="p-6">
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                    {error || 'Script not found'}
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
                        onClick={() => navigate('/scripts')}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 w-9"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold">{script.name}</h1>
                        {script.description && (
                            <p className="text-muted-foreground text-sm mt-1">{script.description}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                            Created {formatDate(script.created_at)} • {script.steps_json.length} steps
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowConfigModal(true)}
                        disabled={runningScript}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700 h-9 px-4 disabled:opacity-50"
                    >
                        <Play className="h-4 w-4 mr-2" />
                        Run Script
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Steps */}
                <div className="rounded-lg border bg-card shadow-sm">
                    <div className="border-b px-4 py-3">
                        <h2 className="font-semibold">Script Steps</h2>
                    </div>
                    <div className="divide-y max-h-[500px] overflow-y-auto">
                        {script.steps_json.map((step: PlaywrightStep, index) => (
                            <div key={index} className={`px-4 py-3 flex items-start gap-3 ${step.action === 'assert' ? 'bg-blue-50/50' : ''}`}>
                                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${step.action === 'assert' ? 'bg-blue-100 text-blue-700' : 'bg-muted'}`}>
                                    {step.index + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-muted-foreground">
                                            {ACTION_ICONS[step.action] || null}
                                        </span>
                                        <span className={`font-medium text-sm capitalize ${step.action === 'assert' ? 'text-blue-700' : ''}`}>
                                            {step.action}
                                        </span>
                                        {step.assertion && (
                                            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                                {step.assertion.assertion_type.replace('_', ' ')}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-muted-foreground mt-0.5 truncate">
                                        {step.description || step.url || step.value || '-'}
                                    </p>
                                    {step.assertion?.expected_value && (
                                        <p className="text-xs text-blue-600 mt-1 font-mono truncate">
                                            Expected: "{step.assertion.expected_value}"
                                        </p>
                                    )}
                                    {step.selectors && (
                                        <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                                            {step.selectors.primary}
                                        </p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Run History */}
                <div className="rounded-lg border bg-card shadow-sm">
                    <div className="border-b px-4 py-3 flex items-center justify-between">
                        <h2 className="font-semibold">Run History</h2>
                        <button
                            onClick={fetchScript}
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <RefreshCw className="h-4 w-4" />
                        </button>
                    </div>
                    {script.runs && script.runs.length > 0 ? (
                        <div className="divide-y max-h-[500px] overflow-y-auto">
                            {script.runs.map((run: TestRun) => (
                                <div
                                    key={run.id}
                                    onClick={() => navigate(`/scripts/${scriptId}/runs/${run.id}`)}
                                    className="px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[run.status]}`}>
                                                {run.status === 'passed' && <CheckCircle className="h-3 w-3" />}
                                                {run.status === 'failed' && <XCircle className="h-3 w-3" />}
                                                {run.status === 'healed' && <Zap className="h-3 w-3" />}
                                                {run.status === 'running' && <RefreshCw className="h-3 w-3 animate-spin" />}
                                                {STATUS_LABELS[run.status]}
                                            </span>
                                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                                                {run.browser_type?.charAt(0).toUpperCase() + run.browser_type?.slice(1) || 'Chromium'}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {formatDate(run.created_at)}
                                            </span>
                                        </div>
                                        {calculateRunDuration(run.started_at, run.completed_at) && (
                                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                                <Clock className="h-3 w-3" />
                                                {calculateRunDuration(run.started_at, run.completed_at)}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center justify-between mt-2">
                                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                            <span className="text-green-600">{run.passed_steps} passed</span>
                                            {run.healed_steps > 0 && (
                                                <span className="text-purple-600">{run.healed_steps} healed</span>
                                            )}
                                            {run.failed_steps > 0 && (
                                                <span className="text-red-600">{run.failed_steps} failed</span>
                                            )}
                                            <span>/ {run.total_steps} total</span>
                                        </div>
                                        {run.recording_enabled && run.video_path && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    navigate(`/scripts/${scriptId}/runs/${run.id}?tab=video`)
                                                }}
                                                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                                                title="Watch recording"
                                            >
                                                <Video className="h-3.5 w-3.5" />
                                                Watch Video
                                            </button>
                                        )}
                                    </div>
                                    {run.error_message && (
                                        <p className="text-xs text-red-600 mt-1 truncate">
                                            {run.error_message}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-8 text-center text-muted-foreground">
                            <p>No runs yet</p>
                            <p className="text-sm mt-1">Click "Run Script" to execute</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Run Configuration Modal */}
            <RunConfigModal
                isOpen={showConfigModal}
                onClose={() => setShowConfigModal(false)}
                onRun={handleRunScript}
                isRunning={runningScript}
            />
        </div>
    )
}
