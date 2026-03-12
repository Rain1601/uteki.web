import { Box, Typography } from '@mui/material';
import { useTheme } from '../../../theme/ThemeProvider';

interface Scenario {
  scenario: string;
  probability: number;
  impact: number;
  timeline: string;
}

interface Props {
  scenarios: Scenario[];
}

export default function RiskMatrix({ scenarios }: Props) {
  const { theme } = useTheme();

  // Grid: probability (x) vs impact (y), both 0-1/0-10
  const gridSize = 260;
  const padding = 30;
  const plotSize = gridSize - padding * 2;

  return (
    <Box>
      <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.text.muted, mb: 1, textAlign: 'center' }}>
        Risk Matrix (Probability vs Impact)
      </Typography>
      <svg width={gridSize} height={gridSize} viewBox={`0 0 ${gridSize} ${gridSize}`}>
        {/* Background quadrants */}
        <rect x={padding} y={padding} width={plotSize / 2} height={plotSize / 2}
          fill="rgba(244,67,54,0.06)" />
        <rect x={padding + plotSize / 2} y={padding} width={plotSize / 2} height={plotSize / 2}
          fill="rgba(244,67,54,0.12)" />
        <rect x={padding} y={padding + plotSize / 2} width={plotSize / 2} height={plotSize / 2}
          fill="rgba(76,175,80,0.06)" />
        <rect x={padding + plotSize / 2} y={padding + plotSize / 2} width={plotSize / 2} height={plotSize / 2}
          fill="rgba(255,152,0,0.06)" />

        {/* Axes */}
        <line x1={padding} y1={gridSize - padding} x2={gridSize - padding} y2={gridSize - padding}
          stroke={theme.border.default} strokeWidth={1} />
        <line x1={padding} y1={padding} x2={padding} y2={gridSize - padding}
          stroke={theme.border.default} strokeWidth={1} />

        {/* Labels */}
        <text x={gridSize / 2} y={gridSize - 5} textAnchor="middle"
          fill={theme.text.muted} fontSize={10}>Probability</text>
        <text x={8} y={gridSize / 2} textAnchor="middle"
          fill={theme.text.muted} fontSize={10}
          transform={`rotate(-90, 8, ${gridSize / 2})`}>Impact</text>

        {/* Tick labels */}
        <text x={padding} y={gridSize - padding + 14} textAnchor="middle" fill={theme.text.disabled} fontSize={9}>0</text>
        <text x={gridSize - padding} y={gridSize - padding + 14} textAnchor="middle" fill={theme.text.disabled} fontSize={9}>1.0</text>
        <text x={padding - 8} y={padding + 4} textAnchor="end" fill={theme.text.disabled} fontSize={9}>10</text>
        <text x={padding - 8} y={gridSize - padding + 4} textAnchor="end" fill={theme.text.disabled} fontSize={9}>0</text>

        {/* Data points */}
        {scenarios.map((s, i) => {
          const x = padding + s.probability * plotSize;
          const y = gridSize - padding - (s.impact / 10) * plotSize;
          const severity = s.probability * s.impact;
          const color = severity >= 3 ? '#f44336' : severity >= 1 ? '#ff9800' : '#4caf50';

          return (
            <g key={i}>
              <circle cx={x} cy={y} r={8} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={1.5} />
              <text x={x} y={y + 3.5} textAnchor="middle" fill={color} fontSize={9} fontWeight={700}>
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mt: 0.5 }}>
        {scenarios.map((s, i) => (
          <Typography key={i} sx={{ fontSize: 10, color: theme.text.muted }}>
            {i + 1}. {s.scenario}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}
