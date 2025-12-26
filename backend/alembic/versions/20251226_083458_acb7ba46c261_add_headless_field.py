"""add_headless_field

Revision ID: acb7ba46c261
Revises: 8747521d0005
Create Date: 2025-12-26 08:34:58.809205

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'acb7ba46c261'
down_revision: Union[str, None] = '8747521d0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Only add the new headless columns with server_default for existing rows
    op.add_column('test_runs', sa.Column('headless', sa.Boolean(), nullable=False, server_default=sa.text('1')))
    op.add_column('test_sessions', sa.Column('headless', sa.Boolean(), nullable=False, server_default=sa.text('1')))


def downgrade() -> None:
    op.drop_column('test_sessions', 'headless')
    op.drop_column('test_runs', 'headless')
