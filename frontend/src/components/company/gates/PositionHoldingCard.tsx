import { Box, Typography } from '@mui/material';
import { useTheme } from '../../../theme/ThemeProvider';
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Top row: action badge + conviction + position */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, flexWrap: 'wrap' }}>
        <Box
          sx={{
            px: 2, py: 0.75,
            bgcolor: actionColor,
            color: '#fff',
            borderRadius: 1.5,
            fontWeight: 800,
            fontSize: 16,
            letterSpacing: 1,
          }}
        >
          {data.action}
        </Box>

        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontSize: 10, color: theme.text.muted }}>CONVICTION</Typography>
          <Typography sx={{ fontSize: 16, fontWeight: 700 }}>
            {Math.round((data.conviction || 0) * 100)}%
          </Typography>
        </Box>

        {data.position_size_pct > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ fontSize: 10, color: theme.text.muted }}>POSITION SIZE</Typography>
            <Typography sx={{ fontSize: 16, fontWeight: 700, color: actionColor }}>
              {data.position_size_pct}%
            </Typography>
          </Box>
        )}

        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontSize: 10, color: theme.text.muted }}>HORIZON</Typography>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: theme.text.secondary }}>
            {data.hold_horizon}
          </Typography>
        </Box>
      </Box>

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
                gap: 1,
                px: 1.5,
                py: 1,
                bgcolor: theme.background.secondary,
                borderRadius: 1,
                borderLeft: `3px solid ${p.color}`,
              }}
            >
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: p.color, minWidth: 50 }}>
                {p.name}
              </Typography>
              <Typography sx={{ fontSize: 12, color: theme.text.secondary, fontStyle: 'italic' }}>
                "{p.comment}"
              </Typography>
            </Box>
          ))}
      </Box>

      {/* Sell triggers */}
      {data.sell_triggers?.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#f44336', mb: 0.5 }}>
            Sell Triggers
          </Typography>
          {data.sell_triggers.map((t: string, i: number) => (
            <Typography key={i} sx={{ fontSize: 12, color: theme.text.secondary, pl: 1.5, mb: 0.25, position: 'relative', '&::before': { content: '"\\2022"', position: 'absolute', left: 0, color: '#f44336' } }}>
              {t}
            </Typography>
          ))}
        </Box>
      )}

      {/* Add triggers */}
      {data.add_triggers?.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#4caf50', mb: 0.5 }}>
            Add Position Triggers
          </Typography>
          {data.add_triggers.map((t: string, i: number) => (
            <Typography key={i} sx={{ fontSize: 12, color: theme.text.secondary, pl: 1.5, mb: 0.25, position: 'relative', '&::before': { content: '"\\2022"', position: 'absolute', left: 0, color: '#4caf50' } }}>
              {t}
            </Typography>
          ))}
        </Box>
      )}

      {/* One sentence */}
      {data.one_sentence && (
        <Box sx={{ p: 1.5, bgcolor: `${actionColor}08`, borderRadius: 1, border: `1px solid ${actionColor}20` }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, textAlign: 'center' }}>
            {data.one_sentence}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
