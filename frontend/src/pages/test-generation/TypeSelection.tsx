import { useNavigate, useParams, useLocation } from "react-router-dom"
import {
    CheckCircle2,
    Zap,
    ShieldCheck,
    MousePointerClick,
    BarChart4
} from "lucide-react"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const testTypes = [
    {
        id: "validation",
        title: "Validation Test Cases",
        description: "Verify that data input follows constraints and mandatory fields are checked.",
        icon: CheckCircle2,
        color: "text-blue-500",
        bgColor: "bg-blue-50 dark:bg-blue-900/20"
    },
    {
        id: "functionality",
        title: "Functionality Test Cases",
        description: "Ensure the application behaves as expected for all features and workflows.",
        icon: Zap,
        color: "text-amber-500",
        bgColor: "bg-amber-50 dark:bg-amber-900/20"
    },
    {
        id: "performance",
        title: "Performance Test Cases",
        description: "Check responsiveness, load time, and stability under various conditions.",
        icon: BarChart4,
        color: "text-purple-500",
        bgColor: "bg-purple-50 dark:bg-purple-900/20"
    },
    {
        id: "security",
        title: "Security Test Cases",
        description: "Identify vulnerabilities like SQLi, XSS, and authentication flaws.",
        icon: ShieldCheck,
        color: "text-red-500",
        bgColor: "bg-red-50 dark:bg-red-900/20"
    },
    {
        id: "uiux",
        title: "UI/UX Test Cases",
        description: "Validate visual elements, navigation flow, and user experience.",
        icon: MousePointerClick,
        color: "text-pink-500",
        bgColor: "bg-pink-50 dark:bg-pink-900/20"
    }
]

export default function TypeSelection() {
    const navigate = useNavigate()
    const { method } = useParams()
    const location = useLocation()

    // Get data from previous step if URL
    // const url = location.state?.url 

    const handleSelect = (typeId: string) => {
        navigate('/test-generation/results', {
            state: {
                method,
                type: typeId,
                ...location.state
            }
        })
    }

    return (
        <div className="container mx-auto max-w-6xl p-6">
            <div className="mb-8">
                <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4 pl-0 hover:bg-transparent hover:text-primary">
                    &larr; Back to Method Selection
                </Button>
                <h1 className="text-3xl font-bold tracking-tight mb-2">Select Test Type</h1>
                <p className="text-muted-foreground">
                    Choose the category of test cases you want to generate
                    {method === 'doc' ? ' from your documents.' : ' for your website.'}
                </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {testTypes.map((type) => (
                    <Card
                        key={type.id}
                        className="cursor-pointer transition-all hover:border-primary hover:shadow-md group"
                        onClick={() => handleSelect(type.id)}
                    >
                        <CardHeader>
                            <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${type.bgColor}`}>
                                <type.icon className={`h-6 w-6 ${type.color}`} />
                            </div>
                            <CardTitle className="group-hover:text-primary transition-colors">{type.title}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <CardDescription className="text-sm">
                                {type.description}
                            </CardDescription>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    )
}
