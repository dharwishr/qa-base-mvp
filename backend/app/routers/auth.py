"""Authentication router for login endpoint."""

from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.config import settings
from app.deps import User, authenticate_user, create_access_token, get_current_user
from fastapi import Depends


router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
	"""Login request body."""
	email: str
	password: str


class TokenResponse(BaseModel):
	"""Token response."""
	access_token: str
	token_type: str = "bearer"


class UserResponse(BaseModel):
	"""User response."""
	email: str


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest):
	"""Authenticate user and return JWT token."""
	user = authenticate_user(request.email, request.password)
	if not user:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Incorrect email or password",
			headers={"WWW-Authenticate": "Bearer"},
		)
	
	access_token_expires = timedelta(hours=settings.JWT_EXPIRY_HOURS)
	access_token = create_access_token(
		data={"sub": user.email}, expires_delta=access_token_expires
	)
	
	return TokenResponse(access_token=access_token)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
	"""Get current authenticated user info."""
	return UserResponse(email=current_user.email)
