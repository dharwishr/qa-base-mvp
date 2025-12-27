from celery import Celery

from app.config import settings

celery_app = Celery(
	"qa_base",
	broker=settings.CELERY_BROKER_URL,
	backend=settings.CELERY_RESULT_BACKEND,
	include=["app.tasks.analysis", "app.tasks.discovery", "app.tasks.benchmark"],
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
