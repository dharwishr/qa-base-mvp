import { useState } from 'react'
import { X, Video, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface UrlInputModalProps {
    isOpen: boolean
    onClose: () => void
    onSubmit: (url: string) => void
}

export default function UrlInputModal({
    isOpen,
    onClose,
    onSubmit,
}: UrlInputModalProps) {
    const [url, setUrl] = useState('')
    const [error, setError] = useState<string | null>(null)

    if (!isOpen) return null

    const validateAndNormalizeUrl = (input: string): string | null => {
        let normalizedUrl = input.trim()
        if (!normalizedUrl) return null

        // Add https:// if no protocol
        if (!normalizedUrl.match(/^https?:\/\//i)) {
            normalizedUrl = 'https://' + normalizedUrl
        }

        try {
            new URL(normalizedUrl)
            return normalizedUrl
        } catch {
            return null
        }
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const validatedUrl = validateAndNormalizeUrl(url)
        if (!validatedUrl) {
            setError('Please enter a valid URL')
            return
        }
        onSubmit(validatedUrl)
        handleClose()
    }

    const handleClose = () => {
        setUrl('')
        setError(null)
        onClose()
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-background rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden border">
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-purple-500/10 border-b">
                    <Video className="h-5 w-5 text-purple-600" />
                    <h3 className="font-semibold">Record Test Case</h3>
                    <button
                        onClick={handleClose}
                        className="ml-auto p-1 hover:bg-muted rounded"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit}>
                    <div className="p-4 space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Enter the URL where you want to start recording. The browser will navigate to this URL and you can begin recording your test steps.
                        </p>

                        {error && (
                            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="startUrl">Starting URL *</Label>
                            <div className="relative">
                                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="startUrl"
                                    value={url}
                                    onChange={(e) => {
                                        setUrl(e.target.value)
                                        setError(null)
                                    }}
                                    placeholder="https://example.com"
                                    className="pl-10"
                                    required
                                    autoFocus
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Protocol (https://) will be added automatically if not provided
                            </p>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-2 px-4 py-3 bg-muted/20 border-t">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleClose}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={!url.trim()}
                            className="bg-purple-600 hover:bg-purple-700"
                        >
                            <Video className="h-4 w-4 mr-2" />
                            Start Recording
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}
