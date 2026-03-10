"""User domain models for authentication and authorization."""

from typing import Optional
from sqlalchemy import String, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from uteki.common.base import Base, UUIDMixin, TimestampMixin, get_table_args


class User(Base, UUIDMixin, TimestampMixin):
    """User model for authentication and multi-tenancy."""

    __tablename__ = "users"
    __table_args__ = {"schema": "auth"}

    # Basic info
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Authentication — nullable for social-only users
    hashed_password: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username} email={self.email}>"


class UserAuthProvider(Base, UUIDMixin, TimestampMixin):
    """Tracks which OAuth/social providers are bound to each user account."""

    __tablename__ = "user_auth_providers"
    __table_args__ = get_table_args(
        UniqueConstraint("provider", "provider_subject", name="uq_provider_subject"),
        UniqueConstraint("user_id", "provider", name="uq_user_provider"),
        schema="auth",
    )

    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    # provider's unique user ID (Apple sub, Google sub, github ID, email address, etc.)
    provider_subject: Mapped[str] = mapped_column(String(255), nullable=False)

    def __repr__(self) -> str:
        return f"<UserAuthProvider user_id={self.user_id} provider={self.provider}>"
