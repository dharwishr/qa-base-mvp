import { useState, useEffect, useRef } from 'react'
import { Building2, ChevronUp, Crown, User, Plus, Check, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { authApi, type OrganizationWithRole } from '@/services/authApi'
import CreateOrganizationDialog from './CreateOrganizationDialog'

export default function OrganizationSwitcher() {
    const { organization, user, switchOrganization, isOwnerOfAny, refreshOrganizations } = useAuth()
    const [isOpen, setIsOpen] = useState(false)
    const [organizations, setOrganizations] = useState<OrganizationWithRole[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isSwitching, setIsSwitching] = useState<string | null>(null)
    const [showCreateDialog, setShowCreateDialog] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // Load organizations when dropdown opens
    useEffect(() => {
        if (isOpen && organizations.length === 0) {
            loadOrganizations()
        }
    }, [isOpen, organizations.length])

    const loadOrganizations = async () => {
        setIsLoading(true)
        try {
            const orgs = await authApi.getUserOrganizations()
            setOrganizations(orgs)
        } catch (err) {
            console.error('Failed to load organizations:', err)
        } finally {
            setIsLoading(false)
        }
    }

    const handleSwitch = async (orgId: string) => {
        if (orgId === organization?.id) {
            setIsOpen(false)
            return
        }

        setIsSwitching(orgId)
        const result = await switchOrganization(orgId)
        if (result.success) {
            setIsOpen(false)
            // Reload page to refresh all data for new organization
            window.location.reload()
        }
        setIsSwitching(null)
    }

    const handleCreateSuccess = () => {
        loadOrganizations()
        refreshOrganizations()
        setIsOpen(false)
        // Reload page to refresh all data for new organization
        window.location.reload()
    }

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Trigger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors group/switcher"
            >
                <Building2 className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                <div className="flex-1 text-left opacity-0 w-0 overflow-hidden transition-all duration-300 group-hover:w-auto group-hover:opacity-100">
                    <div className="font-medium truncate text-foreground">{organization?.name || 'Organization'}</div>
                    <div className="text-xs text-muted-foreground truncate">{user?.name}</div>
                </div>
                <ChevronUp className={`h-4 w-4 text-muted-foreground transition-transform opacity-0 group-hover:opacity-100 ${isOpen ? '' : 'rotate-180'}`} />
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute bottom-full left-0 mb-1 bg-background rounded-lg shadow-xl border overflow-hidden z-50 min-w-[240px]">
                    <div className="p-1 max-h-64 overflow-y-auto">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-4">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <>
                                {/* Organization List */}
                                {organizations.map((org) => (
                                    <button
                                        key={org.id}
                                        onClick={() => handleSwitch(org.id)}
                                        disabled={isSwitching !== null}
                                        className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent transition-colors disabled:opacity-50 text-left text-sm"
                                    >
                                        <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium truncate">{org.name}</div>
                                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                                                {org.role === 'owner' ? (
                                                    <><Crown className="h-3 w-3" /> Owner</>
                                                ) : (
                                                    <><User className="h-3 w-3" /> Member</>
                                                )}
                                            </div>
                                        </div>
                                        {org.id === organization?.id ? (
                                            <Check className="h-4 w-4 text-primary flex-shrink-0" />
                                        ) : isSwitching === org.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                                        ) : null}
                                    </button>
                                ))}

                                {/* Create New Organization (only for owners) */}
                                {isOwnerOfAny && (
                                    <>
                                        <div className="border-t my-1" />
                                        <button
                                            onClick={() => {
                                                setIsOpen(false)
                                                setShowCreateDialog(true)
                                            }}
                                            className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent transition-colors text-left text-sm text-primary"
                                        >
                                            <Plus className="h-4 w-4" />
                                            <span>Create new organization</span>
                                        </button>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Create Organization Dialog */}
            <CreateOrganizationDialog
                isOpen={showCreateDialog}
                onClose={() => setShowCreateDialog(false)}
                onSuccess={handleCreateSuccess}
            />
        </div>
    )
}
