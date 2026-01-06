import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { Plus, RefreshCw, Trash2, Pencil, Check, X, Search, ChevronLeft, ChevronRight } from "lucide-react"
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

function truncatePrompt(prompt: string, maxLength: number = 60): string {
    if (prompt.length <= maxLength) return prompt
    return prompt.substring(0, maxLength) + '...'
}

// Custom debounce hook
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value)

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value)
        }, delay)

        return () => {
            clearTimeout(handler)
        }
    }, [value, delay])

    return debouncedValue
}

export default function TestCases() {
    const navigate = useNavigate()
    const [sessions, setSessions] = useState<TestSessionListItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editingTitle, setEditingTitle] = useState<string>("")

    // Search and pagination state
    const [searchQuery, setSearchQuery] = useState("")
    const [page, setPage] = useState(1)
    const [pageSize] = useState(20)
    const [total, setTotal] = useState(0)
    const [totalPages, setTotalPages] = useState(1)

    // Debounce search query
    const debouncedSearch = useDebounce(searchQuery, 300)

    const fetchSessions = useCallback(async (search?: string, pageNum?: number) => {
        setLoading(true)
        setError(null)
        try {
            const data = await analysisApi.listSessions({
                search: search || undefined,
                page: pageNum ?? page,
                page_size: pageSize,
            })
            setSessions(data.items)
            setTotal(data.total)
            setTotalPages(data.total_pages)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load sessions')
        } finally {
            setLoading(false)
        }
    }, [page, pageSize])

    // Fetch on mount and when search/page changes
    useEffect(() => {
        fetchSessions(debouncedSearch, page)
    }, [debouncedSearch, page, fetchSessions])

    // Reset to page 1 when search changes
    useEffect(() => {
        setPage(1)
    }, [debouncedSearch])

    const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation() // Prevent row click navigation
        if (!confirm('Are you sure you want to delete this test case?')) {
            return
        }
        try {
            await analysisApi.deleteSession(sessionId)
            // Refresh the list after deletion
            fetchSessions(debouncedSearch, page)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete session')
        }
    }

    const handleStartEdit = (e: React.MouseEvent, session: TestSessionListItem) => {
        e.stopPropagation()
        setEditingId(session.id)
        setEditingTitle(session.title || truncatePrompt(session.prompt))
    }

    const handleSaveTitle = async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation()
        if (!editingTitle.trim()) {
            setEditingId(null)
            return
        }
        try {
            await analysisApi.updateSessionTitle(sessionId, editingTitle.trim())
            setSessions(prev => prev.map(s =>
                s.id === sessionId ? { ...s, title: editingTitle.trim() } : s
            ))
            setEditingId(null)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to update title')
        }
    }

    const handleCancelEdit = (e: React.MouseEvent) => {
        e.stopPropagation()
        setEditingId(null)
        setEditingTitle("")
    }

    const handlePrevPage = () => {
        if (page > 1) setPage(page - 1)
    }

    const handleNextPage = () => {
        if (page < totalPages) setPage(page + 1)
    }

    const handleRefresh = () => {
        fetchSessions(debouncedSearch, page)
    }

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
                        onClick={handleRefresh}
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

            {/* Search Bar */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                    type="text"
                    placeholder="Search test cases by title or prompt..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-background"
                />
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
                        <p className="text-muted-foreground mb-4">
                            {searchQuery ? 'No test cases match your search' : 'No test cases yet'}
                        </p>
                        {!searchQuery && (
                            <button
                                onClick={() => navigate('/test-analysis')}
                                className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4"
                            >
                                <Plus className="h-4 w-4 mr-2" />
                                Create your first test case
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th className="text-left py-3 px-4 font-medium text-sm">Title</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">Status</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">LLM</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">Steps</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">Created By</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">Created</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sessions.map((session) => (
                                    <tr
                                        key={session.id}
                                        onClick={() => navigate(`/test-analysis/${session.id}`)}
                                        className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                                    >
                                        <td className="py-3 px-4">
                                            {editingId === session.id ? (
                                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        type="text"
                                                        value={editingTitle}
                                                        onChange={(e) => setEditingTitle(e.target.value)}
                                                        className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                                                        autoFocus
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleSaveTitle(e as unknown as React.MouseEvent, session.id)
                                                            if (e.key === 'Escape') handleCancelEdit(e as unknown as React.MouseEvent)
                                                        }}
                                                    />
                                                    <button
                                                        onClick={(e) => handleSaveTitle(e, session.id)}
                                                        className="p-1 text-green-600 hover:bg-green-50 rounded"
                                                        title="Save"
                                                    >
                                                        <Check className="h-4 w-4" />
                                                    </button>
                                                    <button
                                                        onClick={handleCancelEdit}
                                                        className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                                                        title="Cancel"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 group">
                                                    <div className="flex flex-col flex-1 min-w-0">
                                                        <span className="text-sm font-medium truncate" title={session.title || session.prompt}>
                                                            {session.title || truncatePrompt(session.prompt)}
                                                        </span>
                                                        {session.title && (
                                                            <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={session.prompt}>
                                                                {truncatePrompt(session.prompt, 40)}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <button
                                                        onClick={(e) => handleStartEdit(e, session)}
                                                        className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                                        title="Edit title"
                                                    >
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            )}
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
                                            {session.user_name || '-'}
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

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between border-t px-4 py-3">
                        <div className="text-sm text-muted-foreground">
                            Showing {((page - 1) * pageSize) + 1} - {Math.min(page * pageSize, total)} of {total} test cases
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handlePrevPage}
                                disabled={page === 1}
                                className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-8 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <ChevronLeft className="h-4 w-4 mr-1" />
                                Previous
                            </button>
                            <span className="text-sm text-muted-foreground px-2">
                                Page {page} of {totalPages}
                            </span>
                            <button
                                onClick={handleNextPage}
                                disabled={page === totalPages}
                                className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-8 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Next
                                <ChevronRight className="h-4 w-4 ml-1" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
