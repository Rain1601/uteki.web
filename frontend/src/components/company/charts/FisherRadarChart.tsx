import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Radar, ResponsiveContainer, Tooltip,
} from 'recharts';
import { useTheme } from '../../../theme/ThemeProvider';

interface Props {
  data: Record<string, number>;
}

const AXIS_LABELS: Record<string, string> = {
  market_potential: 'Market',
  innovation: 'Innovation',
  profitability: 'Profit',
  management: 'Mgmt',
  competitive_edge: 'Edge',
};

export default function FisherRadarChart({ data }: Props) {
  const { theme } = useTheme();

  const chartData = Object.entries(data).map(([key, value]) => ({
    subject: AXIS_LABELS[key] || key,
    value: value || 0,
    fullMark: 10,
  }));

  if (chartData.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="75%">
        <PolarGrid stroke={theme.border.subtle} />
        <PolarAngleAxis
          dataKey="subject"
          tick={{ fill: theme.text.muted, fontSize: 11 }}
        />
        <PolarRadiusAxis
          domain={[0, 10]}
          tick={{ fill: theme.text.disabled, fontSize: 9 }}
          axisLine={false}
        />
        <Radar
          dataKey="value"
          stroke={theme.brand.primary}
          fill={theme.brand.primary}
          fillOpacity={0.2}
          strokeWidth={2}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: theme.background.tertiary,
            border: `1px solid ${theme.border.default}`,
            borderRadius: 6,
            color: theme.text.primary,
            fontSize: 12,
          }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
