"""Authentication router for login and signup endpoints."""

import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import (
	AuthenticatedUser,
	create_access_token,
	get_current_user,
	get_password_hash,
	verify_password,
)
from app.models import Organization, User, UserOrganization
from app.schemas import (
	CurrentUserResponse,
	LoginRequest,
	LoginResponse,
	OrganizationResponse,
	OrganizationWithRoleResponse,
	SignupRequest,
	SignupResponse,
	UserResponse,
	UserRole,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/signup", response_model=SignupResponse)
async def signup(request: SignupRequest, db: Session = Depends(get_db)):
	"""Register a new user account."""
	# Check if email already exists
	existing_user = db.query(User).filter(User.email == request.email).first()
	if existing_user:
		raise HTTPException(
			status_code=status.HTTP_400_BAD_REQUEST,
			detail="Email already registered"
		)

	# Create new user
	user = User(
		name=request.name,
		email=request.email,
		password_hash=get_password_hash(request.password)
	)
	db.add(user)
	db.commit()
	db.refresh(user)

	logger.info(f"New user registered: {user.email}")

	return SignupResponse(
		user=UserResponse(
			id=user.id,
			name=user.name,
			email=user.email,
			created_at=user.created_at,
			updated_at=user.updated_at
		),
		message="User created successfully. Please wait for an admin to add you to an organization."
	)


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest, db: Session = Depends(get_db)):
	"""Authenticate user and return JWT token."""
	# Find user
	user = db.query(User).filter(User.email == request.email).first()
	if not user:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Incorrect email or password",
			headers={"WWW-Authenticate": "Bearer"},
		)

	# Verify password
	if not verify_password(request.password, user.password_hash):
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Incorrect email or password",
			headers={"WWW-Authenticate": "Bearer"},
		)

	# Get user's organizations
	user_orgs = db.query(UserOrganization).filter(
		UserOrganization.user_id == user.id
	).all()

	if not user_orgs:
		raise HTTPException(
			status_code=status.HTTP_403_FORBIDDEN,
			detail="You are not a member of any organization. Please contact an admin to add you."
		)

	# If organization_id is provided, verify user has access
	if request.organization_id:
		user_org = next(
			(uo for uo in user_orgs if uo.organization_id == request.organization_id),
			None
		)
		if not user_org:
			raise HTTPException(
				status_code=status.HTTP_403_FORBIDDEN,
				detail="You don't have access to this organization"
			)
	else:
		# Use first organization if not specified
		user_org = user_orgs[0]

	# Get organization
	organization = db.query(Organization).filter(
		Organization.id == user_org.organization_id
	).first()

	if not organization:
		raise HTTPException(
			status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
			detail="Organization not found"
		)

	# Create token
	access_token_expires = timedelta(hours=settings.JWT_EXPIRY_HOURS)
	access_token = create_access_token(
		user_id=user.id,
		email=user.email,
		organization_id=organization.id,
		role=user_org.role,
		expires_delta=access_token_expires
	)

	logger.info(f"User {user.email} logged in to organization {organization.slug}")

	return LoginResponse(
		access_token=access_token,
		token_type="bearer",
		user=UserResponse(
			id=user.id,
			name=user.name,
			email=user.email,
			created_at=user.created_at,
			updated_at=user.updated_at
		),
		organization=OrganizationResponse(
			id=organization.id,
			name=organization.name,
			slug=organization.slug,
			description=organization.description,
			created_at=organization.created_at,
			updated_at=organization.updated_at
		),
		role=UserRole(user_org.role)
	)


@router.get("/me", response_model=CurrentUserResponse)
async def get_me(
	current_user: AuthenticatedUser = Depends(get_current_user),
	db: Session = Depends(get_db)
):
	"""Get current authenticated user info with organization context."""
	user = db.query(User).filter(User.id == current_user.id).first()
	organization = db.query(Organization).filter(
		Organization.id == current_user.organization_id
	).first()

	if not user or not organization:
		raise HTTPException(status_code=404, detail="User or organization not found")

	return CurrentUserResponse(
		user=UserResponse(
			id=user.id,
			name=user.name,
			email=user.email,
			created_at=user.created_at,
			updated_at=user.updated_at
		),
		organization=OrganizationResponse(
			id=organization.id,
			name=organization.name,
			slug=organization.slug,
			description=organization.description,
			created_at=organization.created_at,
			updated_at=organization.updated_at
		),
		role=UserRole(current_user.role)
	)


@router.get("/organizations", response_model=list[OrganizationWithRoleResponse])
async def get_user_organizations(
	current_user: AuthenticatedUser = Depends(get_current_user),
	db: Session = Depends(get_db)
):
	"""Get all organizations the current user is a member of."""
	user_orgs = db.query(UserOrganization).filter(
		UserOrganization.user_id == current_user.id
	).all()

	result = []
	for uo in user_orgs:
		org = db.query(Organization).filter(Organization.id == uo.organization_id).first()
		if org:
			result.append(OrganizationWithRoleResponse(
				id=org.id,
				name=org.name,
				slug=org.slug,
				description=org.description,
				created_at=org.created_at,
				updated_at=org.updated_at,
				role=UserRole(uo.role)
			))

	return result


@router.post("/switch-organization", response_model=LoginResponse)
async def switch_organization(
	organization_id: str,
	current_user: AuthenticatedUser = Depends(get_current_user),
	db: Session = Depends(get_db)
):
	"""Switch to a different organization and get a new token."""
	# Verify user has access to the organization
	user_org = db.query(UserOrganization).filter(
		UserOrganization.user_id == current_user.id,
		UserOrganization.organization_id == organization_id
	).first()

	if not user_org:
		raise HTTPException(
			status_code=status.HTTP_403_FORBIDDEN,
			detail="You don't have access to this organization"
		)

	user = db.query(User).filter(User.id == current_user.id).first()
	organization = db.query(Organization).filter(Organization.id == organization_id).first()

	if not user or not organization:
		raise HTTPException(status_code=404, detail="User or organization not found")

	# Create new token for the new organization
	access_token_expires = timedelta(hours=settings.JWT_EXPIRY_HOURS)
	access_token = create_access_token(
		user_id=user.id,
		email=user.email,
		organization_id=organization.id,
		role=user_org.role,
		expires_delta=access_token_expires
	)

	logger.info(f"User {user.email} switched to organization {organization.slug}")

	return LoginResponse(
		access_token=access_token,
		token_type="bearer",
		user=UserResponse(
			id=user.id,
			name=user.name,
			email=user.email,
			created_at=user.created_at,
			updated_at=user.updated_at
		),
		organization=OrganizationResponse(
			id=organization.id,
			name=organization.name,
			slug=organization.slug,
			description=organization.description,
			created_at=organization.created_at,
			updated_at=organization.updated_at
		),
		role=UserRole(user_org.role)
	)
