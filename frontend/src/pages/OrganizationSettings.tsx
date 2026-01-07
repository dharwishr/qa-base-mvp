import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Building2, Users, Save, UserPlus, Trash2, AlertCircle, CheckCircle2, Crown } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { organizationApi, type UserInOrganization, type UserRole } from "@/services/authApi"

export default function OrganizationSettings() {
    const { organization, isOwner, user, refreshUser } = useAuth()
    const [orgName, setOrgName] = useState("")
    const [orgDescription, setOrgDescription] = useState("")
    const [users, setUsers] = useState<UserInOrganization[]>([])
    const [newUserEmail, setNewUserEmail] = useState("")
    const [newUserRole, setNewUserRole] = useState<UserRole>("member")
    const [isLoading, setIsLoading] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [isAddingUser, setIsAddingUser] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

    useEffect(() => {
        if (organization) {
            setOrgName(organization.name)
            setOrgDescription(organization.description || "")
        }
        loadUsers()
    }, [organization])

    const loadUsers = async () => {
        setIsLoading(true)
        try {
            const userList = await organizationApi.listUsers()
            setUsers(userList)
        } catch (err: unknown) {
            const error = err as { message?: string }
            setError(error.message || "Failed to load users")
        } finally {
            setIsLoading(false)
        }
    }

    const handleSaveOrganization = async () => {
        setIsSaving(true)
        setError(null)
        setSuccess(null)

        try {
            await organizationApi.updateOrganization({
                name: orgName,
                description: orgDescription || undefined,
            })
            await refreshUser()
            setSuccess("Organization updated successfully")
            setTimeout(() => setSuccess(null), 3000)
        } catch (err: unknown) {
            const error = err as { message?: string }
            setError(error.message || "Failed to update organization")
        } finally {
            setIsSaving(false)
        }
    }

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newUserEmail) return

        setIsAddingUser(true)
        setError(null)
        setSuccess(null)

        try {
            await organizationApi.addUser(newUserEmail, newUserRole)
            setNewUserEmail("")
            setNewUserRole("member")
            await loadUsers()
            setSuccess("User added successfully")
            setTimeout(() => setSuccess(null), 3000)
        } catch (err: unknown) {
            const error = err as { message?: string }
            setError(error.message || "Failed to add user")
        } finally {
            setIsAddingUser(false)
        }
    }

    const handleUpdateRole = async (userId: string, role: UserRole) => {
        setError(null)
        try {
            await organizationApi.updateUserRole(userId, role)
            await loadUsers()
            await refreshUser()
            setSuccess("Role updated successfully")
            setTimeout(() => setSuccess(null), 3000)
        } catch (err: unknown) {
            const error = err as { message?: string }
            setError(error.message || "Failed to update role")
        }
    }

    const handleRemoveUser = async (userId: string) => {
        setError(null)
        try {
            await organizationApi.removeUser(userId)
            await loadUsers()
            setSuccess("User removed successfully")
            setTimeout(() => setSuccess(null), 3000)
            setConfirmRemove(null)
        } catch (err: unknown) {
            const error = err as { message?: string }
            setError(error.message || "Failed to remove user")
        }
    }

    if (!isOwner) {
        return (
            <div className="container mx-auto py-8">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-yellow-500" />
                            Access Denied
                        </CardTitle>
                        <CardDescription>
                            You have to be a owner to see this.
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>
        )
    }

    return (
        <div className="container mx-auto py-8 space-y-8">
            <div className="flex items-center gap-3">
                <Building2 className="h-8 w-8" />
                <div>
                    <h1 className="text-2xl font-bold">Organization Settings</h1>
                    <p className="text-muted-foreground">Manage your organization and team members</p>
                </div>
            </div>

            {error && (
                <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    <span>{error}</span>
                </div>
            )}

            {success && (
                <div className="rounded-md bg-green-50 p-4 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{success}</span>
                </div>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Building2 className="h-5 w-5" />
                        Organization Details
                    </CardTitle>
                    <CardDescription>
                        Update your organization's name and description
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="orgName">Organization Name</Label>
                            <Input
                                id="orgName"
                                value={orgName}
                                onChange={(e) => setOrgName(e.target.value)}
                                placeholder="My Organization"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="orgSlug">Slug</Label>
                            <Input
                                id="orgSlug"
                                value={organization?.slug || ""}
                                disabled
                                className="bg-muted"
                            />
                            <p className="text-xs text-muted-foreground">
                                Slug is auto-generated and cannot be changed
                            </p>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="orgDescription">Description</Label>
                        <Input
                            id="orgDescription"
                            value={orgDescription}
                            onChange={(e) => setOrgDescription(e.target.value)}
                            placeholder="Describe your organization..."
                        />
                    </div>
                    <Button onClick={handleSaveOrganization} disabled={isSaving}>
                        <Save className="h-4 w-4 mr-2" />
                        {isSaving ? "Saving..." : "Save Changes"}
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5" />
                        Team Members
                    </CardTitle>
                    <CardDescription>
                        Manage users in your organization
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <form onSubmit={handleAddUser} className="flex gap-4 items-end flex-wrap">
                        <div className="flex-1 min-w-[200px] space-y-2">
                            <Label htmlFor="newUserEmail">Add User by Email</Label>
                            <Input
                                id="newUserEmail"
                                type="email"
                                value={newUserEmail}
                                onChange={(e) => setNewUserEmail(e.target.value)}
                                placeholder="user@example.com"
                            />
                        </div>
                        <div className="w-32 space-y-2">
                            <Label htmlFor="newUserRole">Role</Label>
                            <select
                                id="newUserRole"
                                value={newUserRole}
                                onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                            >
                                <option value="member">Member</option>
                                <option value="owner">Owner</option>
                            </select>
                        </div>
                        <Button type="submit" disabled={isAddingUser || !newUserEmail}>
                            <UserPlus className="h-4 w-4 mr-2" />
                            {isAddingUser ? "Adding..." : "Add"}
                        </Button>
                    </form>

                    <div className="border rounded-md overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="px-4 py-3 text-left font-medium">Name</th>
                                    <th className="px-4 py-3 text-left font-medium">Email</th>
                                    <th className="px-4 py-3 text-left font-medium">Role</th>
                                    <th className="px-4 py-3 text-left font-medium">Joined</th>
                                    <th className="px-4 py-3 text-left font-medium w-[100px]">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                                            Loading users...
                                        </td>
                                    </tr>
                                ) : users.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                                            No users in this organization
                                        </td>
                                    </tr>
                                ) : (
                                    users.map((u) => (
                                        <tr key={u.id} className="border-t">
                                            <td className="px-4 py-3 font-medium">
                                                <div className="flex items-center gap-2">
                                                    {u.name}
                                                    {u.id === user?.id && (
                                                        <span className="text-xs text-muted-foreground">(you)</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">{u.email}</td>
                                            <td className="px-4 py-3">
                                                {u.id === user?.id ? (
                                                    <div className="flex items-center gap-1">
                                                        <Crown className="h-4 w-4 text-yellow-500" />
                                                        <span className="capitalize">{u.role}</span>
                                                    </div>
                                                ) : (
                                                    <select
                                                        value={u.role}
                                                        onChange={(e) => handleUpdateRole(u.id, e.target.value as UserRole)}
                                                        className="h-8 px-2 rounded-md border border-input bg-background text-sm"
                                                    >
                                                        <option value="member">Member</option>
                                                        <option value="owner">Owner</option>
                                                    </select>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                {new Date(u.joined_at).toLocaleDateString()}
                                            </td>
                                            <td className="px-4 py-3">
                                                {u.id !== user?.id && (
                                                    <>
                                                        {confirmRemove === u.id ? (
                                                            <div className="flex gap-2">
                                                                <Button
                                                                    size="sm"
                                                                    variant="destructive"
                                                                    onClick={() => handleRemoveUser(u.id)}
                                                                >
                                                                    Confirm
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => setConfirmRemove(null)}
                                                                >
                                                                    Cancel
                                                                </Button>
                                                            </div>
                                                        ) : (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="text-red-500 hover:text-red-700"
                                                                onClick={() => setConfirmRemove(u.id)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
