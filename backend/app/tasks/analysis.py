import logging

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import TestSession
from app.utils.log_handler import SessionLogHandler

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="run_test_analysis")
def run_test_analysis(self, session_id: str) -> dict:
	"""Execute test analysis in isolated Celery worker.

	Args:
		session_id: The test session ID to execute.

	Returns:
		Dict with execution results.
	"""
	from app.services.browser_service import execute_test_sync

	db = SessionLocal()
	log_handler = None
	browser_use_logger = None
	app_logger = None

	try:
		# Get session
		session = db.query(TestSession).filter(TestSession.id == session_id).first()
		if not session:
			raise ValueError(f"Session {session_id} not found")
		if not session.plan:
			raise ValueError(f"Session {session_id} has no plan")

		# Setup session-specific logging
		log_handler = SessionLogHandler(SessionLocal, session_id)
		log_handler.setLevel(logging.DEBUG)
		log_handler.setFormatter(
			logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
		)

		# Add handler to browser_use loggers to capture all browser-use logs
		browser_use_logger = logging.getLogger("browser_use")
		browser_use_logger.addHandler(log_handler)
		browser_use_logger.setLevel(logging.DEBUG)

		# Also capture app logs
		app_logger = logging.getLogger("app")
		app_logger.addHandler(log_handler)
		app_logger.setLevel(logging.DEBUG)

		try:
			# Update status
			session.status = "running"
			session.celery_task_id = self.request.id
			db.commit()

			logger.info(f"Starting test execution for session {session_id}")

			# Execute test (sync version for Celery)
			result = execute_test_sync(db, session, session.plan)

			logger.info(f"Test execution completed for session {session_id}")
			return result

		finally:
			# Remove handlers
			if browser_use_logger and log_handler:
				browser_use_logger.removeHandler(log_handler)
			if app_logger and log_handler:
				app_logger.removeHandler(log_handler)

	except Exception as e:
		logger.error(f"Task failed for session {session_id}: {e}")
		try:
			session = db.query(TestSession).filter(TestSession.id == session_id).first()
			if session:
				session.status = "failed"
				db.commit()
		except Exception:
			pass
		raise
	finally:
		db.close()
