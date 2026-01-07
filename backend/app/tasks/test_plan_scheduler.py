"""
Celery Beat task for checking and triggering scheduled test plan runs.

This task runs every minute and:
1. Queries active schedules where next_run_at <= now
2. Creates TestPlanRun for each due schedule
3. Dispatches execute_test_plan_run task
4. Updates last_run_at and calculates next_run_at
"""

import logging
from datetime import datetime

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import (
    TestPlan,
    TestPlanRun,
    TestPlanRunResult,
    TestPlanSchedule,
    TestPlanTestCase,
)

logger = logging.getLogger(__name__)


def calculate_next_run(schedule: TestPlanSchedule) -> datetime | None:
    """Calculate the next run time for a schedule."""
    if schedule.schedule_type == "one_time":
        # One-time schedules don't repeat
        return None
    elif schedule.schedule_type == "recurring" and schedule.cron_expression:
        try:
            from croniter import croniter
            cron = croniter(schedule.cron_expression, datetime.utcnow())
            return cron.get_next(datetime)
        except ImportError:
            logger.warning("croniter not installed, cannot calculate next run for recurring schedule")
            return None
        except Exception as e:
            logger.error(f"Error calculating next run for schedule {schedule.id}: {e}")
            return None
    return None


@celery_app.task(name="check_test_plan_schedules")
def check_test_plan_schedules() -> dict:
    """Check and trigger due test plan schedules.

    Returns:
        Dict with count of triggered schedules.
    """
    db = SessionLocal()
    triggered = 0
    errors = 0

    try:
        now = datetime.utcnow()

        # Find active schedules that are due
        due_schedules = db.query(TestPlanSchedule).filter(
            TestPlanSchedule.is_active == True,
            TestPlanSchedule.next_run_at <= now
        ).all()

        logger.info(f"Found {len(due_schedules)} due schedules to trigger")

        for schedule in due_schedules:
            try:
                # Get the test plan
                plan = db.query(TestPlan).filter(
                    TestPlan.id == schedule.test_plan_id
                ).first()

                if not plan:
                    logger.warning(f"Test plan not found for schedule {schedule.id}")
                    continue

                # Get test cases
                test_cases = db.query(TestPlanTestCase).filter(
                    TestPlanTestCase.test_plan_id == plan.id
                ).order_by(TestPlanTestCase.order).all()

                if not test_cases:
                    logger.warning(f"No test cases for plan {plan.id}, skipping schedule {schedule.id}")
                    continue

                # Create the run
                run = TestPlanRun(
                    test_plan_id=plan.id,
                    user_id=schedule.user_id,
                    run_type=schedule.run_type,
                    browser_type=plan.browser_type,
                    resolution_width=plan.resolution_width,
                    resolution_height=plan.resolution_height,
                    headless=plan.headless,
                    screenshots_enabled=plan.screenshots_enabled,
                    recording_enabled=plan.recording_enabled,
                    network_recording_enabled=plan.network_recording_enabled,
                    performance_metrics_enabled=plan.performance_metrics_enabled,
                    total_test_cases=len(test_cases),
                )
                db.add(run)
                db.flush()

                # Create run results
                for tc in test_cases:
                    result = TestPlanRunResult(
                        test_plan_run_id=run.id,
                        test_session_id=tc.test_session_id,
                        order=tc.order,
                    )
                    db.add(result)

                db.commit()
                db.refresh(run)

                # Dispatch the execution task
                from app.tasks.test_plan_runs import execute_test_plan_run
                task = execute_test_plan_run.delay(run.id)

                run.celery_task_id = task.id
                run.status = "queued"

                # Update schedule
                schedule.last_run_at = now
                schedule.next_run_at = calculate_next_run(schedule)

                # If one-time and no next run, deactivate
                if schedule.schedule_type == "one_time":
                    schedule.is_active = False

                db.commit()

                logger.info(f"Triggered run {run.id} for schedule {schedule.id}")
                triggered += 1

            except Exception as e:
                logger.error(f"Error triggering schedule {schedule.id}: {e}")
                errors += 1
                db.rollback()

        return {
            "status": "completed",
            "triggered": triggered,
            "errors": errors,
        }

    except Exception as e:
        logger.error(f"Error checking schedules: {e}")
        return {"status": "failed", "error": str(e)}

    finally:
        db.close()
