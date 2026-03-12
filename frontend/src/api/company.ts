import { get, del, API_BASE } from './client';

// ── Types ──

export interface RevenueStream {
  name: string;
  percentage: number;
  growth_trend: string;
}

export interface BusinessAnalysisOutput {
  business_description: string;
  revenue_streams: RevenueStream[];
  profit_logic: string;
  is_good_business: boolean;
  business_quality: 'excellent' | 'good' | 'mediocre' | 'poor';
  quality_reasons: string[];
  sustainability_score: number;
  sustainability_reasoning: string;
  key_metrics: Record<string, number>;
  summary: string;
}

export interface FisherQuestion {
  id: string;
  question: string;
  answer: string;
  score: number;
  data_confidence: 'high' | 'medium' | 'low';
}

export interface FisherQAOutput {
  questions: FisherQuestion[];
  total_score: number;
  growth_verdict: 'compounder' | 'cyclical' | 'declining' | 'turnaround';
  radar_data: Record<string, number>;
  green_flags: string[];
  red_flags: string[];
  summary: string;
}

export interface MoatType {
  type: string;
  strength: 'strong' | 'moderate' | 'weak';
  evidence: string;
}

export interface MoatAssessmentOutput {
  moat_types: MoatType[];
  moat_width: 'wide' | 'narrow' | 'none';
  moat_trend: 'strengthening' | 'stable' | 'eroding';
  moat_durability_years: number;
  competitive_position: string;
  market_share_trend: string;
  moat_evidence: string[];
  moat_threats: string[];
  owner_earnings_quality: string;
  summary: string;
}

export interface ManagementAssessmentOutput {
  integrity_score: number;
  integrity_evidence: string;
  capital_allocation_score: number;
  capital_allocation_detail: string;
  shareholder_orientation_score: number;
  shareholder_orientation_detail: string;
  succession_risk: 'low' | 'medium' | 'high';
  succession_detail: string;
  insider_signal: string;
  key_person_risk: string;
  compensation_assessment: string;
  management_score: number;
  summary: string;
}

export interface DestructionScenario {
  scenario: string;
  probability: number;
  impact: number;
  timeline: string;
  reasoning: string;
}

export interface RedFlag {
  flag: string;
  triggered: boolean;
  detail: string;
}

export interface ReverseTestOutput {
  destruction_scenarios: DestructionScenario[];
  red_flags: RedFlag[];
  resilience_score: number;
  resilience_reasoning: string;
  cognitive_biases: string[];
  worst_case_narrative: string;
  summary: string;
}

export interface ValuationOutput {
  price_assessment: 'cheap' | 'fair' | 'expensive' | 'bubble';
  price_reasoning: string;
  safety_margin: 'large' | 'moderate' | 'thin' | 'negative';
  safety_margin_detail: string;
  market_sentiment: 'fear' | 'neutral' | 'greed' | 'euphoria';
  sentiment_detail: string;
  comparable_assessment: string;
  buy_confidence: number;
  price_vs_quality: string;
  summary: string;
}

export interface PositionHoldingOutput {
  action: 'BUY' | 'WATCH' | 'AVOID';
  conviction: number;
  quality_verdict: 'EXCELLENT' | 'GOOD' | 'MEDIOCRE' | 'POOR';
  position_size_pct: number;
  position_reasoning: string;
  sell_triggers: string[];
  add_triggers: string[];
  hold_horizon: string;
  philosophy_scores: Record<string, number>;
  buffett_comment: string;
  fisher_comment: string;
  munger_comment: string;
  one_sentence: string;
  summary: string;
}

export interface GateResult {
  gate: number;
  display_name: string;
  parsed: Record<string, any>;
  raw: string;
  parse_status: 'structured' | 'partial' | 'raw_only' | 'text' | 'timeout' | 'error';
  latency_ms: number;
  error?: string;
  tool_calls?: any[];
}

export interface CompanyAnalysisResult {
  symbol: string;
  company_name: string;
  sector: string;
  industry: string;
  current_price: number;
  skills: Record<string, GateResult>;
  verdict: PositionHoldingOutput;
  trace: Array<{
    gate: number;
    skill: string;
    display_name: string;
    status: string;
    latency_ms: number;
    error?: string;
  }>;
  tool_calls?: any[];
  model_used: string;
  total_latency_ms: number;
  data_freshness: {
    cached: boolean;
    fetched_at: string;
    cache_ttl_hours: number;
  };
  analysis_id?: string;
}

// ── Persisted analysis types ──

export interface CompanyAnalysisSummary {
  id: string;
  symbol: string;
  company_name: string;
  provider: string;
  model: string;
  status: string;
  verdict_action: string;
  verdict_conviction: number;
  verdict_quality: string;
  total_latency_ms: number;
  error_message?: string;
  created_at: string;
}

export interface CompanyAnalysisDetail extends CompanyAnalysisSummary {
  full_report: CompanyAnalysisResult;
}

export interface CompanyProgressEvent {
  type: 'data_loaded' | 'gate_start' | 'gate_text' | 'tool_call' | 'gate_complete' | 'result' | 'error';
  // data_loaded fields
  symbol?: string;
  company_name?: string;
  sector?: string;
  industry?: string;
  current_price?: number;
  data_freshness?: { cached: boolean; fetched_at: string };
  analysis_id?: string;
  // gate fields
  gate?: number;
  skill?: string;
  display_name?: string;
  has_tools?: boolean;
  parse_status?: string;
  latency_ms?: number;
  parsed?: Record<string, any>;
  raw?: string;  // natural language text from Gates 1-6
  text?: string;  // incremental streaming chunk from gate_text
  // tool_call fields
  tool_name?: string;
  tool_args?: Record<string, any>;
  round?: number;
  // result fields
  data?: CompanyAnalysisResult;
  // error fields
  error?: string;
  message?: string;
}

// ── Gate display names (for progress tracker) ──

export const GATE_NAMES: Record<number, string> = {
  1: '业务解析',
  2: 'Fisher 15问',
  3: '护城河评估',
  4: '管理层评估',
  5: '逆向检验',
  6: '估值与时机',
  7: '综合裁决',
};

export const TOTAL_GATES = 7;

// ── API functions ──

export const analyzeCompanyStream = (
  params: { symbol: string; provider?: string; model?: string },
  onEvent: (event: CompanyProgressEvent) => void,
): { cancel: () => void } => {
  const controller = new AbortController();
  const token = localStorage.getItem('auth_token');

  (async () => {
    try {
      const response = await fetch(`${API_BASE}/api/company/analyze/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        let detail = `HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(errBody);
          detail = parsed.detail || detail;
        } catch { /* ignore */ }
        onEvent({ type: 'error', message: detail });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              onEvent(event);
            } catch { /* ignore parse errors */ }
          }
        }
      }

      if (buffer.startsWith('data: ')) {
        try {
          const event = JSON.parse(buffer.slice(6));
          onEvent(event);
        } catch { /* ignore */ }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        onEvent({ type: 'error', message: e.message || 'Stream failed' });
      }
    }
  })();

  return { cancel: () => controller.abort() };
};

export const invalidateCompanyCache = (symbol: string) =>
  del<{ status: string; symbol: string; message: string }>(`/api/company/cache/${symbol}`);

// ── Analysis CRUD ──

export const listCompanyAnalyses = (params?: { symbol?: string; skip?: number; limit?: number }) =>
  get<{ analyses: CompanyAnalysisSummary[]; total: number }>('/api/company/analyses', { params });

export const getCompanyAnalysis = (id: string) =>
  get<CompanyAnalysisDetail>(`/api/company/analyses/${id}`);

export const deleteCompanyAnalysis = (id: string) =>
  del<{ status: string; id: string }>(`/api/company/analyses/${id}`);
