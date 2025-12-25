from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# Create engine
engine = create_engine(
	settings.DATABASE_URL,
	connect_args={"check_same_thread": False},  # Required for SQLite
	echo=settings.DEBUG,
)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
	"""Base class for all SQLAlchemy models."""

	pass


def get_db() -> Generator[Session, None, None]:
	"""Dependency that provides a database session."""
	db = SessionLocal()
	try:
		yield db
	finally:
		db.close()
