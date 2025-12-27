import { useState, useEffect, useCallback } from "react"
import { useParams, useNavigate, useSearchParams } from "react-router-dom"
import { ArrowLeft, ExternalLink, RefreshCw, LayoutGrid, List, Loader2 } from "lucide-react"
import { benchmarkApi } from "@/services/benchmarkApi"
import BenchmarkModelPanel from "@/components/benchmark/BenchmarkModelPanel"
import type { BenchmarkSession, BenchmarkModelRun } from "@/types/benchmark"
import type { LlmModel, TestStep, TestPlan } from "@/types/analysis"
import type { TimelineMessage, ChatMode } from "@/types/chat"
import type { ModelRunState } from "@/hooks/useBenchmarkSession"

const STATUS_COLORS: Record<string, string> = {
    'pending': 'bg-gray-100 text-gray-700',
    'planning': 'bg-blue-100 text-blue-700',
    'plan_ready': 'bg-purple-100 text-purple-700',
    'queued': 'bg-gray-100 text-gray-700',
    'approved': 'bg-purple-100 text-purple-700',
    'rejected': 'bg-red-100 text-red-700',
    'running': 'bg-yellow-100 text-yellow-700',
    'completed': 'bg-green-100 text-green-700',
    'failed': 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
    'pending': 'Pending',
    'planning': 'Planning',
    'plan_ready': 'Plan Ready',
    'queued': 'Queued',
    'approved': 'Approved',
    'rejected': 'Rejected',
    'running': 'Running',
    'completed': 'Completed',
    'failed': 'Failed',
}

const MODE_LABELS: Record<string, string> = {
    'auto': 'Auto',
    'plan': 'Plan',
    'act': 'Act',
}

const LLM_LABELS: Record<LlmModel, string> = {
    'browser-use-llm': 'Browser Use',
    'gemini-2.0-flash': 'Gemini 2.0 Flash',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-3.0-flash': 'Gemini 3.0 Flash',
    'gemini-3.0-pro': 'Gemini 3.0 Pro',
    'gemini-2.5-computer-use': 'Gemini 2.5 CU',
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

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${mins}m ${secs}s`
}

// Generate UUID with fallback for non-secure contexts (HTTP)
function generateUUID(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function createTimelineMessage<T extends TimelineMessage>(
    type: T['type'],
    data: Omit<T, 'id' | 'timestamp' | 'type'>
): T {
    return {
        id: generateUUID(),
        timestamp: new Date().toISOString(),
        type,
        ...data,
    } as T;
}

export default function BenchmarkDetailPage() {
    const { benchmarkId } = useParams<{ benchmarkId: string }>()
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const [session, setSession] = useState<BenchmarkSession | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    
    // Combined view state - check URL param for initial view
    const initialView = searchParams.get('view') === 'combined' ? 'combined' : 'list'
    const [viewMode, setViewMode] = useState<'list' | 'combined'>(initialView)
    const [combinedRunStates, setCombinedRunStates] = useState<Map<string, ModelRunState>>(new Map())
    const [loadingCombined, setLoadingCombined] = useState(false)
    const [combinedError, setCombinedError] = useState<string | null>(null)
    const [autoLoadCombined, setAutoLoadCombined] = useState(initialView === 'combined')

    const fetchSession = async () => {
        if (!benchmarkId) return
        setLoading(true)
        setError(null)
        try {
            const data = await benchmarkApi.getSession(benchmarkId)
            setSession(data)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load benchmark session')
        } finally {
            setLoading(false)
        }
    }

    const handleViewCombinedResults = useCallback(async () => {
        if (!session || !benchmarkId) return
        setLoadingCombined(true)
        setCombinedError(null)

        try {
            const updates = await Promise.all(
                session.model_runs.map(async (run) => {
                    let steps: TestStep[] = []
                    let plan: TestPlan | null = null

                    if (run.test_session_id) {
                        steps = await benchmarkApi.getModelRunSteps(benchmarkId, run.id)
                    }

                    if ((run.status === 'plan_ready' || run.status === 'approved') && run.test_session_id) {
                        try {
                            plan = await benchmarkApi.getModelRunPlan(benchmarkId, run.id)
                        } catch (e) {
                            console.error(`Error fetching plan for model run ${run.id}:`, e)
                        }
                    }

                    // Build messages: user prompt + all steps + completion system message
                    const messages: TimelineMessage[] = []

                    // Initial user prompt
                    messages.push(
                        createTimelineMessage('user', {
                            content: session.prompt,
                            mode: (session.mode === 'act' ? 'act' : 'plan') as ChatMode,
                        })
                    )

                    // System message for start
                    messages.push(
                        createTimelineMessage('system', {
                            content: `Started execution with ${run.llm_model}`,
                        })
                    )

                    // Step messages
                    for (const step of steps) {
                        messages.push(createTimelineMessage('step', { step }))
                    }

                    // Completion message
                    if (run.status === 'completed') {
                        messages.push(
                            createTimelineMessage('system', {
                                content: `Completed with ${run.total_steps} steps in ${run.duration_seconds.toFixed(1)}s`,
                            })
                        )
                    } else if (run.status === 'failed' && run.error) {
                        messages.push(createTimelineMessage('error', { content: run.error }))
                    }

                    const selectedStepId = steps.length > 0 ? steps[steps.length - 1].id : null

                    const state: ModelRunState = {
                        modelRun: run,
                        messages,
                        steps,
                        plan,
                        browserSession: null, // history view - no live browser
                        selectedStepId,
                        lastStepCount: steps.length,
                    }

                    return { id: run.id, state }
                })
            )

            const map = new Map<string, ModelRunState>()
            for (const { id, state } of updates) {
                map.set(id, state)
            }
            setCombinedRunStates(map)
            setViewMode('combined')
        } catch (e) {
            console.error('Error loading combined results', e)
            setCombinedError(
                e instanceof Error ? e.message : 'Failed to load combined results'
            )
        } finally {
            setLoadingCombined(false)
        }
    }, [session, benchmarkId])

    const setSelectedStepIdForRun = useCallback((modelRunId: string, stepId: string | null) => {
        setCombinedRunStates(prev => {
            const next = new Map(prev)
            const state = next.get(modelRunId)
            if (!state) return prev
            next.set(modelRunId, { ...state, selectedStepId: stepId })
            return next
        })
    }, [])

    useEffect(() => {
        fetchSession()
    }, [benchmarkId])

    // Auto-load combined view if URL param is set
    useEffect(() => {
        if (autoLoadCombined && session && !loading && combinedRunStates.size === 0) {
            handleViewCombinedResults()
            setAutoLoadCombined(false)
        }
    }, [autoLoadCombined, session, loading, combinedRunStates.size, handleViewCombinedResults])

    if (loading) {
        return (
            <div className="p-6">
                <div className="text-center text-muted-foreground">Loading benchmark session...</div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="p-6 space-y-4">
                <button
                    onClick={() => navigate('/benchmarks')}
                    className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back to History
                </button>
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                    {error}
                </div>
            </div>
        )
    }

    if (!session) {
        return (
            <div className="p-6 space-y-4">
                <button
                    onClick={() => navigate('/benchmarks')}
                    className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back to History
                </button>
                <div className="text-center text-muted-foreground">Benchmark session not found</div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-[calc(100vh-3.5rem)]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/20">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('/benchmarks')}
                        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="h-4 w-4 mr-1" />
                        Back to History
                    </button>
                    <div>
                        <h1 className="text-lg font-bold">{session.title || 'Untitled Benchmark'}</h1>
                        <p className="text-xs text-muted-foreground">
                            Created {formatDate(session.created_at)}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[session.status] || 'bg-gray-100 text-gray-700'}`}>
                        {STATUS_LABELS[session.status] || session.status}
                    </span>
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700">
                        {MODE_LABELS[session.mode] || session.mode}
                    </span>
                    
                    {/* View toggle */}
                    <div className="flex items-center border rounded-lg ml-4">
                        <button
                            onClick={() => setViewMode('list')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-l-lg transition-colors ${
                                viewMode === 'list'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'
                            }`}
                        >
                            <List className="h-4 w-4" />
                        </button>
                        <button
                            onClick={handleViewCombinedResults}
                            disabled={loadingCombined}
                            className={`px-3 py-1.5 text-xs font-medium rounded-r-lg transition-colors ${
                                viewMode === 'combined'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'
                            }`}
                            title="View Combined Results"
                        >
                            {loadingCombined ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <LayoutGrid className="h-4 w-4" />
                            )}
                        </button>
                    </div>
                    
                    <button
                        onClick={fetchSession}
                        disabled={loading}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-3"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {combinedError && (
                <div className="mx-6 mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {combinedError}
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-auto">
                {viewMode === 'list' ? (
                    /* List View */
                    <div className="p-6 space-y-6">
                        {/* Session Info */}
                        <div className="rounded-lg border bg-card shadow-sm p-6">
                            <h3 className="text-sm font-medium mb-2">Prompt</h3>
                            <div className="bg-muted/50 rounded-md p-3 text-sm whitespace-pre-wrap">
                                {session.prompt}
                            </div>
                        </div>

                        {/* Model Runs */}
                        <div>
                            <h2 className="text-lg font-semibold mb-4">Model Runs ({session.model_runs.length})</h2>
                            <div className="grid gap-4">
                                {session.model_runs.map((run) => (
                                    <ModelRunListItem key={run.id} run={run} navigate={navigate} />
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Combined View - Side by Side Panels */
                    <div className="p-4 h-full">
                        <div
                            className={`grid h-full gap-4 ${
                                combinedRunStates.size === 1
                                    ? 'grid-cols-1'
                                    : combinedRunStates.size === 2
                                    ? 'grid-cols-2'
                                    : 'grid-cols-3'
                            }`}
                        >
                            {Array.from(combinedRunStates.values()).map((state) => (
                                <BenchmarkModelPanel
                                    key={state.modelRun.id}
                                    modelRunState={state}
                                    headless={true} // history view: screenshot mode only
                                    onStepSelect={setSelectedStepIdForRun}
                                    onApprovePlan={undefined}
                                    onRejectPlan={undefined}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

function ModelRunListItem({ run, navigate }: { run: BenchmarkModelRun; navigate: ReturnType<typeof useNavigate> }) {
    return (
        <div className="rounded-lg border bg-card shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                    <h3 className="font-medium">{LLM_LABELS[run.llm_model] || run.llm_model}</h3>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[run.status] || 'bg-gray-100 text-gray-700'}`}>
                        {STATUS_LABELS[run.status] || run.status}
                    </span>
                </div>
                {run.test_session_id && (
                    <button
                        onClick={() => navigate(`/test-cases/${run.test_session_id}`)}
                        className="inline-flex items-center text-sm text-primary hover:underline"
                    >
                        View Steps
                        <ExternalLink className="h-3 w-3 ml-1" />
                    </button>
                )}
            </div>
            
            <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                    <span className="text-muted-foreground">Total Steps:</span>
                    <span className="ml-2 font-medium">{run.total_steps}</span>
                </div>
                <div>
                    <span className="text-muted-foreground">Duration:</span>
                    <span className="ml-2 font-medium">
                        {run.duration_seconds > 0 ? formatDuration(run.duration_seconds) : '-'}
                    </span>
                </div>
                <div>
                    <span className="text-muted-foreground">Started:</span>
                    <span className="ml-2 font-medium">
                        {run.started_at ? formatDate(run.started_at) : '-'}
                    </span>
                </div>
            </div>
            
            {run.error && (
                <div className="mt-3 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                    {run.error}
                </div>
            )}
        </div>
    )
}
