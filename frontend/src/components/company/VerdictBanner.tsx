import { Box, Typography } from '@mui/material';
import { useTheme } from '../../theme/ThemeProvider';
import type { PositionHoldingOutput } from '../../api/company';

interface Props {
  verdict: PositionHoldingOutput;
  companyName: string;
}

const ACTION_CONFIG = {
  BUY:   { label: 'BUY',   color: '#4caf50', bg: 'rgba(76, 175, 80, 0.12)', emoji: '' },
  WATCH: { label: 'WATCH', color: '#ff9800', bg: 'rgba(255, 152, 0, 0.12)', emoji: '' },
  AVOID: { label: 'AVOID', color: '#f44336', bg: 'rgba(244, 67, 54, 0.12)', emoji: '' },
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

  return (
    <Box
      sx={{
        bgcolor: config.bg,
        border: `1px solid ${config.color}30`,
        borderRadius: 2,
        p: 2.5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 2,
      }}
    >
      {/* Left: Action + company */}
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
        <Box>
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: theme.text.primary }}>
            {companyName}
          </Typography>
          <Typography sx={{ fontSize: 13, color: theme.text.muted, mt: 0.25 }}>
            {verdict.one_sentence}
          </Typography>
        </Box>
      </Box>

      {/* Right: Scores */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
        {/* Quality badge */}
        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontSize: 10, color: theme.text.muted, textTransform: 'uppercase' }}>
            Quality
          </Typography>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: qualityColor }}>
            {verdict.quality_verdict}
          </Typography>
        </Box>

        {/* Conviction */}
        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontSize: 10, color: theme.text.muted, textTransform: 'uppercase' }}>
            Conviction
          </Typography>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: theme.text.primary }}>
            {Math.round(verdict.conviction * 100)}%
          </Typography>
        </Box>

        {/* Position */}
        {verdict.position_size_pct > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ fontSize: 10, color: theme.text.muted, textTransform: 'uppercase' }}>
              Position
            </Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 700, color: config.color }}>
              {verdict.position_size_pct}%
            </Typography>
          </Box>
        )}

        {/* Horizon */}
        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontSize: 10, color: theme.text.muted, textTransform: 'uppercase' }}>
            Horizon
          </Typography>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: theme.text.secondary }}>
            {verdict.hold_horizon}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
