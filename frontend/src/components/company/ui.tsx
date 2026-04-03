/**
 * Shared UI primitives for Company Agent gate cards.
 * Refined visual language — muted tones, tight spacing, premium restraint.
 */
import { Box, Typography, LinearProgress } from '@mui/material';
import { useTheme } from '../../theme/ThemeProvider';

// ═══════════════════════════════════════════════════
// 1. SectionHeader — module title with bottom rule
// ═══════════════════════════════════════════════════

interface SectionHeaderProps {
  children: React.ReactNode;
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
        pb: 0.5,
        mb: 1.25,
      }}
    >
      <Typography
        sx={{
          fontSize: 10.5,
          fontWeight: 600,
          color: theme.text.muted,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-ui)',
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
            px: 1.25,
            py: 0.75,
            bgcolor: i % 2 === 0 ? 'transparent' : `${theme.background.secondary}80`,
          }}
        >
          <Typography sx={{ fontSize: 12.5, color: theme.text.muted, flex: 1, minWidth: 0 }}>
            {row.label}
          </Typography>
          <Typography
            sx={{
              fontSize: 12.5,
              fontWeight: 600,
              color: theme.text.secondary,
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
            px: 0.75,
            borderLeft: i > 0 ? `1px solid ${theme.border.subtle}` : 'none',
          }}
        >
          <Typography
            sx={{
              fontSize: 9.5,
              fontWeight: 600,
              color: theme.text.disabled,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              mb: 0.25,
              fontFamily: 'var(--font-ui)',
            }}
          >
            {item.label}
          </Typography>
          <Typography
            sx={{
              fontSize: 14,
              fontWeight: 700,
              color: item.color ? `${item.color}cc` : theme.text.primary,
              lineHeight: 1.3,
              fontFamily: 'var(--font-mono)',
              fontFeatureSettings: '"tnum"',
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

// Muted, desaturated tones for a premium feel
const BULLET_COLORS = {
  positive: '#6dba82',
  negative: '#d4726a',
  neutral: '#8b8ec7',
};

export function BulletList({ items, variant = 'neutral' }: BulletListProps) {
  const { theme } = useTheme();
  const dotColor = BULLET_COLORS[variant];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      {items.map((item, i) => (
        <Box
          key={i}
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1,
            px: 1,
            py: 0.5,
            borderRadius: 1,
          }}
        >
          <Box
            sx={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              bgcolor: dotColor,
              opacity: 0.7,
              flexShrink: 0,
              mt: '7px',
            }}
          />
          <Typography sx={{ fontSize: '0.9rem', color: theme.text.secondary, lineHeight: 1.75 }}>
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
  color?: string;
}

// Muted score colors
const scoreColor = (score: number, max: number) => {
  const ratio = score / max;
  if (ratio >= 0.7) return '#6dba82';
  if (ratio >= 0.4) return '#c4a35a';
  return '#c47060';
};

export function ScoreBar({ label, score, max = 10, color }: ScoreBarProps) {
  const { theme } = useTheme();
  const pct = Math.min((score / max) * 100, 100);
  const barColor = color || scoreColor(score, max);

  return (
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography sx={{ fontSize: 12, color: theme.text.muted, fontFamily: 'var(--font-ui)' }}>{label}</Typography>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: `${barColor}cc`, fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum"' }}>
          {score}/{max}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: 4,
          borderRadius: 2,
          bgcolor: `${theme.border.subtle}`,
          '& .MuiLinearProgress-bar': {
            bgcolor: barColor,
            borderRadius: 2,
            opacity: 0.75,
          },
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

// Muted, desaturated badge palette for refined look
const BADGE_MAPS: Record<BadgeVariant, Record<string, { bg: string; fg: string }>> = {
  quality: {
    excellent: { bg: 'rgba(109, 186, 130, 0.12)', fg: '#6dba82' },
    good:      { bg: 'rgba(100, 149, 237, 0.12)', fg: '#7da3d4' },
    mediocre:  { bg: 'rgba(196, 163, 90, 0.12)',  fg: '#c4a35a' },
    poor:      { bg: 'rgba(196, 112, 96, 0.12)',  fg: '#c47060' },
  },
  action: {
    buy:   { bg: 'rgba(109, 186, 130, 0.12)', fg: '#6dba82' },
    watch: { bg: 'rgba(196, 163, 90, 0.12)',  fg: '#c4a35a' },
    avoid: { bg: 'rgba(196, 112, 96, 0.12)',  fg: '#c47060' },
  },
  width: {
    wide:   { bg: 'rgba(109, 186, 130, 0.12)', fg: '#6dba82' },
    narrow: { bg: 'rgba(196, 163, 90, 0.12)',  fg: '#c4a35a' },
    none:   { bg: 'rgba(196, 112, 96, 0.12)',  fg: '#c47060' },
  },
  assessment: {
    cheap:     { bg: 'rgba(109, 186, 130, 0.12)', fg: '#6dba82' },
    fair:      { bg: 'rgba(100, 149, 237, 0.12)', fg: '#7da3d4' },
    expensive: { bg: 'rgba(196, 163, 90, 0.12)',  fg: '#c4a35a' },
    bubble:    { bg: 'rgba(156, 112, 176, 0.12)',  fg: '#9c70b0' },
  },
  risk: {
    low:    { bg: 'rgba(109, 186, 130, 0.12)', fg: '#6dba82' },
    medium: { bg: 'rgba(196, 163, 90, 0.12)',  fg: '#c4a35a' },
    high:   { bg: 'rgba(196, 112, 96, 0.12)',  fg: '#c47060' },
  },
  score: {},
};

export function StatusBadge({ variant, value }: StatusBadgeProps) {
  const { theme } = useTheme();
  const key = (value || '').toLowerCase();
  const map = BADGE_MAPS[variant] || {};
  const colors = map[key] || { bg: `${theme.brand.primary}10`, fg: `${theme.brand.primary}bb` };

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        px: 1.25,
        py: 0.375,
        borderRadius: '4px',
        fontSize: 10.5,
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: '0.04em',
        fontFamily: 'var(--font-ui)',
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

// ═══════════════════════════════════════════════════
// 7. AccentCard — colored accent card (subtle)
// ═══════════════════════════════════════════════════

interface AccentCardProps {
  color: string;
  children: React.ReactNode;
  sx?: Record<string, any>;
}

export function AccentCard({ color, children, sx }: AccentCardProps) {
  return (
    <Box
      sx={{
        px: 1.5,
        py: 1,
        bgcolor: `${color}08`,
        borderRadius: 1,
        borderLeft: `3px solid ${color}30`,
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}
