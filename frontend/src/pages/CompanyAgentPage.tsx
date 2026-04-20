import { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Typography, IconButton, Switch } from '@mui/material';
import { Loader2, Trash2, Scale, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import TradingViewChart from '../components/index/TradingViewChart';
import { ModelLogo } from '../components/index/ModelLogos';
import PageHeader from '../components/PageHeader';
import { useTheme } from '../theme/ThemeProvider';
import { API_BASE } from '../api/client';
import CompanyAnalysisForm from '../components/company/CompanyAnalysisForm';
import { type GateStatus } from '../components/company/GateProgressTracker';
import ThinkingTimeline from '../components/company/ThinkingTimeline';
import ReportPanel from '../components/company/ReportPanel';
import CompareView from '../components/company/CompareView';
import {
  analyzeCompanyStream,
  listCompanyAnalyses,
  getCompanyAnalysis,
  deleteCompanyAnalysis,
  type CompanyProgressEvent,
  type CompanyAnalysisResult,
  type CompanyAnalysisSummary,
  type CompanyAnalysisDetail,
  type PositionHoldingOutput,
  type GateResult,
} from '../api/company';

const spinKeyframes = `
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes analyzing-pulse {
  0%, 100% { background-color: rgba(59,130,246,0.08); }
  50% { background-color: rgba(59,130,246,0.18); }
}`;

interface RunningAnalysis {
  id: string;
  analysisId: string | null;
  symbol: string;
  provider: string;
  cancel: () => void;
  currentGate: number | null;
  gateStatuses: Record<number, GateStatus>;
  gateResults: Record<string, any>;
  streamingTexts: Record<string, string>;
  companyInfo: { name: string; symbol: string; sector: string; industry: string; price: number } | null;
  result: CompanyAnalysisResult | null;
  error: string | null;
  startTime: number;
  elapsedMs: number;
}

const SKILL_ORDER = [
  'business_analysis', 'fisher_qa', 'moat_assessment',
  'management_assessment', 'reverse_test', 'valuation', 'final_verdict',
] as const;

const ACTION_COLORS: Record<string, string> = {
  BUY: '#22c55e', WATCH: '#f59e0b', AVOID: '#ef4444',
};

interface ChartPoint { date: string; close: number; }

function SvgLineChart({ data, width, height, color }: { data: ChartPoint[]; width: number; height: number; color: string }) {
  if (data.length < 2) return null;
  const closes = data.map(d => d.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const pad = 4;
  const w = width;
  const h = height - pad * 2;
  const points = closes.map((c, i) => {
    const x = (i / (closes.length - 1)) * w;
    const y = pad + h - ((c - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const gradId = `areaGrad-${Math.random().toString(36).slice(2, 6)}`;
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${points} ${w},${height} 0,${height}`} fill={`url(#${gradId})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function CompanyAgentPage() {
  const { theme } = useTheme();

  const [analyses, setAnalyses] = useState<CompanyAnalysisSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<CompanyAnalysisDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [runningAnalyses, setRunningAnalyses] = useState<Map<string, RunningAnalysis>>(new Map());
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [scrollToGate, setScrollToGate] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runIdCounter = useRef(0);
  const runningRef = useRef(runningAnalyses);
  runningRef.current = runningAnalyses;

  const hasSelection = !!viewingRunId || !!selectedId;
  const [activeGate, setActiveGate] = useState<number | null>(null);
  const [watchlistSymbol, setWatchlistSymbol] = useState<string | null>(null);

  // Judge state
  const [judging, setJudging] = useState(false);
  const [judgeResult, setJudgeResult] = useState<any>(null);

  // New feature states
  const [compareMode, setCompareMode] = useState(false);
  const [compareState, setCompareState] = useState<{ symbol: string; models: string[] } | null>(null);

  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Left panel tab: watchlist or recommendations
  const [leftTab, setLeftTab] = useState<'watchlist' | 'recommend'>('watchlist');

  // ── Watchlist groups ──
  interface WatchlistGroup {
    id: string;
    name: string;
    symbols: { symbol: string; company: string }[];
  }
  const [watchlistGroups, setWatchlistGroups] = useState<WatchlistGroup[]>([
    { id: 'company', name: '公司', symbols: [
      { symbol: 'TSLA', company: 'Tesla, Inc.' },
      { symbol: 'AAPL', company: 'Apple Inc.' },
      { symbol: 'GOOGL', company: 'Alphabet Inc.' },
      { symbol: 'TSM', company: 'Taiwan Semiconductor Manufacturing Comp.' },
      { symbol: 'MSFT', company: 'Microsoft Corporation' },
    ]},
    { id: 'index', name: '指数', symbols: [
      { symbol: 'SPY', company: 'SPDR S&P 500 ETF' },
      { symbol: 'QQQ', company: 'Invesco QQQ Trust' },
      { symbol: 'DIA', company: 'SPDR Dow Jones ETF' },
      { symbol: 'IWM', company: 'iShares Russell 2000 ETF' },
    ]},
    { id: 'crypto', name: '加密', symbols: [
      { symbol: 'COIN', company: 'Coinbase Global' },
      { symbol: 'MSTR', company: 'MicroStrategy Inc.' },
    ]},
  ]);
  const [activeGroupId, setActiveGroupId] = useState('company');
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const groupScrollRef = useRef<HTMLDivElement>(null);
  const [groupScrollState, setGroupScrollState] = useState({ canLeft: false, canRight: false });

  const updateGroupScroll = useCallback(() => {
    const el = groupScrollRef.current;
    if (!el) return;
    setGroupScrollState({
      canLeft: el.scrollLeft > 1,
      canRight: el.scrollLeft < el.scrollWidth - el.clientWidth - 1,
    });
  }, []);

  const scrollGroup = (dir: 'left' | 'right') => {
    const el = groupScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -80 : 80, behavior: 'smooth' });
    setTimeout(updateGroupScroll, 200);
  };

  const handleAddGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    const id = `group-${Date.now()}`;
    setWatchlistGroups(prev => [...prev, { id, name, symbols: [] }]);
    setActiveGroupId(id);
    setAddingGroup(false);
    setNewGroupName('');
    setTimeout(() => {
      const el = groupScrollRef.current;
      if (el) { el.scrollLeft = el.scrollWidth; updateGroupScroll(); }
    }, 50);
  };

  const handleDeleteGroup = (id: string) => {
    setWatchlistGroups(prev => prev.filter(g => g.id !== id));
    if (activeGroupId === id) setActiveGroupId(watchlistGroups[0]?.id || '');
  };

  const handleAddSymbolToGroup = (groupId: string, symbol: string, company: string) => {
    setWatchlistGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      if (g.symbols.some(s => s.symbol === symbol)) return g;
      return { ...g, symbols: [...g.symbols, { symbol, company }] };
    }));
  };

  const handleRemoveSymbolFromGroup = (groupId: string, symbol: string) => {
    setWatchlistGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      return { ...g, symbols: g.symbols.filter(s => s.symbol !== symbol) };
    }));
  };

  useEffect(() => { updateGroupScroll(); }, [watchlistGroups, updateGroupScroll]);

  interface Recommendation {
    id: string; symbol: string; company: string; model: string;
    date: string; reason: string; status: 'pending' | 'accepted' | 'rejected';
  }
  const [recommendations, setRecommendations] = useState<Recommendation[]>([
    { id: 'r1', symbol: 'PLTR', company: 'Palantir Tech.', model: 'claude-sonnet', date: '04-06', reason: 'AI/defense sector momentum, strong government contract pipeline', status: 'pending' },
    { id: 'r2', symbol: 'ARM', company: 'ARM Holdings', model: 'deepseek-chat', date: '04-05', reason: 'Mobile chip dominance, AI edge computing growth catalyst', status: 'pending' },
    { id: 'r3', symbol: 'CRWD', company: 'CrowdStrike', model: 'gpt-4.1', date: '04-05', reason: 'Cybersecurity leader with expanding TAM and net retention >120%', status: 'pending' },
    { id: 'r4', symbol: 'SNOW', company: 'Snowflake Inc.', model: 'claude-sonnet', date: '04-04', reason: 'Data cloud platform with strong enterprise adoption', status: 'accepted' },
    { id: 'r5', symbol: 'COIN', company: 'Coinbase Global', model: 'deepseek-chat', date: '04-03', reason: 'Crypto infrastructure leader, regulatory clarity improving', status: 'rejected' },
  ]);
  const pendingCount = recommendations.filter(r => r.status === 'pending').length;
  const handleAcceptRec = (id: string) => setRecommendations(prev => prev.map(r => r.id === id ? { ...r, status: 'accepted' as const } : r));
  const handleRejectRec = (id: string) => setRecommendations(prev => prev.map(r => r.id === id ? { ...r, status: 'rejected' as const } : r));
  const handleDeleteRec = (id: string) => setRecommendations(prev => prev.filter(r => r.id !== id));

  // Task scheduler
  const SCHED_MODELS = ['deepseek-chat', 'claude-sonnet', 'gpt-4.1', 'gemini-2.5-pro', 'qwen-plus'];
  const [taskOpen, setTaskOpen] = useState(false);
  const [scheduledTasks, setScheduledTasks] = useState([
    { symbol: 'AAPL', company: 'Apple Inc.', enabled: true, models: ['deepseek-chat', 'claude-sonnet'] },
    { symbol: 'NVDA', company: 'NVIDIA Corp.', enabled: true, models: ['deepseek-chat'] },
    { symbol: 'TSLA', company: 'Tesla Inc.', enabled: false, models: ['gpt-4.1'] },
    { symbol: 'GOOGL', company: 'Alphabet Inc.', enabled: true, models: ['claude-sonnet', 'deepseek-chat'] },
    { symbol: 'MSFT', company: 'Microsoft Corp.', enabled: true, models: ['deepseek-chat'] },
    { symbol: 'META', company: 'Meta Platforms', enabled: false, models: ['claude-sonnet'] },
    { symbol: 'TSM', company: 'Taiwan Semi.', enabled: true, models: ['deepseek-chat', 'gpt-4.1'] },
    { symbol: 'AMZN', company: 'Amazon.com', enabled: false, models: ['deepseek-chat'] },
  ]);
  const toggleSchedTask = (sym: string) => setScheduledTasks(prev => prev.map(t => t.symbol === sym ? { ...t, enabled: !t.enabled } : t));
  const toggleSchedModel = (sym: string, model: string) => setScheduledTasks(prev => prev.map(t => {
    if (t.symbol !== sym) return t;
    const has = t.models.includes(model);
    return { ...t, models: has ? t.models.filter(m => m !== model) : [...t.models, model] };
  }));
  const enabledTaskCount = scheduledTasks.filter(t => t.enabled).length;

  // Chart mode + price data for line chart
  const [chartMode, setChartMode] = useState<'line' | 'kline'>('kline');
  const [priceData, setPriceData] = useState<ChartPoint[]>([]);
  const [priceLoading, setPriceLoading] = useState(false);

  // ── Data loading ──
  useEffect(() => {
    (async () => {
      try {
        const { analyses: list } = await listCompanyAnalyses({ limit: 100 });
        setAnalyses(list);
      } catch (e) { console.error('Failed to load analyses:', e); }
      finally { setLoadingHistory(false); }
    })();
  }, []);

  useEffect(() => {
    if (runningAnalyses.size > 0) {
      timerRef.current = setInterval(() => {
        setRunningAnalyses((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const [id, ra] of next) {
            const elapsed = Date.now() - ra.startTime;
            if (elapsed !== ra.elapsedMs) { next.set(id, { ...ra, elapsedMs: elapsed }); changed = true; }
          }
          return changed ? next : prev;
        });
      }, 200);
    } else { if (timerRef.current) clearInterval(timerRef.current); }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [runningAnalyses.size > 0]);

  useEffect(() => { return () => { runningRef.current.forEach((ra) => ra.cancel()); }; }, []);

  useEffect(() => {
    if (!selectedId) { setSelectedDetail(null); return; }
    let cancelled = false;
    setLoadingDetail(true);
    (async () => {
      try {
        const detail = await getCompanyAnalysis(selectedId);
        if (!cancelled) { setSelectedDetail(detail); if (detail.status !== 'running') setReportOpen(true); }
      } catch (e) { console.error('Failed to load analysis detail:', e); }
      finally { if (!cancelled) setLoadingDetail(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  // Poll running DB records
  const pollingIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const localAnalysisIds = new Set(Array.from(runningAnalyses.values()).map((ra) => ra.analysisId).filter(Boolean));
    const dbRunning = analyses.filter((a) => a.status === 'running' && !localAnalysisIds.has(a.id));
    if (dbRunning.length === 0) { pollingIdsRef.current.clear(); return; }
    const ids = new Set(dbRunning.map((a) => a.id));
    pollingIdsRef.current = ids;
    const interval = setInterval(async () => {
      for (const id of Array.from(pollingIdsRef.current)) {
        try {
          const detail = await getCompanyAnalysis(id);
          if (detail.status === 'completed' || detail.status === 'error') {
            setAnalyses((prev) => prev.map((a) => a.id === id ? { ...a, ...detail } : a));
            pollingIdsRef.current.delete(id);
            if (selectedId === id) setSelectedDetail(detail);
          } else if (selectedId === id) { setSelectedDetail(detail); }
        } catch { /* ignore */ }
      }
      if (pollingIdsRef.current.size === 0) clearInterval(interval);
    }, 3000);
    return () => clearInterval(interval);
  }, [analyses.filter((a) => a.status === 'running').length, runningAnalyses.size]);

  // ── Analyze handler (SSE) ──
  const handleAnalyze = useCallback((symbol: string, provider?: string) => {
    const runId = `run_${++runIdCounter.current}`;
    setReportOpen(false);
    const initial: RunningAnalysis = {
      id: runId, analysisId: null, symbol, provider: provider || 'auto',
      cancel: () => {}, currentGate: null, gateStatuses: {}, gateResults: {},
      streamingTexts: {}, companyInfo: null, result: null, error: null,
      startTime: Date.now(), elapsedMs: 0,
    };
    const updateRun = (updater: (prev: RunningAnalysis) => RunningAnalysis) => {
      setRunningAnalyses((prev) => {
        const ra = prev.get(runId);
        if (!ra) return prev;
        const next = new Map(prev);
        next.set(runId, updater(ra));
        return next;
      });
    };
    const stream = analyzeCompanyStream({ symbol, provider }, (event: CompanyProgressEvent) => {
      switch (event.type) {
        case 'data_loaded':
          updateRun((ra) => ({
            ...ra, analysisId: event.analysis_id || null,
            companyInfo: { name: event.company_name || symbol, symbol: event.symbol || symbol, sector: event.sector || '', industry: event.industry || '', price: event.current_price || 0 },
          }));
          if (event.analysis_id) {
            const runningSummary: CompanyAnalysisSummary = {
              id: event.analysis_id, symbol: event.symbol || symbol, company_name: event.company_name || symbol,
              provider: provider || 'auto', model: '', status: 'running',
              verdict_action: 'WATCH', verdict_conviction: 0.5, verdict_quality: 'GOOD',
              total_latency_ms: 0, created_at: new Date().toISOString(),
            };
            setAnalyses((prev) => [runningSummary, ...prev]);
          }
          break;
        case 'gate_start':
          if (event.gate) updateRun((ra) => ({ ...ra, currentGate: event.gate!, gateStatuses: { ...ra.gateStatuses, [event.gate!]: 'running' as GateStatus } }));
          break;
        case 'gate_text':
          if (event.skill && event.text) updateRun((ra) => ({ ...ra, streamingTexts: { ...ra.streamingTexts, [event.skill!]: (ra.streamingTexts[event.skill!] || '') + event.text! } }));
          break;
        case 'gate_complete':
          if (event.gate) {
            const status: GateStatus = event.parse_status === 'timeout' ? 'timeout' : event.parse_status === 'error' ? 'error' : 'complete';
            updateRun((ra) => {
              const newStatuses = { ...ra.gateStatuses, [event.gate!]: status };
              const newResults = { ...ra.gateResults };
              const newStreamingTexts = { ...ra.streamingTexts };
              if (event.skill) {
                delete newStreamingTexts[event.skill];
                newResults[event.skill] = { gate: event.gate, display_name: event.display_name, parsed: event.parsed || {}, parse_status: event.parse_status, latency_ms: event.latency_ms, error: event.error, raw: event.raw || '' };
                if (event.skill === 'final_verdict' && event.parsed) {
                  for (const sn of ['business_analysis', 'fisher_qa', 'moat_assessment', 'management_assessment', 'reverse_test', 'valuation']) {
                    const gateData = event.parsed[sn];
                    if (gateData && typeof gateData === 'object' && newResults[sn]) newResults[sn] = { ...newResults[sn], parsed: gateData, parse_status: 'structured' };
                  }
                }
              }
              return { ...ra, gateStatuses: newStatuses, gateResults: newResults, streamingTexts: newStreamingTexts };
            });
          }
          break;
        case 'result':
          if (event.data) {
            const resultData = event.data;
            updateRun((ra) => ({ ...ra, result: resultData }));
            setReportOpen(true);
            if (resultData.analysis_id) {
              const completedSummary: CompanyAnalysisSummary = {
                id: resultData.analysis_id, symbol: resultData.symbol, company_name: resultData.company_name,
                provider: resultData.model_used.split('/')[0], model: resultData.model_used.split('/')[1] || '',
                status: 'completed', verdict_action: resultData.verdict?.action || 'WATCH',
                verdict_conviction: resultData.verdict?.conviction || 0.5, verdict_quality: resultData.verdict?.quality_verdict || 'GOOD',
                total_latency_ms: resultData.total_latency_ms, created_at: new Date().toISOString(),
              };
              setAnalyses((prev) => { const exists = prev.some((a) => a.id === resultData.analysis_id); return exists ? prev.map((a) => a.id === resultData.analysis_id ? completedSummary : a) : [completedSummary, ...prev]; });
              setSelectedId(resultData.analysis_id);
              setViewingRunId(null);
            }
            setTimeout(() => { setRunningAnalyses((prev) => { const next = new Map(prev); next.delete(runId); return next; }); }, 500);
          }
          break;
        case 'error':
          updateRun((ra) => {
            if (ra.analysisId) setAnalyses((prev) => prev.map((a) => a.id === ra.analysisId ? { ...a, status: 'error' } : a));
            return { ...ra, error: event.message || 'Analysis failed' };
          });
          setTimeout(() => { setRunningAnalyses((prev) => { const next = new Map(prev); next.delete(runId); return next; }); }, 3000);
          break;
      }
    });
    initial.cancel = stream.cancel;
    setRunningAnalyses((prev) => { const next = new Map(prev); next.set(runId, initial); return next; });
    setSelectedId(null);
    setViewingRunId(runId);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    try {
      await deleteCompanyAnalysis(id);
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
      if (selectedId === id) { setSelectedId(null); setSelectedDetail(null); setReportOpen(false); }
    } catch (e) { console.error('Failed to delete analysis:', e); }
  }, [confirmDeleteId, selectedId]);

  const handleJudge = useCallback(async () => {
    if (!selectedId || judging) return;
    setJudging(true);
    setJudgeResult(null);
    try {
      const resp = await fetch(`${API_BASE}/api/evaluation/judge/${selectedId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ judge_model: 'deepseek-chat' }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setJudgeResult(data);
      }
    } catch (e) { console.error('Judge failed:', e); }
    finally { setJudging(false); }
  }, [selectedId, judging]);

  // Clear judge when selection changes
  useEffect(() => { setJudgeResult(null); }, [selectedId]);

  const handleCompare = useCallback((symbol: string, models: string[]) => {
    setCompareState({ symbol, models });
    setSelectedId(null);
    setViewingRunId(null);
    setReportOpen(false);
  }, []);

  // ── Display derivation ──
  const viewingRun = viewingRunId ? runningAnalyses.get(viewingRunId) : null;
  const isViewingRunning = !!viewingRun;

  const displaySkills: Record<string, GateResult> = isViewingRunning ? (viewingRun!.result?.skills || viewingRun!.gateResults) : (selectedDetail?.full_report?.skills || {});
  const displayVerdict = isViewingRunning ? viewingRun!.result?.verdict as PositionHoldingOutput | undefined : selectedDetail?.full_report?.verdict as PositionHoldingOutput | undefined;
  const displayResult = isViewingRunning ? viewingRun!.result : selectedDetail?.full_report || null;
  const displayError = isViewingRunning ? viewingRun!.error : null;
  const displayCompanyInfo = isViewingRunning ? viewingRun!.companyInfo : (selectedDetail ? {
    name: selectedDetail.full_report?.company_name || selectedDetail.company_name,
    symbol: selectedDetail.full_report?.symbol || selectedDetail.symbol,
    sector: selectedDetail.full_report?.sector || '',
    industry: selectedDetail.full_report?.industry || '',
    price: selectedDetail.full_report?.current_price || 0,
  } : null);

  const isDbRunning = !isViewingRunning && selectedDetail?.status === 'running';
  const displayGateStatuses: Record<number, GateStatus> = isViewingRunning
    ? viewingRun!.gateStatuses
    : (() => {
        const skills = selectedDetail?.full_report?.skills;
        const hasSkills = skills && Object.keys(skills).length > 0;
        if (hasSkills) {
          const statuses: Record<number, GateStatus> = {};
          for (const skillName of SKILL_ORDER) {
            const result = skills[skillName];
            if (result) statuses[result.gate] = result.parse_status === 'timeout' ? 'timeout' : result.parse_status === 'error' ? 'error' : 'complete';
          }
          if (isDbRunning) { const cg = Object.keys(statuses).length; if (cg < 7) statuses[cg + 1] = 'running'; }
          return statuses;
        }
        if (isDbRunning) { const s: Record<number, GateStatus> = {}; for (let i = 1; i <= 7; i++) s[i] = 'pending'; s[1] = 'running'; return s; }
        return {};
      })();

  const displayGateResults = isViewingRunning ? viewingRun!.gateResults : (selectedDetail?.full_report?.skills || {});
  const displayStreamingTexts = isViewingRunning ? viewingRun!.streamingTexts : {};
  const displayCurrentGate = isViewingRunning ? viewingRun!.currentGate : isDbRunning ? (Object.entries(displayGateStatuses).find(([, s]) => s === 'running')?.[0] ? Number(Object.entries(displayGateStatuses).find(([, s]) => s === 'running')![0]) : null) : null;
  const isComplete = isViewingRunning ? !!viewingRun!.result : (!!displayResult && !isDbRunning);
  const runningCount = runningAnalyses.size;
  const hasTimeline = Object.keys(displayGateStatuses).length > 0 || displayCompanyInfo != null || !!displayError || isDbRunning;

  const formatTime = (ms: number) => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`; };
  const formatDate = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }); };

  // ── Filtered list ──
  const filteredAnalyses = analyses.filter((a) => {
    if (a.status !== 'running') return true;
    return !Array.from(runningAnalyses.values()).some((ra) => ra.analysisId === a.id);
  });

  // ── Screener Row ──
  const renderRow = (a: CompanyAnalysisSummary, compact = false) => {
    const actionColor = ACTION_COLORS[a.verdict_action] || theme.text.muted;
    const isRunningRecord = a.status === 'running';
    const isActive = selectedId === a.id;
    const conviction = a.verdict_conviction || 0;
    const convPct = Math.round(conviction * 100);

    return (
      <Box
        key={a.id}
        onClick={() => { setViewingRunId(null); setSelectedId(a.id); setConfirmDeleteId(null); }}
        sx={{
          display: 'grid',
          gridTemplateColumns: compact
            ? '48px 1fr 44px 36px 24px'
            : '48px minmax(60px,1fr) 20px 48px 44px 56px 48px 40px 30px',
          alignItems: 'center',
          px: compact ? 1 : 1.5,
          minHeight: compact ? 34 : 38,
          cursor: 'pointer',
          transition: 'background-color 0.1s',
          bgcolor: isActive ? `${theme.brand.primary}08` : 'transparent',
          borderBottom: `1px solid ${theme.border.subtle}22`,
          '&:hover': { bgcolor: `${theme.text.primary}06` },
          '&:hover .row-delete': { opacity: 0.6 },
          '&:nth-of-type(odd)': { bgcolor: isActive ? `${theme.brand.primary}08` : `${theme.text.primary}02` },
        }}
      >
        {/* Symbol */}
        <Typography sx={{ fontSize: compact ? 11 : 12, fontWeight: 700, color: theme.text.primary }}>
          {a.symbol}
        </Typography>

        {/* Company */}
        {!compact ? (
          <Typography sx={{ fontSize: 11, color: theme.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pr: 1 }}>
            {a.company_name || '—'}
          </Typography>
        ) : <Box />}

        {/* Model logo */}
        {!compact && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ModelLogo provider={a.provider} size={14} />
          </Box>
        )}

        {isRunningRecord ? (
          /* ── Running state: animated bar spanning remaining columns ── */
          <Box sx={{
            gridColumn: compact ? '3 / -1' : '4 / -1',
            display: 'flex', alignItems: 'center', gap: 1,
          }}>
            <Box sx={{
              flex: 1, height: 3, borderRadius: 2, overflow: 'hidden',
              bgcolor: `${theme.brand.primary}10`,
            }}>
              <Box sx={{
                height: '100%', width: '40%', borderRadius: 2,
                bgcolor: theme.brand.primary,
                animation: 'analyzing-slide 2s ease-in-out infinite',
                '@keyframes analyzing-slide': {
                  '0%': { transform: 'translateX(-100%)' },
                  '50%': { transform: 'translateX(200%)' },
                  '100%': { transform: 'translateX(-100%)' },
                },
              }} />
            </Box>
            <Typography sx={{ fontSize: 9, color: theme.brand.primary, fontWeight: 500, flexShrink: 0, opacity: 0.8 }}>
              分析中
            </Typography>
            <Typography sx={{ fontSize: 9, color: theme.text.disabled, flexShrink: 0 }}>
              {formatDate(a.created_at)}
            </Typography>
          </Box>
        ) : (
          /* ── Completed state ── */
          <>
            {/* Action */}
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Box sx={{ px: 0.75, py: 0.15, borderRadius: '4px', bgcolor: `${actionColor}12` }}>
                <Typography sx={{ fontSize: 10, fontWeight: 800, color: actionColor, lineHeight: 1.4 }}>
                  {a.verdict_action}
                </Typography>
              </Box>
            </Box>

            {/* Conviction */}
            <Typography sx={{ fontSize: 10, color: theme.text.muted, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>
              {`${convPct}%`}
            </Typography>

            {/* Quality */}
            {!compact && (
              <Typography sx={{
                fontSize: 9.5, fontWeight: 600, textAlign: 'center',
                color: a.verdict_quality === 'EXCELLENT' ? '#4caf50' : a.verdict_quality === 'GOOD' ? '#f59e0b' : theme.text.disabled,
              }}>
                {a.verdict_quality || ''}
              </Typography>
            )}

            {/* Time */}
            {!compact && (
              <Typography sx={{ fontSize: 10, color: theme.text.muted, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>
                {formatTime(a.total_latency_ms)}
              </Typography>
            )}

            {/* Date */}
            <Typography sx={{ fontSize: 10, color: theme.text.disabled, textAlign: 'right' }}>
              {formatDate(a.created_at)}
            </Typography>
          </>
        )}

        {/* Delete */}
        {confirmDeleteId === a.id ? (
          <Box
            onClick={(e) => { e.stopPropagation(); handleConfirmDelete(); }}
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', borderRadius: '4px', px: 0.5, py: 0.15,
              fontSize: 9, fontWeight: 700, color: '#fff', bgcolor: '#ef4444',
              whiteSpace: 'nowrap', transition: 'all 0.12s',
              '&:hover': { bgcolor: '#dc2626' },
            }}
          >
            确认
          </Box>
        ) : (
          <Box
            className="row-delete"
            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(a.id); }}
            sx={{
              opacity: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', borderRadius: '4px', p: 0.25,
              color: theme.text.disabled,
              transition: 'opacity 0.15s, color 0.15s',
              '&:hover': { color: '#ef4444' },
            }}
          >
            <Trash2 size={11} />
          </Box>
        )}
      </Box>
    );
  };

  // ── Chart symbol — priority: detail selection > active-group watchlist click >
  //    first symbol of active group > first analysis.
  // watchlistSymbol is only honored when it's in the CURRENTLY active group —
  // otherwise it stays "sticky" across group tab switches and shows a stale
  // symbol (e.g. SPY from 指数 tab lingering on 公司 tab).
  const activeGroup = watchlistGroups.find((g) => g.id === activeGroupId);
  const watchlistSymbolInActive = watchlistSymbol && activeGroup?.symbols.some((s) => s.symbol === watchlistSymbol)
    ? watchlistSymbol
    : null;
  const chartSymbol = displayCompanyInfo?.symbol
    || watchlistSymbolInActive
    || activeGroup?.symbols[0]?.symbol
    || (filteredAnalyses.length > 0 ? filteredAnalyses[0].symbol : null);

  // Fetch price data for line chart mode
  useEffect(() => {
    if (!chartSymbol || chartMode !== 'line') return;
    let cancelled = false;
    setPriceLoading(true);
    (async () => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const from = now - 365 * 24 * 3600;
        const res = await fetch(`/api/udf/history?symbol=${chartSymbol}&resolution=D&from=${from}&to=${now}`);
        const json = await res.json();
        if (!cancelled && json.s === 'ok' && json.t?.length > 0) {
          const points: ChartPoint[] = json.t.map((ts: number, i: number) => ({
            date: new Date(ts * 1000).toISOString().slice(0, 10),
            close: json.c[i],
          }));
          setPriceData(points);
        }
      } catch { if (!cancelled) setPriceData([]); }
      finally { if (!cancelled) setPriceLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [chartSymbol, chartMode]);

  // ── Render ──
  return (
    <Box sx={{ m: -3, height: 'calc(100vh - 48px)', width: 'calc(100% + 48px)', display: 'flex', flexDirection: 'column', bgcolor: theme.background.primary, color: theme.text.primary, overflow: 'hidden' }}>
      <style>{spinKeyframes}</style>

      <PageHeader title="Company Agent">
        {displayCompanyInfo && (
          <>
            <Box sx={{ width: '1px', height: 16, bgcolor: theme.border.subtle }} />
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{displayCompanyInfo.symbol}</Typography>
              <Typography sx={{ fontSize: 12, color: theme.text.muted }}>{displayCompanyInfo.name}</Typography>
              {displayCompanyInfo.price > 0 && (
                <Typography sx={{ fontSize: 12, color: theme.text.secondary, fontFeatureSettings: '"tnum"', fontWeight: 600 }}>
                  ${displayCompanyInfo.price.toFixed(2)}
                </Typography>
              )}
              {displayVerdict && (
                <Typography sx={{
                  fontSize: 10, fontWeight: 800, px: 0.75, py: 0.1, borderRadius: '4px',
                  color: ACTION_COLORS[displayVerdict.action] || theme.text.muted,
                  bgcolor: `${ACTION_COLORS[displayVerdict.action] || theme.text.muted}15`,
                }}>
                  {displayVerdict.action}
                </Typography>
              )}
            </Box>
          </>
        )}
        {hasSelection && (
          <>
            <Box sx={{ flex: 1 }} />
            <Box
              onClick={() => { setSelectedId(null); setSelectedDetail(null); setViewingRunId(null); setReportOpen(false); setCompareState(null); }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.5,
                px: 1, py: 0.3, borderRadius: '6px', cursor: 'pointer',
                color: theme.text.muted, fontSize: 12,
                '&:hover': { color: theme.text.primary, bgcolor: `${theme.text.primary}08` },
              }}
            >
              ← 返回列表
            </Box>
          </>
        )}
        {!hasSelection && <Box sx={{ flex: 1 }} />}
        {/* Task scheduler button */}
        <Box
          onClick={() => setTaskOpen(!taskOpen)}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.75,
            px: 1.25, py: 0.35, borderRadius: '6px', cursor: 'pointer',
            border: `1px solid ${taskOpen ? theme.brand.primary + '40' : theme.border.subtle}`,
            bgcolor: taskOpen ? `${theme.brand.primary}08` : 'transparent',
            transition: 'all 0.15s',
            '&:hover': { borderColor: theme.brand.primary + '60', bgcolor: `${theme.brand.primary}06` },
          }}
        >
          <Typography sx={{ fontSize: 10, fontWeight: 600, color: theme.text.muted, whiteSpace: 'nowrap' }}>
            下次执行
          </Typography>
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: theme.brand.primary, fontFeatureSettings: '"tnum"', whiteSpace: 'nowrap' }}>
            08:00
          </Typography>
          <Box sx={{
            fontSize: 9, fontWeight: 700,
            bgcolor: `${theme.brand.primary}15`, color: theme.brand.primary,
            px: 0.5, borderRadius: '3px', lineHeight: '16px',
          }}>
            {enabledTaskCount}
          </Box>
        </Box>
      </PageHeader>

      {/* ── Task Scheduler Drawer ── */}
      {taskOpen && (
        <Box sx={{
          position: 'absolute', top: 44, right: 0, zIndex: 200,
          width: 380, maxHeight: 'calc(100vh - 60px)',
          bgcolor: theme.background.secondary,
          border: `1px solid ${theme.border.default}`,
          borderRadius: '0 0 0 8px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${theme.border.subtle}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: theme.text.primary }}>
                定时任务
              </Typography>
              <Typography sx={{ fontSize: 10, color: theme.text.disabled }}>
                每日 08:00 自动执行 · {enabledTaskCount} 个活跃
              </Typography>
            </Box>
            <Typography
              onClick={() => setTaskOpen(false)}
              sx={{ fontSize: 16, color: theme.text.disabled, cursor: 'pointer', lineHeight: 1, '&:hover': { color: theme.text.primary } }}
            >
              ×
            </Typography>
          </Box>
          <Box sx={{
            flex: 1, overflow: 'auto', py: 0.5,
            '&::-webkit-scrollbar': { width: 3 },
            '&::-webkit-scrollbar-thumb': { bgcolor: `${theme.text.muted}18`, borderRadius: 4 },
          }}>
            {scheduledTasks.map(task => (
              <Box key={task.symbol} sx={{
                px: 2, py: 1, borderBottom: `1px solid ${theme.border.subtle}15`,
                opacity: task.enabled ? 1 : 0.5,
                transition: 'opacity 0.15s',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: theme.text.primary }}>{task.symbol}</Typography>
                    <Typography sx={{ fontSize: 10, color: theme.text.disabled }}>{task.company}</Typography>
                  </Box>
                  <Switch
                    size="small"
                    checked={task.enabled}
                    onChange={() => toggleSchedTask(task.symbol)}
                    sx={{
                      width: 28, height: 16, p: 0,
                      '& .MuiSwitch-switchBase': { p: '2px', '&.Mui-checked': { transform: 'translateX(12px)', color: '#fff' } },
                      '& .MuiSwitch-thumb': { width: 12, height: 12 },
                      '& .MuiSwitch-track': { borderRadius: 8, bgcolor: `${theme.text.disabled}30` },
                      '& .Mui-checked + .MuiSwitch-track': { bgcolor: `${theme.brand.primary}60 !important` },
                    }}
                  />
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {SCHED_MODELS.map(model => {
                    const selected = task.models.includes(model);
                    const shortName = model.split('-')[0];
                    return (
                      <Typography
                        key={model}
                        onClick={() => toggleSchedModel(task.symbol, model)}
                        sx={{
                          fontSize: 9, cursor: 'pointer',
                          px: 0.75, py: 0.2, borderRadius: '10px',
                          fontWeight: selected ? 600 : 400,
                          color: selected ? theme.brand.primary : theme.text.disabled,
                          bgcolor: selected ? `${theme.brand.primary}12` : 'transparent',
                          border: `1px solid ${selected ? theme.brand.primary + '30' : theme.border.subtle}`,
                          transition: 'all 0.15s',
                          '&:hover': { borderColor: theme.brand.primary + '50' },
                        }}
                      >
                        {shortName}
                      </Typography>
                    );
                  })}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* ── Floating search bar ── */}
      <Box sx={{
        position: 'absolute',
        bottom: 64,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100,
        width: 380,
        opacity: 0.65,
        transition: 'opacity 0.2s ease, transform 0.2s ease',
        filter: 'drop-shadow(0 2px 12px rgba(0,0,0,0.15))',
        '&:hover': { opacity: 0.85 },
        '&:focus-within': { opacity: 1, filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.3))' },
      }}>
        <CompanyAnalysisForm
          onAnalyze={handleAnalyze}
          isRunning={false}
          runningCount={runningCount}
          elapsedMs={0}
          compareMode={compareMode}
          onCompareModeChange={setCompareMode}
          onCompare={handleCompare}
        />
      </Box>

      {/* ══════════════════════════════════════════════════════
          LAYOUT A: 列表状态 — 左20% Watchlist | 中40% K线 | 右40% 分析列表
          LAYOUT B: 详情状态 — 左30% 分析列表 | 中+右70% 分析报告
          ══════════════════════════════════════════════════════ */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {compareState ? (
          /* ═══ LAYOUT C: Compare mode ═══ */
          <CompareView
            symbol={compareState.symbol}
            models={compareState.models}
            onClose={() => setCompareState(null)}
          />
        ) : hasSelection && hasTimeline ? (
          /* ═══ LAYOUT B: Detail mode — Left K-line | Right (progress + report) ═══ */
          <>
            {/* Left 35%: Chart with mode toggle */}
            <Box sx={{
              width: '35%', flexShrink: 0,
              borderRight: `1px solid ${theme.border.subtle}`,
              display: 'flex', flexDirection: 'column',
              position: 'relative',
            }}>
              {/* Chart mode toggle bar */}
              <Box sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                px: 1.5, py: 0.5, borderBottom: `1px solid ${theme.border.subtle}`,
                flexShrink: 0,
              }}>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: theme.text.primary }}>
                  {chartSymbol || '—'}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography sx={{ fontSize: 9, color: chartMode === 'line' ? theme.text.primary : theme.text.disabled, fontWeight: 600 }}>
                    Line
                  </Typography>
                  <Switch
                    size="small"
                    checked={chartMode === 'kline'}
                    onChange={(_, checked) => setChartMode(checked ? 'kline' : 'line')}
                    sx={{
                      width: 32, height: 18, p: 0,
                      '& .MuiSwitch-switchBase': { p: '2px', '&.Mui-checked': { transform: 'translateX(14px)', color: '#fff' } },
                      '& .MuiSwitch-thumb': { width: 14, height: 14 },
                      '& .MuiSwitch-track': { borderRadius: 9, bgcolor: `${theme.text.disabled}30` },
                      '& .Mui-checked + .MuiSwitch-track': { bgcolor: `${theme.brand.primary}60 !important` },
                    }}
                  />
                  <Typography sx={{ fontSize: 9, color: chartMode === 'kline' ? theme.text.primary : theme.text.disabled, fontWeight: 600 }}>
                    K-Line
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                {chartSymbol ? (
                  chartMode === 'kline' ? (
                    <TradingViewChart symbol={chartSymbol} />
                  ) : (
                    <Box sx={{
                      position: 'absolute', inset: 0,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      bgcolor: theme.background.secondary,
                    }}>
                      {priceData.length > 0 && (
                        <Typography sx={{ fontSize: 24, fontWeight: 600, color: theme.text.primary, mb: 0.25 }}>
                          ${priceData[priceData.length - 1].close.toFixed(2)}
                        </Typography>
                      )}
                      {priceData.length > 1 && (() => {
                        const first = priceData[0].close;
                        const last = priceData[priceData.length - 1].close;
                        const changePct = ((last - first) / first * 100);
                        const positive = changePct >= 0;
                        return (
                          <Typography sx={{ fontSize: 12, color: positive ? '#22c55e' : '#ef4444', mb: 2 }}>
                            {positive ? '+' : ''}{changePct.toFixed(2)}%
                          </Typography>
                        );
                      })()}
                      <Box sx={{ width: '85%', height: '40%', maxHeight: 200 }}>
                        {priceLoading ? (
                          <Typography sx={{ fontSize: 11, color: theme.text.disabled, textAlign: 'center', pt: 4 }}>Loading...</Typography>
                        ) : (
                          <SvgLineChart
                            data={priceData}
                            width={300}
                            height={140}
                            color={priceData.length > 1 && priceData[priceData.length - 1].close >= priceData[0].close ? '#22c55e' : '#ef4444'}
                          />
                        )}
                      </Box>
                      {priceData.length > 0 && (
                        <Typography sx={{ fontSize: 9, color: theme.text.disabled, mt: 1.5 }}>
                          {priceData[0].date} — {priceData[priceData.length - 1].date}
                        </Typography>
                      )}
                    </Box>
                  )
                ) : (
                  <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography sx={{ fontSize: 13, color: theme.text.disabled }}>Select a symbol</Typography>
                  </Box>
                )}
              </Box>
            </Box>

            {/* Right 65%: Top progress + Report below */}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Top: compact gate progress bar */}
              <Box sx={{
                flexShrink: 0,
                borderBottom: `1px solid ${theme.border.subtle}`,
                px: 2, py: 0.75,
                display: 'flex', alignItems: 'center', gap: 1,
              }}>
                {/* Gate step indicators */}
                {['业务解析', 'Fisher', '护城河', '管理层', '逆向检验', '估值', '裁决'].map((label, i) => {
                  const gateNum = i + 1;
                  const status = displayGateStatuses[gateNum];
                  return (
                    <Box key={gateNum} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {i > 0 && <Box sx={{ width: 12, height: 1, bgcolor: status === 'complete' ? '#4caf50' : theme.border.subtle }} />}
                      <Box
                        onClick={() => { setActiveGate(gateNum); setScrollToGate(gateNum); }}
                        sx={{
                          display: 'flex', alignItems: 'center', gap: 0.3,
                          cursor: 'pointer', px: 0.75, py: 0.3, borderRadius: '6px',
                          bgcolor: activeGate === gateNum ? `${theme.brand.primary}15` : 'transparent',
                          border: activeGate === gateNum ? `1px solid ${theme.brand.primary}30` : '1px solid transparent',
                          '&:hover': { bgcolor: activeGate === gateNum ? `${theme.brand.primary}15` : `${theme.text.primary}06` },
                        }}
                      >
                        <Box sx={{
                          width: 6, height: 6, borderRadius: '50%',
                          bgcolor: status === 'complete' ? '#4caf50' : status === 'running' ? theme.brand.primary : status === 'error' ? '#f44336' : theme.border.default,
                          animation: status === 'running' ? 'analyzing-pulse 1.5s ease-in-out infinite' : 'none',
                        }} />
                        <Typography sx={{ fontSize: 9.5, color: status === 'complete' ? theme.text.secondary : theme.text.disabled }}>
                          {label}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
                <Box sx={{ flex: 1 }} />
                {/* Elapsed time */}
                <Typography sx={{ fontSize: 10, color: theme.text.muted, fontFeatureSettings: '"tnum"' }}>
                  {formatTime(isViewingRunning ? viewingRun!.elapsedMs : (displayResult?.total_latency_ms || 0))}
                </Typography>
                {/* Judge button — only when analysis is complete */}
                {isComplete && selectedId && (
                  <Box
                    onClick={handleJudge}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 0.4,
                      px: 1, py: 0.3, borderRadius: '6px', cursor: judging ? 'wait' : 'pointer',
                      fontSize: 10, fontWeight: 500, fontFamily: 'var(--font-ui)',
                      color: judgeResult ? '#4caf50' : theme.text.muted,
                      bgcolor: judgeResult ? 'rgba(76,175,80,0.08)' : 'transparent',
                      border: `1px solid ${judgeResult ? 'rgba(76,175,80,0.2)' : 'transparent'}`,
                      opacity: judging ? 0.6 : 1,
                      transition: 'all 0.15s',
                      '&:hover': { bgcolor: judgeResult ? 'rgba(76,175,80,0.12)' : `${theme.text.primary}06` },
                    }}
                  >
                    {judging ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Scale size={10} />}
                    <span>{judging ? 'Judging...' : judgeResult ? `${judgeResult.aggregate.overall}/10` : 'Judge'}</span>
                  </Box>
                )}
              </Box>

              {/* Report content — fills remaining space */}
              <Box sx={{
                flex: 1, overflow: 'auto',
                '&::-webkit-scrollbar': { width: 4 },
                '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
                '&::-webkit-scrollbar-thumb': { bgcolor: `${theme.text.muted}18`, borderRadius: 4 },
              }}>
                {loadingDetail && (
                  <Typography sx={{ fontSize: 12, color: theme.text.muted, textAlign: 'center', py: 3 }}>Loading...</Typography>
                )}
                <ReportPanel
                  open={true}
                  onClose={() => {}}
                  embedded
                  skills={displaySkills}
                  verdict={displayVerdict}
                  companyInfo={displayCompanyInfo}
                  totalLatencyMs={displayResult?.total_latency_ms}
                  modelUsed={displayResult?.model_used}
                  dataFreshness={displayResult?.data_freshness}
                  toolCallsCount={displayResult?.tool_calls?.length}
                  scrollToGate={scrollToGate}
                  onScrollToGateConsumed={() => setScrollToGate(null)}
                  onActiveGateChange={(gate) => setActiveGate(gate)}
                  analysisId={selectedId || (isViewingRunning ? viewingRun!.analysisId : null)}
                />

                {/* Judge Results — inline below report */}
                {judgeResult && (
                  <Box sx={{ px: 2.5, py: 2, borderTop: `1px solid ${theme.border.subtle}` }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: theme.text.primary, mb: 1.5, fontFamily: 'var(--font-ui)', letterSpacing: '-0.01em' }}>
                      Quality Assessment
                    </Typography>

                    {/* Aggregate scores */}
                    <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                      {[
                        { label: 'Accuracy', value: judgeResult.aggregate.accuracy, color: '#6495ed' },
                        { label: 'Depth', value: judgeResult.aggregate.depth, color: '#4caf50' },
                        { label: 'Consistency', value: judgeResult.aggregate.consistency, color: '#ff9800' },
                        { label: 'Overall', value: judgeResult.aggregate.overall, color: theme.text.primary },
                      ].map(({ label, value, color }) => (
                        <Box key={label} sx={{ flex: 1, p: 1, bgcolor: theme.background.secondary, borderRadius: 1, border: `1px solid ${theme.border.subtle}`, textAlign: 'center' }}>
                          <Typography sx={{ fontSize: 8.5, color: theme.text.disabled, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-ui)' }}>{label}</Typography>
                          <Typography sx={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'var(--font-mono)' }}>{value}</Typography>
                          <Typography sx={{ fontSize: 8, color: theme.text.disabled }}>/10</Typography>
                        </Box>
                      ))}
                    </Box>

                    {/* Per-gate details */}
                    {judgeResult.scores?.map((g: any) => (
                      <Box key={g.gate} sx={{ mb: 1.5, p: 1.25, bgcolor: theme.background.secondary, borderRadius: 1, border: `1px solid ${theme.border.subtle}` }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                          <Typography sx={{ fontSize: 11, fontWeight: 700, color: theme.text.primary, fontFamily: 'var(--font-ui)' }}>
                            G{g.gate} {g.gate_name || g.skill}
                          </Typography>
                          {g.overall != null && (
                            <Typography sx={{ fontSize: 11, fontWeight: 700, color: g.overall >= 7 ? '#4caf50' : g.overall >= 5 ? '#ff9800' : '#f44336', fontFamily: 'var(--font-mono)' }}>
                              {g.overall}/10
                            </Typography>
                          )}
                        </Box>
                        {g.summary && (
                          <Typography sx={{ fontSize: 12, color: theme.text.secondary, fontFamily: 'var(--font-reading)', lineHeight: 1.7, mb: 0.75 }}>
                            {g.summary}
                          </Typography>
                        )}
                        {g.deductions?.length > 0 && (
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                            {g.deductions.slice(0, 3).map((d: any, i: number) => (
                              <Typography key={i} sx={{ fontSize: 10, color: d.severity === 'critical' ? '#f44336' : d.severity === 'major' ? '#ff9800' : theme.text.muted, lineHeight: 1.5 }}>
                                [{d.severity}] {d.issue}
                              </Typography>
                            ))}
                          </Box>
                        )}
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          </>
        ) : (
          /* ═══ LAYOUT A: List mode — Watchlist | Chart | Screener ═══ */
          <>
            {/* Left: Watchlist / Recommendations tabs */}
            <Box sx={{
              width: '18%', minWidth: 200, maxWidth: 260, flexShrink: 0,
              borderRight: `1px solid ${theme.border.subtle}`,
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              {/* Tab headers */}
              <Box sx={{ display: 'flex', flexShrink: 0, borderBottom: `1px solid ${theme.border.subtle}` }}>
                <Box
                  onClick={() => setLeftTab('watchlist')}
                  sx={{
                    flex: 1, py: 1.5, cursor: 'pointer', textAlign: 'center',
                    borderBottom: leftTab === 'watchlist' ? `2px solid ${theme.brand.primary}` : '2px solid transparent',
                    transition: 'border-color 0.15s ease',
                  }}
                >
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: leftTab === 'watchlist' ? theme.text.primary : theme.text.disabled, letterSpacing: '0.03em' }}>
                    关注
                  </Typography>
                </Box>
                <Box
                  onClick={() => setLeftTab('recommend')}
                  sx={{
                    flex: 1, py: 1.5, cursor: 'pointer', textAlign: 'center', position: 'relative',
                    borderBottom: leftTab === 'recommend' ? `2px solid ${theme.brand.primary}` : '2px solid transparent',
                    transition: 'border-color 0.15s ease',
                  }}
                >
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: leftTab === 'recommend' ? theme.text.primary : theme.text.disabled, letterSpacing: '0.03em' }}>
                    推荐
                    {pendingCount > 0 && (
                      <Box component="span" sx={{
                        ml: 0.75, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: 16, height: 16, borderRadius: '8px', fontSize: 10, fontWeight: 700,
                        bgcolor: theme.brand.primary, color: '#fff', px: 0.4, verticalAlign: 'middle',
                      }}>
                        {pendingCount}
                      </Box>
                    )}
                  </Typography>
                </Box>
              </Box>

              <Box sx={{
                flex: 1, overflow: 'auto',
                '&::-webkit-scrollbar': { width: 3 },
                '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
                '&::-webkit-scrollbar-thumb': { bgcolor: `${theme.text.muted}18`, borderRadius: 4 },
              }}>
                {leftTab === 'watchlist' ? (
                  /* ── Watchlist tab with groups ── */
                  <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    {/* Group tabs with arrows */}
                    <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, px: 1, py: 0.75, borderBottom: `1px solid ${theme.border.subtle}15` }}>
                      {groupScrollState.canLeft && (
                        <IconButton size="small" onClick={() => scrollGroup('left')} sx={{ p: 0.25, mr: 0.25, flexShrink: 0, color: theme.text.muted, '&:hover': { color: theme.text.primary }, transition: 'color 0.15s ease' }}>
                          <ChevronLeft size={14} />
                        </IconButton>
                      )}
                      <Box
                        ref={groupScrollRef}
                        onScroll={updateGroupScroll}
                        sx={{
                          flex: 1, display: 'flex', alignItems: 'center', gap: 0.5, overflow: 'hidden', minWidth: 0,
                          '&::-webkit-scrollbar': { display: 'none' },
                        }}
                      >
                        {watchlistGroups.map(g => (
                          <Box
                            key={g.id}
                            onClick={() => setActiveGroupId(g.id)}
                            sx={{
                              px: 1.25, py: 0.5, cursor: 'pointer', flexShrink: 0, borderRadius: '12px',
                              bgcolor: activeGroupId === g.id ? `${theme.brand.primary}15` : 'transparent',
                              border: `1px solid ${activeGroupId === g.id ? theme.brand.primary + '25' : 'transparent'}`,
                              transition: 'all 0.15s ease',
                              '&:hover': { bgcolor: activeGroupId === g.id ? `${theme.brand.primary}15` : `${theme.text.primary}06` },
                            }}
                          >
                            <Typography sx={{
                              fontSize: 11, fontWeight: activeGroupId === g.id ? 600 : 400, whiteSpace: 'nowrap',
                              color: activeGroupId === g.id ? theme.text.primary : theme.text.muted,
                            }}>
                              {g.name}
                            </Typography>
                          </Box>
                        ))}
                        {/* Add group button / input */}
                        {addingGroup ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, px: 0.5 }}>
                            <input
                              autoFocus
                              value={newGroupName}
                              onChange={e => setNewGroupName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleAddGroup(); if (e.key === 'Escape') { setAddingGroup(false); setNewGroupName(''); } }}
                              onBlur={() => { if (newGroupName.trim()) handleAddGroup(); else { setAddingGroup(false); setNewGroupName(''); } }}
                              placeholder="名称"
                              style={{
                                width: 48, border: 'none', outline: 'none', fontSize: 11,
                                background: 'transparent', color: theme.text.primary, padding: '4px 6px',
                                borderBottom: `1px solid ${theme.brand.primary}`,
                              }}
                            />
                          </Box>
                        ) : (
                          <IconButton
                            size="small"
                            onClick={() => setAddingGroup(true)}
                            sx={{ p: 0.35, flexShrink: 0, color: theme.text.disabled, '&:hover': { color: theme.text.primary }, transition: 'color 0.15s ease' }}
                          >
                            <Plus size={13} />
                          </IconButton>
                        )}
                      </Box>
                      {groupScrollState.canRight && (
                        <IconButton size="small" onClick={() => scrollGroup('right')} sx={{ p: 0.25, ml: 0.25, flexShrink: 0, color: theme.text.muted, '&:hover': { color: theme.text.primary }, transition: 'color 0.15s ease' }}>
                          <ChevronRight size={14} />
                        </IconButton>
                      )}
                    </Box>

                    {/* Symbol list for active group */}
                    <Box sx={{ flex: 1, overflow: 'auto', '&::-webkit-scrollbar': { width: 3 }, '&::-webkit-scrollbar-thumb': { bgcolor: `${theme.text.muted}18`, borderRadius: 4 } }}>
                      {(() => {
                        const group = watchlistGroups.find(g => g.id === activeGroupId);
                        if (!group || group.symbols.length === 0) {
                          return (
                            <Box sx={{ p: 3, textAlign: 'center' }}>
                              <Typography sx={{ fontSize: 11, color: theme.text.disabled, lineHeight: 1.6 }}>
                                暂无关注
                              </Typography>
                              <Typography sx={{ fontSize: 10, color: theme.text.disabled, mt: 0.75 }}>
                                在搜索框中搜索并添加
                              </Typography>
                            </Box>
                          );
                        }
                        // Merge analysis data with watchlist symbols
                        return group.symbols.map(ws => {
                          const analysis = filteredAnalyses.find(a => a.symbol === ws.symbol);
                          const actionColor = analysis ? (ACTION_COLORS[analysis.verdict_action] || theme.text.muted) : theme.text.disabled;
                          const isActive = chartSymbol === ws.symbol;
                          return (
                            <Box
                              key={ws.symbol}
                              onClick={() => setWatchlistSymbol(ws.symbol)}
                              sx={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                px: 2, py: 1.5, cursor: 'pointer',
                                borderBottom: `1px solid ${theme.border.subtle}10`,
                                bgcolor: isActive ? `${theme.brand.primary}08` : 'transparent',
                                transition: 'background-color 0.15s ease',
                                '&:hover': { bgcolor: `${theme.text.primary}05` },
                              }}
                            >
                              <Box sx={{ minWidth: 0, flex: 1 }}>
                                <Typography sx={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, letterSpacing: '-0.01em', lineHeight: 1.3 }}>
                                  {ws.symbol}
                                </Typography>
                                <Typography sx={{ fontSize: 11, color: theme.text.disabled, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', mt: 0.4, lineHeight: 1.3 }}>
                                  {ws.company}
                                </Typography>
                              </Box>
                              {analysis ? (
                                <Box sx={{ px: 1, py: 0.35, borderRadius: '4px', bgcolor: `${actionColor}10`, flexShrink: 0, ml: 1.5 }}>
                                  <Typography sx={{ fontSize: 10, fontWeight: 700, color: actionColor, lineHeight: 1.2, letterSpacing: '0.02em' }}>
                                    {analysis.verdict_action}
                                  </Typography>
                                </Box>
                              ) : (
                                <Box sx={{ px: 1, py: 0.35, borderRadius: '4px', bgcolor: `${theme.text.disabled}08`, flexShrink: 0, ml: 1.5 }}>
                                  <Typography sx={{ fontSize: 10, fontWeight: 500, color: theme.text.disabled, lineHeight: 1.2, letterSpacing: '0.02em' }}>
                                    WATCH
                                  </Typography>
                                </Box>
                              )}
                            </Box>
                          );
                        });
                      })()}
                    </Box>
                  </Box>
                ) : (
                  /* ── Recommendations tab ── */
                  recommendations.map(rec => (
                    <Box
                      key={rec.id}
                      sx={{
                        px: 2, py: 1.5, borderBottom: `1px solid ${theme.border.subtle}10`,
                        opacity: rec.status === 'rejected' ? 0.45 : 1,
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
                        <Typography sx={{
                          fontSize: 12, fontWeight: 700, color: theme.text.primary,
                          textDecoration: rec.status === 'rejected' ? 'line-through' : 'none',
                        }}>
                          {rec.symbol}
                        </Typography>
                        <Typography sx={{ fontSize: 9, color: theme.text.disabled }}>
                          {rec.date}
                        </Typography>
                      </Box>
                      <Typography sx={{ fontSize: 9, color: theme.text.disabled, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rec.company} · {rec.model}
                      </Typography>
                      <Typography sx={{
                        fontSize: 9.5, color: rec.status === 'rejected' ? theme.text.disabled : theme.text.muted,
                        lineHeight: 1.5, mt: 0.4, mb: 0.5,
                        textDecoration: rec.status === 'rejected' ? 'line-through' : 'none',
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {rec.reason}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {rec.status === 'pending' && (
                          <>
                            <Typography
                              onClick={() => { handleAcceptRec(rec.id); handleAnalyze(rec.symbol); }}
                              sx={{ fontSize: 9.5, fontWeight: 600, color: '#10b981', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                            >
                              采纳
                            </Typography>
                            <Typography sx={{ fontSize: 9, color: theme.text.disabled }}>·</Typography>
                            <Typography
                              onClick={() => handleRejectRec(rec.id)}
                              sx={{ fontSize: 9.5, fontWeight: 600, color: '#ef4444', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                            >
                              拒绝
                            </Typography>
                          </>
                        )}
                        {rec.status === 'accepted' && (
                          <Typography sx={{ fontSize: 9.5, fontWeight: 600, color: '#10b981' }}>已采纳</Typography>
                        )}
                        {rec.status === 'rejected' && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography sx={{ fontSize: 9.5, fontWeight: 600, color: theme.text.disabled }}>已拒绝</Typography>
                            <Typography sx={{ fontSize: 9, color: theme.text.disabled }}>·</Typography>
                            <Typography
                              onClick={() => handleDeleteRec(rec.id)}
                              sx={{ fontSize: 9.5, fontWeight: 600, color: theme.text.disabled, cursor: 'pointer', '&:hover': { color: '#ef4444' } }}
                            >
                              删除
                            </Typography>
                          </Box>
                        )}
                      </Box>
                    </Box>
                  ))
                )}
              </Box>
            </Box>

            {/* Center 45%: Chart with mode toggle */}
            <Box sx={{
              width: '42%', flexShrink: 0,
              borderRight: `1px solid ${theme.border.subtle}`,
              display: 'flex', flexDirection: 'column',
            }}>
              {/* Chart mode toggle bar */}
              <Box sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                px: 1.5, py: 0.5, borderBottom: `1px solid ${theme.border.subtle}`,
                flexShrink: 0,
              }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: theme.text.primary }}>
                  {chartSymbol || '—'}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography sx={{ fontSize: 9, color: chartMode === 'line' ? theme.text.primary : theme.text.disabled, fontWeight: 600 }}>
                    Line
                  </Typography>
                  <Switch
                    size="small"
                    checked={chartMode === 'kline'}
                    onChange={(_, checked) => setChartMode(checked ? 'kline' : 'line')}
                    sx={{
                      width: 32, height: 18, p: 0,
                      '& .MuiSwitch-switchBase': { p: '2px', '&.Mui-checked': { transform: 'translateX(14px)', color: '#fff' } },
                      '& .MuiSwitch-thumb': { width: 14, height: 14 },
                      '& .MuiSwitch-track': { borderRadius: 9, bgcolor: `${theme.text.disabled}30` },
                      '& .Mui-checked + .MuiSwitch-track': { bgcolor: `${theme.brand.primary}60 !important` },
                    }}
                  />
                  <Typography sx={{ fontSize: 9, color: chartMode === 'kline' ? theme.text.primary : theme.text.disabled, fontWeight: 600 }}>
                    K-Line
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                {chartSymbol ? (
                  chartMode === 'kline' ? (
                    <TradingViewChart symbol={chartSymbol} />
                  ) : (
                    <Box sx={{
                      position: 'absolute', inset: 0,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      bgcolor: theme.background.secondary,
                    }}>
                      {priceData.length > 0 && (
                        <Typography sx={{ fontSize: 28, fontWeight: 600, color: theme.text.primary, mb: 0.25 }}>
                          ${priceData[priceData.length - 1].close.toFixed(2)}
                        </Typography>
                      )}
                      {priceData.length > 1 && (() => {
                        const first = priceData[0].close;
                        const last = priceData[priceData.length - 1].close;
                        const changePct = ((last - first) / first * 100);
                        const positive = changePct >= 0;
                        return (
                          <Typography sx={{ fontSize: 13, color: positive ? '#22c55e' : '#ef4444', mb: 2 }}>
                            {positive ? '+' : ''}{changePct.toFixed(2)}%
                          </Typography>
                        );
                      })()}
                      <Box sx={{ width: '85%', height: '45%', maxHeight: 220 }}>
                        {priceLoading ? (
                          <Typography sx={{ fontSize: 11, color: theme.text.disabled, textAlign: 'center', pt: 4 }}>Loading...</Typography>
                        ) : (
                          <SvgLineChart
                            data={priceData}
                            width={400}
                            height={160}
                            color={priceData.length > 1 && priceData[priceData.length - 1].close >= priceData[0].close ? '#22c55e' : '#ef4444'}
                          />
                        )}
                      </Box>
                      {priceData.length > 0 && (
                        <Typography sx={{ fontSize: 9, color: theme.text.disabled, mt: 1.5 }}>
                          {priceData[0].date} — {priceData[priceData.length - 1].date}
                        </Typography>
                      )}
                    </Box>
                  )
                ) : (
                  <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography sx={{ fontSize: 13, color: theme.text.disabled }}>输入股票代码查看K线</Typography>
                  </Box>
                )}
              </Box>
            </Box>

            {/* Right 45%: Analysis records */}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Column headers */}
              {filteredAnalyses.length > 0 && (
                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: '48px minmax(60px,1fr) 20px 48px 44px 56px 48px 40px 30px',
                  alignItems: 'center',
                  py: 0.5, px: 1,
                  borderBottom: `1px solid ${theme.border.subtle}`,
                  flexShrink: 0,
                }}>
                  {['Sym', 'Company', '', 'Act', 'Conv', 'Quality', 'Time', 'Date', ''].map((label, i) => (
                    <Typography key={`${label}-${i}`} sx={{
                      fontSize: 8.5, fontWeight: 600, color: theme.text.disabled,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      textAlign: [3, 5].includes(i) ? 'center' : [4, 6, 7].includes(i) ? 'right' : 'left',
                    }}>
                      {label}
                    </Typography>
                  ))}
                </Box>
              )}

              <Box sx={{
                flex: 1, overflow: 'auto',
                '&::-webkit-scrollbar': { width: 3 },
                '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
                '&::-webkit-scrollbar-thumb': { bgcolor: `${theme.text.muted}18`, borderRadius: 4 },
              }}>
                {loadingHistory ? (
                  <Typography sx={{ fontSize: 11, color: theme.text.muted, textAlign: 'center', py: 3 }}>Loading...</Typography>
                ) : filteredAnalyses.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <Typography sx={{ fontSize: 12, color: theme.text.muted }}>暂无分析记录</Typography>
                  </Box>
                ) : (
                  filteredAnalyses.map((a) => renderRow(a, false))
                )}
              </Box>
            </Box>
          </>
        )}
      </Box>

    </Box>
  );
}
