import { useNavigate, Outlet, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"
import {
    LayoutDashboard,
    Settings,
    LogOut,
    PlayCircle,
    FileText,
    Boxes,
    Compass,
    FlaskConical,
    Building2,
    ClipboardList
} from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { ThemeToggle } from "@/components/ThemeToggle"
import OrganizationSwitcher from "@/components/OrganizationSwitcher"

// Sidebar Item Component
const SidebarItem = ({
    icon: Icon,
    label,
    active = false,
    onClick
}: {
    icon: any,
    label: string,
    active?: boolean,
    onClick?: () => void
}) => {
    return (
        <div
            onClick={onClick}
            className={cn(
                "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all hover:bg-accent hover:text-accent-foreground cursor-pointer",
                active ? "bg-accent text-accent-foreground" : "text-muted-foreground"
            )}
        >
            <Icon className="h-5 w-5 flex-shrink-0" />
            <span className="opacity-0 w-0 overflow-hidden transition-all duration-300 group-hover:w-auto group-hover:opacity-100 whitespace-nowrap">
                {label}
            </span>
        </div>
    )
}

export default function DashboardLayout() {
    const navigate = useNavigate()
    const location = useLocation()
    const activePath = location.pathname
    const { logout } = useAuth()

    const handleLogout = () => {
        logout()
    }

    return (
        <div className="flex h-screen w-full overflow-hidden bg-background">
            {/* Sidebar */}
            <aside className="fixed inset-y-0 left-0 z-10 hidden w-16 flex-col border-r bg-background transition-all duration-300 hover:w-64 sm:flex group">
                <div className="flex h-14 items-center justify-center border-b px-2 py-4">
                    <Boxes className="h-6 w-6 text-primary flex-shrink-0" />
                    <span className="ml-2 hidden text-lg font-bold opacity-0 transition-opacity duration-300 group-hover:opacity-100 sidebar-expanded:block group-hover:block whitespace-nowrap">
                        SmartTester
                    </span>
                </div>

                {/* Navigation */}
                <nav className="flex flex-1 flex-col gap-2 p-2">
                    <SidebarItem
                        icon={LayoutDashboard}
                        label="Overview"
                        active={activePath === '/dashboard'}
                        onClick={() => navigate('/dashboard')}
                    />
                    <SidebarItem
                        icon={PlayCircle}
                        label="Test Gen"
                        active={activePath.startsWith('/test-generation')}
                        onClick={() => navigate('/test-generation')}
                    />
                    <SidebarItem
                        icon={FileText}
                        label="Test Cases"
                        active={activePath.startsWith('/test-cases')}
                        onClick={() => navigate('/test-cases')}
                    />
                    {/* Scripts section hidden - use Test Case Execute tab instead
                    <SidebarItem
                        icon={Zap}
                        label="Scripts"
                        active={activePath.startsWith('/scripts')}
                        onClick={() => navigate('/scripts')}
                    />
                    */}
                    <SidebarItem
                        icon={ClipboardList}
                        label="Test Plans"
                        active={activePath.startsWith('/test-plans') || activePath.startsWith('/test-plan-runs')}
                        onClick={() => navigate('/test-plans')}
                    />
                    <SidebarItem
                        icon={Compass}
                        label="Discovery"
                        active={activePath.startsWith('/discovery')}
                        onClick={() => navigate('/discovery')}
                    />
                    <SidebarItem
                        icon={FlaskConical}
                        label="Benchmark"
                        active={activePath.startsWith('/benchmark')}
                        onClick={() => navigate('/benchmarks')}
                    />
                    <SidebarItem
                        icon={Building2}
                        label="Organization"
                        active={activePath === '/organization'}
                        onClick={() => navigate('/organization')}
                    />
                    <SidebarItem
                        icon={Settings}
                        label="Settings"
                        active={activePath === '/settings'}
                        onClick={() => navigate('/settings')}
                    />
                </nav>

                <div className="mt-auto p-2 space-y-1">
                    <OrganizationSwitcher />
                    <div className="border-t my-2" />
                    <ThemeToggle />
                    <SidebarItem icon={LogOut} label="Logout" onClick={handleLogout} />
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex flex-1 flex-col sm:pl-16 transition-all duration-300">
                <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-6">
                    <h1 className="text-lg font-semibold">
                        {activePath === '/dashboard' ? 'Dashboard' :
                            activePath.includes('/test-generation') ? 'Test Generation' :
                                activePath.includes('/test-cases') ? 'Test Cases' :
                                    activePath.includes('/test-analysis') ? 'Test Analysis' :
                                        activePath.includes('/test-plan') ? 'Test Plans' :
                                            // activePath.includes('/scripts') ? 'Test Scripts' :
                                            activePath.includes('/discovery') ? 'Module Discovery' :
                                                activePath.includes('/benchmark') ? 'LLM Benchmark' :
                                                    activePath.includes('/organization') ? 'Organization' :
                                                        activePath.includes('/settings') ? 'Settings' :
                                                            'SmartTester'}
                    </h1>
                </header>
                <main className="flex-1 overflow-auto">
                    <Outlet />
                </main>
            </div>
        </div>
    )
}
