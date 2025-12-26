import { useState, useEffect, useCallback } from "react"
import { RefreshCw, Trash2, Globe, ChevronDown, ChevronRight, Search, ExternalLink } from "lucide-react"
import { discoveryApi } from "@/services/api"

interface DiscoveredModule {
    id: string
    name: string
    url: string
    summary: string
    created_at: string
}

interface DiscoverySession {
    id: string
    url: string
    status: string
    total_steps: number
    duration_seconds: number
    module_count: number
    created_at: string
    modules?: DiscoveredModule[]
    error?: string
}

const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700',
    queued: 'bg-blue-100 text-blue-700',
    running: 'bg-yellow-100 text-yellow-700 animate-pulse',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
    pending: 'Pending',
    queued: 'Queued',
    running: 'Running...',
    completed: 'Completed',
    failed: 'Failed',
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
    if (seconds < 60) {
        return `${seconds.toFixed(1)}s`
    }
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds.toFixed(0)}s`
}

function truncateUrl(url: string, maxLength: number = 50): string {
    if (url.length <= maxLength) return url
    return url.substring(0, maxLength) + '...'
}

export default function ModuleDiscovery() {
    const [sessions, setSessions] = useState<DiscoverySession[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [expandedSession, setExpandedSession] = useState<string | null>(null)
    const [formData, setFormData] = useState({
        url: '',
        username: '',
        password: '',
        maxSteps: 20,
    })
    const [isSubmitting, setIsSubmitting] = useState(false)

    const fetchSessions = useCallback(async () => {
        try {
            const data = await discoveryApi.listSessions()
            setSessions(data)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load sessions')
        } finally {
            setLoading(false)
        }
    }, [])

    const fetchSessionDetails = async (sessionId: string) => {
        try {
            const session = await discoveryApi.getSession(sessionId)
            setSessions(prev => prev.map(s =>
                s.id === sessionId
                    ? { ...s, modules: session.modules, error: session.error }
                    : s
            ))
        } catch (e) {
            console.error('Failed to fetch session details:', e)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!formData.url.trim()) return

        setIsSubmitting(true)
        setError(null)
        try {
            await discoveryApi.createSession({
                url: formData.url,
                username: formData.username || undefined,
                password: formData.password || undefined,
                max_steps: formData.maxSteps,
            })
            setFormData({ url: '', username: '', password: '', maxSteps: 20 })
            // Refresh the list to show the new session
            fetchSessions()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to create discovery session')
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation()
        if (!confirm('Are you sure you want to delete this discovery session?')) return

        try {
            await discoveryApi.deleteSession(sessionId)
            setSessions(prev => prev.filter(s => s.id !== sessionId))
            if (expandedSession === sessionId) {
                setExpandedSession(null)
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete session')
        }
    }

    const toggleSession = async (sessionId: string) => {
        if (expandedSession === sessionId) {
            setExpandedSession(null)
        } else {
            setExpandedSession(sessionId)
            // Fetch details if not already loaded
            const session = sessions.find(s => s.id === sessionId)
            if (session && !session.modules) {
                await fetchSessionDetails(sessionId)
            }
        }
    }

    useEffect(() => {
        fetchSessions()
    }, [fetchSessions])

    // Poll for running sessions
    useEffect(() => {
        const hasRunning = sessions.some(s => s.status === 'running' || s.status === 'queued')
        if (!hasRunning) return

        const interval = setInterval(fetchSessions, 3000)
        return () => clearInterval(interval)
    }, [sessions, fetchSessions])

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Search className="h-6 w-6 text-primary" />
                        Module Discovery
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Automatically discover and catalog application modules using AI agents
                    </p>
                </div>
                <button
                    onClick={fetchSessions}
                    disabled={loading}
                    className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-3"
                >
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {/* Error State */}
            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                    {error}
                    <button onClick={() => setError(null)} className="ml-2 underline text-sm">
                        Dismiss
                    </button>
                </div>
            )}

            {/* Create Session Form */}
            <div className="rounded-lg border bg-card shadow-sm p-6">
                <h2 className="text-lg font-semibold mb-4">Start New Discovery</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label htmlFor="url" className="block text-sm font-medium mb-1">
                                Target URL <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="url"
                                type="url"
                                value={formData.url}
                                onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
                                placeholder="https://example.com"
                                required
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                        </div>
                        <div>
                            <label htmlFor="username" className="block text-sm font-medium mb-1">
                                Username (optional)
                            </label>
                            <input
                                id="username"
                                type="text"
                                value={formData.username}
                                onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                                placeholder="user@example.com"
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                        </div>
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium mb-1">
                                Password (optional)
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={formData.password}
                                onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                                placeholder="••••••••"
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                        </div>
                        <div>
                            <label htmlFor="maxSteps" className="block text-sm font-medium mb-1">
                                Max Steps
                            </label>
                            <input
                                id="maxSteps"
                                type="number"
                                min={5}
                                max={100}
                                value={formData.maxSteps}
                                onChange={(e) => setFormData(prev => ({ ...prev, maxSteps: parseInt(e.target.value) || 20 }))}
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                        </div>
                    </div>
                    <button
                        type="submit"
                        disabled={isSubmitting || !formData.url.trim()}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-6 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? (
                            <>
                                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                Starting...
                            </>
                        ) : (
                            <>
                                <Globe className="h-4 w-4 mr-2" />
                                Start Discovery
                            </>
                        )}
                    </button>
                </form>
            </div>

            {/* Sessions List */}
            <div className="rounded-lg border bg-card shadow-sm">
                <div className="p-4 border-b">
                    <h2 className="text-lg font-semibold">Discovery Sessions</h2>
                </div>

                {loading && sessions.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                        Loading sessions...
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                        No discovery sessions yet. Start one above!
                    </div>
                ) : (
                    <div className="divide-y">
                        {sessions.map((session) => (
                            <div key={session.id} className="hover:bg-muted/30 transition-colors">
                                {/* Session Row */}
                                <div
                                    onClick={() => toggleSession(session.id)}
                                    className="flex items-center gap-4 p-4 cursor-pointer"
                                >
                                    <div className="text-muted-foreground">
                                        {expandedSession === session.id ? (
                                            <ChevronDown className="h-4 w-4" />
                                        ) : (
                                            <ChevronRight className="h-4 w-4" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                            <span className="text-sm font-medium truncate" title={session.url}>
                                                {truncateUrl(session.url)}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                                            <span>{formatDate(session.created_at)}</span>
                                            <span>{session.total_steps} steps</span>
                                            <span>{formatDuration(session.duration_seconds)}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-medium">
                                            {session.module_count} modules
                                        </span>
                                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[session.status] || 'bg-gray-100 text-gray-700'}`}>
                                            {STATUS_LABELS[session.status] || session.status}
                                        </span>
                                        <button
                                            onClick={(e) => handleDelete(e, session.id)}
                                            className="inline-flex items-center justify-center rounded-md text-red-600 hover:text-red-700 hover:bg-red-50 h-8 w-8 transition-colors"
                                            title="Delete session"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* Expanded Modules */}
                                {expandedSession === session.id && (
                                    <div className="px-4 pb-4 pl-12">
                                        {session.error && (
                                            <div className="text-sm text-red-600 mb-3 p-2 bg-red-50 rounded">
                                                Error: {session.error}
                                            </div>
                                        )}
                                        {session.modules && session.modules.length > 0 ? (
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                {session.modules.map((module) => (
                                                    <div
                                                        key={module.id}
                                                        className="rounded-lg border bg-background p-4 hover:shadow-sm transition-shadow"
                                                    >
                                                        <div className="flex items-start justify-between">
                                                            <h4 className="font-medium text-sm">{module.name}</h4>
                                                            <a
                                                                href={module.url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                onClick={(e) => e.stopPropagation()}
                                                                className="text-primary hover:text-primary/80"
                                                            >
                                                                <ExternalLink className="h-4 w-4" />
                                                            </a>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                                            {module.summary}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground mt-2 truncate" title={module.url}>
                                                            {module.url}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : session.modules && session.modules.length === 0 ? (
                                            <p className="text-sm text-muted-foreground">No modules discovered</p>
                                        ) : (
                                            <p className="text-sm text-muted-foreground">Loading modules...</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
