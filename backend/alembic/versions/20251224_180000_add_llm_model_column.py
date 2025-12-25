"""add_llm_model_column

Revision ID: 8747521d0002
Revises: 8747521d0001
Create Date: 2025-12-24 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8747521d0002'
down_revision: Union[str, None] = '8747521d0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add llm_model column to test_sessions table
    op.add_column('test_sessions', sa.Column('llm_model', sa.String(length=50), nullable=False, server_default='browser-use-llm'))


def downgrade() -> None:
    op.drop_column('test_sessions', 'llm_model')
