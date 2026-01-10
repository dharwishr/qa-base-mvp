import React, { useState, useEffect } from 'react';
import { Monitor, Trash2, RefreshCw, AlertTriangle, CheckCircle, Loader2, Play, Container, Zap, Brain } from 'lucide-react';
import { browserApi, settingsApi, type BrowserSession } from '@/services/api';
import type { IsolationMode, SystemSettings, ContainerPoolStats } from '@/types/scripts';
import type { LlmModel } from '@/types/analysis';

// Available LLM models for test analysis
const LLM_MODEL_OPTIONS: { value: LlmModel; label: string; description: string }[] = [
    { value: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash', description: 'Latest and fastest Gemini model (Recommended)' },
    { value: 'gemini-3.0-pro', label: 'Gemini 3.0 Pro', description: 'Most capable Gemini 3.0 model' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast and efficient Gemini 2.5 model' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'High capability Gemini 2.5 model' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Previous generation Gemini model' },
    { value: 'browser-use-llm', label: 'Browser Use LLM', description: 'Browser Use native LLM' },
    { value: 'gemini-2.5-computer-use', label: 'Gemini 2.5 Computer Use', description: 'Specialized for computer interaction' },
];

type SettingsTab = 'runner' | 'ai' | 'pool' | 'browser';

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'runner', label: 'Test Runner', icon: <Play className="h-4 w-4" /> },
    { id: 'ai', label: 'AI Models', icon: <Brain className="h-4 w-4" /> },
    { id: 'pool', label: 'Container Pool', icon: <Container className="h-4 w-4" /> },
    { id: 'browser', label: 'Browser Sessions', icon: <Monitor className="h-4 w-4" /> },
];

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState<SettingsTab>('runner');
    const [browserSessions, setBrowserSessions] = useState<BrowserSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [killing, setKilling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // System settings state
    const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
    const [settingsLoading, setSettingsLoading] = useState(true);
    const [savingSettings, setSavingSettings] = useState(false);

    // Container pool state
    const [poolStats, setPoolStats] = useState<ContainerPoolStats | null>(null);
    const [poolLoading, setPoolLoading] = useState(true);
    const [warmingUp, setWarmingUp] = useState(false);

    const fetchBrowserSessions = async () => {
        setLoading(true);
        setError(null);
        try {
            const sessions = await browserApi.listSessions(undefined, false);
            setBrowserSessions(sessions);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load browser sessions');
        } finally {
            setLoading(false);
        }
    };

    const handleKillAllBrowsers = async () => {
        if (!confirm('Are you sure you want to kill ALL browser sessions? This will stop all running tests.')) {
            return;
        }
        
        setKilling(true);
        setError(null);
        setSuccess(null);
        try {
            const result = await browserApi.stopAllSessions();
            setSuccess(`Successfully stopped ${result.stopped_count} browser session(s)`);
            fetchBrowserSessions();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to stop browser sessions');
        } finally {
            setKilling(false);
        }
    };

    const handleStopSession = async (sessionId: string) => {
        try {
            await browserApi.stopSession(sessionId);
            fetchBrowserSessions();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to stop session');
        }
    };

    // Fetch system settings
    const fetchSystemSettings = async () => {
        setSettingsLoading(true);
        try {
            const settings = await settingsApi.getSettings();
            setSystemSettings(settings);
        } catch (e) {
            console.error('Failed to load system settings:', e);
        } finally {
            setSettingsLoading(false);
        }
    };

    // Fetch container pool stats
    const fetchPoolStats = async () => {
        setPoolLoading(true);
        try {
            const stats = await settingsApi.getContainerPoolStats();
            setPoolStats(stats);
        } catch (e) {
            console.error('Failed to load container pool stats:', e);
        } finally {
            setPoolLoading(false);
        }
    };

    // Warmup container pool
    const handleWarmupPool = async () => {
        setWarmingUp(true);
        setError(null);
        setSuccess(null);
        try {
            const stats = await settingsApi.warmupContainerPool();
            setPoolStats(stats);
            setSuccess('Container pool warmed up successfully');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to warmup container pool');
        } finally {
            setWarmingUp(false);
        }
    };

    // Update isolation mode
    const handleIsolationModeChange = async (mode: IsolationMode) => {
        if (!systemSettings) return;

        setSavingSettings(true);
        setError(null);
        setSuccess(null);
        try {
            const updated = await settingsApi.updateSettings({ isolation_mode: mode });
            setSystemSettings(updated);
            setSuccess(`Isolation mode updated to ${mode === 'context' ? 'Context (Fast)' : 'Ephemeral (Isolated)'}`);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to update settings');
        } finally {
            setSavingSettings(false);
        }
    };

    // Update default analysis model
    const handleDefaultModelChange = async (model: string) => {
        if (!systemSettings) return;

        setSavingSettings(true);
        setError(null);
        setSuccess(null);
        try {
            const updated = await settingsApi.updateSettings({ default_analysis_model: model });
            setSystemSettings(updated);
            const modelOption = LLM_MODEL_OPTIONS.find(m => m.value === model);
            setSuccess(`Default analysis model updated to ${modelOption?.label || model}`);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to update settings');
        } finally {
            setSavingSettings(false);
        }
    };

    useEffect(() => {
        fetchBrowserSessions();
        fetchSystemSettings();
        fetchPoolStats();

        // Refresh browser sessions and pool stats every 30 seconds
        const interval = setInterval(() => {
            fetchBrowserSessions();
            fetchPoolStats();
        }, 30000);
        return () => clearInterval(interval);
    }, []);

    const activeSessions = browserSessions.filter(s => s.status === 'ready' || s.status === 'connected');

    return (
        <div className="space-y-6 p-6 max-w-4xl mx-auto">
            <div>
                <h1 className="text-2xl font-bold">Settings</h1>
                <p className="text-muted-foreground text-sm mt-1">
                    Manage application settings and browser sessions
                </p>
            </div>

            {/* Tab Navigation */}
            <div className="border-b">
                <nav className="flex gap-1" aria-label="Settings tabs">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                activeTab === tab.id
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                            }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </nav>
            </div>

            {/* Success/Error Messages */}
            {success && (
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
                    <CheckCircle className="h-5 w-5" />
                    {success}
                </div>
            )}
            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                    <AlertTriangle className="h-5 w-5" />
                    {error}
                </div>
            )}

            {/* Test Runner Settings Section */}
            {activeTab === 'runner' && (
            <div className="rounded-lg border bg-card shadow-sm">
                <div className="border-b px-6 py-4">
                    <div className="flex items-center gap-3">
                        <Play className="h-5 w-5 text-primary" />
                        <div>
                            <h2 className="font-semibold">Test Runner Settings</h2>
                            <p className="text-sm text-muted-foreground">
                                Configure how test runs are executed
                            </p>
                        </div>
                    </div>
                </div>

                <div className="p-6">
                    {settingsLoading ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                            Loading settings...
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div>
                                <h3 className="font-medium mb-2">Container Isolation Mode</h3>
                                <p className="text-sm text-muted-foreground mb-4">
                                    Choose how browser containers are managed during test runs.
                                </p>

                                <div className="space-y-3">
                                    {/* Context Isolation Option */}
                                    <label
                                        className={`flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                                            systemSettings?.isolation_mode === 'context'
                                                ? 'border-primary bg-primary/5'
                                                : 'border-border hover:border-primary/50'
                                        } ${savingSettings ? 'opacity-50 pointer-events-none' : ''}`}
                                    >
                                        <input
                                            type="radio"
                                            name="isolation_mode"
                                            value="context"
                                            checked={systemSettings?.isolation_mode === 'context'}
                                            onChange={() => handleIsolationModeChange('context')}
                                            disabled={savingSettings}
                                            className="mt-1"
                                        />
                                        <div>
                                            <div className="font-medium flex items-center gap-2">
                                                Context (Fast)
                                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800">
                                                    Recommended
                                                </span>
                                            </div>
                                            <p className="text-sm text-muted-foreground mt-1">
                                                Reuses browser containers with a fresh browser context per run.
                                                Clean cookies, storage, and cache for each run. Fast startup (~1s).
                                            </p>
                                        </div>
                                    </label>

                                    {/* Ephemeral Isolation Option */}
                                    <label
                                        className={`flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                                            systemSettings?.isolation_mode === 'ephemeral'
                                                ? 'border-primary bg-primary/5'
                                                : 'border-border hover:border-primary/50'
                                        } ${savingSettings ? 'opacity-50 pointer-events-none' : ''}`}
                                    >
                                        <input
                                            type="radio"
                                            name="isolation_mode"
                                            value="ephemeral"
                                            checked={systemSettings?.isolation_mode === 'ephemeral'}
                                            onChange={() => handleIsolationModeChange('ephemeral')}
                                            disabled={savingSettings}
                                            className="mt-1"
                                        />
                                        <div>
                                            <div className="font-medium">Ephemeral (Isolated)</div>
                                            <p className="text-sm text-muted-foreground mt-1">
                                                Creates a new container for each run. Complete OS-level isolation.
                                                Slower startup (~10-15s). Use for sensitive tests requiring full isolation.
                                            </p>
                                        </div>
                                    </label>
                                </div>

                                {savingSettings && (
                                    <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Saving...
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            )}

            {/* AI Model Settings Section */}
            {activeTab === 'ai' && (
            <div className="rounded-lg border bg-card shadow-sm">
                <div className="border-b px-6 py-4">
                    <div className="flex items-center gap-3">
                        <Brain className="h-5 w-5 text-blue-500" />
                        <div>
                            <h2 className="font-semibold">AI Model Settings</h2>
                            <p className="text-sm text-muted-foreground">
                                Configure the default AI model for test case analysis
                            </p>
                        </div>
                    </div>
                </div>

                <div className="p-6">
                    {settingsLoading ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                            Loading settings...
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div>
                                <h3 className="font-medium mb-2">Default Analysis Model</h3>
                                <p className="text-sm text-muted-foreground mb-4">
                                    Choose the default LLM model used when creating new test analyses.
                                </p>

                                <div className="space-y-3">
                                    {LLM_MODEL_OPTIONS.map((option) => (
                                        <label
                                            key={option.value}
                                            className={`flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                                                systemSettings?.default_analysis_model === option.value
                                                    ? 'border-blue-500 bg-blue-50/50'
                                                    : 'border-border hover:border-blue-300'
                                            } ${savingSettings ? 'opacity-50 pointer-events-none' : ''}`}
                                        >
                                            <input
                                                type="radio"
                                                name="default_analysis_model"
                                                value={option.value}
                                                checked={systemSettings?.default_analysis_model === option.value}
                                                onChange={() => handleDefaultModelChange(option.value)}
                                                disabled={savingSettings}
                                                className="mt-1"
                                            />
                                            <div>
                                                <div className="font-medium flex items-center gap-2">
                                                    {option.label}
                                                    {option.value === 'gemini-3.0-flash' && (
                                                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">
                                                            Default
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-muted-foreground mt-1">
                                                    {option.description}
                                                </p>
                                            </div>
                                        </label>
                                    ))}
                                </div>

                                {savingSettings && (
                                    <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Saving...
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            )}

            {/* Container Pool Section */}
            {activeTab === 'pool' && (
            <div className="rounded-lg border bg-card shadow-sm">
                <div className="border-b px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Container className="h-5 w-5 text-purple-500" />
                            <div>
                                <h2 className="font-semibold">Test Run Container Pool</h2>
                                <p className="text-sm text-muted-foreground">
                                    Scalable container pool for async test execution (Celery mode)
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={fetchPoolStats}
                                disabled={poolLoading}
                                className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-3"
                            >
                                <RefreshCw className={`h-4 w-4 mr-2 ${poolLoading ? 'animate-spin' : ''}`} />
                                Refresh
                            </button>
                            <button
                                onClick={handleWarmupPool}
                                disabled={warmingUp}
                                className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 h-9 px-4"
                            >
                                {warmingUp ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <Zap className="h-4 w-4 mr-2" />
                                )}
                                Warmup Pool
                            </button>
                        </div>
                    </div>
                </div>

                <div className="p-6">
                    {poolLoading && !poolStats ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                            Loading container pool...
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Pool Status */}
                            <div className="grid grid-cols-3 gap-4">
                                <div className="rounded-lg border p-4 text-center">
                                    <div className="text-2xl font-bold text-purple-600">
                                        {poolStats?.in_use_count ?? 0}
                                    </div>
                                    <div className="text-sm text-muted-foreground">In Use</div>
                                </div>
                                <div className="rounded-lg border p-4 text-center">
                                    <div className="text-2xl font-bold text-green-600">
                                        {Object.values(poolStats?.pools ?? {}).reduce((sum, p) => sum + p.size, 0)}
                                    </div>
                                    <div className="text-sm text-muted-foreground">Ready in Pool</div>
                                </div>
                                <div className="rounded-lg border p-4 text-center">
                                    <div className={`text-2xl font-bold ${poolStats?.initialized ? 'text-green-600' : 'text-gray-400'}`}>
                                        {poolStats?.initialized ? 'Yes' : 'No'}
                                    </div>
                                    <div className="text-sm text-muted-foreground">Pool Initialized</div>
                                </div>
                            </div>

                            {/* Running Containers */}
                            {poolStats && poolStats.in_use.length > 0 && (
                                <div>
                                    <h3 className="font-medium mb-2">Running Test Containers</h3>
                                    <div className="space-y-2">
                                        {poolStats.in_use.map((container) => (
                                            <div
                                                key={container.id}
                                                className="flex items-center justify-between p-3 rounded-lg border bg-purple-50"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse" />
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-mono text-sm">{container.container_name}</span>
                                                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-800">
                                                                {container.browser_type}
                                                            </span>
                                                        </div>
                                                        <div className="text-xs text-muted-foreground mt-1">
                                                            Run: {container.current_run_id?.substring(0, 8)}... •
                                                            Uses: {container.use_count}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    Started: {new Date(container.created_at).toLocaleTimeString()}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Pool Status per Browser */}
                            {poolStats && Object.entries(poolStats.pools).some(([_, p]) => p.size > 0) && (
                                <div>
                                    <h3 className="font-medium mb-2">Pooled Containers (Ready)</h3>
                                    <div className="grid grid-cols-2 gap-2">
                                        {Object.entries(poolStats.pools).map(([browserType, pool]) => (
                                            pool.size > 0 && (
                                                <div key={browserType} className="flex items-center justify-between p-3 rounded-lg border">
                                                    <span className="capitalize">{browserType}</span>
                                                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium bg-green-100 text-green-800">
                                                        {pool.size} ready
                                                    </span>
                                                </div>
                                            )
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Empty state */}
                            {poolStats && poolStats.in_use_count === 0 && Object.values(poolStats.pools).every(p => p.size === 0) && (
                                <div className="text-center py-4 text-muted-foreground">
                                    <Container className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                    <p>No containers in pool. Click "Warmup Pool" to pre-create containers.</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            )}

            {/* Browser Management Section */}
            {activeTab === 'browser' && (
            <>
            <div className="rounded-lg border bg-card shadow-sm">
                <div className="border-b px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Monitor className="h-5 w-5 text-primary" />
                            <div>
                                <h2 className="font-semibold">Browser Sessions</h2>
                                <p className="text-sm text-muted-foreground">
                                    Manage running browser containers. Inactive browsers are automatically stopped after 5 minutes.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={fetchBrowserSessions}
                                disabled={loading}
                                className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-3"
                            >
                                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                                Refresh
                            </button>
                            <button
                                onClick={handleKillAllBrowsers}
                                disabled={killing || activeSessions.length === 0}
                                className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed h-9 px-4"
                            >
                                {killing ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <Trash2 className="h-4 w-4 mr-2" />
                                )}
                                Kill All Browsers
                            </button>
                        </div>
                    </div>
                </div>

                <div className="p-6">
                    {loading && browserSessions.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                            Loading browser sessions...
                        </div>
                    ) : browserSessions.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <Monitor className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p>No browser sessions running</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="text-sm text-muted-foreground mb-4">
                                {activeSessions.length} active session(s) • {browserSessions.length} total
                            </div>
                            {browserSessions.map((session) => (
                                <div
                                    key={session.id}
                                    className="flex items-center justify-between p-4 rounded-lg border bg-muted/30"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={`w-2.5 h-2.5 rounded-full ${
                                            session.status === 'ready' || session.status === 'connected'
                                                ? 'bg-green-500'
                                                : session.status === 'starting'
                                                ? 'bg-yellow-500 animate-pulse'
                                                : 'bg-gray-400'
                                        }`} />
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-sm">{session.id.substring(0, 8)}...</span>
                                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                                    session.status === 'ready' || session.status === 'connected'
                                                        ? 'bg-green-100 text-green-800'
                                                        : session.status === 'starting'
                                                        ? 'bg-yellow-100 text-yellow-800'
                                                        : 'bg-gray-100 text-gray-800'
                                                }`}>
                                                    {session.status}
                                                </span>
                                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">
                                                    {session.phase}
                                                </span>
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-1">
                                                {session.user_name && (
                                                    <span className="font-medium text-foreground">Started by: {session.user_name}</span>
                                                )}
                                                {session.organization_name && (
                                                    <span> ({session.organization_name})</span>
                                                )}
                                                {(session.user_name || session.organization_name) && <span> • </span>}
                                                {session.test_session_id && (
                                                    <span>Test: {session.test_session_id.substring(0, 8)}... • </span>
                                                )}
                                                Created: {new Date(session.created_at).toLocaleTimeString()}
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleStopSession(session.id)}
                                        className="inline-flex items-center justify-center rounded-md text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 h-8 px-3"
                                    >
                                        Stop
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Info Section */}
            <div className="rounded-lg border bg-blue-50 border-blue-200 p-4">
                <div className="flex gap-3">
                    <AlertTriangle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800">
                        <p className="font-medium mb-1">Auto-cleanup</p>
                        <p>
                            Browser sessions are automatically stopped after 5 minutes of inactivity
                            (no steps generated or actions taken). Sessions also have a maximum
                            lifetime of 30 minutes.
                        </p>
                    </div>
                </div>
            </div>
            </>
            )}
        </div>
    );
}
