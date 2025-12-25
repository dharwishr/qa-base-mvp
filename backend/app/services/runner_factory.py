"""
Runner Factory - Creates the appropriate test runner based on configuration.

Supports both Playwright and CDP-based execution engines.
"""

from enum import Enum

from app.services.base_runner import (
    BaseRunner,
    StepStartCallback,
    StepCompleteCallback,
)


class RunnerType(str, Enum):
    """Available test runner types."""
    PLAYWRIGHT = "playwright"
    CDP = "cdp"


def create_runner(
    runner_type: RunnerType | str,
    headless: bool = True,
    screenshot_dir: str = "data/screenshots/runs",
    on_step_start: StepStartCallback | None = None,
    on_step_complete: StepCompleteCallback | None = None,
) -> BaseRunner:
    """Create a test runner of the specified type.

    Args:
        runner_type: Type of runner to create ('playwright' or 'cdp')
        headless: Whether to run browser in headless mode
        screenshot_dir: Directory to save screenshots
        on_step_start: Callback called when a step starts
        on_step_complete: Callback called when a step completes

    Returns:
        An instance of the appropriate runner class

    Raises:
        ValueError: If runner_type is unknown
    """
    # Normalize string to enum
    if isinstance(runner_type, str):
        runner_type = RunnerType(runner_type.lower())

    if runner_type == RunnerType.PLAYWRIGHT:
        from app.services.playwright_runner import PlaywrightRunner
        return PlaywrightRunner(
            headless=headless,
            screenshot_dir=screenshot_dir,
            on_step_start=on_step_start,
            on_step_complete=on_step_complete,
        )

    elif runner_type == RunnerType.CDP:
        from app.services.cdp_runner import CDPRunner
        return CDPRunner(
            headless=headless,
            screenshot_dir=screenshot_dir,
            on_step_start=on_step_start,
            on_step_complete=on_step_complete,
        )

    else:
        raise ValueError(f"Unknown runner type: {runner_type}")
