import { useState } from 'react';
import { Box, TextField, Button, Select, MenuItem, FormControl, Typography, Badge } from '@mui/material';
import { Search, Trash2 } from 'lucide-react';
import { useTheme } from '../../theme/ThemeProvider';
import { invalidateCompanyCache } from '../../api/company';

interface Props {
  onAnalyze: (symbol: string, provider?: string) => void;
  isRunning?: boolean;
  runningCount?: number;
  elapsedMs: number;
}

const PROVIDERS = [
  { value: '', label: '自动选择' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI (GPT-4o)' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'qwen', label: '通义千问' },
];

export default function CompanyAnalysisForm({ onAnalyze, runningCount = 0, elapsedMs }: Props) {
  const { theme } = useTheme();
  const [symbol, setSymbol] = useState('');
  const [provider, setProvider] = useState('');

  const handleSubmit = () => {
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    onAnalyze(s, provider || undefined);
  };

  const handleClearCache = async () => {
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    try {
      await invalidateCompanyCache(s);
    } catch { /* ignore */ }
  };

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`;
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      <TextField
        size="small"
        placeholder="输入股票代码 (如 AAPL, TSLA)"
        value={symbol}
        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        sx={{
          width: 240,
          '& .MuiOutlinedInput-root': {
            color: theme.text.primary,
            bgcolor: theme.background.tertiary,
            '& fieldset': { borderColor: theme.border.default },
            '&:hover fieldset': { borderColor: theme.border.hover },
            '&.Mui-focused fieldset': { borderColor: theme.brand.primary },
          },
          '& .MuiInputBase-input': { fontSize: 14 },
        }}
      />

      <FormControl size="small" sx={{ minWidth: 160 }}>
        <Select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          displayEmpty
          sx={{
            color: theme.text.primary,
            bgcolor: theme.background.tertiary,
            fontSize: 13,
            '& fieldset': { borderColor: theme.border.default },
            '&:hover fieldset': { borderColor: theme.border.hover },
            '& .MuiSvgIcon-root': { color: theme.text.muted },
          }}
        >
          {PROVIDERS.map((p) => (
            <MenuItem key={p.value} value={p.value} sx={{ fontSize: 13 }}>
              {p.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Badge
        badgeContent={runningCount > 0 ? runningCount : undefined}
        color="primary"
        sx={{
          '& .MuiBadge-badge': {
            fontSize: 10,
            height: 16,
            minWidth: 16,
          },
        }}
      >
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!symbol.trim()}
          startIcon={<Search size={16} />}
          sx={{
            bgcolor: theme.button.primary.bg,
            color: theme.button.primary.text,
            textTransform: 'none',
            fontWeight: 600,
            fontSize: 13,
            px: 2.5,
            '&:hover': { bgcolor: theme.button.primary.hover },
            '&.Mui-disabled': { bgcolor: theme.background.hover, color: theme.text.disabled },
          }}
        >
          开始分析
        </Button>
      </Badge>

      {symbol.trim() && (
        <Button
          size="small"
          onClick={handleClearCache}
          startIcon={<Trash2 size={14} />}
          sx={{
            color: theme.text.muted,
            textTransform: 'none',
            fontSize: 12,
            '&:hover': { color: theme.status.warning },
          }}
        >
          清除缓存
        </Button>
      )}

      {runningCount > 0 && elapsedMs > 0 && (
        <Typography sx={{ fontSize: 13, color: theme.text.muted, fontFamily: 'monospace' }}>
          {formatTime(elapsedMs)}
        </Typography>
      )}
    </Box>
  );
}
