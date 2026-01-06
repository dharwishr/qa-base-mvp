"""Celery task for test plan generation.

This task handles generating test plans using LLM in a Celery worker,
enabling scalability, reliability (with retries), and resource isolation.
"""

import logging

from google.api_core import exceptions as google_exceptions

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import ChatMessage, TestPlan, TestSession
from app.services.event_publisher import AnalysisEventPublisher, check_cancelled
from app.services.plan_service import generate_plan_sync

logger = logging.getLogger(__name__)


@celery_app.task(
    bind=True,
    name="generate_test_plan",
    autoretry_for=(
        google_exceptions.ServiceUnavailable,
        google_exceptions.ResourceExhausted,
        ConnectionError,
        TimeoutError,
    ),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=3,
    retry_jitter=True,
)
def generate_test_plan(
    self,
    session_id: str,
    task_prompt: str | None = None,
    is_continuation: bool = False,
    llm_model: str = "gemini-2.5-flash",
    generate_title: bool = True,
) -> dict:
    """Generate a test plan using LLM in a Celery worker.

    Args:
        session_id: The test session ID to generate plan for
        task_prompt: Optional override prompt (for continuations)
        is_continuation: If True, include browser context and skip navigation steps
        llm_model: LLM model to use for plan generation
        generate_title: If True, generate a title for the session

    Returns:
        Dict with plan generation results:
        {
            "status": "completed" | "failed" | "cancelled",
            "plan_id": str | None,
            "plan_text": str | None,
            "steps_count": int,
            "error": str | None
        }
    """
    db = SessionLocal()
    publisher = None

    try:
        # Get session
        session = db.query(TestSession).filter(TestSession.id == session_id).first()
        if not session:
            logger.error(f"Session {session_id} not found")
            return {"status": "failed", "error": f"Session {session_id} not found", "plan_id": None, "steps_count": 0}

        # Initialize event publisher
        publisher = AnalysisEventPublisher(db, session_id)

        # Check if cancelled before starting
        if check_cancelled(session_id):
            logger.info(f"Plan generation cancelled before start for session {session_id}")
            session.status = "cancelled"
            session.plan_task_id = None
            db.commit()
            publisher.plan_cancelled()
            return {"status": "cancelled", "plan_id": None, "steps_count": 0}

        # Update session status
        session.status = "generating_plan"
        session.plan_task_id = self.request.id
        db.commit()

        # Publish start event
        publisher.plan_started()

        # Check cancellation before LLM call
        if check_cancelled(session_id):
            logger.info(f"Plan generation cancelled before LLM call for session {session_id}")
            session.status = "cancelled"
            session.plan_task_id = None
            db.commit()
            publisher.plan_cancelled()
            return {"status": "cancelled", "plan_id": None, "steps_count": 0}

        # Publish progress
        publisher.plan_progress(30, "Calling LLM for plan generation...")

        # Generate plan using existing service
        try:
            plan = generate_plan_sync(db, session, task_prompt)
        except Exception as e:
            logger.error(f"Plan generation failed for session {session_id}: {e}")
            session.status = "failed"
            session.plan_task_id = None
            db.commit()
            publisher.plan_failed(str(e))
            raise

        # Check cancellation after LLM call
        if check_cancelled(session_id):
            logger.info(f"Plan generation cancelled after LLM call for session {session_id}")
            # Plan was created but user cancelled - delete it
            if plan:
                db.delete(plan)
            session.status = "cancelled"
            session.plan_task_id = None
            db.commit()
            publisher.plan_cancelled()
            return {"status": "cancelled", "plan_id": None, "steps_count": 0}

        # Publish progress
        publisher.plan_progress(70, "Processing plan...")

        # Get plan steps
        steps = plan.steps_json.get("steps", []) if plan.steps_json else []
        steps_count = len(steps)

        # Create chat message for the plan
        # Get next sequence number
        from sqlalchemy import func
        max_seq = db.query(func.max(ChatMessage.sequence_number)).filter(
            ChatMessage.session_id == session_id
        ).scalar() or 0

        plan_message = ChatMessage(
            session_id=session_id,
            message_type="plan",
            content=plan.plan_text,
            plan_id=plan.id,
            sequence_number=max_seq + 1,
        )
        db.add(plan_message)
        db.commit()

        # Generate title if requested and not a continuation
        if generate_title and not is_continuation:
            publisher.plan_progress(85, "Generating session title...")
            try:
                _generate_title_for_session(db, session, llm_model)
            except Exception as e:
                # Title generation is non-critical, don't fail the task
                logger.warning(f"Title generation failed for session {session_id}: {e}")

        # Publish completion
        publisher.plan_completed(plan.id, plan.plan_text, steps)

        # Update session status to plan_ready and clear task ID
        session.status = "plan_ready"
        session.plan_task_id = None
        db.commit()

        logger.info(f"Plan generation completed for session {session_id}: {steps_count} steps")

        return {
            "status": "completed",
            "plan_id": plan.id,
            "plan_text": plan.plan_text,
            "steps_count": steps_count,
            "error": None,
        }

    except Exception as e:
        logger.error(f"Plan generation task failed for session {session_id}: {e}")

        # Update session status
        try:
            session = db.query(TestSession).filter(TestSession.id == session_id).first()
            if session:
                session.status = "failed"
                session.plan_task_id = None
                db.commit()

                if publisher:
                    publisher.plan_failed(str(e))
        except Exception:
            pass

        raise

    finally:
        if publisher:
            publisher.close()
        db.close()


def _generate_title_for_session(db, session: TestSession, llm_model: str) -> None:
    """Generate a title for the session using LLM.

    This is a synchronous helper function called within the Celery task.
    """
    from app.services.browser_service import get_llm_for_model
    from browser_use.llm.messages import UserMessage

    # Generate fallback title first
    prompt = session.prompt
    first_line = prompt.split('\n')[0].strip()
    if len(first_line) > 50:
        truncated = first_line[:50]
        last_space = truncated.rfind(' ')
        if last_space > 30:
            fallback_title = truncated[:last_space] + '...'
        else:
            fallback_title = truncated + '...'
    else:
        fallback_title = first_line

    # If current title is already custom (not fallback), don't overwrite
    if session.title and session.title != fallback_title:
        return

    try:
        llm = get_llm_for_model(llm_model)

        title_prompt = f"""Generate a short, descriptive title (max 50 characters) for this test case prompt.
The title should be concise and capture the main action being tested.
Do NOT include quotes or any formatting. Just return the plain title text.

Test case prompt:
{prompt[:500]}

Title:"""

        messages = [UserMessage(content=title_prompt)]

        # Use synchronous invoke for Celery worker
        # Note: This may need adjustment based on the actual LLM interface
        import asyncio
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        response = loop.run_until_complete(llm.ainvoke(messages))

        # Extract title from response
        if hasattr(response, 'completion'):
            title = response.completion.strip() if isinstance(response.completion, str) else str(response.completion).strip()
        else:
            title = str(response).strip()

        # Clean up title
        title = title.strip('"\'').strip()
        if len(title) > 100:
            title = title[:97] + '...'

        if title:
            session.title = title
            db.commit()
            logger.info(f"Generated title for session {session.id}: {title}")

    except Exception as e:
        logger.warning(f"Failed to generate title for session {session.id}: {e}")
        # Use fallback title
        if not session.title:
            session.title = fallback_title
            db.commit()
