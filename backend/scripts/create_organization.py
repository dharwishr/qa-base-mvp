#!/usr/bin/env -S uv run
"""CLI script to create a new organization with an owner user.

Usage:
    cd backend
    uv run scripts/create_organization.py --name "Acme Corp" --email user@acme.com --description "Acme testing team"
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app.models import Organization, User, UserOrganization, generate_slug


def get_unique_slug(db, base_slug: str) -> str:
    """Generate a unique slug, appending numbers if needed."""
    slug = base_slug
    counter = 1
    while db.query(Organization).filter(Organization.slug == slug).first():
        slug = f"{base_slug}-{counter}"
        counter += 1
    return slug


def create_organization(name: str, email: str, description: str | None = None) -> None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            print(f"Error: User with email '{email}' not found. User must sign up first.")
            sys.exit(1)

        base_slug = generate_slug(name)
        slug = get_unique_slug(db, base_slug)

        org = Organization(
            name=name,
            slug=slug,
            description=description,
        )
        db.add(org)
        db.flush()

        user_org = UserOrganization(
            user_id=user.id,
            organization_id=org.id,
            role="owner",
        )
        db.add(user_org)
        db.commit()

        print(f"Organization created successfully!")
        print(f"  ID:          {org.id}")
        print(f"  Name:        {org.name}")
        print(f"  Slug:        {org.slug}")
        print(f"  Description: {org.description or '(none)'}")
        print(f"  Owner:       {user.name} <{user.email}>")

    except Exception as e:
        db.rollback()
        print(f"Error creating organization: {e}")
        sys.exit(1)
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(
        description="Create a new organization with an owner user"
    )
    parser.add_argument(
        "--name",
        required=True,
        help="Organization name",
    )
    parser.add_argument(
        "--email",
        required=True,
        help="Owner email (user must already exist)",
    )
    parser.add_argument(
        "--description",
        default=None,
        help="Organization description (optional)",
    )

    args = parser.parse_args()
    create_organization(args.name, args.email, args.description)


if __name__ == "__main__":
    main()
