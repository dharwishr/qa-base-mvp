"""
Scripts Router - API endpoints for Playwright scripts and test runs.

Endpoints:
- POST /scripts - Create a script from a completed session
- GET /scripts - List all scripts
- GET /scripts/{script_id} - Get script details
- DELETE /scripts/{script_id} - Delete a script
- POST /scripts/{script_id}/run - Start a test run (via Celery/container pool)
- GET /scripts/{script_id}/runs - List runs for a script
- GET /runs/{run_id} - Get run details
- GET /runs/{run_id}/steps - Get run steps with screenshots
- WS /runs/{run_id}/ws - WebSocket for run status polling
"""

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from app.services.live_logs import LiveLogsSubscriber
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthenticatedUser, get_current_user
from app.models import PlaywrightScript, TestRun, RunStep, TestSession, User
from app.tasks.test_runs import execute_test_run
from app.schemas import (
	CreateScriptRequest,
	PlaywrightScriptResponse,
	PlaywrightScriptListResponse,
	PlaywrightScriptDetailResponse,
	TestRunResponse,
	TestRunDetailResponse,
	RunStepResponse,
	StartRunRequest,
	StartRunResponse,
	NetworkRequestResponse,
	ConsoleLogResponse,
	Resolution,
)
from app.services.script_recorder import ScriptRecorder


def _parse_resolution(resolution: Resolution) -> tuple[int, int]:
	"""Parse resolution enum to width, height tuple."""
	if resolution == Resolution.FHD:
		return (1920, 1080)
	elif resolution == Resolution.HD:
		return (1366, 768)
	elif resolution == Resolution.WXGA:
		return (1600, 900)
	return (1920, 1080)  # Default

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scripts", tags=["scripts"])
runs_router = APIRouter(prefix="/runs", tags=["runs"])


@router.post("", response_model=PlaywrightScriptResponse)
async def create_script(
	request: CreateScriptRequest,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Create a Playwright script from a completed test session."""
	session = db.query(TestSession).filter(TestSession.id == request.session_id).first()
	if not session:
		raise HTTPException(status_code=404, detail="Session not found")
	
	if session.status not in ("completed", "stopped"):
		raise HTTPException(status_code=400, detail="Session must be completed or stopped to generate script")
	
	# Check if script with this name already exists for this session
	existing = db.query(PlaywrightScript).filter(
		PlaywrightScript.session_id == request.session_id,
		PlaywrightScript.name == request.name
	).first()
	if existing:
		raise HTTPException(status_code=400, detail="Script with this name already exists for this session")
	
	# Get recorded steps from session's StepActions
	steps_json = _extract_steps_from_session(session)
	
	if not steps_json:
		raise HTTPException(status_code=400, detail="No recorded steps found in session")
	
	script = PlaywrightScript(
		session_id=request.session_id,
		name=request.name,
		description=request.description,
		steps_json=steps_json,
		organization_id=current_user.organization_id,
		user_id=current_user.id,
	)
	db.add(script)
	db.commit()
	db.refresh(script)
	
	return script


def _extract_steps_from_session(session: TestSession) -> list[dict[str, Any]]:
	"""Extract Playwright steps from a completed session's actions."""
	steps = []
	step_index = 0
	
	for test_step in session.steps:
		for action in test_step.actions:
			# Skip failed actions (e.g. failed assertions that were later retried)
			if action.result_success is False:
				continue

			playwright_step = _convert_action_to_playwright_step(action, step_index, test_step.url)
			if playwright_step:
				steps.append(playwright_step)
				step_index += 1
	
	return steps


def _convert_action_to_playwright_step(action, index: int, url: str | None) -> dict[str, Any] | None:
	"""Convert a StepAction to a PlaywrightStep dict."""
	action_name = action.action_name.lower()
	params = action.action_params or {}
	
	# Map browser-use actions to Playwright actions
	if "navigate" in action_name or "goto" in action_name:
		return {
			"index": index,
			"action": "goto",
			"url": params.get("url", url),
			"wait_for": "domcontentloaded",
			"description": f"Navigate to {params.get('url', url)}",
		}
	
	elif "click" in action_name:
		selectors = _build_selectors(action)
		return {
			"index": index,
			"action": "click",
			"selectors": selectors,
			"element_context": _build_element_context(action),
			"description": action.element_name or "Click element",
		}
	
	elif "input" in action_name or "type" in action_name or "fill" in action_name:
		selectors = _build_selectors(action)
		return {
			"index": index,
			"action": "fill",
			"selectors": selectors,
			"value": params.get("text", ""),
			"element_context": _build_element_context(action),
			"description": f"Fill with '{params.get('text', '')[:20]}'",
		}
	
	elif "scroll" in action_name:
		return {
			"index": index,
			"action": "scroll",
			"direction": "down" if params.get("down", True) else "up",
			"amount": int(params.get("pages", 1) * 500),
			"description": "Scroll page",
		}
	
	elif "wait" in action_name:
		return {
			"index": index,
			"action": "wait",
			"timeout": params.get("seconds", 1) * 1000,
			"description": f"Wait {params.get('seconds', 1)} seconds",
		}
	
	elif "select" in action_name:
		selectors = _build_selectors(action)
		return {
			"index": index,
			"action": "select",
			"selectors": selectors,
			"value": params.get("value", ""),
			"description": f"Select '{params.get('value', '')}'",
		}
	
	# Handle assertion/verification actions
	elif action_name.startswith("assert") or "verify" in action_name:
		return _convert_assert_action(action, index)
	
	return None


def _convert_assert_action(action, index: int) -> dict[str, Any] | None:
	"""Convert assertion actions to PlaywrightStep format."""
	action_name = action.action_name.lower()
	params = action.action_params or {}
	
	# Assert text visible
	if "text" in action_name:
		expected_text = params.get("text", "")
		partial_match = params.get("partial_match", True)
		return {
			"index": index,
			"action": "assert",
			"assertion": {
				"assertion_type": "text_visible",
				"expected_value": expected_text,
				"partial_match": partial_match,
				"case_sensitive": not partial_match,
			},
			"description": f"Assert text visible: '{expected_text[:40]}...'" if len(expected_text) > 40 else f"Assert text visible: '{expected_text}'",
		}
	
	# Assert element visible
	elif "element" in action_name or "visible" in action_name:
		selectors = _build_selectors(action) if action.element_xpath else None
		return {
			"index": index,
			"action": "assert",
			"selectors": selectors,
			"assertion": {
				"assertion_type": "element_visible",
			},
			"element_context": _build_element_context(action),
			"description": action.element_name or "Assert element is visible",
		}
	
	# Assert URL
	elif "url" in action_name:
		expected_url = params.get("url", "")
		exact_match = params.get("exact_match", False)
		return {
			"index": index,
			"action": "assert",
			"assertion": {
				"assertion_type": "url_contains" if not exact_match else "url_equals",
				"expected_value": expected_url,
				"partial_match": not exact_match,
			},
			"description": f"Assert URL {'contains' if not exact_match else 'equals'}: {expected_url}",
		}
	
	# Assert value
	elif "value" in action_name:
		expected_value = params.get("value", "")
		selectors = _build_selectors(action) if action.element_xpath else None
		return {
			"index": index,
			"action": "assert",
			"selectors": selectors,
			"assertion": {
				"assertion_type": "value_equals",
				"expected_value": expected_value,
			},
			"element_context": _build_element_context(action),
			"description": f"Assert value equals: '{expected_value}'",
		}
	
	# Generic assertion (fallback)
	return {
		"index": index,
		"action": "assert",
		"assertion": {
			"assertion_type": "text_visible",
			"expected_value": action.extracted_content or "",
			"partial_match": True,
		},
		"description": action.element_name or "Verify assertion",
	}


def _build_selectors(action) -> dict[str, Any]:
	"""Build selector set from action."""
	primary = action.element_xpath or "body"
	fallbacks = []
	
	# Add CSS selector if we can derive it
	params = action.action_params or {}
	if params.get("css_selector"):
		fallbacks.append(params["css_selector"])
	
	return {
		"primary": f"xpath={primary}" if not primary.startswith("xpath=") else primary,
		"fallbacks": fallbacks,
	}


def _build_element_context(action) -> dict[str, Any] | None:
	"""Build element context from action."""
	params = action.action_params or {}
	
	return {
		"tag_name": params.get("tag_name", "element"),
		"text_content": action.element_name,
		"aria_label": params.get("aria_label"),
		"placeholder": params.get("placeholder"),
	}


@router.get("", response_model=list[PlaywrightScriptListResponse])
async def list_scripts(
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""List all Playwright scripts."""
	scripts = db.query(
		PlaywrightScript,
		User.name.label('user_name')
	).outerjoin(
		User, PlaywrightScript.user_id == User.id
	).filter(
		PlaywrightScript.organization_id == current_user.organization_id
	).order_by(PlaywrightScript.created_at.desc()).all()

	result = []
	for script, user_name in scripts:
		step_count = len(script.steps_json) if script.steps_json else 0
		run_count = len(script.runs) if script.runs else 0
		last_run_status = script.runs[0].status if script.runs else None

		result.append(PlaywrightScriptListResponse(
			id=script.id,
			session_id=script.session_id,
			name=script.name,
			description=script.description,
			step_count=step_count,
			run_count=run_count,
			last_run_status=last_run_status,
			created_at=script.created_at,
			updated_at=script.updated_at,
			user_name=user_name,
		))

	return result


@router.get("/{script_id}", response_model=PlaywrightScriptDetailResponse)
async def get_script(
	script_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Get a script with its run history."""
	script = db.query(PlaywrightScript).filter(PlaywrightScript.id == script_id).first()
	if not script:
		raise HTTPException(status_code=404, detail="Script not found")
	
	return script


@router.delete("/{script_id}")
async def delete_script(
	script_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Delete a script and its runs."""
	script = db.query(PlaywrightScript).filter(PlaywrightScript.id == script_id).first()
	if not script:
		raise HTTPException(status_code=404, detail="Script not found")
	
	db.delete(script)
	db.commit()
	
	return {"status": "deleted"}


@router.post("/{script_id}/run", response_model=StartRunResponse)
async def start_run(
	script_id: str,
	request: StartRunRequest = StartRunRequest(),
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Start a test run for a script using containerized browser pool.

	All runs are executed asynchronously via Celery using pre-warmed browser containers.
	This provides consistent, scalable execution across all browser types.
	"""
	script = db.query(PlaywrightScript).filter(PlaywrightScript.id == script_id).first()
	if not script:
		raise HTTPException(status_code=404, detail="Script not found")

	# Parse resolution
	width, height = _parse_resolution(request.resolution)

	# Create run record with full configuration
	run = TestRun(
		script_id=script_id,
		user_id=current_user.id,
		status="queued",
		runner_type="playwright",  # Always use Playwright runner with container pool
		headless=True,  # Container browsers are always headless
		total_steps=len(script.steps_json),
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

	# Always dispatch to Celery task queue (container pool execution)
	task = execute_test_run.delay(run.id)
	celery_task_id = task.id
	run.celery_task_id = celery_task_id
	db.commit()

	logger.info(f"Created test run {run.id} with config: browser={run.browser_type}, resolution={width}x{height}, "
				f"screenshots={run.screenshots_enabled}, recording={run.recording_enabled}, "
				f"network={run.network_recording_enabled}, performance={run.performance_metrics_enabled}")
	logger.info(f"Dispatched test run {run.id} to Celery task {celery_task_id}")

	return StartRunResponse(
		run_id=run.id,
		status="queued",
		celery_task_id=celery_task_id
	)


@router.get("/{script_id}/runs", response_model=list[TestRunResponse])
async def list_script_runs(
	script_id: str,
	db: Session = Depends(get_db),
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""List all runs for a script."""
	from app.models import User
	
	script = db.query(PlaywrightScript).filter(PlaywrightScript.id == script_id).first()
	if not script:
		raise HTTPException(status_code=404, detail="Script not found")
	
	# Query runs with user information
	runs = db.query(
		TestRun,
		User.name.label('user_name'),
		User.email.label('user_email')
	).filter(
		TestRun.script_id == script_id
	).outerjoin(User, TestRun.user_id == User.id).order_by(TestRun.created_at.desc()).all()
	
	# Convert to response format
	result = []
	for run, user_name, user_email in runs:
		run_dict = TestRunResponse.model_validate(run).model_dump()
		run_dict['user_name'] = user_name
		run_dict['user_email'] = user_email
		result.append(TestRunResponse(**run_dict))
	
	return result


# Runs router
@runs_router.get("/{run_id}", response_model=TestRunDetailResponse)
async def get_run(run_id: str, db: Session = Depends(get_db)):
	"""Get a run with its steps."""
	run = db.query(TestRun).filter(TestRun.id == run_id).first()
	if not run:
		raise HTTPException(status_code=404, detail="Run not found")
	
	return run


@runs_router.get("/{run_id}/steps", response_model=list[RunStepResponse])
async def get_run_steps(run_id: str, db: Session = Depends(get_db)):
	"""Get all steps for a run."""
	run = db.query(TestRun).filter(TestRun.id == run_id).first()
	if not run:
		raise HTTPException(status_code=404, detail="Run not found")
	
	return run.run_steps


# WebSocket for run status polling with live logs
@runs_router.websocket("/{run_id}/ws")
async def run_websocket(websocket: WebSocket, run_id: str, db: Session = Depends(get_db)):
	"""WebSocket endpoint for polling run status updates with live network/console logs.

	Runs are executed via Celery using the container pool.
	This WebSocket provides real-time status updates by polling the database
	and streaming live network requests and console logs via Redis pub/sub.
	"""
	await websocket.accept()
	live_subscriber = None

	try:
		run = db.query(TestRun).filter(TestRun.id == run_id).first()
		if not run:
			await websocket.close(code=4004, reason="Run not found")
			return

		last_step_count = 0
		last_status = run.status

		# Send initial status
		await websocket.send_json({
			"type": "run_status",
			"status": run.status,
			"passed_steps": run.passed_steps or 0,
			"failed_steps": run.failed_steps or 0,
			"total_steps": run.total_steps or 0,
		})

		# Subscribe to live logs
		live_subscriber = LiveLogsSubscriber(run_id)
		await live_subscriber.connect()

		# Poll for updates until run completes
		while run.status in ("queued", "pending", "running"):
			# Check for live log messages (non-blocking)
			live_msg = await live_subscriber.get_message(timeout=0.5)
			if live_msg:
				await websocket.send_json(live_msg)

			# Refresh run from database
			db.refresh(run)

			# Check for new steps
			current_step_count = len(run.run_steps)
			if current_step_count > last_step_count:
				# Send new step updates
				for step in run.run_steps[last_step_count:]:
					await websocket.send_json({
						"type": "run_step_completed",
						"step": RunStepResponse.model_validate(step).model_dump(mode="json"),
					})
				last_step_count = current_step_count

			# Check for status change
			if run.status != last_status:
				await websocket.send_json({
					"type": "run_status",
					"status": run.status,
					"passed_steps": run.passed_steps or 0,
					"failed_steps": run.failed_steps or 0,
					"total_steps": run.total_steps or 0,
				})
				last_status = run.status

		# Send final completion message
		await websocket.send_json({
			"type": "run_completed",
			"run": TestRunResponse.model_validate(run).model_dump(mode="json"),
		})

	except WebSocketDisconnect:
		logger.info(f"WebSocket disconnected for run {run_id}")
	except Exception as e:
		logger.exception(f"Error in run WebSocket: {e}")
		try:
			await websocket.send_json({"type": "error", "message": str(e)})
		except Exception:
			pass
	finally:
		if live_subscriber:
			await live_subscriber.close()
		try:
			await websocket.close()
		except Exception:
			pass


# New endpoints for network requests and console logs
@runs_router.get("/{run_id}/network", response_model=list[NetworkRequestResponse])
async def get_run_network_requests(run_id: str, db: Session = Depends(get_db)):
	"""Get all network requests captured during a test run."""
	run = db.query(TestRun).filter(TestRun.id == run_id).first()
	if not run:
		raise HTTPException(status_code=404, detail="Run not found")

	return run.network_requests


@runs_router.get("/{run_id}/console", response_model=list[ConsoleLogResponse])
async def get_run_console_logs(
	run_id: str,
	level: str | None = None,
	db: Session = Depends(get_db)
):
	"""
	Get browser console logs from a test run.

	Args:
		run_id: The test run ID
		level: Optional filter by log level (log, info, warn, error, debug)
	"""
	run = db.query(TestRun).filter(TestRun.id == run_id).first()
	if not run:
		raise HTTPException(status_code=404, detail="Run not found")

	if level:
		# Filter by level
		return [log for log in run.console_logs if log.level == level.lower()]

	return run.console_logs


@runs_router.get("/{run_id}/video")
async def get_run_video(run_id: str, db: Session = Depends(get_db)):
	"""Get video recording metadata for a test run."""
	run = db.query(TestRun).filter(TestRun.id == run_id).first()
	if not run:
		raise HTTPException(status_code=404, detail="Run not found")

	if not run.video_path:
		raise HTTPException(status_code=404, detail="No video recording available for this run")

	return {
		"run_id": run_id,
		"video_path": run.video_path,
		"video_url": f"/api/analysis/screenshot?path=videos/{run.video_path.split('/')[-1]}",
		"recording_enabled": run.recording_enabled,
	}
