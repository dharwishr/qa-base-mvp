"""
Runner Factory - Creates the appropriate test runner based on configuration.

Supports both Playwright and CDP-based execution engines.
Optionally connects to remote browser via CDP URL.
"""

from enum import Enum
from typing import Any, Callable

from app.services.base_runner import (
    BaseRunner,
    StepStartCallback,
    StepCompleteCallback,
)


class RunnerType(str, Enum):
    """Available test runner types."""
    PLAYWRIGHT = "playwright"
    CDP = "cdp"


# Type aliases for callbacks
NetworkEventCallback = Callable[[str, dict], Any]  # (event_type, data)
ConsoleLogCallback = Callable[[dict], Any]  # (log_data)


def create_runner(
    runner_type: RunnerType | str,
    headless: bool = True,
    screenshot_dir: str = "data/screenshots/runs",
    video_dir: str = "data/videos/runs",
    on_step_start: StepStartCallback | None = None,
    on_step_complete: StepCompleteCallback | None = None,
    cdp_url: str | None = None,
    # New configuration options
    browser_type: str = "chromium",
    resolution: tuple[int, int] = (1920, 1080),
    screenshots_enabled: bool = True,
    recording_enabled: bool = True,
    network_recording_enabled: bool = False,
    performance_metrics_enabled: bool = True,
    # New callbacks
    on_network_request: NetworkEventCallback | None = None,
    on_console_log: ConsoleLogCallback | None = None,
    # Run ID for video naming
    run_id: str | None = None,
) -> BaseRunner:
    """Create a test runner of the specified type.

    Args:
        runner_type: Type of runner to create ('playwright' or 'cdp')
        headless: Whether to run browser in headless mode
        screenshot_dir: Directory to save screenshots
        video_dir: Directory to save video recordings
        on_step_start: Callback called when a step starts
        on_step_complete: Callback called when a step completes
        cdp_url: Optional CDP URL to connect to remote browser
        browser_type: Browser to use (chromium, firefox, webkit, edge)
        resolution: Browser viewport size as (width, height) tuple
        screenshots_enabled: Whether to capture screenshots per step
        recording_enabled: Whether to record video of the run
        network_recording_enabled: Whether to capture network requests
        performance_metrics_enabled: Whether to capture performance metrics
        on_network_request: Callback for network request events
        on_console_log: Callback for console log events
        run_id: Test run ID for video naming

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
            video_dir=video_dir,
            on_step_start=on_step_start,
            on_step_complete=on_step_complete,
            cdp_url=cdp_url,
            browser_type=browser_type,
            resolution=resolution,
            screenshots_enabled=screenshots_enabled,
            recording_enabled=recording_enabled,
            network_recording_enabled=network_recording_enabled,
            performance_metrics_enabled=performance_metrics_enabled,
            on_network_request=on_network_request,
            on_console_log=on_console_log,
            run_id=run_id,
        )

    elif runner_type == RunnerType.CDP:
        from app.services.cdp_runner import CDPRunner
        return CDPRunner(
            headless=headless,
            screenshot_dir=screenshot_dir,
            on_step_start=on_step_start,
            on_step_complete=on_step_complete,
            cdp_url=cdp_url,
        )

    else:
        raise ValueError(f"Unknown runner type: {runner_type}")
