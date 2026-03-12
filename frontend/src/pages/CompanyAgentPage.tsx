import { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { useTheme } from '../theme/ThemeProvider';
import CompanyAnalysisForm from '../components/company/CompanyAnalysisForm';
import { type GateStatus } from '../components/company/GateProgressTracker';
import ThinkingTimeline from '../components/company/ThinkingTimeline';
import ReportPanel from '../components/company/ReportPanel';
import AnalysisRecordCard from '../components/company/AnalysisRecordCard';
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

// Spin keyframes (for running card loader)
const spinKeyframes = `
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}`;

interface RunningAnalysis {
  id: string; // local temp id
  analysisId: string | null; // DB id from data_loaded event
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
  'business_analysis',
  'fisher_qa',
  'moat_assessment',
  'management_assessment',
  'reverse_test',
  'valuation',
  'final_verdict',
] as const;

export default function CompanyAgentPage() {
  const { theme } = useTheme();

  // History records from DB
  const [analyses, setAnalyses] = useState<CompanyAnalysisSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Currently selected record
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<CompanyAnalysisDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Running analyses (can be multiple)
  const [runningAnalyses, setRunningAnalyses] = useState<Map<string, RunningAnalysis>>(new Map());
  // Which running analysis is currently viewed
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);

  // Report panel state
  const [reportOpen, setReportOpen] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runIdCounter = useRef(0);
  const runningRef = useRef(runningAnalyses);
  runningRef.current = runningAnalyses;

  // Load history on mount
  useEffect(() => {
    (async () => {
      try {
        const { analyses: list } = await listCompanyAnalyses({ limit: 100 });
        setAnalyses(list);
      } catch (e) {
        console.error('Failed to load analyses:', e);
      } finally {
        setLoadingHistory(false);
      }
    })();
  }, []);

  // Timer for running analyses elapsed time
  useEffect(() => {
    if (runningAnalyses.size > 0) {
      timerRef.current = setInterval(() => {
        setRunningAnalyses((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const [id, ra] of next) {
            const elapsed = Date.now() - ra.startTime;
            if (elapsed !== ra.elapsedMs) {
              next.set(id, { ...ra, elapsedMs: elapsed });
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }, 200);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [runningAnalyses.size > 0]);

  // Cleanup on unmount — use ref to avoid stale closure over empty initial Map
  useEffect(() => {
    return () => {
      runningRef.current.forEach((ra) => ra.cancel());
    };
  }, []);

  // Load detail when selecting a saved record
  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    (async () => {
      try {
        const detail = await getCompanyAnalysis(selectedId);
        if (!cancelled) {
          setSelectedDetail(detail);
          // Auto-open report for completed records only
          if (detail.status !== 'running') {
            setReportOpen(true);
          }
        }
      } catch (e) {
        console.error('Failed to load analysis detail:', e);
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  // Poll running DB records (e.g. after page refresh) until they complete
  const pollingIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Find "running" records that are NOT backed by a local SSE stream
    const localAnalysisIds = new Set(
      Array.from(runningAnalyses.values()).map((ra) => ra.analysisId).filter(Boolean)
    );
    const dbRunning = analyses.filter(
      (a) => a.status === 'running' && !localAnalysisIds.has(a.id)
    );
    if (dbRunning.length === 0) {
      pollingIdsRef.current.clear();
      return;
    }

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
          } else if (selectedId === id) {
            // Progressive update: refresh intermediate gate results for the viewed record
            setSelectedDetail(detail);
          }
        } catch { /* ignore */ }
      }
      if (pollingIdsRef.current.size === 0) clearInterval(interval);
    }, 3000);

    return () => clearInterval(interval);
  }, [analyses.filter((a) => a.status === 'running').length, runningAnalyses.size]);

  const handleAnalyze = useCallback((symbol: string, provider?: string) => {
    const runId = `run_${++runIdCounter.current}`;

    // Close report panel for new analysis
    setReportOpen(false);

    // Create initial running analysis
    const initial: RunningAnalysis = {
      id: runId,
      analysisId: null,
      symbol,
      provider: provider || 'auto',
      cancel: () => {},
      currentGate: null,
      gateStatuses: {},
      gateResults: {},
      streamingTexts: {},
      companyInfo: null,
      result: null,
      error: null,
      startTime: Date.now(),
      elapsedMs: 0,
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

    const stream = analyzeCompanyStream(
      { symbol, provider },
      (event: CompanyProgressEvent) => {
        switch (event.type) {
          case 'data_loaded':
            updateRun((ra) => ({
              ...ra,
              analysisId: event.analysis_id || null,
              companyInfo: {
                name: event.company_name || symbol,
                symbol: event.symbol || symbol,
                sector: event.sector || '',
                industry: event.industry || '',
                price: event.current_price || 0,
              },
            }));
            // Add running record to history list so it persists across refresh
            if (event.analysis_id) {
              const runningSummary: CompanyAnalysisSummary = {
                id: event.analysis_id,
                symbol: event.symbol || symbol,
                company_name: event.company_name || symbol,
                provider: provider || 'auto',
                model: '',
                status: 'running',
                verdict_action: 'WATCH',
                verdict_conviction: 0.5,
                verdict_quality: 'GOOD',
                total_latency_ms: 0,
                created_at: new Date().toISOString(),
              };
              setAnalyses((prev) => [runningSummary, ...prev]);
            }
            break;

          case 'gate_start':
            if (event.gate) {
              updateRun((ra) => ({
                ...ra,
                currentGate: event.gate!,
                gateStatuses: { ...ra.gateStatuses, [event.gate!]: 'running' as GateStatus },
              }));
            }
            break;

          case 'gate_text':
            if (event.skill && event.text) {
              updateRun((ra) => ({
                ...ra,
                streamingTexts: {
                  ...ra.streamingTexts,
                  [event.skill!]: (ra.streamingTexts[event.skill!] || '') + event.text!,
                },
              }));
            }
            break;

          case 'gate_complete':
            if (event.gate) {
              const status: GateStatus =
                event.parse_status === 'timeout' ? 'timeout' :
                event.parse_status === 'error' ? 'error' : 'complete';
              updateRun((ra) => {
                const newStatuses = { ...ra.gateStatuses, [event.gate!]: status };
                const newResults = { ...ra.gateResults };
                // Clear streaming text for this skill
                const newStreamingTexts = { ...ra.streamingTexts };
                if (event.skill) {
                  delete newStreamingTexts[event.skill];
                  newResults[event.skill] = {
                    gate: event.gate,
                    display_name: event.display_name,
                    parsed: event.parsed || {},
                    parse_status: event.parse_status,
                    latency_ms: event.latency_ms,
                    error: event.error,
                    raw: event.raw || '',
                  };
                  if (event.skill === 'final_verdict' && event.parsed) {
                    const skillNames = [
                      'business_analysis', 'fisher_qa', 'moat_assessment',
                      'management_assessment', 'reverse_test', 'valuation',
                    ];
                    for (const sn of skillNames) {
                      const gateData = event.parsed[sn];
                      if (gateData && typeof gateData === 'object' && newResults[sn]) {
                        newResults[sn] = { ...newResults[sn], parsed: gateData, parse_status: 'structured' };
                      }
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

              // Auto-open report panel on completion
              setReportOpen(true);

              // Update existing running record in analyses list to completed
              if (resultData.analysis_id) {
                const completedSummary: CompanyAnalysisSummary = {
                  id: resultData.analysis_id,
                  symbol: resultData.symbol,
                  company_name: resultData.company_name,
                  provider: resultData.model_used.split('/')[0],
                  model: resultData.model_used.split('/')[1] || '',
                  status: 'completed',
                  verdict_action: resultData.verdict?.action || 'WATCH',
                  verdict_conviction: resultData.verdict?.conviction || 0.5,
                  verdict_quality: resultData.verdict?.quality_verdict || 'GOOD',
                  total_latency_ms: resultData.total_latency_ms,
                  created_at: new Date().toISOString(),
                };
                setAnalyses((prev) => {
                  const exists = prev.some((a) => a.id === resultData.analysis_id);
                  if (exists) {
                    return prev.map((a) => a.id === resultData.analysis_id ? completedSummary : a);
                  }
                  return [completedSummary, ...prev];
                });
                setSelectedId(resultData.analysis_id);
                setViewingRunId(null);
              }

              // Remove from running after a brief delay
              setTimeout(() => {
                setRunningAnalyses((prev) => {
                  const next = new Map(prev);
                  next.delete(runId);
                  return next;
                });
              }, 500);
            }
            break;

          case 'error':
            updateRun((ra) => {
              // Update the analyses list if we have a DB record
              if (ra.analysisId) {
                setAnalyses((prev) => prev.map((a) =>
                  a.id === ra.analysisId ? { ...a, status: 'error', error_message: event.message } : a
                ));
              }
              return { ...ra, error: event.message || 'Analysis failed' };
            });
            // Remove from running after delay
            setTimeout(() => {
              setRunningAnalyses((prev) => {
                const next = new Map(prev);
                next.delete(runId);
                return next;
              });
            }, 3000);
            break;
        }
      },
    );

    initial.cancel = stream.cancel;

    setRunningAnalyses((prev) => {
      const next = new Map(prev);
      next.set(runId, initial);
      return next;
    });

    // View this new running analysis
    setSelectedId(null);
    setViewingRunId(runId);
  }, []);

  const handleDeleteAnalysis = useCallback(async (id: string) => {
    try {
      await deleteCompanyAnalysis(id);
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setSelectedDetail(null);
        setReportOpen(false);
      }
    } catch (e) {
      console.error('Failed to delete analysis:', e);
    }
  }, [selectedId]);

  // Determine what to display
  const viewingRun = viewingRunId ? runningAnalyses.get(viewingRunId) : null;
  const isViewingRunning = !!viewingRun;

  // For the currently viewed running analysis or loaded detail
  const displaySkills: Record<string, GateResult> = isViewingRunning
    ? (viewingRun!.result?.skills || viewingRun!.gateResults)
    : (selectedDetail?.full_report?.skills || {});
  const displayVerdict = isViewingRunning
    ? viewingRun!.result?.verdict as PositionHoldingOutput | undefined
    : selectedDetail?.full_report?.verdict as PositionHoldingOutput | undefined;
  const displayResult = isViewingRunning ? viewingRun!.result : selectedDetail?.full_report || null;
  const displayError = isViewingRunning ? viewingRun!.error : null;
  const displayCompanyInfo = isViewingRunning ? viewingRun!.companyInfo : (selectedDetail ? {
    name: selectedDetail.full_report?.company_name || selectedDetail.company_name,
    symbol: selectedDetail.full_report?.symbol || selectedDetail.symbol,
    sector: selectedDetail.full_report?.sector || '',
    industry: selectedDetail.full_report?.industry || '',
    price: selectedDetail.full_report?.current_price || 0,
  } : null);

  // Build gate statuses for ThinkingTimeline
  // For running analysis: use live gateStatuses; for saved record: build "all complete" statuses
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
            if (result) {
              statuses[result.gate] =
                result.parse_status === 'timeout' ? 'timeout' :
                result.parse_status === 'error' ? 'error' : 'complete';
            }
          }
          // For DB-running records with partial results, mark next gate as running
          if (isDbRunning) {
            const completedGates = Object.keys(statuses).length;
            if (completedGates < 7) {
              statuses[completedGates + 1] = 'running';
            }
          }
          return statuses;
        }
        // DB-running record with no gate data yet — show all pending + gate 1 running
        if (isDbRunning) {
          const statuses: Record<number, GateStatus> = {};
          for (let i = 1; i <= 7; i++) statuses[i] = 'pending';
          statuses[1] = 'running';
          return statuses;
        }
        return {};
      })();

  const displayGateResults: Record<string, GateResult> = isViewingRunning
    ? viewingRun!.gateResults
    : (selectedDetail?.full_report?.skills || {});

  const displayStreamingTexts = isViewingRunning ? viewingRun!.streamingTexts : {};
  const displayCurrentGate = isViewingRunning
    ? viewingRun!.currentGate
    : isDbRunning
      ? (Object.entries(displayGateStatuses).find(([, s]) => s === 'running')?.[0] ? Number(Object.entries(displayGateStatuses).find(([, s]) => s === 'running')![0]) : null)
      : null;
  const isComplete = isViewingRunning ? !!viewingRun!.result : (!!displayResult && !isDbRunning);

  const runningCount = runningAnalyses.size;
  const hasRecords = analyses.length > 0 || runningCount > 0;
  const hasTimeline = Object.keys(displayGateStatuses).length > 0 || displayCompanyInfo != null || !!displayError || isDbRunning;

  return (
    <Box
      sx={{
        m: -3,
        height: 'calc(100vh - 48px)',
        width: 'calc(100% + 48px)',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: theme.background.primary,
        color: theme.text.primary,
        overflow: 'hidden',
      }}
    >
      <style>{spinKeyframes}</style>

      {/* Header */}
      <Box sx={{ px: 3, pt: 3, pb: 1.5 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 600, mb: 2 }}>
          Company Investment Agent
        </Typography>
        <CompanyAnalysisForm
          onAnalyze={handleAnalyze}
          isRunning={false}
          runningCount={runningCount}
          elapsedMs={viewingRun?.elapsedMs || 0}
        />
      </Box>

      {/* Records strip */}
      {hasRecords && (
        <Box
          sx={{
            px: 3,
            py: 1.5,
            borderBottom: `1px solid ${theme.border.subtle}`,
            display: 'flex',
            gap: 1,
            overflowX: 'auto',
            overflowY: 'hidden',
            '&::-webkit-scrollbar': { height: 4 },
            '&::-webkit-scrollbar-thumb': { bgcolor: theme.border.default, borderRadius: 2 },
          }}
        >
          {/* Running analyses first */}
          {Array.from(runningAnalyses.values()).map((ra) => (
            <AnalysisRecordCard
              key={ra.id}
              running={{
                symbol: ra.symbol,
                provider: ra.provider,
                currentGate: ra.currentGate,
                gateStatuses: ra.gateStatuses,
              }}
              selected={viewingRunId === ra.id}
              onClick={() => { setSelectedId(null); setViewingRunId(ra.id); setReportOpen(false); }}
            />
          ))}

          {/* Saved records (skip those backed by a live SSE stream to avoid duplicates) */}
          {analyses
            .filter((a) => {
              if (a.status !== 'running') return true;
              // Hide if there's a local SSE stream for this DB record
              return !Array.from(runningAnalyses.values()).some((ra) => ra.analysisId === a.id);
            })
            .map((a) => (
              <AnalysisRecordCard
                key={a.id}
                record={a}
                selected={selectedId === a.id && !viewingRunId}
                onClick={() => { setViewingRunId(null); setSelectedId(a.id); }}
                onDelete={() => handleDeleteAnalysis(a.id)}
              />
            ))}
        </Box>
      )}

      {/* Main content area: Timeline + Report Panel */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: Timeline area */}
        <Box
          sx={{
            flex: reportOpen ? '0 0 45%' : '1 1 auto',
            overflow: 'auto',
            transition: 'flex 0.3s ease',
            display: 'flex',
            justifyContent: 'center',
            '&::-webkit-scrollbar': { width: 6 },
            '&::-webkit-scrollbar-thumb': { bgcolor: theme.border.default, borderRadius: 3 },
          }}
        >
          <Box sx={{ maxWidth: reportOpen ? '100%' : 720, width: '100%', px: 3, py: 2 }}>
            {/* Loading detail */}
            {loadingDetail && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <Typography sx={{ fontSize: 13, color: theme.text.muted }}>Loading...</Typography>
              </Box>
            )}

            {/* ThinkingTimeline */}
            {hasTimeline && (
              <ThinkingTimeline
                gateStatuses={displayGateStatuses}
                gateResults={displayGateResults}
                streamingTexts={displayStreamingTexts}
                currentGate={displayCurrentGate}
                companyInfo={displayCompanyInfo}
                error={displayError}
                isComplete={isComplete}
                isDbRunning={isDbRunning}
                elapsedMs={isViewingRunning ? (viewingRun!.elapsedMs) : (displayResult?.total_latency_ms || 0)}
                onOpenReport={() => setReportOpen(true)}
              />
            )}

            {/* Empty state */}
            {!isViewingRunning && !selectedId && !loadingHistory && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '60%',
                  flexDirection: 'column',
                  gap: 1,
                }}
              >
                <Typography sx={{ fontSize: 16, fontWeight: 500, color: theme.text.muted }}>
                  7-Gate Decision Tree Analysis
                </Typography>
                <Typography sx={{ fontSize: 13, color: theme.text.disabled }}>
                  {analyses.length > 0 ? '选择一条记录查看详情，或输入股票代码开始新分析' : '输入股票代码开始分析'}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>

        {/* Right: Report Panel */}
        <ReportPanel
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          skills={displaySkills}
          verdict={displayVerdict}
          companyInfo={displayCompanyInfo}
          totalLatencyMs={displayResult?.total_latency_ms}
          modelUsed={displayResult?.model_used}
          dataFreshness={displayResult?.data_freshness}
          toolCallsCount={displayResult?.tool_calls?.length}
        />
      </Box>
    </Box>
  );
}
