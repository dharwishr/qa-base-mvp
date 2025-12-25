"""
Base Runner - Abstract interface for test script execution engines.

This module defines the shared types and abstract base class that both
PlaywrightRunner and CDPRunner implement.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Awaitable, Union, Any
import inspect

from app.services.script_recorder import PlaywrightStep

# Type for callbacks that can be sync or async
StepStartCallback = Callable[[int, PlaywrightStep], Union[None, Awaitable[None]]]
StepCompleteCallback = Callable[[int, "StepResult"], Union[None, Awaitable[None]]]


@dataclass
class HealAttempt:
    """Record of a self-healing attempt."""
    selector: str
    success: bool
    error: str | None = None


@dataclass
class StepResult:
    """Result of executing a single step."""
    step_index: int
    action: str
    status: str  # passed | failed | healed | skipped
    selector_used: str | None = None
    screenshot_path: str | None = None
    duration_ms: int = 0
    error_message: str | None = None
    heal_attempts: list[HealAttempt] = field(default_factory=list)


@dataclass
class RunResult:
    """Result of executing an entire script."""
    status: str  # passed | failed | healed
    total_steps: int
    passed_steps: int
    failed_steps: int
    healed_steps: int
    step_results: list[StepResult] = field(default_factory=list)
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None


class BaseRunner(ABC):
    """Abstract base class for test script runners.

    Both PlaywrightRunner and CDPRunner implement this interface,
    allowing them to be used interchangeably.
    """

    def __init__(
        self,
        headless: bool = True,
        screenshot_dir: str = "data/screenshots/runs",
        on_step_start: StepStartCallback | None = None,
        on_step_complete: StepCompleteCallback | None = None,
    ):
        self.headless = headless
        self.screenshot_dir = Path(screenshot_dir)
        self.screenshot_dir.mkdir(parents=True, exist_ok=True)
        self.on_step_start = on_step_start
        self.on_step_complete = on_step_complete

    async def _call_callback(self, callback: Callable | None, *args) -> None:
        """Call a callback, handling both sync and async functions."""
        if callback is None:
            return
        result = callback(*args)
        if inspect.iscoroutine(result):
            await result

    @abstractmethod
    async def __aenter__(self) -> "BaseRunner":
        """Initialize browser and return self."""
        pass

    @abstractmethod
    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Clean up browser resources."""
        pass

    @abstractmethod
    async def run(self, steps: list[PlaywrightStep], run_id: str) -> RunResult:
        """Execute a list of steps and return results.

        Args:
            steps: List of PlaywrightStep objects to execute
            run_id: Unique identifier for this run (used for screenshots)

        Returns:
            RunResult with status and step-by-step results
        """
        pass
