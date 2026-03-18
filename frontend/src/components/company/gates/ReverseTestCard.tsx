import { Box, Typography } from '@mui/material';
import { useTheme } from '../../../theme/ThemeProvider';
import { SectionHeader, ScoreBar, BulletList } from '../ui';
import RiskMatrix from '../charts/RiskMatrix';

interface Props {
  data: Record<string, any>;
}

export default function ReverseTestCard({ data }: Props) {
  const { theme } = useTheme();

  const scenarios = data.destruction_scenarios || [];
  const redFlags = data.red_flags || [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Resilience score */}
      <Box>
        <ScoreBar label="Resilience Score" score={data.resilience_score || 0} />
        {data.resilience_reasoning && (
          <Typography sx={{ fontSize: 12, color: theme.text.muted, mt: -1 }}>
            {data.resilience_reasoning}
          </Typography>
        )}
      </Box>

      {/* Risk Matrix + Scenarios side by side */}
      <Box sx={{ display: 'flex', gap: 2.5, flexDirection: { xs: 'column', md: 'row' } }}>
        {/* Risk matrix chart */}
        {scenarios.length > 0 && (
          <Box sx={{ width: { xs: '100%', md: 300 }, flexShrink: 0 }}>
            <RiskMatrix scenarios={scenarios} />
          </Box>
        )}

        {/* Scenarios list */}
        {scenarios.length > 0 && (
          <Box sx={{ flex: 1 }}>
            <SectionHeader>Destruction Scenarios</SectionHeader>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {scenarios.map((s: any, i: number) => {
                const impactColor = (s.impact || 0) >= 7 ? '#f44336' : (s.impact || 0) >= 4 ? '#ff9800' : '#4caf50';
                return (
                  <Box
                    key={i}
                    sx={{
                      px: 1.5,
                      py: 1,
                      bgcolor: theme.background.hover,
                      borderRadius: 1,
                      borderLeft: `3px solid ${impactColor}`,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, flex: 1 }}>
                        {s.scenario}
                      </Typography>
                      <Typography sx={{ fontSize: 11, color: theme.text.muted }}>
                        {s.timeline}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1.5 }}>
                      <Typography sx={{ fontSize: 11, color: theme.text.muted }}>
                        P: {(s.probability * 100).toFixed(0)}%
                      </Typography>
                      <Typography sx={{ fontSize: 11, color: impactColor, fontWeight: 600 }}>
                        Impact: {s.impact}/10
                      </Typography>
                    </Box>
                    {s.reasoning && (
                      <Typography sx={{ fontSize: 12, color: theme.text.muted, mt: 0.5 }}>
                        {s.reasoning}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}
      </Box>

      {/* Red flags checklist */}
      {redFlags.length > 0 && (
        <Box>
          <SectionHeader>Red Flag Checklist</SectionHeader>
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
                  bgcolor: rf.triggered ? 'rgba(244,67,54,0.08)' : theme.background.hover,
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
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, minWidth: 160 }}>
                  {rf.flag}
                </Typography>
                <Typography sx={{ fontSize: 12, color: theme.text.muted, flex: 1 }}>
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
          <SectionHeader>Cognitive Biases Warning</SectionHeader>
          <BulletList items={data.cognitive_biases} variant="negative" />
        </Box>
      )}

      {/* Worst case */}
      {data.worst_case_narrative && (
        <Box sx={{ p: 2, bgcolor: 'rgba(244,67,54,0.06)', borderRadius: 1.5, borderLeft: '3px solid #f44336' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#f44336', mb: 0.5 }}>
            Worst Case Narrative
          </Typography>
          <Typography sx={{ fontSize: 13, color: theme.text.secondary, lineHeight: 1.7 }}>
            {data.worst_case_narrative}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
