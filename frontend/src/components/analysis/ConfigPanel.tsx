import { Bot } from "lucide-react"
import type { LlmModel } from "@/types/analysis"

interface ConfigPanelProps {
    selectedLlm: LlmModel
    onLlmChange: (llm: LlmModel) => void
    disabled?: boolean
}

export default function ConfigPanel({ selectedLlm, onLlmChange, disabled = false }: ConfigPanelProps) {
    return (
        <div className="flex items-center gap-6 p-4 border-b bg-background">
            {/* LLM Selection */}
            <div className="flex items-center gap-2 flex-1">
                <Bot className="h-4 w-4 text-muted-foreground" />
                <select
                    value={selectedLlm}
                    onChange={(e) => onLlmChange(e.target.value as LlmModel)}
                    disabled={disabled}
                    className={`h-9 w-[220px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <option value="browser-use-llm">Browser Use LLM</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    <option value="gemini-3.0-flash">Gemini 3.0 Flash</option>
                    <option value="gemini-3.0-pro">Gemini 3.0 Pro</option>
                    <option value="gemini-2.5-computer-use">Gemini 2.5 Computer Use</option>
                </select>
            </div>
        </div>
    )
}
