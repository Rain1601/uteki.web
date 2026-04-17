import { get, post, patch, del } from './client';
import type {
  APIKey,
  CreateAPIKeyRequest,
  UpdateAPIKeyRequest,
  LLMProvider,
  CreateLLMProviderWithKeyRequest,
  UpdateLLMProviderRequest,
  ExchangeConfig,
  CreateExchangeConfigRequest,
  DataSourceConfig,
  CreateDataSourceConfigRequest,
  SystemHealth,
  PaginatedResponse,
  MessageResponse,
  AggregatorProvider,
  AggregatorConfig,
  AggregatorVerifyResult,
} from '../types/admin';

export const adminApi = {
  // API Keys
  apiKeys: {
    list: (skip = 0, limit = 100) =>
      get<PaginatedResponse<APIKey>>('/api/admin/api-keys', {
        params: { skip, limit },
      }),

    create: (data: CreateAPIKeyRequest) =>
      post<APIKey>('/api/admin/api-keys', data),

    update: (id: string, data: UpdateAPIKeyRequest) =>
      patch<APIKey>(`/api/admin/api-keys/${id}`, data),

    delete: (id: string) =>
      del<MessageResponse>(`/api/admin/api-keys/${id}`),
  },

  // LLM Providers
  llmProviders: {
    list: (skip = 0, limit = 100) =>
      get<PaginatedResponse<LLMProvider>>('/api/admin/llm-providers', {
        params: { skip, limit },
      }),

    active: () =>
      get<LLMProvider[]>('/api/admin/llm-providers/active'),

    getDefault: () =>
      get<LLMProvider>('/api/admin/llm-providers/default'),

    createWithKey: (data: CreateLLMProviderWithKeyRequest) =>
      post<LLMProvider>('/api/admin/llm-providers/create-with-key', data),

    update: (id: string, data: UpdateLLMProviderRequest) =>
      patch<LLMProvider>(`/api/admin/llm-providers/${id}`, data),

    delete: (id: string) =>
      del<MessageResponse>(`/api/admin/llm-providers/${id}`),
  },

  // Exchange Configs
  exchanges: {
    list: (skip = 0, limit = 100) =>
      get<PaginatedResponse<ExchangeConfig>>('/api/admin/exchanges', {
        params: { skip, limit },
      }),

    active: () =>
      get<ExchangeConfig[]>('/api/admin/exchanges/active'),

    create: (data: CreateExchangeConfigRequest) =>
      post<ExchangeConfig>('/api/admin/exchanges', data),

    update: (id: string, data: Partial<CreateExchangeConfigRequest>) =>
      patch<ExchangeConfig>(`/api/admin/exchanges/${id}`, data),

    delete: (id: string) =>
      del<MessageResponse>(`/api/admin/exchanges/${id}`),
  },

  // Data Sources
  dataSources: {
    list: (skip = 0, limit = 100) =>
      get<PaginatedResponse<DataSourceConfig>>('/api/admin/data-sources', {
        params: { skip, limit },
      }),

    create: (data: CreateDataSourceConfigRequest) =>
      post<DataSourceConfig>('/api/admin/data-sources', data),

    update: (id: string, data: Partial<CreateDataSourceConfigRequest>) =>
      patch<DataSourceConfig>(`/api/admin/data-sources/${id}`, data),

    delete: (id: string) =>
      del<MessageResponse>(`/api/admin/data-sources/${id}`),
  },

  // System
  system: {
    health: () =>
      get<SystemHealth>('/api/admin/system/health'),
  },

  // Aggregators (AIHubMix / OpenRouter unified providers)
  aggregators: {
    list: () =>
      get<AggregatorConfig[]>('/api/admin/aggregators'),

    verify: (provider: AggregatorProvider, api_key: string) =>
      post<AggregatorVerifyResult>('/api/admin/aggregators/verify', { provider, api_key }),

    save: (provider: AggregatorProvider, api_key: string) =>
      post<AggregatorConfig>('/api/admin/aggregators', { provider, api_key }),

    balance: (provider: AggregatorProvider) =>
      get<AggregatorVerifyResult>(`/api/admin/aggregators/${provider}/balance`),

    delete: (provider: AggregatorProvider) =>
      del<MessageResponse>(`/api/admin/aggregators/${provider}`),
  },
};
