from celery import Celery

from app.config import settings

celery_app = Celery(
	"qa_base",
	broker=settings.CELERY_BROKER_URL,
	backend=settings.CELERY_RESULT_BACKEND,
	include=[
		"app.tasks.analysis",
		"app.tasks.discovery",
		"app.tasks.benchmark",
		"app.tasks.test_runs",
		"app.tasks.plan_generation",
		"app.tasks.plan_execution",
		"app.tasks.act_mode",
		"app.tasks.run_till_end",
		"app.tasks.session_runs",
		"app.tasks.test_plan_runs",
		"app.tasks.test_plan_scheduler",
	],
)

celery_app.conf.update(
	task_serializer="json",
	accept_content=["json"],
	result_serializer="json",
	timezone="UTC",
	task_track_started=True,
	task_time_limit=600,  # 10 minute timeout
	worker_concurrency=4,  # Allow multiple concurrent tests
)

# Celery Beat schedule for periodic tasks
celery_app.conf.beat_schedule = {
	"check-test-plan-schedules": {
		"task": "check_test_plan_schedules",
		"schedule": 60.0,  # Every minute
	},
}
