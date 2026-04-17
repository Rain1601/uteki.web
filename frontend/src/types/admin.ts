// API Key types (matches backend APIKeyDetailResponse)
export interface APIKey {
  id: string;
  provider: string;
  display_name: string;
  environment: string;
  description?: string;
  is_active: boolean;
  has_secret: boolean;
  api_key_masked: string;
  extra_config?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CreateAPIKeyRequest {
  provider: string;
  display_name: string;
  api_key: string;
  api_secret?: string;
  extra_config?: Record<string, any>;
  environment?: string;
  is_active?: boolean;
  description?: string;
}

export interface UpdateAPIKeyRequest {
  display_name?: string;
  api_key?: string;
  api_secret?: string;
  extra_config?: Record<string, any>;
  environment?: string;
  is_active?: boolean;
  description?: string;
}

// LLM Provider types
export interface LLMProvider {
  id: string;
  provider: string;
  model: string;
  display_name: string;
  api_key_id: string;
  config?: Record<string, any>;
  is_default: boolean;
  is_active: boolean;
  priority: number;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateLLMProviderWithKeyRequest {
  provider: string;
  model: string;
  display_name: string;
  api_key: string;
  base_url?: string;
  temperature?: number;
  max_tokens?: number;
  is_default?: boolean;
  is_active?: boolean;
  priority?: number;
}

export interface UpdateLLMProviderRequest {
  display_name?: string;
  model?: string;
  api_key?: string;
  config?: Record<string, any>;
  is_default?: boolean;
  is_active?: boolean;
  priority?: number;
  description?: string;
}

// Exchange Config types
export interface ExchangeConfig {
  id: string;
  exchange: string;
  display_name: string;
  api_key_id: string;
  trading_enabled: boolean;
  spot_enabled: boolean;
  futures_enabled: boolean;
  max_position_size: number;
  risk_config?: Record<string, any>;
  exchange_config?: Record<string, any>;
  is_active: boolean;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateExchangeConfigRequest {
  exchange: string;
  display_name: string;
  api_key_id: string;
  trading_enabled?: boolean;
  spot_enabled?: boolean;
  futures_enabled?: boolean;
  max_position_size?: number;
  is_active?: boolean;
  description?: string;
}

// Data Source Config types
export interface DataSourceConfig {
  id: string;
  source_type: string;
  display_name: string;
  data_types: string[];
  api_key_id?: string;
  refresh_interval: number;
  priority: number;
  is_active: boolean;
  description?: string;
  created_at: string;
}

export interface CreateDataSourceConfigRequest {
  source_type: string;
  display_name: string;
  data_types: string[];
  api_key_id?: string;
  refresh_interval?: number;
  priority?: number;
  is_active?: boolean;
  description?: string;
}

// System Health types
export interface SystemHealth {
  status: string;
  databases: {
    postgresql: DatabaseStatus;
    redis: DatabaseStatus;
    clickhouse: DatabaseStatus;
    qdrant: DatabaseStatus;
    minio: DatabaseStatus;
  };
  timestamp: string;
}

export interface DatabaseStatus {
  status: 'connected' | 'disconnected' | 'degraded' | 'disabled';
  details?: string;
}

// Aggregator (Unified LLM Provider) types
export type AggregatorProvider = 'aihubmix' | 'openrouter';

export interface AggregatorBalance {
  credits: number | null;
  limit: number | null;
  usage: number | null;
  currency: string;
  label?: string | null;
}

export interface AggregatorVerifyResult {
  valid: boolean;
  balance?: AggregatorBalance | null;
  error?: string | null;
}

export interface AggregatorConfig {
  provider: AggregatorProvider;
  display_name: string;
  configured: boolean;
  api_key_masked?: string | null;
  is_active: boolean;
  base_url: string;
  supports_balance: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

// Paginated Response
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Message Response
export interface MessageResponse {
  message: string;
}
