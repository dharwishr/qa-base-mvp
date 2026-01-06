"""Authentication dependencies for protecting routes."""

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db


# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 scheme for token extraction from Authorization header
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


class TokenData(BaseModel):
	"""Data stored in JWT token."""
	user_id: str
	email: str
	organization_id: str
	role: str


class AuthenticatedUser(BaseModel):
	"""Authenticated user with organization context."""
	id: str
	email: str
	name: str
	organization_id: str
	organization_slug: str
	role: str  # owner | member


def verify_password(plain_password: str, hashed_password: str) -> bool:
	"""Verify a password against a hash."""
	return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
	"""Hash a password."""
	return pwd_context.hash(password)


def create_access_token(
	user_id: str,
	email: str,
	organization_id: str,
	role: str,
	expires_delta: timedelta | None = None
) -> str:
	"""Create a JWT access token."""
	to_encode = {
		"sub": user_id,
		"email": email,
		"org_id": organization_id,
		"role": role,
	}
	if expires_delta:
		expire = datetime.now(timezone.utc) + expires_delta
	else:
		expire = datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRY_HOURS)
	to_encode.update({"exp": expire})
	encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
	return encoded_jwt


async def get_current_user(
	token: str = Depends(oauth2_scheme),
	db: Session = Depends(get_db)
) -> AuthenticatedUser:
	"""Get the current authenticated user from JWT token."""
	from app.models import User, UserOrganization, Organization

	credentials_exception = HTTPException(
		status_code=status.HTTP_401_UNAUTHORIZED,
		detail="Could not validate credentials",
		headers={"WWW-Authenticate": "Bearer"},
	)
	try:
		payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
		user_id: str = payload.get("sub")
		email: str = payload.get("email")
		organization_id: str = payload.get("org_id")
		role: str = payload.get("role")

		if not all([user_id, email, organization_id, role]):
			raise credentials_exception

	except JWTError:
		raise credentials_exception

	# Verify user exists and is still in the organization
	user = db.query(User).filter(User.id == user_id).first()
	if not user:
		raise credentials_exception

	user_org = db.query(UserOrganization).filter(
		UserOrganization.user_id == user_id,
		UserOrganization.organization_id == organization_id
	).first()

	if not user_org:
		raise HTTPException(
			status_code=status.HTTP_403_FORBIDDEN,
			detail="User no longer has access to this organization"
		)

	organization = db.query(Organization).filter(Organization.id == organization_id).first()
	if not organization:
		raise credentials_exception

	return AuthenticatedUser(
		id=user.id,
		email=user.email,
		name=user.name,
		organization_id=organization_id,
		organization_slug=organization.slug,
		role=user_org.role
	)


def require_owner(current_user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
	"""Require the current user to be an organization owner."""
	if current_user.role != "owner":
		raise HTTPException(
			status_code=status.HTTP_403_FORBIDDEN,
			detail="Only organization owners can perform this action"
		)
	return current_user


# Alias for use in router dependencies
require_auth = get_current_user
