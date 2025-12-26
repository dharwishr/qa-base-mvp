"""Authentication dependencies for protecting routes."""

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from app.config import settings


# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 scheme for token extraction from Authorization header
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


class TokenData(BaseModel):
	"""Data stored in JWT token."""
	email: str


class User(BaseModel):
	"""User model."""
	email: str


def verify_password(plain_password: str, hashed_password: str) -> bool:
	"""Verify a password against a hash."""
	return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
	"""Hash a password."""
	return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
	"""Create a JWT access token."""
	to_encode = data.copy()
	if expires_delta:
		expire = datetime.now(timezone.utc) + expires_delta
	else:
		expire = datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRY_HOURS)
	to_encode.update({"exp": expire})
	encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
	return encoded_jwt


def authenticate_user(email: str, password: str) -> User | None:
	"""Authenticate a user with email and password."""
	if email != settings.AUTH_EMAIL:
		return None
	if password != settings.AUTH_PASSWORD:
		return None
	return User(email=email)


async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
	"""Get the current authenticated user from JWT token."""
	credentials_exception = HTTPException(
		status_code=status.HTTP_401_UNAUTHORIZED,
		detail="Could not validate credentials",
		headers={"WWW-Authenticate": "Bearer"},
	)
	try:
		payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
		email: str = payload.get("sub")
		if email is None:
			raise credentials_exception
		token_data = TokenData(email=email)
	except JWTError:
		raise credentials_exception
	
	# Verify the user still exists (for single user, just check email matches)
	if token_data.email != settings.AUTH_EMAIL:
		raise credentials_exception
	
	return User(email=token_data.email)


# Alias for use in router dependencies
require_auth = get_current_user
