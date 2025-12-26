"""add_session_title

Revision ID: a9b8c7d6e5f4
Revises: 7e8038204eba
Create Date: 2025-12-26 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a9b8c7d6e5f4'
down_revision: Union[str, None] = '7e8038204eba'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add title column to test_sessions
    op.add_column('test_sessions', sa.Column('title', sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column('test_sessions', 'title')
