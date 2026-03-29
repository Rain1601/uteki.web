import { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import { Loader2, Trash2 } from 'lucide-react';
import TradingViewChart from '../components/index/TradingViewChart';
import { ModelLogo } from '../components/index/ModelLogos';
import PageHeader from '../components/PageHeader';
import { useTheme } from '../theme/ThemeProvider';
import CompanyAnalysisForm from '../components/company/CompanyAnalysisForm';
import { type GateStatus } from '../components/company/GateProgressTracker';
import ThinkingTimeline from '../components/company/ThinkingTimeline';
import ReportPanel from '../components/company/ReportPanel';
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

  const handleDeleteAnalysis = useCallback(async (id: string) => {
    try {
      await deleteCompanyAnalysis(id);
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
      if (selectedId === id) { setSelectedId(null); setSelectedDetail(null); setReportOpen(false); }
    } catch (e) { console.error('Failed to delete analysis:', e); }
  }, [selectedId]);

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
        onClick={() => { setViewingRunId(null); setSelectedId(a.id); }}
        sx={{
          display: 'grid',
          gridTemplateColumns: compact
            ? '48px 1fr 44px 36px'
            : '48px 1fr 20px 48px 44px 56px 48px 40px',
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
      </Box>
    );
  };

  // ── Chart symbol — watchlist click overrides, detail selection overrides that ──
  const chartSymbol = displayCompanyInfo?.symbol
    || watchlistSymbol
    || (filteredAnalyses.length > 0 ? filteredAnalyses[0].symbol : null);

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
              onClick={() => { setSelectedId(null); setSelectedDetail(null); setViewingRunId(null); setReportOpen(false); }}
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
      </PageHeader>

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
        <CompanyAnalysisForm onAnalyze={handleAnalyze} isRunning={false} runningCount={runningCount} elapsedMs={0} />
      </Box>

      {/* ══════════════════════════════════════════════════════
          LAYOUT A: 列表状态 — 左20% Watchlist | 中40% K线 | 右40% 分析列表
          LAYOUT B: 详情状态 — 左30% 分析列表 | 中+右70% 分析报告
          ══════════════════════════════════════════════════════ */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {hasSelection && hasTimeline ? (
          /* ═══ LAYOUT B: Detail mode — Left K-line | Right (progress + report) ═══ */
          <>
            {/* Left 35%: K-line Chart */}
            <Box sx={{
              width: '35%', flexShrink: 0,
              borderRight: `1px solid ${theme.border.subtle}`,
              position: 'relative',
            }}>
              {chartSymbol ? (
                <TradingViewChart symbol={chartSymbol} />
              ) : (
                <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ fontSize: 13, color: theme.text.disabled }}>Select a symbol</Typography>
                </Box>
              )}
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
                />
              </Box>
            </Box>
          </>
        ) : (
          /* ═══ LAYOUT A: List mode — Watchlist | Chart | Screener ═══ */
          <>
            {/* Left 20%: Watchlist (unique symbols) */}
            <Box sx={{
              width: '20%', flexShrink: 0,
              borderRight: `1px solid ${theme.border.subtle}`,
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              <Box sx={{
                px: 1.5, py: 0.75, flexShrink: 0,
                borderBottom: `1px solid ${theme.border.subtle}`,
              }}>
                <Typography sx={{ fontSize: 10, fontWeight: 600, color: theme.text.disabled, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Watchlist
                </Typography>
              </Box>
              <Box sx={{
                flex: 1, overflow: 'auto',
                '&::-webkit-scrollbar': { width: 3 },
                '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
                '&::-webkit-scrollbar-thumb': { bgcolor: `${theme.text.muted}18`, borderRadius: 4 },
              }}>
                {/* Deduplicated symbols */}
                {(() => {
                  const seen = new Set<string>();
                  return filteredAnalyses.filter((a) => {
                    if (seen.has(a.symbol)) return false;
                    seen.add(a.symbol);
                    return true;
                  }).map((a) => {
                    const actionColor = ACTION_COLORS[a.verdict_action] || theme.text.muted;
                    const isActive = chartSymbol === a.symbol;
                    return (
                      <Box
                        key={a.symbol}
                        onClick={() => setWatchlistSymbol(a.symbol)}
                        sx={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          px: 1.5, py: 0.75,
                          cursor: 'pointer',
                          bgcolor: isActive ? `${theme.brand.primary}08` : 'transparent',
                          borderLeft: isActive ? `2px solid ${theme.brand.primary}` : '2px solid transparent',
                          '&:hover': { bgcolor: `${theme.text.primary}05` },
                        }}
                      >
                        <Box>
                          <Typography sx={{ fontSize: 12, fontWeight: 700, color: theme.text.primary }}>
                            {a.symbol}
                          </Typography>
                          <Typography sx={{ fontSize: 9.5, color: theme.text.disabled, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                            {a.company_name || ''}
                          </Typography>
                        </Box>
                        <Typography sx={{ fontSize: 10, fontWeight: 700, color: actionColor }}>
                          {a.verdict_action}
                        </Typography>
                      </Box>
                    );
                  });
                })()}
              </Box>
            </Box>

            {/* Center 40%: K-line Chart */}
            <Box sx={{
              width: '40%', flexShrink: 0,
              borderRight: `1px solid ${theme.border.subtle}`,
              position: 'relative',
            }}>
              {chartSymbol ? (
                <TradingViewChart symbol={chartSymbol} />
              ) : (
                <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ fontSize: 13, color: theme.text.disabled }}>输入股票代码查看K线</Typography>
                </Box>
              )}
            </Box>

            {/* Right 40%: Analysis records */}
            <Box sx={{ width: '40%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Column headers */}
              {filteredAnalyses.length > 0 && (
                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: '48px 1fr 20px 48px 44px 56px 48px 40px',
                  alignItems: 'center',
                  py: 0.5, px: 1,
                  borderBottom: `1px solid ${theme.border.subtle}`,
                  flexShrink: 0,
                }}>
                  {['Sym', 'Company', '', 'Act', 'Conv', 'Quality', 'Time', 'Date'].map((label, i) => (
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
