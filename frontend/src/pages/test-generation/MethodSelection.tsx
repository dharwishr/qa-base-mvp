import { useNavigate } from "react-router-dom"
import { FileText, Globe, ArrowRight } from "lucide-react"
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { useState } from "react"

export default function MethodSelection() {
    const navigate = useNavigate()
    const [url, setUrl] = useState("")

    const handleSelect = (method: string) => {
        if (method === 'url' && !url) {
            alert("Please enter a URL")
            return
        }
        navigate(`/test-generation/type/${method}`, { state: { url } })
    }

    return (
        <div className="container mx-auto max-w-5xl h-full flex flex-col justify-center p-6">
            <div className="mb-8 text-center">
                <h1 className="text-3xl font-bold tracking-tight mb-2">Test Case Generation</h1>
                <p className="text-muted-foreground">Select how you want to generate test cases for your application.</p>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
                {/* Document Based */}
                <Card className="flex flex-col hover:border-primary/50 transition-colors cursor-pointer" onClick={() => navigate('/test-generation/type/doc')}>
                    <CardHeader>
                        <div className="p-3 w-fit rounded-lg bg-blue-100 dark:bg-blue-900/40 mb-4">
                            <FileText className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                        </div>
                        <CardTitle className="text-xl">Document Based</CardTitle>
                        <CardDescription>
                            Upload requirements, specifications, or PRDs to generate test cases.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1">
                        <div className="p-8 border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground bg-muted/50">
                            <span className="text-sm">Click to select documents</span>
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button className="w-full" onClick={(e) => { e.stopPropagation(); navigate('/test-generation/type/doc'); }}>
                            Proceed with Documents <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </CardFooter>
                </Card>

                {/* URL Based */}
                <Card className="flex flex-col hover:border-primary/50 transition-colors">
                    <CardHeader>
                        <div className="p-3 w-fit rounded-lg bg-green-100 dark:bg-green-900/40 mb-4">
                            <Globe className="h-8 w-8 text-green-600 dark:text-green-400" />
                        </div>
                        <CardTitle className="text-xl">Website URL Scouting</CardTitle>
                        <CardDescription>
                            Provide your application URL to crawl and generate test cases automatically.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="url">Website URL</Label>
                            <Input
                                id="url"
                                placeholder="https://example.com"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                            />
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button className="w-full" onClick={() => handleSelect('url')}>
                            Proceed with URL <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        </div>
    )
}
