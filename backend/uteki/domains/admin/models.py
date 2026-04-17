"""
Admin domain models - 系统管理相关数据模型
"""

from sqlalchemy import String, Boolean, JSON, Integer, Numeric, Index, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional, Dict, Any
from decimal import Decimal

from uteki.common.base import Base, TimestampMixin, UUIDMixin, get_table_args, get_table_ref


class APIKey(Base, UUIDMixin, TimestampMixin):
    """
    API密钥配置表
    存储交易所、数据源、LLM等第三方服务的API密钥
    """

    __tablename__ = "api_keys"
    __table_args__ = get_table_args(
        Index("idx_api_keys_provider_env", "provider", "environment"),
        Index("idx_api_keys_user", "user_id"),
        schema="admin"
    )

    # 用户ID (多租户隔离)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)

    # 服务提供商 (okx, binance, fmp, openai, anthropic, dashscope, etc.)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)

    # 显示名称
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)

    # API Key (加密存储)
    api_key: Mapped[str] = mapped_column(String(500), nullable=False)

    # API Secret (可选，加密存储)
    api_secret: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # 额外配置 (如OKX的passphrase, 或其他provider特定配置)
    extra_config: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # 环境 (production, sandbox, testnet)
    environment: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="production"
    )

    # 是否启用
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # 描述
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    def __repr__(self):
        return f"<APIKey(id={self.id}, provider={self.provider}, environment={self.environment})>"


class User(Base, UUIDMixin, TimestampMixin):
    """
    用户表 (预留多用户支持)
    支持OAuth登录 (Google, GitHub)
    """

    __tablename__ = "users"
    __table_args__ = get_table_args(
        Index("idx_users_email", "email", unique=True),
        Index("idx_users_oauth", "oauth_provider", "oauth_id"),
        schema="admin"
    )

    # 用户邮箱
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)

    # 用户名
    username: Mapped[str] = mapped_column(String(100), nullable=False)

    # OAuth提供商 (google, github, email)
    oauth_provider: Mapped[str] = mapped_column(String(50), nullable=False)

    # OAuth ID
    oauth_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # 头像URL
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # 是否激活
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # 是否管理员
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # 用户配置 (偏好设置等)
    preferences: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    def __repr__(self):
        return f"<User(id={self.id}, email={self.email}, oauth_provider={self.oauth_provider})>"


class SystemConfig(Base, UUIDMixin, TimestampMixin):
    """
    系统配置表
    键值对存储系统级配置
    """

    __tablename__ = "system_config"
    __table_args__ = get_table_args(
        Index("idx_system_config_key", "config_key", unique=True),
        schema="admin"
    )

    # 配置键
    config_key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)

    # 配置值
    config_value: Mapped[Any] = mapped_column(JSON, nullable=False)

    # 配置类型 (system, feature, integration)
    config_type: Mapped[str] = mapped_column(String(50), nullable=False, default="system")

    # 描述
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # 是否敏感信息
    is_sensitive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    def __repr__(self):
        return f"<SystemConfig(key={self.config_key}, type={self.config_type})>"


class AuditLog(Base, UUIDMixin, TimestampMixin):
    """
    审计日志表
    记录系统关键操作
    """

    __tablename__ = "audit_logs"
    __table_args__ = get_table_args(
        Index("idx_audit_logs_user_action", "user_id", "action"),
        Index("idx_audit_logs_created", "created_at"),
        schema="admin"
    )

    # 用户ID (可选，系统操作时为None)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    # 操作类型 (api_key.create, trade.execute, agent.run, etc.)
    action: Mapped[str] = mapped_column(String(100), nullable=False)

    # 资源类型 (api_key, order, agent_task, etc.)
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # 资源ID
    resource_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # 操作详情
    details: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # IP地址
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)

    # User Agent
    user_agent: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # 操作结果 (success, failure)
    status: Mapped[str] = mapped_column(String(20), nullable=False)

    # 错误信息 (如果失败)
    error_message: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    def __repr__(self):
        return f"<AuditLog(action={self.action}, resource={self.resource_type}, status={self.status})>"


class LLMProvider(Base, UUIDMixin, TimestampMixin):
    """
    LLM提供商配置表
    管理OpenAI、Anthropic、DeepSeek、Qwen等LLM服务配置
    """

    __tablename__ = "llm_providers"
    __table_args__ = get_table_args(
        Index("idx_llm_providers_provider", "provider"),
        Index("idx_llm_providers_default", "is_default"),
        Index("idx_llm_providers_user", "user_id"),
        schema="admin"
    )

    # 用户ID (多租户隔离)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)

    # 提供商 (openai, anthropic, dashscope, deepseek, etc.)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)

    # 模型名称 (gpt-4, claude-3-5-sonnet-20241022, qwen-max, deepseek-chat)
    model: Mapped[str] = mapped_column(String(100), nullable=False)

    # 关联的API密钥ID
    api_key_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(f"{get_table_ref('api_keys', 'admin')}.id", ondelete="CASCADE"),
        nullable=False
    )

    # 显示名称
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)

    # 模型配置 (temperature, max_tokens, top_p, etc.)
    config: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # 是否为默认provider（用于Agent）
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # 是否启用
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # 优先级 (数字越小优先级越高)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 描述
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    def __repr__(self):
        return f"<LLMProvider(id={self.id}, provider={self.provider}, model={self.model})>"


class ExchangeConfig(Base, UUIDMixin, TimestampMixin):
    """
    交易所配置表
    管理OKX、Binance、雪盈等交易所配置
    """

    __tablename__ = "exchange_configs"
    __table_args__ = get_table_args(
        Index("idx_exchange_configs_exchange", "exchange"),
        Index("idx_exchange_configs_active", "is_active"),
        Index("idx_exchange_configs_user", "user_id"),
        schema="admin"
    )

    # 用户ID (多租户隔离)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)

    # 交易所名称 (okx, binance, xueying, etc.)
    exchange: Mapped[str] = mapped_column(String(50), nullable=False)

    # 关联的API密钥ID
    api_key_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(f"{get_table_ref('api_keys', 'admin')}.id", ondelete="CASCADE"),
        nullable=False
    )

    # 显示名称
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)

    # 是否启用交易
    trading_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # 是否启用现货交易
    spot_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # 是否启用合约交易
    futures_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # 最大持仓金额 (USD)
    max_position_size: Mapped[Decimal] = mapped_column(
        Numeric(20, 2),
        nullable=False,
        default=10000.00
    )

    # 风险配置 (max_leverage, stop_loss_pct, etc.)
    risk_config: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # 交易所特定配置 (simulated, ip_whitelist, etc.)
    exchange_config: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # 是否启用
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # 描述
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    def __repr__(self):
        return f"<ExchangeConfig(id={self.id}, exchange={self.exchange}, trading={self.trading_enabled})>"


class DataSourceConfig(Base, UUIDMixin, TimestampMixin):
    """
    数据源配置表
    管理FMP、Yahoo Finance、CoinGecko等数据源配置
    """

    __tablename__ = "data_source_configs"
    __table_args__ = get_table_args(
        Index("idx_data_source_configs_source", "source_type"),
        Index("idx_data_source_configs_priority", "priority"),
        schema="admin"
    )

    # 数据源类型 (fmp, yahoo, coingecko, ccxt, etc.)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # 关联的API密钥ID (可选，某些数据源不需要API key)
    api_key_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey(f"{get_table_ref('api_keys', 'admin')}.id", ondelete="SET NULL"),
        nullable=True
    )

    # 显示名称
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)

    # 支持的数据类型 (["stock", "crypto", "forex", "fundamental"])
    data_types: Mapped[list[str]] = mapped_column(JSON, nullable=False)

    # 刷新间隔 (秒)
    refresh_interval: Mapped[int] = mapped_column(Integer, nullable=False, default=60)

    # 优先级 (当多个数据源可用时，数字越小优先级越高)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 数据源特定配置 (rate_limit, endpoints, etc.)
    source_config: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # 是否启用
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # 描述
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    def __repr__(self):
        return f"<DataSourceConfig(id={self.id}, source={self.source_type}, priority={self.priority})>"
