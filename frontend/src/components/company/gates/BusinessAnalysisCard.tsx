import { Box, Typography, Chip } from '@mui/material';
import { useTheme } from '../../../theme/ThemeProvider';
import { SectionHeader, ScoreBar, StatGrid, StatusBadge } from '../ui';

interface Props {
  data: Record<string, any>;
}

export default function BusinessAnalysisCard({ data }: Props) {
  const { theme } = useTheme();

  // Build key metrics items for StatGrid
  const metricItems = data.key_metrics
    ? Object.entries(data.key_metrics).map(([k, v]: [string, any]) => ({
        label: k.replace(/_/g, ' '),
        value: typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : String(v),
      }))
    : [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Business description */}
      <Typography sx={{ fontSize: 13, color: theme.text.secondary, lineHeight: 1.7 }}>
        {data.business_description}
      </Typography>

      {/* Quality + good business badges */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        {data.business_quality && (
          <StatusBadge variant="quality" value={data.business_quality} />
        )}
        <StatusBadge
          variant="quality"
          value={data.is_good_business ? 'GOOD' : 'POOR'}
        />
      </Box>

      {/* Revenue streams */}
      {data.revenue_streams?.length > 0 && (
        <Box>
          <SectionHeader>Revenue Streams</SectionHeader>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {data.revenue_streams.map((s: any, i: number) => (
              <Box
                key={i}
                sx={{
                  px: 1.5, py: 0.75,
                  bgcolor: theme.background.hover,
                  borderRadius: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
              >
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: theme.text.primary }}>
                  {s.name}
                </Typography>
                <Typography sx={{ fontSize: 12, color: theme.brand.primary, fontWeight: 600 }}>
                  {s.percentage}%
                </Typography>
                <Typography sx={{ fontSize: 11, color: theme.text.muted }}>
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
          <SectionHeader>Profit Logic</SectionHeader>
          <Typography sx={{ fontSize: 13, color: theme.text.secondary, lineHeight: 1.7 }}>
            {data.profit_logic}
          </Typography>
        </Box>
      )}

      {/* Sustainability bar */}
      {data.sustainability_score != null && (
        <Box>
          <ScoreBar label="Sustainability" score={data.sustainability_score || 0} />
          {data.sustainability_reasoning && (
            <Typography sx={{ fontSize: 12, color: theme.text.muted, mt: -1 }}>
              {data.sustainability_reasoning}
            </Typography>
          )}
        </Box>
      )}

      {/* Key metrics */}
      {metricItems.length > 0 && (
        <Box>
          <SectionHeader>Key Metrics</SectionHeader>
          <StatGrid items={metricItems} />
        </Box>
      )}

      {/* Quality reasons */}
      {data.quality_reasons?.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          {data.quality_reasons.map((r: string, i: number) => (
            <Chip
              key={i}
              label={r}
              size="small"
              sx={{ fontSize: 12, bgcolor: theme.background.hover, color: theme.text.secondary }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
