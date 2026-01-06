"""add_organization_and_user_models

Revision ID: cf9a13064c12
Revises: d3e4f5a6b7c8
Create Date: 2026-01-05 14:56:22.907290

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cf9a13064c12'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create organizations table
    op.create_table('organizations',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=256), nullable=False),
        sa.Column('slug', sa.String(length=50), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_organizations_slug'), 'organizations', ['slug'], unique=True)

    # Create users table
    op.create_table('users',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=256), nullable=False),
        sa.Column('email', sa.String(length=256), nullable=False),
        sa.Column('password_hash', sa.String(length=256), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)

    # Create user_organizations association table
    op.create_table('user_organizations',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('organization_id', sa.String(length=36), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'organization_id', name='uq_user_organization')
    )

    # Add organization_id and user_id to test_sessions (nullable initially for migration)
    op.add_column('test_sessions', sa.Column('organization_id', sa.String(length=36), nullable=True))
    op.add_column('test_sessions', sa.Column('user_id', sa.String(length=36), nullable=True))
    op.create_index(op.f('ix_test_sessions_organization_id'), 'test_sessions', ['organization_id'], unique=False)
    op.create_index(op.f('ix_test_sessions_user_id'), 'test_sessions', ['user_id'], unique=False)

    # Add organization_id and user_id to playwright_scripts
    op.add_column('playwright_scripts', sa.Column('organization_id', sa.String(length=36), nullable=True))
    op.add_column('playwright_scripts', sa.Column('user_id', sa.String(length=36), nullable=True))
    op.create_index(op.f('ix_playwright_scripts_organization_id'), 'playwright_scripts', ['organization_id'], unique=False)
    op.create_index(op.f('ix_playwright_scripts_user_id'), 'playwright_scripts', ['user_id'], unique=False)

    # Add organization_id and user_id to discovery_sessions
    op.add_column('discovery_sessions', sa.Column('organization_id', sa.String(length=36), nullable=True))
    op.add_column('discovery_sessions', sa.Column('user_id', sa.String(length=36), nullable=True))
    op.create_index(op.f('ix_discovery_sessions_organization_id'), 'discovery_sessions', ['organization_id'], unique=False)
    op.create_index(op.f('ix_discovery_sessions_user_id'), 'discovery_sessions', ['user_id'], unique=False)

    # Add organization_id and user_id to benchmark_sessions
    op.add_column('benchmark_sessions', sa.Column('organization_id', sa.String(length=36), nullable=True))
    op.add_column('benchmark_sessions', sa.Column('user_id', sa.String(length=36), nullable=True))
    op.create_index(op.f('ix_benchmark_sessions_organization_id'), 'benchmark_sessions', ['organization_id'], unique=False)
    op.create_index(op.f('ix_benchmark_sessions_user_id'), 'benchmark_sessions', ['user_id'], unique=False)


def downgrade() -> None:
    # Remove organization_id and user_id from benchmark_sessions
    op.drop_index(op.f('ix_benchmark_sessions_user_id'), table_name='benchmark_sessions')
    op.drop_index(op.f('ix_benchmark_sessions_organization_id'), table_name='benchmark_sessions')
    op.drop_column('benchmark_sessions', 'user_id')
    op.drop_column('benchmark_sessions', 'organization_id')

    # Remove organization_id and user_id from discovery_sessions
    op.drop_index(op.f('ix_discovery_sessions_user_id'), table_name='discovery_sessions')
    op.drop_index(op.f('ix_discovery_sessions_organization_id'), table_name='discovery_sessions')
    op.drop_column('discovery_sessions', 'user_id')
    op.drop_column('discovery_sessions', 'organization_id')

    # Remove organization_id and user_id from playwright_scripts
    op.drop_index(op.f('ix_playwright_scripts_user_id'), table_name='playwright_scripts')
    op.drop_index(op.f('ix_playwright_scripts_organization_id'), table_name='playwright_scripts')
    op.drop_column('playwright_scripts', 'user_id')
    op.drop_column('playwright_scripts', 'organization_id')

    # Remove organization_id and user_id from test_sessions
    op.drop_index(op.f('ix_test_sessions_user_id'), table_name='test_sessions')
    op.drop_index(op.f('ix_test_sessions_organization_id'), table_name='test_sessions')
    op.drop_column('test_sessions', 'user_id')
    op.drop_column('test_sessions', 'organization_id')

    # Drop association table
    op.drop_table('user_organizations')

    # Drop users table
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')

    # Drop organizations table
    op.drop_index(op.f('ix_organizations_slug'), table_name='organizations')
    op.drop_table('organizations')
