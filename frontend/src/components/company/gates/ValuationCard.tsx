import { Box, Typography, Chip, LinearProgress } from '@mui/material';
import { useTheme } from '../../../theme/ThemeProvider';

interface Props {
  data: Record<string, any>;
}

const PRICE_CONFIG: Record<string, { color: string; label: string }> = {
  cheap:     { color: '#4caf50', label: 'CHEAP' },
  fair:      { color: '#ff9800', label: 'FAIR' },
  expensive: { color: '#f44336', label: 'EXPENSIVE' },
  bubble:    { color: '#9c27b0', label: 'BUBBLE' },
};

const MARGIN_CONFIG: Record<string, { color: string; pct: number }> = {
  large:    { color: '#4caf50', pct: 85 },
  moderate: { color: '#ff9800', pct: 55 },
  thin:     { color: '#f44336', pct: 25 },
  negative: { color: '#9c27b0', pct: 5 },
};

const SENTIMENT_CONFIG: Record<string, { color: string; label: string }> = {
  fear:     { color: '#4caf50', label: 'Fear' },
  neutral:  { color: '#ff9800', label: 'Neutral' },
  greed:    { color: '#f44336', label: 'Greed' },
  euphoria: { color: '#9c27b0', label: 'Euphoria' },
};

export default function ValuationCard({ data }: Props) {
  const { theme } = useTheme();

  const priceCfg = PRICE_CONFIG[data.price_assessment] || PRICE_CONFIG.fair;
  const marginCfg = MARGIN_CONFIG[data.safety_margin] || MARGIN_CONFIG.moderate;
  const sentimentCfg = SENTIMENT_CONFIG[data.market_sentiment] || SENTIMENT_CONFIG.neutral;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Price assessment badge + Buy confidence */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, flexWrap: 'wrap' }}>
        <Box
          sx={{
            px: 2.5, py: 1,
            bgcolor: `${priceCfg.color}15`,
            border: `2px solid ${priceCfg.color}`,
            borderRadius: 2,
          }}
        >
          <Typography sx={{ fontSize: 18, fontWeight: 800, color: priceCfg.color, letterSpacing: 1 }}>
            {priceCfg.label}
          </Typography>
        </Box>

        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontSize: 10, color: theme.text.muted }}>BUY CONFIDENCE</Typography>
          <Typography sx={{ fontSize: 20, fontWeight: 800, color: theme.text.primary }}>
            {data.buy_confidence || 0}
            <Typography component="span" sx={{ fontSize: 12, color: theme.text.muted }}>/10</Typography>
          </Typography>
        </Box>

        {/* Sentiment */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography sx={{ fontSize: 11, color: theme.text.muted }}>Sentiment:</Typography>
          <Chip
            label={sentimentCfg.label}
            size="small"
            sx={{ bgcolor: `${sentimentCfg.color}15`, color: sentimentCfg.color, fontWeight: 700, fontSize: 11 }}
          />
        </Box>
      </Box>

      {/* Safety margin */}
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.muted }}>
            Safety Margin
          </Typography>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: marginCfg.color }}>
            {data.safety_margin?.toUpperCase()}
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={marginCfg.pct}
          sx={{
            height: 8,
            borderRadius: 4,
            bgcolor: theme.background.secondary,
            '& .MuiLinearProgress-bar': { bgcolor: marginCfg.color, borderRadius: 4 },
          }}
        />
        {data.safety_margin_detail && (
          <Typography sx={{ fontSize: 11, color: theme.text.muted, mt: 0.5 }}>
            {data.safety_margin_detail}
          </Typography>
        )}
      </Box>

      {/* Price reasoning */}
      {data.price_reasoning && (
        <Box sx={{ p: 1.5, bgcolor: theme.background.secondary, borderRadius: 1 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.text.muted, mb: 0.5 }}>
            Price Reasoning
          </Typography>
          <Typography sx={{ fontSize: 13, color: theme.text.secondary, lineHeight: 1.7 }}>
            {data.price_reasoning}
          </Typography>
        </Box>
      )}

      {/* Comparable assessment */}
      {data.comparable_assessment && (
        <Box>
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.text.muted, mb: 0.25 }}>
            Comparable Analysis
          </Typography>
          <Typography sx={{ fontSize: 12, color: theme.text.secondary }}>
            {data.comparable_assessment}
          </Typography>
        </Box>
      )}

      {/* Price vs quality */}
      {data.price_vs_quality && (
        <Box>
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.text.muted, mb: 0.25 }}>
            Price vs Quality
          </Typography>
          <Typography sx={{ fontSize: 12, color: theme.text.secondary }}>
            {data.price_vs_quality}
          </Typography>
        </Box>
      )}

      {/* Sentiment detail */}
      {data.sentiment_detail && (
        <Typography sx={{ fontSize: 12, color: theme.text.muted, fontStyle: 'italic' }}>
          {data.sentiment_detail}
        </Typography>
      )}
    </Box>
  );
}
