"""
Celery tasks for executing test plan runs.

This module handles test plan execution by:
1. Iterating through test cases in the plan
2. Executing each test case (using session_runs logic)
3. Tracking progress and aggregating results
4. Supporting both sequential and parallel execution
"""

import asyncio
import logging
from datetime import datetime
from typing import Any

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import (
    TestPlan,
    TestPlanRun,
    TestPlanRunResult,
    TestPlanTestCase,
    TestRun,
    TestSession,
    SystemSettings,
)
from app.services.container_pool import get_container_pool, BrowserType, IsolationMode

logger = logging.getLogger(__name__)


def get_isolation_mode(db) -> IsolationMode:
    """Get the system-wide isolation mode setting."""
    settings = db.query(SystemSettings).filter(SystemSettings.id == "default").first()
    if settings and settings.isolation_mode == "ephemeral":
        return IsolationMode.EPHEMERAL
    return IsolationMode.CONTEXT


async def execute_single_test_case(
    db,
    result: TestPlanRunResult,
    plan_run: TestPlanRun,
) -> dict[str, Any]:
    """Execute a single test case from the test plan.

    Creates a TestRun for the session and executes it using the session_runs logic.
    """
    from app.tasks.session_runs import _execute_session_run_async

    # Mark as running
    result.status = "running"
    result.started_at = datetime.utcnow()
    db.commit()

    try:
        # Get the test session
        session = db.query(TestSession).filter(
            TestSession.id == result.test_session_id
        ).first()

        if not session:
            result.status = "skipped"
            result.error_message = "Test session not found"
            result.completed_at = datetime.utcnow()
            db.commit()
            return {"status": "skipped", "error": "Test session not found"}

        # Check if session has steps/actions to run
        if not session.steps:
            result.status = "skipped"
            result.error_message = "Test session has no steps"
            result.completed_at = datetime.utcnow()
            db.commit()
            return {"status": "skipped", "error": "Test session has no steps"}

        # Create a TestRun for this session execution
        test_run = TestRun(
            session_id=session.id,
            user_id=plan_run.user_id,
            status="pending",
            runner_type="playwright",
            headless=plan_run.headless,
            browser_type=plan_run.browser_type,
            resolution_width=plan_run.resolution_width,
            resolution_height=plan_run.resolution_height,
            screenshots_enabled=plan_run.screenshots_enabled,
            recording_enabled=plan_run.recording_enabled,
            network_recording_enabled=plan_run.network_recording_enabled,
            performance_metrics_enabled=plan_run.performance_metrics_enabled,
        )
        db.add(test_run)
        db.commit()
        db.refresh(test_run)

        # Link the test run to the result
        result.test_run_id = test_run.id
        db.commit()

        # Execute the test run using existing session_runs logic
        run_result = await _execute_session_run_async(test_run.id)

        # Refresh to get updated status
        db.refresh(test_run)

        # Update result based on test run outcome
        result.status = "passed" if test_run.status in ["passed", "healed"] else "failed"
        result.duration_ms = test_run.duration_ms
        result.error_message = test_run.error_message
        result.completed_at = datetime.utcnow()
        db.commit()

        return {
            "status": result.status,
            "duration_ms": result.duration_ms,
            "test_run_id": test_run.id,
        }

    except Exception as e:
        logger.error(f"Error executing test case {result.id}: {e}")
        result.status = "failed"
        result.error_message = str(e)
        result.completed_at = datetime.utcnow()
        db.commit()
        return {"status": "failed", "error": str(e)}


async def execute_test_plan_sequential(db, plan_run: TestPlanRun) -> dict[str, Any]:
    """Execute test cases sequentially."""
    results = db.query(TestPlanRunResult).filter(
        TestPlanRunResult.test_plan_run_id == plan_run.id
    ).order_by(TestPlanRunResult.order).all()

    passed = 0
    failed = 0

    for result in results:
        case_result = await execute_single_test_case(db, result, plan_run)
        if case_result.get("status") == "passed":
            passed += 1
        else:
            failed += 1

        # Update plan run stats incrementally
        plan_run.passed_test_cases = passed
        plan_run.failed_test_cases = failed
        db.commit()

    return {"passed": passed, "failed": failed}


async def execute_test_plan_parallel(db, plan_run: TestPlanRun, max_concurrent: int = 4) -> dict[str, Any]:
    """Execute test cases in parallel with concurrency limit."""
    import asyncio

    results = db.query(TestPlanRunResult).filter(
        TestPlanRunResult.test_plan_run_id == plan_run.id
    ).order_by(TestPlanRunResult.order).all()

    # Create semaphore for concurrency control
    semaphore = asyncio.Semaphore(max_concurrent)

    async def run_with_semaphore(result):
        async with semaphore:
            return await execute_single_test_case(db, result, plan_run)

    # Execute all test cases with concurrency limit
    tasks = [run_with_semaphore(r) for r in results]
    case_results = await asyncio.gather(*tasks, return_exceptions=True)

    # Count results
    passed = 0
    failed = 0
    for case_result in case_results:
        if isinstance(case_result, Exception):
            failed += 1
        elif case_result.get("status") == "passed":
            passed += 1
        else:
            failed += 1

    return {"passed": passed, "failed": failed}


async def _execute_test_plan_run_async(run_id: str) -> dict[str, Any]:
    """Async implementation of test plan run execution."""
    db = SessionLocal()
    start_time = datetime.utcnow()

    try:
        # Get the run
        plan_run = db.query(TestPlanRun).filter(TestPlanRun.id == run_id).first()
        if not plan_run:
            return {"status": "failed", "error": "Test plan run not found"}

        # Update status to running
        plan_run.status = "running"
        plan_run.started_at = start_time
        db.commit()

        logger.info(f"Starting test plan run {run_id} ({plan_run.run_type})")

        # Execute based on run type
        if plan_run.run_type == "parallel":
            result = await execute_test_plan_parallel(db, plan_run)
        else:
            result = await execute_test_plan_sequential(db, plan_run)

        # Calculate final status
        end_time = datetime.utcnow()
        duration_ms = int((end_time - start_time).total_seconds() * 1000)

        plan_run.passed_test_cases = result["passed"]
        plan_run.failed_test_cases = result["failed"]
        plan_run.duration_ms = duration_ms
        plan_run.completed_at = end_time
        plan_run.status = "passed" if result["failed"] == 0 else "failed"
        db.commit()

        logger.info(f"Completed test plan run {run_id}: {plan_run.status}")

        return {
            "status": plan_run.status,
            "passed": result["passed"],
            "failed": result["failed"],
            "duration_ms": duration_ms,
        }

    except Exception as e:
        logger.error(f"Error executing test plan run {run_id}: {e}")
        plan_run = db.query(TestPlanRun).filter(TestPlanRun.id == run_id).first()
        if plan_run:
            plan_run.status = "failed"
            plan_run.error_message = str(e)
            plan_run.completed_at = datetime.utcnow()
            db.commit()
        return {"status": "failed", "error": str(e)}

    finally:
        db.close()


@celery_app.task(bind=True, name="execute_test_plan_run")
def execute_test_plan_run(self, run_id: str) -> dict:
    """Execute a test plan run.

    Args:
        run_id: The test plan run ID to execute.

    Returns:
        Dict with execution results.
    """
    # Run the async execution in a new event loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(_execute_test_plan_run_async(run_id))
    finally:
        loop.close()
