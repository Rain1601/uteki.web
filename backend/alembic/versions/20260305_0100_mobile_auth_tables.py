"""Add user_auth_providers, refresh_tokens tables; make hashed_password nullable.

Revision ID: 20260305_0100
Revises: 20260301_0800
Create Date: 2026-03-05 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260305_0100"
down_revision: Union[str, None] = "20260301_0800"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def is_sqlite() -> bool:
    bind = op.get_bind()
    return bind.dialect.name == "sqlite"


def upgrade() -> None:
    schema_auth = None if is_sqlite() else "auth"

    if not is_sqlite():
        op.execute("CREATE SCHEMA IF NOT EXISTS auth")

    # 2.1 Create user_auth_providers table
    op.create_table(
        "user_auth_providers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), nullable=False, index=True),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("provider_subject", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint("provider", "provider_subject", name="uq_provider_subject"),
        sa.UniqueConstraint("user_id", "provider", name="uq_user_provider"),
        schema=schema_auth,
    )

    # 2.2 Create refresh_tokens table
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), nullable=False, index=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        schema=schema_auth,
    )
    op.create_index(
        "ix_refresh_tokens_token_hash",
        "refresh_tokens",
        ["token_hash"],
        schema=schema_auth,
    )

    # 2.3 Make hashed_password nullable on users table
    if is_sqlite():
        # SQLite does not support ALTER COLUMN — skip (dev only, recreate if needed)
        pass
    else:
        op.alter_column(
            "users",
            "hashed_password",
            existing_type=sa.String(255),
            nullable=True,
            schema=schema_auth,
        )

    # 2.4 Backfill user_auth_providers from existing oauth_provider/oauth_id fields
    # This runs as raw SQL — only for PostgreSQL (Supabase has these columns)
    if not is_sqlite():
        op.execute("""
            INSERT INTO auth.user_auth_providers (id, user_id, provider, provider_subject, created_at, updated_at)
            SELECT
                gen_random_uuid()::text,
                id,
                oauth_provider,
                oauth_id,
                COALESCE(created_at, NOW()),
                NOW()
            FROM auth.users
            WHERE oauth_provider IS NOT NULL
              AND oauth_id IS NOT NULL
            ON CONFLICT DO NOTHING
        """)


def downgrade() -> None:
    schema_auth = None if is_sqlite() else "auth"

    op.drop_index("ix_refresh_tokens_token_hash", table_name="refresh_tokens", schema=schema_auth)
    op.drop_table("refresh_tokens", schema=schema_auth)
    op.drop_table("user_auth_providers", schema=schema_auth)

    if not is_sqlite():
        op.alter_column(
            "users",
            "hashed_password",
            existing_type=sa.String(255),
            nullable=False,
            schema=schema_auth,
        )
