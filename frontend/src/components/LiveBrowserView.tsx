import { useState, useEffect, useRef, useCallback } from 'react'
import { Monitor, Maximize2, Minimize2, RefreshCw, X, ExternalLink, Square } from 'lucide-react'

interface LiveBrowserViewProps {
    sessionId: string | null
    liveViewUrl?: string
    novncUrl?: string
    onClose?: () => void
    onStopBrowser?: () => Promise<void>
    className?: string
}

export default function LiveBrowserView({
    sessionId,
    liveViewUrl,
    novncUrl,
    onClose,
    onStopBrowser,
    className = ''
}: LiveBrowserViewProps) {
    const [isStopping, setIsStopping] = useState(false)
    const [isExpanded, setIsExpanded] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [hasError, setHasError] = useState(false)
    const iframeRef = useRef<HTMLIFrameElement>(null)

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
        <div className={`rounded-lg border bg-card shadow-sm overflow-hidden flex flex-col ${isExpanded ? 'fixed inset-4 z-50' : ''} ${className}`}>
            {/* Header */}
            <div className="border-b bg-muted/30 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium">Live Browser</span>
                    {isLoading && (
                        <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                    {sessionId && (
                        <span className="text-xs text-muted-foreground font-mono">
                            {sessionId.substring(0, 8)}...
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
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
            <div className={`relative flex-1 min-h-0 ${isExpanded ? '' : ''}`}>
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

                {fullViewUrl && (
                    <iframe
                        ref={iframeRef}
                        src={fullViewUrl}
                        className="w-full h-full border-0"
                        onLoad={handleIframeLoad}
                        onError={handleIframeError}
                        title="Live Browser View"
                        sandbox="allow-scripts allow-same-origin"
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
