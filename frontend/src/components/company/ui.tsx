/**
 * Shared UI primitives for Company Agent gate cards.
 * Provides a unified visual language across all report components.
 */
import { Box, Typography, LinearProgress } from '@mui/material';
import { useTheme } from '../../theme/ThemeProvider';

// ═══════════════════════════════════════════════════
// 1. SectionHeader — module title with bottom rule
// ═══════════════════════════════════════════════════

interface SectionHeaderProps {
  children: React.ReactNode;
  /** Optional right-aligned element */
  right?: React.ReactNode;
}

export function SectionHeader({ children, right }: SectionHeaderProps) {
  const { theme } = useTheme();
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${theme.border.subtle}`,
        pb: 0.75,
        mb: 1.5,
      }}
    >
      <Typography
        sx={{
          fontSize: 13,
          fontWeight: 600,
          color: theme.text.muted,
          letterSpacing: 0.2,
        }}
      >
        {children}
      </Typography>
      {right && right}
    </Box>
  );
}

// ═══════════════════════════════════════════════════
// 2. DataTable — two-column label/value table
// ═══════════════════════════════════════════════════

interface DataRow {
  label: string;
  value: React.ReactNode;
}

interface DataTableProps {
  rows: DataRow[];
}

export function DataTable({ rows }: DataTableProps) {
  const { theme } = useTheme();
  return (
    <Box sx={{ borderRadius: 1, overflow: 'hidden' }}>
      {rows.map((row, i) => (
        <Box
          key={i}
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            px: 1.5,
            py: 1,
            bgcolor: i % 2 === 0 ? 'transparent' : theme.background.secondary,
          }}
        >
          <Typography sx={{ fontSize: 13, color: theme.text.secondary, flex: 1, minWidth: 0 }}>
            {row.label}
          </Typography>
          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 600,
              color: theme.text.primary,
              textAlign: 'right',
              ml: 2,
              flexShrink: 0,
              maxWidth: '60%',
            }}
          >
            {row.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

// ═══════════════════════════════════════════════════
// 3. StatGrid — horizontal metric grid with dividers
// ═══════════════════════════════════════════════════

interface StatItem {
  label: string;
  value: React.ReactNode;
  color?: string;
}

interface StatGridProps {
  items: StatItem[];
}

export function StatGrid({ items }: StatGridProps) {
  const { theme } = useTheme();
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${items.length}, 1fr)`,
        borderRadius: 1,
        overflow: 'hidden',
        border: `1px solid ${theme.border.subtle}`,
      }}
    >
      {items.map((item, i) => (
        <Box
          key={i}
          sx={{
            textAlign: 'center',
            py: 1.25,
            px: 1,
            borderLeft: i > 0 ? `1px solid ${theme.border.subtle}` : 'none',
          }}
        >
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 600,
              color: theme.text.muted,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              mb: 0.25,
            }}
          >
            {item.label}
          </Typography>
          <Typography
            sx={{
              fontSize: 15,
              fontWeight: 700,
              color: item.color || theme.text.primary,
              lineHeight: 1.3,
            }}
          >
            {item.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

// ═══════════════════════════════════════════════════
// 4. BulletList — list with colored dot indicators
// ═══════════════════════════════════════════════════

interface BulletListProps {
  items: string[];
  variant?: 'positive' | 'negative' | 'neutral';
}

const BULLET_COLORS = {
  positive: '#22c55e',
  negative: '#ef4444',
  neutral: '#6366f1',
};

export function BulletList({ items, variant = 'neutral' }: BulletListProps) {
  const { theme } = useTheme();
  const dotColor = BULLET_COLORS[variant];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {items.map((item, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pl: 0.5 }}>
          <Box
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              bgcolor: dotColor,
              flexShrink: 0,
              mt: '7px',
            }}
          />
          <Typography sx={{ fontSize: 13, color: theme.text.secondary, lineHeight: 1.7 }}>
            {item}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

// ═══════════════════════════════════════════════════
// 5. ScoreBar — score progress bar with label
// ═══════════════════════════════════════════════════

interface ScoreBarProps {
  label: string;
  score: number;
  max?: number;
  /** Override color instead of auto green/orange/red */
  color?: string;
}

export function ScoreBar({ label, score, max = 10, color }: ScoreBarProps) {
  const { theme } = useTheme();
  const pct = Math.min((score / max) * 100, 100);
  const barColor = color || (score >= 7 ? '#4caf50' : score >= 4 ? '#ff9800' : '#f44336');

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography sx={{ fontSize: 13, color: theme.text.secondary }}>{label}</Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: barColor }}>
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
          '& .MuiLinearProgress-bar': { bgcolor: barColor, borderRadius: 3 },
        }}
      />
    </Box>
  );
}

// ═══════════════════════════════════════════════════
// 6. StatusBadge — semantic colored badge
// ═══════════════════════════════════════════════════

type BadgeVariant = 'quality' | 'action' | 'width' | 'assessment' | 'risk' | 'score';

interface StatusBadgeProps {
  variant: BadgeVariant;
  value: string;
}

const BADGE_MAPS: Record<BadgeVariant, Record<string, { bg: string; fg: string }>> = {
  quality: {
    excellent: { bg: '#22c55e20', fg: '#22c55e' },
    good:      { bg: '#3b82f620', fg: '#3b82f6' },
    mediocre:  { bg: '#f59e0b20', fg: '#f59e0b' },
    poor:      { bg: '#ef444420', fg: '#ef4444' },
  },
  action: {
    buy:   { bg: '#22c55e20', fg: '#22c55e' },
    watch: { bg: '#f59e0b20', fg: '#f59e0b' },
    avoid: { bg: '#ef444420', fg: '#ef4444' },
  },
  width: {
    wide:   { bg: '#22c55e20', fg: '#22c55e' },
    narrow: { bg: '#f59e0b20', fg: '#f59e0b' },
    none:   { bg: '#ef444420', fg: '#ef4444' },
  },
  assessment: {
    cheap:     { bg: '#22c55e20', fg: '#22c55e' },
    fair:      { bg: '#3b82f620', fg: '#3b82f6' },
    expensive: { bg: '#f59e0b20', fg: '#f59e0b' },
    bubble:    { bg: '#9c27b020', fg: '#9c27b0' },
  },
  risk: {
    low:    { bg: '#22c55e20', fg: '#22c55e' },
    medium: { bg: '#f59e0b20', fg: '#f59e0b' },
    high:   { bg: '#ef444420', fg: '#ef4444' },
  },
  score: {},
};

export function StatusBadge({ variant, value }: StatusBadgeProps) {
  const { theme } = useTheme();
  const key = (value || '').toLowerCase();
  const map = BADGE_MAPS[variant] || {};
  const colors = map[key] || { bg: `${theme.brand.primary}15`, fg: theme.brand.primary };

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        px: 1.5,
        py: 0.5,
        borderRadius: 1,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        bgcolor: colors.bg,
        color: colors.fg,
      }}
    >
      {String(value).toUpperCase()}
    </Box>
  );
}
