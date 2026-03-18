import { Box, Typography } from '@mui/material';
import { useTheme } from '../../../theme/ThemeProvider';
import { SectionHeader, ScoreBar, DataTable, StatusBadge } from '../ui';

interface Props {
  data: Record<string, any>;
}

export default function ManagementCard({ data }: Props) {
  const { theme } = useTheme();

  const detailRows = [
    { label: 'Integrity', text: data.integrity_evidence },
    { label: 'Capital Allocation', text: data.capital_allocation_detail },
    { label: 'Shareholder Orientation', text: data.shareholder_orientation_detail },
    { label: 'Succession Plan', text: data.succession_detail },
    { label: 'Insider Signal', text: data.insider_signal },
    { label: 'Key Person Risk', text: data.key_person_risk },
    { label: 'Compensation', text: data.compensation_assessment },
  ].filter((s) => s.text);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Score bars */}
      <Box>
        <ScoreBar label="Integrity" score={data.integrity_score || 0} />
        <ScoreBar label="Capital Allocation" score={data.capital_allocation_score || 0} />
        <ScoreBar label="Shareholder Orientation" score={data.shareholder_orientation_score || 0} />
        <ScoreBar label="Overall Management" score={data.management_score || 0} />
      </Box>

      {/* Succession risk */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Typography sx={{ fontSize: 13, color: theme.text.secondary }}>
          Succession Risk:
        </Typography>
        {data.succession_risk && (
          <StatusBadge variant="risk" value={data.succession_risk} />
        )}
      </Box>

      {/* Detail sections as DataTable */}
      {detailRows.length > 0 && (
        <Box>
          <SectionHeader>Details</SectionHeader>
          <DataTable rows={detailRows.map((s) => ({ label: s.label, value: s.text }))} />
        </Box>
      )}
    </Box>
  );
}
