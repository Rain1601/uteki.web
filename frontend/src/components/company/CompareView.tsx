import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import { X, Loader2 } from 'lucide-react';
import { useTheme } from '../../theme/ThemeProvider';
import { compareModelsStream, GATE_NAMES } from '../../api/company';

interface Props {
  symbol: string;
  models: string[];
  onClose: () => void;
}

interface ModelState {
  model: string;
  status: 'streaming' | 'complete' | 'error';
  currentGate: number | null;
  gateTexts: Record<number, string>;
  verdict?: { action: string; conviction: number; quality_verdict: string };
  error?: string;
}

const ACTION_COLORS: Record<string, string> = {
  BUY: '#22c55e', WATCH: '#f59e0b', AVOID: '#ef4444',
};

export default function CompareView({ symbol, models, onClose }: Props) {
  const { theme } = useTheme();
  const [modelStates, setModelStates] = useState<Record<string, ModelState>>({});
  const cancelRef = useRef<(() => void) | null>(null);

  const updateModel = useCallback((model: string, updater: (prev: ModelState) => ModelState) => {
    setModelStates((prev) => ({
      ...prev,
      [model]: updater(prev[model] || { model, status: 'streaming', currentGate: null, gateTexts: {} }),
    }));
  }, []);

  useEffect(() => {
    // Initialize states
    const initial: Record<string, ModelState> = {};
    for (const m of models) {
      initial[m] = { model: m, status: 'streaming', currentGate: null, gateTexts: {} };
    }
    setModelStates(initial);

    const stream = compareModelsStream({ symbol, models }, (event) => {
      const model = event.model || event.provider || models[0];

      switch (event.type) {
        case 'gate_start':
          updateModel(model, (s) => ({ ...s, currentGate: event.gate }));
          break;
        case 'gate_text':
          if (event.gate != null && event.text) {
            updateModel(model, (s) => ({
              ...s,
              gateTexts: {
                ...s.gateTexts,
                [event.gate!]: (s.gateTexts[event.gate!] || '') + event.text,
              },
            }));
          }
          break;
        case 'gate_complete':
          if (event.gate != null && event.raw) {
            updateModel(model, (s) => ({
              ...s,
              gateTexts: { ...s.gateTexts, [event.gate!]: event.raw },
            }));
          }
          break;
        case 'result':
          updateModel(model, (s) => ({
            ...s,
            status: 'complete',
            verdict: event.data?.verdict || event.verdict,
          }));
          break;
        case 'error':
          updateModel(model, (s) => ({
            ...s,
            status: 'error',
            error: event.message || 'Error',
          }));
          break;
      }
    });

    cancelRef.current = stream.cancel;
    return () => { stream.cancel(); };
  }, [symbol, models.join(',')]);

  const handleClose = () => {
    cancelRef.current?.();
    onClose();
  };

  const allComplete = Object.values(modelStates).every((s) => s.status === 'complete' || s.status === 'error');
  const colWidth = `${100 / models.length}%`;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: theme.background.primary }}>
      {/* Header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        px: 2, py: 1, borderBottom: `1px solid ${theme.border.subtle}`, flexShrink: 0,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: theme.text.primary }}>
            {symbol} 多模型对比
          </Typography>
          <Typography sx={{ fontSize: 11, color: theme.text.muted }}>
            {models.length} 模型
          </Typography>
          {!allComplete && <Loader2 size={14} color={theme.brand.primary} style={{ animation: 'spin 1s linear infinite' }} />}
        </Box>
        <Box onClick={handleClose} sx={{ cursor: 'pointer', p: 0.5, borderRadius: 1, color: theme.text.disabled, '&:hover': { bgcolor: theme.background.hover } }}>
          <X size={16} />
        </Box>
      </Box>

      {/* Comparison columns */}
      <Box sx={{ flex: 1, overflow: 'auto', display: 'flex' }}>
        {models.map((model, idx) => {
          const state = modelStates[model];
          if (!state) return null;

          return (
            <Box
              key={model}
              sx={{
                width: colWidth,
                borderRight: idx < models.length - 1 ? `1px solid ${theme.border.subtle}` : 'none',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
              }}
            >
              {/* Model header */}
              <Box sx={{
                px: 1.5, py: 1, borderBottom: `1px solid ${theme.border.subtle}`,
                bgcolor: theme.background.secondary, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: theme.text.primary }}>
                  {model}
                </Typography>
                {state.status === 'streaming' && state.currentGate && (
                  <Typography sx={{ fontSize: 10, color: theme.brand.primary }}>
                    G{state.currentGate} {GATE_NAMES[state.currentGate] || ''}
                  </Typography>
                )}
                {state.status === 'error' && (
                  <Typography sx={{ fontSize: 10, color: '#f44336' }}>Error</Typography>
                )}
              </Box>

              {/* Verdict card (when complete) */}
              {state.verdict && (
                <Box sx={{
                  mx: 1.5, mt: 1.5, p: 1.5, borderRadius: 1,
                  bgcolor: `${ACTION_COLORS[state.verdict.action] || theme.text.muted}08`,
                  border: `1px solid ${ACTION_COLORS[state.verdict.action] || theme.border.subtle}30`,
                  flexShrink: 0,
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography sx={{
                      fontSize: 16, fontWeight: 800,
                      color: ACTION_COLORS[state.verdict.action] || theme.text.primary,
                    }}>
                      {state.verdict.action}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: theme.text.muted }}>
                      {Math.round((state.verdict.conviction || 0) * 100)}% conviction
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: 10, color: theme.text.disabled, mt: 0.25 }}>
                    {state.verdict.quality_verdict || ''}
                  </Typography>
                </Box>
              )}

              {/* Gate texts */}
              <Box sx={{
                flex: 1, overflow: 'auto', px: 1.5, py: 1,
                '&::-webkit-scrollbar': { width: 3 },
                '&::-webkit-scrollbar-thumb': { bgcolor: `${theme.text.muted}18`, borderRadius: 4 },
              }}>
                {Object.entries(state.gateTexts).map(([gate, text]) => (
                  <Box key={gate} sx={{ mb: 1.5 }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 700, color: theme.text.muted, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      G{gate} {GATE_NAMES[Number(gate)] || ''}
                    </Typography>
                    <Typography sx={{
                      fontSize: 11, color: theme.text.secondary, lineHeight: 1.7,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {text.slice(0, 500)}{text.length > 500 ? '...' : ''}
                    </Typography>
                  </Box>
                ))}

                {state.status === 'error' && (
                  <Typography sx={{ fontSize: 11, color: '#f44336', py: 2, textAlign: 'center' }}>
                    {state.error}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Comparison summary table (when all complete) */}
      {allComplete && Object.values(modelStates).some((s) => s.verdict) && (
        <Box sx={{
          borderTop: `1px solid ${theme.border.subtle}`,
          px: 2, py: 1.5, flexShrink: 0,
        }}>
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.text.disabled, mb: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            对比总结
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {models.map((model) => {
              const state = modelStates[model];
              const v = state?.verdict;
              if (!v) return null;
              const actionColor = ACTION_COLORS[v.action] || theme.text.muted;
              const allSame = models.every((m) => modelStates[m]?.verdict?.action === v.action);

              return (
                <Box
                  key={model}
                  sx={{
                    flex: 1, p: 1.25, borderRadius: 1,
                    bgcolor: theme.background.secondary,
                    border: `1px solid ${allSame ? theme.border.subtle : `${actionColor}40`}`,
                  }}
                >
                  <Typography sx={{ fontSize: 10, color: theme.text.disabled, mb: 0.5 }}>{model}</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 800, color: actionColor }}>{v.action}</Typography>
                    <Typography sx={{ fontSize: 11, color: theme.text.muted }}>{Math.round((v.conviction || 0) * 100)}%</Typography>
                    <Typography sx={{ fontSize: 10, color: theme.text.disabled }}>{v.quality_verdict}</Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* Disagreement highlight */}
          {(() => {
            const actions = models.map((m) => modelStates[m]?.verdict?.action).filter(Boolean);
            const unique = new Set(actions);
            if (unique.size > 1) {
              return (
                <Box sx={{ mt: 1, px: 1, py: 0.75, borderRadius: 1, bgcolor: 'rgba(244,67,54,0.06)', border: '1px solid rgba(244,67,54,0.15)' }}>
                  <Typography sx={{ fontSize: 11, color: '#f44336', fontWeight: 600 }}>
                    模型分歧: {Array.from(unique).join(' vs ')}
                  </Typography>
                </Box>
              );
            }
            return null;
          })()}
        </Box>
      )}
    </Box>
  );
}
