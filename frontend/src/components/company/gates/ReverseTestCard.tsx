import { Box, Typography, LinearProgress } from '@mui/material';
import { useTheme } from '../../../theme/ThemeProvider';
import RiskMatrix from '../charts/RiskMatrix';

interface Props {
  data: Record<string, any>;
}

export default function ReverseTestCard({ data }: Props) {
  const { theme } = useTheme();

  const scenarios = data.destruction_scenarios || [];
  const redFlags = data.red_flags || [];
  const resScore = data.resilience_score || 0;
  const resColor = resScore >= 7 ? '#4caf50' : resScore >= 4 ? '#ff9800' : '#f44336';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Resilience score */}
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.muted }}>
            Resilience Score
          </Typography>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: resColor }}>
            {resScore}/10
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={resScore * 10}
          sx={{
            height: 8,
            borderRadius: 4,
            bgcolor: theme.background.secondary,
            '& .MuiLinearProgress-bar': { bgcolor: resColor, borderRadius: 4 },
          }}
        />
        {data.resilience_reasoning && (
          <Typography sx={{ fontSize: 11, color: theme.text.muted, mt: 0.5 }}>
            {data.resilience_reasoning}
          </Typography>
        )}
      </Box>

      {/* Risk Matrix + Scenarios side by side */}
      <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
        {/* Risk matrix chart */}
        {scenarios.length > 0 && (
          <Box sx={{ width: { xs: '100%', md: 300 }, flexShrink: 0 }}>
            <RiskMatrix scenarios={scenarios} />
          </Box>
        )}

        {/* Scenarios list */}
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.muted, mb: 1 }}>
            Destruction Scenarios
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {scenarios.map((s: any, i: number) => {
              const impactColor = (s.impact || 0) >= 7 ? '#f44336' : (s.impact || 0) >= 4 ? '#ff9800' : '#4caf50';
              return (
                <Box
                  key={i}
                  sx={{
                    px: 1.5,
                    py: 1,
                    bgcolor: theme.background.secondary,
                    borderRadius: 1,
                    borderLeft: `3px solid ${impactColor}`,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.primary, flex: 1 }}>
                      {s.scenario}
                    </Typography>
                    <Typography sx={{ fontSize: 10, color: theme.text.muted }}>
                      {s.timeline}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Typography sx={{ fontSize: 10, color: theme.text.muted }}>
                      P: {(s.probability * 100).toFixed(0)}%
                    </Typography>
                    <Typography sx={{ fontSize: 10, color: impactColor, fontWeight: 600 }}>
                      Impact: {s.impact}/10
                    </Typography>
                  </Box>
                  {s.reasoning && (
                    <Typography sx={{ fontSize: 11, color: theme.text.muted, mt: 0.5 }}>
                      {s.reasoning}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>

      {/* Red flags checklist */}
      {redFlags.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.muted, mb: 1 }}>
            Red Flag Checklist
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {redFlags.map((rf: any, i: number) => (
              <Box
                key={i}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  bgcolor: rf.triggered ? 'rgba(244,67,54,0.08)' : theme.background.secondary,
                  borderRadius: 1,
                }}
              >
                <Box
                  sx={{
                    width: 8, height: 8, borderRadius: '50%',
                    bgcolor: rf.triggered ? '#f44336' : '#4caf50',
                    flexShrink: 0,
                  }}
                />
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.primary, minWidth: 160 }}>
                  {rf.flag}
                </Typography>
                <Typography sx={{ fontSize: 11, color: theme.text.muted, flex: 1 }}>
                  {rf.detail}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Cognitive biases */}
      {data.cognitive_biases?.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.muted, mb: 0.5 }}>
            Cognitive Biases Warning
          </Typography>
          {data.cognitive_biases.map((b: string, i: number) => (
            <Typography key={i} sx={{ fontSize: 12, color: theme.text.secondary, mb: 0.25 }}>
              {b}
            </Typography>
          ))}
        </Box>
      )}

      {/* Worst case */}
      {data.worst_case_narrative && (
        <Box sx={{ p: 1.5, bgcolor: 'rgba(244,67,54,0.06)', borderRadius: 1, borderLeft: '3px solid #f44336' }}>
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#f44336', mb: 0.25 }}>
            Worst Case Narrative
          </Typography>
          <Typography sx={{ fontSize: 12, color: theme.text.secondary, lineHeight: 1.6 }}>
            {data.worst_case_narrative}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
