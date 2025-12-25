import { Globe, Image } from "lucide-react"

interface BrowserPreviewProps {
    screenshotUrl?: string | null
    currentUrl?: string | null
    pageTitle?: string | null
}

export default function BrowserPreview({ screenshotUrl, currentUrl, pageTitle }: BrowserPreviewProps) {
    return (
        <div className="flex-1 bg-muted/30 p-8 flex items-center justify-center relative overflow-hidden">
            {/* Browser Mockup Frame */}
            <div className="w-full h-full max-w-4xl bg-background border rounded-lg shadow-xl flex flex-col overflow-hidden">
                {/* Browser Chrome */}
                <div className="h-8 bg-muted border-b flex items-center px-4 gap-2 flex-shrink-0">
                    <div className="flex gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-red-400" />
                        <div className="w-3 h-3 rounded-full bg-yellow-400" />
                        <div className="w-3 h-3 rounded-full bg-green-400" />
                    </div>
                    <div className="flex-1 bg-background h-5 rounded mx-4 text-[10px] flex items-center px-2 text-muted-foreground truncate">
                        {currentUrl || "https://example.com"}
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-zinc-950 overflow-hidden">
                    {screenshotUrl ? (
                        <div className="w-full h-full flex items-center justify-center p-2 overflow-auto">
                            <img
                                src={screenshotUrl}
                                alt={pageTitle || "Browser screenshot"}
                                className="max-w-full max-h-full object-contain rounded shadow-sm"
                                onError={(e) => {
                                    // Hide broken image and show placeholder
                                    e.currentTarget.style.display = 'none'
                                    e.currentTarget.nextElementSibling?.classList.remove('hidden')
                                }}
                            />
                            <div className="hidden flex-col items-center justify-center p-8">
                                <Image className="h-16 w-16 text-muted-foreground/50 mb-4" />
                                <p className="text-muted-foreground text-sm">Failed to load screenshot</p>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center p-8">
                            <Globe className="h-24 w-24 text-blue-500 mb-4 opacity-80" />
                            <h3 className="text-xl font-medium text-foreground">Browser Preview</h3>
                            <p className="text-muted-foreground text-sm mt-2 max-w-xs text-center">
                                Select a step to view its screenshot here.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
