import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { RefreshCw, Trash2, Play, CheckCircle, XCircle, AlertCircle, Zap } from "lucide-react"
import { scriptsApi } from "@/services/api"
import type { PlaywrightScriptListItem, RunStatus } from "@/types/scripts"

const STATUS_COLORS: Record<RunStatus | 'none', string> = {
    'pending': 'bg-gray-100 text-gray-700',
    'running': 'bg-yellow-100 text-yellow-700',
    'passed': 'bg-green-100 text-green-700',
    'failed': 'bg-red-100 text-red-700',
    'healed': 'bg-purple-100 text-purple-700',
    'none': 'bg-gray-50 text-gray-500',
}

const STATUS_LABELS: Record<RunStatus | 'none', string> = {
    'pending': 'Pending',
    'running': 'Running',
    'passed': 'Passed',
    'failed': 'Failed',
    'healed': 'Healed',
    'none': 'Never Run',
}

const STATUS_ICONS: Record<RunStatus | 'none', React.ReactNode> = {
    'pending': null,
    'running': <RefreshCw className="h-3 w-3 animate-spin" />,
    'passed': <CheckCircle className="h-3 w-3" />,
    'failed': <XCircle className="h-3 w-3" />,
    'healed': <Zap className="h-3 w-3" />,
    'none': null,
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

function truncateName(name: string, maxLength: number = 50): string {
    if (name.length <= maxLength) return name
    return name.substring(0, maxLength) + '...'
}

export default function Scripts() {
    const navigate = useNavigate()
    const [scripts, setScripts] = useState<PlaywrightScriptListItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [runningScript, setRunningScript] = useState<string | null>(null)

    const fetchScripts = async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await scriptsApi.listScripts()
            setScripts(data)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load scripts')
        } finally {
            setLoading(false)
        }
    }

    const handleDelete = async (e: React.MouseEvent, scriptId: string) => {
        e.stopPropagation()
        if (!confirm('Are you sure you want to delete this script and all its runs?')) {
            return
        }
        try {
            await scriptsApi.deleteScript(scriptId)
            setScripts(prev => prev.filter(s => s.id !== scriptId))
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete script')
        }
    }

    const handleRunScript = async (e: React.MouseEvent, scriptId: string) => {
        e.stopPropagation()
        setRunningScript(scriptId)
        try {
            const response = await scriptsApi.startRun(scriptId, {})
            // Navigate to run detail page
            navigate(`/scripts/${scriptId}/runs/${response.run_id}`)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to start run')
            setRunningScript(null)
        }
    }

    useEffect(() => {
        fetchScripts()
    }, [])

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Test Scripts</h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Playwright scripts generated from test analysis - run without AI
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchScripts}
                        disabled={loading}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-3"
                    >
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Info Banner */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-800">
                <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="font-medium">Zero AI Cost</p>
                        <p className="text-sm mt-1">
                            Scripts are automatically generated when you run a test analysis. 
                            Running these scripts uses pure Playwright - no LLM tokens consumed.
                            Self-healing automatically tries fallback selectors if elements change.
                        </p>
                    </div>
                </div>
            </div>

            {/* Error State */}
            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                    {error}
                </div>
            )}

            {/* Table */}
            <div className="rounded-lg border bg-card shadow-sm">
                {loading && scripts.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                        Loading scripts...
                    </div>
                ) : scripts.length === 0 ? (
                    <div className="p-8 text-center">
                        <p className="text-muted-foreground mb-4">No scripts yet</p>
                        <p className="text-sm text-muted-foreground">
                            Scripts are automatically created when you run a test analysis.
                            Go to <a href="/test-analysis" className="text-primary underline">Test Analysis</a> to create one.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th className="text-left py-3 px-4 font-medium text-sm">Name</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">Steps</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">Runs</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">Last Run</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">Created</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {scripts.map((script) => {
                                    const status = script.last_run_status || 'none'
                                    return (
                                        <tr
                                            key={script.id}
                                            onClick={() => navigate(`/scripts/${script.id}`)}
                                            className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                                        >
                                            <td className="py-3 px-4">
                                                <div>
                                                    <span className="text-sm font-medium" title={script.name}>
                                                        {truncateName(script.name)}
                                                    </span>
                                                    {script.description && (
                                                        <p className="text-xs text-muted-foreground mt-0.5">
                                                            {truncateName(script.description, 40)}
                                                        </p>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-sm">
                                                {script.step_count}
                                            </td>
                                            <td className="py-3 px-4 text-sm">
                                                {script.run_count}
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}>
                                                    {STATUS_ICONS[status]}
                                                    {STATUS_LABELS[status]}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-muted-foreground">
                                                {formatDate(script.created_at)}
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={(e) => handleRunScript(e, script.id)}
                                                        disabled={runningScript === script.id}
                                                        className="inline-flex items-center justify-center rounded-md text-sm font-medium text-green-600 hover:text-green-700 hover:bg-green-50 h-8 w-8 transition-colors disabled:opacity-50"
                                                        title="Run script"
                                                    >
                                                        {runningScript === script.id ? (
                                                            <RefreshCw className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <Play className="h-4 w-4" />
                                                        )}
                                                    </button>
                                                    <button
                                                        onClick={(e) => handleDelete(e, script.id)}
                                                        className="inline-flex items-center justify-center rounded-md text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 h-8 w-8 transition-colors"
                                                        title="Delete script"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
