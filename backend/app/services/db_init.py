"""Database initialization - creates default organization and admin user on first run."""

import logging

from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.deps import get_password_hash
from app.models import (
    Organization,
    User,
    UserOrganization,
    TestSession,
    PlaywrightScript,
    DiscoverySession,
    BenchmarkSession,
    generate_slug,
)

logger = logging.getLogger(__name__)


def init_database() -> None:
    """Initialize database with default organization and admin user.
    
    - If no organization exists, creates default org and admin user
    - If organizations exist but records lack organization_id, migrates them
    """
    db: Session = SessionLocal()
    try:
        _init_database(db)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Database initialization failed: {e}")
        raise
    finally:
        db.close()


def _init_database(db: Session) -> None:
    """Core initialization logic."""
    org = db.query(Organization).first()
    
    if org is None:
        logger.info("No organization found - creating default organization and admin user")
        org = _create_default_org_and_admin(db)
    else:
        logger.info(f"Organization exists: {org.name} ({org.slug})")
    
    _migrate_orphan_records(db, org.id)


def _create_default_org_and_admin(db: Session) -> Organization:
    """Create the default organization and admin user."""
    slug = generate_slug(settings.DEFAULT_ORG_NAME)
    
    existing_slug = db.query(Organization).filter(Organization.slug == slug).first()
    if existing_slug:
        import uuid
        slug = f"{slug}-{str(uuid.uuid4())[:8]}"
    
    org = Organization(
        name=settings.DEFAULT_ORG_NAME,
        slug=slug,
        description=settings.DEFAULT_ORG_DESCRIPTION,
    )
    db.add(org)
    db.flush()
    
    logger.info(f"Created default organization: {org.name} (slug: {org.slug})")
    
    existing_user = db.query(User).filter(User.email == settings.ADMIN_EMAIL).first()
    if existing_user:
        logger.info(f"Admin user already exists: {settings.ADMIN_EMAIL}")
        user = existing_user
    else:
        user = User(
            name=settings.ADMIN_NAME,
            email=settings.ADMIN_EMAIL,
            password_hash=get_password_hash(settings.ADMIN_PASSWORD),
        )
        db.add(user)
        db.flush()
        logger.info(f"Created admin user: {settings.ADMIN_EMAIL}")
    
    existing_assoc = db.query(UserOrganization).filter(
        UserOrganization.user_id == user.id,
        UserOrganization.organization_id == org.id,
    ).first()
    
    if not existing_assoc:
        user_org = UserOrganization(
            user_id=user.id,
            organization_id=org.id,
            role="owner",
        )
        db.add(user_org)
        logger.info(f"Added admin user as owner of {org.name}")
    
    return org


def _migrate_orphan_records(db: Session, org_id: str) -> None:
    """Migrate records that don't have an organization_id to the first organization."""
    models_to_migrate = [
        (TestSession, "test_sessions"),
        (PlaywrightScript, "playwright_scripts"),
        (DiscoverySession, "discovery_sessions"),
        (BenchmarkSession, "benchmark_sessions"),
    ]
    
    for model, name in models_to_migrate:
        try:
            orphan_count = db.query(model).filter(model.organization_id == None).count()
            if orphan_count > 0:
                db.query(model).filter(model.organization_id == None).update(
                    {"organization_id": org_id},
                    synchronize_session=False
                )
                logger.info(f"Migrated {orphan_count} orphan {name} to organization {org_id}")
        except Exception as e:
            logger.warning(f"Could not migrate {name}: {e}")
