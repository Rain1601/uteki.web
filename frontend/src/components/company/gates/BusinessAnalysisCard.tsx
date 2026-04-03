import { Box, Typography, Chip } from '@mui/material';
import { useTheme } from '../../../theme/ThemeProvider';
import { SectionHeader, ScoreBar, StatGrid, StatusBadge } from '../ui';

interface Props {
  data: Record<string, any>;
}

export default function BusinessAnalysisCard({ data }: Props) {
  const { theme } = useTheme();

  const metricItems = data.key_metrics
    ? Object.entries(data.key_metrics).map(([k, v]: [string, any]) => ({
        label: k.replace(/_/g, ' '),
        value: typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : String(v),
      }))
    : [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography sx={{ fontSize: '0.95rem', color: theme.text.secondary, lineHeight: 1.8 }}>
        {data.business_description}
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {data.business_quality && (
          <StatusBadge variant="quality" value={data.business_quality} />
        )}
        <StatusBadge
          variant="quality"
          value={data.is_good_business ? 'GOOD' : 'POOR'}
        />
      </Box>

      {data.revenue_streams?.length > 0 && (
        <Box>
          <SectionHeader>Revenue Streams</SectionHeader>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {data.revenue_streams.map((s: any, i: number) => (
              <Box
                key={i}
                sx={{
                  px: 1.25, py: 0.5,
                  bgcolor: theme.background.hover,
                  borderRadius: 0.75,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                }}
              >
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.primary }}>
                  {s.name}
                </Typography>
                <Typography sx={{ fontSize: 11, color: `${theme.brand.primary}bb`, fontWeight: 600 }}>
                  {s.percentage}%
                </Typography>
                <Typography sx={{ fontSize: 10, color: theme.text.disabled }}>
                  {s.growth_trend}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {data.profit_logic && (
        <Box>
          <SectionHeader>Profit Logic</SectionHeader>
          <Typography sx={{ fontSize: 12.5, color: theme.text.secondary, lineHeight: 1.65 }}>
            {data.profit_logic}
          </Typography>
        </Box>
      )}

      {data.sustainability_score != null && (
        <Box>
          <ScoreBar label="Sustainability" score={data.sustainability_score || 0} />
          {data.sustainability_reasoning && (
            <Typography sx={{ fontSize: 11.5, color: theme.text.disabled, mt: -0.5 }}>
              {data.sustainability_reasoning}
            </Typography>
          )}
        </Box>
      )}

      {metricItems.length > 0 && (
        <Box>
          <SectionHeader>Key Metrics</SectionHeader>
          <StatGrid items={metricItems} />
        </Box>
      )}

      {data.quality_reasons?.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {data.quality_reasons.map((r: string, i: number) => (
            <Chip
              key={i}
              label={r}
              size="small"
              sx={{
                fontSize: 11,
                height: 24,
                bgcolor: theme.background.hover,
                color: theme.text.muted,
                '& .MuiChip-label': { px: 1 },
              }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
