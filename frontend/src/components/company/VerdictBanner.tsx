import { Box, Typography } from '@mui/material';
import { useTheme } from '../../theme/ThemeProvider';
import { StatGrid } from './ui';
import type { PositionHoldingOutput } from '../../api/company';

interface Props {
  verdict: PositionHoldingOutput;
  companyName: string;
}

const ACTION_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  BUY:   { label: 'BUY',   color: '#4caf50', bg: 'rgba(76, 175, 80, 0.12)' },
  WATCH: { label: 'WATCH', color: '#ff9800', bg: 'rgba(255, 152, 0, 0.12)' },
  AVOID: { label: 'AVOID', color: '#f44336', bg: 'rgba(244, 67, 54, 0.12)' },
};

const QUALITY_COLORS: Record<string, string> = {
  EXCELLENT: '#4caf50',
  GOOD: '#ff9800',
  MEDIOCRE: '#f57c00',
  POOR: '#f44336',
};

export default function VerdictBanner({ verdict, companyName }: Props) {
  const { theme } = useTheme();
  const config = ACTION_CONFIG[verdict.action] || ACTION_CONFIG.WATCH;
  const qualityColor = QUALITY_COLORS[verdict.quality_verdict] || theme.text.muted;

  const statItems = [
    { label: 'Quality', value: verdict.quality_verdict, color: qualityColor },
    { label: 'Conviction', value: `${Math.round(verdict.conviction * 100)}%` },
    ...(verdict.position_size_pct > 0
      ? [{ label: 'Position', value: `${verdict.position_size_pct}%`, color: config.color }]
      : []),
    { label: 'Horizon', value: verdict.hold_horizon },
  ];

  return (
    <Box
      sx={{
        bgcolor: config.bg,
        border: `1px solid ${config.color}30`,
        borderRadius: 2,
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5,
      }}
    >
      {/* Row 1: Action badge + company name */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box
          sx={{
            px: 2.5,
            py: 1,
            borderRadius: 1.5,
            bgcolor: config.color,
            color: '#fff',
            fontWeight: 800,
            fontSize: 22,
            letterSpacing: 2,
            lineHeight: 1,
          }}
        >
          {config.label}
        </Box>
        <Typography sx={{ fontSize: 16, fontWeight: 600, color: theme.text.primary }}>
          {companyName}
        </Typography>
      </Box>

      {/* Row 2: One sentence description */}
      {verdict.one_sentence && (
        <Typography sx={{ fontSize: 14, fontWeight: 500, color: theme.text.secondary, lineHeight: 1.6 }}>
          {verdict.one_sentence}
        </Typography>
      )}

      {/* Row 3: StatGrid metrics */}
      <StatGrid items={statItems} />
    </Box>
  );
}
