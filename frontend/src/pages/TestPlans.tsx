import { useState, useEffect, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import {
    Plus,
    RefreshCw,
    Play,
    CheckCircle,
    XCircle,
    Settings,
    Calendar,
    FileText,
    History,
    Trash2,
    GripVertical,
    Search,
    X,
    Loader2,
    ArrowUpDown,
    Monitor,
    Camera,
    Video,
    Wifi,
    Gauge,
    Eye,
    PlayCircle,
} from "lucide-react"
import { testPlansApi, analysisApi } from "@/services/api"
import type {
    TestPlan,
    TestPlanDetail,
    TestPlanRun,
    TestPlanSchedule,
    TestPlanTestCase,
    TestPlanRunType,
    BrowserType,
    CreateTestPlanRequest,
    RunTestPlanRequest,
    CreateScheduleRequest,
    ScheduleType,
} from "@/types/test-plans"
import type { TestSessionListItem } from "@/types/analysis"

// Status colors for test plan runs
const STATUS_COLORS: Record<string, string> = {
    'pending': 'bg-gray-100 text-gray-700',
    'queued': 'bg-blue-100 text-blue-700',
    'running': 'bg-yellow-100 text-yellow-700',
    'passed': 'bg-green-100 text-green-700',
    'failed': 'bg-red-100 text-red-700',
    'cancelled': 'bg-gray-100 text-gray-700',
}

const STATUS_LABELS: Record<string, string> = {
    'pending': 'Pending',
    'queued': 'Queued',
    'running': 'Running',
    'passed': 'Passed',
    'failed': 'Failed',
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

// ===== Create Test Plan Modal =====
interface CreateTestPlanModalProps {
    isOpen: boolean
    onClose: () => void
    onCreate: (data: CreateTestPlanRequest) => Promise<void>
    isCreating: boolean
}

function CreateTestPlanModal({ isOpen, onClose, onCreate, isCreating }: CreateTestPlanModalProps) {
    const [name, setName] = useState('')
    const [url, setUrl] = useState('')
    const [description, setDescription] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        await onCreate({ name, url: url || undefined, description: description || undefined })
        setName('')
        setUrl('')
        setDescription('')
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold">Create Test Plan</h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Name *</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="My Test Plan"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">URL (optional)</label>
                        <input
                            type="url"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="https://example.com"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Description (optional)</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="A brief description of this test plan"
                        />
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm border rounded-md hover:bg-accent"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!name.trim() || isCreating}
                            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                        >
                            {isCreating ? 'Creating...' : 'Create'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

// ===== Run Test Plan Modal =====
interface RunTestPlanModalProps {
    isOpen: boolean
    onClose: () => void
    onRun: (config: RunTestPlanRequest) => Promise<void>
    isRunning: boolean
    defaultSettings: {
        default_run_type: TestPlanRunType
        browser_type: BrowserType
        resolution_width: number
        resolution_height: number
        headless: boolean
        screenshots_enabled: boolean
        recording_enabled: boolean
        network_recording_enabled: boolean
        performance_metrics_enabled: boolean
    }
}

const BROWSERS: { value: BrowserType; label: string }[] = [
    { value: 'chromium', label: 'Chrome' },
    { value: 'firefox', label: 'Firefox' },
    { value: 'webkit', label: 'Safari' },
    { value: 'edge', label: 'Edge' },
]

const RESOLUTIONS: { value: string; label: string; width: number; height: number }[] = [
    { value: '1920x1080', label: 'Full HD (1920x1080)', width: 1920, height: 1080 },
    { value: '1366x768', label: 'HD (1366x768)', width: 1366, height: 768 },
    { value: '1600x900', label: 'WXGA+ (1600x900)', width: 1600, height: 900 },
]

function RunTestPlanModal({ isOpen, onClose, onRun, isRunning, defaultSettings }: RunTestPlanModalProps) {
    const [runType, setRunType] = useState<TestPlanRunType>(defaultSettings.default_run_type)
    const [browserType, setBrowserType] = useState<BrowserType>(defaultSettings.browser_type)
    const [resolution, setResolution] = useState(`${defaultSettings.resolution_width}x${defaultSettings.resolution_height}`)
    const [headless, setHeadless] = useState(defaultSettings.headless)
    const [screenshotsEnabled, setScreenshotsEnabled] = useState(defaultSettings.screenshots_enabled)
    const [recordingEnabled, setRecordingEnabled] = useState(defaultSettings.recording_enabled)
    const [networkRecordingEnabled, setNetworkRecordingEnabled] = useState(defaultSettings.network_recording_enabled)
    const [performanceMetricsEnabled, setPerformanceMetricsEnabled] = useState(defaultSettings.performance_metrics_enabled)

    useEffect(() => {
        if (isOpen) {
            setRunType(defaultSettings.default_run_type)
            setBrowserType(defaultSettings.browser_type)
            setResolution(`${defaultSettings.resolution_width}x${defaultSettings.resolution_height}`)
            setHeadless(defaultSettings.headless)
            setScreenshotsEnabled(defaultSettings.screenshots_enabled)
            setRecordingEnabled(defaultSettings.recording_enabled)
            setNetworkRecordingEnabled(defaultSettings.network_recording_enabled)
            setPerformanceMetricsEnabled(defaultSettings.performance_metrics_enabled)
        }
    }, [isOpen, defaultSettings])

    const handleRun = async () => {
        const [width, height] = resolution.split('x').map(Number)
        await onRun({
            run_type: runType,
            browser_type: browserType,
            resolution_width: width,
            resolution_height: height,
            headless,
            screenshots_enabled: screenshotsEnabled,
            recording_enabled: recordingEnabled,
            network_recording_enabled: networkRecordingEnabled,
            performance_metrics_enabled: performanceMetricsEnabled,
        })
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold">Run Test Plan</h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="p-6 space-y-6">
                    {/* Run Type */}
                    <div>
                        <label className="block text-sm font-medium mb-3">Execution Mode</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setRunType('sequential')}
                                className={`flex flex-col items-center p-3 rounded-lg border text-sm transition-colors ${runType === 'sequential' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50'}`}
                            >
                                <ArrowUpDown className="h-5 w-5 mb-1" />
                                <span className="font-medium">Sequential</span>
                                <span className="text-xs text-muted-foreground">One by one</span>
                            </button>
                            <button
                                onClick={() => setRunType('parallel')}
                                className={`flex flex-col items-center p-3 rounded-lg border text-sm transition-colors ${runType === 'parallel' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50'}`}
                            >
                                <PlayCircle className="h-5 w-5 mb-1" />
                                <span className="font-medium">Parallel</span>
                                <span className="text-xs text-muted-foreground">Concurrent</span>
                            </button>
                        </div>
                    </div>

                    {/* Browser Selection */}
                    <div>
                        <label className="flex items-center gap-2 text-sm font-medium mb-3">
                            <Monitor className="h-4 w-4" />
                            Browser
                        </label>
                        <div className="grid grid-cols-4 gap-2">
                            {BROWSERS.map(browser => (
                                <button
                                    key={browser.value}
                                    onClick={() => setBrowserType(browser.value)}
                                    className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-sm transition-colors ${browserType === browser.value ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50'}`}
                                >
                                    <span className="font-medium">{browser.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Resolution Selection */}
                    <div>
                        <label className="text-sm font-medium mb-3 block">Resolution</label>
                        <div className="grid grid-cols-3 gap-2">
                            {RESOLUTIONS.map(res => (
                                <button
                                    key={res.value}
                                    onClick={() => setResolution(res.value)}
                                    className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-sm transition-colors ${resolution === res.value ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50'}`}
                                >
                                    <span className="font-medium text-xs">{res.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Toggle Options */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium">Options</label>

                        {/* Headless toggle */}
                        <div className="flex items-center justify-between p-3 rounded-lg border">
                            <div className="flex items-center gap-3">
                                <Eye className="h-4 w-4 text-muted-foreground" />
                                <div>
                                    <div className="text-sm font-medium">Headless Mode</div>
                                    <div className="text-xs text-muted-foreground">Run without visible browser</div>
                                </div>
                            </div>
                            <button
                                onClick={() => setHeadless(!headless)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${headless ? 'bg-primary' : 'bg-muted'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${headless ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>

                        {/* Screenshots toggle */}
                        <div className="flex items-center justify-between p-3 rounded-lg border">
                            <div className="flex items-center gap-3">
                                <Camera className="h-4 w-4 text-muted-foreground" />
                                <div>
                                    <div className="text-sm font-medium">Screenshots per Step</div>
                                </div>
                            </div>
                            <button
                                onClick={() => setScreenshotsEnabled(!screenshotsEnabled)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${screenshotsEnabled ? 'bg-primary' : 'bg-muted'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${screenshotsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>

                        {/* Video recording toggle */}
                        <div className="flex items-center justify-between p-3 rounded-lg border">
                            <div className="flex items-center gap-3">
                                <Video className="h-4 w-4 text-muted-foreground" />
                                <div>
                                    <div className="text-sm font-medium">Screen Recording</div>
                                </div>
                            </div>
                            <button
                                onClick={() => setRecordingEnabled(!recordingEnabled)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${recordingEnabled ? 'bg-primary' : 'bg-muted'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${recordingEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>

                        {/* Network recording toggle */}
                        <div className="flex items-center justify-between p-3 rounded-lg border">
                            <div className="flex items-center gap-3">
                                <Wifi className="h-4 w-4 text-muted-foreground" />
                                <div>
                                    <div className="text-sm font-medium">Network Recording</div>
                                </div>
                            </div>
                            <button
                                onClick={() => setNetworkRecordingEnabled(!networkRecordingEnabled)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${networkRecordingEnabled ? 'bg-primary' : 'bg-muted'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${networkRecordingEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>

                        {/* Performance metrics toggle */}
                        <div className="flex items-center justify-between p-3 rounded-lg border">
                            <div className="flex items-center gap-3">
                                <Gauge className="h-4 w-4 text-muted-foreground" />
                                <div>
                                    <div className="text-sm font-medium">Performance Metrics</div>
                                </div>
                            </div>
                            <button
                                onClick={() => setPerformanceMetricsEnabled(!performanceMetricsEnabled)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${performanceMetricsEnabled ? 'bg-primary' : 'bg-muted'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${performanceMetricsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-muted/30">
                    <button
                        onClick={onClose}
                        disabled={isRunning}
                        className="px-4 py-2 text-sm border rounded-md hover:bg-accent disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleRun}
                        disabled={isRunning}
                        className="inline-flex items-center px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                    >
                        {isRunning ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Starting...
                            </>
                        ) : (
                            <>
                                <Play className="h-4 w-4 mr-2" />
                                Run Test Plan
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ===== Add Test Cases Modal =====
interface AddTestCasesModalProps {
    isOpen: boolean
    onClose: () => void
    onAdd: (sessionIds: string[]) => Promise<void>
    existingSessionIds: string[]
    isAdding: boolean
}

function AddTestCasesModal({ isOpen, onClose, onAdd, existingSessionIds, isAdding }: AddTestCasesModalProps) {
    const [sessions, setSessions] = useState<TestSessionListItem[]>([])
    const [loading, setLoading] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

    useEffect(() => {
        if (isOpen) {
            setLoading(true)
            analysisApi.listSessions({ page_size: 100 })
                .then(data => {
                    // Filter out sessions already in the plan
                    setSessions(data.items.filter(s => !existingSessionIds.includes(s.id)))
                })
                .finally(() => setLoading(false))
        } else {
            setSelectedIds(new Set())
            setSearchQuery('')
        }
    }, [isOpen, existingSessionIds])

    const filteredSessions = sessions.filter(s =>
        (s.title?.toLowerCase() || s.prompt.toLowerCase()).includes(searchQuery.toLowerCase())
    )

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }

    const handleAdd = async () => {
        await onAdd(Array.from(selectedIds))
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold">Add Test Cases</h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-4 border-b">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search test cases..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    {loading ? (
                        <div className="text-center py-8 text-muted-foreground">Loading test cases...</div>
                    ) : filteredSessions.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            {searchQuery ? 'No test cases match your search' : 'No available test cases'}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {filteredSessions.map(session => (
                                <div
                                    key={session.id}
                                    onClick={() => toggleSelect(session.id)}
                                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedIds.has(session.id) ? 'border-primary bg-primary/5' : 'hover:bg-muted/30'}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(session.id)}
                                        onChange={() => { }}
                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium truncate">
                                            {session.title || session.prompt.slice(0, 60) + (session.prompt.length > 60 ? '...' : '')}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {session.step_count} steps | {session.status}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/30">
                    <span className="text-sm text-muted-foreground">
                        {selectedIds.size} selected
                    </span>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm border rounded-md hover:bg-accent"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleAdd}
                            disabled={selectedIds.size === 0 || isAdding}
                            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                        >
                            {isAdding ? 'Adding...' : `Add ${selectedIds.size} Test Case${selectedIds.size !== 1 ? 's' : ''}`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ===== Schedule Modal =====
interface ScheduleModalProps {
    isOpen: boolean
    onClose: () => void
    onSave: (data: CreateScheduleRequest) => Promise<void>
    isSaving: boolean
}

function ScheduleModal({ isOpen, onClose, onSave, isSaving }: ScheduleModalProps) {
    const [name, setName] = useState('')
    const [scheduleType, setScheduleType] = useState<ScheduleType>('one_time')
    const [runType, setRunType] = useState<TestPlanRunType>('sequential')
    const [oneTimeAt, setOneTimeAt] = useState('')
    const [cronExpression, setCronExpression] = useState('')
    const [timezone, setTimezone] = useState('UTC')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        await onSave({
            name,
            schedule_type: scheduleType,
            run_type: runType,
            one_time_at: scheduleType === 'one_time' ? oneTimeAt : undefined,
            cron_expression: scheduleType === 'recurring' ? cronExpression : undefined,
            timezone,
        })
        // Reset form
        setName('')
        setScheduleType('one_time')
        setOneTimeAt('')
        setCronExpression('')
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold">Create Schedule</h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Name *</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="Daily Smoke Test"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Schedule Type</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setScheduleType('one_time')}
                                className={`p-3 rounded-lg border text-sm transition-colors ${scheduleType === 'one_time' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50'}`}
                            >
                                One Time
                            </button>
                            <button
                                type="button"
                                onClick={() => setScheduleType('recurring')}
                                className={`p-3 rounded-lg border text-sm transition-colors ${scheduleType === 'recurring' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50'}`}
                            >
                                Recurring
                            </button>
                        </div>
                    </div>

                    {scheduleType === 'one_time' && (
                        <div>
                            <label className="block text-sm font-medium mb-1">Date & Time *</label>
                            <input
                                type="datetime-local"
                                value={oneTimeAt}
                                onChange={(e) => setOneTimeAt(e.target.value)}
                                required
                                className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                    )}

                    {scheduleType === 'recurring' && (
                        <div>
                            <label className="block text-sm font-medium mb-1">Cron Expression *</label>
                            <input
                                type="text"
                                value={cronExpression}
                                onChange={(e) => setCronExpression(e.target.value)}
                                required
                                className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                                placeholder="0 9 * * *"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Example: 0 9 * * * (every day at 9 AM)
                            </p>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium mb-1">Timezone</label>
                        <select
                            value={timezone}
                            onChange={(e) => setTimezone(e.target.value)}
                            className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="UTC">UTC</option>
                            <option value="America/New_York">Eastern Time</option>
                            <option value="America/Los_Angeles">Pacific Time</option>
                            <option value="Europe/London">London</option>
                            <option value="Asia/Tokyo">Tokyo</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Run Type</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setRunType('sequential')}
                                className={`p-2 rounded-lg border text-sm transition-colors ${runType === 'sequential' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50'}`}
                            >
                                Sequential
                            </button>
                            <button
                                type="button"
                                onClick={() => setRunType('parallel')}
                                className={`p-2 rounded-lg border text-sm transition-colors ${runType === 'parallel' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50'}`}
                            >
                                Parallel
                            </button>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm border rounded-md hover:bg-accent"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!name.trim() || isSaving}
                            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                        >
                            {isSaving ? 'Creating...' : 'Create Schedule'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

// ===== Main Test Plans Page =====
type TabType = 'test-cases' | 'runs' | 'schedule' | 'settings'

export default function TestPlans() {
    const { planId } = useParams<{ planId: string }>()
    const navigate = useNavigate()

    // State
    const [plans, setPlans] = useState<TestPlan[]>([])
    const [selectedPlan, setSelectedPlan] = useState<TestPlanDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadingPlan, setLoadingPlan] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<TabType>('test-cases')

    // Modal states
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [showRunModal, setShowRunModal] = useState(false)
    const [showAddTestCasesModal, setShowAddTestCasesModal] = useState(false)
    const [showScheduleModal, setShowScheduleModal] = useState(false)
    const [isCreating, setIsCreating] = useState(false)
    const [isRunning, setIsRunning] = useState(false)
    const [isAddingTestCases, setIsAddingTestCases] = useState(false)
    const [isCreatingSchedule, setIsCreatingSchedule] = useState(false)

    // Settings state (for Settings tab)
    const [savingSettings, setSavingSettings] = useState(false)

    // Fetch plans list
    const fetchPlans = useCallback(async () => {
        setLoading(true)
        try {
            const data = await testPlansApi.listTestPlans({ page_size: 100 })
            setPlans(data.items)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load test plans')
        } finally {
            setLoading(false)
        }
    }, [])

    // Fetch single plan details
    const fetchPlanDetail = useCallback(async (id: string) => {
        setLoadingPlan(true)
        try {
            const data = await testPlansApi.getTestPlan(id)
            setSelectedPlan(data)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load test plan details')
        } finally {
            setLoadingPlan(false)
        }
    }, [])

    useEffect(() => {
        fetchPlans()
    }, [fetchPlans])

    useEffect(() => {
        if (planId) {
            fetchPlanDetail(planId)
        } else if (plans.length > 0 && !planId) {
            // Auto-select first plan if none selected
            navigate(`/test-plans/${plans[0].id}`, { replace: true })
        }
    }, [planId, plans, fetchPlanDetail, navigate])

    // Handlers
    const handleCreatePlan = async (data: CreateTestPlanRequest) => {
        setIsCreating(true)
        try {
            const newPlan = await testPlansApi.createTestPlan(data)
            await fetchPlans()
            setShowCreateModal(false)
            navigate(`/test-plans/${newPlan.id}`)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to create test plan')
        } finally {
            setIsCreating(false)
        }
    }

    const handleDeletePlan = async (id: string) => {
        if (!confirm('Are you sure you want to delete this test plan?')) return
        try {
            await testPlansApi.deleteTestPlan(id)
            await fetchPlans()
            if (planId === id) {
                navigate('/test-plans')
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete test plan')
        }
    }

    const handleRunPlan = async (config: RunTestPlanRequest) => {
        if (!selectedPlan) return
        setIsRunning(true)
        try {
            const response = await testPlansApi.runTestPlan(selectedPlan.id, config)
            setShowRunModal(false)
            await fetchPlanDetail(selectedPlan.id)
            // Navigate to run detail
            navigate(`/test-plan-runs/${response.run_id}`)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to start test plan run')
        } finally {
            setIsRunning(false)
        }
    }

    const handleAddTestCases = async (sessionIds: string[]) => {
        if (!selectedPlan) return
        setIsAddingTestCases(true)
        try {
            await testPlansApi.addTestCases(selectedPlan.id, sessionIds)
            setShowAddTestCasesModal(false)
            await fetchPlanDetail(selectedPlan.id)
            await fetchPlans() // Refresh counts
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to add test cases')
        } finally {
            setIsAddingTestCases(false)
        }
    }

    const handleRemoveTestCase = async (sessionId: string) => {
        if (!selectedPlan) return
        if (!confirm('Remove this test case from the plan?')) return
        try {
            await testPlansApi.removeTestCase(selectedPlan.id, sessionId)
            await fetchPlanDetail(selectedPlan.id)
            await fetchPlans()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to remove test case')
        }
    }

    const handleCreateSchedule = async (data: CreateScheduleRequest) => {
        if (!selectedPlan) return
        setIsCreatingSchedule(true)
        try {
            await testPlansApi.createSchedule(selectedPlan.id, data)
            setShowScheduleModal(false)
            await fetchPlanDetail(selectedPlan.id)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to create schedule')
        } finally {
            setIsCreatingSchedule(false)
        }
    }

    const handleToggleSchedule = async (scheduleId: string) => {
        try {
            await testPlansApi.toggleSchedule(scheduleId)
            if (selectedPlan) {
                await fetchPlanDetail(selectedPlan.id)
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to toggle schedule')
        }
    }

    const handleDeleteSchedule = async (scheduleId: string) => {
        if (!confirm('Delete this schedule?')) return
        try {
            await testPlansApi.deleteSchedule(scheduleId)
            if (selectedPlan) {
                await fetchPlanDetail(selectedPlan.id)
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete schedule')
        }
    }

    const handleSaveSettings = async (settings: {
        default_run_type: TestPlanRunType
        browser_type: BrowserType
        resolution_width: number
        resolution_height: number
        headless: boolean
        screenshots_enabled: boolean
        recording_enabled: boolean
        network_recording_enabled: boolean
        performance_metrics_enabled: boolean
    }) => {
        if (!selectedPlan) return
        setSavingSettings(true)
        try {
            await testPlansApi.updateTestPlanSettings(selectedPlan.id, settings)
            await fetchPlanDetail(selectedPlan.id)
            await fetchPlans()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save settings')
        } finally {
            setSavingSettings(false)
        }
    }

    // Render tabs
    const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
        { id: 'test-cases', label: 'Test Cases', icon: <FileText className="h-4 w-4" /> },
        { id: 'runs', label: 'Runs', icon: <History className="h-4 w-4" /> },
        { id: 'schedule', label: 'Schedule', icon: <Calendar className="h-4 w-4" /> },
        { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
    ]

    return (
        <div className="flex h-full">
            {/* Left Sidebar */}
            <div className="w-72 border-r bg-muted/20 flex flex-col">
                <div className="p-4 border-b">
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4"
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Create Test Plan
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="p-4 text-center text-muted-foreground">
                            <RefreshCw className="h-5 w-5 animate-spin mx-auto" />
                        </div>
                    ) : plans.length === 0 ? (
                        <div className="p-4 text-center text-muted-foreground text-sm">
                            No test plans yet
                        </div>
                    ) : (
                        <div className="p-2 space-y-1">
                            {plans.map(plan => (
                                <div
                                    key={plan.id}
                                    onClick={() => navigate(`/test-plans/${plan.id}`)}
                                    className={`group flex items-center justify-between p-3 rounded-md cursor-pointer transition-colors ${planId === plan.id ? 'bg-accent' : 'hover:bg-accent/50'}`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium truncate">{plan.name}</div>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                            <span>{plan.test_case_count} tests</span>
                                            {plan.last_run_status && (
                                                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs ${STATUS_COLORS[plan.last_run_status]}`}>
                                                    {STATUS_LABELS[plan.last_run_status]}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleDeletePlan(plan.id)
                                        }}
                                        className="p-1 text-muted-foreground hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {error && (
                    <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {error}
                        <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
                    </div>
                )}

                {!selectedPlan && !loadingPlan ? (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground">
                        {plans.length === 0 ? 'Create a test plan to get started' : 'Select a test plan'}
                    </div>
                ) : loadingPlan ? (
                    <div className="flex-1 flex items-center justify-center">
                        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : selectedPlan && (
                    <>
                        {/* Header */}
                        <div className="px-6 py-4 border-b">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h2 className="text-xl font-semibold">{selectedPlan.name}</h2>
                                    {selectedPlan.description && (
                                        <p className="text-sm text-muted-foreground mt-1">{selectedPlan.description}</p>
                                    )}
                                    {selectedPlan.url && (
                                        <a href={selectedPlan.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline mt-1 block">
                                            {selectedPlan.url}
                                        </a>
                                    )}
                                </div>
                                <button
                                    onClick={() => setShowRunModal(true)}
                                    disabled={selectedPlan.test_cases.length === 0}
                                    className="inline-flex items-center rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700 h-9 px-4 disabled:opacity-50"
                                >
                                    <Play className="h-4 w-4 mr-2" />
                                    Run Test Plan
                                </button>
                            </div>
                        </div>

                        {/* Tabs */}
                        <div className="border-b px-6">
                            <div className="flex gap-6">
                                {tabs.map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`flex items-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                                    >
                                        {tab.icon}
                                        {tab.label}
                                        {tab.id === 'test-cases' && (
                                            <span className="ml-1 px-1.5 py-0.5 text-xs bg-muted rounded">
                                                {selectedPlan.test_cases.length}
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Tab Content */}
                        <div className="flex-1 overflow-y-auto p-6">
                            {activeTab === 'test-cases' && (
                                <TestCasesTab
                                    testCases={selectedPlan.test_cases}
                                    onAdd={() => setShowAddTestCasesModal(true)}
                                    onRemove={handleRemoveTestCase}
                                    onReorder={async (orders) => {
                                        await testPlansApi.reorderTestCases(selectedPlan.id, orders)
                                        await fetchPlanDetail(selectedPlan.id)
                                    }}
                                />
                            )}
                            {activeTab === 'runs' && (
                                <RunsTab
                                    runs={selectedPlan.recent_runs}
                                    onRefresh={() => fetchPlanDetail(selectedPlan.id)}
                                />
                            )}
                            {activeTab === 'schedule' && (
                                <ScheduleTab
                                    schedules={selectedPlan.schedules}
                                    onAdd={() => setShowScheduleModal(true)}
                                    onToggle={handleToggleSchedule}
                                    onDelete={handleDeleteSchedule}
                                />
                            )}
                            {activeTab === 'settings' && (
                                <SettingsTab
                                    plan={selectedPlan}
                                    onSave={handleSaveSettings}
                                    isSaving={savingSettings}
                                />
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Modals */}
            <CreateTestPlanModal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onCreate={handleCreatePlan}
                isCreating={isCreating}
            />
            {selectedPlan && (
                <>
                    <RunTestPlanModal
                        isOpen={showRunModal}
                        onClose={() => setShowRunModal(false)}
                        onRun={handleRunPlan}
                        isRunning={isRunning}
                        defaultSettings={{
                            default_run_type: selectedPlan.default_run_type,
                            browser_type: selectedPlan.browser_type,
                            resolution_width: selectedPlan.resolution_width,
                            resolution_height: selectedPlan.resolution_height,
                            headless: selectedPlan.headless,
                            screenshots_enabled: selectedPlan.screenshots_enabled,
                            recording_enabled: selectedPlan.recording_enabled,
                            network_recording_enabled: selectedPlan.network_recording_enabled,
                            performance_metrics_enabled: selectedPlan.performance_metrics_enabled,
                        }}
                    />
                    <AddTestCasesModal
                        isOpen={showAddTestCasesModal}
                        onClose={() => setShowAddTestCasesModal(false)}
                        onAdd={handleAddTestCases}
                        existingSessionIds={selectedPlan.test_cases.map(tc => tc.test_session_id)}
                        isAdding={isAddingTestCases}
                    />
                    <ScheduleModal
                        isOpen={showScheduleModal}
                        onClose={() => setShowScheduleModal(false)}
                        onSave={handleCreateSchedule}
                        isSaving={isCreatingSchedule}
                    />
                </>
            )}
        </div>
    )
}

// ===== Tab Components =====

interface TestCasesTabProps {
    testCases: TestPlanTestCase[]
    onAdd: () => void
    onRemove: (sessionId: string) => void
    onReorder: (orders: { test_session_id: string; order: number }[]) => Promise<void>
}

function TestCasesTab({ testCases, onAdd, onRemove, onReorder }: TestCasesTabProps) {
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

    const handleDragStart = (index: number) => {
        setDraggedIndex(index)
    }

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault()
        if (draggedIndex === null || draggedIndex === index) return

        const newTestCases = [...testCases]
        const [removed] = newTestCases.splice(draggedIndex, 1)
        newTestCases.splice(index, 0, removed)

        // Update order
        const orders = newTestCases.map((tc, i) => ({
            test_session_id: tc.test_session_id,
            order: i,
        }))
        onReorder(orders)
        setDraggedIndex(index)
    }

    const handleDragEnd = () => {
        setDraggedIndex(null)
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Test Cases</h3>
                <button
                    onClick={onAdd}
                    className="inline-flex items-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-4"
                >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Test Cases
                </button>
            </div>

            {testCases.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                    <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground mb-4">No test cases in this plan yet</p>
                    <button
                        onClick={onAdd}
                        className="inline-flex items-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4"
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Test Cases
                    </button>
                </div>
            ) : (
                <div className="rounded-lg border divide-y">
                    {testCases.map((tc, index) => (
                        <div
                            key={tc.id}
                            draggable
                            onDragStart={() => handleDragStart(index)}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDragEnd={handleDragEnd}
                            className={`flex items-center gap-3 p-3 bg-card hover:bg-muted/30 transition-colors ${draggedIndex === index ? 'opacity-50' : ''}`}
                        >
                            <div className="cursor-grab text-muted-foreground hover:text-foreground">
                                <GripVertical className="h-5 w-5" />
                            </div>
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                                {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">
                                    {tc.title || tc.prompt}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {tc.step_count} steps | {tc.status}
                                </div>
                            </div>
                            <button
                                onClick={() => onRemove(tc.test_session_id)}
                                className="p-1 text-muted-foreground hover:text-red-600 transition-colors"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

interface RunsTabProps {
    runs: TestPlanRun[]
    onRefresh: () => void
}

function RunsTab({ runs, onRefresh }: RunsTabProps) {
    const navigate = useNavigate()

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Run History</h3>
                <button
                    onClick={onRefresh}
                    className="inline-flex items-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-8 px-3"
                >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                </button>
            </div>

            {runs.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                    <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No runs yet</p>
                    <p className="text-sm text-muted-foreground mt-1">Click "Run Test Plan" to execute</p>
                </div>
            ) : (
                <div className="rounded-lg border overflow-hidden">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b bg-muted/50">
                                <th className="text-left py-3 px-4 font-medium text-sm">Status</th>
                                <th className="text-left py-3 px-4 font-medium text-sm">Type</th>
                                <th className="text-left py-3 px-4 font-medium text-sm">Browser</th>
                                <th className="text-left py-3 px-4 font-medium text-sm">Results</th>
                                <th className="text-left py-3 px-4 font-medium text-sm">Duration</th>
                                <th className="text-left py-3 px-4 font-medium text-sm">User</th>
                                <th className="text-left py-3 px-4 font-medium text-sm">Date</th>
                            </tr>
                        </thead>
                        <tbody>
                            {runs.map(run => (
                                <tr
                                    key={run.id}
                                    onClick={() => navigate(`/test-plan-runs/${run.id}`)}
                                    className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                                >
                                    <td className="py-3 px-4">
                                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[run.status]}`}>
                                            {run.status === 'passed' && <CheckCircle className="h-3 w-3" />}
                                            {run.status === 'failed' && <XCircle className="h-3 w-3" />}
                                            {run.status === 'running' && <RefreshCw className="h-3 w-3 animate-spin" />}
                                            {STATUS_LABELS[run.status]}
                                        </span>
                                    </td>
                                    <td className="py-3 px-4 text-sm capitalize">{run.run_type}</td>
                                    <td className="py-3 px-4 text-sm">{BROWSER_LABELS[run.browser_type]}</td>
                                    <td className="py-3 px-4 text-sm">
                                        <span className="text-green-600">{run.passed_test_cases}</span>
                                        <span className="text-muted-foreground"> / </span>
                                        <span className="text-red-600">{run.failed_test_cases}</span>
                                        <span className="text-muted-foreground"> / {run.total_test_cases}</span>
                                    </td>
                                    <td className="py-3 px-4 text-sm text-muted-foreground">
                                        {formatDuration(run.duration_ms)}
                                    </td>
                                    <td className="py-3 px-4 text-sm text-muted-foreground">
                                        {run.user_name || '-'}
                                    </td>
                                    <td className="py-3 px-4 text-sm text-muted-foreground">
                                        {formatDate(run.created_at)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

interface ScheduleTabProps {
    schedules: TestPlanSchedule[]
    onAdd: () => void
    onToggle: (scheduleId: string) => void
    onDelete: (scheduleId: string) => void
}

function ScheduleTab({ schedules, onAdd, onToggle, onDelete }: ScheduleTabProps) {
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Schedules</h3>
                <button
                    onClick={onAdd}
                    className="inline-flex items-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-4"
                >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Schedule
                </button>
            </div>

            {schedules.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                    <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground mb-4">No schedules configured</p>
                    <button
                        onClick={onAdd}
                        className="inline-flex items-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4"
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Create Schedule
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    {schedules.map(schedule => (
                        <div
                            key={schedule.id}
                            className="flex items-center justify-between p-4 rounded-lg border bg-card"
                        >
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => onToggle(schedule.id)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${schedule.is_active ? 'bg-primary' : 'bg-muted'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${schedule.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                                <div>
                                    <div className="font-medium text-sm">{schedule.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                        {schedule.schedule_type === 'one_time' ? (
                                            <>One-time: {schedule.one_time_at ? formatDate(schedule.one_time_at) : '-'}</>
                                        ) : (
                                            <>Cron: {schedule.cron_expression}</>
                                        )}
                                        {' | '}
                                        {schedule.run_type} | {schedule.timezone}
                                    </div>
                                    {schedule.next_run_at && (
                                        <div className="text-xs text-blue-600 mt-1">
                                            Next run: {formatDate(schedule.next_run_at)}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => onDelete(schedule.id)}
                                className="p-2 text-muted-foreground hover:text-red-600 transition-colors"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

interface SettingsTabProps {
    plan: TestPlanDetail
    onSave: (settings: {
        default_run_type: TestPlanRunType
        browser_type: BrowserType
        resolution_width: number
        resolution_height: number
        headless: boolean
        screenshots_enabled: boolean
        recording_enabled: boolean
        network_recording_enabled: boolean
        performance_metrics_enabled: boolean
    }) => Promise<void>
    isSaving: boolean
}

function SettingsTab({ plan, onSave, isSaving }: SettingsTabProps) {
    const [runType, setRunType] = useState<TestPlanRunType>(plan.default_run_type)
    const [browserType, setBrowserType] = useState<BrowserType>(plan.browser_type)
    const [resolution, setResolution] = useState(`${plan.resolution_width}x${plan.resolution_height}`)
    const [headless, setHeadless] = useState(plan.headless)
    const [screenshotsEnabled, setScreenshotsEnabled] = useState(plan.screenshots_enabled)
    const [recordingEnabled, setRecordingEnabled] = useState(plan.recording_enabled)
    const [networkRecordingEnabled, setNetworkRecordingEnabled] = useState(plan.network_recording_enabled)
    const [performanceMetricsEnabled, setPerformanceMetricsEnabled] = useState(plan.performance_metrics_enabled)

    useEffect(() => {
        setRunType(plan.default_run_type)
        setBrowserType(plan.browser_type)
        setResolution(`${plan.resolution_width}x${plan.resolution_height}`)
        setHeadless(plan.headless)
        setScreenshotsEnabled(plan.screenshots_enabled)
        setRecordingEnabled(plan.recording_enabled)
        setNetworkRecordingEnabled(plan.network_recording_enabled)
        setPerformanceMetricsEnabled(plan.performance_metrics_enabled)
    }, [plan])

    const handleSave = async () => {
        const [width, height] = resolution.split('x').map(Number)
        await onSave({
            default_run_type: runType,
            browser_type: browserType,
            resolution_width: width,
            resolution_height: height,
            headless,
            screenshots_enabled: screenshotsEnabled,
            recording_enabled: recordingEnabled,
            network_recording_enabled: networkRecordingEnabled,
            performance_metrics_enabled: performanceMetricsEnabled,
        })
    }

    return (
        <div className="max-w-2xl space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Default Run Settings</h3>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="inline-flex items-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 disabled:opacity-50"
                >
                    {isSaving ? 'Saving...' : 'Save Settings'}
                </button>
            </div>

            <p className="text-sm text-muted-foreground">
                These settings will be used as defaults when running this test plan. They can be overridden for individual runs.
            </p>

            {/* Default Run Type */}
            <div>
                <label className="block text-sm font-medium mb-3">Default Execution Mode</label>
                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => setRunType('sequential')}
                        className={`flex flex-col items-center p-3 rounded-lg border text-sm transition-colors ${runType === 'sequential' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50'}`}
                    >
                        <ArrowUpDown className="h-5 w-5 mb-1" />
                        <span className="font-medium">Sequential</span>
                    </button>
                    <button
                        onClick={() => setRunType('parallel')}
                        className={`flex flex-col items-center p-3 rounded-lg border text-sm transition-colors ${runType === 'parallel' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50'}`}
                    >
                        <PlayCircle className="h-5 w-5 mb-1" />
                        <span className="font-medium">Parallel</span>
                    </button>
                </div>
            </div>

            {/* Browser Selection */}
            <div>
                <label className="flex items-center gap-2 text-sm font-medium mb-3">
                    <Monitor className="h-4 w-4" />
                    Default Browser
                </label>
                <div className="grid grid-cols-4 gap-2">
                    {BROWSERS.map(browser => (
                        <button
                            key={browser.value}
                            onClick={() => setBrowserType(browser.value)}
                            className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-sm transition-colors ${browserType === browser.value ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50'}`}
                        >
                            <span className="font-medium">{browser.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Resolution Selection */}
            <div>
                <label className="text-sm font-medium mb-3 block">Default Resolution</label>
                <div className="grid grid-cols-3 gap-2">
                    {RESOLUTIONS.map(res => (
                        <button
                            key={res.value}
                            onClick={() => setResolution(res.value)}
                            className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-sm transition-colors ${resolution === res.value ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50'}`}
                        >
                            <span className="font-medium text-xs">{res.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Toggle Options */}
            <div className="space-y-3">
                <label className="text-sm font-medium">Default Options</label>

                {/* Headless toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                        <Eye className="h-4 w-4 text-muted-foreground" />
                        <div>
                            <div className="text-sm font-medium">Headless Mode</div>
                            <div className="text-xs text-muted-foreground">Run without visible browser</div>
                        </div>
                    </div>
                    <button
                        onClick={() => setHeadless(!headless)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${headless ? 'bg-primary' : 'bg-muted'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${headless ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* Screenshots toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                        <Camera className="h-4 w-4 text-muted-foreground" />
                        <div>
                            <div className="text-sm font-medium">Screenshots per Step</div>
                            <div className="text-xs text-muted-foreground">Capture screenshot after each step</div>
                        </div>
                    </div>
                    <button
                        onClick={() => setScreenshotsEnabled(!screenshotsEnabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${screenshotsEnabled ? 'bg-primary' : 'bg-muted'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${screenshotsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* Video recording toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                        <Video className="h-4 w-4 text-muted-foreground" />
                        <div>
                            <div className="text-sm font-medium">Screen Recording</div>
                            <div className="text-xs text-muted-foreground">Record video of the entire run</div>
                        </div>
                    </div>
                    <button
                        onClick={() => setRecordingEnabled(!recordingEnabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${recordingEnabled ? 'bg-primary' : 'bg-muted'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${recordingEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* Network recording toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                        <Wifi className="h-4 w-4 text-muted-foreground" />
                        <div>
                            <div className="text-sm font-medium">Network Recording</div>
                            <div className="text-xs text-muted-foreground">Capture API calls and requests</div>
                        </div>
                    </div>
                    <button
                        onClick={() => setNetworkRecordingEnabled(!networkRecordingEnabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${networkRecordingEnabled ? 'bg-primary' : 'bg-muted'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${networkRecordingEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* Performance metrics toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                        <Gauge className="h-4 w-4 text-muted-foreground" />
                        <div>
                            <div className="text-sm font-medium">Performance Metrics</div>
                            <div className="text-xs text-muted-foreground">Measure step and total duration</div>
                        </div>
                    </div>
                    <button
                        onClick={() => setPerformanceMetricsEnabled(!performanceMetricsEnabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${performanceMetricsEnabled ? 'bg-primary' : 'bg-muted'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${performanceMetricsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>
            </div>
        </div>
    )
}
