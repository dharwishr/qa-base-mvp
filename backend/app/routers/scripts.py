"""
Scripts Router - API endpoints for Playwright scripts and test runs.

Endpoints:
- POST /scripts - Create a script from a completed session
- GET /scripts - List all scripts
- GET /scripts/{script_id} - Get script details
- DELETE /scripts/{script_id} - Delete a script
- POST /scripts/{script_id}/run - Start a test run
- GET /scripts/{script_id}/runs - List runs for a script
- GET /runs/{run_id} - Get run details
- GET /runs/{run_id}/steps - Get run steps with screenshots
"""

import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import PlaywrightScript, TestRun, RunStep, TestSession
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
	WSRunStepStarted,
	WSRunStepCompleted,
	WSRunCompleted,
)
from app.services.script_recorder import PlaywrightStep, ScriptRecorder
from app.services.base_runner import StepResult
from app.services.runner_factory import create_runner, RunnerType
from app.services.browser_orchestrator import get_orchestrator, BrowserPhase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scripts", tags=["scripts"])
runs_router = APIRouter(prefix="/runs", tags=["runs"])


@router.post("", response_model=PlaywrightScriptResponse)
async def create_script(request: CreateScriptRequest, db: Session = Depends(get_db)):
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
	
	return None


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
async def list_scripts(db: Session = Depends(get_db)):
	"""List all Playwright scripts."""
	scripts = db.query(PlaywrightScript).order_by(PlaywrightScript.created_at.desc()).all()
	
	result = []
	for script in scripts:
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
		))
	
	return result


@router.get("/{script_id}", response_model=PlaywrightScriptDetailResponse)
async def get_script(script_id: str, db: Session = Depends(get_db)):
	"""Get a script with its run history."""
	script = db.query(PlaywrightScript).filter(PlaywrightScript.id == script_id).first()
	if not script:
		raise HTTPException(status_code=404, detail="Script not found")
	
	return script


@router.delete("/{script_id}")
async def delete_script(script_id: str, db: Session = Depends(get_db)):
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
	db: Session = Depends(get_db)
):
	"""Start a test run for a script."""
	script = db.query(PlaywrightScript).filter(PlaywrightScript.id == script_id).first()
	if not script:
		raise HTTPException(status_code=404, detail="Script not found")

	# Validate runner type
	runner_type = request.runner.lower()
	if runner_type not in ["playwright", "cdp"]:
		raise HTTPException(status_code=400, detail=f"Invalid runner type: {runner_type}. Must be 'playwright' or 'cdp'")

	# Create run record with runner type and headless setting
	run = TestRun(
		script_id=script_id,
		status="pending",
		runner_type=runner_type,
		headless=request.headless,
		total_steps=len(script.steps_json),
	)
	db.add(run)
	db.commit()
	db.refresh(run)

	# TODO: Start async task for actual execution
	# For now, we'll run synchronously (in production, use Celery)

	return StartRunResponse(run_id=run.id, status="pending")


@router.get("/{script_id}/runs", response_model=list[TestRunResponse])
async def list_script_runs(script_id: str, db: Session = Depends(get_db)):
	"""List all runs for a script."""
	script = db.query(PlaywrightScript).filter(PlaywrightScript.id == script_id).first()
	if not script:
		raise HTTPException(status_code=404, detail="Script not found")
	
	return script.runs


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


# WebSocket for live run updates
@runs_router.websocket("/{run_id}/ws")
async def run_websocket(websocket: WebSocket, run_id: str, db: Session = Depends(get_db)):
	"""WebSocket endpoint for live run updates."""
	await websocket.accept()
	
	remote_session = None
	
	try:
		run = db.query(TestRun).filter(TestRun.id == run_id).first()
		if not run:
			await websocket.close(code=4004, reason="Run not found")
			return
		
		script = run.script
		if not script:
			await websocket.close(code=4004, reason="Script not found")
			return
		
		# Update run status
		run.status = "running"
		run.started_at = datetime.utcnow()
		db.commit()
		
		# Create remote browser session only for head mode (not headless)
		cdp_url = None
		remote_session = None

		if not run.headless:
			try:
				orchestrator = get_orchestrator()
				remote_session = await orchestrator.create_session(
					phase=BrowserPhase.EXECUTION,
					test_run_id=run_id,
				)
				cdp_url = remote_session.cdp_url

				# Send live view URL to frontend
				await websocket.send_json({
					"type": "browser_session_started",
					"session_id": remote_session.id,
					"cdp_url": cdp_url,
					"live_view_url": f"/browser/sessions/{remote_session.id}/view",
					"headless": False,
				})

				logger.info(f"Created remote browser session for run: {remote_session.id}")

			except Exception as e:
				logger.warning(f"Failed to create remote browser, falling back to headless: {e}")
		else:
			# Headless mode - notify frontend (no live view)
			await websocket.send_json({
				"type": "browser_session_started",
				"session_id": None,
				"headless": True,
			})
			logger.info("Running in headless mode (no live browser view)")
		
		# Define callbacks
		async def on_step_start(step_index: int, step: PlaywrightStep):
			msg = WSRunStepStarted(
				step_index=step_index,
				action=step.action,
				description=step.description,
			)
			await websocket.send_json(msg.model_dump(mode="json"))

		async def on_step_complete(step_index: int, result: StepResult):
			# Save to database
			run_step = RunStep(
				run_id=run_id,
				step_index=step_index,
				action=result.action,
				status=result.status,
				selector_used=result.selector_used,
				screenshot_path=result.screenshot_path,
				duration_ms=result.duration_ms,
				error_message=result.error_message,
				heal_attempts=[ha.__dict__ for ha in result.heal_attempts] if result.heal_attempts else None,
			)
			db.add(run_step)
			db.commit()
			db.refresh(run_step)

			msg = WSRunStepCompleted(step=RunStepResponse.model_validate(run_step))
			await websocket.send_json(msg.model_dump(mode="json"))

		# Get runner type from the run record
		runner_type = RunnerType(run.runner_type or "playwright")

		# Create steps from JSON
		steps = [PlaywrightStep(**step) for step in script.steps_json]
		logger.info(f"Created {len(steps)} steps for run {run_id}")

		# Validate steps
		if not steps:
			error_msg = "No steps to execute - script has no valid steps"
			logger.error(error_msg)
			await websocket.send_json({"type": "error", "message": error_msg})
			run.status = "failed"
			run.error_message = error_msg
			db.commit()
			return

		# Log step details for debugging
		for i, step in enumerate(steps):
			logger.debug(f"Step {i}: action={step.action}, description={step.description}")

		# Run the script using the appropriate runner (with remote CDP if available)
		logger.info(f"Creating {runner_type.value} runner with CDP URL: {cdp_url}")
		try:
			async with create_runner(
				runner_type=runner_type,
				headless=True,
				on_step_start=on_step_start,
				on_step_complete=on_step_complete,
				cdp_url=cdp_url,
			) as runner:
				logger.info(f"Runner created successfully, starting execution of {len(steps)} steps")
				result = await runner.run(steps, run_id)
				logger.info(f"Runner execution completed with status: {result.status}")
		except Exception as runner_error:
			error_msg = f"Runner execution failed: {str(runner_error)}"
			logger.exception(error_msg)
			await websocket.send_json({"type": "error", "message": error_msg})
			run.status = "failed"
			run.error_message = error_msg
			run.completed_at = datetime.utcnow()
			db.commit()
			raise
		
		# Update run with final status
		run.status = result.status
		run.completed_at = result.completed_at
		run.passed_steps = result.passed_steps
		run.failed_steps = result.failed_steps
		run.healed_steps = result.healed_steps
		run.error_message = result.error_message
		db.commit()
		db.refresh(run)
		
		# Send completion message
		msg = WSRunCompleted(run=TestRunResponse.model_validate(run))
		await websocket.send_json(msg.model_dump(mode="json"))
		
	except WebSocketDisconnect:
		logger.info(f"WebSocket disconnected for run {run_id}")
	except Exception as e:
		logger.exception(f"Error in run WebSocket: {e}")
		try:
			await websocket.send_json({"type": "error", "message": str(e)})
		except Exception:
			pass
	finally:
		# Clean up remote browser session
		if remote_session:
			try:
				orchestrator = get_orchestrator()
				await orchestrator.stop_session(remote_session.id)
				logger.info(f"Stopped remote browser session: {remote_session.id}")
			except Exception as e:
				logger.error(f"Error stopping remote browser session: {e}")
		
		try:
			await websocket.close()
		except Exception:
			pass
