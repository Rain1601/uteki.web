import { useState } from 'react';
import { Box, Typography, Tabs, Tab } from '@mui/material';
import {
  Dices as ArenaIcon,
  Bitcoin as WatchlistIcon,
  GitBranch as TimelineIcon,
  Trophy as LeaderboardIcon,
  Settings as SettingsIcon,
  BarChart3 as BacktestIcon,
  Sparkles as EvaluationIcon,
} from 'lucide-react';
import { useTheme } from '../theme/ThemeProvider';
import CryptoWatchlistPanel from '../components/crypto/CryptoWatchlistPanel';

const tabs = [
  { label: 'Arena', icon: <ArenaIcon size={18} /> },
  { label: 'Watchlist', icon: <WatchlistIcon size={18} /> },
  { label: 'History', icon: <TimelineIcon size={18} /> },
  { label: 'Leaderboard', icon: <LeaderboardIcon size={18} /> },
  { label: 'Backtest', icon: <BacktestIcon size={18} /> },
  { label: 'Evaluation', icon: <EvaluationIcon size={18} /> },
  { label: 'Settings', icon: <SettingsIcon size={18} /> },
];

function Placeholder({ label }: { label: string }) {
  const { theme } = useTheme();
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 1,
        color: theme.text.muted,
      }}
    >
      <Typography sx={{ fontSize: 16, fontWeight: 500 }}>Crypto Agent — {label}</Typography>
      <Typography sx={{ fontSize: 13 }}>开发中...</Typography>
    </Box>
  );
}

export default function CryptoAgentPage() {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState(0);

  return (
    <Box
      sx={{
        m: -3,
        height: 'calc(100vh - 48px)',
        width: 'calc(100% + 48px)',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: theme.background.primary,
        color: theme.text.primary,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          px: 3,
          pt: 3,
          pb: 1.5,
        }}
      >
        <Typography sx={{ fontSize: 24, fontWeight: 600 }}>
          Crypto Investment Agent
        </Typography>
      </Box>

      {/* Tabs */}
      <Box sx={{ px: 3, borderBottom: `1px solid ${theme.border.subtle}` }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          sx={{
            minHeight: 40,
            '& .MuiTab-root': {
              color: theme.text.muted,
              textTransform: 'none',
              fontWeight: 600,
              fontSize: 13,
              minHeight: 40,
              py: 0,
              gap: 0.5,
            },
            '& .Mui-selected': { color: theme.brand.primary },
            '& .MuiTabs-indicator': { bgcolor: theme.brand.primary },
          }}
        >
          {tabs.map((t) => (
            <Tab key={t.label} label={t.label} icon={t.icon} iconPosition="start" />
          ))}
        </Tabs>
      </Box>

      {/* Tab Content */}
      <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* Keep watchlist mounted so cached TradingView widgets survive tab switches */}
        <Box sx={{ position: 'absolute', inset: 0, display: activeTab === 1 ? 'block' : 'none' }}>
          <CryptoWatchlistPanel />
        </Box>
        {activeTab !== 1 && <Placeholder label={tabs[activeTab].label} />}
      </Box>
    </Box>
  );
}