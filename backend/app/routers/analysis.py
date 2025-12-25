import asyncio
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TestPlan, TestSession, TestStep
from app.schemas import (
	CreateSessionRequest,
	ExecuteResponse,
	ExecutionLogResponse,
	TestPlanResponse,
	TestSessionDetailResponse,
	TestSessionListResponse,
	TestSessionResponse,
	TestStepResponse,
	WSError,
)
from app.services.plan_service import generate_plan

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.get("/sessions", response_model=list[TestSessionListResponse])
async def list_sessions(db: Session = Depends(get_db)):
	"""Get all test sessions ordered by creation date (newest first)."""
	from sqlalchemy import func

	# Query sessions with step count
	sessions = db.query(
		TestSession,
		func.count(TestStep.id).label('step_count')
	).outerjoin(TestStep).group_by(TestSession.id).order_by(TestSession.created_at.desc()).all()

	# Convert to response format
	result = []
	for session, step_count in sessions:
		result.append(TestSessionListResponse(
			id=session.id,
			prompt=session.prompt,
			llm_model=session.llm_model,
			status=session.status,
			created_at=session.created_at,
			updated_at=session.updated_at,
			step_count=step_count
		))
	return result


@router.post("/sessions", response_model=TestSessionResponse)
async def create_session(request: CreateSessionRequest, db: Session = Depends(get_db)):
	"""Create a new test session and generate a plan."""
	# Create session with selected LLM model
	session = TestSession(
		prompt=request.prompt,
		llm_model=request.llm_model,
		status="pending_plan"
	)
	db.add(session)
	db.commit()
	db.refresh(session)

	# Generate plan asynchronously
	try:
		plan = await generate_plan(db, session)
		db.refresh(session)
	except Exception as e:
		logger.error(f"Error generating plan: {e}")
		session.status = "failed"
		db.commit()
		raise HTTPException(status_code=500, detail=f"Failed to generate plan: {str(e)}")

	return session


@router.get("/sessions/{session_id}", response_model=TestSessionDetailResponse)
async def get_session(session_id: str, db: Session = Depends(get_db)):
	"""Get a test session by ID with all details."""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")
	return session


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, db: Session = Depends(get_db)):
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
		db.query(TestPlan).filter(TestPlan.session_id == session_id).delete(synchronize_session=False)

	# Expunge session to avoid stale data errors
	db.expunge(session)
	
	# Delete the session itself
	db.query(TestSession).filter(TestSession.id == session_id).delete(synchronize_session=False)
	db.commit()


@router.get("/sessions/{session_id}/plan", response_model=TestPlanResponse)
async def get_session_plan(session_id: str, db: Session = Depends(get_db)):
	"""Get the plan for a test session."""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	if not session.plan:
		raise HTTPException(status_code=404, detail="Plan not found")

	return session.plan


@router.post("/sessions/{session_id}/approve", response_model=TestSessionResponse)
async def approve_plan(session_id: str, db: Session = Depends(get_db)):
	"""Approve a plan and mark session as ready for execution."""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	if session.status != "plan_ready":
		raise HTTPException(status_code=400, detail=f"Cannot approve plan in status: {session.status}")

	session.status = "approved"
	db.commit()
	db.refresh(session)

	return session


@router.post("/sessions/{session_id}/execute", response_model=ExecuteResponse)
async def start_execution(session_id: str, db: Session = Depends(get_db)):
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


@router.get("/sessions/{session_id}/logs", response_model=list[ExecutionLogResponse])
async def get_session_logs(
	session_id: str,
	level: str | None = None,
	db: Session = Depends(get_db),
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
async def get_session_steps(session_id: str, db: Session = Depends(get_db)):
	"""Get all steps for a test session."""
	session = db.query(TestSession).filter(TestSession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")

	return session.steps


@router.delete("/sessions/{session_id}/steps", status_code=204)
async def clear_session_steps(session_id: str, db: Session = Depends(get_db)):
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


@router.get("/screenshot")
async def get_screenshot(path: str):
	"""Serve a screenshot file from the configured screenshots directory."""
	from app.config import settings

	# Resolve path relative to screenshots directory
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

				if command == "start":
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

					# Start execution
					logger.info(f"Starting test execution for session {session_id}")
					from app.services.browser_service import execute_test

					await execute_test(db, session, session.plan, websocket)
					break

				elif command == "ping":
					await websocket.send_json({"type": "pong"})

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
