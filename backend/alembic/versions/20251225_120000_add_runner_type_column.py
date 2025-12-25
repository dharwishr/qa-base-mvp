"""Add runner_type column to test_runs table

Revision ID: 8747521d0005
Revises: 8747521d0004
Create Date: 2025-12-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8747521d0005'
down_revision: Union[str, None] = '8747521d0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add runner_type column to test_runs table
    # Default to 'playwright' for existing runs
    op.add_column(
        'test_runs',
        sa.Column('runner_type', sa.String(length=20), nullable=False, server_default='playwright')
    )


def downgrade() -> None:
    op.drop_column('test_runs', 'runner_type')
