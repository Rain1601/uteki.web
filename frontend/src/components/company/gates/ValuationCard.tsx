import { Box, Typography, LinearProgress } from '@mui/material';
import { useTheme } from '../../../theme/ThemeProvider';
import { SectionHeader, StatGrid, DataTable, StatusBadge } from '../ui';

interface Props {
  data: Record<string, any>;
}

const MARGIN_CONFIG: Record<string, { color: string; pct: number }> = {
  large:    { color: '#4caf50', pct: 85 },
  moderate: { color: '#ff9800', pct: 55 },
  thin:     { color: '#f44336', pct: 25 },
  negative: { color: '#9c27b0', pct: 5 },
};

const SENTIMENT_COLORS: Record<string, string> = {
  fear:     '#4caf50',
  neutral:  '#ff9800',
  greed:    '#f44336',
  euphoria: '#9c27b0',
};

export default function ValuationCard({ data }: Props) {
  const { theme } = useTheme();

  const marginCfg = MARGIN_CONFIG[data.safety_margin] || MARGIN_CONFIG.moderate;
  const sentimentColor = SENTIMENT_COLORS[data.market_sentiment] || theme.text.muted;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Top stats: assessment + confidence + sentiment */}
      <StatGrid
        items={[
          {
            label: 'Price',
            value: <StatusBadge variant="assessment" value={data.price_assessment || 'fair'} /> as any,
          },
          { label: 'Buy Confidence', value: `${data.buy_confidence || 0}/10` },
          {
            label: 'Sentiment',
            value: (data.market_sentiment || '—').toUpperCase(),
            color: sentimentColor,
          },
        ]}
      />

      {/* Safety margin */}
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ fontSize: 13, color: theme.text.secondary }}>Safety Margin</Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: marginCfg.color }}>
            {data.safety_margin?.toUpperCase()}
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={marginCfg.pct}
          sx={{
            height: 6,
            borderRadius: 3,
            bgcolor: theme.background.hover,
            '& .MuiLinearProgress-bar': { bgcolor: marginCfg.color, borderRadius: 3 },
          }}
        />
        {data.safety_margin_detail && (
          <Typography sx={{ fontSize: 12, color: theme.text.muted, mt: 0.5 }}>
            {data.safety_margin_detail}
          </Typography>
        )}
      </Box>

      {/* Price reasoning */}
      {data.price_reasoning && (
        <Box>
          <SectionHeader>Price Reasoning</SectionHeader>
          <Typography sx={{ fontSize: 13, color: theme.text.secondary, lineHeight: 1.7 }}>
            {data.price_reasoning}
          </Typography>
        </Box>
      )}

      {/* Comparable + Price vs Quality as DataTable */}
      {(data.comparable_assessment || data.price_vs_quality) && (
        <Box>
          <SectionHeader>Analysis</SectionHeader>
          <DataTable
            rows={[
              ...(data.comparable_assessment ? [{ label: 'Comparable Analysis', value: data.comparable_assessment }] : []),
              ...(data.price_vs_quality ? [{ label: 'Price vs Quality', value: data.price_vs_quality }] : []),
            ]}
          />
        </Box>
      )}

      {/* Sentiment detail */}
      {data.sentiment_detail && (
        <Typography sx={{ fontSize: 13, color: theme.text.muted, fontStyle: 'italic' }}>
          {data.sentiment_detail}
        </Typography>
      )}
    </Box>
  );
}
