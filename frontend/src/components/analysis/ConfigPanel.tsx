import { Bot, Monitor, EyeOff } from "lucide-react"
import type { LlmModel } from "@/types/analysis"

interface ConfigPanelProps {
    selectedLlm: LlmModel
    onLlmChange: (llm: LlmModel) => void
    headless: boolean
    onHeadlessChange: (headless: boolean) => void
    activeTab?: 'live' | 'screenshot'
    onTabChange?: (tab: 'live' | 'screenshot') => void
    disabled?: boolean
}

export default function ConfigPanel({
    selectedLlm,
    onLlmChange,
    headless,
    onHeadlessChange,
    disabled = false,
    activeTab,
    onTabChange
}: ConfigPanelProps) {
    return (
        <div className="flex items-center gap-6 p-4 border-b bg-background justify-between">
            <div className="flex items-center gap-6">
                {/* LLM Selection */}
                <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-muted-foreground" />
                    <select
                        value={selectedLlm}
                        onChange={(e) => onLlmChange(e.target.value as LlmModel)}
                        disabled={disabled}
                        className={`h-9 w-[220px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <option value="browser-use-llm">Browser Use LLM</option>
                        <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                        <option value="gemini-3.0-flash">Gemini 3.0 Flash</option>
                        <option value="gemini-3.0-pro">Gemini 3.0 Pro</option>
                        <option value="gemini-2.5-computer-use">Gemini 2.5 Computer Use</option>
                    </select>
                </div>

                {/* Browser Mode Toggle */}
                <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">Mode:</span>
                    <div className="flex rounded-md border border-input overflow-hidden">
                        <button
                            type="button"
                            onClick={() => onHeadlessChange(true)}
                            disabled={disabled}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${headless
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-transparent text-muted-foreground hover:bg-muted'
                                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            title="Headless mode - faster, shows screenshots only"
                        >
                            <EyeOff className="h-3.5 w-3.5" />
                            Headless
                        </button>
                        <button
                            type="button"
                            onClick={() => onHeadlessChange(false)}
                            disabled={disabled}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors border-l border-input ${!headless
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-transparent text-muted-foreground hover:bg-muted'
                                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            title="Live browser mode - watch execution in real-time"
                        >
                            <Monitor className="h-3.5 w-3.5" />
                            Live
                        </button>
                    </div>
                </div>
            </div>

            {/* View Tabs */}
            {onTabChange && activeTab && (
                <div className="flex bg-muted/30 p-1 rounded-lg">
                    <button
                        onClick={() => onTabChange('screenshot')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'screenshot'
                            ? 'bg-background shadow-sm text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        Screenshots
                    </button>
                    <button
                        onClick={() => onTabChange('live')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'live'
                            ? 'bg-background shadow-sm text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Monitor className="h-3.5 w-3.5" />
                        Live Browser
                    </button>
                </div>
            )}
        </div>
    )
}
