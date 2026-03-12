import { Box, Typography, LinearProgress, Chip } from '@mui/material';
import { useTheme } from '../../../theme/ThemeProvider';

interface Props {
  data: Record<string, any>;
}

const RISK_COLORS: Record<string, string> = {
  low: '#4caf50',
  medium: '#ff9800',
  high: '#f44336',
};

function ScoreBar({ label, score, max = 10 }: { label: string; score: number; max?: number }) {
  const { theme } = useTheme();
  const pct = (score / max) * 100;
  const color = score >= 7 ? '#4caf50' : score >= 4 ? '#ff9800' : '#f44336';

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.muted }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color }}>
          {score}/{max}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: 6,
          borderRadius: 3,
          bgcolor: theme.background.secondary,
          '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 3 },
        }}
      />
    </Box>
  );
}

export default function ManagementCard({ data }: Props) {
  const { theme } = useTheme();
  const riskColor = RISK_COLORS[data.succession_risk] || theme.text.muted;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Score bars */}
      <Box>
        <ScoreBar label="Integrity" score={data.integrity_score || 0} />
        <ScoreBar label="Capital Allocation" score={data.capital_allocation_score || 0} />
        <ScoreBar label="Shareholder Orientation" score={data.shareholder_orientation_score || 0} />
        <ScoreBar label="Overall Management" score={data.management_score || 0} />
      </Box>

      {/* Succession risk */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.muted }}>
          Succession Risk:
        </Typography>
        <Chip
          label={data.succession_risk?.toUpperCase()}
          size="small"
          sx={{ bgcolor: `${riskColor}20`, color: riskColor, fontWeight: 700, fontSize: 11 }}
        />
      </Box>

      {/* Detail sections */}
      {[
        { label: 'Integrity', text: data.integrity_evidence },
        { label: 'Capital Allocation', text: data.capital_allocation_detail },
        { label: 'Shareholder Orientation', text: data.shareholder_orientation_detail },
        { label: 'Succession Plan', text: data.succession_detail },
        { label: 'Insider Signal', text: data.insider_signal },
        { label: 'Key Person Risk', text: data.key_person_risk },
        { label: 'Compensation', text: data.compensation_assessment },
      ]
        .filter((s) => s.text)
        .map((s, i) => (
          <Box key={i}>
            <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.text.muted, mb: 0.25 }}>
              {s.label}
            </Typography>
            <Typography sx={{ fontSize: 12, color: theme.text.secondary, lineHeight: 1.6 }}>
              {s.text}
            </Typography>
          </Box>
        ))}
    </Box>
  );
}
