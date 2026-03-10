"""Auth domain SQLAlchemy models (local backup)."""

from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column
from uteki.common.base import Base, UUIDMixin, get_table_args


class RefreshToken(Base, UUIDMixin):
    """Persisted refresh tokens for mobile auth sessions."""

    __tablename__ = "refresh_tokens"
    __table_args__ = get_table_args(
        Index("ix_refresh_tokens_token_hash", "token_hash"),
        schema="auth",
    )

    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    def __repr__(self) -> str:
        return f"<RefreshToken user_id={self.user_id} revoked={self.revoked}>"
