"""Add detailed fields to run_steps for Execute tab display.

Adds element_name, element_xpath, css_selector, input_value, and is_password
fields to run_steps for enhanced Execute tab display with icons, selectors,
and masked password values.

Revision ID: add_run_step_details
Revises: add_auto_generate_text
Create Date: 2026-01-10 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = 'add_run_step_details'
down_revision = 'add_auto_generate_text'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('run_steps', sa.Column('element_name', sa.String(256), nullable=True))
    op.add_column('run_steps', sa.Column('element_xpath', sa.String(1024), nullable=True))
    op.add_column('run_steps', sa.Column('css_selector', sa.String(1024), nullable=True))
    op.add_column('run_steps', sa.Column('input_value', sa.Text(), nullable=True))
    op.add_column('run_steps', sa.Column('is_password', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('run_steps', 'is_password')
    op.drop_column('run_steps', 'input_value')
    op.drop_column('run_steps', 'css_selector')
    op.drop_column('run_steps', 'element_xpath')
    op.drop_column('run_steps', 'element_name')
