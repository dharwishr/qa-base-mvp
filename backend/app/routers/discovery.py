"""
API router for module discovery.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, HttpUrl
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthenticatedUser, get_current_user, require_auth
from app.models import DiscoverySession, DiscoveredModule
from app.tasks.discovery import run_module_discovery

router = APIRouter(
	prefix="/api/discovery",
	tags=["discovery"],
	dependencies=[Depends(require_auth)],
)


# ============ Schemas ============

class CreateDiscoveryRequest(BaseModel):
	url: str
	username: str | None = None
	password: str | None = None
	max_steps: int = 20


class DiscoveredModuleResponse(BaseModel):
	id: str
	name: str
	url: str
	summary: str
	created_at: str

	model_config = {"from_attributes": True}


class DiscoverySessionResponse(BaseModel):
	id: str
	url: str
	username: str | None
	max_steps: int
	status: str
	total_steps: int
	duration_seconds: float
	error: str | None
	created_at: str
	updated_at: str
	modules: list[DiscoveredModuleResponse] = []

	model_config = {"from_attributes": True}


class DiscoverySessionListItem(BaseModel):
	id: str
	url: str
	status: str
	total_steps: int
	duration_seconds: float
	module_count: int
	created_at: str

	model_config = {"from_attributes": True}


class CreateDiscoveryResponse(BaseModel):
	session_id: str
	status: str
	message: str


# ============ Endpoints ============

@router.post("/sessions", response_model=CreateDiscoveryResponse, status_code=status.HTTP_201_CREATED)
async def create_discovery_session(
	request: CreateDiscoveryRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Create a new discovery session and queue the Celery task."""
	# Create session
	session = DiscoverySession(
		url=request.url,
		username=request.username,
		password=request.password,
		max_steps=request.max_steps,
		status="queued",
		organization_id=current_user.organization_id,
		user_id=current_user.id,
	)
	db.add(session)
	db.commit()
	db.refresh(session)

	# Queue Celery task
	task = run_module_discovery.delay(session.id)
	session.celery_task_id = task.id
	db.commit()

	return CreateDiscoveryResponse(
		session_id=session.id,
		status="queued",
		message="Discovery task queued successfully",
	)


@router.get("/sessions", response_model=list[DiscoverySessionListItem])
async def list_discovery_sessions(
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""List all discovery sessions ordered by creation date (newest first)."""
	sessions = (
		db.query(DiscoverySession)
		.filter(DiscoverySession.organization_id == current_user.organization_id)
		.order_by(DiscoverySession.created_at.desc())
		.all()
	)

	result = []
	for session in sessions:
		result.append(DiscoverySessionListItem(
			id=session.id,
			url=session.url,
			status=session.status,
			total_steps=session.total_steps,
			duration_seconds=session.duration_seconds,
			module_count=len(session.modules),
			created_at=session.created_at.isoformat(),
		))
	return result


@router.get("/sessions/{session_id}", response_model=DiscoverySessionResponse)
async def get_discovery_session(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get a discovery session with its discovered modules."""
	session = db.query(DiscoverySession).filter(DiscoverySession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Discovery session not found")

	return DiscoverySessionResponse(
		id=session.id,
		url=session.url,
		username=session.username,
		max_steps=session.max_steps,
		status=session.status,
		total_steps=session.total_steps,
		duration_seconds=session.duration_seconds,
		error=session.error,
		created_at=session.created_at.isoformat(),
		updated_at=session.updated_at.isoformat(),
		modules=[
			DiscoveredModuleResponse(
				id=m.id,
				name=m.name,
				url=m.url,
				summary=m.summary,
				created_at=m.created_at.isoformat(),
			)
			for m in session.modules
		],
	)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_discovery_session(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Delete a discovery session and its modules."""
	session = db.query(DiscoverySession).filter(DiscoverySession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Discovery session not found")

	db.delete(session)
	db.commit()
	return None


@router.get("/sessions/{session_id}/modules", response_model=list[DiscoveredModuleResponse])
async def get_session_modules(
	session_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get all discovered modules for a session."""
	session = db.query(DiscoverySession).filter(DiscoverySession.id == session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Discovery session not found")

	return [
		DiscoveredModuleResponse(
			id=m.id,
			name=m.name,
			url=m.url,
			summary=m.summary,
			created_at=m.created_at.isoformat(),
		)
		for m in session.modules
	]
