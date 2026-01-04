"""
Celery tasks for executing test runs using the container pool.

This module handles scalable test execution by:
1. Acquiring containers from the pool
2. Executing Playwright tests
3. Saving results to the database
4. Releasing containers back to the pool
"""

import asyncio
import logging
from datetime import datetime

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import TestRun, RunStep, PlaywrightScript, NetworkRequest, ConsoleLog, SystemSettings
from app.services.container_pool import (
    get_container_pool,
    BrowserType,
    IsolationMode,
)
from app.services.runner_factory import create_runner
from app.services.base_runner import StepResult
from app.services.script_recorder import PlaywrightStep
from app.services.live_logs import LiveLogsPublisher

logger = logging.getLogger(__name__)


def get_isolation_mode(db) -> IsolationMode:
    """Get the system-wide isolation mode setting."""
    settings = db.query(SystemSettings).filter(SystemSettings.id == "default").first()
    if settings and settings.isolation_mode == "ephemeral":
        return IsolationMode.EPHEMERAL
    return IsolationMode.CONTEXT


@celery_app.task(bind=True, name="execute_test_run")
def execute_test_run(self, run_id: str) -> dict:
    """Execute a test run using the container pool.

    Args:
        run_id: The test run ID to execute.

    Returns:
        Dict with execution results.
    """
    # Run the async execution in a new event loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(_execute_test_run_async(self, run_id))
    finally:
        loop.close()


async def _execute_test_run_async(task, run_id: str) -> dict:
    """Async implementation of test run execution."""
    db = SessionLocal()
    container = None
    pool = get_container_pool()

    try:
        # Get run record
        run = db.query(TestRun).filter(TestRun.id == run_id).first()
        if not run:
            raise ValueError(f"Run {run_id} not found")

        # Get script
        script = db.query(PlaywrightScript).filter(PlaywrightScript.id == run.script_id).first()
        if not script:
            raise ValueError(f"Script {run.script_id} not found")

        # Update run status
        run.status = "running"
        run.started_at = datetime.utcnow()
        run.celery_task_id = task.request.id
        db.commit()

        logger.info(f"Starting test run {run_id} for script {script.name}")

        # Get isolation mode from system settings
        isolation_mode = get_isolation_mode(db)

        # Parse browser type
        browser_type = BrowserType(run.browser_type or "chromium")

        # Acquire container from pool
        container = await pool.acquire(
            browser_type=browser_type,
            isolation_mode=isolation_mode,
            run_id=run_id,
            resolution=(run.resolution_width or 1920, run.resolution_height or 1080),
        )

        logger.info(f"Acquired container {container.container_name} for run {run_id}")

        # Prepare callbacks for saving network requests and console logs
        network_requests = []
        console_logs = []
        current_step_index = [0]  # Use list to allow modification in nested function
        
        # Create live logs publisher for real-time streaming
        live_publisher = LiveLogsPublisher(run_id)

        def on_network_request(event_type: str, data: dict):
            # event_type can be "response" or "failed"
            if run.network_recording_enabled and event_type in ("response", "failed"):
                data["step_index"] = current_step_index[0]
                network_requests.append(data)
                # Publish live to WebSocket clients
                live_publisher.publish_network_request(data)
                logger.debug(f"Captured network request: {data.get('method')} {data.get('url', '')[:50]}")

        def on_console_log(data: dict):
            data["step_index"] = current_step_index[0]
            console_logs.append(data)
            # Publish live to WebSocket clients
            live_publisher.publish_console_log(data)
            logger.debug(f"Captured console log: [{data.get('level')}] {data.get('message', '')[:50]}")

        # Define step callbacks
        def on_step_start(step_index: int, step):
            current_step_index[0] = step_index
            logger.debug(f"Run {run_id}: Starting step {step_index}")

        def on_step_complete(step_index: int, result: StepResult):
            # Save step result to database
            run_step = RunStep(
                run_id=run_id,
                step_index=step_index,
                action=result.action,
                status=result.status,
                selector_used=result.selector_used,
                screenshot_path=result.screenshot_path,
                duration_ms=result.duration_ms,
                error_message=result.error_message,
                heal_attempts=[ha.__dict__ for ha in result.heal_attempts] if result.heal_attempts else None,
            )
            db.add(run_step)
            db.commit()
            # Publish live step update
            live_publisher.publish_step_update(step_index, result.status, result.action, result.error_message)
            logger.debug(f"Run {run_id}: Step {step_index} completed with status {result.status}")

        # Create runner with container's CDP URL
        # Video is recorded inside container at /videos (mounted to host data/videos)
        async with create_runner(
            runner_type="playwright",
            headless=True,
            cdp_url=container.cdp_ws_url,
            browser_type=run.browser_type or "chromium",
            resolution=(run.resolution_width or 1920, run.resolution_height or 1080),
            screenshots_enabled=run.screenshots_enabled,
            recording_enabled=run.recording_enabled,
            network_recording_enabled=run.network_recording_enabled,
            performance_metrics_enabled=run.performance_metrics_enabled,
            on_step_start=on_step_start,
            on_step_complete=on_step_complete,
            on_network_request=on_network_request,
            on_console_log=on_console_log,
            run_id=run_id,
            video_dir="/videos",  # Container path, mounted to host data/videos
        ) as runner:
            # Execute the test - convert dict steps to PlaywrightStep objects
            steps = [PlaywrightStep(**step) for step in script.steps_json]
            result = await runner.run(steps, run_id)

        # Save network requests to database
        for req_data in network_requests:
            # Parse timestamps from ISO string to datetime if needed
            started_at = req_data.get("started_at")
            if isinstance(started_at, str):
                started_at = datetime.fromisoformat(started_at)
            completed_at = req_data.get("completed_at")
            if isinstance(completed_at, str):
                completed_at = datetime.fromisoformat(completed_at)

            network_req = NetworkRequest(
                run_id=run_id,
                step_index=req_data.get("step_index"),
                url=req_data.get("url", ""),
                method=req_data.get("method", "GET"),
                resource_type=req_data.get("resource_type", "other"),
                status_code=req_data.get("status_code"),
                response_size_bytes=req_data.get("response_size_bytes"),
                timing_dns_ms=req_data.get("timing_dns_ms"),
                timing_connect_ms=req_data.get("timing_connect_ms"),
                timing_ssl_ms=req_data.get("timing_ssl_ms"),
                timing_ttfb_ms=req_data.get("timing_ttfb_ms"),
                timing_download_ms=req_data.get("timing_download_ms"),
                timing_total_ms=req_data.get("timing_total_ms"),
                started_at=started_at,
                completed_at=completed_at,
            )
            db.add(network_req)

        # Save console logs to database
        for log_data in console_logs:
            # Parse timestamp from ISO string to datetime if needed
            timestamp = log_data.get("timestamp")
            if isinstance(timestamp, str):
                timestamp = datetime.fromisoformat(timestamp)

            console_log = ConsoleLog(
                run_id=run_id,
                step_index=log_data.get("step_index"),
                level=log_data.get("level", "log"),
                message=log_data.get("message", ""),
                source=log_data.get("source"),
                line_number=log_data.get("line_number"),
                column_number=log_data.get("column_number"),
                stack_trace=log_data.get("stack_trace"),
                timestamp=timestamp,
            )
            db.add(console_log)

        # Update run with final status
        run.status = result.status
        run.completed_at = result.completed_at
        run.passed_steps = result.passed_steps
        run.failed_steps = result.failed_steps
        run.healed_steps = result.healed_steps
        run.error_message = result.error_message
        run.video_path = result.video_path
        run.duration_ms = result.duration_ms
        db.commit()

        logger.info(f"Test run {run_id} completed: status={result.status}, duration={result.duration_ms}ms")

        return {
            "run_id": run_id,
            "status": result.status,
            "passed_steps": result.passed_steps,
            "failed_steps": result.failed_steps,
            "healed_steps": result.healed_steps,
            "duration_ms": result.duration_ms,
        }

    except Exception as e:
        logger.error(f"Test run {run_id} failed: {e}")

        # Update run status to failed
        try:
            run = db.query(TestRun).filter(TestRun.id == run_id).first()
            if run:
                run.status = "failed"
                run.error_message = str(e)
                run.completed_at = datetime.utcnow()
                db.commit()
        except Exception:
            pass

        raise

    finally:
        # Release container back to pool
        if container:
            try:
                isolation_mode = get_isolation_mode(db)
                await pool.release(container.id, isolation_mode)
                logger.info(f"Released container {container.container_name}")
            except Exception as e:
                logger.error(f"Failed to release container: {e}")

        # Close live logs publisher
        try:
            live_publisher.close()
        except Exception:
            pass

        db.close()


@celery_app.task(name="warmup_container_pool")
def warmup_container_pool(browser_types: list[str] | None = None) -> dict:
    """Pre-warm the container pool with specified browser types.

    Args:
        browser_types: List of browser types to warm up (default: chromium only)

    Returns:
        Dict with pool status.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(_warmup_pool_async(browser_types))
    finally:
        loop.close()


async def _warmup_pool_async(browser_types: list[str] | None = None) -> dict:
    """Async implementation of pool warmup."""
    pool = get_container_pool()

    types = None
    if browser_types:
        types = [BrowserType(bt) for bt in browser_types]

    await pool.initialize(types)
    stats = pool.get_stats()

    logger.info(f"Container pool warmed up: {stats}")
    return stats


@celery_app.task(name="pool_health_check")
def pool_health_check() -> dict:
    """Check health of the container pool.

    Returns:
        Dict with health status.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(_health_check_async())
    finally:
        loop.close()


async def _health_check_async() -> dict:
    """Async implementation of health check."""
    pool = get_container_pool()
    health = await pool.health_check()
    logger.info(f"Pool health check: {health}")
    return health
