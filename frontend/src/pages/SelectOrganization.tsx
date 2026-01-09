import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Building2, Crown, User, ChevronRight, Loader2 } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { authApi, type OrganizationWithRole } from "@/services/authApi"

export default function SelectOrganization() {
    const navigate = useNavigate()
    const { switchOrganization, user } = useAuth()
    const [organizations, setOrganizations] = useState<OrganizationWithRole[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isSwitching, setIsSwitching] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        loadOrganizations()
    }, [])

    const loadOrganizations = async () => {
        try {
            const orgs = await authApi.getUserOrganizations()
            setOrganizations(orgs)

            // If only one org, auto-select and redirect
            if (orgs.length === 1) {
                await handleSelect(orgs[0].id)
            }
        } catch {
            setError("Failed to load organizations")
        } finally {
            setIsLoading(false)
        }
    }

    const handleSelect = async (orgId: string) => {
        setIsSwitching(orgId)
        setError(null)
        const result = await switchOrganization(orgId)
        if (result.success) {
            navigate("/dashboard")
        } else {
            setError(result.error || "Failed to select organization")
            setIsSwitching(null)
        }
    }

    if (isLoading) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-background">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    return (
        <div className="flex h-screen w-full items-center justify-center bg-background p-4">
            <div className="w-full max-w-lg rounded-lg border bg-card shadow-lg">
                <div className="border-b p-6 text-center">
                    <h1 className="text-2xl font-semibold">Select Organization</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Welcome back, {user?.name}! Choose an organization to continue.
                    </p>
                </div>
                <div className="p-4 space-y-3">
                    {error && (
                        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                            {error}
                        </div>
                    )}
                    {organizations.map((org) => (
                        <button
                            key={org.id}
                            onClick={() => handleSelect(org.id)}
                            disabled={isSwitching !== null}
                            className="w-full flex items-center gap-3 p-4 rounded-lg border hover:bg-accent transition-colors disabled:opacity-50 text-left"
                        >
                            <Building2 className="h-10 w-10 p-2 rounded-lg bg-primary/10 text-primary flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">{org.name}</div>
                                <div className="text-sm text-muted-foreground flex items-center gap-1">
                                    {org.role === 'owner' ? (
                                        <><Crown className="h-3 w-3" /> Owner</>
                                    ) : (
                                        <><User className="h-3 w-3" /> Member</>
                                    )}
                                </div>
                            </div>
                            {isSwitching === org.id ? (
                                <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
                            ) : (
                                <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                            )}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}
