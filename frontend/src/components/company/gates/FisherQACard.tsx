import { useState } from 'react';
import { Box, Typography, Collapse, LinearProgress, Chip } from '@mui/material';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTheme } from '../../../theme/ThemeProvider';
import FisherRadarChart from '../charts/FisherRadarChart';

interface Props {
  data: Record<string, any>;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: '#4caf50',
  medium: '#ff9800',
  low: '#f44336',
};

const VERDICT_COLORS: Record<string, string> = {
  compounder: '#4caf50',
  cyclical: '#ff9800',
  declining: '#f44336',
  turnaround: '#2196f3',
};

export default function FisherQACard({ data }: Props) {
  const { theme } = useTheme();
  const [expandedQ, setExpandedQ] = useState<Record<string, boolean>>({});

  const toggleQ = (id: string) => {
    setExpandedQ((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const questions = data.questions || [];
  const verdictColor = VERDICT_COLORS[data.growth_verdict] || theme.text.muted;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Top stats row */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontSize: 10, color: theme.text.muted }}>TOTAL SCORE</Typography>
          <Typography sx={{ fontSize: 20, fontWeight: 800, color: theme.text.primary }}>
            {data.total_score || 0}
            <Typography component="span" sx={{ fontSize: 12, color: theme.text.muted }}>/150</Typography>
          </Typography>
        </Box>
        <Chip
          label={data.growth_verdict?.toUpperCase()}
          size="small"
          sx={{ bgcolor: `${verdictColor}20`, color: verdictColor, fontWeight: 700, fontSize: 12 }}
        />
      </Box>

      {/* Radar chart + QA split */}
      <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
        {/* Radar chart */}
        {data.radar_data && (
          <Box sx={{ width: { xs: '100%', md: 280 }, flexShrink: 0 }}>
            <FisherRadarChart data={data.radar_data} />
          </Box>
        )}

        {/* Flags */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {data.green_flags?.length > 0 && (
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#4caf50', mb: 0.5 }}>
                Green Flags
              </Typography>
              {data.green_flags.map((f: string, i: number) => (
                <Typography key={i} sx={{ fontSize: 12, color: theme.text.secondary, pl: 1.5, position: 'relative', '&::before': { content: '"+"', position: 'absolute', left: 0, color: '#4caf50', fontWeight: 700 } }}>
                  {f}
                </Typography>
              ))}
            </Box>
          )}
          {data.red_flags?.length > 0 && (
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#f44336', mb: 0.5 }}>
                Red Flags
              </Typography>
              {data.red_flags.map((f: string, i: number) => (
                <Typography key={i} sx={{ fontSize: 12, color: theme.text.secondary, pl: 1.5, position: 'relative', '&::before': { content: '"-"', position: 'absolute', left: 0, color: '#f44336', fontWeight: 700 } }}>
                  {f}
                </Typography>
              ))}
            </Box>
          )}
        </Box>
      </Box>

      {/* 15 Questions Accordion */}
      <Box>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.muted, mb: 1 }}>
          Fisher 15 Questions
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {questions.map((q: any) => {
            const isOpen = expandedQ[q.id] ?? false;
            const scoreColor = (q.score || 0) >= 7 ? '#4caf50' : (q.score || 0) >= 4 ? '#ff9800' : '#f44336';
            const confColor = CONFIDENCE_COLORS[q.data_confidence] || theme.text.muted;

            return (
              <Box
                key={q.id}
                sx={{
                  bgcolor: theme.background.secondary,
                  borderRadius: 1,
                  overflow: 'hidden',
                }}
              >
                <Box
                  onClick={() => toggleQ(q.id)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.5,
                    py: 1,
                    cursor: 'pointer',
                    '&:hover': { bgcolor: theme.background.hover },
                  }}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: theme.brand.primary, minWidth: 28 }}>
                    {q.id}
                  </Typography>
                  <Typography sx={{ fontSize: 12, flex: 1, color: theme.text.primary, lineHeight: 1.4 }}>
                    {q.question}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                    <Box
                      sx={{
                        width: 6, height: 6, borderRadius: '50%',
                        bgcolor: confColor,
                      }}
                      title={`Data confidence: ${q.data_confidence}`}
                    />
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: scoreColor, minWidth: 20, textAlign: 'right' }}>
                      {q.score}
                    </Typography>
                  </Box>
                </Box>
                <Collapse in={isOpen}>
                  <Box sx={{ px: 1.5, pb: 1.5, pt: 0.5 }}>
                    <Typography sx={{ fontSize: 12, color: theme.text.secondary, lineHeight: 1.6 }}>
                      {q.answer}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={(q.score || 0) * 10}
                      sx={{
                        mt: 1,
                        height: 4,
                        borderRadius: 2,
                        bgcolor: theme.background.hover,
                        '& .MuiLinearProgress-bar': { bgcolor: scoreColor, borderRadius: 2 },
                      }}
                    />
                  </Box>
                </Collapse>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
