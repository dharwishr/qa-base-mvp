import { useState, useEffect, useRef, useCallback } from 'react'
import { Monitor, Maximize2, Minimize2, RefreshCw, X, ExternalLink, Square, Circle, Hand, ChevronDown } from 'lucide-react'
import type { RecordingMode } from '../types/analysis'

interface LiveBrowserViewProps {
    sessionId: string | null
    liveViewUrl?: string
    novncUrl?: string
    onClose?: () => void
    onStopBrowser?: () => Promise<void>
    className?: string
    // Recording props
    isRecording?: boolean
    onStartRecording?: (mode: RecordingMode) => Promise<void>
    onStopRecording?: () => Promise<void>
    canRecord?: boolean  // Whether recording is available (not executing, browser session exists)
    isAIExecuting?: boolean  // Whether AI is currently executing (blocks all interaction)
    currentRecordingMode?: RecordingMode | null  // Currently active recording mode
    // Interaction props - allows browsing without recording
    isInteractionEnabled?: boolean
    onToggleInteraction?: () => void
}

// Recording mode labels for UI
const RECORDING_MODE_LABELS: Record<RecordingMode, string> = {
    'playwright': 'Playwright',
    'browser_use': 'Browser-Use',
    'cdp': 'CDP (Legacy)',
}

export default function LiveBrowserView({
    sessionId,
    liveViewUrl,
    novncUrl,
    onClose,
    onStopBrowser,
    className = '',
    isRecording = false,
    onStartRecording,
    onStopRecording,
    canRecord = false,
    isAIExecuting = false,
    currentRecordingMode = null,
    isInteractionEnabled = false,
    onToggleInteraction,
}: LiveBrowserViewProps) {
    const [isStopping, setIsStopping] = useState(false)
    const [isExpanded, setIsExpanded] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [hasError, setHasError] = useState(false)
    const [isToggling, setIsToggling] = useState(false)
    const [showRecordingModeMenu, setShowRecordingModeMenu] = useState(false)
    const [selectedRecordingMode, setSelectedRecordingMode] = useState<RecordingMode>('playwright')
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const recordingMenuRef = useRef<HTMLDivElement>(null)

    // Prefer novncUrl (direct noVNC access) over liveViewUrl (wrapper page)
    const fullViewUrl = novncUrl
        ? novncUrl
        : liveViewUrl
            ? `${import.meta.env.VITE_API_URL}${liveViewUrl}`
            : sessionId
                ? `${import.meta.env.VITE_API_URL}/browser/sessions/${sessionId}/view`
                : null

    const handleIframeLoad = useCallback(() => {
        setIsLoading(false)
        setHasError(false)
    }, [])

    const handleIframeError = useCallback(() => {
        setIsLoading(false)
        setHasError(true)
    }, [])

    const handleRefresh = useCallback(() => {
        if (iframeRef.current) {
            setIsLoading(true)
            setHasError(false)
            iframeRef.current.src = iframeRef.current.src
        }
    }, [])

    const handleOpenInNewTab = useCallback(() => {
        if (fullViewUrl) {
            window.open(fullViewUrl, '_blank')
        }
    }, [fullViewUrl])

    const handleStopBrowser = useCallback(async () => {
        if (!onStopBrowser || isStopping) return
        setIsStopping(true)
        try {
            await onStopBrowser()
        } finally {
            setIsStopping(false)
        }
    }, [onStopBrowser, isStopping])

    const handleToggleRecording = useCallback(async () => {
        if (isToggling) return
        setIsToggling(true)
        try {
            if (isRecording && onStopRecording) {
                await onStopRecording()
                setShowRecordingModeMenu(false)
            } else if (!isRecording && onStartRecording) {
                await onStartRecording(selectedRecordingMode)
                setShowRecordingModeMenu(false)
            }
        } finally {
            setIsToggling(false)
        }
    }, [isRecording, onStartRecording, onStopRecording, isToggling, selectedRecordingMode])

    const handleSelectRecordingMode = useCallback(async (mode: RecordingMode) => {
        setSelectedRecordingMode(mode)
        setShowRecordingModeMenu(false)
        if (onStartRecording && !isRecording) {
            setIsToggling(true)
            try {
                await onStartRecording(mode)
            } finally {
                setIsToggling(false)
            }
        }
    }, [onStartRecording, isRecording])

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (recordingMenuRef.current && !recordingMenuRef.current.contains(event.target as Node)) {
                setShowRecordingModeMenu(false)
            }
        }
        if (showRecordingModeMenu) {
            document.addEventListener('mousedown', handleClickOutside)
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [showRecordingModeMenu])

    useEffect(() => {
        setIsLoading(true)
        setHasError(false)
    }, [sessionId])

    if (!sessionId && !liveViewUrl) {
        return (
            <div className={`rounded-lg border bg-muted/30 ${className}`}>
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                    <Monitor className="h-8 w-8 mr-3 opacity-50" />
                    <span>No live browser session</span>
                </div>
            </div>
        )
    }

    return (
        <div className={`rounded-lg border bg-card shadow-sm overflow-hidden flex flex-col h-full ${isExpanded ? 'fixed inset-4 z-50' : ''} ${isRecording ? 'ring-2 ring-red-500 ring-offset-2' : ''} ${className}`}>
            {/* Header */}
            <div className={`border-b px-4 py-2 flex items-center justify-between ${isRecording ? 'bg-red-50' : 'bg-muted/30'}`}>
                <div className="flex items-center gap-2">
                    <Monitor className={`h-4 w-4 ${isRecording ? 'text-red-500' : 'text-green-500'}`} />
                    <span className="text-sm font-medium">
                        {isRecording ? 'Recording' : 'Live Browser'}
                    </span>
                    {isRecording && (
                        <span className="flex items-center gap-1 text-xs text-red-600 font-medium animate-pulse">
                            <Circle className="h-2 w-2 fill-red-500 text-red-500" />
                            REC
                        </span>
                    )}
                    {isLoading && !isRecording && (
                        <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                    {sessionId && !isRecording && (
                        <span className="text-xs text-muted-foreground font-mono">
                            {sessionId.substring(0, 8)}...
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {/* Interaction toggle button - allows browsing without recording */}
                    {onToggleInteraction && !isRecording && (
                        <button
                            onClick={onToggleInteraction}
                            className={`px-2 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${isInteractionEnabled
                                ? 'bg-blue-500 text-white hover:bg-blue-600'
                                : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                }`}
                            title={isInteractionEnabled ? 'Disable Browser Interaction' : 'Enable Browser Interaction'}
                        >
                            <Hand className={`h-3 w-3 ${isInteractionEnabled ? '' : ''}`} />
                            {isInteractionEnabled ? 'Browsing' : 'Browse'}
                        </button>
                    )}
                    {/* Recording button with mode selector */}
                    {canRecord && (onStartRecording || onStopRecording) && (
                        <div className="relative flex items-center" ref={recordingMenuRef}>
                            {/* Main record/stop button */}
                            <button
                                onClick={handleToggleRecording}
                                disabled={isToggling}
                                className={`px-2 py-1 rounded-l text-xs font-medium transition-colors flex items-center gap-1 ${isRecording
                                    ? 'bg-red-500 text-white hover:bg-red-600'
                                    : 'bg-red-100 text-red-700 hover:bg-red-200'
                                    } ${isToggling ? 'opacity-50 cursor-not-allowed' : ''}`}
                                title={isRecording
                                    ? `Stop Recording (${currentRecordingMode ? RECORDING_MODE_LABELS[currentRecordingMode] : RECORDING_MODE_LABELS[selectedRecordingMode]})`
                                    : `Start Recording with ${RECORDING_MODE_LABELS[selectedRecordingMode]}`}
                            >
                                <Circle className={`h-3 w-3 ${isRecording ? 'fill-white animate-pulse' : 'fill-red-500'}`} />
                                {isToggling ? 'Loading...' : (isRecording ? 'Stop' : 'Record')}
                            </button>
                            {/* Mode selector dropdown (only show when not recording) */}
                            {!isRecording && (
                                <button
                                    onClick={() => setShowRecordingModeMenu(!showRecordingModeMenu)}
                                    disabled={isToggling}
                                    className={`px-1 py-1 rounded-r border-l border-red-300 text-xs font-medium transition-colors flex items-center ${'bg-red-100 text-red-700 hover:bg-red-200'
                                        } ${isToggling ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    title="Select recording mode"
                                >
                                    <ChevronDown className="h-3 w-3" />
                                </button>
                            )}
                            {/* Dropdown menu */}
                            {showRecordingModeMenu && !isRecording && (
                                <div className="absolute top-full right-0 mt-1 bg-white border rounded-md shadow-lg z-50 min-w-[140px]">
                                    <div className="py-1">
                                        <div className="px-3 py-1 text-xs text-gray-500 font-medium border-b">
                                            Recording Mode
                                        </div>
                                        {(['playwright', 'browser_use', 'cdp'] as RecordingMode[]).map((mode) => (
                                            <button
                                                key={mode}
                                                onClick={() => handleSelectRecordingMode(mode)}
                                                className={`w-full px-3 py-2 text-xs text-left hover:bg-gray-100 flex items-center justify-between ${selectedRecordingMode === mode ? 'bg-red-50 text-red-700' : 'text-gray-700'
                                                    }`}
                                            >
                                                <span>{RECORDING_MODE_LABELS[mode]}</span>
                                                {selectedRecordingMode === mode && (
                                                    <Circle className="h-2 w-2 fill-red-500 text-red-500" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    <button
                        onClick={handleRefresh}
                        className="p-1.5 rounded hover:bg-muted transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                        onClick={handleOpenInNewTab}
                        className="p-1.5 rounded hover:bg-muted transition-colors"
                        title="Open in new tab"
                    >
                        <ExternalLink className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="p-1.5 rounded hover:bg-muted transition-colors"
                        title={isExpanded ? 'Minimize' : 'Maximize'}
                    >
                        {isExpanded ? (
                            <Minimize2 className="h-4 w-4" />
                        ) : (
                            <Maximize2 className="h-4 w-4" />
                        )}
                    </button>
                    {onStopBrowser && (
                        <button
                            onClick={handleStopBrowser}
                            disabled={isStopping}
                            className="p-1.5 rounded hover:bg-red-100 transition-colors disabled:opacity-50"
                            title="Stop browser session"
                        >
                            <Square className={`h-4 w-4 text-red-500 ${isStopping ? 'animate-pulse' : ''}`} />
                        </button>
                    )}
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded hover:bg-muted transition-colors"
                            title="Close"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Browser View */}
            <div className={`relative flex-1 min-h-[500px] ${isExpanded ? '' : ''}`}>
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
                        <div className="text-center">
                            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">Loading browser view...</p>
                        </div>
                    </div>
                )}

                {hasError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-red-50 z-10">
                        <div className="text-center">
                            <Monitor className="h-8 w-8 mx-auto mb-2 text-red-400" />
                            <p className="text-sm text-red-600">Failed to load browser view</p>
                            <button
                                onClick={handleRefresh}
                                className="mt-2 text-sm text-blue-600 hover:underline"
                            >
                                Try again
                            </button>
                        </div>
                    </div>
                )}

                {/* Interaction blocker overlay - blocks user interaction */}
                {!isRecording && !isInteractionEnabled && (isAIExecuting || canRecord) && (
                    <div
                        className="absolute inset-0 z-20 bg-transparent cursor-not-allowed"
                        title={isAIExecuting ? "AI is controlling the browser" : "Click 'Browse' or 'Record' to interact with the browser"}
                    >
                        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                            {isAIExecuting ? (
                                <>
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                    AI is working...
                                </>
                            ) : (
                                <>
                                    <Hand className="h-3 w-3" />
                                    Click "Browse" or "Record" to interact
                                </>
                            )}
                        </div>
                    </div>
                )}

                {fullViewUrl && (
                    <iframe
                        ref={iframeRef}
                        src={fullViewUrl}
                        className="w-full h-full border-0"
                        onLoad={handleIframeLoad}
                        onError={handleIframeError}
                        title="Live Browser View"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-modals"
                    />
                )}
            </div>

            {/* Expanded overlay background */}
            {isExpanded && (
                <div
                    className="fixed inset-0 bg-black/50 -z-10"
                    onClick={() => setIsExpanded(false)}
                />
            )}
        </div>
    )
}
