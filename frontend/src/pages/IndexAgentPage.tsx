import { useState } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import { Dices as ArenaIcon, LineChart as WatchlistIcon, GitBranch as TimelineIcon, Trophy as LeaderboardIcon, Settings as SettingsIcon, BarChart3 as BacktestIcon, Sparkles as EvaluationIcon, Brain as LLMBacktestIcon } from 'lucide-react';
import { useTheme } from '../theme/ThemeProvider';
import PageHeader from '../components/PageHeader';
import ArenaView from '../components/index/ArenaView';
import WatchlistPanel from '../components/index/WatchlistPanel';
import DecisionTimeline from '../components/index/DecisionTimeline';
import LeaderboardTable from '../components/index/LeaderboardTable';
import SettingsPanel from '../components/index/SettingsPanel';
import BacktestPanel from '../components/index/BacktestPanel';
import LLMBacktestPanel from '../components/index/LLMBacktestPanel';
import EvaluationPanel from '../components/index/EvaluationPanel';

const tabs = [
  { label: 'Arena', icon: <ArenaIcon size={15} /> },
  { label: 'Watchlist', icon: <WatchlistIcon size={15} /> },
  { label: 'History', icon: <TimelineIcon size={15} /> },
  { label: 'Leaderboard', icon: <LeaderboardIcon size={15} /> },
  { label: 'LLM Backtest', icon: <LLMBacktestIcon size={15} /> },
  { label: 'DCA Backtest', icon: <BacktestIcon size={15} /> },
  { label: 'Evaluation', icon: <EvaluationIcon size={15} /> },
  { label: 'Settings', icon: <SettingsIcon size={15} /> },
];

export default function IndexAgentPage() {
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
      <PageHeader title="Index Agent" />

      {/* Tabs */}
      <Box sx={{ px: 2, borderBottom: `1px solid ${theme.border.subtle}` }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 38,
            '& .MuiTab-root': {
              color: theme.text.muted,
              textTransform: 'none',
              fontWeight: 500,
              fontSize: 12.5,
              minHeight: 38,
              py: 0,
              px: 1.5,
              gap: 0.5,
              opacity: 0.7,
              transition: 'opacity 0.15s',
              '&:hover': { opacity: 1 },
            },
            '& .Mui-selected': {
              color: `${theme.text.primary} !important`,
              fontWeight: 600,
              opacity: 1,
            },
            '& .MuiTabs-indicator': {
              bgcolor: theme.brand.primary,
              height: 2,
              borderRadius: '2px 2px 0 0',
            },
            '& .MuiTabs-scrollButtons': {
              color: theme.text.muted,
              '&.Mui-disabled': { opacity: 0.2 },
            },
          }}
        >
          {tabs.map((t) => (
            <Tab key={t.label} label={t.label} icon={t.icon} iconPosition="start" />
          ))}
        </Tabs>
      </Box>

      {/* Tab Content */}
      <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {activeTab === 0 && <ArenaView />}
        {activeTab === 1 && <WatchlistPanel />}
        {activeTab === 2 && <DecisionTimeline />}
        {activeTab === 3 && <LeaderboardTable />}
        {activeTab === 4 && <LLMBacktestPanel />}
        {activeTab === 5 && <BacktestPanel />}
        {activeTab === 6 && <EvaluationPanel onNavigate={setActiveTab} />}
        {activeTab === 7 && <SettingsPanel />}
      </Box>
    </Box>
  );
}
