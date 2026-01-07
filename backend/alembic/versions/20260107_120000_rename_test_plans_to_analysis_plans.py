"""Rename test_plans table to analysis_plans to prepare for new TestPlan module.

Revision ID: rename_test_plans_01
Revises: c3d4e5f6g7h8
Create Date: 2026-01-07 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers
revision = 'rename_test_plans_01'
down_revision = 'c3d4e5f6g7h8'
branch_labels = None
depends_on = None


def table_exists(table_name: str) -> bool:
    """Check if a table exists in the database."""
    bind = op.get_bind()
    inspector = inspect(bind)
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    # Rename the test_plans table to analysis_plans (if it exists)
    # The old test_plans table was for LLM analysis plans, we're renaming to avoid
    # conflict with the new TestPlan module for grouping test cases
    if table_exists('test_plans') and not table_exists('analysis_plans'):
        op.rename_table('test_plans', 'analysis_plans')


def downgrade() -> None:
    # Rename back to test_plans (if analysis_plans exists)
    if table_exists('analysis_plans') and not table_exists('test_plans'):
        op.rename_table('analysis_plans', 'test_plans')
