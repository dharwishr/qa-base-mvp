import { Save, Play, Download, Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { LlmModel } from "@/types/analysis"

interface ActionFooterProps {
    llmModel?: LlmModel
}

const LLM_DISPLAY_NAMES: Record<LlmModel, string> = {
    'browser-use-llm': 'Browser Use LLM',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-3.0-flash': 'Gemini 3.0 Flash',
    'gemini-3.0-pro': 'Gemini 3.0 Pro',
    'gemini-2.5-computer-use': 'Gemini 2.5 Computer Use',
}

export default function ActionFooter({ llmModel }: ActionFooterProps) {
    return (
        <div className="h-14 border-t bg-background flex items-center justify-between px-4">
            <div className="flex gap-2">
                <Button variant="outline" size="sm">
                    <Save className="h-4 w-4 mr-2" /> Save TC & Code
                </Button>
                <Button variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-2" /> Load TC
                </Button>
            </div>

            <div className="flex items-center gap-8 text-xs font-medium text-muted-foreground hidden sm:flex">
                <div className="flex flex-col items-center gap-1">
                    <div className="h-1 w-12 bg-primary rounded-full" />
                    <span>Browser</span>
                </div>
                <div className="flex flex-col items-center gap-1 opacity-50">
                    <div className="h-1 w-12 bg-muted rounded-full" />
                    <span>Code</span>
                </div>
                <div className="flex flex-col items-center gap-1 opacity-50">
                    <div className="h-1 w-12 bg-muted rounded-full" />
                    <span>Execute</span>
                </div>
            </div>

            <div className="flex items-center gap-4">
                {llmModel && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Bot className="h-3.5 w-3.5" />
                        <span>Using: {LLM_DISPLAY_NAMES[llmModel]}</span>
                    </div>
                )}
                <Button size="sm">
                    <Play className="h-4 w-4 mr-2" /> Execute (Run)
                </Button>
            </div>
        </div>
    )
}
