import { Box, Typography } from '@mui/material';
import { useTheme } from '../../../theme/ThemeProvider';
import { SectionHeader, StatGrid, BulletList } from '../ui';
import PhilosophyScoresBar from '../charts/PhilosophyScoresBar';

interface Props {
  data: Record<string, any>;
}

const ACTION_COLORS: Record<string, string> = {
  BUY: '#4caf50',
  WATCH: '#ff9800',
  AVOID: '#f44336',
};

export default function PositionHoldingCard({ data }: Props) {
  const { theme } = useTheme();
  const actionColor = ACTION_COLORS[data.action] || theme.text.muted;

  const statItems = [
    { label: 'Action', value: data.action || '—', color: actionColor },
    { label: 'Conviction', value: `${Math.round((data.conviction || 0) * 100)}%` },
    ...(data.position_size_pct > 0
      ? [{ label: 'Position', value: `${data.position_size_pct}%`, color: actionColor }]
      : []),
    { label: 'Horizon', value: data.hold_horizon || '—' },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Top stats */}
      <StatGrid items={statItems} />

      {/* Position reasoning */}
      {data.position_reasoning && (
        <Typography sx={{ fontSize: 13, color: theme.text.secondary, lineHeight: 1.7 }}>
          {data.position_reasoning}
        </Typography>
      )}

      {/* Philosophy scores chart */}
      {data.philosophy_scores && (
        <Box sx={{ maxWidth: 400 }}>
          <PhilosophyScoresBar scores={data.philosophy_scores} />
        </Box>
      )}

      {/* Philosopher comments */}
      {[
        { name: 'Buffett', comment: data.buffett_comment, color: '#4caf50' },
        { name: 'Fisher', comment: data.fisher_comment, color: '#2196f3' },
        { name: 'Munger', comment: data.munger_comment, color: '#ff9800' },
      ].filter((p) => p.comment).length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {[
            { name: 'Buffett', comment: data.buffett_comment, color: '#4caf50' },
            { name: 'Fisher', comment: data.fisher_comment, color: '#2196f3' },
            { name: 'Munger', comment: data.munger_comment, color: '#ff9800' },
          ]
            .filter((p) => p.comment)
            .map((p) => (
              <Box
                key={p.name}
                sx={{
                  display: 'flex',
                  gap: 1.5,
                  px: 2,
                  py: 1.25,
                  bgcolor: theme.background.hover,
                  borderRadius: 1,
                  borderLeft: `3px solid ${p.color}`,
                }}
              >
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: p.color, minWidth: 50 }}>
                  {p.name}
                </Typography>
                <Typography sx={{ fontSize: 13, color: theme.text.secondary, fontStyle: 'italic' }}>
                  "{p.comment}"
                </Typography>
              </Box>
            ))}
        </Box>
      )}

      {/* Sell triggers */}
      {data.sell_triggers?.length > 0 && (
        <Box>
          <SectionHeader>Sell Triggers</SectionHeader>
          <BulletList items={data.sell_triggers} variant="negative" />
        </Box>
      )}

      {/* Add triggers */}
      {data.add_triggers?.length > 0 && (
        <Box>
          <SectionHeader>Add Position Triggers</SectionHeader>
          <BulletList items={data.add_triggers} variant="positive" />
        </Box>
      )}

      {/* One sentence */}
      {data.one_sentence && (
        <Box sx={{ p: 2, bgcolor: `${actionColor}08`, borderRadius: 1.5, border: `1px solid ${actionColor}20` }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, textAlign: 'center' }}>
            {data.one_sentence}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
