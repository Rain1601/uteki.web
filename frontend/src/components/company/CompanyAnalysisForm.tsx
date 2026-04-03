import { useState } from 'react';
import { Box, TextField, IconButton, Select, MenuItem, FormControl, Typography, Badge } from '@mui/material';
import { Search, ArrowRight, Trash2 } from 'lucide-react';
import { useTheme } from '../../theme/ThemeProvider';
import { invalidateCompanyCache } from '../../api/company';

interface Props {
  onAnalyze: (symbol: string, provider?: string) => void;
  isRunning?: boolean;
  runningCount?: number;
  elapsedMs: number;
}

const MODEL_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'anthropic', label: 'Claude' },
  { value: 'openai', label: 'GPT-4.1' },
  { value: 'google', label: 'Gemini' },
  { value: 'qwen', label: 'Qwen' },
];

export default function CompanyAnalysisForm({ onAnalyze, runningCount = 0 }: Props) {
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

  const hasSymbol = symbol.trim().length > 0;

  return (
    <Box
      sx={{
        position: 'relative',
        bgcolor: theme.background.secondary,
        border: `1px solid ${theme.border.default}`,
        borderRadius: '10px',
        overflow: 'hidden',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        '&:focus-within': {
          borderColor: theme.border.active,
          boxShadow: `0 0 0 3px ${theme.brand.primary}10`,
        },
      }}
    >
      {/* Input row */}
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <TextField
          fullWidth
          size="small"
          placeholder="输入股票代码  AAPL, TSLA, 700.HK ..."
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          sx={{
            '& .MuiOutlinedInput-root': {
              bgcolor: 'transparent',
              fontSize: '0.95rem',
              fontWeight: 500,
              color: theme.text.primary,
              letterSpacing: '0.03em',
              '& fieldset': { border: 'none' },
              '&:hover fieldset': { border: 'none' },
              '&.Mui-focused fieldset': { border: 'none' },
            },
            '& .MuiInputBase-input': {
              py: 1.5,
              px: 2,
              '&::placeholder': {
                color: theme.text.muted,
                opacity: 0.5,
                fontWeight: 400,
                letterSpacing: '0.01em',
              },
            },
          }}
        />
      </Box>

      {/* Bottom toolbar */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          px: 1.5,
          pb: 1,
        }}
      >
        {/* Left: model selector + cache clear */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <FormControl size="small">
            <Select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              displayEmpty
              sx={{
                color: theme.text.muted,
                fontSize: 12,
                height: 28,
                bgcolor: 'transparent',
                '& fieldset': { border: 'none' },
                '&:hover': { color: theme.text.secondary },
                '& .MuiSvgIcon-root': { color: theme.text.disabled, fontSize: 16 },
                '& .MuiSelect-select': { py: 0.25, pl: 1, pr: 3 },
              }}
            >
              {MODEL_OPTIONS.map((p) => (
                <MenuItem key={p.value} value={p.value} sx={{ fontSize: 12 }}>
                  {p.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {hasSymbol && (
            <Box
              onClick={handleClearCache}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.4,
                px: 1,
                py: 0.25,
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.7rem',
                color: theme.text.disabled,
                transition: 'all 0.15s',
                '&:hover': { color: theme.status.warning, bgcolor: `${theme.status.warning}10` },
              }}
            >
              <Trash2 size={11} />
              <span>清缓存</span>
            </Box>
          )}
        </Box>

        {/* Right: running badge + submit */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {runningCount > 0 && (
            <Typography sx={{
              fontSize: 11,
              color: theme.brand.primary,
              fontWeight: 500,
              px: 1,
              py: 0.25,
              borderRadius: '8px',
              bgcolor: `${theme.brand.primary}10`,
            }}>
              {runningCount} running
            </Typography>
          )}

          <IconButton
            onClick={handleSubmit}
            disabled={!hasSymbol}
            sx={{
              width: 32,
              height: 32,
              borderRadius: '10px',
              bgcolor: hasSymbol ? theme.brand.primary : 'transparent',
              color: hasSymbol ? '#fff' : theme.text.disabled,
              transition: 'all 0.2s',
              '&:hover': {
                bgcolor: hasSymbol ? theme.brand.hover : 'transparent',
              },
              '&.Mui-disabled': { color: theme.text.disabled },
            }}
          >
            <ArrowRight size={16} />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}
