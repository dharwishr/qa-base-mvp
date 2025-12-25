import logging
from typing import Callable

from sqlalchemy.orm import Session


class SessionLogHandler(logging.Handler):
	"""Custom log handler that captures logs and stores them in database for a specific session."""

	def __init__(self, db_session_factory: Callable[[], Session], test_session_id: str):
		super().__init__()
		self.db_session_factory = db_session_factory
		self.test_session_id = test_session_id

	def emit(self, record: logging.LogRecord) -> None:
		"""Store log record in database."""
		from app.models import ExecutionLog

		try:
			db = self.db_session_factory()
			try:
				log_entry = ExecutionLog(
					session_id=self.test_session_id,
					level=record.levelname,
					message=self.format(record),
					source=record.name,
				)
				db.add(log_entry)
				db.commit()
			finally:
				db.close()
		except Exception:
			# Don't fail on logging errors - silently ignore
			pass
