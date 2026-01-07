"""
Benchmark API router for comparing LLM models on test case analysis.
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import AuthenticatedUser, get_current_user
from app.models import BenchmarkModelRun, BenchmarkSession, TestSession, TestStep
from app.schemas import (
	BenchmarkModelRunResponse,
	BenchmarkSessionListResponse,
	BenchmarkSessionResponse,
	CreateBenchmarkRequest,
	StartBenchmarkResponse,
	TestStepResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/benchmark", tags=["benchmark"])


def generate_title_from_prompt(prompt: str) -> str:
	"""Generate a short title from the test prompt."""
	first_line = prompt.split('\n')[0].strip()
	if len(first_line) > 50:
		truncated = first_line[:50]
		last_space = truncated.rfind(' ')
		if last_space > 30:
			return truncated[:last_space] + '...'
		return truncated + '...'
	return first_line


@router.get("/sessions", response_model=list[BenchmarkSessionListResponse])
async def list_benchmark_sessions(
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""List all benchmark sessions ordered by creation date (newest first)."""
	from sqlalchemy import func

	sessions = db.query(BenchmarkSession).filter(
		BenchmarkSession.organization_id == current_user.organization_id
	).order_by(
		BenchmarkSession.created_at.desc()
	).all()

	result = []
	for session in sessions:
		model_runs = db.query(BenchmarkModelRun).filter(
			BenchmarkModelRun.benchmark_session_id == session.id
		).all()
		completed_count = sum(1 for run in model_runs if run.status == "completed")

		result.append(BenchmarkSessionListResponse(
			id=session.id,
			prompt=session.prompt,
			title=session.title,
			selected_models=session.selected_models,
			status=session.status,
			mode=session.mode,
			created_at=session.created_at,
			updated_at=session.updated_at,
			model_run_count=len(model_runs),
			completed_count=completed_count,
		))
	return result


@router.post("/sessions", response_model=BenchmarkSessionResponse)
async def create_benchmark_session(
	request: CreateBenchmarkRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Create a new benchmark session with selected models."""
	if len(request.models) > 3:
		raise HTTPException(status_code=400, detail="Maximum 3 models allowed")

	if len(request.models) < 1:
		raise HTTPException(status_code=400, detail="At least 1 model required")

	# Generate title from prompt
	title = generate_title_from_prompt(request.prompt)

	# Validate mode
	if request.mode not in ("auto", "plan", "act"):
		raise HTTPException(status_code=400, detail="Invalid mode. Must be 'auto', 'plan', or 'act'")

	# Create benchmark session
	benchmark_session = BenchmarkSession(
		prompt=request.prompt,
		title=title,
		selected_models=request.models,
		headless=request.headless,
		mode=request.mode,
		status="pending",
		organization_id=current_user.organization_id,
		user_id=current_user.id,
	)
	db.add(benchmark_session)
	db.commit()
	db.refresh(benchmark_session)

	# Create model runs for each selected model
	for model in request.models:
		model_run = BenchmarkModelRun(
			benchmark_session_id=benchmark_session.id,
			llm_model=model,
			status="pending"
		)
		db.add(model_run)
	db.commit()
	db.refresh(benchmark_session)

	return benchmark_session


@router.get("/sessions/{benchmark_id}", response_model=BenchmarkSessionResponse)
async def get_benchmark_session(
	benchmark_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get a benchmark session by ID with all model runs."""
	# Expire all to ensure we get fresh data from DB
	db.expire_all()
	
	benchmark_session = db.query(BenchmarkSession).options(
		joinedload(BenchmarkSession.model_runs)
	).filter(
		BenchmarkSession.id == benchmark_id
	).first()
	if not benchmark_session:
		raise HTTPException(status_code=404, detail="Benchmark session not found")

	return benchmark_session


@router.delete("/sessions/{benchmark_id}", status_code=204)
async def delete_benchmark_session(
	benchmark_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Delete a benchmark session and all related data."""
	from app.models import ExecutionLog, StepAction
	from sqlalchemy import select

	benchmark_session = db.query(BenchmarkSession).filter(
		BenchmarkSession.id == benchmark_id
	).first()
	if not benchmark_session:
		raise HTTPException(status_code=404, detail="Benchmark session not found")

	# Get all model runs and their test sessions
	model_runs = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.benchmark_session_id == benchmark_id
	).all()

	# Delete related test sessions and their data
	for model_run in model_runs:
		if model_run.test_session_id:
			# Delete step actions
			step_ids_query = select(TestStep.id).where(
				TestStep.session_id == model_run.test_session_id
			).scalar_subquery()
			db.query(StepAction).filter(
				StepAction.step_id.in_(step_ids_query)
			).delete(synchronize_session=False)

			# Delete steps
			db.query(TestStep).filter(
				TestStep.session_id == model_run.test_session_id
			).delete(synchronize_session=False)

			# Delete execution logs
			db.query(ExecutionLog).filter(
				ExecutionLog.session_id == model_run.test_session_id
			).delete(synchronize_session=False)

			# Delete test session
			db.query(TestSession).filter(
				TestSession.id == model_run.test_session_id
			).delete(synchronize_session=False)

	# Delete model runs
	db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.benchmark_session_id == benchmark_id
	).delete(synchronize_session=False)

	# Delete benchmark session
	db.query(BenchmarkSession).filter(
		BenchmarkSession.id == benchmark_id
	).delete(synchronize_session=False)

	db.commit()


@router.post("/sessions/{benchmark_id}/start", response_model=StartBenchmarkResponse)
async def start_benchmark(
	benchmark_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Start all model runs for a benchmark session in parallel via Celery."""
	from app.tasks.benchmark import run_benchmark_model

	benchmark_session = db.query(BenchmarkSession).filter(
		BenchmarkSession.id == benchmark_id
	).first()
	if not benchmark_session:
		raise HTTPException(status_code=404, detail="Benchmark session not found")

	if benchmark_session.status not in ("pending", "completed", "failed"):
		raise HTTPException(
			status_code=400,
			detail=f"Cannot start benchmark in status: {benchmark_session.status}"
		)

	# Get all model runs
	model_runs = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.benchmark_session_id == benchmark_id
	).all()

	if not model_runs:
		raise HTTPException(status_code=400, detail="No model runs found for benchmark")

	# Queue Celery tasks for each model run
	task_ids = []
	for model_run in model_runs:
		# Reset status for re-runs
		model_run.status = "queued"
		model_run.started_at = None
		model_run.completed_at = None
		model_run.error = None
		model_run.total_steps = 0
		model_run.duration_seconds = 0.0

		# Queue task
		task = run_benchmark_model.delay(benchmark_id, model_run.id)
		model_run.celery_task_id = task.id
		task_ids.append(task.id)

	benchmark_session.status = "running"
	db.commit()

	logger.info(f"Started benchmark {benchmark_id} with {len(task_ids)} model runs")

	return StartBenchmarkResponse(
		benchmark_id=benchmark_id,
		status="running",
		task_ids=task_ids
	)


@router.post("/sessions/{benchmark_id}/stop")
async def stop_benchmark(
	benchmark_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Stop all running model runs for a benchmark session."""
	from app.celery_app import celery_app

	benchmark_session = db.query(BenchmarkSession).filter(
		BenchmarkSession.id == benchmark_id
	).first()
	if not benchmark_session:
		raise HTTPException(status_code=404, detail="Benchmark session not found")

	if benchmark_session.status != "running":
		raise HTTPException(
			status_code=400,
			detail=f"Cannot stop benchmark in status: {benchmark_session.status}"
		)

	# Revoke all running tasks
	model_runs = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.benchmark_session_id == benchmark_id,
		BenchmarkModelRun.status.in_(["queued", "running"])
	).all()

	stopped_count = 0
	for model_run in model_runs:
		if model_run.celery_task_id:
			try:
				celery_app.control.revoke(model_run.celery_task_id, terminate=True, signal="SIGTERM")
				stopped_count += 1
			except Exception as e:
				logger.error(f"Error revoking task {model_run.celery_task_id}: {e}")
		model_run.status = "failed"
		model_run.error = "Stopped by user"
		model_run.completed_at = datetime.utcnow()

	benchmark_session.status = "completed"
	db.commit()

	return {"status": "stopped", "stopped_count": stopped_count}


@router.get("/sessions/{benchmark_id}/runs/{model_run_id}", response_model=BenchmarkModelRunResponse)
async def get_model_run(
	benchmark_id: str,
	model_run_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get a specific model run by ID."""
	model_run = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.id == model_run_id,
		BenchmarkModelRun.benchmark_session_id == benchmark_id
	).first()
	if not model_run:
		raise HTTPException(status_code=404, detail="Model run not found")

	return model_run


@router.get("/sessions/{benchmark_id}/runs/{model_run_id}/steps", response_model=list[TestStepResponse])
async def get_model_run_steps(
	benchmark_id: str,
	model_run_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get all steps for a specific model run."""
	model_run = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.id == model_run_id,
		BenchmarkModelRun.benchmark_session_id == benchmark_id
	).first()
	if not model_run:
		raise HTTPException(status_code=404, detail="Model run not found")

	if not model_run.test_session_id:
		return []

	steps = db.query(TestStep).options(
		joinedload(TestStep.actions)
	).filter(
		TestStep.session_id == model_run.test_session_id
	).order_by(TestStep.step_number).all()

	return steps


# ============================================
# Plan Mode Endpoints
# ============================================

@router.post("/sessions/{benchmark_id}/start-plan", response_model=StartBenchmarkResponse)
async def start_benchmark_plan(
	benchmark_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Start plan generation for all models (Plan mode only)."""
	from app.tasks.benchmark import benchmark_generate_plan

	benchmark_session = db.query(BenchmarkSession).filter(
		BenchmarkSession.id == benchmark_id
	).first()
	if not benchmark_session:
		raise HTTPException(status_code=404, detail="Benchmark session not found")

	if benchmark_session.mode != "plan":
		raise HTTPException(status_code=400, detail="This endpoint is only for Plan mode benchmarks")

	if benchmark_session.status not in ("pending", "plan_ready", "completed", "failed"):
		raise HTTPException(
			status_code=400,
			detail=f"Cannot start planning in status: {benchmark_session.status}"
		)

	model_runs = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.benchmark_session_id == benchmark_id
	).all()

	if not model_runs:
		raise HTTPException(status_code=400, detail="No model runs found for benchmark")

	task_ids = []
	for model_run in model_runs:
		model_run.status = "planning"
		model_run.started_at = None
		model_run.completed_at = None
		model_run.error = None

		task = benchmark_generate_plan.delay(benchmark_id, model_run.id)
		model_run.celery_task_id = task.id
		task_ids.append(task.id)

	benchmark_session.status = "planning"
	db.commit()

	logger.info(f"Started plan generation for benchmark {benchmark_id}")

	return StartBenchmarkResponse(
		benchmark_id=benchmark_id,
		status="planning",
		task_ids=task_ids
	)


@router.post("/sessions/{benchmark_id}/runs/{model_run_id}/approve-plan")
async def approve_model_plan(
	benchmark_id: str,
	model_run_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Approve the generated plan for a model run."""
	model_run = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.id == model_run_id,
		BenchmarkModelRun.benchmark_session_id == benchmark_id
	).first()
	if not model_run:
		raise HTTPException(status_code=404, detail="Model run not found")

	if model_run.status != "plan_ready":
		raise HTTPException(status_code=400, detail=f"Cannot approve plan in status: {model_run.status}")

	if not model_run.test_session_id:
		raise HTTPException(status_code=400, detail="No test session for this model run")

	test_session = db.query(TestSession).filter(
		TestSession.id == model_run.test_session_id
	).first()
	if not test_session or not test_session.plan:
		raise HTTPException(status_code=400, detail="Plan not found")

	test_session.plan.approval_status = "approved"
	test_session.plan.approval_timestamp = datetime.utcnow()
	test_session.status = "approved"
	model_run.status = "approved"
	db.commit()

	return {"status": "approved", "model_run_id": model_run_id}


@router.post("/sessions/{benchmark_id}/runs/{model_run_id}/reject-plan")
async def reject_model_plan(
	benchmark_id: str,
	model_run_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Reject the generated plan for a model run."""
	model_run = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.id == model_run_id,
		BenchmarkModelRun.benchmark_session_id == benchmark_id
	).first()
	if not model_run:
		raise HTTPException(status_code=404, detail="Model run not found")

	if model_run.status != "plan_ready":
		raise HTTPException(status_code=400, detail=f"Cannot reject plan in status: {model_run.status}")

	model_run.status = "rejected"

	if model_run.test_session_id:
		test_session = db.query(TestSession).filter(
			TestSession.id == model_run.test_session_id
		).first()
		if test_session and test_session.plan:
			test_session.plan.approval_status = "rejected"
			test_session.status = "failed"

	db.commit()

	return {"status": "rejected", "model_run_id": model_run_id}


@router.post("/sessions/{benchmark_id}/execute-approved", response_model=StartBenchmarkResponse)
async def execute_approved_plans(
	benchmark_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Execute all approved model runs."""
	from app.tasks.benchmark import benchmark_execute_model

	benchmark_session = db.query(BenchmarkSession).filter(
		BenchmarkSession.id == benchmark_id
	).first()
	if not benchmark_session:
		raise HTTPException(status_code=404, detail="Benchmark session not found")

	approved_runs = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.benchmark_session_id == benchmark_id,
		BenchmarkModelRun.status == "approved"
	).all()

	if not approved_runs:
		raise HTTPException(status_code=400, detail="No approved runs to execute")

	task_ids = []
	for model_run in approved_runs:
		model_run.status = "queued"
		task = benchmark_execute_model.delay(benchmark_id, model_run.id)
		model_run.celery_task_id = task.id
		task_ids.append(task.id)

	benchmark_session.status = "running"
	db.commit()

	logger.info(f"Started execution of {len(approved_runs)} approved runs for benchmark {benchmark_id}")

	return StartBenchmarkResponse(
		benchmark_id=benchmark_id,
		status="running",
		task_ids=task_ids
	)


# ============================================
# Act Mode Endpoints
# ============================================

class ActRequest(BaseModel):
	"""Request body for act mode execution."""
	action: str
	previous_context: str | None = None


@router.post("/sessions/{benchmark_id}/start-act")
async def start_benchmark_act(
	benchmark_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Initialize act mode for a benchmark session - creates test sessions for each model."""
	benchmark_session = db.query(BenchmarkSession).filter(
		BenchmarkSession.id == benchmark_id
	).first()
	if not benchmark_session:
		raise HTTPException(status_code=404, detail="Benchmark session not found")

	if benchmark_session.mode != "act":
		raise HTTPException(status_code=400, detail="This endpoint is only for Act mode benchmarks")

	model_runs = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.benchmark_session_id == benchmark_id
	).all()

	for model_run in model_runs:
		if not model_run.test_session_id:
			test_session = TestSession(
				prompt=benchmark_session.prompt,
				title=f"Benchmark (Act): {benchmark_session.title or 'Untitled'} - {model_run.llm_model}",
				llm_model=model_run.llm_model,
				headless=benchmark_session.headless,
				status="running",
			)
			db.add(test_session)
			db.flush()
			model_run.test_session_id = test_session.id
			model_run.status = "running"

	benchmark_session.status = "running"
	db.commit()

	return {"status": "running", "benchmark_id": benchmark_id}


@router.post("/sessions/{benchmark_id}/runs/{model_run_id}/act")
async def act_on_model_run(
	benchmark_id: str,
	model_run_id: str,
	request: ActRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Execute a single action on a specific model run (Act mode)."""
	model_run = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.id == model_run_id,
		BenchmarkModelRun.benchmark_session_id == benchmark_id
	).first()
	if not model_run:
		raise HTTPException(status_code=404, detail="Model run not found")

	if not model_run.test_session_id:
		raise HTTPException(status_code=400, detail="No test session for this model run. Start act mode first.")

	test_session = db.query(TestSession).filter(
		TestSession.id == model_run.test_session_id
	).first()
	if not test_session:
		raise HTTPException(status_code=400, detail="Test session not found")

	# Execute single action
	from app.services.browser_service import execute_act_mode_sync

	result = execute_act_mode_sync(db, test_session, request.action, request.previous_context)

	# Update model run metrics
	db.refresh(test_session)
	model_run.total_steps = db.query(TestStep).filter(
		TestStep.session_id == test_session.id
	).count()
	db.commit()

	return result


@router.get("/sessions/{benchmark_id}/runs/{model_run_id}/plan")
async def get_model_run_plan(
	benchmark_id: str,
	model_run_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get the generated plan for a model run."""
	from app.schemas import AnalysisPlanResponse

	model_run = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.id == model_run_id,
		BenchmarkModelRun.benchmark_session_id == benchmark_id
	).first()
	if not model_run:
		raise HTTPException(status_code=404, detail="Model run not found")

	if not model_run.test_session_id:
		return None

	test_session = db.query(TestSession).filter(
		TestSession.id == model_run.test_session_id
	).first()
	if not test_session or not test_session.plan:
		return None

	return AnalysisPlanResponse.model_validate(test_session.plan)


# ============================================
# Per-Model Chat Endpoints
# ============================================

class ContinueModelRunRequest(BaseModel):
	"""Request body for continuing a model run with a new prompt."""
	prompt: str
	mode: str  # 'plan' or 'act'


@router.post("/sessions/{benchmark_id}/runs/{model_run_id}/continue", response_model=BenchmarkModelRunResponse)
async def continue_model_run(
	benchmark_id: str,
	model_run_id: str,
	request: ContinueModelRunRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Continue a model run with a new prompt (for per-model chat interaction)."""
	from app.services.plan_service import generate_plan
	from app.tasks.benchmark import benchmark_execute_model

	# Validate mode
	if request.mode not in ("plan", "act"):
		raise HTTPException(status_code=400, detail="Mode must be 'plan' or 'act'")

	# Get model run
	model_run = db.query(BenchmarkModelRun).filter(
		BenchmarkModelRun.id == model_run_id,
		BenchmarkModelRun.benchmark_session_id == benchmark_id
	).first()
	if not model_run:
		raise HTTPException(status_code=404, detail="Model run not found")

	# Check if model run has a test session
	if not model_run.test_session_id:
		raise HTTPException(status_code=400, detail="No test session for this model run")

	# Check status - only allow continuation from certain statuses
	allowed_statuses = ["completed", "failed", "stopped", "paused", "plan_ready", "approved", "rejected"]
	if model_run.status not in allowed_statuses:
		raise HTTPException(
			status_code=400,
			detail=f"Cannot continue model run in status: {model_run.status}"
		)

	test_session = db.query(TestSession).filter(
		TestSession.id == model_run.test_session_id
	).first()
	if not test_session:
		raise HTTPException(status_code=400, detail="Test session not found")

	if request.mode == "plan":
		# Generate a new plan for this model run
		model_run.status = "planning"
		test_session.status = "pending_plan"
		db.commit()

		try:
			# Generate new plan with the continuation prompt
			await generate_plan(db, test_session, task_prompt=request.prompt)

			# Update statuses
			model_run.status = "plan_ready"
			test_session.status = "plan_ready"
			db.commit()
		except Exception as e:
			logger.error(f"Error generating plan for model run {model_run_id}: {e}")
			model_run.status = "failed"
			model_run.error = str(e)
			test_session.status = "failed"
			db.commit()
			raise HTTPException(status_code=500, detail=f"Failed to generate plan: {str(e)}")
	else:
		# Act mode - execute action directly
		from app.services.browser_service import execute_act_mode_sync

		model_run.status = "running"
		test_session.status = "running"
		db.commit()

		try:
			result = execute_act_mode_sync(db, test_session, request.prompt, None)

			# Update metrics
			db.refresh(test_session)
			model_run.total_steps = db.query(TestStep).filter(
				TestStep.session_id == test_session.id
			).count()

			# Mark as completed after single action
			model_run.status = "completed"
			test_session.status = "completed"
			db.commit()
		except Exception as e:
			logger.error(f"Error executing action for model run {model_run_id}: {e}")
			model_run.status = "failed"
			model_run.error = str(e)
			test_session.status = "failed"
			db.commit()
			raise HTTPException(status_code=500, detail=f"Failed to execute action: {str(e)}")

	db.refresh(model_run)
	return model_run
