import { Box, Typography, Chip, LinearProgress } from '@mui/material';
import { useTheme } from '../../../theme/ThemeProvider';

const QUALITY_COLORS: Record<string, string> = {
  excellent: '#4caf50',
  good: '#ff9800',
  mediocre: '#f57c00',
  poor: '#f44336',
};

interface Props {
  data: Record<string, any>;
}

export default function BusinessAnalysisCard({ data }: Props) {
  const { theme } = useTheme();
  const qualityColor = QUALITY_COLORS[data.business_quality] || theme.text.muted;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Business description */}
      <Typography sx={{ fontSize: 13, color: theme.text.secondary, lineHeight: 1.7 }}>
        {data.business_description}
      </Typography>

      {/* Quality + sustainability row */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Chip
          label={data.business_quality?.toUpperCase()}
          size="small"
          sx={{
            bgcolor: `${qualityColor}20`,
            color: qualityColor,
            fontWeight: 700,
            fontSize: 12,
          }}
        />
        <Chip
          label={data.is_good_business ? 'Good Business' : 'Not Good Business'}
          size="small"
          sx={{
            bgcolor: data.is_good_business ? 'rgba(76,175,80,0.12)' : 'rgba(244,67,54,0.12)',
            color: data.is_good_business ? '#4caf50' : '#f44336',
            fontWeight: 600,
            fontSize: 11,
          }}
        />
      </Box>

      {/* Revenue streams */}
      {data.revenue_streams?.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.muted, mb: 1 }}>
            Revenue Streams
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {data.revenue_streams.map((s: any, i: number) => (
              <Box
                key={i}
                sx={{
                  px: 1.5, py: 0.75,
                  bgcolor: theme.background.secondary,
                  borderRadius: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
              >
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.primary }}>
                  {s.name}
                </Typography>
                <Typography sx={{ fontSize: 11, color: theme.brand.primary, fontWeight: 600 }}>
                  {s.percentage}%
                </Typography>
                <Typography sx={{ fontSize: 10, color: theme.text.muted }}>
                  {s.growth_trend}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Profit logic */}
      {data.profit_logic && (
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.muted, mb: 0.5 }}>
            Profit Logic
          </Typography>
          <Typography sx={{ fontSize: 13, color: theme.text.secondary }}>
            {data.profit_logic}
          </Typography>
        </Box>
      )}

      {/* Sustainability bar */}
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.muted }}>
            Sustainability
          </Typography>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: theme.text.primary }}>
            {data.sustainability_score}/10
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={(data.sustainability_score || 0) * 10}
          sx={{
            height: 6,
            borderRadius: 3,
            bgcolor: theme.background.secondary,
            '& .MuiLinearProgress-bar': {
              bgcolor: (data.sustainability_score || 0) >= 7 ? '#4caf50' :
                       (data.sustainability_score || 0) >= 4 ? '#ff9800' : '#f44336',
              borderRadius: 3,
            },
          }}
        />
        {data.sustainability_reasoning && (
          <Typography sx={{ fontSize: 11, color: theme.text.muted, mt: 0.5 }}>
            {data.sustainability_reasoning}
          </Typography>
        )}
      </Box>

      {/* Key metrics */}
      {data.key_metrics && Object.keys(data.key_metrics).length > 0 && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {Object.entries(data.key_metrics).map(([k, v]: [string, any]) => (
            <Box key={k} sx={{ textAlign: 'center' }}>
              <Typography sx={{ fontSize: 10, color: theme.text.muted, textTransform: 'uppercase' }}>
                {k.replace(/_/g, ' ')}
              </Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: theme.text.primary }}>
                {typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : v}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* Quality reasons */}
      {data.quality_reasons?.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {data.quality_reasons.map((r: string, i: number) => (
            <Chip
              key={i}
              label={r}
              size="small"
              sx={{ fontSize: 11, bgcolor: theme.background.secondary, color: theme.text.secondary }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
