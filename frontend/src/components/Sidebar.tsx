import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import {
    LayoutDashboard,
    Settings,
    LogOut,
    PlayCircle,
    FileText,
    Boxes
} from "lucide-react"

interface SidebarItemProps {
    icon: any
    label: string
    active?: boolean
    onClick?: () => void
}

const SidebarItem = ({
    icon: Icon,
    label,
    active = false,
    onClick
}: SidebarItemProps) => {
    return (
        <div
            onClick={onClick}
            className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all hover:bg-accent hover:text-accent-foreground cursor-pointer overflow-hidden",
                active ? "bg-accent text-accent-foreground" : "text-muted-foreground"
            )}
        >
            <Icon className="h-5 w-5 flex-shrink-0" />
            <span className="opacity-0 w-0 transition-all duration-300 group-hover:w-auto group-hover:opacity-100 whitespace-nowrap">
                {label}
            </span>
        </div>
    )
}

export const Sidebar = ({ activePath }: { activePath?: string }) => {
    const navigate = useNavigate()

    const handleLogout = () => {
        navigate("/")
    }

    return (
        <aside className="group fixed inset-y-0 left-0 z-10 hidden w-16 flex-col border-r bg-background transition-all duration-300 hover:w-64 sm:flex">
            <div className="flex h-14 items-center gap-3 border-b px-4 py-4">
                <Boxes className="h-6 w-6 text-primary flex-shrink-0" />
                <span className="text-lg font-bold opacity-0 transition-all duration-300 group-hover:opacity-100 whitespace-nowrap overflow-hidden">
                    SmartTester
                </span>
            </div>

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
                    active={activePath?.startsWith('/test-generation')}
                    onClick={() => navigate('/test-generation')} 
                />
                <SidebarItem
                    icon={FileText}
                    label="Test Cases"
                    active={activePath?.startsWith('/test-cases')}
                    onClick={() => navigate('/test-cases')}
                />
                <SidebarItem icon={Settings} label="Settings" />
            </nav>

            <div className="mt-auto p-2">
                <SidebarItem icon={LogOut} label="Logout" onClick={handleLogout} />
            </div>
        </aside>
    )
}
