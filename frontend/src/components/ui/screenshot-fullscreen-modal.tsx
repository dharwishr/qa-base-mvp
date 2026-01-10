import { useEffect, useCallback } from 'react';
import { X, ZoomIn } from 'lucide-react';

interface ScreenshotFullscreenModalProps {
    isOpen: boolean;
    onClose: () => void;
    imageUrl: string;
    alt?: string;
}

export function ScreenshotFullscreenModal({
    isOpen,
    onClose,
    imageUrl,
    alt = 'Screenshot',
}: ScreenshotFullscreenModalProps) {
    // Close on Escape key
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        },
        [onClose]
    );

    useEffect(() => {
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            // Prevent body scroll when modal is open
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen, handleKeyDown]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            onClick={onClose}
        >
            {/* Backdrop with blur */}
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

            {/* Close button */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label="Close fullscreen view"
            >
                <X className="h-6 w-6" />
            </button>

            {/* Image container */}
            <div
                className="relative z-10 max-w-[95vw] max-h-[95vh] p-2"
                onClick={(e) => e.stopPropagation()}
            >
                <img
                    src={imageUrl}
                    alt={alt}
                    className="max-w-full max-h-[95vh] object-contain rounded-lg shadow-2xl"
                />
            </div>
        </div>
    );
}

interface ScreenshotWithZoomProps {
    imageUrl: string;
    alt?: string;
    className?: string;
    onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ScreenshotWithZoom({
    imageUrl,
    alt = 'Screenshot',
    className = '',
    onError,
    isOpen,
    onOpenChange,
}: ScreenshotWithZoomProps) {
    return (
        <>
            {/* Image with hover button */}
            <div className="relative group">
                <img
                    src={imageUrl}
                    alt={alt}
                    className={className}
                    onError={onError}
                />
                {/* Zoom button - appears on hover */}
                <button
                    onClick={() => onOpenChange(true)}
                    className="absolute top-2 right-2 p-2 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-black/80"
                    aria-label="View fullscreen"
                >
                    <ZoomIn className="h-5 w-5" />
                </button>
            </div>

            {/* Fullscreen modal */}
            <ScreenshotFullscreenModal
                isOpen={isOpen}
                onClose={() => onOpenChange(false)}
                imageUrl={imageUrl}
                alt={alt}
            />
        </>
    );
}
