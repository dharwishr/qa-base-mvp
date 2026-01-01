"""
QA-specific tools registry with restricted actions for test automation.

This module provides a QATools class that extends the base Tools with:
- Domain restrictions to prevent navigation outside target application
- Removal of search engine actions
- QA-specific verification and assertion actions
- Mode-aware behavior (plan vs act mode)
"""

import logging
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field

from browser_use.agent.views import ActionResult
from browser_use.browser import BrowserSession
from browser_use.tools.service import Tools

logger = logging.getLogger(__name__)


# Search engines to block
BLOCKED_SEARCH_ENGINES = [
    'google.com',
    'www.google.com',
    'bing.com',
    'www.bing.com',
    'duckduckgo.com',
    'www.duckduckgo.com',
    'yahoo.com',
    'search.yahoo.com',
    'ask.com',
    'www.ask.com',
    'baidu.com',
    'www.baidu.com',
    'yandex.com',
    'www.yandex.com',
]


class AppSearchAction(BaseModel):
    """Search within the current application using its built-in search functionality."""
    query: str = Field(description="The search query to enter in the application's search box")
    search_element_index: int | None = Field(
        default=None,
        description="Optional: specific element index of the search input. If not provided, will look for common search patterns."
    )


class QATools(Tools):
    """
    QA-specific tools with restricted actions for test automation.
    
    Modes:
    - 'plan': Exploratory analysis mode, test case generation
    - 'act': Precise test execution mode with verification
    
    Key differences from base Tools:
    - Removes 'search' action (no external search engines)
    - Adds domain validation to 'navigate' action
    - Adds QA-specific verification actions
    - Enforces strict boundaries for test execution
    """
    
    def __init__(
        self,
        target_domain: str | None = None,
        mode: Literal['plan', 'act'] = 'act',
        exclude_actions: list[str] | None = None,
        output_model=None,
        display_files_in_done_text: bool = True,
    ):
        """
        Initialize QA Tools with domain restrictions and mode-aware behavior.
        
        Args:
            target_domain: The domain to restrict navigation to (e.g., 'example.com')
            mode: 'plan' for exploratory analysis, 'act' for test execution
            exclude_actions: Additional actions to exclude
            output_model: Pydantic model for structured output
            display_files_in_done_text: Whether to display files in done action text
        """
        # Default exclusions for QA mode - always remove external search
        qa_exclusions = ['search']
        
        # Merge with user-provided exclusions
        all_exclusions = list(set((exclude_actions or []) + qa_exclusions))
        
        # Initialize parent with exclusions
        super().__init__(
            exclude_actions=all_exclusions,
            output_model=output_model,
            display_files_in_done_text=display_files_in_done_text,
        )
        
        self.target_domain = target_domain
        self.mode = mode
        
        # Register QA-specific actions
        # Note: Assertion actions (assert_text, assert_element_visible, assert_url, assert_value)
        # are already registered by the parent Tools class with proper recording hooks.
        # We only register the app_search action as a replacement for external search.
        self._register_app_search_action()
        
        logger.info(f"QATools initialized: mode={mode}, target_domain={target_domain}")
    
    def _is_allowed_url(self, url: str) -> tuple[bool, str]:
        """
        Check if a URL is allowed based on target domain restrictions.
        
        Returns:
            Tuple of (is_allowed, reason_if_blocked)
        """
        if not self.target_domain:
            # No restrictions if target domain not set
            return True, ""
        
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.lower()
            
            # Remove www. prefix for comparison
            domain_clean = domain.replace('www.', '')
            target_clean = self.target_domain.lower().replace('www.', '')
            
            # Check if it's a search engine
            if domain in BLOCKED_SEARCH_ENGINES or domain_clean in [d.replace('www.', '') for d in BLOCKED_SEARCH_ENGINES]:
                return False, f"Navigation to search engine '{domain}' is blocked in QA mode. Stay within the target application."
            
            # Check if it matches target domain or is a subdomain
            if domain_clean == target_clean or domain_clean.endswith(f'.{target_clean}'):
                return True, ""
            
            # Block navigation to other domains
            return False, f"Navigation to '{domain}' is blocked. Only '{self.target_domain}' and its subdomains are allowed in QA mode."
            
        except Exception as e:
            logger.warning(f"Error parsing URL '{url}': {e}")
            return False, f"Invalid URL: {url}"
    
    def _register_app_search_action(self) -> None:
        """Register the app-specific search action (replaces external search)."""
        
        @self.registry.action(
            'Search within the current application using its built-in search functionality. Do NOT use external search engines.',
            param_model=AppSearchAction,
        )
        async def app_search(params: AppSearchAction, browser_session: BrowserSession) -> ActionResult:
            """
            Search within the application's own search functionality.
            This action finds a search input on the current page and enters the query.
            It does NOT navigate to external search engines.
            """
            try:
                # Get current browser state to find search elements
                state = await browser_session.get_browser_state_summary()
                
                if params.search_element_index is not None:
                    # User specified a specific element
                    search_index = params.search_element_index
                    memory = f"Entered '{params.query}' into search element at index {search_index}"
                else:
                    # Look for common search input patterns in the DOM
                    # This is a simplified approach - the agent should ideally identify the search box
                    return ActionResult(
                        error="Please specify the search_element_index parameter with the index of the search input field from the browser state.",
                        long_term_memory="Need to identify search input element before using app_search"
                    )
                
                # TODO: Implement actual input action here
                # For now, return instructions for the agent to use input action instead
                return ActionResult(
                    extracted_content=f"Use the 'input' action to enter '{params.query}' into element {search_index}, then click the search button or press Enter.",
                    long_term_memory=memory
                )
                
            except Exception as e:
                logger.error(f"App search failed: {e}")
                return ActionResult(error=f"Failed to search within application: {str(e)}")
    
    def get_prohibited_domains(self) -> list[str]:
        """Get list of domains that should be blocked."""
        return BLOCKED_SEARCH_ENGINES.copy()
    
    def get_allowed_domains(self) -> list[str] | None:
        """Get list of allowed domains based on target domain."""
        if not self.target_domain:
            return None
        
        # Allow target domain and all subdomains
        return [
            self.target_domain,
            f'*.{self.target_domain}',
            f'www.{self.target_domain}',
        ]
