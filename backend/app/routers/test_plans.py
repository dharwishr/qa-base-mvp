"""
Router for Test Plan module.

Provides endpoints for:
- Test Plan CRUD
- Test Case Management (add, remove, reorder)
- Test Plan Execution
- Test Plan Scheduling
"""
import logging
import math
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthenticatedUser, get_current_user
from app.models import (
    TestPlan,
    TestPlanTestCase,
    TestPlanRun,
    TestPlanRunResult,
    TestPlanSchedule,
    TestSession,
)
from app.schemas import (
    AddTestCasesRequest,
    CreateScheduleRequest,
    CreateTestPlanRequest,
    PaginatedTestPlansResponse,
    ReorderTestCasesRequest,
    RunTestPlanRequest,
    StartTestPlanRunResponse,
    TestPlanDetailResponse,
    TestPlanResponse,
    TestPlanRunDetailResponse,
    TestPlanRunResponse,
    TestPlanRunResultResponse,
    TestPlanScheduleResponse,
    TestPlanTestCaseResponse,
    UpdateScheduleRequest,
    UpdateTestPlanRequest,
    UpdateTestPlanSettingsRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/test-plans", tags=["test-plans"])


# ============================================
# Helper Functions
# ============================================

def get_test_plan_or_404(
    db: Session,
    plan_id: str,
    organization_id: str
) -> TestPlan:
    """Get a test plan by ID, ensuring it belongs to the organization."""
    plan = db.query(TestPlan).filter(
        TestPlan.id == plan_id,
        TestPlan.organization_id == organization_id
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Test plan not found")
    return plan


def build_test_plan_response(plan: TestPlan, db: Session) -> dict[str, Any]:
    """Build a TestPlanResponse dict from a TestPlan model."""
    # Get test case count
    test_case_count = db.query(TestPlanTestCase).filter(
        TestPlanTestCase.test_plan_id == plan.id
    ).count()

    # Get last run info
    last_run = db.query(TestPlanRun).filter(
        TestPlanRun.test_plan_id == plan.id
    ).order_by(TestPlanRun.created_at.desc()).first()

    return {
        "id": plan.id,
        "name": plan.name,
        "url": plan.url,
        "description": plan.description,
        "status": plan.status,
        "test_case_count": test_case_count,
        "last_run_status": last_run.status if last_run else None,
        "last_run_at": last_run.created_at if last_run else None,
        "default_run_type": plan.default_run_type,
        "browser_type": plan.browser_type,
        "resolution_width": plan.resolution_width,
        "resolution_height": plan.resolution_height,
        "headless": plan.headless,
        "screenshots_enabled": plan.screenshots_enabled,
        "recording_enabled": plan.recording_enabled,
        "network_recording_enabled": plan.network_recording_enabled,
        "performance_metrics_enabled": plan.performance_metrics_enabled,
        "created_at": plan.created_at,
        "updated_at": plan.updated_at,
        "user_name": plan.user.name if plan.user else None,
    }


def build_test_case_response(tc: TestPlanTestCase) -> dict[str, Any]:
    """Build a TestPlanTestCaseResponse dict."""
    session = tc.test_session
    step_count = len(session.steps) if session.steps else 0
    return {
        "id": tc.id,
        "test_session_id": tc.test_session_id,
        "title": session.title,
        "prompt": session.prompt,
        "status": session.status,
        "order": tc.order,
        "step_count": step_count,
        "created_at": tc.created_at,
    }


def build_run_response(run: TestPlanRun) -> dict[str, Any]:
    """Build a TestPlanRunResponse dict."""
    return {
        "id": run.id,
        "test_plan_id": run.test_plan_id,
        "status": run.status,
        "run_type": run.run_type,
        "browser_type": run.browser_type,
        "resolution_width": run.resolution_width,
        "resolution_height": run.resolution_height,
        "headless": run.headless,
        "screenshots_enabled": run.screenshots_enabled,
        "recording_enabled": run.recording_enabled,
        "network_recording_enabled": run.network_recording_enabled,
        "performance_metrics_enabled": run.performance_metrics_enabled,
        "total_test_cases": run.total_test_cases,
        "passed_test_cases": run.passed_test_cases,
        "failed_test_cases": run.failed_test_cases,
        "duration_ms": run.duration_ms,
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        "error_message": run.error_message,
        "created_at": run.created_at,
        "user_name": run.user.name if run.user else None,
        "celery_task_id": run.celery_task_id,
    }


def build_run_result_response(result: TestPlanRunResult) -> dict[str, Any]:
    """Build a TestPlanRunResultResponse dict."""
    return {
        "id": result.id,
        "test_session_id": result.test_session_id,
        "test_session_title": result.test_session.title if result.test_session else None,
        "test_run_id": result.test_run_id,
        "order": result.order,
        "status": result.status,
        "duration_ms": result.duration_ms,
        "error_message": result.error_message,
        "started_at": result.started_at,
        "completed_at": result.completed_at,
    }


def build_schedule_response(schedule: TestPlanSchedule) -> dict[str, Any]:
    """Build a TestPlanScheduleResponse dict."""
    return {
        "id": schedule.id,
        "test_plan_id": schedule.test_plan_id,
        "name": schedule.name,
        "schedule_type": schedule.schedule_type,
        "run_type": schedule.run_type,
        "one_time_at": schedule.one_time_at,
        "cron_expression": schedule.cron_expression,
        "timezone": schedule.timezone,
        "is_active": schedule.is_active,
        "last_run_at": schedule.last_run_at,
        "next_run_at": schedule.next_run_at,
        "created_at": schedule.created_at,
        "updated_at": schedule.updated_at,
    }


# ============================================
# Test Plan CRUD Endpoints
# ============================================

@router.post("", response_model=TestPlanResponse, status_code=status.HTTP_201_CREATED)
async def create_test_plan(
    request: CreateTestPlanRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Create a new test plan."""
    plan = TestPlan(
        organization_id=current_user.organization_id,
        user_id=current_user.id,
        name=request.name,
        url=request.url,
        description=request.description,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)

    logger.info(f"Created test plan {plan.id} for org {current_user.organization_id}")
    return build_test_plan_response(plan, db)


@router.get("", response_model=PaginatedTestPlansResponse)
async def list_test_plans(
    search: str | None = None,
    status_filter: str | None = None,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """List all test plans for the organization."""
    page = max(1, page)
    page_size = min(max(1, page_size), 100)

    query = db.query(TestPlan).filter(
        TestPlan.organization_id == current_user.organization_id
    )

    if search:
        query = query.filter(TestPlan.name.ilike(f"%{search}%"))

    if status_filter:
        query = query.filter(TestPlan.status == status_filter)

    total = query.count()
    offset = (page - 1) * page_size
    plans = query.order_by(TestPlan.created_at.desc()).offset(offset).limit(page_size).all()

    return PaginatedTestPlansResponse(
        items=[build_test_plan_response(p, db) for p in plans],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total > 0 else 1,
    )


@router.get("/{plan_id}", response_model=TestPlanDetailResponse)
async def get_test_plan(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Get a test plan with its test cases and recent runs."""
    plan = get_test_plan_or_404(db, plan_id, current_user.organization_id)

    # Build base response
    response = build_test_plan_response(plan, db)

    # Add test cases
    test_cases = db.query(TestPlanTestCase).filter(
        TestPlanTestCase.test_plan_id == plan.id
    ).order_by(TestPlanTestCase.order).all()
    response["test_cases"] = [build_test_case_response(tc) for tc in test_cases]

    # Add recent runs (last 10)
    recent_runs = db.query(TestPlanRun).filter(
        TestPlanRun.test_plan_id == plan.id
    ).order_by(TestPlanRun.created_at.desc()).limit(10).all()
    response["recent_runs"] = [build_run_response(r) for r in recent_runs]

    # Add schedules
    schedules = db.query(TestPlanSchedule).filter(
        TestPlanSchedule.test_plan_id == plan.id
    ).all()
    response["schedules"] = [build_schedule_response(s) for s in schedules]

    return response


@router.put("/{plan_id}", response_model=TestPlanResponse)
async def update_test_plan(
    plan_id: str,
    request: UpdateTestPlanRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Update a test plan."""
    plan = get_test_plan_or_404(db, plan_id, current_user.organization_id)

    if request.name is not None:
        plan.name = request.name
    if request.url is not None:
        plan.url = request.url
    if request.description is not None:
        plan.description = request.description
    if request.status is not None:
        plan.status = request.status

    db.commit()
    db.refresh(plan)

    logger.info(f"Updated test plan {plan.id}")
    return build_test_plan_response(plan, db)


@router.put("/{plan_id}/settings", response_model=TestPlanResponse)
async def update_test_plan_settings(
    plan_id: str,
    request: UpdateTestPlanSettingsRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Update a test plan's default run settings."""
    plan = get_test_plan_or_404(db, plan_id, current_user.organization_id)

    if request.default_run_type is not None:
        plan.default_run_type = request.default_run_type
    if request.browser_type is not None:
        plan.browser_type = request.browser_type
    if request.resolution_width is not None:
        plan.resolution_width = request.resolution_width
    if request.resolution_height is not None:
        plan.resolution_height = request.resolution_height
    if request.headless is not None:
        plan.headless = request.headless
    if request.screenshots_enabled is not None:
        plan.screenshots_enabled = request.screenshots_enabled
    if request.recording_enabled is not None:
        plan.recording_enabled = request.recording_enabled
    if request.network_recording_enabled is not None:
        plan.network_recording_enabled = request.network_recording_enabled
    if request.performance_metrics_enabled is not None:
        plan.performance_metrics_enabled = request.performance_metrics_enabled

    db.commit()
    db.refresh(plan)

    logger.info(f"Updated test plan settings for {plan.id}")
    return build_test_plan_response(plan, db)


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_test_plan(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Delete a test plan and all related data."""
    plan = get_test_plan_or_404(db, plan_id, current_user.organization_id)

    db.delete(plan)
    db.commit()

    logger.info(f"Deleted test plan {plan_id}")
    return None


# ============================================
# Test Case Management Endpoints
# ============================================

@router.post("/{plan_id}/test-cases", status_code=status.HTTP_201_CREATED)
async def add_test_cases(
    plan_id: str,
    request: AddTestCasesRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Add test cases to a test plan."""
    plan = get_test_plan_or_404(db, plan_id, current_user.organization_id)

    # Get current max order
    max_order = db.query(TestPlanTestCase).filter(
        TestPlanTestCase.test_plan_id == plan.id
    ).count()

    added = []
    for i, session_id in enumerate(request.test_session_ids):
        # Verify session exists and belongs to org
        session = db.query(TestSession).filter(
            TestSession.id == session_id,
            TestSession.organization_id == current_user.organization_id
        ).first()

        if not session:
            continue

        # Check if already added
        existing = db.query(TestPlanTestCase).filter(
            TestPlanTestCase.test_plan_id == plan.id,
            TestPlanTestCase.test_session_id == session_id
        ).first()

        if existing:
            continue

        tc = TestPlanTestCase(
            test_plan_id=plan.id,
            test_session_id=session_id,
            order=max_order + i,
        )
        db.add(tc)
        added.append(session_id)

    db.commit()

    logger.info(f"Added {len(added)} test cases to plan {plan.id}")
    return {"added": added, "count": len(added)}


@router.delete("/{plan_id}/test-cases/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_test_case(
    plan_id: str,
    session_id: str,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Remove a test case from a test plan."""
    plan = get_test_plan_or_404(db, plan_id, current_user.organization_id)

    tc = db.query(TestPlanTestCase).filter(
        TestPlanTestCase.test_plan_id == plan.id,
        TestPlanTestCase.test_session_id == session_id
    ).first()

    if not tc:
        raise HTTPException(status_code=404, detail="Test case not found in plan")

    db.delete(tc)
    db.commit()

    logger.info(f"Removed test case {session_id} from plan {plan.id}")
    return None


@router.put("/{plan_id}/test-cases/reorder")
async def reorder_test_cases(
    plan_id: str,
    request: ReorderTestCasesRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Reorder test cases in a test plan."""
    plan = get_test_plan_or_404(db, plan_id, current_user.organization_id)

    for item in request.test_case_orders:
        session_id = item.get("test_session_id")
        order = item.get("order")

        if session_id is None or order is None:
            continue

        tc = db.query(TestPlanTestCase).filter(
            TestPlanTestCase.test_plan_id == plan.id,
            TestPlanTestCase.test_session_id == session_id
        ).first()

        if tc:
            tc.order = order

    db.commit()

    logger.info(f"Reordered test cases in plan {plan.id}")
    return {"success": True}


# ============================================
# Test Plan Execution Endpoints
# ============================================

@router.post("/{plan_id}/run", response_model=StartTestPlanRunResponse)
async def run_test_plan(
    plan_id: str,
    request: RunTestPlanRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Execute a test plan."""
    plan = get_test_plan_or_404(db, plan_id, current_user.organization_id)

    # Get test cases
    test_cases = db.query(TestPlanTestCase).filter(
        TestPlanTestCase.test_plan_id == plan.id
    ).order_by(TestPlanTestCase.order).all()

    if not test_cases:
        raise HTTPException(status_code=400, detail="Test plan has no test cases")

    # Create run with config (use plan defaults, override with request if provided)
    run = TestPlanRun(
        test_plan_id=plan.id,
        user_id=current_user.id,
        run_type=request.run_type,
        browser_type=request.browser_type or plan.browser_type,
        resolution_width=request.resolution_width or plan.resolution_width,
        resolution_height=request.resolution_height or plan.resolution_height,
        headless=request.headless if request.headless is not None else plan.headless,
        screenshots_enabled=request.screenshots_enabled if request.screenshots_enabled is not None else plan.screenshots_enabled,
        recording_enabled=request.recording_enabled if request.recording_enabled is not None else plan.recording_enabled,
        network_recording_enabled=request.network_recording_enabled if request.network_recording_enabled is not None else plan.network_recording_enabled,
        performance_metrics_enabled=request.performance_metrics_enabled if request.performance_metrics_enabled is not None else plan.performance_metrics_enabled,
        total_test_cases=len(test_cases),
    )
    db.add(run)
    db.flush()  # Get the run ID

    # Create run results for each test case
    for tc in test_cases:
        result = TestPlanRunResult(
            test_plan_run_id=run.id,
            test_session_id=tc.test_session_id,
            order=tc.order,
        )
        db.add(result)

    db.commit()
    db.refresh(run)

    # Dispatch Celery task
    from app.tasks.test_plan_runs import execute_test_plan_run
    task = execute_test_plan_run.delay(run.id)

    run.celery_task_id = task.id
    run.status = "queued"
    db.commit()

    logger.info(f"Started test plan run {run.id} for plan {plan.id}")
    return StartTestPlanRunResponse(
        run_id=run.id,
        status="queued",
        celery_task_id=task.id,
    )


@router.get("/{plan_id}/runs", response_model=list[TestPlanRunResponse])
async def list_test_plan_runs(
    plan_id: str,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """List all runs for a test plan."""
    plan = get_test_plan_or_404(db, plan_id, current_user.organization_id)

    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    offset = (page - 1) * page_size

    runs = db.query(TestPlanRun).filter(
        TestPlanRun.test_plan_id == plan.id
    ).order_by(TestPlanRun.created_at.desc()).offset(offset).limit(page_size).all()

    return [build_run_response(r) for r in runs]


# Separate router for run details (not under plan)
run_router = APIRouter(prefix="/api/test-plan-runs", tags=["test-plan-runs"])


@run_router.get("/{run_id}", response_model=TestPlanRunDetailResponse)
async def get_test_plan_run(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Get a test plan run with its results."""
    run = db.query(TestPlanRun).filter(
        TestPlanRun.id == run_id
    ).first()

    if not run:
        raise HTTPException(status_code=404, detail="Test plan run not found")

    # Verify org access via the test plan
    plan = db.query(TestPlan).filter(
        TestPlan.id == run.test_plan_id,
        TestPlan.organization_id == current_user.organization_id
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail="Test plan run not found")

    response = build_run_response(run)
    response["results"] = [build_run_result_response(r) for r in run.results]

    return response


@run_router.post("/{run_id}/cancel")
async def cancel_test_plan_run(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Cancel a running test plan run."""
    run = db.query(TestPlanRun).filter(
        TestPlanRun.id == run_id
    ).first()

    if not run:
        raise HTTPException(status_code=404, detail="Test plan run not found")

    # Verify org access
    plan = db.query(TestPlan).filter(
        TestPlan.id == run.test_plan_id,
        TestPlan.organization_id == current_user.organization_id
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail="Test plan run not found")

    if run.status not in ["pending", "queued", "running"]:
        raise HTTPException(status_code=400, detail="Run cannot be cancelled in current state")

    # Revoke Celery task if exists
    if run.celery_task_id:
        from app.celery_app import celery_app
        celery_app.control.revoke(run.celery_task_id, terminate=True)

    run.status = "cancelled"
    run.completed_at = datetime.utcnow()
    db.commit()

    logger.info(f"Cancelled test plan run {run_id}")
    return {"success": True, "run_id": run_id}


# ============================================
# Schedule Management Endpoints
# ============================================

@router.post("/{plan_id}/schedules", response_model=TestPlanScheduleResponse, status_code=status.HTTP_201_CREATED)
async def create_schedule(
    plan_id: str,
    request: CreateScheduleRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Create a schedule for a test plan."""
    plan = get_test_plan_or_404(db, plan_id, current_user.organization_id)

    # Validate schedule type
    if request.schedule_type == "one_time" and not request.one_time_at:
        raise HTTPException(status_code=400, detail="one_time_at is required for one-time schedules")
    if request.schedule_type == "recurring" and not request.cron_expression:
        raise HTTPException(status_code=400, detail="cron_expression is required for recurring schedules")

    schedule = TestPlanSchedule(
        test_plan_id=plan.id,
        user_id=current_user.id,
        name=request.name,
        schedule_type=request.schedule_type,
        run_type=request.run_type,
        one_time_at=request.one_time_at,
        cron_expression=request.cron_expression,
        timezone=request.timezone,
    )

    # Calculate next_run_at
    if request.schedule_type == "one_time":
        schedule.next_run_at = request.one_time_at
    else:
        # For recurring, calculate from cron expression
        try:
            from croniter import croniter
            cron = croniter(request.cron_expression, datetime.utcnow())
            schedule.next_run_at = cron.get_next(datetime)
        except Exception:
            # If croniter not available or invalid expression, leave as None
            pass

    db.add(schedule)
    db.commit()
    db.refresh(schedule)

    logger.info(f"Created schedule {schedule.id} for plan {plan.id}")
    return build_schedule_response(schedule)


@router.get("/{plan_id}/schedules", response_model=list[TestPlanScheduleResponse])
async def list_schedules(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """List all schedules for a test plan."""
    plan = get_test_plan_or_404(db, plan_id, current_user.organization_id)

    schedules = db.query(TestPlanSchedule).filter(
        TestPlanSchedule.test_plan_id == plan.id
    ).all()

    return [build_schedule_response(s) for s in schedules]


# Separate router for schedule management (not under plan)
schedule_router = APIRouter(prefix="/api/test-plan-schedules", tags=["test-plan-schedules"])


@schedule_router.get("/{schedule_id}", response_model=TestPlanScheduleResponse)
async def get_schedule(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Get a schedule by ID."""
    schedule = db.query(TestPlanSchedule).filter(
        TestPlanSchedule.id == schedule_id
    ).first()

    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # Verify org access
    plan = db.query(TestPlan).filter(
        TestPlan.id == schedule.test_plan_id,
        TestPlan.organization_id == current_user.organization_id
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail="Schedule not found")

    return build_schedule_response(schedule)


@schedule_router.put("/{schedule_id}", response_model=TestPlanScheduleResponse)
async def update_schedule(
    schedule_id: str,
    request: UpdateScheduleRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Update a schedule."""
    schedule = db.query(TestPlanSchedule).filter(
        TestPlanSchedule.id == schedule_id
    ).first()

    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # Verify org access
    plan = db.query(TestPlan).filter(
        TestPlan.id == schedule.test_plan_id,
        TestPlan.organization_id == current_user.organization_id
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if request.name is not None:
        schedule.name = request.name
    if request.schedule_type is not None:
        schedule.schedule_type = request.schedule_type
    if request.run_type is not None:
        schedule.run_type = request.run_type
    if request.one_time_at is not None:
        schedule.one_time_at = request.one_time_at
    if request.cron_expression is not None:
        schedule.cron_expression = request.cron_expression
    if request.timezone is not None:
        schedule.timezone = request.timezone
    if request.is_active is not None:
        schedule.is_active = request.is_active

    # Recalculate next_run_at
    if schedule.schedule_type == "one_time":
        schedule.next_run_at = schedule.one_time_at
    elif schedule.cron_expression:
        try:
            from croniter import croniter
            cron = croniter(schedule.cron_expression, datetime.utcnow())
            schedule.next_run_at = cron.get_next(datetime)
        except Exception:
            pass

    db.commit()
    db.refresh(schedule)

    logger.info(f"Updated schedule {schedule_id}")
    return build_schedule_response(schedule)


@schedule_router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Delete a schedule."""
    schedule = db.query(TestPlanSchedule).filter(
        TestPlanSchedule.id == schedule_id
    ).first()

    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # Verify org access
    plan = db.query(TestPlan).filter(
        TestPlan.id == schedule.test_plan_id,
        TestPlan.organization_id == current_user.organization_id
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail="Schedule not found")

    db.delete(schedule)
    db.commit()

    logger.info(f"Deleted schedule {schedule_id}")
    return None


@schedule_router.post("/{schedule_id}/toggle", response_model=TestPlanScheduleResponse)
async def toggle_schedule(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Toggle a schedule's active state."""
    schedule = db.query(TestPlanSchedule).filter(
        TestPlanSchedule.id == schedule_id
    ).first()

    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # Verify org access
    plan = db.query(TestPlan).filter(
        TestPlan.id == schedule.test_plan_id,
        TestPlan.organization_id == current_user.organization_id
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail="Schedule not found")

    schedule.is_active = not schedule.is_active
    db.commit()
    db.refresh(schedule)

    logger.info(f"Toggled schedule {schedule_id} to {schedule.is_active}")
    return build_schedule_response(schedule)
