import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  Collapse,
  TextField,
  LinearProgress,
} from '@mui/material';
import {
  Play,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { useTheme } from '../../theme/ThemeProvider';
import LoadingDots from '../LoadingDots';
import { toast } from 'sonner';
import {
  ArenaTimelinePoint,
  ArenaVote,
  ArenaFinalDecision,
  ArenaProgressEvent,
  ModelIOSummary,
  ModelIODetail,
  PipelineStep,
  AccountSummary,
  runArenaStream,
  fetchArenaTimeline,
  fetchArenaResults,
  fetchModelIODetail,
  fetchArenaVotes,
  adoptModel,
  fetchAccountSummary,
  fetchAgentConfig,
  saveAgentConfig,
  fetchModelConfig,
  ModelConfig,
} from '../../api/index';
import { ModelLogo } from './ModelLogos';
import ArenaTimelineChart from './ArenaTimelineChart';
import AllocationBarChart from './AllocationBarChart';

// 硬编码 fallback（DB 无配置时使用）
const DEFAULT_MODELS = [
  { provider: 'anthropic', name: 'claude-sonnet-4-20250514' },
  { provider: 'openai', name: 'gpt-4o' },
  { provider: 'deepseek', name: 'deepseek-chat' },
  { provider: 'google', name: 'gemini-2.5-pro-thinking' },
  { provider: 'qwen', name: 'qwen-plus' },
  { provider: 'minimax', name: 'MiniMax-Text-01' },
];

const SKILL_LABELS: Record<string, string> = {
  analyze_market: 'Market',
  analyze_macro: 'Macro',
  recall_memory: 'Memory',
  make_decision: 'Decision',
};

const SKILL_ORDER = ['analyze_market', 'analyze_macro', 'recall_memory', 'make_decision'];

interface ModelProgress {
  phase: string;
  currentSkill: string | null;
  completedSkills: string[];
  status: 'pending' | 'running' | 'done' | 'error';
  latency?: number;
  parseStatus?: string;
}

interface PhaseProgress {
  phase: string;
  totalModels: number;
  completedModels: number;
}

export default function ArenaView() {
  const { theme, isDark } = useTheme();

  // Timeline data
  const [timeline, setTimeline] = useState<ArenaTimelinePoint[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Selected point
  const [selectedHarnessId, setSelectedHarnessId] = useState<string | null>(null);
  const [selectedModels, setSelectedModels] = useState<ModelIOSummary[]>([]);
  const [selectedHarnessType, setSelectedHarnessType] = useState('');
  const [selectedPromptVersion, setSelectedPromptVersion] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  // Voting data
  const votesState = useState<ArenaVote[]>([]);
  const setVotes = votesState[1];
  const [finalDecision, setFinalDecision] = useState<ArenaFinalDecision | null>(null);

  // Account & config
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [agentBudget, setAgentBudget] = useState<number>(1000);
  const [budgetInput, setBudgetInput] = useState<string>('1000');
  const [budgetSaving, setBudgetSaving] = useState(false);

  // Dynamic model list from DB config
  const [knownModels, setKnownModels] = useState(DEFAULT_MODELS);

  // Run controls
  const [running, setRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  // Selected model for detail view
  const [selectedModelId2, setSelectedModelId2] = useState<string | null>(null);

  // SSE progress state
  const [modelProgress, setModelProgress] = useState<Record<string, ModelProgress>>({});
  const [phaseProgress, setPhaseProgress] = useState<PhaseProgress | null>(null);

  // Load timeline data
  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    try {
      const res = await fetchArenaTimeline();
      if (res.success && res.data) {
        setTimeline(res.data);
        if (res.data.length > 0 && !selectedHarnessId) {
          const latest = res.data[res.data.length - 1];
          handleSelectPoint(latest.harness_id, res.data);
        }
      }
    } catch { /* ignore */ }
    finally { setTimelineLoading(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadTimeline(); }, [loadTimeline]);

  // Load account summary, agent config, and model config
  useEffect(() => {
    fetchAccountSummary().then((res) => {
      if (res.success && res.data) setAccount(res.data);
    }).catch(() => {});
    fetchAgentConfig().then((res) => {
      if (res.success && res.data?.budget != null) {
        setAgentBudget(res.data.budget);
        setBudgetInput(String(res.data.budget));
      }
    }).catch(() => {});
    fetchModelConfig().then((res) => {
      if (res.success && res.data && res.data.length > 0) {
        const enabled = res.data.filter((m: ModelConfig) => m.enabled);
        if (enabled.length > 0) {
          setKnownModels(enabled.map((m: ModelConfig) => ({ provider: m.provider, name: m.model })));
        }
      }
    }).catch(() => {});
  }, []);

  // Save budget
  const handleSaveBudget = useCallback(async () => {
    const val = Number(budgetInput);
    if (isNaN(val) || val <= 0) return;
    setBudgetSaving(true);
    try {
      await saveAgentConfig({ budget: val });
      setAgentBudget(val);
      toast.success('Budget saved');
    } catch {
      toast.error('Failed to save budget');
    } finally {
      setBudgetSaving(false);
    }
  }, [budgetInput, toast]);

  // Timer
  useEffect(() => {
    if (running) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [running]);

  // Select a point on the chart
  const handleSelectPoint = useCallback(async (harnessId: string, timelineData?: ArenaTimelinePoint[]) => {
    const tl = timelineData || timeline;
    const point = tl.find((p) => p.harness_id === harnessId);

    setSelectedHarnessId(harnessId);
    setSelectedHarnessType(point?.harness_type || '');
    setSelectedPromptVersion(point?.prompt_version || '');
    setSelectedModels([]);
    setVotes([]);
    setFinalDecision(null);
    setDetailLoading(true);

    try {
      const [resModels, resVotes] = await Promise.all([
        fetchArenaResults(harnessId),
        fetchArenaVotes(harnessId),
      ]);
      if (resModels.success && resModels.data) setSelectedModels(resModels.data);
      if (resVotes.success && resVotes.data) setVotes(resVotes.data);
    } catch { toast.error('Failed to load arena results'); }
    finally { setDetailLoading(false); }
  }, [timeline, toast]);

  // Handle SSE progress events
  const handleProgressEvent = useCallback((event: ArenaProgressEvent) => {
    switch (event.type) {
      case 'phase_start':
        setPhaseProgress({
          phase: event.phase || '',
          totalModels: event.total_models || 0,
          completedModels: 0,
        });
        break;

      case 'model_start':
        if (event.model) {
          setModelProgress(prev => ({
            ...prev,
            [event.model!]: {
              phase: event.phase || 'decide',
              currentSkill: null,
              completedSkills: [],
              status: 'running',
            },
          }));
        }
        break;

      case 'skill_start':
        if (event.model) {
          setModelProgress(prev => ({
            ...prev,
            [event.model!]: {
              ...prev[event.model!],
              currentSkill: event.skill || null,
            },
          }));
        }
        break;

      case 'skill_complete':
        if (event.model) {
          setModelProgress(prev => {
            const existing = prev[event.model!];
            if (!existing) return prev;
            return {
              ...prev,
              [event.model!]: {
                ...existing,
                currentSkill: null,
                completedSkills: event.error
                  ? existing.completedSkills
                  : [...existing.completedSkills, event.skill || ''],
              },
            };
          });
        }
        break;

      case 'model_complete':
        if (event.model) {
          setModelProgress(prev => ({
            ...prev,
            [event.model!]: {
              ...prev[event.model!],
              currentSkill: null,
              status: event.status === 'success' ? 'done' : 'error',
              latency: event.latency_ms,
              parseStatus: event.parse_status,
            },
          }));
          setPhaseProgress(prev => prev ? {
            ...prev,
            completedModels: prev.completedModels + 1,
          } : null);
        }
        break;

      case 'result':
        if (event.data) {
          setSelectedHarnessId(event.data.harness_id);
          setSelectedHarnessType(event.data.harness_type);
          setSelectedPromptVersion(event.data.prompt_version || '');
          setSelectedModels(event.data.models);
          setVotes(event.data.votes || []);
          setFinalDecision(event.data.final_decision || null);
          // Reload timeline
          fetchArenaTimeline().then(tlRes => {
            if (tlRes.success && tlRes.data) setTimeline(tlRes.data);
          }).catch(() => {});
          fetchAccountSummary().then(r => {
            if (r.success && r.data) setAccount(r.data);
          }).catch(() => {});
        }
        setRunning(false);
        break;

      case 'error':
        toast.error(event.message || 'Arena stream error');
        setRunning(false);
        break;
    }
  }, [toast]);

  // Run Arena with SSE
  const handleRun = useCallback(async () => {
    setRunning(true);
    setModelProgress({});
    setPhaseProgress(null);
    setFinalDecision(null);
    setSelectedModels([]);

    const models = knownModels
      .map(m => ({ provider: m.provider, model: m.name }));

    const { cancel } = runArenaStream(
      { harness_type: 'monthly_dca', budget: agentBudget, models },
      handleProgressEvent,
    );
    cancelRef.current = cancel;
  }, [agentBudget, knownModels, handleProgressEvent]);

  const hasData = timeline.length > 0;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Top Controls ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', px: 3, py: 1, flexShrink: 0, borderBottom: `1px solid ${theme.border.subtle}`, gap: 2, minHeight: 48 }}>
        {[
          { label: 'Total', value: account?.total, bold: true },
          { label: 'Cash', value: account?.cash },
          { label: 'Positions', value: account?.positions_value },
        ].map(({ label, value, bold }) => (
          <Box key={label} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
            <Typography sx={{ fontSize: 10, color: theme.text.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</Typography>
            <Typography sx={{
              fontSize: bold ? 15 : 13,
              fontWeight: bold ? 700 : 500,
              color: bold ? theme.text.primary : theme.text.secondary,
              fontFeatureSettings: '"tnum"',
              fontFamily: '"JetBrains Mono", "SF Mono", monospace',
            }}>
              {value != null ? `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
            </Typography>
          </Box>
        ))}

        <Box sx={{ flex: 1 }} />

        <TextField
          size="small"
          label="Budget"
          type="number"
          value={budgetInput}
          onChange={(e) => setBudgetInput(e.target.value)}
          onBlur={handleSaveBudget}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveBudget(); }}
          sx={{ width: 100 }}
          InputProps={{
            sx: { color: theme.text.primary, fontSize: 13, height: 32 },
            startAdornment: <Typography sx={{ fontSize: 12, color: theme.text.muted, mr: 0.3 }}>$</Typography>,
          }}
          InputLabelProps={{ sx: { color: theme.text.muted, fontSize: 12 } }}
          disabled={budgetSaving}
        />

        <Button
          startIcon={running ? undefined : <Play size={16} />}
          onClick={handleRun}
          disabled={running}
          size="small"
          sx={{
            bgcolor: theme.brand.primary,
            color: '#fff',
            textTransform: 'none',
            fontWeight: 600,
            fontSize: 12,
            borderRadius: 1.5,
            px: 2,
            py: 0.6,
            flexShrink: 0,
            '&:hover': { bgcolor: theme.brand.hover },
          }}
        >
          {running ? <LoadingDots text="Running" fontSize={12} color="#fff" /> : 'Run Arena'}
        </Button>
        <Typography sx={{
          fontSize: 11,
          color: theme.text.muted,
          flexShrink: 0,
          minWidth: 28,
          textAlign: 'right',
          visibility: running ? 'visible' : 'hidden',
        }}>
          {elapsedSeconds}s
        </Typography>

      </Box>

      {/* ── Main Content: Left Chart + Right Detail ── */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* ── Left Panel: Timeline Chart (50%) ── */}
        <Box
          sx={{
            width: { xs: '100%', md: '50%' },
            height: { xs: 280, md: '100%' },
            flexShrink: 0,
            borderRight: { xs: 'none', md: `1px solid ${theme.border.subtle}` },
            borderBottom: { xs: `1px solid ${theme.border.subtle}`, md: 'none' },
          }}
        >
          {timelineLoading ? (
            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <LoadingDots text="Loading timeline" fontSize={13} />
            </Box>
          ) : (
            <ArenaTimelineChart
              data={timeline}
              selectedHarnessId={selectedHarnessId}
              onSelectPoint={(id) => handleSelectPoint(id)}
            />
          )}
        </Box>

        {/* ── Right Panel: Allocation Chart + Detail (50%) ── */}
        <Box
          sx={{
            width: { xs: '100%', md: '50%' },
            overflow: 'auto',
            px: 1.5,
            py: 1.5,
            minWidth: 0,
          }}
        >
          {/* Running: Progress cards */}
          {running && (
            <>
              {/* Phase progress banner */}
              {phaseProgress && (
                <Box sx={{
                  mb: 1.5,
                  px: 1.5,
                  py: 1,
                  borderRadius: '8px',
                  bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                  border: `1px solid ${theme.border.subtle}`,
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {[
                        { key: 'decide', label: 'Decide', num: 1 },
                        { key: 'vote', label: 'Vote', num: 2 },
                        { key: 'tally', label: 'Tally', num: 3 },
                      ].map((p, i) => (
                        <Box key={p.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {i > 0 && <Box sx={{ width: 12, height: 1, bgcolor: theme.border.subtle }} />}
                          <Typography sx={{
                            fontSize: 11,
                            fontWeight: phaseProgress.phase === p.key ? 700 : 400,
                            color: phaseProgress.phase === p.key ? theme.brand.primary : theme.text.muted,
                          }}>
                            {p.num}. {p.label}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                    <Typography sx={{ fontSize: 11, color: theme.text.muted, fontFeatureSettings: '"tnum"' }}>
                      {phaseProgress.completedModels}/{phaseProgress.totalModels}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={phaseProgress.totalModels > 0
                      ? (phaseProgress.completedModels / phaseProgress.totalModels) * 100
                      : 0}
                    sx={{
                      height: 2,
                      borderRadius: 1,
                      bgcolor: 'rgba(128,128,128,0.08)',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: theme.brand.primary,
                        borderRadius: 1,
                      },
                    }}
                  />
                </Box>
              )}

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                {knownModels.map((m) => {
                  const key = `${m.provider}:${m.name}`;
                  const progress = modelProgress[key];
                  return (
                    <ProgressModelCard
                      key={key}
                      provider={m.provider}
                      modelName={m.name}
                      progress={progress}
                      theme={theme}
                      isDark={isDark}
                      elapsedSeconds={elapsedSeconds}
                    />
                  );
                })}
              </Box>
            </>
          )}

          {/* No data empty state */}
          {!running && !hasData && !selectedHarnessId && (
            <Box sx={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: '100%', gap: 2, px: 3,
            }}>
              <Box sx={{
                width: 48, height: 48, borderRadius: '8px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: `${theme.brand.primary}12`,
                border: `1px solid ${theme.brand.primary}20`,
              }}>
                <Play size={22} style={{ color: theme.brand.primary, marginLeft: 2 }} />
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography sx={{ fontSize: 15, fontWeight: 600, color: theme.text.primary, mb: 0.5 }}>
                  Multi-Model Arena
                </Typography>
                <Typography sx={{ fontSize: 12, color: theme.text.muted, maxWidth: 360, lineHeight: 1.6 }}>
                  将同一份市场快照发送给多个 LLM，独立分析后投票选出最优决策
                </Typography>
              </Box>
            </Box>
          )}

          {/* Selected model results */}
          {!running && selectedHarnessId && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 1 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.secondary }}>
                  Results
                </Typography>
                {selectedHarnessType && (
                  <Chip
                    label={selectedHarnessType.replace('_', ' ')}
                    size="small"
                    sx={{ fontSize: 9, height: 18, bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', color: theme.text.muted }}
                  />
                )}
                {selectedPromptVersion && (
                  <Chip
                    label={selectedPromptVersion}
                    size="small"
                    sx={{ fontSize: 9, height: 18, bgcolor: 'rgba(76,175,80,0.1)', color: '#4caf50' }}
                  />
                )}
              </Box>

              {detailLoading && selectedModels.length === 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {knownModels.map((m) => (
                    <ProgressModelCard
                      key={m.provider}
                      provider={m.provider}
                      modelName={m.name}
                      theme={theme}
                      isDark={isDark}
                      elapsedSeconds={0}
                    />
                  ))}
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {/* Final decision banner */}
                  {finalDecision && (() => {
                    const actionColors: Record<string, { bg: string; text: string; border: string }> = {
                      BUY:  { bg: 'rgba(76,175,80,0.06)', text: '#4caf50', border: 'rgba(76,175,80,0.2)' },
                      SELL: { bg: 'rgba(244,67,54,0.06)', text: '#f44336', border: 'rgba(244,67,54,0.2)' },
                      HOLD: { bg: 'rgba(255,152,0,0.06)', text: '#ff9800', border: 'rgba(255,152,0,0.2)' },
                    };
                    const ac = actionColors[finalDecision.winner_action] || actionColors.HOLD;
                    return (
                      <Box sx={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        py: 1, px: 1.5,
                        bgcolor: ac.bg, borderRadius: '12px', mb: 1,
                        border: `1px solid ${ac.border}`,
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Typography sx={{
                            fontSize: 18, fontWeight: 700, color: ac.text,
                            letterSpacing: '0.05em',
                          }}>
                            {finalDecision.winner_action}
                          </Typography>
                          <Box>
                            <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.primary, lineHeight: 1.2 }}>
                              {finalDecision.winner_model_name}
                            </Typography>
                            <Typography sx={{ fontSize: 10, color: theme.text.muted, lineHeight: 1.2 }}>
                              Consensus winner
                            </Typography>
                          </Box>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Box sx={{ textAlign: 'center' }}>
                            <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#4caf50', lineHeight: 1 }}>
                              {finalDecision.total_approve}
                            </Typography>
                            <Typography sx={{ fontSize: 8, color: theme.text.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              approve
                            </Typography>
                          </Box>
                          <Box sx={{ textAlign: 'center' }}>
                            <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#f44336', lineHeight: 1 }}>
                              {finalDecision.total_reject}
                            </Typography>
                            <Typography sx={{ fontSize: 8, color: theme.text.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              reject
                            </Typography>
                          </Box>
                        </Box>
                      </Box>
                    );
                  })()}

                  {/* Allocation Bar Chart */}
                  {(() => {
                    const selectedDetail = selectedModels.find((m) => m.id === selectedModelId2);
                    return (
                      <>
                        <AllocationBarChart
                          models={selectedModels}
                          isDark={isDark}
                          theme={theme}
                          onSelectModel={(id) => setSelectedModelId2(prev => prev === id ? null : id)}
                          selectedModelId={selectedModelId2}
                        />

                        {/* Selected model detail card */}
                        {selectedDetail && (
                          <Box sx={{ mt: 1, borderTop: `1px solid ${theme.border.subtle}`, pt: 1 }}>
                            <ModelCard
                              model={selectedDetail}
                              harnessId={selectedHarnessId}
                              theme={theme}
                              isDark={isDark}
                              voteSummary={finalDecision?.vote_summary?.[selectedDetail.id]}
                              isWinner={finalDecision?.winner_model_io_id === selectedDetail.id}
                              votes={votesState[0]}
                              allModels={selectedModels}
                            />
                          </Box>
                        )}
                      </>
                    );
                  })()}
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/* ── Progress Model Card (during run) — compact, single-row design ── */
function ProgressModelCard({
  provider,
  modelName,
  progress,
  theme,
  isDark,
  elapsedSeconds,
}: {
  provider: string;
  modelName: string;
  progress?: ModelProgress;
  theme: any;
  isDark: boolean;
  elapsedSeconds: number;
}) {
  const isDone = progress?.status === 'done';
  const isError = progress?.status === 'error';
  const completedCount = progress?.completedSkills?.length ?? 0;
  const totalSteps = SKILL_ORDER.length;
  const progressPct = (completedCount / totalSteps) * 100;
  const currentLabel = progress?.currentSkill ? SKILL_LABELS[progress.currentSkill] : null;

  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 1.5,
      py: 0.75,
      px: 1,
      borderRadius: '10px',
      bgcolor: isDone
        ? 'rgba(76,175,80,0.04)'
        : isError
          ? 'rgba(244,67,54,0.04)'
          : 'transparent',
      transition: 'background-color 0.3s',
    }}>
      {/* Model identity */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 140, flexShrink: 0 }}>
        <ModelLogo provider={provider} size={20} isDark={isDark} />
        <Typography sx={{
          fontSize: 12,
          fontWeight: 600,
          color: theme.text.primary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {modelName.replace(/^(.*?\/)?/, '').slice(0, 24)}
        </Typography>
      </Box>

      {/* Progress bar — replaces 4 separate boxes */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {isDone || isError ? (
          <Box sx={{
            height: 4,
            borderRadius: 2,
            bgcolor: isDone ? 'rgba(76,175,80,0.25)' : 'rgba(244,67,54,0.25)',
          }} />
        ) : (
          <Box sx={{ position: 'relative', height: 4, borderRadius: 2, bgcolor: 'rgba(128,128,128,0.08)' }}>
            <Box sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              width: `${progressPct}%`,
              borderRadius: 2,
              bgcolor: theme.brand.primary,
              transition: 'width 0.5s ease-out',
            }} />
            {/* Pulse dot at progress edge */}
            {progressPct > 0 && progressPct < 100 && (
              <Box sx={{
                position: 'absolute',
                top: -2,
                left: `${progressPct}%`,
                transform: 'translateX(-4px)',
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: theme.brand.primary,
                animation: 'pulse 1.5s ease-in-out infinite',
                '@keyframes pulse': {
                  '0%, 100%': { opacity: 1, transform: 'translateX(-4px) scale(1)' },
                  '50%': { opacity: 0.5, transform: 'translateX(-4px) scale(1.4)' },
                },
              }} />
            )}
          </Box>
        )}
      </Box>

      {/* Current step label */}
      <Typography sx={{
        fontSize: 10,
        color: isDone ? '#4caf50' : isError ? '#f44336' : theme.brand.primary,
        fontWeight: 500,
        minWidth: 56,
        textAlign: 'center',
        opacity: 0.8,
      }}>
        {isDone ? 'Done' : isError ? 'Error' : currentLabel || 'Starting...'}
      </Typography>

      {/* Time */}
      <Typography sx={{
        fontSize: 10,
        color: theme.text.muted,
        minWidth: 32,
        textAlign: 'right',
        fontFeatureSettings: '"tnum"',
      }}>
        {progress?.latency != null ? `${(progress.latency / 1000).toFixed(1)}s` : isDone || isError ? '' : `${elapsedSeconds}s`}
      </Typography>

      {/* Status badge */}
      {progress?.parseStatus && (
        <Box sx={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          bgcolor: progress.parseStatus === 'structured' ? '#4caf50' : '#ff9800',
          flexShrink: 0,
        }} />
      )}
    </Box>
  );
}

/* ── Pipeline Steps Display ── */
function PipelineSteps({
  steps,
  theme,
}: {
  steps: PipelineStep[];
  theme: any;
}) {
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  return (
    <Box sx={{ py: 0.5 }}>
      <Typography sx={{ fontSize: 11, color: theme.text.muted, fontWeight: 600, mb: 0.5 }}>
        Pipeline Steps
      </Typography>
      {steps.map((step, i) => (
        <Box key={i}>
          <Box
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              py: 0.3, px: 0.5, borderRadius: 0.5, cursor: step.output_summary ? 'pointer' : 'default',
              '&:hover': step.output_summary ? { bgcolor: 'rgba(128,128,128,0.05)' } : {},
            }}
            onClick={() => step.output_summary && setExpandedSkill(expandedSkill === step.skill ? null : step.skill)}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography sx={{
                fontSize: 10,
                color: step.status === 'success' ? '#4caf50' : '#f44336',
              }}>
                {step.status === 'success' ? '✓' : '✗'}
              </Typography>
              <Typography sx={{ fontSize: 11, color: theme.text.primary }}>
                {SKILL_LABELS[step.skill] || step.skill}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {step.latency_ms != null && (
                <Typography sx={{ fontSize: 10, color: theme.text.muted }}>
                  {(step.latency_ms / 1000).toFixed(1)}s
                </Typography>
              )}
              {step.output_summary && (
                expandedSkill === step.skill
                  ? <ChevronUp size={12} style={{ color: theme.text.muted }} />
                  : <ChevronDown size={12} style={{ color: theme.text.muted }} />
              )}
            </Box>
          </Box>
          <Collapse in={expandedSkill === step.skill}>
            <Box sx={{ px: 0.5, py: 0.5, ml: 1 }}>
              {step.error ? (
                <Typography sx={{ fontSize: 10, color: '#f44336', fontFamily: 'monospace' }}>
                  {step.error}
                </Typography>
              ) : step.output_summary ? (
                <PipelineStepCard skill={step.skill} output={step.output_summary} theme={theme} />
              ) : null}
            </Box>
          </Collapse>
        </Box>
      ))}
    </Box>
  );
}

/** Parse JSON string, return object or null */
function tryParseJson(text: string): any | null {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

/** Dispatch to the right semantic card based on skill name */
function PipelineStepCard({ skill, output, theme }: { skill: string; output: string; theme: any }) {
  const data = tryParseJson(output);
  if (!data) {
    // Fallback to monospace
    return (
      <Box sx={{ fontSize: 10, fontFamily: 'monospace', color: theme.text.secondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {output}
      </Box>
    );
  }

  switch (skill) {
    case 'analyze_market': return <MarketAnalysisCard data={data} theme={theme} />;
    case 'analyze_macro': return <MacroAnalysisCard data={data} theme={theme} />;
    case 'recall_memory': return <MemoryRecallCard data={data} theme={theme} />;
    case 'make_decision': return <DecisionCard data={data} theme={theme} />;
    default:
      return (
        <Box sx={{ fontSize: 10, fontFamily: 'monospace', color: theme.text.secondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(data, null, 2)}
        </Box>
      );
  }
}

const TREND_COLORS: Record<string, string> = {
  bullish: '#4caf50', bearish: '#f44336', neutral: '#ff9800',
  上涨: '#4caf50', 下跌: '#f44336', 震荡: '#ff9800',
};

const REGIME_COLORS: Record<string, string> = {
  expansionary: '#4caf50', contractionary: '#f44336', neutral: '#ff9800',
  扩张: '#4caf50', 收缩: '#f44336', 中性: '#ff9800',
};

const BIAS_COLORS: Record<string, string> = {
  bullish: '#4caf50', bearish: '#f44336', neutral: '#ff9800',
  偏多: '#4caf50', 偏空: '#f44336', 中性: '#ff9800',
};

function _chipColor(value: string | undefined, map: Record<string, string>): string {
  if (!value) return '#9e9e9e';
  const lower = value.toLowerCase();
  return map[lower] || '#9e9e9e';
}

/* ── analyze_market card ── */
function MarketAnalysisCard({ data, theme }: { data: any; theme: any }) {
  const trend = data.trend || data.market_trend;
  const confidence = data.confidence ?? data.trend_confidence;
  const keyLevels = data.key_levels || [];
  const summary = data.summary || data.market_summary;

  return (
    <Box sx={{ p: 0.8, borderRadius: 1, bgcolor: 'rgba(128,128,128,0.04)', border: '1px solid rgba(128,128,128,0.08)' }}>
      {/* Header: trend + confidence */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
        {trend && (
          <Chip
            label={trend}
            size="small"
            sx={{ fontSize: 10, height: 20, fontWeight: 600, bgcolor: `${_chipColor(trend, TREND_COLORS)}18`, color: _chipColor(trend, TREND_COLORS) }}
          />
        )}
        {confidence != null && (
          <Typography sx={{ fontSize: 10, color: theme.text.muted }}>
            confidence: {typeof confidence === 'number' && confidence <= 1 ? `${(confidence * 100).toFixed(0)}%` : confidence}
          </Typography>
        )}
      </Box>

      {/* Key levels table */}
      {keyLevels.length > 0 && (
        <Box sx={{ mb: 0.8 }}>
          <Typography sx={{ fontSize: 9, color: theme.text.muted, fontWeight: 600, mb: 0.3 }}>Key Levels</Typography>
          {keyLevels.map((level: any, i: number) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.15 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.text.primary, minWidth: 40 }}>
                {level.symbol || level.etf || '—'}
              </Typography>
              {level.support != null && (
                <Typography sx={{ fontSize: 10, color: '#4caf50' }}>
                  S: ${level.support}
                </Typography>
              )}
              {level.resistance != null && (
                <Typography sx={{ fontSize: 10, color: '#f44336' }}>
                  R: ${level.resistance}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Summary */}
      {summary && (
        <Typography sx={{ fontSize: 10, color: theme.text.secondary, lineHeight: 1.5 }}>
          {summary}
        </Typography>
      )}
    </Box>
  );
}

/* ── analyze_macro card ── */
function MacroAnalysisCard({ data, theme }: { data: any; theme: any }) {
  const regime = data.macro_regime || data.regime;
  const inflation = data.inflation_outlook || data.inflation;
  const tailwinds = data.macro_tailwinds || data.tailwinds || [];
  const headwinds = data.macro_headwinds || data.headwinds || [];
  const summary = data.summary || data.macro_summary;

  return (
    <Box sx={{ p: 0.8, borderRadius: 1, bgcolor: 'rgba(128,128,128,0.04)', border: '1px solid rgba(128,128,128,0.08)' }}>
      {/* Header: regime + inflation */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
        {regime && (
          <Chip
            label={regime}
            size="small"
            sx={{ fontSize: 10, height: 20, fontWeight: 600, bgcolor: `${_chipColor(regime, REGIME_COLORS)}18`, color: _chipColor(regime, REGIME_COLORS) }}
          />
        )}
        {inflation && (
          <Typography sx={{ fontSize: 10, color: theme.text.muted }}>
            inflation: {inflation}
          </Typography>
        )}
      </Box>

      {/* Tailwinds */}
      {tailwinds.length > 0 && (
        <Box sx={{ mb: 0.5 }}>
          <Typography sx={{ fontSize: 9, color: '#4caf50', fontWeight: 600, mb: 0.2 }}>Tailwinds</Typography>
          {tailwinds.map((t: string, i: number) => (
            <Typography key={i} sx={{ fontSize: 10, color: theme.text.secondary, pl: 0.5 }}>
              + {t}
            </Typography>
          ))}
        </Box>
      )}

      {/* Headwinds */}
      {headwinds.length > 0 && (
        <Box sx={{ mb: 0.5 }}>
          <Typography sx={{ fontSize: 9, color: '#f44336', fontWeight: 600, mb: 0.2 }}>Headwinds</Typography>
          {headwinds.map((h: string, i: number) => (
            <Typography key={i} sx={{ fontSize: 10, color: theme.text.secondary, pl: 0.5 }}>
              - {h}
            </Typography>
          ))}
        </Box>
      )}

      {/* Summary */}
      {summary && (
        <Typography sx={{ fontSize: 10, color: theme.text.secondary, lineHeight: 1.5, mt: 0.3 }}>
          {summary}
        </Typography>
      )}
    </Box>
  );
}

/* ── recall_memory card ── */
function MemoryRecallCard({ data, theme }: { data: any; theme: any }) {
  const bias = data.memory_informed_bias || data.bias;
  const lessons = data.relevant_lessons || data.lessons || [];
  const reasoning = data.reasoning || data.memory_reasoning;

  return (
    <Box sx={{ p: 0.8, borderRadius: 1, bgcolor: 'rgba(128,128,128,0.04)', border: '1px solid rgba(128,128,128,0.08)' }}>
      {/* Header: bias */}
      {bias && (
        <Box sx={{ mb: 0.8 }}>
          <Chip
            label={bias}
            size="small"
            sx={{ fontSize: 10, height: 20, fontWeight: 600, bgcolor: `${_chipColor(bias, BIAS_COLORS)}18`, color: _chipColor(bias, BIAS_COLORS) }}
          />
        </Box>
      )}

      {/* Lessons */}
      {lessons.length > 0 ? (
        <Box sx={{ mb: 0.5 }}>
          <Typography sx={{ fontSize: 9, color: theme.text.muted, fontWeight: 600, mb: 0.2 }}>Lessons</Typography>
          {lessons.map((l: any, i: number) => (
            <Typography key={i} sx={{ fontSize: 10, color: theme.text.secondary, pl: 0.5, lineHeight: 1.5 }}>
              {typeof l === 'string' ? l : l.lesson || l.content || JSON.stringify(l)}
            </Typography>
          ))}
        </Box>
      ) : (
        <Typography sx={{ fontSize: 10, color: theme.text.muted, mb: 0.5 }}>No prior lessons</Typography>
      )}

      {/* Reasoning */}
      {reasoning && (
        <Typography sx={{ fontSize: 10, color: theme.text.secondary, lineHeight: 1.5, mt: 0.3 }}>
          {reasoning}
        </Typography>
      )}
    </Box>
  );
}

/* ── make_decision card (思考过程 + 风险评估, 分配已在 ModelCard 展示) ── */
function DecisionCard({ data, theme }: { data: any; theme: any }) {
  const chainOfThought = data.chain_of_thought || data.thinking || data['思考过程'];
  const riskAssessment = data.risk_assessment || data.risk || data['风险评估'];
  const invalidation = data.invalidation || data['失效条件'];
  const reasoning = data.reasoning || data['决策理由'];
  const action = data.action || data['操作'];
  const confidence = data.confidence ?? data['信心度'];

  return (
    <Box sx={{ p: 0.8, borderRadius: 1, bgcolor: 'rgba(128,128,128,0.04)', border: '1px solid rgba(128,128,128,0.08)' }}>
      {/* Action + confidence header */}
      {(action || confidence != null) && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
          {action && (
            <Chip
              label={action}
              size="small"
              sx={{
                fontSize: 10, height: 20, fontWeight: 600,
                bgcolor: (action.toUpperCase().includes('BUY') || action.includes('买')) ? 'rgba(76,175,80,0.15)' : action.toUpperCase().includes('SELL') || action.includes('卖') ? 'rgba(244,67,54,0.15)' : 'rgba(255,152,0,0.15)',
                color: (action.toUpperCase().includes('BUY') || action.includes('买')) ? '#4caf50' : action.toUpperCase().includes('SELL') || action.includes('卖') ? '#f44336' : '#ff9800',
              }}
            />
          )}
          {confidence != null && (
            <Typography sx={{ fontSize: 10, color: theme.text.muted }}>
              confidence: {typeof confidence === 'number' && confidence <= 1 ? `${(confidence * 100).toFixed(0)}%` : confidence}
            </Typography>
          )}
        </Box>
      )}

      {/* Chain of thought */}
      {chainOfThought && (
        <Box sx={{ mb: 0.5 }}>
          <Typography sx={{ fontSize: 9, color: theme.text.muted, fontWeight: 600, mb: 0.2 }}>Chain of Thought</Typography>
          <Typography sx={{ fontSize: 10, color: theme.text.secondary, lineHeight: 1.5 }}>
            {chainOfThought}
          </Typography>
        </Box>
      )}

      {/* Reasoning */}
      {reasoning && !chainOfThought && (
        <Box sx={{ mb: 0.5 }}>
          <Typography sx={{ fontSize: 9, color: theme.text.muted, fontWeight: 600, mb: 0.2 }}>Reasoning</Typography>
          <Typography sx={{ fontSize: 10, color: theme.text.secondary, lineHeight: 1.5 }}>
            {reasoning}
          </Typography>
        </Box>
      )}

      {/* Risk assessment */}
      {riskAssessment && (
        <Box sx={{ mb: 0.5 }}>
          <Typography sx={{ fontSize: 9, color: '#ff9800', fontWeight: 600, mb: 0.2 }}>Risk Assessment</Typography>
          <Typography sx={{ fontSize: 10, color: theme.text.secondary, lineHeight: 1.5 }}>
            {riskAssessment}
          </Typography>
        </Box>
      )}

      {/* Invalidation */}
      {invalidation && (
        <Box>
          <Typography sx={{ fontSize: 9, color: '#f44336', fontWeight: 600, mb: 0.2 }}>Invalidation</Typography>
          <Typography sx={{ fontSize: 10, color: theme.text.secondary, lineHeight: 1.5 }}>
            {invalidation}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

/* ── JSON Syntax Highlighter ── */
function JsonView({ data, theme, collapsed = false }: { data: any; theme: any; collapsed?: boolean }) {
  const [isCollapsed, setIsCollapsed] = useState(collapsed);

  if (data === null || data === undefined) {
    return <span style={{ color: '#9e9e9e' }}>null</span>;
  }

  if (typeof data === 'string') {
    return <span style={{ color: '#4caf50' }}>"{data.length > 200 ? data.slice(0, 200) + '...' : data}"</span>;
  }

  if (typeof data === 'number') {
    return <span style={{ color: '#ff9800' }}>{data}</span>;
  }

  if (typeof data === 'boolean') {
    return <span style={{ color: '#ab47bc' }}>{String(data)}</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span>[]</span>;
    if (isCollapsed) {
      return (
        <span style={{ cursor: 'pointer', color: theme.text.muted }} onClick={() => setIsCollapsed(false)}>
          [{data.length} items...]
        </span>
      );
    }
    return (
      <span>
        <span style={{ cursor: 'pointer', color: theme.text.muted }} onClick={() => setIsCollapsed(true)}>[</span>
        {data.map((item, i) => (
          <Box key={i} sx={{ pl: 2 }}>
            <JsonView data={item} theme={theme} collapsed />
            {i < data.length - 1 && ','}
          </Box>
        ))}
        <span>]</span>
      </span>
    );
  }

  if (typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length === 0) return <span>{'{}'}</span>;
    if (isCollapsed) {
      return (
        <span style={{ cursor: 'pointer', color: theme.text.muted }} onClick={() => setIsCollapsed(false)}>
          {'{'}{keys.length} keys...{'}'}
        </span>
      );
    }
    return (
      <span>
        <span style={{ cursor: 'pointer', color: theme.text.muted }} onClick={() => setIsCollapsed(true)}>{'{'}</span>
        {keys.map((key, i) => (
          <Box key={key} sx={{ pl: 2 }}>
            <span style={{ color: '#42a5f5' }}>"{key}"</span>
            <span style={{ color: theme.text.muted }}>: </span>
            <JsonView data={data[key]} theme={theme} collapsed={typeof data[key] === 'object' && data[key] !== null} />
            {i < keys.length - 1 && ','}
          </Box>
        ))}
        <span>{'}'}</span>
      </span>
    );
  }

  return <span>{String(data)}</span>;
}

/* ── Structured Output Card ── */
function StructuredOutputCard({ data, theme }: { data: Record<string, any>; theme: any }) {
  const [showJson, setShowJson] = useState(false);

  if (!data || Object.keys(data).length === 0) return null;

  const action = data.action || data['操作'];
  const allocations = data.allocations || data['分配'] || [];
  const confidence = data.confidence ?? data['信心度'];
  const reasoning = data.reasoning || data['决策理由'];
  const chainOfThought = data.chain_of_thought || data['思考过程'];
  const riskAssessment = data.risk_assessment || data['风险评估'];
  const invalidation = data.invalidation || data['失效条件'];

  const actionColor = (a: string) => {
    const upper = (a || '').toUpperCase();
    if (['BUY', 'ALLOCATE', '买入'].some(x => upper.includes(x))) return '#4caf50';
    if (['SELL', '卖出'].some(x => upper.includes(x))) return '#f44336';
    return '#ff9800';
  };

  return (
    <Box sx={{ mb: 1 }}>
      {/* Action + Confidence header */}
      {(action || confidence != null) && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
          {action && (
            <Chip
              label={action}
              size="small"
              sx={{ fontWeight: 700, fontSize: 11, height: 22, bgcolor: `${actionColor(action)}18`, color: actionColor(action) }}
            />
          )}
          {confidence != null && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography sx={{ fontSize: 10, color: theme.text.muted }}>信心度</Typography>
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.primary }}>
                {typeof confidence === 'number' ? `${(confidence * 100).toFixed(0)}%` : confidence}
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Allocations table */}
      {allocations.length > 0 && (
        <Box sx={{
          mb: 0.8, p: 0.8, borderRadius: 1,
          bgcolor: 'rgba(128,128,128,0.04)',
          border: `1px solid rgba(128,128,128,0.08)`,
        }}>
          <Typography sx={{ fontSize: 10, color: theme.text.muted, mb: 0.5, fontWeight: 600 }}>分配方案</Typography>
          {allocations.map((alloc: any, i: number) => (
            <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.25 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.primary }}>
                  {alloc.etf || alloc.symbol || alloc['标的']}
                </Typography>
                {(alloc.reason || alloc['理由']) && (
                  <Typography sx={{ fontSize: 10, color: theme.text.muted, maxWidth: 180 }} noWrap>
                    {alloc.reason || alloc['理由']}
                  </Typography>
                )}
              </Box>
              <Typography sx={{ fontSize: 11, color: theme.text.secondary, fontFeatureSettings: '"tnum"' }}>
                ${(alloc.amount || alloc['金额'] || 0).toLocaleString()} ({alloc.percentage || alloc['比例'] || 0}%)
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* Reasoning */}
      {reasoning && (
        <Box sx={{ mb: 0.8 }}>
          <Typography sx={{ fontSize: 10, color: theme.text.muted, fontWeight: 600, mb: 0.3 }}>决策理由</Typography>
          <Typography sx={{ fontSize: 11, color: theme.text.secondary, lineHeight: 1.6 }}>
            {reasoning}
          </Typography>
        </Box>
      )}

      {/* Risk assessment */}
      {riskAssessment && (
        <Box sx={{ mb: 0.8 }}>
          <Typography sx={{ fontSize: 10, color: theme.text.muted, fontWeight: 600, mb: 0.3 }}>风险评估</Typography>
          <Typography sx={{ fontSize: 11, color: theme.text.secondary, lineHeight: 1.6 }}>
            {riskAssessment}
          </Typography>
        </Box>
      )}

      {/* Chain of thought — collapsible */}
      {chainOfThought && (
        <Box sx={{ mb: 0.8 }}>
          <Typography sx={{ fontSize: 10, color: theme.text.muted, fontWeight: 600, mb: 0.3 }}>思考过程</Typography>
          <Typography sx={{ fontSize: 11, color: theme.text.muted, lineHeight: 1.5 }}>
            {chainOfThought}
          </Typography>
        </Box>
      )}

      {/* Invalidation */}
      {invalidation && (
        <Box sx={{ mb: 0.8 }}>
          <Typography sx={{ fontSize: 10, color: theme.text.muted, fontWeight: 600, mb: 0.3 }}>失效条件</Typography>
          <Typography sx={{ fontSize: 11, color: '#ff9800', lineHeight: 1.5 }}>
            {invalidation}
          </Typography>
        </Box>
      )}

      {/* Toggle JSON view */}
      <Button
        size="small"
        onClick={() => setShowJson(!showJson)}
        sx={{ color: theme.text.muted, textTransform: 'none', fontSize: 10, py: 0, minHeight: 20 }}
      >
        {showJson ? '隐藏 JSON' : '查看 JSON'}
      </Button>
      <Collapse in={showJson}>
        <Box sx={{ fontSize: 11, fontFamily: 'monospace', lineHeight: 1.5, mt: 0.5 }}>
          <JsonView data={data} theme={theme} />
        </Box>
      </Collapse>
    </Box>
  );
}

/* ── Raw Output Section (collapsible) ── */
function RawOutputSection({ raw, theme }: { raw: string; theme: any }) {
  const [show, setShow] = useState(false);

  return (
    <Box>
      <Button
        size="small"
        onClick={() => setShow(!show)}
        sx={{ color: theme.text.muted, textTransform: 'none', fontSize: 10, py: 0, minHeight: 20 }}
      >
        {show ? '隐藏原始输出' : '查看原始输出'}
      </Button>
      <Collapse in={show}>
        <pre style={{
          margin: 0, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontSize: 10, lineHeight: 1.5, color: theme.text.muted,
          maxHeight: 200, overflow: 'auto',
        }}>
          {raw}
        </pre>
      </Collapse>
    </Box>
  );
}

/* ── Voting Details (inside expanded model card) ── */
function VotingDetails({
  modelId,
  votes,
  allModels,
  theme,
  isDark,
}: {
  modelId: string;
  votes: ArenaVote[];
  allModels: ModelIOSummary[];
  theme: any;
  isDark: boolean;
}) {
  const modelMap = new Map(allModels.map(m => [m.id, m]));

  // Votes where this model is the TARGET (received votes)
  const receivedVotes = votes.filter(v => v.target_model_io_id === modelId);
  // Votes where this model is the VOTER (cast votes)
  const castVotes = votes.filter(v => v.voter_model_io_id === modelId);

  if (receivedVotes.length === 0 && castVotes.length === 0) return null;

  const renderVoteRow = (vote: ArenaVote, resolveId: string) => {
    const resolved = modelMap.get(resolveId);
    const isApprove = vote.vote_type === 'approve';
    return (
      <Box key={vote.id} sx={{ mb: 1, pl: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 0.3 }}>
          {resolved && <ModelLogo provider={resolved.model_provider} size={14} isDark={isDark} />}
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.text.primary }}>
            {resolved?.model_name || resolveId.slice(0, 8)}
          </Typography>
          <Chip
            label={vote.vote_type}
            size="small"
            sx={{
              fontSize: 9, height: 16, fontWeight: 600,
              bgcolor: isApprove ? 'rgba(76,175,80,0.12)' : 'rgba(244,67,54,0.12)',
              color: isApprove ? '#4caf50' : '#f44336',
            }}
          />
        </Box>
        {vote.reasoning && (
          <Typography sx={{
            fontSize: 10, color: theme.text.muted, lineHeight: 1.5,
            pl: 2.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {vote.reasoning}
          </Typography>
        )}
      </Box>
    );
  };

  return (
    <Box sx={{ mb: 1 }}>
      {/* Received votes */}
      {receivedVotes.length > 0 && (
        <Box sx={{ mb: 1 }}>
          <Typography sx={{ fontSize: 10, color: theme.text.muted, fontWeight: 600, mb: 0.5 }}>
            Received Votes ({receivedVotes.filter(v => v.vote_type === 'approve').length} approve / {receivedVotes.filter(v => v.vote_type === 'reject').length} reject)
          </Typography>
          {receivedVotes.map(v => renderVoteRow(v, v.voter_model_io_id))}
        </Box>
      )}

      {/* Cast votes */}
      {castVotes.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 10, color: theme.text.muted, fontWeight: 600, mb: 0.5 }}>
            Cast Votes
          </Typography>
          {castVotes.map(v => renderVoteRow(v, v.target_model_io_id))}
        </Box>
      )}
    </Box>
  );
}

/* ── Result Model Card ── */
function ModelCard({
  model,
  harnessId,
  theme,
  isDark,
  voteSummary,
  isWinner,
  votes,
  allModels,
}: {
  model: ModelIOSummary;
  harnessId: string;
  theme: any;
  isDark: boolean;
  voteSummary?: { approve: number; reject: number; net: number };
  isWinner?: boolean;
  votes?: ArenaVote[];
  allModels?: ModelIOSummary[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ModelIODetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [showPipeline, setShowPipeline] = useState(false);

  const isError = model.status === 'error' || model.status === 'timeout';
  const structured = model.output_structured || {};
  const pipelineSteps = model.pipeline_steps;

  const handleExpand = async () => {
    if (!expanded && !detail) {
      setDetailLoading(true);
      try {
        const res = await fetchModelIODetail(harnessId, model.id);
        if (res.success && res.data) setDetail(res.data);
      } catch { /* ignore */ }
      finally { setDetailLoading(false); }
    }
    setExpanded(!expanded);
  };

  const handleAdopt = async () => {
    setAdopting(true);
    try {
      const res = await adoptModel(harnessId, model.id);
      if (res.success) {
        toast.success(`Adopted ${model.model_name}`);
      } else {
        toast.error(res.error || 'Adopt failed');
      }
    } catch (e: any) {
      toast.error(e.message || 'Adopt failed');
    } finally {
      setAdopting(false);
    }
  };

  const statusColor = isError ? '#f44336' : model.parse_status === 'structured' ? '#4caf50' : '#ff9800';
  const statusBg = isError ? 'rgba(244,67,54,0.12)' : model.parse_status === 'structured' ? 'rgba(76,175,80,0.12)' : 'rgba(255,152,0,0.12)';
  const statusLabel = isError ? (model.status === 'timeout' ? 'timeout' : 'error') : model.parse_status || 'ok';

  return (
    <Box
      sx={{
        borderBottom: `1px solid ${isError ? 'rgba(244,67,54,0.3)' : theme.border.subtle}`,
        opacity: isError ? 0.75 : 1,
        pb: 0.5,
      }}
    >
      {/* Header + Actions — fixed layout, actions always at same position */}
      <Box sx={{ py: 0.8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ModelLogo provider={model.model_provider} size={18} isDark={isDark} />
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.primary }}>
            {model.model_name}
          </Typography>
          {isWinner && (
            <Chip
              label="Winner"
              size="small"
              sx={{ fontSize: 9, height: 18, fontWeight: 700, bgcolor: 'rgba(76,175,80,0.15)', color: '#4caf50' }}
            />
          )}
          {structured.action && (
            <Chip
              label={structured.action}
              size="small"
              sx={{
                fontWeight: 600,
                fontSize: 10,
                height: 18,
                bgcolor: structured.action === 'BUY' ? 'rgba(76,175,80,0.15)' : structured.action === 'SELL' ? 'rgba(244,67,54,0.15)' : 'rgba(255,152,0,0.15)',
                color: structured.action === 'BUY' ? '#4caf50' : structured.action === 'SELL' ? '#f44336' : '#ff9800',
              }}
            />
          )}
          <Chip
            icon={isError ? <AlertCircle size={12} /> : undefined}
            label={statusLabel}
            size="small"
            sx={{ fontSize: 9, height: 18, bgcolor: statusBg, color: statusColor }}
          />
          {voteSummary && (
            <Typography sx={{ fontSize: 10, color: theme.text.muted }}>
              +{voteSummary.approve}/-{voteSummary.reject}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          <Button
            size="small"
            onClick={handleExpand}
            endIcon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            sx={{ color: theme.text.muted, textTransform: 'none', fontSize: 11, borderRadius: 1, py: 0.2, minHeight: 24, minWidth: 80 }}
          >
            {expanded ? 'Collapse' : 'Details'}
          </Button>
          <Button
            size="small"
            onClick={() => setShowPipeline(!showPipeline)}
            sx={{
              color: theme.text.muted, textTransform: 'none', fontSize: 11, borderRadius: 1, py: 0.2, minHeight: 24,
              visibility: pipelineSteps && pipelineSteps.length > 0 ? 'visible' : 'hidden',
            }}
          >
            Pipeline
          </Button>
          <Button
            size="small"
            startIcon={<CheckCircle size={14} />}
            onClick={handleAdopt}
            disabled={adopting || isError}
            sx={{
              color: isError ? theme.text.muted : theme.brand.primary,
              textTransform: 'none',
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 1,
              py: 0.2,
              minHeight: 24,
              visibility: isError ? 'hidden' : 'visible',
            }}
          >
            {adopting ? '...' : 'Adopt'}
          </Button>
        </Box>
      </Box>

      {/* Error message */}
      {isError && model.error_message && (
        <Box sx={{ pb: 0.5 }}>
          <Typography sx={{ fontSize: 11, color: '#f44336', lineHeight: 1.4 }}>
            {model.error_message.length > 80 ? model.error_message.slice(0, 80) + '...' : model.error_message}
          </Typography>
        </Box>
      )}

      {/* Allocations — structured table or raw extraction */}
      {!isError && (
        <Box sx={{ pb: 0.5 }}>
          {structured.allocations?.map((alloc: any, i: number) => (
            <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.15 }}>
              <Typography sx={{ fontSize: 11, color: theme.text.primary }}>
                {alloc.etf || alloc.symbol}
              </Typography>
              <Typography sx={{ fontSize: 11, color: theme.text.secondary }}>
                ${alloc.amount?.toLocaleString()} ({alloc.percentage}%)
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* Metrics */}
      <Box sx={{ pb: 0.5, display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        {model.latency_ms != null && model.latency_ms > 0 && (
          <Typography sx={{ fontSize: 10, color: theme.text.muted }}>
            {(model.latency_ms / 1000).toFixed(1)}s
          </Typography>
        )}
        {model.cost_usd != null && model.cost_usd > 0 && (
          <Typography sx={{ fontSize: 10, color: theme.text.muted }}>
            ${model.cost_usd.toFixed(4)}
          </Typography>
        )}
        {model.output_token_count != null && model.output_token_count > 0 && (
          <Typography sx={{ fontSize: 10, color: theme.text.muted }}>
            {model.output_token_count} tok
          </Typography>
        )}
        {structured.confidence != null && (
          <Typography sx={{ fontSize: 10, color: theme.text.muted }}>
            {(structured.confidence * 100).toFixed(0)}%
          </Typography>
        )}
      </Box>

      {/* Pipeline Steps */}
      {pipelineSteps && pipelineSteps.length > 0 && (
        <Collapse in={showPipeline}>
          <PipelineSteps steps={pipelineSteps} theme={theme} />
        </Collapse>
      )}

      {/* Detail */}
      <Collapse in={expanded}>
        <Box sx={{ py: 1, maxHeight: 400, overflow: 'auto' }}>
          {detailLoading ? (
            <LoadingDots text="Loading" fontSize={12} />
          ) : detail ? (
            <Box sx={{ color: theme.text.secondary }}>
              {detail.error_message && (
                <Box sx={{ mb: 1.5, p: 1, bgcolor: 'rgba(244,67,54,0.06)', borderRadius: 1 }}>
                  <Typography sx={{ fontSize: 11, color: '#f44336', fontWeight: 600, mb: 0.3 }}>
                    Error
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: '#f44336', lineHeight: 1.4 }}>
                    {detail.error_message}
                  </Typography>
                </Box>
              )}

              {/* Structured output — card style */}
              <StructuredOutputCard
                data={detail.output_structured || structured}
                theme={theme}
              />

              {/* Voting details */}
              {votes && votes.length > 0 && allModels && (
                <VotingDetails
                  modelId={model.id}
                  votes={votes}
                  allModels={allModels}
                  theme={theme}
                  isDark={isDark}
                />
              )}

              {/* Raw output — collapsible */}
              {detail.output_raw && (
                <RawOutputSection raw={detail.output_raw} theme={theme} />
              )}

              {!detail.output_raw && !detail.error_message && !structured.reasoning && !detail.output_structured && (
                <Typography sx={{ fontSize: 12, color: theme.text.muted }}>No details available</Typography>
              )}
            </Box>
          ) : (
            <Typography sx={{ fontSize: 12, color: theme.text.muted }}>No details available</Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
