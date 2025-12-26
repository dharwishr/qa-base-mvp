"""
Celery task for module discovery.
"""
import logging

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import DiscoverySession

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="run_module_discovery")
def run_module_discovery(self, session_id: str) -> dict:
	"""Execute module discovery in isolated Celery worker.

	Args:
		session_id: The discovery session ID to execute.

	Returns:
		Dict with execution results.
	"""
	from app.services.discovery_service import execute_discovery_sync

	db = SessionLocal()

	try:
		# Get session
		session = db.query(DiscoverySession).filter(DiscoverySession.id == session_id).first()
		if not session:
			raise ValueError(f"Discovery session {session_id} not found")

		# Update celery task ID
		session.celery_task_id = self.request.id
		db.commit()

		logger.info(f"Starting module discovery for session {session_id}, URL: {session.url}")

		# Execute discovery
		result = execute_discovery_sync(db, session)

		logger.info(f"Module discovery completed for session {session_id}")
		return result

	except Exception as e:
		logger.error(f"Discovery task failed for session {session_id}: {e}")
		try:
			session = db.query(DiscoverySession).filter(DiscoverySession.id == session_id).first()
			if session:
				session.status = "failed"
				session.error = str(e)
				db.commit()
		except Exception:
			pass
		raise
	finally:
		db.close()
