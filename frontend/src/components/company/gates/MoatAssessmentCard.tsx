import { Box, Typography, Chip, LinearProgress } from '@mui/material';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useTheme } from '../../../theme/ThemeProvider';

interface Props {
  data: Record<string, any>;
}

const WIDTH_CONFIG: Record<string, { label: string; color: string; pct: number }> = {
  wide:   { label: 'Wide',   color: '#4caf50', pct: 90 },
  narrow: { label: 'Narrow', color: '#ff9800', pct: 50 },
  none:   { label: 'None',   color: '#f44336', pct: 10 },
};

const STRENGTH_COLORS: Record<string, string> = {
  strong: '#4caf50',
  moderate: '#ff9800',
  weak: '#f44336',
};

const TREND_ICONS: Record<string, React.ReactNode> = {
  strengthening: <TrendingUp size={14} />,
  stable: <Minus size={14} />,
  eroding: <TrendingDown size={14} />,
};

const TREND_COLORS: Record<string, string> = {
  strengthening: '#4caf50',
  stable: '#ff9800',
  eroding: '#f44336',
};

export default function MoatAssessmentCard({ data }: Props) {
  const { theme } = useTheme();
  const widthCfg = WIDTH_CONFIG[data.moat_width] || WIDTH_CONFIG.narrow;
  const trendColor = TREND_COLORS[data.moat_trend] || theme.text.muted;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Top: width gauge + trend + durability */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
        {/* Width gauge */}
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.muted }}>
              Moat Width
            </Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: widthCfg.color }}>
              {widthCfg.label}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={widthCfg.pct}
            sx={{
              height: 8,
              borderRadius: 4,
              bgcolor: theme.background.secondary,
              '& .MuiLinearProgress-bar': { bgcolor: widthCfg.color, borderRadius: 4 },
            }}
          />
        </Box>

        {/* Trend */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ color: trendColor }}>{TREND_ICONS[data.moat_trend]}</Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: trendColor }}>
            {data.moat_trend}
          </Typography>
        </Box>

        {/* Durability */}
        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontSize: 10, color: theme.text.muted }}>DURABILITY</Typography>
          <Typography sx={{ fontSize: 16, fontWeight: 800, color: theme.text.primary }}>
            {data.moat_durability_years}
            <Typography component="span" sx={{ fontSize: 11, color: theme.text.muted }}> yr</Typography>
          </Typography>
        </Box>
      </Box>

      {/* Moat types chips */}
      {data.moat_types?.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.muted, mb: 1 }}>
            Moat Types
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {data.moat_types.map((m: any, i: number) => {
              const sColor = STRENGTH_COLORS[m.strength] || theme.text.muted;
              return (
                <Box
                  key={i}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.5,
                    py: 0.75,
                    bgcolor: theme.background.secondary,
                    borderRadius: 1,
                    borderLeft: `3px solid ${sColor}`,
                  }}
                >
                  <Chip
                    label={m.type}
                    size="small"
                    sx={{ fontSize: 11, fontWeight: 700, bgcolor: `${sColor}15`, color: sColor }}
                  />
                  <Typography sx={{ fontSize: 12, color: theme.text.secondary, flex: 1 }}>
                    {m.evidence}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Evidence */}
      {data.moat_evidence?.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.muted, mb: 0.5 }}>
            Key Evidence
          </Typography>
          {data.moat_evidence.map((e: string, i: number) => (
            <Typography key={i} sx={{ fontSize: 12, color: theme.text.secondary, pl: 1.5, mb: 0.25, position: 'relative', '&::before': { content: '"\\2022"', position: 'absolute', left: 0, color: theme.brand.primary } }}>
              {e}
            </Typography>
          ))}
        </Box>
      )}

      {/* Threats */}
      {data.moat_threats?.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#f44336', mb: 0.5 }}>
            Threats
          </Typography>
          {data.moat_threats.map((t: string, i: number) => (
            <Typography key={i} sx={{ fontSize: 12, color: theme.text.secondary, pl: 1.5, mb: 0.25, position: 'relative', '&::before': { content: '"\\26A0"', position: 'absolute', left: -2, fontSize: 10 } }}>
              {t}
            </Typography>
          ))}
        </Box>
      )}

      {/* Competitive position */}
      {data.competitive_position && (
        <Typography sx={{ fontSize: 12, color: theme.text.muted, fontStyle: 'italic' }}>
          {data.competitive_position}
        </Typography>
      )}
    </Box>
  );
}
