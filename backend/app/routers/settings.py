"""
Settings Router - API endpoints for system-wide configuration.

Endpoints:
- GET /settings - Get current system settings
- PUT /settings - Update system settings
- GET /settings/container-pool - Get container pool stats
"""

import asyncio
import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import SystemSettings
from app.schemas import (
    SystemSettingsRequest,
    SystemSettingsResponse,
    IsolationMode,
)
from app.services.container_pool import get_container_pool

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


def get_or_create_settings(db: Session) -> SystemSettings:
    """Get the system settings singleton, creating it if it doesn't exist."""
    settings = db.query(SystemSettings).filter(SystemSettings.id == "default").first()
    if not settings:
        settings = SystemSettings(
            id="default",
            isolation_mode=IsolationMode.CONTEXT.value,
            default_analysis_model="gemini-3.0-flash",
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
        logger.info("Created default system settings")
    return settings


@router.get("", response_model=SystemSettingsResponse)
async def get_settings(db: Session = Depends(get_db)):
    """Get the current system settings."""
    settings = get_or_create_settings(db)
    return SystemSettingsResponse(
        isolation_mode=IsolationMode(settings.isolation_mode),
        default_analysis_model=settings.default_analysis_model,
        updated_at=settings.updated_at,
    )


@router.put("", response_model=SystemSettingsResponse)
async def update_settings(
    request: SystemSettingsRequest,
    db: Session = Depends(get_db)
):
    """Update system settings."""
    settings = get_or_create_settings(db)

    # Update isolation mode
    old_mode = settings.isolation_mode
    settings.isolation_mode = request.isolation_mode.value

    # Update default analysis model if provided
    if request.default_analysis_model is not None:
        old_model = settings.default_analysis_model
        settings.default_analysis_model = request.default_analysis_model
        logger.info(f"System settings updated: default_analysis_model changed from {old_model} to {settings.default_analysis_model}")

    settings.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(settings)

    logger.info(f"System settings updated: isolation_mode changed from {old_mode} to {settings.isolation_mode}")

    return SystemSettingsResponse(
        isolation_mode=IsolationMode(settings.isolation_mode),
        default_analysis_model=settings.default_analysis_model,
        updated_at=settings.updated_at,
    )


@router.get("/container-pool", response_model=dict[str, Any])
async def get_container_pool_stats():
    """Get the current state of the container pool.

    Returns pool statistics including:
    - initialized: Whether the pool is initialized
    - pools: Per-browser-type pool status
    - in_use_count: Number of containers currently in use
    - in_use: Details of containers currently executing tests
    """
    pool = get_container_pool()
    return pool.get_stats()


@router.post("/container-pool/warmup", response_model=dict[str, Any])
async def warmup_container_pool():
    """Pre-warm the container pool.

    Creates containers for chromium browser type to reduce cold-start latency.
    """
    from app.services.container_pool import init_container_pool, BrowserType

    try:
        pool = await init_container_pool([BrowserType.CHROMIUM])
        return pool.get_stats()
    except Exception as e:
        logger.error(f"Failed to warmup container pool: {e}")
        raise HTTPException(status_code=500, detail=str(e))
