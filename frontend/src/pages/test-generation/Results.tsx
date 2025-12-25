import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Check, Loader2, FileOutput } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"


export default function Results() {
    const navigate = useNavigate()
    const location = useLocation()
    const [loading, setLoading] = useState(true)
    const [progress, setProgress] = useState(0)

    // Demo data from location or defaults
    const { type } = location.state || { type: 'functional' }

    useEffect(() => {
        // Simulate processing
        const interval = setInterval(() => {
            setProgress((prev) => {
                if (prev >= 100) {
                    clearInterval(interval)
                    setLoading(false)
                    return 100
                }
                return prev + 10 // fast progress for demo
            })
        }, 200)

        return () => clearInterval(interval)
    }, [])

    const dummyTestCases = [
        { id: "TC_001", title: "Verify Login with Valid Credentials", priority: "High", status: "Automated" },
        { id: "TC_002", title: "Verify Login with Invalid Password", priority: "High", status: "Automated" },
        { id: "TC_003", title: "Check Password Reset Link", priority: "Medium", status: "Manual" },
        { id: "TC_004", title: "Verify Session Timeout", priority: "Medium", status: "Automated" },
        { id: "TC_005", title: "Verify SQL Injection on Input Fields", priority: "Critical", status: "Manual" },
    ]

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-screen w-full bg-background">
                <Loader2 className="h-16 w-16 animate-spin text-primary mb-6" />
                <h2 className="text-2xl font-semibold mb-2">Generating Test Cases...</h2>
                <p className="text-muted-foreground mb-8">Analyzing {type} requirements</p>

                <div className="w-full max-w-md h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary transition-all duration-300 ease-out"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{progress}% Complete</p>
            </div>
        )
    }

    return (
        <div className="container mx-auto max-w-6xl p-6">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Generated Test Cases</h1>
                    <p className="text-muted-foreground mt-1">Found 5 test cases based on your input.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => navigate('/dashboard')}>Back to Dashboard</Button>
                    <Button>
                        <FileOutput className="mr-2 h-4 w-4" /> Export to CSV
                    </Button>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Test Suite: {type.charAt(0).toUpperCase() + type.slice(1)} Testing</CardTitle>
                    <CardDescription>Generated on {new Date().toLocaleDateString()}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <table className="w-full caption-bottom text-sm text-left">
                            <thead className="[&_tr]:border-b">
                                <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground">ID</th>
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Title</th>
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Priority</th>
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Auto Status</th>
                                </tr>
                            </thead>
                            <tbody className="[&_tr:last-child]:border-0">
                                {dummyTestCases.map((tc) => (
                                    <tr key={tc.id} className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                                        <td className="p-4 align-middle font-medium">{tc.id}</td>
                                        <td className="p-4 align-middle">{tc.title}</td>
                                        <td className="p-4 align-middle">
                                            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${tc.priority === 'Critical' ? 'border-transparent bg-red-100 text-red-800' :
                                                tc.priority === 'High' ? 'border-transparent bg-orange-100 text-orange-800' :
                                                    'border-transparent bg-blue-100 text-blue-800'
                                                }`}>
                                                {tc.priority}
                                            </span>
                                        </td>
                                        <td className="p-4 align-middle">
                                            {tc.status === 'Automated' ? (
                                                <div className="flex items-center text-green-600">
                                                    <Check className="mr-2 h-4 w-4" /> Automated
                                                </div>
                                            ) : (
                                                <span className="text-muted-foreground">Manual</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
