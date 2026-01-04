import { useState } from 'react';
import { X, Play, Monitor, Camera, Video, Wifi, Gauge, Loader2, Server } from 'lucide-react';
import type { BrowserType, Resolution, StartRunRequest } from '@/types/scripts';

interface RunConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    onRun: (config: StartRunRequest) => Promise<void>;
    isRunning: boolean;
}

const BROWSERS: { value: BrowserType; label: string; icon: string }[] = [
    { value: 'chromium', label: 'Chrome', icon: 'chrome' },
    { value: 'firefox', label: 'Firefox', icon: 'firefox' },
    { value: 'webkit', label: 'Safari', icon: 'safari' },
    { value: 'edge', label: 'Edge', icon: 'edge' },
];

const RESOLUTIONS: { value: Resolution; label: string; dimensions: string }[] = [
    { value: '1920x1080', label: 'Full HD', dimensions: '1920 x 1080' },
    { value: '1366x768', label: 'HD', dimensions: '1366 x 768' },
    { value: '1600x900', label: 'WXGA+', dimensions: '1600 x 900' },
];

export default function RunConfigModal({ isOpen, onClose, onRun, isRunning }: RunConfigModalProps) {
    // Configuration state
    const [browserType, setBrowserType] = useState<BrowserType>('chromium');
    const [resolution, setResolution] = useState<Resolution>('1920x1080');
    const [screenshotsEnabled, setScreenshotsEnabled] = useState(true);
    const [recordingEnabled, setRecordingEnabled] = useState(true);
    const [networkRecordingEnabled, setNetworkRecordingEnabled] = useState(false);
    const [performanceMetricsEnabled, setPerformanceMetricsEnabled] = useState(true);

    const handleRun = async () => {
        await onRun({
            browser_type: browserType,
            resolution,
            screenshots_enabled: screenshotsEnabled,
            recording_enabled: recordingEnabled,
            network_recording_enabled: networkRecordingEnabled,
            performance_metrics_enabled: performanceMetricsEnabled,
        });
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold">Run Configuration</h2>
                    <button
                        onClick={onClose}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Info banner */}
                    <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                        <Server className="h-5 w-5 text-blue-500 mt-0.5" />
                        <div className="text-sm">
                            <div className="font-medium text-blue-900">Container Pool Execution</div>
                            <div className="text-blue-700 mt-0.5">
                                Tests run on pre-warmed browser containers for fast, consistent execution across all browser types.
                            </div>
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
                                    className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-sm transition-colors ${
                                        browserType === browser.value
                                            ? 'border-primary bg-primary/5 text-primary'
                                            : 'border-border hover:border-primary/50'
                                    }`}
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
                                    className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-sm transition-colors ${
                                        resolution === res.value
                                            ? 'border-primary bg-primary/5 text-primary'
                                            : 'border-border hover:border-primary/50'
                                    }`}
                                >
                                    <span className="font-medium">{res.label}</span>
                                    <span className="text-xs text-muted-foreground">{res.dimensions}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Toggle Options */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium">Recording Options</label>

                        {/* Screenshots toggle */}
                        <div className="flex items-center justify-between p-3 rounded-lg border">
                            <div className="flex items-center gap-3">
                                <Camera className="h-4 w-4 text-muted-foreground" />
                                <div>
                                    <div className="text-sm font-medium">Screenshots per Step</div>
                                    <div className="text-xs text-muted-foreground">Capture a screenshot after each step</div>
                                </div>
                            </div>
                            <button
                                onClick={() => setScreenshotsEnabled(!screenshotsEnabled)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    screenshotsEnabled ? 'bg-primary' : 'bg-muted'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        screenshotsEnabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>

                        {/* Video recording toggle */}
                        <div className="flex items-center justify-between p-3 rounded-lg border">
                            <div className="flex items-center gap-3">
                                <Video className="h-4 w-4 text-muted-foreground" />
                                <div>
                                    <div className="text-sm font-medium">Screen Recording</div>
                                    <div className="text-xs text-muted-foreground">Record video of the entire run (WebM)</div>
                                </div>
                            </div>
                            <button
                                onClick={() => setRecordingEnabled(!recordingEnabled)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    recordingEnabled ? 'bg-primary' : 'bg-muted'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        recordingEnabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>

                        {/* Network recording toggle */}
                        <div className="flex items-center justify-between p-3 rounded-lg border">
                            <div className="flex items-center gap-3">
                                <Wifi className="h-4 w-4 text-muted-foreground" />
                                <div>
                                    <div className="text-sm font-medium">Network Recording</div>
                                    <div className="text-xs text-muted-foreground">Capture API calls and network requests</div>
                                </div>
                            </div>
                            <button
                                onClick={() => setNetworkRecordingEnabled(!networkRecordingEnabled)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    networkRecordingEnabled ? 'bg-primary' : 'bg-muted'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        networkRecordingEnabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
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
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    performanceMetricsEnabled ? 'bg-primary' : 'bg-muted'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        performanceMetricsEnabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-muted/30">
                    <button
                        onClick={onClose}
                        disabled={isRunning}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-4 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleRun}
                        disabled={isRunning}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700 h-9 px-6 disabled:opacity-50"
                    >
                        {isRunning ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Starting...
                            </>
                        ) : (
                            <>
                                <Play className="h-4 w-4 mr-2" />
                                Run Test
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
