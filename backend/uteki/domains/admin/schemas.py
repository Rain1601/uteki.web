"""
Admin domain Pydantic schemas - API请求/响应模型
"""

from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Dict, Any
from datetime import datetime


# ============================================================================
# API Key Schemas
# ============================================================================

class APIKeyBase(BaseModel):
    """API密钥基础schema"""
    provider: str = Field(..., description="服务提供商 (okx, binance, fmp, openai, etc.)")
    display_name: str = Field(..., description="显示名称")
    environment: str = Field(default="production", description="环境 (production, sandbox, testnet)")
    description: Optional[str] = Field(None, description="描述")


class APIKeyCreate(APIKeyBase):
    """创建API密钥"""
    api_key: str = Field(..., description="API密钥")
    api_secret: Optional[str] = Field(None, description="API密钥Secret (可选)")
    extra_config: Optional[Dict[str, Any]] = Field(None, description="额外配置")
    is_active: bool = Field(default=True, description="是否启用")


class APIKeyUpdate(BaseModel):
    """更新API密钥"""
    display_name: Optional[str] = None
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    extra_config: Optional[Dict[str, Any]] = None
    environment: Optional[str] = None
    is_active: Optional[bool] = None
    description: Optional[str] = None


class APIKeyResponse(APIKeyBase):
    """API密钥响应 (不包含敏感信息)"""
    id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    # 注意：不返回api_key和api_secret
    has_secret: bool = Field(..., description="是否配置了secret")

    class Config:
        from_attributes = True


class APIKeyDetailResponse(APIKeyResponse):
    """API密钥详细响应 (包含掩码后的密钥)"""
    api_key_masked: str = Field(..., description="掩码后的API密钥")
    extra_config: Optional[Dict[str, Any]] = None


# ============================================================================
# User Schemas
# ============================================================================

class UserBase(BaseModel):
    """用户基础schema"""
    email: EmailStr
    username: str


class UserCreate(UserBase):
    """创建用户"""
    oauth_provider: str = Field(..., description="OAuth提供商 (google, github, email)")
    oauth_id: Optional[str] = None
    avatar_url: Optional[str] = None


class UserUpdate(BaseModel):
    """更新用户"""
    username: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: Optional[bool] = None
    preferences: Optional[Dict[str, Any]] = None


class UserResponse(UserBase):
    """用户响应"""
    id: str
    oauth_provider: str
    avatar_url: Optional[str]
    is_active: bool
    is_admin: bool
    preferences: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# System Config Schemas
# ============================================================================

class SystemConfigBase(BaseModel):
    """系统配置基础schema"""
    config_key: str
    config_value: Any
    config_type: str = Field(default="system", description="配置类型")
    description: Optional[str] = None
    is_sensitive: bool = Field(default=False, description="是否敏感信息")


class SystemConfigCreate(SystemConfigBase):
    """创建系统配置"""
    pass


class SystemConfigUpdate(BaseModel):
    """更新系统配置"""
    config_value: Optional[Any] = None
    config_type: Optional[str] = None
    description: Optional[str] = None
    is_sensitive: Optional[bool] = None


class SystemConfigResponse(SystemConfigBase):
    """系统配置响应"""
    id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# Audit Log Schemas
# ============================================================================

class AuditLogBase(BaseModel):
    """审计日志基础schema"""
    action: str
    resource_type: str
    resource_id: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


class AuditLogCreate(AuditLogBase):
    """创建审计日志"""
    user_id: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    status: str
    error_message: Optional[str] = None


class AuditLogResponse(AuditLogBase):
    """审计日志响应"""
    id: str
    user_id: Optional[str]
    ip_address: Optional[str]
    status: str
    error_message: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# Common Response Schemas
# ============================================================================

class MessageResponse(BaseModel):
    """通用消息响应"""
    message: str


class PaginatedResponse(BaseModel):
    """分页响应基类"""
    total: int = Field(..., description="总记录数")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页记录数")
    total_pages: int = Field(..., description="总页数")


class PaginatedAPIKeysResponse(PaginatedResponse):
    """分页API密钥响应"""
    items: list[APIKeyDetailResponse]


class PaginatedUsersResponse(PaginatedResponse):
    """分页用户响应"""
    items: list[UserResponse]


class PaginatedAuditLogsResponse(PaginatedResponse):
    """分页审计日志响应"""
    items: list[AuditLogResponse]


# ============================================================================
# LLM Provider Schemas
# ============================================================================

class LLMProviderBase(BaseModel):
    """LLM提供商基础schema"""
    provider: str = Field(..., description="提供商 (openai, anthropic, dashscope, deepseek)")
    model: str = Field(..., description="模型名称")
    display_name: str = Field(..., description="显示名称")
    config: Optional[Dict[str, Any]] = Field(None, description="模型配置")
    is_default: bool = Field(default=False, description="是否为默认provider")
    priority: int = Field(default=0, description="优先级")
    description: Optional[str] = Field(None, description="描述")


class LLMProviderCreate(LLMProviderBase):
    """创建LLM提供商"""
    api_key_id: str = Field(..., description="关联的API密钥ID")
    is_active: bool = Field(default=True, description="是否启用")


class LLMProviderCreateWithKey(BaseModel):
    """创建LLM提供商 + 自动管理API Key"""
    provider: str = Field(..., description="提供商 (openai, anthropic, etc.)")
    model: str = Field(..., description="模型名称")
    display_name: str = Field(..., description="显示名称")
    api_key: str = Field(..., description="API密钥（会被加密存储）")
    base_url: Optional[str] = Field(None, description="自定义 Base URL")
    temperature: Optional[float] = Field(0, description="温度")
    max_tokens: Optional[int] = Field(4096, description="最大 tokens")
    is_default: bool = Field(default=False, description="是否为默认")
    is_active: bool = Field(default=True, description="是否启用")
    priority: int = Field(default=0, description="优先级")


class LLMProviderUpdate(BaseModel):
    """更新LLM提供商"""
    display_name: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = Field(None, description="新的 API Key（会重新加密）")
    config: Optional[Dict[str, Any]] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None
    priority: Optional[int] = None
    description: Optional[str] = None


class LLMProviderResponse(LLMProviderBase):
    """LLM提供商响应"""
    id: str
    api_key_id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# Exchange Config Schemas
# ============================================================================

class ExchangeConfigBase(BaseModel):
    """交易所配置基础schema"""
    exchange: str = Field(..., description="交易所名称 (okx, binance, xueying)")
    display_name: str = Field(..., description="显示名称")
    trading_enabled: bool = Field(default=True, description="是否启用交易")
    spot_enabled: bool = Field(default=True, description="是否启用现货")
    futures_enabled: bool = Field(default=False, description="是否启用合约")
    max_position_size: float = Field(default=10000.00, description="最大持仓金额(USD)")
    risk_config: Optional[Dict[str, Any]] = Field(None, description="风险配置")
    exchange_config: Optional[Dict[str, Any]] = Field(None, description="交易所特定配置")
    description: Optional[str] = Field(None, description="描述")


class ExchangeConfigCreate(ExchangeConfigBase):
    """创建交易所配置"""
    api_key_id: str = Field(..., description="关联的API密钥ID")
    is_active: bool = Field(default=True, description="是否启用")


class ExchangeConfigUpdate(BaseModel):
    """更新交易所配置"""
    display_name: Optional[str] = None
    trading_enabled: Optional[bool] = None
    spot_enabled: Optional[bool] = None
    futures_enabled: Optional[bool] = None
    max_position_size: Optional[float] = None
    risk_config: Optional[Dict[str, Any]] = None
    exchange_config: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None
    description: Optional[str] = None


class ExchangeConfigResponse(ExchangeConfigBase):
    """交易所配置响应"""
    id: str
    api_key_id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# Data Source Config Schemas
# ============================================================================

class DataSourceConfigBase(BaseModel):
    """数据源配置基础schema"""
    source_type: str = Field(..., description="数据源类型 (fmp, yahoo, coingecko)")
    display_name: str = Field(..., description="显示名称")
    data_types: list[str] = Field(..., description="支持的数据类型")
    refresh_interval: int = Field(default=60, description="刷新间隔(秒)")
    priority: int = Field(default=0, description="优先级")
    source_config: Optional[Dict[str, Any]] = Field(None, description="数据源配置")
    description: Optional[str] = Field(None, description="描述")


class DataSourceConfigCreate(DataSourceConfigBase):
    """创建数据源配置"""
    api_key_id: Optional[str] = Field(None, description="关联的API密钥ID (可选)")
    is_active: bool = Field(default=True, description="是否启用")


class DataSourceConfigUpdate(BaseModel):
    """更新数据源配置"""
    display_name: Optional[str] = None
    data_types: Optional[list[str]] = None
    refresh_interval: Optional[int] = None
    priority: Optional[int] = None
    source_config: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None
    description: Optional[str] = None


class DataSourceConfigResponse(DataSourceConfigBase):
    """数据源配置响应"""
    id: str
    api_key_id: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# Additional Paginated Responses
# ============================================================================

class PaginatedLLMProvidersResponse(PaginatedResponse):
    """分页LLM提供商响应"""
    items: list[LLMProviderResponse]


class PaginatedExchangeConfigsResponse(PaginatedResponse):
    """分页交易所配置响应"""
    items: list[ExchangeConfigResponse]


class PaginatedDataSourceConfigsResponse(PaginatedResponse):
    """分页数据源配置响应"""
    items: list[DataSourceConfigResponse]


# ============================================================================
# Aggregator (Unified LLM Provider) Schemas — AIHubMix, OpenRouter
# ============================================================================


class AggregatorVerifyRequest(BaseModel):
    """Ad-hoc key verification — used before user clicks 'save' to give quick feedback."""
    provider: str = Field(..., description="aihubmix | openrouter")
    api_key: str = Field(..., min_length=1)


class AggregatorBalanceInfo(BaseModel):
    credits: Optional[float] = Field(None, description="Remaining credits (null if unknown)")
    limit: Optional[float] = Field(None, description="Total credit limit")
    usage: Optional[float] = Field(None, description="Credits consumed")
    currency: str = "USD"
    label: Optional[str] = None


class AggregatorVerifyResponse(BaseModel):
    valid: bool
    balance: Optional[AggregatorBalanceInfo] = None
    error: Optional[str] = None


class AggregatorSaveRequest(BaseModel):
    """Save (upsert) an aggregator API key for the current user."""
    provider: str = Field(..., description="aihubmix | openrouter")
    api_key: str = Field(..., min_length=1)


class AggregatorConfigResponse(BaseModel):
    """One aggregator entry for the Settings UI."""
    provider: str
    display_name: str
    configured: bool
    api_key_masked: Optional[str] = None
    is_active: bool
    base_url: str
    supports_balance: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
