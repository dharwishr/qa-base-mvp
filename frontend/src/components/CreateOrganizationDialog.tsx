import { useState } from 'react'
import { X, Building2, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { organizationApi } from '@/services/authApi'
import { useAuth } from '@/contexts/AuthContext'

interface CreateOrganizationDialogProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: (orgId: string) => void
}

export default function CreateOrganizationDialog({
    isOpen,
    onClose,
    onSuccess,
}: CreateOrganizationDialogProps) {
    const { switchOrganization, refreshOrganizations } = useAuth()
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [isCreating, setIsCreating] = useState(false)
    const [error, setError] = useState<string | null>(null)

    if (!isOpen) return null

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) return

        setIsCreating(true)
        setError(null)

        try {
            const newOrg = await organizationApi.createOrganization({
                name: name.trim(),
                description: description.trim() || undefined,
            })

            // Switch to the new organization
            await switchOrganization(newOrg.id)
            await refreshOrganizations()
            onSuccess(newOrg.id)
            handleClose()
        } catch (err: unknown) {
            const error = err as { message?: string }
            setError(error.message || 'Failed to create organization')
        } finally {
            setIsCreating(false)
        }
    }

    const handleClose = () => {
        setName('')
        setDescription('')
        setError(null)
        onClose()
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-background rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden border">
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-primary/10 border-b">
                    <Building2 className="h-5 w-5 text-primary" />
                    <h3 className="font-semibold">Create New Organization</h3>
                    <button
                        onClick={handleClose}
                        disabled={isCreating}
                        className="ml-auto p-1 hover:bg-muted rounded disabled:opacity-50"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit}>
                    <div className="p-4 space-y-4">
                        {error && (
                            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="orgName">Organization Name *</Label>
                            <Input
                                id="orgName"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="My Organization"
                                disabled={isCreating}
                                required
                                autoFocus
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="orgDesc">Description (optional)</Label>
                            <Input
                                id="orgDesc"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Brief description..."
                                disabled={isCreating}
                            />
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-2 px-4 py-3 bg-muted/20 border-t">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleClose}
                            disabled={isCreating}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isCreating || !name.trim()}>
                            {isCreating ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Creating...
                                </>
                            ) : (
                                <>
                                    <Plus className="h-4 w-4 mr-2" />
                                    Create
                                </>
                            )}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}
