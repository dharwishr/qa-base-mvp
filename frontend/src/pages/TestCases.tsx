import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Plus, RefreshCw, Trash2 } from "lucide-react"
import { analysisApi } from "@/services/api"
import type { TestSessionListItem, LlmModel } from "@/types/analysis"

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
    'browser-use-llm': 'Browser Use',
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

function truncatePrompt(prompt: string, maxLength: number = 60): string {
    if (prompt.length <= maxLength) return prompt
    return prompt.substring(0, maxLength) + '...'
}

export default function TestCases() {
    const navigate = useNavigate()
    const [sessions, setSessions] = useState<TestSessionListItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchSessions = async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await analysisApi.listSessions()
            setSessions(data)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load sessions')
        } finally {
            setLoading(false)
        }
    }

    const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation() // Prevent row click navigation
        if (!confirm('Are you sure you want to delete this test case?')) {
            return
        }
        try {
            await analysisApi.deleteSession(sessionId)
            setSessions(prev => prev.filter(s => s.id !== sessionId))
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete session')
        }
    }

    useEffect(() => {
        fetchSessions()
    }, [])

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Test Cases</h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        View and manage your test case analysis sessions
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchSessions}
                        disabled={loading}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-3"
                    >
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                    <button
                        onClick={() => navigate('/test-analysis')}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4"
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        New Test Case
                    </button>
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
                {loading && sessions.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                        Loading sessions...
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="p-8 text-center">
                        <p className="text-muted-foreground mb-4">No test cases yet</p>
                        <button
                            onClick={() => navigate('/test-analysis')}
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4"
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Create your first test case
                        </button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th className="text-left py-3 px-4 font-medium text-sm">Prompt</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">Status</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">LLM</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">Steps</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">Created</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sessions.map((session) => (
                                    <tr
                                        key={session.id}
                                        onClick={() => navigate(`/test-cases/${session.id}`)}
                                        className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                                    >
                                        <td className="py-3 px-4">
                                            <span className="text-sm" title={session.prompt}>
                                                {truncatePrompt(session.prompt)}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4">
                                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[session.status] || 'bg-gray-100 text-gray-700'}`}>
                                                {STATUS_LABELS[session.status] || session.status}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-sm text-muted-foreground">
                                            {LLM_LABELS[session.llm_model] || session.llm_model}
                                        </td>
                                        <td className="py-3 px-4 text-sm">
                                            {session.step_count}
                                        </td>
                                        <td className="py-3 px-4 text-sm text-muted-foreground">
                                            {formatDate(session.created_at)}
                                        </td>
                                        <td className="py-3 px-4">
                                            <button
                                                onClick={(e) => handleDelete(e, session.id)}
                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 h-8 w-8 transition-colors"
                                                title="Delete test case"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
