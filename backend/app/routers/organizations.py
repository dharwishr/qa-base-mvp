"""Organization management router."""

import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthenticatedUser, get_current_user, require_owner
from app.models import Organization, User, UserOrganization, generate_slug
from app.schemas import (
	AddUserToOrganizationRequest,
	CreateOrganizationRequest,
	OrganizationResponse,
	OrganizationUpdate,
	UpdateUserRoleRequest,
	UserInOrganizationResponse,
	UserRole,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/organizations", tags=["organizations"])


def make_unique_slug(db: Session, base_slug: str, exclude_id: str | None = None) -> str:
	"""Generate a unique slug by appending a number if needed."""
	slug = base_slug
	counter = 1
	while True:
		query = db.query(Organization).filter(Organization.slug == slug)
		if exclude_id:
			query = query.filter(Organization.id != exclude_id)
		if not query.first():
			return slug
		slug = f"{base_slug}-{counter}"
		counter += 1


@router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def create_organization(
	request: CreateOrganizationRequest,
	current_user: AuthenticatedUser = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	"""Create a new organization. Only users who are owners of any organization can create new organizations."""
	# Check if current user is an owner of ANY organization
	is_owner_of_any = db.query(UserOrganization).filter(
		UserOrganization.user_id == current_user.id,
		UserOrganization.role == "owner"
	).first()

	if not is_owner_of_any:
		raise HTTPException(
			status_code=status.HTTP_403_FORBIDDEN,
			detail="Only organization owners can create new organizations"
		)

	# Generate unique slug from name
	base_slug = generate_slug(request.name)
	unique_slug = make_unique_slug(db, base_slug)

	# Create the new organization
	new_org = Organization(
		name=request.name,
		slug=unique_slug,
		description=request.description
	)
	db.add(new_org)
	db.flush()  # Get the org ID before creating association

	# Add the creator as owner of the new organization
	user_org = UserOrganization(
		user_id=current_user.id,
		organization_id=new_org.id,
		role="owner"
	)
	db.add(user_org)
	db.commit()
	db.refresh(new_org)

	logger.info(f"Organization {new_org.id} created by user {current_user.id}")
	return new_org


@router.get("", response_model=OrganizationResponse)
async def get_current_organization(
	current_user: AuthenticatedUser = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	"""Get the current user's organization."""
	org = db.query(Organization).filter(Organization.id == current_user.organization_id).first()
	if not org:
		raise HTTPException(status_code=404, detail="Organization not found")
	return org


@router.put("", response_model=OrganizationResponse)
async def update_organization(
	request: OrganizationUpdate,
	current_user: AuthenticatedUser = Depends(require_owner),
	db: Session = Depends(get_db),
):
	"""Update the current organization (owner only)."""
	org = db.query(Organization).filter(Organization.id == current_user.organization_id).first()
	if not org:
		raise HTTPException(status_code=404, detail="Organization not found")

	if request.name is not None:
		org.name = request.name
		# Update slug to match new name
		base_slug = generate_slug(request.name)
		org.slug = make_unique_slug(db, base_slug, exclude_id=org.id)

	if request.description is not None:
		org.description = request.description

	db.commit()
	db.refresh(org)

	logger.info(f"Organization {org.id} updated by user {current_user.id}")
	return org


@router.get("/users", response_model=list[UserInOrganizationResponse])
async def list_organization_users(
	current_user: AuthenticatedUser = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	"""List all users in the current organization."""
	user_orgs = db.query(UserOrganization).filter(
		UserOrganization.organization_id == current_user.organization_id
	).all()

	result = []
	for uo in user_orgs:
		user = db.query(User).filter(User.id == uo.user_id).first()
		if user:
			result.append(UserInOrganizationResponse(
				id=user.id,
				name=user.name,
				email=user.email,
				role=UserRole(uo.role),
				joined_at=uo.created_at
			))

	return result


@router.post("/users", response_model=UserInOrganizationResponse)
async def add_user_to_organization(
	request: AddUserToOrganizationRequest,
	current_user: AuthenticatedUser = Depends(require_owner),
	db: Session = Depends(get_db),
):
	"""Add a user to the organization (owner only)."""
	# Find the user by email
	user = db.query(User).filter(User.email == request.email).first()
	if not user:
		raise HTTPException(
			status_code=status.HTTP_404_NOT_FOUND,
			detail=f"User with email {request.email} not found. They must sign up first."
		)

	# Check if user is already in organization
	existing = db.query(UserOrganization).filter(
		UserOrganization.user_id == user.id,
		UserOrganization.organization_id == current_user.organization_id
	).first()

	if existing:
		raise HTTPException(
			status_code=status.HTTP_400_BAD_REQUEST,
			detail="User is already a member of this organization"
		)

	# Cannot add another owner if one exists
	if request.role == UserRole.OWNER:
		existing_owner = db.query(UserOrganization).filter(
			UserOrganization.organization_id == current_user.organization_id,
			UserOrganization.role == "owner"
		).first()
		if existing_owner:
			raise HTTPException(
				status_code=status.HTTP_400_BAD_REQUEST,
				detail="Organization already has an owner. Transfer ownership first."
			)

	# Add user to organization
	user_org = UserOrganization(
		user_id=user.id,
		organization_id=current_user.organization_id,
		role=request.role.value
	)
	db.add(user_org)
	db.commit()
	db.refresh(user_org)

	logger.info(f"User {user.id} added to organization {current_user.organization_id} by {current_user.id}")

	return UserInOrganizationResponse(
		id=user.id,
		name=user.name,
		email=user.email,
		role=UserRole(user_org.role),
		joined_at=user_org.created_at
	)


@router.put("/users/{user_id}", response_model=UserInOrganizationResponse)
async def update_user_role(
	user_id: str,
	request: UpdateUserRoleRequest,
	current_user: AuthenticatedUser = Depends(require_owner),
	db: Session = Depends(get_db),
):
	"""Update a user's role in the organization (owner only)."""
	# Cannot change own role
	if user_id == current_user.id:
		raise HTTPException(
			status_code=status.HTTP_400_BAD_REQUEST,
			detail="Cannot change your own role"
		)

	user_org = db.query(UserOrganization).filter(
		UserOrganization.user_id == user_id,
		UserOrganization.organization_id == current_user.organization_id
	).first()

	if not user_org:
		raise HTTPException(
			status_code=status.HTTP_404_NOT_FOUND,
			detail="User not found in this organization"
		)

	# If promoting to owner, demote current owner to member
	if request.role == UserRole.OWNER:
		current_owner_assoc = db.query(UserOrganization).filter(
			UserOrganization.organization_id == current_user.organization_id,
			UserOrganization.role == "owner"
		).first()
		if current_owner_assoc:
			current_owner_assoc.role = "member"

	user_org.role = request.role.value
	db.commit()
	db.refresh(user_org)

	user = db.query(User).filter(User.id == user_id).first()

	logger.info(f"User {user_id} role updated to {request.role} in org {current_user.organization_id}")

	return UserInOrganizationResponse(
		id=user.id,
		name=user.name,
		email=user.email,
		role=UserRole(user_org.role),
		joined_at=user_org.created_at
	)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_user_from_organization(
	user_id: str,
	current_user: AuthenticatedUser = Depends(require_owner),
	db: Session = Depends(get_db),
):
	"""Remove a user from the organization (owner only)."""
	# Cannot remove self
	if user_id == current_user.id:
		raise HTTPException(
			status_code=status.HTTP_400_BAD_REQUEST,
			detail="Cannot remove yourself from the organization"
		)

	user_org = db.query(UserOrganization).filter(
		UserOrganization.user_id == user_id,
		UserOrganization.organization_id == current_user.organization_id
	).first()

	if not user_org:
		raise HTTPException(
			status_code=status.HTTP_404_NOT_FOUND,
			detail="User not found in this organization"
		)

	db.delete(user_org)
	db.commit()

	logger.info(f"User {user_id} removed from organization {current_user.organization_id} by {current_user.id}")
