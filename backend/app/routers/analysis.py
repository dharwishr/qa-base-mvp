import asyncio
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from datetime import datetime

from app.database import get_db
from app.deps import AuthenticatedUser, get_current_user
from app.models import AnalysisEvent, AnalysisPlan, TestSession, TestStep
from app.schemas import (
	ActModeRequest,
	ActModeResponse,
	AnalysisEventResponse,
	CancelTaskResponse,
	ChatMessageCreate,
	ChatMessageResponse,
	ContinueSessionRequest,
	CreateSessionRequest,
	ExecuteResponse,
	ExecutionLogResponse,
	InsertActionRequest,
	InsertStepRequest,
	RecordingStatusResponse,
	RegeneratePlanRequest,
	RejectPlanRequest,
	ReplaySessionRequest,
	ReplaySessionResponse,
	StartRecordingRequest,
	StartRunRequest,
	StartRunResponse,
	StepActionResponse,
	StopResponse,
	TaskStatusResponse,
	AnalysisPlanResponse,
	TestRunResponse,
	TestSessionDetailResponse,
	TestSessionListResponse,
	PaginatedTestSessionsResponse,
	TestSessionResponse,
	TestStepResponse,
	ToggleActionEnabledRequest,
	UndoRequest,
	UndoResponse,
	UpdatePlanRequest,
	UpdateSessionTitleRequest,
	UpdateStepActionRequest,
	UpdateStepActionTextRequest,
	WSError,
	WSInitialState,
)
from app.services.event_publisher import (
	set_cancelled,
	clear_cancelled,
	check_stop_requested,
	set_stop_requested,
	clear_stop_requested,
)
from app.services.plan_service import generate_plan, update_plan_steps, regenerate_plan_with_context
from app.services.browser_orchestrator import get_orchestrator, BrowserPhase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


def generate_title_fallback(prompt: str) -> str:
	"""Generate a simple fallback title from the test prompt (no LLM)."""
	# Take first line or first 50 characters
	first_line = prompt.split('\n')[0].strip()
	if len(first_line) > 50:
		# Find last word boundary before 50 chars
		truncated = first_line[:50]
		last_space = truncated.rfind(' ')
		if last_space > 30:
			return truncated[:last_space] + '...'
		return truncated + '...'
	return first_line


async def generate_title_with_llm(prompt: str, llm_model: str = "gemini-2.5-flash") -> str:
	"""Generate a concise title using LLM from the test prompt."""
	logger.info(f"[TITLE_GEN] Starting LLM title generation with model: {llm_model}")
	try:
		from app.services.browser_service import get_llm_for_model
		from browser_use.llm.messages import UserMessage
		
		logger.info(f"[TITLE_GEN] Getting LLM instance for model: {llm_model}")
		llm = get_llm_for_model(llm_model)
		logger.info(f"[TITLE_GEN] Got LLM instance: {type(llm).__name__}")
		
		title_prompt = f"""Generate a short, descriptive title (max 50 characters) for this test case prompt.
The title should be concise and capture the main action being tested.
Do NOT include quotes or any formatting. Just return the plain title text.

Test case prompt:
{prompt[:500]}

Title:"""
		
		# Wrap the prompt in a UserMessage (LLM expects list of BaseMessage objects)
		messages = [UserMessage(content=title_prompt)]
		
		logger.info(f"[TITLE_GEN] Calling LLM ainvoke with UserMessage...")
		response = await llm.ainvoke(messages)
		logger.info(f"[TITLE_GEN] Got LLM response: {response}")
		
		# Extract content from response - response is ChatInvokeCompletion with 'completion' field
		if hasattr(response, 'completion'):
			title = response.completion.strip() if isinstance(response.completion, str) else str(response.completion).strip()
		else:
			title = str(response).strip()
		logger.info(f"[TITLE_GEN] Extracted title: {title}")
		
		# Clean up and truncate if needed
		title = title.strip('"\'').strip()
		if len(title) > 100:
			title = title[:97] + '...'
		
		result = title if title else generate_title_fallback(prompt)
		logger.info(f"[TITLE_GEN] Final title: {result}")
		return result
	except Exception as e:
		logger.error(f"[TITLE_GEN] LLM title generation failed: {e}", exc_info=True)
		return generate_title_fallback(prompt)


async def update_session_title_async(session_id: str, prompt: str, llm_model: str) -> None:
	"""Background task to generate and update session title using LLM.
	
	Only updates the title if it's still the auto-generated fallback title.
	If the user has manually set a custom title, it will be preserved.
	"""
	from app.database import SessionLocal
	
	logger.info(f"[TITLE_UPDATE] Starting async title update for session: {session_id}")
	try:
		title = await generate_title_with_llm(prompt, llm_model)
		logger.info(f"[TITLE_UPDATE] Generated title: {title}")
		
		# Update the session with the generated title
		db = SessionLocal()
		try:
			session = db.query(TestSession).filter(TestSession.id == session_id).first()
			if session:
				old_title = session.title
				# Generate the fallback title to compare
				fallback_title = generate_title_fallback(prompt)
				
				# Only update if the current title is still the fallback (not manually changed)
				if old_title == fallback_title or not old_title:
					session.title = title
					db.commit()
					logger.info(f"[TITLE_UPDATE] Updated session {session_id} title from '{old_title}' to: '{title}'")
				else:
					logger.info(f"[TITLE_UPDATE] Skipping title update for session {session_id} - custom title already set: '{old_title}'")
			else:
				logger.warning(f"[TITLE_UPDATE] Session {session_id} not found!")
		finally:
			db.close()
	except Exception as e:
		logger.error(f"[TITLE_UPDATE] Failed to update session title: {e}", exc_info=True)


async def prewarm_browser_session_async(session_id: str, headless: bool) -> None:
	"""Background task to pre-warm browser session after plan generation."""
	if headless:
		return  # Headless uses local browser, no pre-warming needed

	logger.info(f"[PREWARM] Starting browser pre-warm for session: {session_id}")
	try:
		orchestrator = get_orchestrator()

		# Check if session already has a browser
		existing_sessions = await orchestrator.list_sessions(phase=BrowserPhase.ANALYSIS)
		if any(s.test_session_id == session_id for s in existing_sessions):
			logger.info(f"[PREWARM] Browser session already exists for {session_id}")
			return

		# Create pre-warmed session
		browser_session = await orchestrator.create_session(
			phase=BrowserPhase.ANALYSIS,
			test_session_id=session_id,
		)
		logger.info(f"[PREWARM] Browser session pre-warmed for {session_id}: browser_id={browser_session.id}")
	except Exception as e:
		logger.warning(f"[PREWARM] Failed to pre-warm browser for {session_id}: {e}")
		# Don't raise - pre-warming is best-effort


@router.get("/sessions", response_model=PaginatedTestSessionsResponse)
async def list_sessions(
	search: str | None = None,
	status: str | None = None,
	page: int = 1,
	page_size: int = 20,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get paginated test sessions with optional search and status filter.
	
	Args:
		search: Optional search string to filter by title or prompt (case-insensitive)
		status: Optional status filter
		page: Page number (1-indexed, default 1)
		page_size: Items per page (default 20, max 100)
	"""
	from sqlalchemy import func, or_
	from app.models import User
	import math

	# Validate pagination params
	page = max(1, page)
	page_size = min(max(1, page_size), 100)

	# Base query with join for step count and user info
	base_query = db.query(
		TestSession,
		func.count(TestStep.id).label('step_count'),
		User.name.label('user_name'),
		User.email.label('user_email')
	).filter(
		TestSession.organization_id == current_user.organization_id
	).outerjoin(TestStep).outerjoin(User, TestSession.user_id == User.id)

	# Apply search filter if provided
	if search:
		search_pattern = f"%{search}%"
		base_query = base_query.filter(
			or_(
				TestSession.title.ilike(search_pattern),
				TestSession.prompt.ilike(search_pattern)
			)
		)

	# Apply status filter if provided
	if status:
		base_query = base_query.filter(TestSession.status == status)

	# Get total count (before pagination) - need separate count query
	count_query = db.query(func.count(TestSession.id)).filter(
		TestSession.organization_id == current_user.organization_id
	)
	if search:
		search_pattern = f"%{search}%"
		count_query = count_query.filter(
			or_(
				TestSession.title.ilike(search_pattern),
				TestSession.prompt.ilike(search_pattern)
			)
		)
	if status:
		count_query = count_query.filter(TestSession.status == status)
	total = count_query.scalar()

	# Apply grouping, ordering, and pagination
	sessions = base_query.group_by(
		TestSession.id, User.name, User.email
	).order_by(
		TestSession.created_at.desc()
	).offset((page - 1) * page_size).limit(page_size).all()

	# Calculate total pages
	total_pages = math.ceil(total / page_size) if total > 0 else 1

	# Convert to response format
	items = []
	for session, step_count, user_name, user_email in sessions:
		items.append(TestSessionListResponse(
			id=session.id,
			prompt=session.prompt,
			title=session.title,
			llm_model=session.llm_model,
			status=session.status,
			created_at=session.created_at,
			updated_at=session.updated_at,
			step_count=step_count,
			user_name=user_name,
			user_email=user_email
		))

	return PaginatedTestSessionsResponse(
		items=items,
		total=total,
		page=page,
		page_size=page_size,
		total_pages=total_pages
	)


@router.post("/sessions", response_model=TestSessionResponse)
async def create_session(
	request: CreateSessionRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Create a new test session and queue plan generation via Celery.

	The plan is generated asynchronously in a Celery worker. The session is returned
	immediately with status="generating_plan". Frontend should subscribe to WebSocket
	events or poll for plan completion.
	"""
	from app.tasks.plan_generation import generate_test_plan

	# Generate simple fallback title initially (LLM title will be updated in Celery task)
	title = generate_title_fallback(request.prompt)

	# Create session with selected LLM model and headless option
	session = TestSession(
		prompt=request.prompt,
		title=title,
		llm_model=request.llm_model,
		headless=request.headless,
		status="generating_plan",  # Changed from pending_plan
		organization_id=current_user.organization_id,
		user_id=current_user.id,
	)
	db.add(session)
	db.commit()
	db.refresh(session)

	# Queue plan generation via Celery (includes title generation)
	logger.info(f"[CELERY] Queueing plan generation task for session: {session.id}")
	task = generate_test_plan.delay(
		session_id=session.id,
		llm_model=request.llm_model,
		generate_title=True,
	)

	# Store task ID for tracking
	session.plan_task_id = task.id
	db.commit()
	db.refresh(session)

	logger.info(f"[CELERY] Plan generation task queued: task_id={task.id}, session_id={session.id}")

	# Pre-warm browser session in background if not headless (saves 2-5s on approval)
	if not request.headless:
		logger.info(f"[PREWARM] Spawning browser pre-warm task for session: {session.id}")
		asyncio.create_task(prewarm_browser_session_async(
			session_id=session.id,
			headless=request.headless
		))

	return session


@router.get("/sessions/{session_id}", response_model=TestSessionDetailResponse)
async def get_session(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get a test session by ID with all details."""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")
	return session


@router.patch("/sessions/{session_id}/title", response_model=TestSessionResponse)
async def update_session_title(
	session_id: str,
	request: UpdateSessionTitleRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Update the title of a test session."""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")
	
	session.title = request.title
	db.commit()
	db.refresh(session)
	return session


@router.post("/sessions/{session_id}/continue", response_model=TestSessionResponse)
async def continue_session(
	session_id: str,
	request: ContinueSessionRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Continue an existing session with a new task.

	This allows users to add additional tasks to a completed session,
	keeping all previous steps and data.
	"""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Log continuation detection
	existing_steps = db.query(TestStep).filter(TestStep.session_id == session_id).count()
	logger.info(f"[CONTINUATION] Session {session_id}: status={session.status}, existing_steps={existing_steps}, mode={request.mode}")

	# Allow continuing from completed, failed, stopped, or paused states
	if session.status not in ("completed", "failed", "stopped", "paused"):
		raise HTTPException(
			status_code=400,
			detail=f"Cannot continue session in status: {session.status}. "
				   "Session must be completed, failed, stopped, or paused to continue."
		)

	# Store the new request - don't append to original prompt
	# This keeps session.prompt as the original for reference
	new_task_prompt = request.prompt
	session.llm_model = request.llm_model
	logger.info(f"[CONTINUATION] Continuing with prompt: {new_task_prompt[:100]}...")
	# NOTE: User message is persisted by frontend BEFORE this API call is made
	# so we don't need a redundant "Continuing with:" system message here

	if request.mode == "plan":
		# Generate a new plan for the continuation via Celery
		# Pass only the NEW request, not the original prompt
		from app.tasks.plan_generation import generate_test_plan

		# Delete old plan AND its chat message first to avoid duplicates
		if session.plan:
			logger.info(f"Deleting old plan for session {session_id} before generating new one")
			# Also delete the old plan chat message to avoid duplicate plan cards
			from app.models import ChatMessage
			db.query(ChatMessage).filter(
				ChatMessage.session_id == session_id,
				ChatMessage.plan_id == session.plan.id
			).delete(synchronize_session=False)
			db.delete(session.plan)
			db.flush()  # Ensure delete is processed before creating new plan

		session.status = "generating_plan"
		db.commit()

		# Queue plan generation via Celery
		logger.info(f"[CELERY] Queueing continuation plan generation for session {session_id} with prompt: {new_task_prompt[:100]}...")
		task = generate_test_plan.delay(
			session_id=session.id,
			task_prompt=new_task_prompt,
			is_continuation=True,
			llm_model=request.llm_model,
			generate_title=False,  # Don't regenerate title for continuations
		)

		# Store task ID for tracking
		session.plan_task_id = task.id
		db.commit()

		logger.info(f"[CELERY] Continuation plan generation task queued: task_id={task.id}")
	else:
		# Act mode - set status to approved for direct execution
		# Create an implicit plan from the prompt
		from datetime import datetime

		# Delete old plan if exists
		if session.plan:
			db.delete(session.plan)

		# Create a simple plan for the continuation task
		plan = AnalysisPlan(
			session_id=session.id,
			plan_text=request.prompt,
			steps_json={"steps": [{"description": request.prompt}]},
			approval_status="approved",
			approval_timestamp=datetime.utcnow()
		)
		db.add(plan)
		session.status = "approved"
		db.commit()
		db.refresh(plan)  # Refresh to get the generated ID
		# NOTE: Act mode does NOT create a plan message - user message is sufficient

	db.refresh(session)
	return session


@router.post("/sessions/{session_id}/act", response_model=ActModeResponse)
async def execute_act_mode(
	session_id: str,
	request: ActModeRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Execute a single action in act mode.

	This endpoint executes a single browser action and returns immediately,
	without iterative planning or feedback loops. It's designed for interactive
	testing where users issue one command at a time.
	"""
	from app.services.browser_service import BrowserServiceSync

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Allow act mode from various states
	allowed_states = ("completed", "failed", "stopped", "approved", "plan_ready")
	if session.status not in allowed_states:
		raise HTTPException(
			status_code=400,
			detail=f"Cannot execute act mode in status: {session.status}. "
				   f"Allowed states: {', '.join(allowed_states)}"
		)

	# Get context from last step (if any)
	last_step = db.query(TestStep).filter(
		TestStep.session_id == session_id
	).order_by(TestStep.step_number.desc()).first()

	previous_context = None
	if last_step:
		# Build context from previous step
		context_parts = []
		if last_step.next_goal:
			context_parts.append(f"Last goal: {last_step.next_goal}")
		if last_step.evaluation:
			context_parts.append(f"Result: {last_step.evaluation[:200]}")
		if last_step.url:
			context_parts.append(f"URL: {last_step.url}")
		if context_parts:
			previous_context = " | ".join(context_parts)

	# Create system message for the action
	create_system_message(db, session_id, f"Act: {request.task}")
	db.commit()

	# Execute single action
	service = BrowserServiceSync(db, session)
	try:
		result = await service.execute_act_mode(request.task, previous_context)
		return ActModeResponse(**result)
	except Exception as e:
		logger.error(f"Act mode execution failed for session {session_id}: {e}")
		raise HTTPException(status_code=500, detail=f"Act mode execution failed: {str(e)}")


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Delete a test session and all related data."""
	from app.models import ExecutionLog, StepAction
	from sqlalchemy import select

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Get step IDs for this session using select()
	step_ids_query = select(TestStep.id).where(TestStep.session_id == session_id).scalar_subquery()

	# Delete step actions
	db.query(StepAction).filter(StepAction.step_id.in_(step_ids_query)).delete(synchronize_session=False)

	# Delete steps
	db.query(TestStep).filter(TestStep.session_id == session_id).delete(synchronize_session=False)

	# Delete execution logs
	db.query(ExecutionLog).filter(ExecutionLog.session_id == session_id).delete(synchronize_session=False)

	# Delete plan if exists
	if session.plan:
		db.query(AnalysisPlan).filter(AnalysisPlan.session_id == session_id).delete(synchronize_session=False)

	# Expunge session to avoid stale data errors
	db.expunge(session)
	
	# Delete the session itself
	db.query(TestSession).filter(TestSession.id == session_id).delete(synchronize_session=False)
	db.commit()


@router.get("/sessions/{session_id}/plan", response_model=AnalysisPlanResponse)
async def get_session_plan(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get the plan for a test session."""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	if not session.plan:
		raise HTTPException(status_code=404, detail="Plan not found")

	return session.plan


@router.put("/sessions/{session_id}/plan", response_model=AnalysisPlanResponse)
async def update_session_plan(
	session_id: str,
	request: UpdatePlanRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Update a plan with manually edited steps.

	Use this endpoint to save user's manual edits to the plan steps.
	The plan text will be regenerated from the step descriptions.
	"""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	if session.status != "plan_ready":
		raise HTTPException(
			status_code=400,
			detail=f"Cannot update plan in status: {session.status}. Plan can only be edited when status is 'plan_ready'."
		)

	if not session.plan:
		raise HTTPException(status_code=404, detail="Plan not found")

	# Validate steps structure
	for i, step in enumerate(request.steps):
		if "description" not in step:
			raise HTTPException(
				status_code=400,
				detail=f"Step {i + 1} is missing required field 'description'"
			)

	updated_plan = update_plan_steps(
		db=db,
		plan=session.plan,
		steps=request.steps,
		user_prompt=request.user_prompt
	)

	return updated_plan


@router.post("/sessions/{session_id}/plan/regenerate", response_model=AnalysisPlanResponse)
async def regenerate_session_plan(
	session_id: str,
	request: RegeneratePlanRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Regenerate a plan using AI with user's edits as context.

	Use this endpoint to send user's edited steps and refinement instructions
	to the AI, which will generate an improved plan based on the feedback.
	"""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	if session.status != "plan_ready":
		raise HTTPException(
			status_code=400,
			detail=f"Cannot regenerate plan in status: {session.status}. Plan can only be regenerated when status is 'plan_ready'."
		)

	if not session.plan:
		raise HTTPException(status_code=404, detail="Plan not found")

	regenerated_plan = await regenerate_plan_with_context(
		db=db,
		session=session,
		plan=session.plan,
		edited_steps=request.edited_steps,
		user_prompt=request.user_prompt
	)

	return regenerated_plan


@router.post("/sessions/{session_id}/approve", response_model=TestSessionResponse)
async def approve_plan(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Approve a plan and mark session as ready for execution."""
	from datetime import datetime

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	if session.status != "plan_ready":
		raise HTTPException(status_code=400, detail=f"Cannot approve plan in status: {session.status}")

	# Update plan approval status
	if session.plan:
		session.plan.approval_status = "approved"
		session.plan.approval_timestamp = datetime.utcnow()

	# Create approval system message
	create_system_message(db, session_id, "Plan approved. Starting execution...")

	session.status = "approved"
	db.commit()
	db.refresh(session)

	return session


@router.post("/sessions/{session_id}/execute", response_model=ExecuteResponse)
async def start_execution(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Start test execution via Celery task."""
	from app.tasks.analysis import run_test_analysis

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	if session.status != "approved":
		raise HTTPException(status_code=400, detail=f"Cannot execute in status: {session.status}")

	if not session.plan:
		raise HTTPException(status_code=400, detail="Session has no plan")

	# Queue Celery task
	task = run_test_analysis.delay(session_id)

	session.celery_task_id = task.id
	session.status = "queued"
	db.commit()

	return ExecuteResponse(task_id=task.id, status="queued")


@router.post("/sessions/{session_id}/stop", response_model=StopResponse)
async def stop_execution(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Stop a running test execution by revoking the Celery task."""
	from app.celery_app import celery_app

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Check if session is in a stoppable state
	if session.status not in ("queued", "running"):
		raise HTTPException(
			status_code=400,
			detail=f"Cannot stop session in status: {session.status}"
		)

	if not session.celery_task_id:
		raise HTTPException(status_code=400, detail="No Celery task associated with this session")

	try:
		# Revoke the Celery task with termination signal
		celery_app.control.revoke(session.celery_task_id, terminate=True, signal="SIGTERM")
		logger.info(f"Revoked Celery task {session.celery_task_id} for session {session_id}")

		# Update session status
		session.status = "stopped"
		db.commit()

		# Persist message for session history
		create_system_message(db, session_id, "Execution stopped")
		db.commit()

		return StopResponse(status="stopped", message="Test execution stopped successfully")
	except Exception as e:
		logger.error(f"Error stopping task for session {session_id}: {e}")
		raise HTTPException(status_code=500, detail=f"Failed to stop task: {str(e)}")


@router.get("/sessions/{session_id}/logs", response_model=list[ExecutionLogResponse])
async def get_session_logs(
	session_id: str,
	level: str | None = None,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get execution logs for a session."""
	from app.models import ExecutionLog

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	query = db.query(ExecutionLog).filter(ExecutionLog.session_id == session_id)
	if level:
		query = query.filter(ExecutionLog.level == level.upper())
	logs = query.order_by(ExecutionLog.created_at).all()
	return logs


@router.get("/sessions/{session_id}/steps", response_model=list[TestStepResponse])
async def get_session_steps(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get all steps for a test session."""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Refresh session to get latest steps from DB
	db.refresh(session)
	steps = session.steps
	logger.info(f"GET /steps for session {session_id}: returning {len(steps)} steps")
	return steps


@router.delete("/sessions/{session_id}/steps", status_code=204)
async def clear_session_steps(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Clear all steps for a test session."""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Delete actions for these steps first (manual cascade)
	# We need to import StepAction if not already imported, or do a subquery delete
	from app.models import StepAction

	# Get step IDs
	step_ids = db.query(TestStep.id).filter(TestStep.session_id == session_id).subquery()

	# Delete actions
	db.query(StepAction).filter(StepAction.step_id.in_(step_ids)).delete(synchronize_session=False)

	# Delete steps
	db.query(TestStep).filter(TestStep.session_id == session_id).delete(synchronize_session=False)

	db.commit()


@router.post("/sessions/{session_id}/reset", response_model=TestSessionResponse)
async def reset_session(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Reset a test session to its initial state while keeping the same ID.

	This will:
	1. Delete all steps and their actions
	2. Delete all chat messages
	3. Delete the plan
	4. Delete execution logs
	5. Reset the session status to 'idle'

	The session ID, title, and original prompt are preserved so the user
	can edit and re-run the test case.
	"""
	from app.models import ChatMessage, ExecutionLog, StepAction

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# 1. Delete step actions first (foreign key constraint)
	step_ids = db.query(TestStep.id).filter(TestStep.session_id == session_id).subquery()
	db.query(StepAction).filter(StepAction.step_id.in_(step_ids)).delete(synchronize_session=False)

	# 2. Delete all steps
	db.query(TestStep).filter(TestStep.session_id == session_id).delete(synchronize_session=False)

	# 3. Delete all chat messages
	db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete(synchronize_session=False)

	# 4. Delete execution logs
	db.query(ExecutionLog).filter(ExecutionLog.session_id == session_id).delete(synchronize_session=False)

	# 5. Delete the plan if exists
	if session.plan:
		db.query(AnalysisPlan).filter(AnalysisPlan.session_id == session_id).delete(synchronize_session=False)

	# 6. Reset session state (keep title and prompt for user to edit)
	session.status = "idle"
	session.celery_task_id = None

	db.commit()
	db.refresh(session)

	logger.info(f"Reset session {session_id} to initial state (kept title and prompt)")
	return session


@router.delete("/steps/{step_id}", status_code=204)
async def delete_step(
	step_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Delete a single step and renumber remaining steps.

	This deletes the specified step and its associated actions,
	then renumbers all subsequent steps to maintain a continuous sequence.
	"""
	from app.models import StepAction

	# Get the step
	step = db.query(TestStep).filter(TestStep.id == step_id).first()
	if not step:
		raise HTTPException(status_code=404, detail="Step not found")

	session_id = step.session_id
	deleted_step_number = step.step_number

	# Delete actions for this step
	db.query(StepAction).filter(StepAction.step_id == step_id).delete(synchronize_session=False)

	# Delete the step
	db.delete(step)

	# Renumber remaining steps (decrement step_number for all steps after the deleted one)
	db.query(TestStep).filter(
		TestStep.session_id == session_id,
		TestStep.step_number > deleted_step_number
	).update(
		{TestStep.step_number: TestStep.step_number - 1},
		synchronize_session=False
	)

	db.commit()
	logger.info(f"Deleted step {step_id} (was step #{deleted_step_number}) from session {session_id}")


# ============================================
# Step Action Update Endpoints
# ============================================

@router.patch("/actions/{action_id}/text", response_model=StepActionResponse)
async def update_action_text(
	action_id: str,
	request: UpdateStepActionTextRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Update the text value for a type_text action.

	This endpoint allows editing the input text for type_text actions,
	which is useful for correcting recorded user inputs or modifying
	test data before replay.
	"""
	from app.models import StepAction
	from sqlalchemy.orm.attributes import flag_modified

	action = db.query(StepAction).filter(StepAction.id == action_id).first()
	if not action:
		raise HTTPException(status_code=404, detail="Action not found")

	# Verify this is a type_text action
	if action.action_name != "type_text":
		raise HTTPException(
			status_code=400,
			detail=f"Cannot update text for action type: {action.action_name}. "
				   "Only type_text actions can have their text edited."
		)

	# Update action_params with new text
	params = action.action_params or {}
	params["text"] = request.text
	action.action_params = params

	# SQLAlchemy may not detect changes to JSON field, so force update
	flag_modified(action, "action_params")

	db.commit()
	db.refresh(action)

	logger.info(f"Updated action {action_id} text to: {request.text[:50]}...")
	return action


@router.patch("/actions/{action_id}", response_model=StepActionResponse)
async def update_action(
	action_id: str,
	request: UpdateStepActionRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Update editable fields for a step action.

	Editable fields:
	- element_xpath: XPath selector
	- css_selector: CSS selector (stored in action_params)
	- text: Input text for type_text actions (stored in action_params)

	Only allowed when session is in post-execution state:
	completed, failed, stopped, paused
	"""
	from app.models import StepAction
	from sqlalchemy.orm.attributes import flag_modified

	# Fetch action
	action = db.query(StepAction).filter(StepAction.id == action_id).first()
	if not action:
		raise HTTPException(status_code=404, detail="Action not found")

	# Get the step and session to check status
	step = db.query(TestStep).filter(TestStep.id == action.step_id).first()
	if not step:
		raise HTTPException(status_code=404, detail="Step not found")

	session = db.query(TestSession).filter(TestSession.id == step.session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Validate session status - only allow edits in post-execution states
	allowed_statuses = ('completed', 'failed', 'stopped', 'paused')
	if session.status not in allowed_statuses:
		raise HTTPException(
			status_code=400,
			detail=f"Cannot edit actions when session is in '{session.status}' status. "
				   f"Editing only allowed in: {', '.join(allowed_statuses)}"
		)

	# Update element_xpath if provided
	if request.element_xpath is not None:
		action.element_xpath = request.element_xpath

	# Update action_params for css_selector and text
	params = action.action_params or {}

	if request.css_selector is not None:
		params["css_selector"] = request.css_selector
		# Also update legacy field name if present
		if "selector" in params:
			params["selector"] = request.css_selector

	if request.text is not None:
		# Verify this is a text input action
		text_action_types = ['type_text', 'input_text', 'type', 'input', 'fill']
		if action.action_name.lower() not in text_action_types:
			raise HTTPException(
				status_code=400,
				detail=f"Cannot update text for action type: {action.action_name}. "
					   f"Text editing only allowed for: {', '.join(text_action_types)}"
			)
		params["text"] = request.text

	# Handle assertion-specific fields
	assert_action_types = ['assert', 'assert_text', 'assert_element', 'assert_url', 'assert_value', 'verify']
	is_assert_action = any(t in action.action_name.lower() for t in assert_action_types)

	if request.expected_value is not None:
		if not is_assert_action:
			raise HTTPException(
				status_code=400,
				detail=f"Cannot update expected_value for action type: {action.action_name}. "
					   f"This field is only valid for assertion actions."
			)
		params["expected_value"] = request.expected_value
		# Also update 'text' param for text_visible assertions (backward compatibility)
		if "text" in action.action_name.lower():
			params["text"] = request.expected_value

	if request.pattern_type is not None:
		if not is_assert_action:
			raise HTTPException(
				status_code=400,
				detail=f"Cannot update pattern_type for action type: {action.action_name}. "
					   f"This field is only valid for assertion actions."
			)
		valid_pattern_types = ['exact', 'substring', 'wildcard', 'regex']
		if request.pattern_type not in valid_pattern_types:
			raise HTTPException(
				status_code=400,
				detail=f"Invalid pattern_type: {request.pattern_type}. "
					   f"Must be one of: {', '.join(valid_pattern_types)}"
			)
		params["pattern_type"] = request.pattern_type

	if request.case_sensitive is not None:
		if not is_assert_action:
			raise HTTPException(
				status_code=400,
				detail=f"Cannot update case_sensitive for action type: {action.action_name}. "
					   f"This field is only valid for assertion actions."
			)
		params["case_sensitive"] = request.case_sensitive

	if request.partial_match is not None:
		if not is_assert_action:
			raise HTTPException(
				status_code=400,
				detail=f"Cannot update partial_match for action type: {action.action_name}. "
					   f"This field is only valid for assertion actions."
			)
		params["partial_match"] = request.partial_match

	action.action_params = params
	flag_modified(action, "action_params")

	db.commit()
	db.refresh(action)

	logger.info(
		f"Updated action {action_id}: xpath={request.element_xpath}, "
		f"css_selector={request.css_selector}, text={request.text[:20] if request.text else None}, "
		f"expected_value={request.expected_value[:20] if request.expected_value else None}, "
		f"pattern_type={request.pattern_type}"
	)
	return action


@router.patch("/actions/{action_id}/enabled", response_model=StepActionResponse)
async def toggle_action_enabled(
	action_id: str,
	request: ToggleActionEnabledRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Toggle whether an action is enabled for script execution.

	When is_enabled is False, the action will be skipped during
	session-based test runs (Execute tab).
	"""
	from app.models import StepAction

	action = db.query(StepAction).filter(StepAction.id == action_id).first()
	if not action:
		raise HTTPException(status_code=404, detail="Action not found")

	action.is_enabled = request.enabled
	db.commit()
	db.refresh(action)

	logger.info(f"Toggled action {action_id} enabled={request.enabled}")
	return action


# ============================================
# Insert Action/Step Endpoints
# ============================================

@router.post("/steps/{step_id}/actions", response_model=StepActionResponse)
async def insert_action(
	step_id: str,
	request: InsertActionRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Insert a new action at a specific index within a step.

	This endpoint:
	1. Validates the step exists and user has access
	2. Validates the session is in an editable state (completed/failed/stopped/paused)
	3. Re-indexes existing actions at and after the insertion point
	4. Creates the new action at the specified index
	5. Returns the new action
	"""
	from app.models import StepAction

	# Get the step
	step = db.query(TestStep).filter(TestStep.id == step_id).first()
	if not step:
		raise HTTPException(status_code=404, detail="Step not found")

	# Get the session to check status and organization access
	session = db.query(TestSession).filter(TestSession.id == step.session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Check organization access
	if session.organization_id != current_user.organization_id:
		raise HTTPException(status_code=403, detail="Access denied")

	# Validate session status - only allow edits in post-execution states
	allowed_statuses = ('completed', 'failed', 'stopped', 'paused')
	if session.status not in allowed_statuses:
		raise HTTPException(
			status_code=400,
			detail=f"Cannot insert actions when session is in '{session.status}' status. "
				   f"Editing only allowed in: {', '.join(allowed_statuses)}"
		)

	# Re-index existing actions: increment action_index for all actions >= insertion point
	db.query(StepAction).filter(
		StepAction.step_id == step_id,
		StepAction.action_index >= request.action_index
	).update(
		{StepAction.action_index: StepAction.action_index + 1},
		synchronize_session=False
	)

	# Create the new action
	new_action = StepAction(
		step_id=step_id,
		action_index=request.action_index,
		action_name=request.action_name,
		action_params=request.action_params,
		is_enabled=True,
	)
	db.add(new_action)
	db.commit()
	db.refresh(new_action)

	logger.info(f"Inserted action {new_action.id} at index {request.action_index} in step {step_id}")
	return new_action


@router.post("/sessions/{session_id}/steps", response_model=TestStepResponse)
async def insert_step(
	session_id: str,
	request: InsertStepRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Insert a new step with an action at a specific position.

	This endpoint:
	1. Validates the session exists and user has access
	2. Validates the session is in an editable state (completed/failed/stopped/paused)
	3. Re-indexes existing steps at and after the insertion point
	4. Creates the new step at the specified position with the given action
	5. Returns the new step with its action
	"""
	from app.models import StepAction

	# Get the session
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Check organization access
	if session.organization_id != current_user.organization_id:
		raise HTTPException(status_code=403, detail="Access denied")

	# Validate session status - only allow edits in post-execution states
	allowed_statuses = ('completed', 'failed', 'stopped', 'paused')
	if session.status not in allowed_statuses:
		raise HTTPException(
			status_code=400,
			detail=f"Cannot insert steps when session is in '{session.status}' status. "
				   f"Editing only allowed in: {', '.join(allowed_statuses)}"
		)

	# Re-index existing steps: increment step_number for all steps >= insertion point
	db.query(TestStep).filter(
		TestStep.session_id == session_id,
		TestStep.step_number >= request.step_number
	).update(
		{TestStep.step_number: TestStep.step_number + 1},
		synchronize_session=False
	)

	# Create the new step
	new_step = TestStep(
		session_id=session_id,
		step_number=request.step_number,
		status='pending',
	)
	db.add(new_step)
	db.flush()  # Get the step ID

	# Create the action for the step
	new_action = StepAction(
		step_id=new_step.id,
		action_index=0,
		action_name=request.action_name,
		action_params=request.action_params,
		is_enabled=True,
	)
	db.add(new_action)
	db.commit()
	db.refresh(new_step)

	logger.info(f"Inserted step {new_step.id} at position {request.step_number} in session {session_id}")
	return new_step


# ============================================
# Session-Based Test Runs (Execute Tab)
# ============================================

@router.post("/sessions/{session_id}/run", response_model=StartRunResponse)
async def start_session_run(
	session_id: str,
	request: StartRunRequest = StartRunRequest(),
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Start a test run using enabled actions directly from the session.

	This creates a TestRun without generating a PlaywrightScript, using
	the session's StepActions directly. Only actions where is_enabled=True
	are included in the run.

	The run executes on containerized browsers from the pool, just like
	script-based runs.
	"""
	from app.models import StepAction, TestRun
	from app.tasks.session_runs import execute_session_run

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Check session has steps with enabled actions
	# Include actions where is_enabled is True or NULL (for backward compatibility)
	from sqlalchemy import or_
	enabled_actions_count = db.query(StepAction).join(TestStep).filter(
		TestStep.session_id == session_id,
		or_(StepAction.is_enabled == True, StepAction.is_enabled.is_(None))
	).count()

	if enabled_actions_count == 0:
		raise HTTPException(
			status_code=400,
			detail="No enabled actions found in session. Enable some actions to run."
		)

	# Parse resolution
	resolution_parts = request.resolution.value.split("x")
	width = int(resolution_parts[0])
	height = int(resolution_parts[1])

	# Create TestRun record (linked to session, not script)
	run = TestRun(
		session_id=session_id,
		script_id=None,  # Session-based run, no script
		user_id=current_user.id,
		status="pending",
		browser_type=request.browser_type.value,
		resolution_width=width,
		resolution_height=height,
		screenshots_enabled=request.screenshots_enabled,
		recording_enabled=request.recording_enabled,
		network_recording_enabled=request.network_recording_enabled,
		performance_metrics_enabled=request.performance_metrics_enabled,
	)
	db.add(run)
	db.commit()
	db.refresh(run)

	# Queue execution via Celery
	logger.info(f"Queueing session run {run.id} for session {session_id}")
	task = execute_session_run.delay(run.id)

	# Store task ID
	run.celery_task_id = task.id
	run.status = "queued"
	db.commit()

	return StartRunResponse(
		run_id=run.id,
		status="queued",
		celery_task_id=task.id,
	)


@router.get("/sessions/{session_id}/runs", response_model=list[TestRunResponse])
async def list_session_runs(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""List all test runs for a session.

	Returns runs ordered by creation date (newest first).
	"""
	from app.models import TestRun, User

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	runs = db.query(TestRun, User.name, User.email).outerjoin(
		User, TestRun.user_id == User.id
	).filter(
		TestRun.session_id == session_id
	).order_by(TestRun.created_at.desc()).all()

	result = []
	for run, user_name, user_email in runs:
		run_dict = TestRunResponse.model_validate(run).model_dump()
		run_dict["user_name"] = user_name
		run_dict["user_email"] = user_email
		result.append(TestRunResponse(**run_dict))

	return result


# ============================================
# Undo Endpoints
# ============================================

@router.post("/sessions/{session_id}/undo", response_model=UndoResponse)
async def undo_to_step(
	session_id: str,
	request: UndoRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Undo a test session to a specific step number.
	
	This will:
	1. Delete all steps after the target step number
	2. Replay steps 1 through target_step_number in the current browser session
	
	Note: This does NOT revert any changes made to the application under test.
	It only repositions the browser state by replaying the earlier steps.
	
	The replay uses the existing browser session (CDP connection) and does not
	consume any LLM tokens.
	"""
	from app.services.undo_service import undo_to_step as do_undo

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Allow undo from various states
	allowed_states = ("completed", "failed", "stopped", "running")
	if session.status not in allowed_states:
		raise HTTPException(
			status_code=400,
			detail=f"Cannot undo session in status: {session.status}. "
				   f"Allowed states: {', '.join(allowed_states)}"
		)

	try:
		result = await do_undo(db, session, request.target_step_number)

		# Persist result message for session history
		if result.success:
			create_system_message(db, session_id, f"Undone to step {result.actual_step_number}. {result.steps_removed} steps removed, {result.steps_replayed} replayed.")
		else:
			error_msg = result.error_message or "Unknown error"
			create_system_message(db, session_id, f"Undo failed: {error_msg}")
		db.commit()

		return UndoResponse(
			success=result.success,
			target_step_number=result.target_step_number,
			steps_removed=result.steps_removed,
			steps_replayed=result.steps_replayed,
			replay_status=result.replay_status,
			error_message=result.error_message,
			failed_at_step=result.failed_at_step,
			actual_step_number=result.actual_step_number,
			user_message=result.user_message,
		)
	except Exception as e:
		logger.error(f"Undo failed for session {session_id}: {e}")
		# Persist error message for session history
		create_system_message(db, session_id, f"Undo failed: {str(e)}")
		db.commit()
		raise HTTPException(status_code=500, detail=f"Undo failed: {str(e)}")


@router.post("/sessions/{session_id}/replay", response_model=ReplaySessionResponse)
async def replay_session(
	session_id: str,
	request: ReplaySessionRequest = None,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Replay all steps in a test session.
	
	This will:
	1. Start a new browser session
	2. Replay all recorded steps from the session
	3. Return the browser session ID for live view
	
	Use this to re-initiate an older test case analysis session.
	The replay uses CDP and does not consume any LLM tokens.
	"""
	from app.services.replay_service import replay_session as do_replay

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Allow replay from any state - user should be able to Re Run at any time
	# Only block if session has no steps (nothing to replay)
	if not session.steps:
		raise HTTPException(
			status_code=400,
			detail="Cannot replay session with no steps"
		)

	headless = request.headless if request else False
	prepare_only = request.prepare_only if request else False

	# Update session status to 'rerunning' when Re Run is triggered
	if prepare_only:
		session.status = "rerunning"
		db.commit()

	# Persist starting message for session history
	if prepare_only:
		create_system_message(db, session_id, "Starting Re Run...")
	else:
		create_system_message(db, session_id, "Re-initiating session...")
	db.commit()

	try:
		result = await do_replay(db, session, headless=headless, prepare_only=prepare_only)

		# Persist result message for session history
		if result.success:
			if prepare_only:
				create_system_message(db, session_id, f"Browser ready. {result.total_steps} steps available for execution.")
			else:
				create_system_message(db, session_id, f"Session re-initiated successfully. {result.steps_replayed}/{result.total_steps} steps replayed.")
		else:
			error_msg = result.error_message or "Unknown error"
			create_system_message(db, session_id, f"Re-initiation failed at step {result.failed_at_step}: {error_msg}")
		db.commit()

		return ReplaySessionResponse(
			success=result.success,
			total_steps=result.total_steps,
			steps_replayed=result.steps_replayed,
			replay_status=result.replay_status,
			error_message=result.error_message,
			failed_at_step=result.failed_at_step,
			browser_session_id=result.browser_session_id,
			user_message=result.user_message,
		)
	except Exception as e:
		logger.error(f"Replay failed for session {session_id}: {e}")
		# Persist error message for session history
		create_system_message(db, session_id, f"Re-initiation failed: {str(e)}")
		db.commit()
		raise HTTPException(status_code=500, detail=f"Replay failed: {str(e)}")


# ============================================
# User Recording Endpoints
# ============================================

@router.post("/sessions/{session_id}/recording/start", response_model=RecordingStatusResponse)
async def start_recording(
	session_id: str,
	request: StartRecordingRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Start recording user interactions in the live browser.

	This connects to the existing browser session and injects
	event listeners to capture user interactions (clicks, typing, etc.)
	as test steps.

	Recording modes:
	- 'playwright' (default): Uses Playwright's browser server with blur-based input capture.
	  Better handling of backspace/delete - records final input value, not each keystroke.
	- 'browser_use': Uses semantic selectors inspired by workflow-use for self-healing replay.
	  Captures action intent, multiple selector strategies, and rich element context.
	- 'cdp': Legacy mode using browser-use CDP. Records each keystroke including backspace.
	"""
	from app.services.browser_orchestrator import get_orchestrator
	from app.services.user_recording_service import UserRecordingService, get_active_recording
	from app.services.playwright_recording_service import PlaywrightRecordingService, get_active_playwright_recording
	from app.services.browseruse_recording_service import BrowserUseRecordingService, get_active_browseruse_recording

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	recording_mode = request.recording_mode

	# Check if already recording (any mode)
	cdp_recording = get_active_recording(session_id)
	playwright_recording = get_active_playwright_recording(session_id)
	browseruse_recording = get_active_browseruse_recording(session_id)
	existing_recording = cdp_recording or playwright_recording or browseruse_recording

	if existing_recording:
		state = existing_recording.get_status()
		if cdp_recording:
			current_mode = 'cdp'
		elif playwright_recording:
			current_mode = 'playwright'
		else:
			current_mode = 'browser_use'
		return RecordingStatusResponse(
			is_recording=True,
			session_id=session_id,
			browser_session_id=state.browser_session_id if state else None,
			steps_recorded=state.steps_recorded if state else 0,
			started_at=state.started_at if state else None,
			recording_mode=current_mode,
		)

	# Get browser session from orchestrator
	orchestrator = get_orchestrator()
	browser_session = await orchestrator.get_session(request.browser_session_id)
	if not browser_session:
		raise HTTPException(status_code=404, detail="Browser session not found")

	if not browser_session.cdp_ws_url:
		raise HTTPException(status_code=400, detail="Browser session has no CDP URL")

	try:
		# Create and start recording service based on mode
		if recording_mode == 'playwright':
			logger.info(f"Starting Playwright recording for session {session_id}")
			recording_service = PlaywrightRecordingService(db, session, browser_session)
		elif recording_mode == 'browser_use':
			logger.info(f"Starting BrowserUse recording for session {session_id}")
			recording_service = BrowserUseRecordingService(db, session, browser_session)
		else:
			logger.info(f"Starting CDP recording for session {session_id}")
			recording_service = UserRecordingService(db, session, browser_session)

		state = await recording_service.start()

		# Persist message for session history
		create_system_message(db, session_id, f"Recording started ({recording_mode} mode)")
		db.commit()

		return RecordingStatusResponse(
			is_recording=True,
			session_id=session_id,
			browser_session_id=browser_session.id,
			steps_recorded=state.steps_recorded,
			started_at=state.started_at,
			recording_mode=recording_mode,
		)
	except Exception as e:
		logger.error(f"Failed to start {recording_mode} recording for session {session_id}: {e}")
		raise HTTPException(status_code=500, detail=f"Failed to start recording: {str(e)}")


@router.post("/sessions/{session_id}/recording/stop", response_model=RecordingStatusResponse)
async def stop_recording(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Stop recording user interactions (Playwright, BrowserUse, or CDP mode)."""
	from app.services.user_recording_service import get_active_recording
	from app.services.playwright_recording_service import get_active_playwright_recording
	from app.services.browseruse_recording_service import get_active_browseruse_recording

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Check all recording modes
	cdp_recording = get_active_recording(session_id)
	playwright_recording = get_active_playwright_recording(session_id)
	browseruse_recording = get_active_browseruse_recording(session_id)

	if cdp_recording:
		recording = cdp_recording
		recording_mode = 'cdp'
	elif playwright_recording:
		recording = playwright_recording
		recording_mode = 'playwright'
	elif browseruse_recording:
		recording = browseruse_recording
		recording_mode = 'browser_use'
	else:
		return RecordingStatusResponse(
			is_recording=False,
			session_id=session_id,
			steps_recorded=0,
		)

	try:
		state = await recording.stop()

		# Persist message for session history
		create_system_message(db, session_id, f"Recording stopped. {state.steps_recorded} steps recorded.")
		db.commit()

		return RecordingStatusResponse(
			is_recording=False,
			session_id=session_id,
			browser_session_id=state.browser_session_id,
			steps_recorded=state.steps_recorded,
			started_at=state.started_at,
			recording_mode=recording_mode,
		)
	except Exception as e:
		logger.error(f"Failed to stop recording for session {session_id}: {e}")
		raise HTTPException(status_code=500, detail=f"Failed to stop recording: {str(e)}")


@router.get("/sessions/{session_id}/recording/status", response_model=RecordingStatusResponse)
async def get_recording_status(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get current recording status for a session (checks all recording modes)."""
	from app.services.user_recording_service import get_active_recording
	from app.services.playwright_recording_service import get_active_playwright_recording
	from app.services.browseruse_recording_service import get_active_browseruse_recording

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Check all recording modes
	cdp_recording = get_active_recording(session_id)
	playwright_recording = get_active_playwright_recording(session_id)
	browseruse_recording = get_active_browseruse_recording(session_id)

	if cdp_recording:
		recording = cdp_recording
		recording_mode = 'cdp'
	elif playwright_recording:
		recording = playwright_recording
		recording_mode = 'playwright'
	elif browseruse_recording:
		recording = browseruse_recording
		recording_mode = 'browser_use'
	else:
		return RecordingStatusResponse(
			is_recording=False,
			session_id=session_id,
			steps_recorded=0,
		)

	state = recording.get_status()
	return RecordingStatusResponse(
		is_recording=state.is_active if state else False,
		session_id=session_id,
		browser_session_id=state.browser_session_id if state else None,
		steps_recorded=state.steps_recorded if state else 0,
		started_at=state.started_at if state else None,
		recording_mode=recording_mode,
	)


# ============================================
# Chat Message Endpoints
# ============================================

@router.get("/sessions/{session_id}/messages", response_model=list[ChatMessageResponse])
async def get_session_messages(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get all chat messages for a test session."""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	return session.messages


@router.post("/sessions/{session_id}/messages", response_model=ChatMessageResponse)
async def create_message(
	session_id: str,
	message: ChatMessageCreate,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Create a new chat message for a test session."""
	from sqlalchemy import func
	from app.models import ChatMessage

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Get next sequence number
	max_seq = db.query(func.max(ChatMessage.sequence_number)).filter(
		ChatMessage.session_id == session_id
	).scalar() or 0

	db_message = ChatMessage(
		session_id=session_id,
		message_type=message.message_type,
		content=message.content,
		mode=message.mode,
		sequence_number=max_seq + 1
	)
	db.add(db_message)
	db.commit()
	db.refresh(db_message)

	return db_message


@router.post("/sessions/{session_id}/reject", response_model=TestSessionResponse)
async def reject_plan(
	session_id: str,
	request: RejectPlanRequest = None,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Reject a plan and allow re-planning."""
	from app.models import ChatMessage
	from sqlalchemy import func

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	if session.status != "plan_ready":
		raise HTTPException(status_code=400, detail=f"Cannot reject plan in status: {session.status}")

	if not session.plan:
		raise HTTPException(status_code=400, detail="No plan to reject")

	# Update plan approval status
	reason = request.reason if request else None
	session.plan.approval_status = "rejected"
	session.plan.rejection_reason = reason

	# Create rejection message
	max_seq = db.query(func.max(ChatMessage.sequence_number)).filter(
		ChatMessage.session_id == session_id
	).scalar() or 0

	rejection_msg = ChatMessage(
		session_id=session_id,
		message_type="system",
		content=f"Plan rejected. {reason or 'You can describe a new test case.'}",
		sequence_number=max_seq + 1
	)
	db.add(rejection_msg)

	db.commit()
	db.refresh(session)

	return session


def create_system_message(db: Session, session_id: str, content: str) -> None:
	"""Helper to create a system message for a session."""
	from sqlalchemy import func
	from app.models import ChatMessage

	max_seq = db.query(func.max(ChatMessage.sequence_number)).filter(
		ChatMessage.session_id == session_id
	).scalar() or 0

	msg = ChatMessage(
		session_id=session_id,
		message_type="system",
		content=content,
		sequence_number=max_seq + 1
	)
	db.add(msg)


def create_plan_message(db: Session, session_id: str, plan_text: str, plan_id: str) -> None:
	"""Helper to create a plan message for a session."""
	from sqlalchemy import func
	from app.models import ChatMessage

	max_seq = db.query(func.max(ChatMessage.sequence_number)).filter(
		ChatMessage.session_id == session_id
	).scalar() or 0

	msg = ChatMessage(
		session_id=session_id,
		message_type="plan",
		content=plan_text,
		plan_id=plan_id,
		sequence_number=max_seq + 1
	)
	db.add(msg)


async def verify_token_from_query(token: str) -> AuthenticatedUser:
	"""Verify JWT token passed as query parameter (for img src URLs)."""
	from jose import JWTError, jwt
	from app.config import settings
	
	credentials_exception = HTTPException(
		status_code=401,
		detail="Could not validate credentials",
	)
	try:
		payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
		user_id: str = payload.get("sub")
		email: str = payload.get("email")
		org_id: str = payload.get("org_id")
		role: str = payload.get("role")
		if not all([user_id, email, org_id, role]):
			raise credentials_exception
	except JWTError:
		raise credentials_exception
	
	return AuthenticatedUser(
		id=user_id,
		email=email,
		name="",
		organization_id=org_id,
		organization_slug="",
		role=role
	)


@router.get("/screenshot")
async def get_screenshot(
	path: str,
	token: str,
):
	"""Serve a screenshot or video file from the configured directories.

	Token is passed as query parameter since img src URLs cannot set Authorization headers.
	Supports:
	- Screenshot files (.png) from screenshots directory
	- Video files (.webm, .mp4) from videos directory (when path starts with 'videos/')
	"""
	from app.config import settings

	# Verify token from query parameter
	await verify_token_from_query(token)

	# Check if this is a video request (path starts with 'videos/')
	if path.startswith("videos/"):
		# Serve from videos directory
		videos_dir = Path(settings.VIDEOS_DIR).resolve()
		# Remove 'videos/' prefix to get the actual filename
		video_filename = path[7:]  # len("videos/") = 7
		file_path = (videos_dir / video_filename).resolve()

		# Security: Ensure path doesn't escape videos directory
		if not str(file_path).startswith(str(videos_dir)):
			raise HTTPException(status_code=400, detail="Invalid path")

		if not file_path.exists():
			raise HTTPException(status_code=404, detail="Video not found")

		if not file_path.is_file():
			raise HTTPException(status_code=400, detail="Path is not a file")

		# Security check: ensure it's a video file
		if file_path.suffix.lower() not in [".webm", ".mp4"]:
			raise HTTPException(status_code=400, detail="Invalid file type")

		media_type = "video/webm" if file_path.suffix.lower() == ".webm" else "video/mp4"
		return FileResponse(
			path=file_path,
			media_type=media_type,
			filename=file_path.name,
		)
	else:
		# Serve from screenshots directory
		screenshots_dir = Path(settings.SCREENSHOTS_DIR).resolve()
		screenshot_path = (screenshots_dir / path).resolve()

		# Security: Ensure path doesn't escape screenshots directory
		if not str(screenshot_path).startswith(str(screenshots_dir)):
			raise HTTPException(status_code=400, detail="Invalid path")

		if not screenshot_path.exists():
			raise HTTPException(status_code=404, detail="Screenshot not found")

		if not screenshot_path.is_file():
			raise HTTPException(status_code=400, detail="Path is not a file")

		# Security check: ensure it's a PNG file
		if screenshot_path.suffix.lower() != ".png":
			raise HTTPException(status_code=400, detail="Invalid file type")

		return FileResponse(
			path=screenshot_path,
			media_type="image/png",
			filename=screenshot_path.name,
		)


@router.post("/sessions/{session_id}/end-browser")
async def end_browser_session(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""End the browser session for a test session without ending the test session itself.

	This is called when the user closes the test analysis page to clean up browser resources
	while keeping the session data intact.
	"""
	from app.services.browser_orchestrator import get_orchestrator, BrowserPhase

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	try:
		orchestrator = get_orchestrator()
		if orchestrator:
			# Find and stop browser sessions for this test session
			browser_sessions = await orchestrator.list_sessions(phase=BrowserPhase.ANALYSIS)
			for bs in browser_sessions:
				if bs.test_session_id == session_id:
					await orchestrator.stop_session(bs.id)
					logger.info(f"Ended browser session {bs.id} for test session {session_id}")
					break
		return {"status": "stopped", "message": "Browser session ended"}
	except Exception as e:
		logger.error(f"Error ending browser session for {session_id}: {e}")
		# Don't raise - browser cleanup is best-effort
		return {"status": "error", "message": str(e)}


# ============================================
# Celery Task Monitoring Endpoints
# ============================================

@router.get("/sessions/{session_id}/events", response_model=list[AnalysisEventResponse])
async def get_session_events(
	session_id: str,
	since: datetime | None = None,
	event_type: str | None = None,
	limit: int = 100,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get analysis events for a session.

	This endpoint returns events persisted to the database for reconnection/replay.
	Use the WebSocket 'subscribe_events' command for real-time streaming.

	Args:
		session_id: The test session ID
		since: Optional timestamp to get events after (for reconnection)
		event_type: Optional filter by event type
		limit: Maximum number of events to return (default 100)
	"""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	query = db.query(AnalysisEvent).filter(AnalysisEvent.session_id == session_id)

	if since:
		query = query.filter(AnalysisEvent.created_at > since)

	if event_type:
		query = query.filter(AnalysisEvent.event_type == event_type)

	events = query.order_by(AnalysisEvent.created_at).limit(limit).all()
	return [AnalysisEventResponse.model_validate(e) for e in events]


@router.get("/sessions/{session_id}/task/status", response_model=TaskStatusResponse)
async def get_task_status(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get current Celery task status for a session.

	Returns the status of any running task (plan generation, execution, etc.).
	This is useful for polling when WebSocket is not available.
	"""
	from app.celery_app import celery_app

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	# Check for plan generation task
	if session.plan_task_id:
		result = celery_app.AsyncResult(session.plan_task_id)
		task_status = result.status

		# Map Celery status to our status
		status_map = {
			"PENDING": "pending",
			"STARTED": "running",
			"SUCCESS": "completed",
			"FAILURE": "failed",
			"REVOKED": "cancelled",
		}

		return TaskStatusResponse(
			task_id=session.plan_task_id,
			task_type="plan_generation",
			status=status_map.get(task_status, "running"),
			progress=50 if task_status == "STARTED" else (100 if task_status == "SUCCESS" else 0),
			error=str(result.result) if task_status == "FAILURE" else None,
		)

	# Check for execution task
	if session.execution_task_id:
		result = celery_app.AsyncResult(session.execution_task_id)
		task_status = result.status

		status_map = {
			"PENDING": "pending",
			"STARTED": "running",
			"SUCCESS": "completed",
			"FAILURE": "failed",
			"REVOKED": "cancelled",
		}

		# Check if paused via Redis flag
		if check_stop_requested(session_id) and task_status == "STARTED":
			return TaskStatusResponse(
				task_id=session.execution_task_id,
				task_type="execution",
				status="paused",
				message="Execution paused by user",
			)

		return TaskStatusResponse(
			task_id=session.execution_task_id,
			task_type="execution",
			status=status_map.get(task_status, "running"),
			error=str(result.result) if task_status == "FAILURE" else None,
		)

	# No active task - return based on session status
	return TaskStatusResponse(
		task_id=None,
		task_type=None,
		status=session.status or "idle",
	)


@router.post("/sessions/{session_id}/task/cancel", response_model=CancelTaskResponse)
async def cancel_task(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Cancel any running Celery task for this session.

	This sets a cancellation flag that the Celery task checks periodically.
	The task will complete its current operation and then stop gracefully.
	"""
	from app.celery_app import celery_app

	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	task_id = session.plan_task_id or session.execution_task_id
	if not task_id:
		return CancelTaskResponse(
			success=False,
			message="No active task to cancel",
		)

	# Set cancellation flag in Redis
	set_cancelled(session_id)

	# Optionally revoke the Celery task (for plan generation which can be interrupted)
	if session.plan_task_id:
		celery_app.control.revoke(session.plan_task_id, terminate=True)
		session.plan_task_id = None
		session.status = "cancelled"
		db.commit()

	logger.info(f"Cancelled task {task_id} for session {session_id}")

	return CancelTaskResponse(
		success=True,
		message="Task cancellation requested",
		task_id=task_id,
	)


@router.post("/sessions/{session_id}/execution/stop")
async def stop_execution(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Stop test execution gracefully (pause).

	This sets a stop flag that the execution task checks after each step.
	The browser session remains alive for continuation.
	This does NOT cancel the Celery task - it signals graceful stop.
	"""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	if not session.execution_task_id:
		return {"success": False, "message": "No active execution to stop"}

	# Set stop flag in Redis (task will check this after each step)
	set_stop_requested(session_id)

	logger.info(f"Stop requested for execution in session {session_id}")

	return {"success": True, "message": "Stop requested - execution will pause after current step"}


# WebSocket connection manager
class ConnectionManager:
	def __init__(self):
		self.active_connections: dict[str, WebSocket] = {}

	async def connect(self, session_id: str, websocket: WebSocket):
		await websocket.accept()
		self.active_connections[session_id] = websocket
		logger.info(f"WebSocket connected for session {session_id}")

	def disconnect(self, session_id: str):
		if session_id in self.active_connections:
			del self.active_connections[session_id]
			logger.info(f"WebSocket disconnected for session {session_id}")

	async def send_message(self, session_id: str, message: dict[str, Any]):
		if session_id in self.active_connections:
			await self.active_connections[session_id].send_json(message)


manager = ConnectionManager()


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
	"""WebSocket endpoint for real-time test execution updates."""
	# Get database session
	db = next(get_db())

	try:
		# Verify session exists
		session = db.query(TestSession).filter(TestSession.id == session_id).first()
		if not session:
			await websocket.close(code=4004, reason="Session not found")
			return

		# Connect WebSocket
		await manager.connect(session_id, websocket)

		# Wait for start command
		while True:
			try:
				data = await websocket.receive_json()
				command = data.get("command")

				if command == "subscribe":
					# Send initial state on subscribe request
					include_initial = data.get("include_initial_state", True)
					if include_initial:
						db.refresh(session)
						steps = (
							db.query(TestStep)
							.filter(TestStep.session_id == session_id)
							.order_by(TestStep.step_number)
							.all()
						)

						# Build response with current session and all steps
						session_response = TestSessionResponse.model_validate(session)
						steps_response = [TestStepResponse.model_validate(s) for s in steps]

						await websocket.send_json(
							WSInitialState(
								session=session_response,
								steps=steps_response
							).model_dump(mode="json")
						)
						logger.info(f"Sent initial state for session {session_id}: {len(steps)} steps")

				elif command == "start":
					# Check if session is approved
					db.refresh(session)
					if session.status != "approved":
						await websocket.send_json(
							WSError(message=f"Cannot start execution in status: {session.status}").model_dump()
						)
						continue

					if not session.plan:
						await websocket.send_json(WSError(message="No plan found for session").model_dump())
						continue

					# Import dependencies
					import redis.asyncio as aioredis
					import json
					from app.config import settings
					from app.tasks.plan_execution import execute_test_plan

					# FIRST: Set up Redis subscription BEFORE queueing Celery task
					# This prevents race condition where events are published before subscription is ready
					logger.info(f"Setting up Redis subscription for session {session_id}")
					try:
						redis_client = aioredis.from_url(settings.CELERY_BROKER_URL)
						pubsub = redis_client.pubsub()
						await pubsub.subscribe(f"analysis_events:{session_id}")
						logger.info(f"Redis subscription ready for session {session_id}")
					except Exception as e:
						logger.error(f"Failed to set up Redis subscription: {e}")
						await websocket.send_json(WSError(message=f"Failed to set up event streaming: {e}").model_dump())
						continue

					# SECOND: Queue execution as Celery task
					logger.info(f"Queueing test execution for session {session_id}")
					task = execute_test_plan.delay(session_id)

					# Update session with task ID
					session.execution_task_id = task.id
					session.status = "running"
					db.commit()

					# Notify client that execution has been queued
					await websocket.send_json({
						"type": "execution_queued",
						"task_id": task.id,
						"message": "Test execution queued",
					})

					# THIRD: Stream events in background (subscription is already active)
					async def stream_execution_events():
						"""Stream execution events from Redis pub/sub to WebSocket."""
						try:
							async for message in pubsub.listen():
								if message["type"] == "message":
									try:
										event_data = json.loads(message["data"])
										logger.debug(f"Forwarding event to WebSocket: {event_data.get('type')}")
										await websocket.send_json(event_data)

										# Check if execution completed
										event_type = event_data.get("type", "")
										if event_type in ["completed", "execution_failed", "execution_cancelled", "error"]:
											logger.info(f"Execution finished for session {session_id}: {event_type}")
											break
									except json.JSONDecodeError:
										logger.warning(f"Invalid JSON in event: {message['data']}")
									except Exception as e:
										logger.error(f"Error sending event to WebSocket: {e}")
										break
						except Exception as e:
							logger.error(f"Error in execution event subscription for session {session_id}: {e}")
						finally:
							try:
								await pubsub.unsubscribe(f"analysis_events:{session_id}")
								await redis_client.close()
							except Exception:
								pass

					# Start streaming events in background
					asyncio.create_task(stream_execution_events())

				elif command == "ping":
					await websocket.send_json({"type": "pong"})

				elif command == "subscribe_events":
					# Subscribe to Redis pub/sub for real-time Celery task events
					import redis.asyncio as aioredis
					import json
					from app.config import settings

					logger.info(f"Starting event subscription for session {session_id}")

					async def stream_events():
						"""Stream events from Redis pub/sub to WebSocket."""
						try:
							r = aioredis.from_url(settings.CELERY_BROKER_URL)
							pubsub = r.pubsub()
							await pubsub.subscribe(f"analysis_events:{session_id}")

							async for message in pubsub.listen():
								if message["type"] == "message":
									try:
										event_data = json.loads(message["data"])
										await websocket.send_json(event_data)
									except json.JSONDecodeError:
										logger.warning(f"Invalid JSON in event: {message['data']}")
									except Exception as e:
										logger.error(f"Error sending event to WebSocket: {e}")
										break
						except Exception as e:
							logger.error(f"Error in event subscription for session {session_id}: {e}")
						finally:
							try:
								await pubsub.unsubscribe(f"analysis_events:{session_id}")
								await r.close()
							except Exception:
								pass

					# Start streaming in background
					asyncio.create_task(stream_events())
					await websocket.send_json({
						"type": "events_subscribed",
						"message": f"Subscribed to events for session {session_id}",
					})

				elif command == "inject_command":
					# Handle command injection during execution (user hints)
					content = data.get("content", "")
					if content:
						logger.info(f"Received inject_command for session {session_id}: {content}")
						# Push to Redis queue for agent to pick up
						from app.services.event_publisher import push_user_prompt
						success = push_user_prompt(session_id, content)
						# Acknowledge receipt
						await websocket.send_json({
							"type": "command_received",
							"content": content,
							"status": "queued" if success else "failed"
						})

				elif command == "run_till_end":
					# Start Run Till End execution in background task
					from app.services.run_till_end_service import (
						RunTillEndService,
						register_service,
						unregister_service,
					)

					db.refresh(session)
					logger.info(f"Starting Run Till End for session {session_id}")

					async def send_ws_message(msg: dict):
						await websocket.send_json(msg)

					service = RunTillEndService(db, session, send_ws_message)
					register_service(session_id, service)

					async def run_till_end_task():
						try:
							result = await service.execute()
							logger.info(f"Run Till End completed for session {session_id}: {result}")
						except Exception as e:
							logger.error(f"Run Till End error for session {session_id}: {e}")
						finally:
							unregister_service(session_id)

					asyncio.create_task(run_till_end_task())

				elif command == "skip_step":
					# Skip a failed step during Run Till End
					from app.services.run_till_end_service import get_active_service

					step_number = data.get("step_number")
					if step_number is None:
						await websocket.send_json(
							WSError(message="Missing step_number parameter").model_dump()
						)
						continue

					service = get_active_service(session_id)
					if service:
						await service.skip_step(step_number)
					else:
						await websocket.send_json(
							WSError(message="No active Run Till End execution").model_dump()
						)

				elif command == "continue_run_till_end":
					# Continue execution after skip
					from app.services.run_till_end_service import get_active_service

					service = get_active_service(session_id)
					if service:
						await service.continue_execution()
					else:
						await websocket.send_json(
							WSError(message="No active Run Till End execution").model_dump()
						)

				elif command == "cancel_run_till_end":
					# Cancel Run Till End execution
					from app.services.run_till_end_service import get_active_service

					service = get_active_service(session_id)
					if service:
						await service.cancel()
					else:
						await websocket.send_json(
							WSError(message="No active Run Till End execution").model_dump()
						)

				elif command == "pause_execution":
					# Pause AI execution (but keep browser alive)
					logger.info(f"Received pause_execution command for session {session_id}")
					from app.services.browser_service import get_active_browser_service
					from app.services.run_till_end_service import get_active_service as get_rte_service

					# Stop BrowserService execution
					browser_service = get_active_browser_service(session_id)
					if browser_service:
						browser_service.request_stop()
						logger.info(f"Pause requested for BrowserService session {session_id}")
					else:
						logger.info(f"No active BrowserService found for session {session_id}")

					# Also cancel Run Till End if active
					rte_service = get_rte_service(session_id)
					if rte_service:
						await rte_service.cancel()
						logger.info(f"Cancelled Run Till End for session {session_id}")
					else:
						logger.info(f"No active Run Till End service found for session {session_id}")

				elif command == "stop_all":
					# Stop execution AND terminate browser session
					logger.info(f"Received stop_all command for session {session_id}")
					from app.services.browser_service import get_active_browser_service
					from app.services.run_till_end_service import get_active_service as get_rte_service

					# Stop BrowserService execution
					browser_service = get_active_browser_service(session_id)
					if browser_service:
						browser_service.request_stop()
						logger.info(f"Stop requested for BrowserService session {session_id}")
					else:
						logger.info(f"No active BrowserService found for session {session_id}")

					# Cancel Run Till End if active
					rte_service = get_rte_service(session_id)
					if rte_service:
						await rte_service.cancel()
						logger.info(f"Cancelled Run Till End for session {session_id}")

					# Terminate browser session
					orchestrator = get_orchestrator()
					browser_stopped = False
					if orchestrator:
						sessions = await orchestrator.list_sessions(phase=BrowserPhase.ANALYSIS)
						logger.info(f"Found {len(sessions)} browser sessions, looking for test_session_id={session_id}")
						for browser_session in sessions:
							logger.info(f"Checking browser session {browser_session.id}, test_session_id={browser_session.test_session_id}")
							if str(browser_session.test_session_id) == session_id:
								await orchestrator.stop_session(browser_session.id)
								logger.info(f"Stopped browser session {browser_session.id}")
								browser_stopped = True
								break
						if not browser_stopped:
							logger.info(f"No browser session found for test session {session_id}")

					# Update session status
					db.refresh(session)
					session.status = "stopped"
					db.commit()
					logger.info(f"Session {session_id} status updated to 'stopped'")

					# Persist message for session history
					create_system_message(db, session_id, "Execution and browser stopped. Re-initialize to continue.")
					db.commit()

					# Notify frontend
					await websocket.send_json({
						"type": "all_stopped",
						"message": "Execution and browser session terminated. Re-initialize to continue.",
					})

			except WebSocketDisconnect:
				logger.info(f"WebSocket disconnected for session {session_id}")
				break
			except Exception as e:
				logger.error(f"Error in WebSocket handler: {e}")
				await websocket.send_json(WSError(message=str(e)).model_dump())

	except Exception as e:
		logger.error(f"WebSocket error: {e}")
	finally:
		manager.disconnect(session_id)
		db.close()
