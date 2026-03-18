import { Box, Typography, Chip } from '@mui/material';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useTheme } from '../../../theme/ThemeProvider';
import { SectionHeader, ScoreBar, StatGrid, BulletList } from '../ui';

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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Top stats: width + trend + durability */}
      <StatGrid
        items={[
          { label: 'Width', value: widthCfg.label, color: widthCfg.color },
          {
            label: 'Trend',
            value: (
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: trendColor }}>
                {TREND_ICONS[data.moat_trend]}
                {data.moat_trend}
              </Box>
            ) as any,
            color: trendColor,
          },
          { label: 'Durability', value: `${data.moat_durability_years || '—'} yr` },
        ]}
      />

      {/* Width gauge bar */}
      <ScoreBar
        label="Moat Width"
        score={widthCfg.pct}
        max={100}
        color={widthCfg.color}
      />

      {/* Moat types */}
      {data.moat_types?.length > 0 && (
        <Box>
          <SectionHeader>Moat Types</SectionHeader>
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
                    py: 1,
                    bgcolor: theme.background.hover,
                    borderRadius: 1,
                    borderLeft: `3px solid ${sColor}`,
                  }}
                >
                  <Chip
                    label={m.type}
                    size="small"
                    sx={{ fontSize: 12, fontWeight: 700, bgcolor: `${sColor}15`, color: sColor }}
                  />
                  <Typography sx={{ fontSize: 13, color: theme.text.secondary, flex: 1 }}>
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
          <SectionHeader>Key Evidence</SectionHeader>
          <BulletList items={data.moat_evidence} variant="neutral" />
        </Box>
      )}

      {/* Threats */}
      {data.moat_threats?.length > 0 && (
        <Box>
          <SectionHeader>Threats</SectionHeader>
          <BulletList items={data.moat_threats} variant="negative" />
        </Box>
      )}

      {/* Competitive position */}
      {data.competitive_position && (
        <Typography sx={{ fontSize: 13, color: theme.text.muted, fontStyle: 'italic' }}>
          {data.competitive_position}
        </Typography>
      )}
    </Box>
  );
}
