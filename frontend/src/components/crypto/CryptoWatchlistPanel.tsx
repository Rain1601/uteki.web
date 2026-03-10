import { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { useTheme } from '../../theme/ThemeProvider';

/* ── Symbol definitions ─────────────────────────────────── */

interface CryptoSymbol {
  label: string;            // Display name in the list
  tradingview: string;       // TradingView widget symbol
  subtitle?: string;
}

const SYMBOLS: CryptoSymbol[] = [
  { label: 'BTC / USDT',  tradingview: 'BINANCE:BTCUSDT',  subtitle: 'Bitcoin' },
  { label: 'ETH / USDT',  tradingview: 'BINANCE:ETHUSDT',  subtitle: 'Ethereum' },
  { label: 'SOL / USDT',  tradingview: 'BINANCE:SOLUSDT',  subtitle: 'Solana' },
  { label: 'HYPE / USDT', tradingview: 'KUCOIN:HYPEUSDT',  subtitle: 'Hyperliquid' },
  { label: 'BTC.D',       tradingview: 'CRYPTOCAP:BTC.D',  subtitle: 'BTC Dominance' },
];

/* ── Single TradingView embed (renders once, never unmounts) ── */

function TradingViewEmbed({
  symbol,
  isDark,
}: {
  symbol: string;
  isDark: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current || !containerRef.current) return;
    mountedRef.current = true;

    const wrapper = document.createElement('div');
    wrapper.className = 'tradingview-widget-container';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';

    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container__widget';
    widgetDiv.style.width = '100%';
    widgetDiv.style.height = '100%';
    wrapper.appendChild(widgetDiv);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src =
      'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.textContent = JSON.stringify({
      symbol,
      interval: 'D',
      timezone: 'Etc/UTC',
      theme: isDark ? 'dark' : 'light',
      style: '1',
      locale: 'zh_CN',
      allow_symbol_change: false,
      hide_top_toolbar: false,
      hide_side_toolbar: false,
      studies: [
        'MAExp@tv-basicstudies',
        'MASimple@tv-basicstudies',
      ],
      studies_overrides: {
        'moving average exponential.length': 20,
        'moving average.length': 50,
      },
      width: '100%',
      height: '100%',
    });

    wrapper.appendChild(script);
    containerRef.current.appendChild(wrapper);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        bgcolor: isDark ? '#131722' : '#fff',
      }}
    />
  );
}

/* ── CryptoWatchlistPanel ──────────────────────────────── */

export default function CryptoWatchlistPanel() {
  const { theme, isDark } = useTheme();
  const [selectedIdx, setSelectedIdx] = useState(0);
  // Track which symbols have been visited so we lazy-mount their widgets
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));

  const handleSelect = useCallback((idx: number) => {
    setSelectedIdx(idx);
    setVisited((prev) => {
      if (prev.has(idx)) return prev;
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  }, []);

  return (
    <Box sx={{ display: 'flex', gap: 0, position: 'absolute', inset: 0 }}>
      {/* ── Left: Symbol List ── */}
      <Box
        sx={{
          width: 200,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: `1px solid ${theme.border.subtle}`,
          px: 2,
          py: 2,
        }}
      >
        <Typography
          sx={{ fontSize: 11, fontWeight: 600, color: theme.text.muted, mb: 1.5, px: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}
        >
          Watchlist
        </Typography>

        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {SYMBOLS.map((sym, idx) => (
            <Box
              key={sym.tradingview}
              onClick={() => handleSelect(idx)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                px: 1.5,
                py: 1,
                mb: 0.5,
                borderRadius: 1,
                cursor: 'pointer',
                bgcolor:
                  selectedIdx === idx
                    ? isDark
                      ? 'rgba(100,149,237,0.15)'
                      : 'rgba(100,149,237,0.1)'
                    : 'transparent',
                border:
                  selectedIdx === idx
                    ? '1px solid rgba(100,149,237,0.3)'
                    : '1px solid transparent',
                '&:hover': {
                  bgcolor:
                    selectedIdx === idx
                      ? undefined
                      : isDark
                        ? 'rgba(255,255,255,0.04)'
                        : 'rgba(0,0,0,0.02)',
                },
              }}
            >
              <Box>
                <Typography
                  sx={{
                    fontSize: 13,
                    fontWeight: selectedIdx === idx ? 600 : 500,
                    color:
                      selectedIdx === idx
                        ? theme.brand.primary
                        : theme.text.primary,
                  }}
                >
                  {sym.label}
                </Typography>
                {sym.subtitle && (
                  <Typography sx={{ fontSize: 10, color: theme.text.muted }}>
                    {sym.subtitle}
                  </Typography>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ── Center: Cached TradingView Charts ── */}
      <Box sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {SYMBOLS.map((sym, idx) =>
          visited.has(idx) ? (
            <Box
              key={sym.tradingview}
              sx={{
                position: 'absolute',
                inset: 0,
                // Show only the selected chart; others stay mounted but hidden
                visibility: selectedIdx === idx ? 'visible' : 'hidden',
                // Pointer events off for hidden charts so they don't capture clicks
                pointerEvents: selectedIdx === idx ? 'auto' : 'none',
              }}
            >
              <TradingViewEmbed symbol={sym.tradingview} isDark={isDark} />
            </Box>
          ) : null,
        )}
      </Box>
    </Box>
  );
}
