"""add_benchmark_mode

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2025-12-27 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add mode column to benchmark_sessions table
    op.add_column('benchmark_sessions',
        sa.Column('mode', sa.String(length=20), nullable=False, server_default='auto')
    )


def downgrade() -> None:
    op.drop_column('benchmark_sessions', 'mode')
