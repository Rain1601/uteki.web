import { useState, useEffect } from 'react';
import { Drawer, Box, Typography, CircularProgress } from '@mui/material';
import { X, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../theme/ThemeProvider';
import { getQualityDashboard, GATE_NAMES } from '../../api/company';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface GateQuality {
  gate: number;
  accuracy: number;
  depth: number;
  consistency: number;
}

interface DashboardData {
  gate_scores: GateQuality[];
  weakest_gate: number | null;
  weakest_dimension: string | null;
  recent_evaluations: Array<{
    id: string;
    symbol: string;
    model: string;
    overall_score: number;
    created_at: string;
  }>;
}

const DIMENSIONS = ['accuracy', 'depth', 'consistency'] as const;
const DIM_LABELS: Record<string, string> = {
  accuracy: '准确性',
  depth: '深度',
  consistency: '一致性',
};

function scoreColor(value: number): string {
  if (value < 5) return '#f44336';
  if (value <= 7) return '#ff9800';
  return '#4caf50';
}

function scoreBgColor(value: number): string {
  if (value < 5) return 'rgba(244,67,54,0.12)';
  if (value <= 7) return 'rgba(255,152,0,0.12)';
  return 'rgba(76,175,80,0.12)';
}

export default function QualityDashboard({ open, onClose }: Props) {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const result = await getQualityDashboard();
        setData(result);
      } catch {
        setError('无法加载质量数据');
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const hasData = data?.gate_scores && data.gate_scores.length > 0;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: 520,
          bgcolor: theme.background.primary,
          color: theme.text.primary,
          borderLeft: `1px solid ${theme.border.subtle}`,
        },
      }}
    >
      {/* Header */}
      <Box sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${theme.border.subtle}` }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700 }}>Gate 质量面板</Typography>
        <Box onClick={onClose} sx={{ cursor: 'pointer', p: 0.5, borderRadius: 1, color: theme.text.disabled, '&:hover': { bgcolor: theme.background.hover, color: theme.text.secondary } }}>
          <X size={16} />
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', px: 2.5, py: 2 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : error || !hasData ? (
          /* Placeholder when no data */
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <AlertTriangle size={32} color={theme.text.disabled} style={{ marginBottom: 12 }} />
            <Typography sx={{ fontSize: 13, color: theme.text.muted, mb: 0.5 }}>
              {error || '暂无质量评估数据'}
            </Typography>
            <Typography sx={{ fontSize: 11, color: theme.text.disabled }}>
              运行 Judge 评估后数据将显示在此
            </Typography>
          </Box>
        ) : (
          <>
            {/* Weakest gate callout */}
            {data.weakest_gate != null && (
              <Box sx={{
                mb: 2.5, px: 1.5, py: 1.25, borderRadius: 1,
                bgcolor: 'rgba(244,67,54,0.06)',
                border: '1px solid rgba(244,67,54,0.15)',
                display: 'flex', alignItems: 'center', gap: 1,
              }}>
                <AlertTriangle size={14} color="#f44336" />
                <Typography sx={{ fontSize: 12, color: '#f44336', fontWeight: 600 }}>
                  最弱环节: G{data.weakest_gate} {GATE_NAMES[data.weakest_gate] || ''}
                  {data.weakest_dimension ? ` (${DIM_LABELS[data.weakest_dimension] || data.weakest_dimension})` : ''}
                </Typography>
              </Box>
            )}

            {/* Heatmap */}
            <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.text.disabled, mb: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              质量热力图
            </Typography>

            <Box sx={{ mb: 3 }}>
              {/* Header row */}
              <Box sx={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr', gap: 0.5, mb: 0.5 }}>
                <Box />
                {DIMENSIONS.map((dim) => (
                  <Typography key={dim} sx={{ fontSize: 10, fontWeight: 600, color: theme.text.disabled, textAlign: 'center' }}>
                    {DIM_LABELS[dim]}
                  </Typography>
                ))}
              </Box>

              {/* Data rows */}
              {data.gate_scores.map((gs) => (
                <Box key={gs.gate} sx={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr', gap: 0.5, mb: 0.5 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.text.secondary, lineHeight: '36px' }}>
                    G{gs.gate} {GATE_NAMES[gs.gate] || ''}
                  </Typography>
                  {DIMENSIONS.map((dim) => {
                    const val = gs[dim];
                    return (
                      <Box
                        key={dim}
                        sx={{
                          height: 36,
                          borderRadius: 1,
                          bgcolor: scoreBgColor(val),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'transform 0.1s',
                          '&:hover': { transform: 'scale(1.05)' },
                        }}
                      >
                        <Typography sx={{ fontSize: 14, fontWeight: 700, color: scoreColor(val), fontFamily: "'SF Mono', Monaco, monospace" }}>
                          {val.toFixed(1)}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              ))}
            </Box>

            {/* Recent evaluations */}
            {data.recent_evaluations && data.recent_evaluations.length > 0 && (
              <>
                <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.text.disabled, mb: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  近期评估 ({data.recent_evaluations.length})
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {data.recent_evaluations.map((ev) => (
                    <Box
                      key={ev.id}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 1,
                        px: 1.5, py: 1, borderRadius: 1,
                        bgcolor: theme.background.secondary,
                        border: `1px solid ${theme.border.subtle}`,
                      }}
                    >
                      <Typography sx={{ fontSize: 12, fontWeight: 700, color: theme.text.primary, width: 56 }}>
                        {ev.symbol}
                      </Typography>
                      <Typography sx={{ fontSize: 11, color: theme.text.muted, flex: 1 }}>
                        {ev.model}
                      </Typography>
                      <Typography sx={{
                        fontSize: 13, fontWeight: 700,
                        color: scoreColor(ev.overall_score),
                        fontFamily: "'SF Mono', Monaco, monospace",
                      }}>
                        {ev.overall_score.toFixed(1)}
                      </Typography>
                      <Typography sx={{ fontSize: 10, color: theme.text.disabled }}>
                        {new Date(ev.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </>
            )}
          </>
        )}
      </Box>
    </Drawer>
  );
}
