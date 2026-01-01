"""
QA-specialized Agent for test automation.

This module provides a QAAgent class that wraps the base Agent with:
- Mode-aware behavior (plan vs act mode)
- Domain restrictions to prevent out-of-scope navigation
- QA-specific system prompts
- Enhanced task building for test execution
"""

import importlib.resources
import logging
from typing import TYPE_CHECKING, Any, Literal, TypeVar
from urllib.parse import urlparse

from browser_use.agent.service import Agent
from browser_use.tools.qa_tools import QATools

if TYPE_CHECKING:
    from browser_use.browser import BrowserSession
    from browser_use.llm.base import BaseChatModel

logger = logging.getLogger(__name__)

Context = TypeVar('Context')
AgentStructuredOutput = TypeVar('AgentStructuredOutput')


class QAAgent(Agent):
    """
    QA-specialized Agent with mode-aware behavior.
    
    Modes:
    - 'plan': Exploratory analysis, test case generation
    - 'act': Precise test execution with verification
    
    Key features:
    - Automatically restricts navigation to target domain
    - Blocks search engine usage
    - Uses QA-specific system prompts
    - Builds mode-appropriate task descriptions
    """
    
    def __init__(
        self,
        task: str,
        llm: "BaseChatModel | None" = None,
        target_url: str | None = None,
        mode: Literal['plan', 'act'] = 'act',
        test_steps: list[dict] | None = None,
        # Browser configuration
        browser_session: "BrowserSession | None" = None,
        browser: "BrowserSession | None" = None,
        # Override tools if custom QA tools needed
        tools: QATools | None = None,
        # All other Agent parameters
        **kwargs
    ):
        """
        Initialize QA Agent with mode-aware behavior.
        
        Args:
            task: The task description or test objective
            llm: Language model to use
            target_url: The target application URL (used to extract domain restrictions)
            mode: 'plan' for exploratory analysis, 'act' for test execution
            test_steps: For act mode - list of test steps to execute
            browser_session: Browser session to use
            browser: Alias for browser_session
            tools: Custom QATools instance (if not provided, one will be created)
            **kwargs: Additional Agent parameters
        """
        self.mode = mode
        self.target_url = target_url
        self.target_domain = self._extract_domain(target_url) if target_url else None
        self.test_steps = test_steps or []
        
        # Create QA-specific tools if not provided
        if tools is None:
            tools = QATools(
                target_domain=self.target_domain,
                mode=mode,
            )
        
        # Build mode-specific task
        enhanced_task = self._build_qa_task(task)
        
        # Get mode-specific system prompt
        system_prompt = self._load_qa_system_prompt()
        
        # Handle browser session alias
        if browser is not None and browser_session is None:
            browser_session = browser
        
        # Configure browser with domain restrictions
        # Note: The browser session should be configured externally with allowed_domains
        # We just pass the tools with our restrictions
        
        # Set default values for QA mode
        kwargs.setdefault('use_vision', True)
        kwargs.setdefault('max_actions_per_step', 1 if mode == 'act' else 3)
        kwargs.setdefault('use_thinking', True)
        
        # In act mode, we want more controlled execution
        if mode == 'act':
            kwargs.setdefault('max_failures', 2)  # Fail faster in act mode
        
        # Initialize parent Agent
        super().__init__(
            task=enhanced_task,
            llm=llm,
            browser_session=browser_session,
            tools=tools,
            override_system_message=system_prompt,
            **kwargs
        )
        
        logger.info(f"QAAgent initialized: mode={mode}, target_domain={self.target_domain}")
    
    def _extract_domain(self, url: str) -> str:
        """Extract domain from URL."""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc
            # Remove www. prefix for cleaner domain
            if domain.startswith('www.'):
                domain = domain[4:]
            return domain
        except Exception as e:
            logger.warning(f"Failed to extract domain from URL '{url}': {e}")
            return url
    
    def _build_qa_task(self, task: str) -> str:
        """Build mode-appropriate task description."""
        if self.mode == 'plan':
            return self._build_plan_mode_task(task)
        else:
            return self._build_act_mode_task(task)
    
    def _build_plan_mode_task(self, task: str) -> str:
        """Build task for plan mode (exploratory analysis)."""
        domain_info = f"TARGET APPLICATION: {self.target_url}\n" if self.target_url else ""
        domain_restriction = f"ALLOWED DOMAIN: {self.target_domain}\n" if self.target_domain else ""
        
        return f"""{domain_info}{domain_restriction}
=== QA ANALYSIS TASK ===

{task}

=== IMPORTANT REMINDERS ===
1. Stay within the target application - do NOT use external search engines
2. Document all interactive elements you discover
3. Generate test case ideas as you explore
4. Capture element selectors for automation
5. If you get stuck, report the issue - do NOT search for solutions externally
"""
    
    def _build_act_mode_task(self, task: str) -> str:
        """Build task for act mode (test execution)."""
        domain_info = f"TARGET APPLICATION: {self.target_url}\n" if self.target_url else ""
        domain_restriction = f"ALLOWED DOMAIN: {self.target_domain}\n" if self.target_domain else ""
        
        # Format test steps if provided
        steps_text = ""
        if self.test_steps:
            steps_text = "\n=== TEST STEPS TO EXECUTE ===\n"
            for i, step in enumerate(self.test_steps, 1):
                if isinstance(step, dict):
                    step_desc = step.get('description', step.get('action', str(step)))
                    expected = step.get('expected', step.get('expected_result', ''))
                    steps_text += f"\nStep {i}: {step_desc}"
                    if expected:
                        steps_text += f"\n   Expected: {expected}"
                else:
                    steps_text += f"\nStep {i}: {step}"
        
        return f"""{domain_info}{domain_restriction}
=== QA TEST EXECUTION TASK ===

{task}
{steps_text}

=== CRITICAL RULES ===
1. Execute each step EXACTLY as specified
2. Verify the expected result after EACH action
3. If a step fails, STOP and report - do NOT try alternatives
4. NEVER navigate outside the target application
5. NEVER use search engines
6. Report failures immediately with details
"""
    
    def _load_qa_system_prompt(self) -> str:
        """Load the appropriate QA system prompt based on mode."""
        try:
            if self.mode == 'plan':
                template_filename = 'system_prompt_qa_plan.md'
            else:
                template_filename = 'system_prompt_qa_act.md'
            
            with (
                importlib.resources.files('browser_use.agent.system_prompts')
                .joinpath(template_filename)
                .open('r', encoding='utf-8') as f
            ):
                template = f.read()
            
            # Replace placeholders
            domain = self.target_domain or "[not specified]"
            template = template.replace('{target_domain}', domain)
            
            return template
            
        except Exception as e:
            logger.warning(f"Failed to load QA system prompt: {e}. Using fallback.")
            return self._get_fallback_system_prompt()
    
    def _get_fallback_system_prompt(self) -> str:
        """Get a fallback system prompt if file loading fails."""
        domain = self.target_domain or "[target application]"
        
        if self.mode == 'plan':
            return f"""You are a QA Test Analyst AI agent.

Your mission is to analyze the web application and generate test cases.

CRITICAL RULES:
1. NEVER use search engines (Google, Bing, etc.)
2. NEVER navigate outside {domain}
3. Stay within the target application at all times
4. Document elements and flows as you explore
5. Generate test case ideas

If you cannot proceed, STOP and report - do NOT try workarounds."""
        else:
            return f"""You are a QA Test Executor AI agent.

Your mission is to execute test steps with precision.

CRITICAL RULES:
1. Execute steps EXACTLY as specified
2. NEVER use search engines (Google, Bing, etc.)
3. NEVER navigate outside {domain}
4. Verify expected results after each action
5. Report failures immediately - do NOT try alternatives

Follow the test plan precisely."""
    
    @classmethod
    def create_for_plan_mode(
        cls,
        task: str,
        target_url: str,
        llm: "BaseChatModel | None" = None,
        browser_session: "BrowserSession | None" = None,
        **kwargs
    ) -> "QAAgent":
        """
        Factory method to create a QAAgent configured for plan mode.
        
        Args:
            task: The analysis/exploration task
            target_url: Target application URL
            llm: Language model to use
            browser_session: Browser session
            **kwargs: Additional Agent parameters
        
        Returns:
            QAAgent configured for plan mode
        """
        return cls(
            task=task,
            llm=llm,
            target_url=target_url,
            mode='plan',
            browser_session=browser_session,
            **kwargs
        )
    
    @classmethod
    def create_for_act_mode(
        cls,
        task: str,
        target_url: str,
        test_steps: list[dict],
        llm: "BaseChatModel | None" = None,
        browser_session: "BrowserSession | None" = None,
        **kwargs
    ) -> "QAAgent":
        """
        Factory method to create a QAAgent configured for act mode.
        
        Args:
            task: The test execution task description
            target_url: Target application URL
            test_steps: List of test steps to execute
            llm: Language model to use
            browser_session: Browser session
            **kwargs: Additional Agent parameters
        
        Returns:
            QAAgent configured for act mode
        """
        return cls(
            task=task,
            llm=llm,
            target_url=target_url,
            mode='act',
            test_steps=test_steps,
            browser_session=browser_session,
            **kwargs
        )
    
    def get_domain_restrictions(self) -> dict:
        """
        Get the domain restriction configuration for browser session.
        
        Returns:
            dict with 'allowed_domains' and 'prohibited_domains' lists
        """
        qa_tools = self.tools if isinstance(self.tools, QATools) else QATools(target_domain=self.target_domain)
        
        return {
            'allowed_domains': qa_tools.get_allowed_domains(),
            'prohibited_domains': qa_tools.get_prohibited_domains(),
        }
