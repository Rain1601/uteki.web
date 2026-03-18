import { useState } from 'react';
import { Box, Typography, Collapse, LinearProgress } from '@mui/material';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTheme } from '../../../theme/ThemeProvider';
import { SectionHeader, StatGrid, BulletList } from '../ui';
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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Top stats */}
      <StatGrid
        items={[
          { label: 'Total Score', value: `${data.total_score || 0}/150` },
          { label: 'Growth Verdict', value: data.growth_verdict?.toUpperCase() || '—', color: verdictColor },
        ]}
      />

      {/* Radar chart + Flags split */}
      <Box sx={{ display: 'flex', gap: 2.5, flexDirection: { xs: 'column', md: 'row' } }}>
        {/* Radar chart */}
        {data.radar_data && (
          <Box sx={{ width: { xs: '100%', md: 280 }, flexShrink: 0 }}>
            <FisherRadarChart data={data.radar_data} />
          </Box>
        )}

        {/* Flags */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {data.green_flags?.length > 0 && (
            <Box>
              <SectionHeader>Green Flags</SectionHeader>
              <BulletList items={data.green_flags} variant="positive" />
            </Box>
          )}
          {data.red_flags?.length > 0 && (
            <Box>
              <SectionHeader>Red Flags</SectionHeader>
              <BulletList items={data.red_flags} variant="negative" />
            </Box>
          )}
        </Box>
      </Box>

      {/* 15 Questions Accordion */}
      <Box>
        <SectionHeader>Fisher 15 Questions</SectionHeader>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {questions.map((q: any) => {
            const isOpen = expandedQ[q.id] ?? false;
            const scoreColor = (q.score || 0) >= 7 ? '#4caf50' : (q.score || 0) >= 4 ? '#ff9800' : '#f44336';
            const confColor = CONFIDENCE_COLORS[q.data_confidence] || theme.text.muted;

            return (
              <Box
                key={q.id}
                sx={{
                  bgcolor: theme.background.hover,
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
                    '&:hover': { bgcolor: theme.background.active || theme.background.hover },
                  }}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Typography sx={{ fontSize: 12, fontWeight: 700, color: theme.brand.primary, minWidth: 28 }}>
                    {q.id}
                  </Typography>
                  <Typography sx={{ fontSize: 13, flex: 1, color: theme.text.primary, lineHeight: 1.4 }}>
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
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: scoreColor, minWidth: 20, textAlign: 'right' }}>
                      {q.score}
                    </Typography>
                  </Box>
                </Box>
                <Collapse in={isOpen}>
                  <Box sx={{ px: 1.5, pb: 1.5, pt: 0.5 }}>
                    <Typography sx={{ fontSize: 13, color: theme.text.secondary, lineHeight: 1.6 }}>
                      {q.answer}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={(q.score || 0) * 10}
                      sx={{
                        mt: 1,
                        height: 4,
                        borderRadius: 2,
                        bgcolor: theme.background.secondary,
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
