# Plan: Convert All Test Case Analysis Flows to Celery Tasks

## Overview

Convert **all** test case analysis flows from FastAPI async execution to Celery background tasks, enabling scalability, reliability, resource isolation, and persistent DB logging for live display.

## Current vs Target Architecture

| Flow | Current | Target |
|------|---------|--------|
| Plan Generation | `asyncio.create_task()` in FastAPI | **Celery task** |
| Plan Execution | `asyncio.create_task(execute_test())` in FastAPI | **Celery task** |
| Act Mode | `BrowserServiceSync.execute_act_mode()` in FastAPI | **Celery task** |
| Run Till End | `asyncio.create_task(RunTillEndService.execute())` in FastAPI | **Celery task** |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     USER ACTION                              │
│  Create Session │ Execute Plan │ Act Mode │ Run Till End    │
└───────────────────────────────────────────────────────────────
         │              │             │              │
         ▼              ▼             ▼              ▼
    Queue Celery   Queue Celery  Queue Celery   Queue Celery
         │              │             │              │
         ▼              ▼             ▼              ▼
┌────────────────────────────────────────────────────────────┐
│                    CELERY WORKERS                           │
│  generate_plan │ execute_plan │ execute_act │ run_till_end │
└────────────────────────────────────────────────────────────┘
         │              │             │              │
         ▼              ▼             ▼              ▼
┌────────────────────────────────────────────────────────────┐
│                    DATABASE (Persistence)                   │
│  AnalysisEvent table - logs ALL events for replay/live view│
└────────────────────────────────────────────────────────────┘
         │              │             │              │
         ▼              ▼             ▼              ▼
┌────────────────────────────────────────────────────────────┐
│                    REDIS PUB/SUB                            │
│  Channels per session_id for real-time streaming           │
└────────────────────────────────────────────────────────────┘
         │              │             │              │
         ▼              ▼             ▼              ▼
┌────────────────────────────────────────────────────────────┐
│                    FASTAPI WEBSOCKET                        │
│  Subscribes to Redis, forwards events to frontend          │
└────────────────────────────────────────────────────────────┘
         │
         ▼
    FRONTEND (Live UI)
```

---

## Files to Create

### 1. `backend/app/tasks/plan_generation.py`
Celery task for plan generation:
```python
@celery_app.task(bind=True, name="generate_test_plan", autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def generate_test_plan(self, session_id: str, task_prompt: str | None = None, is_continuation: bool = False, llm_model: str = "gemini-2.5-flash") -> dict
```

### 2. `backend/app/tasks/plan_execution.py`
Celery task for plan execution (replaces inline `execute_test()`):
```python
@celery_app.task(bind=True, name="execute_test_plan")
def execute_test_plan(self, session_id: str) -> dict
```

### 3. `backend/app/tasks/act_mode.py`
Celery task for act mode:
```python
@celery_app.task(bind=True, name="execute_act_mode")
def execute_act_mode(self, session_id: str, task: str, previous_context: str | None = None) -> dict
```

### 4. `backend/app/tasks/run_till_end.py`
Celery task for run-till-end:
```python
@celery_app.task(bind=True, name="run_till_end")
def run_till_end(self, session_id: str) -> dict
```

### 5. `backend/app/services/event_publisher.py`
Unified event publisher for DB logging + Redis pub/sub:
```python
class AnalysisEventPublisher:
    def __init__(self, db: Session, session_id: str):
        self.db = db
        self.session_id = session_id
        self.redis = redis.from_url(settings.CELERY_BROKER_URL)
        self.channel = f"analysis_events:{session_id}"

    def publish(self, event_type: str, data: dict) -> AnalysisEvent:
        """Log to DB AND publish to Redis for real-time streaming."""
        # 1. Save to DB
        event = AnalysisEvent(session_id=self.session_id, event_type=event_type, event_data=data)
        self.db.add(event)
        self.db.commit()

        # 2. Publish to Redis for WebSocket
        self.redis.publish(self.channel, json.dumps({"type": event_type, **data}))
        return event

    # Convenience methods
    def plan_started(self) -> None
    def plan_progress(self, progress: int, message: str) -> None
    def plan_completed(self, plan_id: str) -> None
    def step_started(self, step_number: int) -> None
    def step_completed(self, step_data: dict) -> None
    def action_executed(self, action_data: dict) -> None
    def execution_completed(self, result: dict) -> None
    def execution_failed(self, error: str) -> None
```

### 6. `backend/app/models.py` - New Model

```python
class AnalysisEvent(Base):
    """Persistent log of all analysis events for replay and live display."""
    __tablename__ = "analysis_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("test_sessions.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(50))  # plan_started, step_completed, etc.
    event_data: Mapped[dict] = mapped_column(JSON)  # Full event payload
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    session: Mapped["TestSession"] = relationship(back_populates="events")
```

Update `TestSession`:
```python
class TestSession(Base):
    # ... existing fields ...
    plan_task_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    execution_task_id: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Relationships
    events: Mapped[list["AnalysisEvent"]] = relationship(back_populates="session", cascade="all, delete-orphan")
```

---

## Files to Modify

### 1. `backend/app/celery_app.py`
Add all new task modules:
```python
include=[
    "app.tasks.analysis",
    "app.tasks.discovery",
    "app.tasks.benchmark",
    "app.tasks.test_runs",
    "app.tasks.plan_generation",    # NEW
    "app.tasks.plan_execution",     # NEW
    "app.tasks.act_mode",           # NEW
    "app.tasks.run_till_end",       # NEW
]
```

### 2. `backend/app/routers/analysis.py`

**Modify `create_session()`:**
```python
# Queue plan generation
from app.tasks.plan_generation import generate_test_plan
task = generate_test_plan.delay(session_id=session.id, llm_model=request.llm_model)
session.plan_task_id = task.id
session.status = "generating_plan"
```

**Modify `execute_act_mode()`:**
```python
# Queue act mode execution
from app.tasks.act_mode import execute_act_mode as execute_act_mode_task
task = execute_act_mode_task.delay(session_id=session.id, task=request.task, previous_context=previous_context)
# Return task_id, frontend polls for result
return {"task_id": task.id, "status": "queued"}
```

**Modify WebSocket `start` command:**
```python
elif command == "start":
    from app.tasks.plan_execution import execute_test_plan
    task = execute_test_plan.delay(session_id=session.id)
    session.execution_task_id = task.id
    session.status = "running"
    db.commit()
    await websocket.send_json({"type": "execution_queued", "task_id": task.id})
```

**Modify WebSocket `run_till_end` command:**
```python
elif command == "run_till_end":
    from app.tasks.run_till_end import run_till_end as run_till_end_task
    task = run_till_end_task.delay(session_id=session.id)
    await websocket.send_json({"type": "run_till_end_queued", "task_id": task.id})
```

**Add WebSocket event subscription:**
```python
elif command == "subscribe_events":
    # Subscribe to Redis channel for this session
    asyncio.create_task(stream_events_to_websocket(session_id, websocket))
```

**New endpoint for event history:**
```python
@router.get("/sessions/{session_id}/events")
async def get_session_events(session_id: str, since: datetime | None = None) -> list[AnalysisEventResponse]:
    """Get all events for a session (for reconnection/replay)."""
```

**New endpoints for task management:**
```python
@router.get("/sessions/{session_id}/task/status")
async def get_task_status(session_id: str) -> TaskStatusResponse:
    """Poll current task status."""

@router.post("/sessions/{session_id}/task/cancel")
async def cancel_task(session_id: str) -> dict:
    """Cancel running task."""
```

### 3. `backend/app/schemas.py`
Add new schemas:
```python
class AnalysisEventResponse(BaseModel):
    id: str
    event_type: str
    event_data: dict
    created_at: datetime

class TaskStatusResponse(BaseModel):
    task_id: str | None
    task_type: str  # plan_generation | execution | act_mode | run_till_end
    status: str  # pending | running | completed | failed | cancelled
    progress: int | None
    error: str | None

class ActModeQueuedResponse(BaseModel):
    task_id: str
    status: str = "queued"
```

---

## Stop/Cancel Mechanism

**IMPORTANT**: Two distinct operations - preserve existing "stop execution" behavior!

### 1. Stop Execution (Existing Behavior - PRESERVE)

This is the **current** stop button behavior. It stops browser_use agent from executing more steps but keeps the browser session alive.

**Current implementation in `BrowserService`:**
```python
class BrowserService:
    _stop_requested = False  # Flag for graceful stop

    def request_stop(self) -> None:
        """Request graceful stop after current step completes."""
        self._stop_requested = True

    # In execution loop:
    if self._stop_requested:
        raise StopExecutionException()  # Gracefully exit
```

**With Celery - communicate via Redis:**
```python
# FastAPI (on WebSocket "pause_execution" command):
r = redis.from_url(settings.CELERY_BROKER_URL)
r.set(f"stop_execution:{session_id}", "1", ex=300)  # TTL 5 min

# In Celery task execution loop:
def check_stop_requested(session_id: str) -> bool:
    r = redis.from_url(settings.CELERY_BROKER_URL)
    return r.get(f"stop_execution:{session_id}") is not None

# When stop is detected:
if check_stop_requested(session_id):
    service._stop_requested = True  # Trigger existing behavior
    # Task returns gracefully, browser stays alive
    session.status = "paused"
    return {"status": "paused", "can_continue": True}
```

**Result:**
- Current step completes
- Browser session stays alive
- Session status = "paused"
- User can send new commands or continue

### 2. Cancel Task (Full Termination - NEW)

This is a **new** operation that completely cancels the task and cleans up.

```python
# FastAPI (on explicit "cancel_task" request):
r = redis.from_url(settings.CELERY_BROKER_URL)
r.set(f"cancel:{session_id}", "1", ex=300)
celery_app.control.revoke(task_id, terminate=True)  # Hard kill
session.status = "cancelled"

# In Celery task:
if check_cancelled(session_id):
    # Clean up browser session
    await orchestrator.stop_session(session_id)
    publisher.execution_cancelled()
    return {"status": "cancelled"}
```

### Summary

| Action | Redis Key | Celery Task | Browser | Session Status |
|--------|-----------|-------------|---------|----------------|
| **Stop Execution** | `stop_execution:{session_id}` | Completes gracefully | Stays alive | `paused` |
| **Cancel Task** | `cancel:{session_id}` | Revoked/terminated | Stopped | `cancelled` |

### WebSocket Commands (Existing + New)

| Command | Action | Notes |
|---------|--------|-------|
| `pause_execution` | Stop execution | **EXISTING** - preserve behavior |
| `stop_all` | Stop execution + close browser | **EXISTING** - preserve behavior |
| `cancel_task` | Cancel Celery task | **NEW** - full termination |

---

## WebSocket Event Streaming

**FastAPI subscribes to Redis and forwards to WebSocket:**
```python
async def stream_events_to_websocket(session_id: str, ws: WebSocket):
    """Forward Redis pub/sub events to WebSocket client."""
    r = redis.from_url(settings.CELERY_BROKER_URL)
    pubsub = r.pubsub()
    pubsub.subscribe(f"analysis_events:{session_id}")

    try:
        for message in pubsub.listen():
            if message["type"] == "message":
                await ws.send_text(message["data"])
    except WebSocketDisconnect:
        pubsub.unsubscribe()
```

---

## Event Types

| Event Type | When | Data |
|------------|------|------|
| `plan_started` | Plan generation begins | `{progress: 0}` |
| `plan_progress` | LLM call in progress | `{progress: 30, message: "Calling LLM..."}` |
| `plan_completed` | Plan ready | `{plan_id, plan_text, steps}` |
| `plan_failed` | Plan generation failed | `{error}` |
| `execution_started` | Execution begins | `{total_steps}` |
| `step_started` | Step execution begins | `{step_number}` |
| `step_completed` | Step finished | `{step_number, thinking, actions, screenshot_path}` |
| `step_failed` | Step failed | `{step_number, error}` |
| `action_executed` | Individual action done | `{action_name, result}` |
| `execution_completed` | All steps done | `{success, total_steps}` |
| `execution_failed` | Execution failed | `{error}` |
| `execution_cancelled` | User cancelled | `{}` |
| `act_mode_started` | Act mode begins | `{task}` |
| `act_mode_completed` | Act mode done | `{thinking, actions, screenshot_path}` |
| `run_till_end_started` | RTL begins | `{total_steps}` |
| `run_till_end_progress` | RTL step done | `{current_step, total_steps}` |
| `run_till_end_paused` | RTL paused on failure | `{step_number, error}` |
| `run_till_end_completed` | RTL done | `{success, skipped_steps}` |

---

## Implementation Order

### Phase 1: Infrastructure
1. Create `AnalysisEvent` model
2. Create database migration
3. Create `event_publisher.py` service
4. Update `celery_app.py` with new task modules

### Phase 2: Plan Generation Task
5. Create `tasks/plan_generation.py`
6. Modify `create_session()` to queue task
7. Modify `continue_session()` to queue task
8. Add WebSocket event subscription

### Phase 3: Plan Execution Task
9. Create `tasks/plan_execution.py`
10. Modify WebSocket `start` command
11. Update `BrowserService` to use event publisher

### Phase 4: Act Mode Task
12. Create `tasks/act_mode.py`
13. Modify `execute_act_mode()` endpoint
14. Update frontend to poll/subscribe for result

### Phase 5: Run Till End Task
15. Create `tasks/run_till_end.py`
16. Modify WebSocket `run_till_end` command
17. Handle pause/skip via Redis flags

### Phase 6: API & Frontend
18. Add `/sessions/{id}/events` endpoint
19. Add `/sessions/{id}/task/status` endpoint
20. Add `/sessions/{id}/task/cancel` endpoint
21. Update frontend to handle async responses
22. Update frontend to subscribe to events

---

## Critical Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `backend/app/models.py` | MODIFY | Add `AnalysisEvent` model, task ID fields |
| `backend/app/services/event_publisher.py` | CREATE | DB + Redis event publishing |
| `backend/app/tasks/plan_generation.py` | CREATE | Plan generation Celery task |
| `backend/app/tasks/plan_execution.py` | CREATE | Plan execution Celery task |
| `backend/app/tasks/act_mode.py` | CREATE | Act mode Celery task |
| `backend/app/tasks/run_till_end.py` | CREATE | Run-till-end Celery task |
| `backend/app/celery_app.py` | MODIFY | Register new tasks |
| `backend/app/routers/analysis.py` | MODIFY | Queue tasks, add endpoints |
| `backend/app/schemas.py` | MODIFY | Add new schemas |
| `backend/app/services/browser_service.py` | MODIFY | Use event publisher |
| `frontend/src/hooks/useChatSession.ts` | MODIFY | Handle async, subscribe events |

---

## Database Migration

```python
# alembic/versions/xxx_add_analysis_events.py

def upgrade():
    # Create analysis_events table
    op.create_table(
        'analysis_events',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('session_id', sa.String(36), sa.ForeignKey('test_sessions.id'), index=True),
        sa.Column('event_type', sa.String(50)),
        sa.Column('event_data', sa.JSON),
        sa.Column('created_at', sa.DateTime, index=True),
    )

    # Add task ID fields to test_sessions
    op.add_column('test_sessions', sa.Column('plan_task_id', sa.String(50), nullable=True))
    op.add_column('test_sessions', sa.Column('execution_task_id', sa.String(50), nullable=True))

def downgrade():
    op.drop_column('test_sessions', 'execution_task_id')
    op.drop_column('test_sessions', 'plan_task_id')
    op.drop_table('analysis_events')
```

---

## Retry Strategy

```python
@celery_app.task(
    bind=True,
    autoretry_for=(
        google.api_core.exceptions.ServiceUnavailable,
        google.api_core.exceptions.ResourceExhausted,
        ConnectionError,
        TimeoutError,
    ),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=3,
    retry_jitter=True,
)
```

---

## Existing Behavior to PRESERVE (No Changes)

| Component | Current Behavior | Keep As-Is? |
|-----------|-----------------|-------------|
| **Stop button** | Sets `_stop_requested`, stops after current step, browser stays alive | ✅ YES |
| **BrowserService.request_stop()** | Graceful stop mechanism | ✅ YES |
| **StopExecutionException** | Raised to exit execution loop gracefully | ✅ YES |
| **Session status = "paused"** | After stop, user can continue | ✅ YES |
| **Browser orchestrator** | Manages remote browser lifecycle | ✅ YES |
| **WebSocket commands** | `pause_execution`, `stop_all` | ✅ YES |
| **Service registry** | `_active_browser_services` dict | ✅ YES - adapt for Celery |

### Key Adaptation for Celery

Since `BrowserService` runs in a Celery worker (separate process), we can't directly call `request_stop()` from FastAPI. Instead:

1. **FastAPI sets Redis flag** when user clicks stop
2. **Celery task checks Redis flag** between steps
3. **Celery task calls `service._stop_requested = True`** to trigger existing behavior

**This preserves the existing behavior** - the only change is how the stop signal is communicated (Redis instead of direct method call).
