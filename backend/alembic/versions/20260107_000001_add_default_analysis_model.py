"""add default_analysis_model to system_settings

Revision ID: c3d4e5f6g7h8
Revises: b2c3d4e5f6g7
Create Date: 2026-01-07 00:00:01.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6g7h8'
down_revision: Union[str, None] = 'b2c3d4e5f6g7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade() -> None:
    # Add default_analysis_model column to system_settings table if it doesn't exist
    if not column_exists('system_settings', 'default_analysis_model'):
        op.add_column('system_settings', sa.Column('default_analysis_model', sa.String(length=50), nullable=False, server_default='gemini-3.0-flash'))


def downgrade() -> None:
    # Remove default_analysis_model column from system_settings table
    if column_exists('system_settings', 'default_analysis_model'):
        op.drop_column('system_settings', 'default_analysis_model')
