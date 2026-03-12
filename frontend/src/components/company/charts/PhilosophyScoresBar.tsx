import { Box, Typography } from '@mui/material';
import { useTheme } from '../../../theme/ThemeProvider';

interface Props {
  scores: Record<string, number>;
}

const PHILOSOPHER_CONFIG: Record<string, { label: string; color: string }> = {
  buffett: { label: 'Buffett', color: '#4caf50' },
  fisher:  { label: 'Fisher',  color: '#2196f3' },
  munger:  { label: 'Munger',  color: '#ff9800' },
};

export default function PhilosophyScoresBar({ scores }: Props) {
  const { theme } = useTheme();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.text.muted }}>
        Philosophy Scores
      </Typography>
      {Object.entries(scores).map(([key, value]) => {
        const cfg = PHILOSOPHER_CONFIG[key];
        if (!cfg) return null;
        const pct = ((value || 0) / 10) * 100;

        return (
          <Box key={key}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>
                {cfg.label}
              </Typography>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: theme.text.primary }}>
                {value}/10
              </Typography>
            </Box>
            <Box
              sx={{
                height: 8,
                bgcolor: theme.background.secondary,
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  height: '100%',
                  width: `${pct}%`,
                  bgcolor: cfg.color,
                  borderRadius: 4,
                  transition: 'width 0.5s ease',
                }}
              />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
