import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import { RefreshCw as RefreshIcon } from 'lucide-react';

const TradingViewHeatmap = lazy(() => import('../components/macro/TradingViewHeatmap'));
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
} from 'recharts';
import { useTheme } from '../theme/ThemeProvider';
import { useResponsive } from '../hooks/useResponsive';
import LoadingDots from '../components/LoadingDots';
import {
  getDashboardOverview,
  getValuationDetail,
  getLiquidityDetail,
  getFlowDetail,
} from '../api/marketDashboard';
import type {
  Signal,
  CategoryData,
  Indicator,
  HistoryPoint,
  FlowData,
  SectorETF,
  StyleComparison,
} from '../types/marketDashboard';

/* ─── palette ─── */
const SIG: Record<Signal, { color: string; bg: string }> = {
  green:   { color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  yellow:  { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  red:     { color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  neutral: { color: '#64748b', bg: 'rgba(100,116,139,0.10)' },
};

const CAT_META: Record<string, { label: string; question: string; hero: string }> = {
  valuation: { label: 'Valuation', question: 'Is the market expensive?', hero: 'spy_pe' },
  liquidity: { label: 'Liquidity', question: 'Is liquidity abundant?', hero: 'net_liq' },
  flow:      { label: 'Money Flow', question: 'Where is money flowing?', hero: 'vix' },
};
const CAT_ORDER = ['valuation', 'liquidity', 'flow'];

const VIEWS = [
  { key: 'charts', label: 'Charts' },
  { key: 'heatmap', label: 'Heatmap' },
] as const;

const HEATMAP_SOURCES = [
  { key: 'SPX500', label: 'S&P 500' },
  { key: 'NASDAQ100', label: 'NASDAQ 100' },
  { key: 'CRYPTO', label: 'Crypto' },
];

/* ─── helpers ─── */
function fmtVal(v: number | null | undefined, unit?: string): string {
  if (v == null) return '—';
  const prefix = unit === '$' ? '$' : '';
  const suffix = unit && unit !== '$' ? unit : '';
  if (Math.abs(v) >= 1e12) return `${prefix}${(v / 1e12).toFixed(2)}T${suffix}`;
  if (Math.abs(v) >= 1e9) return `${prefix}${(v / 1e9).toFixed(1)}B${suffix}`;
  if (Math.abs(v) >= 1e6) return `${prefix}${(v / 1e6).toFixed(1)}M${suffix}`;
  if (Math.abs(v) >= 1e4 && !suffix) return `${prefix}${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}${suffix}`;
  return `${prefix}${v.toLocaleString()}${suffix}`;
}

function fmtChg(v: number | null | undefined): string {
  if (v == null) return '';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/* ═══════════════════ Sparkline ═══════════════════ */

function SparkArea({ data, color, height = 100 }: { data: HistoryPoint[]; color: string; height?: number }) {
  if (!data || data.length < 3) return null;
  return (
    <Box sx={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#475569' }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" axisLine={false} tickLine={false} />
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, fontSize: 11, color: '#e2e8f0', padding: '4px 8px' }}
            labelStyle={{ color: '#94a3b8', fontSize: 10 }}
            formatter={(v: number) => [v.toLocaleString(), '']}
          />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#grad-${color.replace('#', '')})`} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}

/* ═══════════════════ Signal Card (top row) ═══════════════════ */

function SignalCard({ cat, theme, isDark, active, onClick }: {
  cat: CategoryData; theme: any; isDark: boolean; active: boolean; onClick: () => void;
}) {
  const s = SIG[cat.signal];
  const meta = CAT_META[cat.category];
  const hero = cat.indicators.find(i => i.id === meta.hero) || cat.indicators[0];

  return (
    <Box
      onClick={onClick}
      sx={{
        flex: 1, minWidth: 0, cursor: 'pointer',
        p: '12px 16px', borderRadius: '10px',
        bgcolor: active
          ? (isDark ? `${s.color}10` : `${s.color}08`)
          : (isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.015)'),
        border: `1px solid ${active ? s.color + '30' : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
        transition: 'all 0.2s',
        '&:hover': { bgcolor: isDark ? `${s.color}0c` : `${s.color}06`, borderColor: s.color + '20' },
      }}
    >
      {/* Header row */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
        <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: s.color, flexShrink: 0 }} />
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: theme.text.muted, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
          {meta.label}
        </Typography>
        <Box sx={{ ml: 'auto', px: 0.6, py: 0.15, borderRadius: '4px', bgcolor: s.bg }}>
          <Typography sx={{ fontSize: 8, fontWeight: 700, color: s.color, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            {cat.signal_label}
          </Typography>
        </Box>
      </Box>
      {/* Hero value */}
      {hero && (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
          <Typography sx={{ fontSize: 20, fontWeight: 700, color: theme.text.primary, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px', lineHeight: 1.2 }}>
            {fmtVal(hero.value, hero.unit)}
          </Typography>
          {hero.change_pct != null && (
            <Typography sx={{ fontSize: 10, fontWeight: 600, color: hero.change_pct >= 0 ? SIG.green.color : SIG.red.color, fontVariantNumeric: 'tabular-nums' }}>
              {fmtChg(hero.change_pct)}
            </Typography>
          )}
        </Box>
      )}
      {/* Sub-indicators (compact) */}
      <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', gap: '1px' }}>
        {cat.indicators.slice(0, 4).map(ind => {
          const ic = SIG[ind.signal];
          return (
            <Box key={ind.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: ic.color, flexShrink: 0, opacity: 0.6 }} />
              <Typography noWrap sx={{ fontSize: 10, color: theme.text.muted, flex: 1, lineHeight: 1.5 }}>
                {ind.name}
              </Typography>
              <Typography sx={{ fontSize: 10, fontWeight: 600, color: theme.text.secondary, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {fmtVal(ind.value, ind.unit)}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/* ═══════════════════ Chart Card ═══════════════════ */

function ChartCard({ ind, theme, isDark }: { ind: Indicator; theme: any; isDark: boolean }) {
  const s = SIG[ind.signal];
  return (
    <Box sx={{
      p: '12px 14px', borderRadius: '8px',
      bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.012)',
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
      height: '100%', display: 'flex', flexDirection: 'column',
      transition: 'border-color 0.15s',
      '&:hover': { borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)' },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: s.color, flexShrink: 0 }} />
          <Typography noWrap sx={{ fontSize: 10, fontWeight: 600, color: theme.text.muted, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            {ind.name}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: theme.text.primary, fontVariantNumeric: 'tabular-nums' }}>
            {fmtVal(ind.value, ind.unit)}
          </Typography>
          {ind.change_pct != null && (
            <Typography sx={{ fontSize: 9, fontWeight: 600, color: ind.change_pct >= 0 ? SIG.green.color : SIG.red.color }}>
              {fmtChg(ind.change_pct)}
            </Typography>
          )}
        </Box>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {ind.history && ind.history.length > 3 ? (
          <SparkArea data={ind.history} color={s.color} height={100} />
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography sx={{ fontSize: 10, color: theme.text.disabled }}>No history</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

/* ═══════════════════ Sector Bars ═══════════════════ */

function SectorBars({ sectors, theme, isDark }: { sectors: SectorETF[]; theme: any; isDark: boolean }) {
  if (!sectors?.length) return null;
  const sorted = [...sectors].sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0));
  const maxAbs = Math.max(...sorted.map(s => Math.abs(s.change_pct ?? 0)), 0.01);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px', maxWidth: 420 }}>
      {sorted.map(s => {
        const pct = s.change_pct ?? 0;
        const positive = pct >= 0;
        const barW = Math.max((Math.abs(pct) / maxAbs) * 50, 2);
        const c = positive ? SIG.green.color : SIG.red.color;
        return (
          <Box key={s.symbol} sx={{ display: 'flex', alignItems: 'center', height: 20 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, color: theme.text.muted, width: 36, textAlign: 'right', flexShrink: 0 }}>
              {s.symbol}
            </Typography>
            <Box sx={{ flex: 1, position: 'relative', height: 12, mx: 1 }}>
              <Box sx={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, bgcolor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)' }} />
              <Box sx={{
                position: 'absolute', top: 1, bottom: 1,
                ...(positive ? { left: '50%', width: `${barW}%` } : { right: '50%', width: `${barW}%` }),
                borderRadius: positive ? '0 3px 3px 0' : '3px 0 0 3px',
                bgcolor: `${c}88`, transition: 'width 0.3s',
              }} />
            </Box>
            <Typography sx={{ fontSize: 10, fontWeight: 600, color: c, width: 50, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

/* ═══════════════════ Style Comparison Row ═══════════════════ */

function StyleRow({ comp, theme, isDark }: { comp: StyleComparison; theme: any; isDark: boolean }) {
  const a = comp.a.change_pct ?? 0;
  const b = comp.b.change_pct ?? 0;
  const total = Math.abs(a) + Math.abs(b);
  const aRatio = total > 0 ? (Math.abs(a) / total) * 100 : 50;
  const aWins = a > b;
  const bWins = b > a;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, maxWidth: 420 }}>
      <Box sx={{ minWidth: 95, textAlign: 'right', flexShrink: 0 }}>
        <Typography noWrap sx={{ fontSize: 10, fontWeight: aWins ? 600 : 400, color: aWins ? theme.text.primary : theme.text.muted, lineHeight: 1.3 }}>
          {comp.a.name}
        </Typography>
        <Typography sx={{ fontSize: 9, fontWeight: 600, color: a >= 0 ? SIG.green.color : SIG.red.color, lineHeight: 1.3 }}>
          {a >= 0 ? '+' : ''}{a.toFixed(2)}%
        </Typography>
      </Box>
      <Box sx={{ flex: 1, height: 8, borderRadius: 4, display: 'flex', overflow: 'hidden', bgcolor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }}>
        <Box sx={{ width: `${aRatio}%`, height: '100%', bgcolor: aWins ? `${a >= 0 ? SIG.green.color : SIG.red.color}70` : 'transparent', transition: 'width 0.3s' }} />
        <Box sx={{ width: `${100 - aRatio}%`, height: '100%', bgcolor: bWins ? `${b >= 0 ? SIG.green.color : SIG.red.color}70` : 'transparent', transition: 'width 0.3s' }} />
      </Box>
      <Box sx={{ minWidth: 95, textAlign: 'left', flexShrink: 0 }}>
        <Typography noWrap sx={{ fontSize: 10, fontWeight: bWins ? 600 : 400, color: bWins ? theme.text.primary : theme.text.muted, lineHeight: 1.3 }}>
          {comp.b.name}
        </Typography>
        <Typography sx={{ fontSize: 9, fontWeight: 600, color: b >= 0 ? SIG.green.color : SIG.red.color, lineHeight: 1.3 }}>
          {b >= 0 ? '+' : ''}{b.toFixed(2)}%
        </Typography>
      </Box>
    </Box>
  );
}

/* ═══════════════════ Stat Card (no history) ═══════════════════ */

function StatCard({ ind, theme, isDark }: { ind: Indicator; theme: any; isDark: boolean }) {
  const s = SIG[ind.signal];
  return (
    <Box sx={{
      p: '12px 14px', borderRadius: '8px',
      bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.012)',
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
      height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center',
      transition: 'border-color 0.15s',
      '&:hover': { borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)' },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
        <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: s.color, flexShrink: 0 }} />
        <Typography noWrap sx={{ fontSize: 10, fontWeight: 600, color: theme.text.muted, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          {ind.name}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 700, color: theme.text.primary, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' }}>
          {fmtVal(ind.value, ind.unit)}
        </Typography>
        {ind.change_pct != null && (
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: ind.change_pct >= 0 ? SIG.green.color : SIG.red.color, fontVariantNumeric: 'tabular-nums' }}>
            {fmtChg(ind.change_pct)}
          </Typography>
        )}
      </Box>
      {ind.description && (
        <Typography sx={{ fontSize: 9, color: theme.text.disabled, mt: 0.5, lineHeight: 1.3 }}>
          {ind.description}
        </Typography>
      )}
    </Box>
  );
}

/* ═══════════════════ Detail Panel: Charts ═══════════════════ */

function DetailChartsPanel({ category, indicators, theme, isDark, loading }: {
  category: string; indicators: Indicator[]; theme: any; isDark: boolean; loading: boolean;
}) {
  const meta = CAT_META[category];

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
        <LoadingDots text="Loading charts" fontSize={12} />
      </Box>
    );
  }

  if (!indicators.length) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
        <Typography sx={{ fontSize: 12, color: theme.text.muted }}>No historical data available</Typography>
      </Box>
    );
  }

  const charted = indicators.filter(i => i.history && i.history.length > 3);
  const statOnly = indicators.filter(i => !i.history || i.history.length <= 3);
  const totalCards = charted.length + statOnly.length;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.primary }}>
          {meta.label} Trends
        </Typography>
        <Typography sx={{ fontSize: 10, color: theme.text.disabled, fontStyle: 'italic' }}>
          {meta.question}
        </Typography>
      </Box>
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: totalCards <= 2 ? `repeat(${totalCards}, minmax(220px, 340px))` : 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 1.5,
        alignContent: 'start',
      }}>
        {charted.map(ind => (
          <ChartCard key={ind.id} ind={ind} theme={theme} isDark={isDark} />
        ))}
        {statOnly.map(ind => (
          <StatCard key={ind.id} ind={ind} theme={theme} isDark={isDark} />
        ))}
      </Box>
    </Box>
  );
}

/* ═══════════════════ Detail Panel: Flow ═══════════════════ */

function FlowPanel({ flowData, theme, isDark }: {
  flowData: FlowData | null; theme: any; isDark: boolean;
}) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 2 }}>
      {/* Sector Performance */}
      {flowData && flowData.sectors.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 10, fontWeight: 600, color: theme.text.muted, textTransform: 'uppercase', letterSpacing: '0.8px', mb: 1 }}>
            Sector Performance
          </Typography>
          <Box sx={{
            p: 1.5, borderRadius: '8px',
            bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.012)',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
          }}>
            <SectorBars sectors={flowData.sectors} theme={theme} isDark={isDark} />
          </Box>
        </Box>
      )}

      {/* Style Rotation */}
      {flowData && flowData.style_comparisons.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 10, fontWeight: 600, color: theme.text.muted, textTransform: 'uppercase', letterSpacing: '0.8px', mb: 1 }}>
            Style Rotation
          </Typography>
          <Box sx={{
            p: 1.5, borderRadius: '8px',
            bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.012)',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
            display: 'flex', flexDirection: 'column', gap: '2px',
          }}>
            {flowData.style_comparisons.map(sc => (
              <StyleRow key={sc.label} comp={sc} theme={theme} isDark={isDark} />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

/* ═══════════════════ Main Page ═══════════════════ */

export default function MarketDashboardPage() {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const { isMobile, isSmallScreen } = useResponsive();
  const isCompact = isMobile || isSmallScreen;

  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [flowData, setFlowData] = useState<FlowData | null>(null);
  const [selected, setSelected] = useState<string>('valuation');
  const [detailData, setDetailData] = useState<Record<string, Indicator[]>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [activeView, setActiveView] = useState<'charts' | 'heatmap'>('charts');
  const [heatmapSource, setHeatmapSource] = useState('SPX500');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, fl] = await Promise.all([getDashboardOverview(), getFlowDetail()]);
      if (ov.success) setCategories(ov.data.categories);
      if (fl.success) setFlowData(fl.data);
    } catch (e) {
      console.error('Dashboard fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const selectCategory = useCallback(async (cat: string) => {
    setSelected(cat);
    setActiveView('charts');
    if (cat === 'flow' || detailData[cat]) return;
    setDetailLoading(p => ({ ...p, [cat]: true }));
    try {
      const res = cat === 'valuation' ? await getValuationDetail(52) : await getLiquidityDetail(52);
      if (res.success) setDetailData(p => ({ ...p, [cat]: res.data.indicators }));
    } catch (e) {
      console.error(`Detail fetch error (${cat}):`, e);
    } finally {
      setDetailLoading(p => ({ ...p, [cat]: false }));
    }
  }, [detailData]);

  useEffect(() => {
    if (!loading && categories.length > 0 && !detailData['valuation']) {
      selectCategory('valuation');
    }
  }, [loading, categories, detailData, selectCategory]);

  const sortedCats = [...categories].sort(
    (a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category)
  );

  const selectedCat = sortedCats.find(c => c.category === selected);

  if (loading) {
    return (
      <Box sx={{
        height: isCompact ? 'calc(100vh - 48px)' : '100vh', width: '100%',
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        bgcolor: theme.background.primary, m: isCompact ? -2 : -3,
      }}>
        <LoadingDots text="Loading dashboard" fontSize={14} />
      </Box>
    );
  }

  return (
    <Box sx={{
      height: isCompact ? 'calc(100vh - 48px)' : '100vh',
      width: isCompact ? 'calc(100% + 32px)' : 'calc(100% + 48px)',
      bgcolor: theme.background.primary, color: theme.text.primary,
      m: isCompact ? -2 : -3,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* ─── Header ─── */}
      <Box sx={{
        display: 'grid', gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        px: 2.5, py: 1.25, flexShrink: 0,
        borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
      }}>
        <Typography sx={{ fontSize: 15, fontWeight: 700, color: theme.text.primary, letterSpacing: '-0.3px' }}>
          Market Dashboard
        </Typography>

        {/* View tabs — centered */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          {VIEWS.map(v => (
            <Box
              key={v.key}
              onClick={() => setActiveView(v.key as any)}
              sx={{
                px: 1.25, py: 0.4, borderRadius: '6px', cursor: 'pointer',
                bgcolor: activeView === v.key ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : 'transparent',
                transition: 'all 0.12s',
                '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)' },
              }}
            >
              <Typography sx={{ fontSize: 11, fontWeight: activeView === v.key ? 700 : 500, color: activeView === v.key ? theme.text.primary : theme.text.muted }}>
                {v.label}
              </Typography>
            </Box>
          ))}

          {/* Heatmap source tabs — inline, only when heatmap active */}
          {activeView === 'heatmap' && (
            <Box sx={{
              display: 'flex', alignItems: 'center',
              bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
              borderRadius: '8px', p: '2px', ml: 1,
            }}>
              {HEATMAP_SOURCES.map(s => (
                <Box
                  key={s.key}
                  onClick={() => setHeatmapSource(s.key)}
                  sx={{
                    px: 1.25, py: 0.35, borderRadius: '6px', cursor: 'pointer',
                    bgcolor: heatmapSource === s.key ? (isDark ? 'rgba(255,255,255,0.10)' : '#fff') : 'transparent',
                    boxShadow: heatmapSource === s.key ? (isDark ? 'none' : '0 1px 2px rgba(0,0,0,0.06)') : 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  <Typography sx={{
                    fontSize: 11, fontWeight: heatmapSource === s.key ? 600 : 400,
                    color: heatmapSource === s.key ? theme.text.primary : theme.text.muted,
                    whiteSpace: 'nowrap',
                  }}>
                    {s.label}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        {/* Right: refresh button */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <IconButton onClick={fetchAll} size="small" sx={{ color: theme.text.muted, '&:hover': { color: theme.text.primary } }}>
            <RefreshIcon size={15} />
          </IconButton>
        </Box>
      </Box>

      {/* ─── Content ─── */}
      <Box sx={{
        flex: 1, minHeight: 0, overflowY: 'auto', px: 2.5, py: 2,
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
        '&::-webkit-scrollbar-thumb': { bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', borderRadius: 4 },
      }}>
        {activeView === 'charts' && (
          <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
            {/* ── Signal overview cards ── */}
            <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5 }}>
              {sortedCats.map(cat => (
                <SignalCard
                  key={cat.category}
                  cat={cat}
                  theme={theme}
                  isDark={isDark}
                  active={selected === cat.category}
                  onClick={() => selectCategory(cat.category)}
                />
              ))}
            </Box>

            {/* ── Detail charts ── */}
            {selected !== 'flow' && (
              <DetailChartsPanel
                category={selected}
                indicators={detailData[selected] || []}
                theme={theme}
                isDark={isDark}
                loading={detailLoading[selected] || false}
              />
            )}

            {/* ── Flow data (sectors + style) — always visible ── */}
            {flowData && (flowData.sectors.length > 0 || flowData.style_comparisons.length > 0) && (
              <Box sx={{ mt: selected === 'flow' ? 0 : 2.5 }}>
                <FlowPanel flowData={flowData} theme={theme} isDark={isDark} />
              </Box>
            )}
          </Box>
        )}

        {activeView === 'heatmap' && (
          <Suspense fallback={<LoadingDots text="Loading" fontSize={12} />}>
            {/* Heatmap 高度随视口自适应:
                mobile header + bottom nav 占 ~128px, 桌面仅顶部 ~100px。 */}
            <Box
              sx={{
                height: { xs: 'calc(100vh - 128px)', md: 'calc(100vh - 100px)' },
                mx: { xs: -1.5, md: -2.5 },
                mt: -2,
              }}
            >
              <TradingViewHeatmap theme={theme} isDark={isDark} source={heatmapSource} />
            </Box>
          </Suspense>
        )}
      </Box>
    </Box>
  );
}
