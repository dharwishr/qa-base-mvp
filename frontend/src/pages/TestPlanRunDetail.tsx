import { useState, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import {
    ArrowLeft,
    RefreshCw,
    CheckCircle,
    XCircle,
    Clock,
    Play,
    ChevronRight,
    Monitor,
    Camera,
    Video,
    Wifi,
    Gauge,
    Eye,
    StopCircle,
    Loader2,
} from "lucide-react"
import { testPlansApi } from "@/services/api"
import type {
    TestPlanRunDetail as TestPlanRunDetailType,
    TestPlanRunResult,
    BrowserType,
} from "@/types/test-plans"

const STATUS_COLORS: Record<string, string> = {
    'pending': 'bg-gray-100 text-gray-700',
    'queued': 'bg-blue-100 text-blue-700',
    'running': 'bg-yellow-100 text-yellow-700',
    'passed': 'bg-green-100 text-green-700',
    'failed': 'bg-red-100 text-red-700',
    'skipped': 'bg-gray-100 text-gray-500',
    'cancelled': 'bg-gray-100 text-gray-700',
}

const STATUS_LABELS: Record<string, string> = {
    'pending': 'Pending',
    'queued': 'Queued',
    'running': 'Running',
    'passed': 'Passed',
    'failed': 'Failed',
    'skipped': 'Skipped',
    'cancelled': 'Cancelled',
}

const BROWSER_LABELS: Record<BrowserType, string> = {
    'chromium': 'Chrome',
    'firefox': 'Firefox',
    'webkit': 'Safari',
    'edge': 'Edge',
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

function formatDuration(ms: number | null): string {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    const minutes = Math.floor(ms / 60000)
    const seconds = ((ms % 60000) / 1000).toFixed(0)
    return `${minutes}m ${seconds}s`
}

export default function TestPlanRunDetail() {
    const { runId } = useParams<{ runId: string }>()
    const navigate = useNavigate()
    const [runDetail, setRunDetail] = useState<TestPlanRunDetailType | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [cancelling, setCancelling] = useState(false)

    const fetchRunDetail = async () => {
        if (!runId) return
        setLoading(true)
        try {
            const data = await testPlansApi.getRunDetail(runId)
            setRunDetail(data)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load run details')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchRunDetail()

        // Poll for updates if running
        const interval = setInterval(() => {
            if (runDetail?.status === 'running' || runDetail?.status === 'queued' || runDetail?.status === 'pending') {
                fetchRunDetail()
            }
        }, 5000)

        return () => clearInterval(interval)
    }, [runId])

    // Refresh when status changes to running
    useEffect(() => {
        if (runDetail?.status === 'running' || runDetail?.status === 'queued') {
            const interval = setInterval(fetchRunDetail, 3000)
            return () => clearInterval(interval)
        }
    }, [runDetail?.status])

    const handleCancel = async () => {
        if (!runId || !confirm('Cancel this run?')) return
        setCancelling(true)
        try {
            await testPlansApi.cancelRun(runId)
            await fetchRunDetail()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to cancel run')
        } finally {
            setCancelling(false)
        }
    }

    if (loading) {
        return (
            <div className="p-6">
                <div className="flex items-center justify-center h-64">
                    <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </div>
        )
    }

    if (error || !runDetail) {
        return (
            <div className="p-6">
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                    {error || 'Run not found'}
                </div>
            </div>
        )
    }

    const isRunning = runDetail.status === 'running' || runDetail.status === 'queued' || runDetail.status === 'pending'
    const successRate = runDetail.total_test_cases > 0
        ? Math.round((runDetail.passed_test_cases / runDetail.total_test_cases) * 100)
        : 0

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                    <button
                        onClick={() => navigate(`/test-plans/${runDetail.test_plan_id}`)}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 w-9"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-3">
                            Test Plan Run
                            <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ${STATUS_COLORS[runDetail.status]}`}>
                                {runDetail.status === 'passed' && <CheckCircle className="h-4 w-4" />}
                                {runDetail.status === 'failed' && <XCircle className="h-4 w-4" />}
                                {isRunning && <RefreshCw className="h-4 w-4 animate-spin" />}
                                {STATUS_LABELS[runDetail.status]}
                            </span>
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            Started {formatDate(runDetail.created_at)}
                            {runDetail.user_name && ` by ${runDetail.user_name}`}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isRunning && (
                        <button
                            onClick={handleCancel}
                            disabled={cancelling}
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 h-9 px-4 disabled:opacity-50"
                        >
                            {cancelling ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <StopCircle className="h-4 w-4 mr-2" />
                            )}
                            Cancel Run
                        </button>
                    )}
                    <button
                        onClick={fetchRunDetail}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-4"
                    >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4">
                <div className="rounded-lg border bg-card p-4">
                    <div className="text-sm text-muted-foreground">Total Tests</div>
                    <div className="text-2xl font-bold mt-1">{runDetail.total_test_cases}</div>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <div className="text-sm text-muted-foreground">Passed</div>
                    <div className="text-2xl font-bold mt-1 text-green-600">{runDetail.passed_test_cases}</div>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <div className="text-sm text-muted-foreground">Failed</div>
                    <div className="text-2xl font-bold mt-1 text-red-600">{runDetail.failed_test_cases}</div>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <div className="text-sm text-muted-foreground">Success Rate</div>
                    <div className="text-2xl font-bold mt-1">{successRate}%</div>
                </div>
            </div>

            {/* Run Configuration */}
            <div className="rounded-lg border bg-card shadow-sm">
                <div className="border-b px-4 py-3">
                    <h2 className="font-semibold">Run Configuration</h2>
                </div>
                <div className="p-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="flex items-center gap-2">
                            <Play className="h-4 w-4 text-muted-foreground" />
                            <div>
                                <div className="text-xs text-muted-foreground">Run Type</div>
                                <div className="text-sm font-medium capitalize">{runDetail.run_type}</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Monitor className="h-4 w-4 text-muted-foreground" />
                            <div>
                                <div className="text-xs text-muted-foreground">Browser</div>
                                <div className="text-sm font-medium">{BROWSER_LABELS[runDetail.browser_type]}</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Monitor className="h-4 w-4 text-muted-foreground" />
                            <div>
                                <div className="text-xs text-muted-foreground">Resolution</div>
                                <div className="text-sm font-medium">{runDetail.resolution_width}x{runDetail.resolution_height}</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <div>
                                <div className="text-xs text-muted-foreground">Duration</div>
                                <div className="text-sm font-medium">{formatDuration(runDetail.duration_ms)}</div>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-4 mt-4 pt-4 border-t">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${runDetail.headless ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            <Eye className="h-3 w-3" />
                            {runDetail.headless ? 'Headless' : 'Headed'}
                        </span>
                        {runDetail.screenshots_enabled && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-blue-100 text-blue-700">
                                <Camera className="h-3 w-3" />
                                Screenshots
                            </span>
                        )}
                        {runDetail.recording_enabled && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-purple-100 text-purple-700">
                                <Video className="h-3 w-3" />
                                Recording
                            </span>
                        )}
                        {runDetail.network_recording_enabled && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-orange-100 text-orange-700">
                                <Wifi className="h-3 w-3" />
                                Network
                            </span>
                        )}
                        {runDetail.performance_metrics_enabled && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-teal-100 text-teal-700">
                                <Gauge className="h-3 w-3" />
                                Metrics
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Error Message */}
            {runDetail.error_message && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <h3 className="font-medium text-red-800">Error</h3>
                    <p className="text-sm text-red-700 mt-1">{runDetail.error_message}</p>
                </div>
            )}

            {/* Test Results */}
            <div className="rounded-lg border bg-card shadow-sm">
                <div className="border-b px-4 py-3">
                    <h2 className="font-semibold">Test Results</h2>
                </div>
                <div className="divide-y">
                    {runDetail.results.map((result, index) => (
                        <TestResultRow
                            key={result.id}
                            result={result}
                            index={index}
                            onViewRun={(runId) => navigate(`/scripts/session/runs/${runId}`)}
                        />
                    ))}
                </div>
            </div>
        </div>
    )
}

interface TestResultRowProps {
    result: TestPlanRunResult
    index: number
    onViewRun: (runId: string) => void
}

function TestResultRow({ result, index, onViewRun }: TestResultRowProps) {
    const statusIcon = {
        'pending': <Clock className="h-4 w-4 text-gray-400" />,
        'running': <RefreshCw className="h-4 w-4 text-yellow-500 animate-spin" />,
        'passed': <CheckCircle className="h-4 w-4 text-green-500" />,
        'failed': <XCircle className="h-4 w-4 text-red-500" />,
        'skipped': <Clock className="h-4 w-4 text-gray-400" />,
    }

    return (
        <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                {index + 1}
            </div>
            <div className="flex-shrink-0">
                {statusIcon[result.status] || <Clock className="h-4 w-4 text-gray-400" />}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                    {result.test_session_title || `Test Case ${index + 1}`}
                </div>
                <div className="text-xs text-muted-foreground">
                    {result.started_at && `Started ${formatDate(result.started_at)}`}
                    {result.duration_ms && ` • ${formatDuration(result.duration_ms)}`}
                </div>
                {result.error_message && (
                    <div className="text-xs text-red-600 mt-1 truncate">
                        {result.error_message}
                    </div>
                )}
            </div>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[result.status]}`}>
                {STATUS_LABELS[result.status]}
            </span>
            {result.test_run_id && (
                <button
                    onClick={() => onViewRun(result.test_run_id!)}
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                >
                    View Details
                    <ChevronRight className="h-4 w-4" />
                </button>
            )}
        </div>
    )
}
