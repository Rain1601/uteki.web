import { Box, Typography, IconButton } from '@mui/material';
import { X, Loader2 } from 'lucide-react';
import { useTheme } from '../../theme/ThemeProvider';
import type { CompanyAnalysisSummary } from '../../api/company';
import type { GateStatus } from './GateProgressTracker';

const ACTION_COLORS: Record<string, string> = {
  BUY: '#4caf50',
  WATCH: '#ff9800',
  AVOID: '#f44336',
};

const QUALITY_LABELS: Record<string, string> = {
  EXCELLENT: 'EX',
  GOOD: 'GD',
  MEDIOCRE: 'MD',
  POOR: 'PR',
};

interface RunningInfo {
  symbol: string;
  provider: string;
  currentGate: number | null;
  gateStatuses: Record<number, GateStatus>;
}

interface Props {
  record?: CompanyAnalysisSummary;
  running?: RunningInfo;
  selected?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
}

export default function AnalysisRecordCard({ record, running, selected, onClick, onDelete }: Props) {
  const { theme } = useTheme();
  const isRunning = !!running;

  const symbol = record?.symbol || running?.symbol || '';
  const provider = record?.provider || running?.provider || '';
  const actionColor = record ? (ACTION_COLORS[record.verdict_action] || theme.text.muted) : theme.brand.primary;

  const completedGates = running
    ? Object.values(running.gateStatuses).filter((s) => s === 'complete' || s === 'error' || s === 'timeout').length
    : 0;

  const formatTime = (ms: number) => {
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 3600_000) return `${Math.round(diff / 60000)}m ago`;
    if (diff < 86400_000) return `${Math.round(diff / 3600_000)}h ago`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  return (
    <Box
      onClick={onClick}
      sx={{
        position: 'relative',
        minWidth: 120,
        maxWidth: 140,
        px: 1.5,
        py: 1.25,
        borderRadius: 2,
        bgcolor: selected ? `${theme.brand.primary}18` : theme.background.tertiary,
        border: `1.5px solid ${selected ? theme.brand.primary : theme.border.subtle}`,
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'all 0.15s',
        '&:hover': {
          borderColor: theme.brand.primary,
          bgcolor: `${theme.brand.primary}10`,
          '& .delete-btn': { opacity: 1 },
        },
      }}
    >
      {/* Delete button */}
      {record && onDelete && (
        <IconButton
          className="delete-btn"
          size="small"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          sx={{
            position: 'absolute',
            top: 2,
            right: 2,
            opacity: 0,
            p: 0.25,
            color: theme.text.muted,
            '&:hover': { color: theme.status.error },
          }}
        >
          <X size={12} />
        </IconButton>
      )}

      {/* Symbol */}
      <Typography sx={{ fontSize: 13, fontWeight: 700, color: theme.text.primary, lineHeight: 1.2 }}>
        {symbol}
      </Typography>

      {/* Provider */}
      <Typography sx={{ fontSize: 10, color: theme.text.muted, mt: 0.25 }}>
        {provider}
      </Typography>

      {/* Running state or verdict */}
      {isRunning ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.75 }}>
          <Loader2 size={12} color={theme.brand.primary} style={{ animation: 'spin 1s linear infinite' }} />
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.brand.primary }}>
            G{running.currentGate || completedGates + 1}/7
          </Typography>
        </Box>
      ) : record ? (
        record.status === 'running' ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.75 }}>
            <Loader2 size={12} color={theme.brand.primary} style={{ animation: 'spin 1s linear infinite' }} />
            <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.brand.primary }}>
              分析中...
            </Typography>
          </Box>
        ) : (
          <>
            {/* Verdict badge */}
            <Box
              sx={{
                display: 'inline-block',
                mt: 0.75,
                px: 1,
                py: 0.15,
                borderRadius: 1,
                bgcolor: `${actionColor}20`,
                color: actionColor,
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1.4,
              }}
            >
              {record.verdict_action}
              {record.verdict_quality && (
                <Typography component="span" sx={{ fontSize: 9, ml: 0.5, opacity: 0.7 }}>
                  {QUALITY_LABELS[record.verdict_quality] || ''}
                </Typography>
              )}
            </Box>

            {/* Meta line */}
            <Typography sx={{ fontSize: 9, color: theme.text.disabled, mt: 0.5 }}>
              {formatTime(record.total_latency_ms)} · {formatDate(record.created_at)}
            </Typography>
          </>
        )
      ) : null}
    </Box>
  );
}
