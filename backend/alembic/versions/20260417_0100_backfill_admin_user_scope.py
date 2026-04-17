"""Backfill user_id='default' to the first real user on admin tables.

Revision ID: 20260417_0100
Revises: 20260406_0200
Create Date: 2026-04-17 01:00:00.000000

Fixes a historical bug where api_keys / llm_providers / exchange_configs
were created with user_id='default' regardless of the authenticated user.
This migration backfills those records to the first real user in
admin.users so the new user-scoped admin API can correctly isolate data.

If admin.users is empty (no one has signed up), the migration is a no-op;
records remain with user_id='default' until a user signs in (see
common/bootstrap_user_backfill.py or manual SQL).
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260417_0100"
down_revision: Union[str, None] = "20260406_0200"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


AFFECTED = [
    ("admin", "api_keys"),
    ("admin", "llm_providers"),
    ("admin", "exchange_configs"),
]


def is_sqlite() -> bool:
    bind = op.get_bind()
    return bind.dialect.name == "sqlite"


def _qualified(schema: str, table: str) -> str:
    """Return quoted schema-qualified name appropriate for the dialect."""
    if is_sqlite():
        # SQLite ignores schemas; tables are created flat
        return table
    return f'{schema}.{table}'


def upgrade() -> None:
    bind = op.get_bind()

    # Find the first real user (by created_at asc) — presumed owner of all
    # previously-created "default" records on a single-tenant deployment.
    users_table = _qualified("admin", "users")
    result = bind.execute(
        sa.text(f"SELECT id FROM {users_table} ORDER BY created_at ASC LIMIT 1")
    ).fetchone()

    if not result:
        # No user yet — nothing to backfill. The admin API will now 401 any
        # unauthenticated request, so no new "default" rows will be created.
        return

    target_user_id = result[0]

    for schema, table in AFFECTED:
        qualified = _qualified(schema, table)
        bind.execute(
            sa.text(
                f"UPDATE {qualified} SET user_id = :uid WHERE user_id = 'default'"
            ),
            {"uid": target_user_id},
        )


def downgrade() -> None:
    # Deliberately non-reversible: reverting would set all previously-owned
    # rows back to 'default', which would re-introduce the cross-user leak
    # this migration closes. If you need to undo, do it manually in SQL.
    pass
