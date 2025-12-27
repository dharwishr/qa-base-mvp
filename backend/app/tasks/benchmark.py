"""
Celery task for benchmark model runs.
"""
import logging
from datetime import datetime

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import BenchmarkModelRun, BenchmarkSession, TestPlan, TestSession
from app.utils.log_handler import SessionLogHandler

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="run_benchmark_model")
def run_benchmark_model(self, benchmark_session_id: str, model_run_id: str) -> dict:
	"""Execute a single model run within a benchmark.

	This task creates a test session, generates a plan, and executes it
	for a specific LLM model as part of a benchmark comparison.

	Args:
		benchmark_session_id: The benchmark session ID.
		model_run_id: The specific model run ID.

	Returns:
		Dict with execution results.
	"""
	from app.services.browser_service import execute_test_sync
	from app.services.plan_service import generate_plan_sync

	db = SessionLocal()
	log_handler = None
	browser_use_logger = None
	app_logger = None

	try:
		# Get benchmark session and model run
		benchmark_session = db.query(BenchmarkSession).filter(
			BenchmarkSession.id == benchmark_session_id
		).first()
		if not benchmark_session:
			raise ValueError(f"Benchmark session {benchmark_session_id} not found")

		model_run = db.query(BenchmarkModelRun).filter(
			BenchmarkModelRun.id == model_run_id
		).first()
		if not model_run:
			raise ValueError(f"Model run {model_run_id} not found")

		# Update model run status
		model_run.status = "running"
		model_run.celery_task_id = self.request.id
		model_run.started_at = datetime.utcnow()
		db.commit()

		logger.info(f"Starting benchmark model run {model_run_id} with model {model_run.llm_model}")

		# Create a test session for this model run
		test_session = TestSession(
			prompt=benchmark_session.prompt,
			title=f"Benchmark: {benchmark_session.title or 'Untitled'} - {model_run.llm_model}",
			llm_model=model_run.llm_model,
			headless=benchmark_session.headless,
			status="pending_plan"
		)
		db.add(test_session)
		db.commit()
		db.refresh(test_session)

		# Link model run to test session
		model_run.test_session_id = test_session.id
		db.commit()

		# Setup session-specific logging
		log_handler = SessionLogHandler(SessionLocal, test_session.id)
		log_handler.setLevel(logging.DEBUG)
		log_handler.setFormatter(
			logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
		)

		browser_use_logger = logging.getLogger("browser_use")
		browser_use_logger.addHandler(log_handler)
		browser_use_logger.setLevel(logging.DEBUG)

		app_logger = logging.getLogger("app")
		app_logger.addHandler(log_handler)
		app_logger.setLevel(logging.DEBUG)

		try:
			# Generate plan
			logger.info(f"Generating plan for model {model_run.llm_model}")
			plan = generate_plan_sync(db, test_session)
			db.refresh(test_session)

			if test_session.status != "plan_ready" or not test_session.plan:
				raise ValueError(f"Failed to generate plan for model {model_run.llm_model}")

			# Auto-approve plan for benchmark
			test_session.plan.approval_status = "approved"
			test_session.plan.approval_timestamp = datetime.utcnow()
			test_session.status = "approved"
			db.commit()

			# Execute test
			logger.info(f"Executing test for model {model_run.llm_model}")
			test_session.status = "running"
			test_session.celery_task_id = self.request.id
			db.commit()

			result = execute_test_sync(db, test_session, test_session.plan)

			# Update model run with results
			db.refresh(test_session)
			model_run.status = "completed"
			model_run.completed_at = datetime.utcnow()
			model_run.total_steps = len(test_session.steps)
			if model_run.started_at:
				model_run.duration_seconds = (
					model_run.completed_at - model_run.started_at
				).total_seconds()
			db.commit()

			logger.info(f"Benchmark model run {model_run_id} completed with {model_run.total_steps} steps")

			# Check if all model runs are complete
			_check_benchmark_completion(db, benchmark_session_id)

			return {
				"model_run_id": model_run_id,
				"test_session_id": test_session.id,
				"status": "completed",
				"total_steps": model_run.total_steps,
				"duration_seconds": model_run.duration_seconds,
			}

		finally:
			# Remove handlers
			if browser_use_logger and log_handler:
				browser_use_logger.removeHandler(log_handler)
			if app_logger and log_handler:
				app_logger.removeHandler(log_handler)

	except Exception as e:
		logger.error(f"Benchmark model run {model_run_id} failed: {e}")
		try:
			model_run = db.query(BenchmarkModelRun).filter(
				BenchmarkModelRun.id == model_run_id
			).first()
			if model_run:
				model_run.status = "failed"
				model_run.completed_at = datetime.utcnow()
				model_run.error = str(e)
				if model_run.started_at:
					model_run.duration_seconds = (
						model_run.completed_at - model_run.started_at
					).total_seconds()
				db.commit()

			# Update linked test session if exists
			if model_run and model_run.test_session_id:
				test_session = db.query(TestSession).filter(
					TestSession.id == model_run.test_session_id
				).first()
				if test_session:
					test_session.status = "failed"
					db.commit()

			# Check if all model runs are complete (even with failure)
			_check_benchmark_completion(db, benchmark_session_id)
		except Exception:
			pass
		raise
	finally:
		db.close()


def _check_benchmark_completion(db, benchmark_session_id: str) -> None:
	"""Check if all model runs are complete and update benchmark session status."""
	benchmark_session = db.query(BenchmarkSession).filter(
		BenchmarkSession.id == benchmark_session_id
	).first()
	if not benchmark_session:
		return

	model_runs = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.benchmark_session_id == benchmark_session_id
	).all()

	all_complete = all(run.status in ("completed", "failed") for run in model_runs)
	if all_complete:
		any_failed = any(run.status == "failed" for run in model_runs)
		benchmark_session.status = "completed" if not any_failed else "completed"
		db.commit()
		logger.info(f"Benchmark session {benchmark_session_id} completed")


def _check_planning_completion(db, benchmark_session_id: str) -> None:
	"""Check if all plan generations are complete and update benchmark session status."""
	benchmark_session = db.query(BenchmarkSession).filter(
		BenchmarkSession.id == benchmark_session_id
	).first()
	if not benchmark_session:
		return

	model_runs = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.benchmark_session_id == benchmark_session_id
	).all()

	all_plans_ready = all(run.status in ("plan_ready", "failed") for run in model_runs)
	if all_plans_ready:
		benchmark_session.status = "plan_ready"
		db.commit()
		logger.info(f"Benchmark session {benchmark_session_id} plans ready")


@celery_app.task(bind=True, name="benchmark_generate_plan")
def benchmark_generate_plan(self, benchmark_session_id: str, model_run_id: str) -> dict:
	"""Generate plan only for a model run (Plan mode).

	Args:
		benchmark_session_id: The benchmark session ID.
		model_run_id: The specific model run ID.

	Returns:
		Dict with plan generation results.
	"""
	from app.services.plan_service import generate_plan_sync

	db = SessionLocal()
	log_handler = None
	browser_use_logger = None
	app_logger = None

	try:
		benchmark_session = db.query(BenchmarkSession).filter(
			BenchmarkSession.id == benchmark_session_id
		).first()
		if not benchmark_session:
			raise ValueError(f"Benchmark session {benchmark_session_id} not found")

		model_run = db.query(BenchmarkModelRun).filter(
			BenchmarkModelRun.id == model_run_id
		).first()
		if not model_run:
			raise ValueError(f"Model run {model_run_id} not found")

		model_run.started_at = datetime.utcnow()
		model_run.celery_task_id = self.request.id
		db.commit()

		logger.info(f"Generating plan for model {model_run.llm_model}")

		# Create test session if not exists
		if not model_run.test_session_id:
			test_session = TestSession(
				prompt=benchmark_session.prompt,
				title=f"Benchmark: {benchmark_session.title or 'Untitled'} - {model_run.llm_model}",
				llm_model=model_run.llm_model,
				headless=benchmark_session.headless,
				status="pending_plan"
			)
			db.add(test_session)
			db.commit()
			db.refresh(test_session)
			model_run.test_session_id = test_session.id
			db.commit()
		else:
			test_session = db.query(TestSession).filter(
				TestSession.id == model_run.test_session_id
			).first()

		# Setup logging
		log_handler = SessionLogHandler(SessionLocal, test_session.id)
		log_handler.setLevel(logging.DEBUG)
		log_handler.setFormatter(
			logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
		)
		browser_use_logger = logging.getLogger("browser_use")
		browser_use_logger.addHandler(log_handler)
		app_logger = logging.getLogger("app")
		app_logger.addHandler(log_handler)

		try:
			# Generate plan
			plan = generate_plan_sync(db, test_session)
			db.refresh(test_session)

			if test_session.status != "plan_ready" or not test_session.plan:
				raise ValueError(f"Failed to generate plan for model {model_run.llm_model}")

			model_run.status = "plan_ready"
			db.commit()

			_check_planning_completion(db, benchmark_session_id)

			logger.info(f"Plan generated for model run {model_run_id}")

			return {
				"model_run_id": model_run_id,
				"test_session_id": test_session.id,
				"status": "plan_ready",
			}

		finally:
			if browser_use_logger and log_handler:
				browser_use_logger.removeHandler(log_handler)
			if app_logger and log_handler:
				app_logger.removeHandler(log_handler)

	except Exception as e:
		logger.error(f"Plan generation failed for model run {model_run_id}: {e}")
		try:
			model_run = db.query(BenchmarkModelRun).filter(
				BenchmarkModelRun.id == model_run_id
			).first()
			if model_run:
				model_run.status = "failed"
				model_run.error = str(e)
				db.commit()
			_check_planning_completion(db, benchmark_session_id)
		except Exception:
			pass
		raise
	finally:
		db.close()


@celery_app.task(bind=True, name="benchmark_execute_model")
def benchmark_execute_model(self, benchmark_session_id: str, model_run_id: str) -> dict:
	"""Execute an approved plan for a model run (Plan mode).

	Args:
		benchmark_session_id: The benchmark session ID.
		model_run_id: The specific model run ID.

	Returns:
		Dict with execution results.
	"""
	from app.services.browser_service import execute_test_sync

	db = SessionLocal()
	log_handler = None
	browser_use_logger = None
	app_logger = None

	try:
		model_run = db.query(BenchmarkModelRun).filter(
			BenchmarkModelRun.id == model_run_id
		).first()
		if not model_run:
			raise ValueError(f"Model run {model_run_id} not found")

		if not model_run.test_session_id:
			raise ValueError("No test session for this model run")

		test_session = db.query(TestSession).filter(
			TestSession.id == model_run.test_session_id
		).first()
		if not test_session or not test_session.plan:
			raise ValueError("Test session or plan not found")

		if test_session.plan.approval_status != "approved":
			raise ValueError("Plan not approved")

		model_run.status = "running"
		model_run.started_at = datetime.utcnow()
		model_run.celery_task_id = self.request.id
		test_session.status = "running"
		test_session.celery_task_id = self.request.id
		db.commit()

		logger.info(f"Executing approved plan for model {model_run.llm_model}")

		# Setup logging
		log_handler = SessionLogHandler(SessionLocal, test_session.id)
		log_handler.setLevel(logging.DEBUG)
		log_handler.setFormatter(
			logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
		)
		browser_use_logger = logging.getLogger("browser_use")
		browser_use_logger.addHandler(log_handler)
		app_logger = logging.getLogger("app")
		app_logger.addHandler(log_handler)

		try:
			result = execute_test_sync(db, test_session, test_session.plan)

			db.refresh(test_session)
			model_run.status = "completed"
			model_run.completed_at = datetime.utcnow()
			model_run.total_steps = len(test_session.steps)
			if model_run.started_at:
				model_run.duration_seconds = (
					model_run.completed_at - model_run.started_at
				).total_seconds()
			db.commit()

			_check_benchmark_completion(db, benchmark_session_id)

			logger.info(f"Execution completed for model run {model_run_id}")

			return {
				"model_run_id": model_run_id,
				"test_session_id": test_session.id,
				"status": "completed",
				"total_steps": model_run.total_steps,
				"duration_seconds": model_run.duration_seconds,
			}

		finally:
			if browser_use_logger and log_handler:
				browser_use_logger.removeHandler(log_handler)
			if app_logger and log_handler:
				app_logger.removeHandler(log_handler)

	except Exception as e:
		logger.error(f"Execution failed for model run {model_run_id}: {e}")
		try:
			model_run = db.query(BenchmarkModelRun).filter(
				BenchmarkModelRun.id == model_run_id
			).first()
			if model_run:
				model_run.status = "failed"
				model_run.completed_at = datetime.utcnow()
				model_run.error = str(e)
				if model_run.started_at:
					model_run.duration_seconds = (
						model_run.completed_at - model_run.started_at
					).total_seconds()
				db.commit()

			if model_run and model_run.test_session_id:
				test_session = db.query(TestSession).filter(
					TestSession.id == model_run.test_session_id
				).first()
				if test_session:
					test_session.status = "failed"
					db.commit()

			_check_benchmark_completion(db, benchmark_session_id)
		except Exception:
			pass
		raise
	finally:
		db.close()
