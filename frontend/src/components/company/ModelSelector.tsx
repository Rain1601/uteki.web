import { useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Radio,
  Checkbox,
  Avatar,
  Rating,
  Switch,
  FormControlLabel,
  Tooltip,
} from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Zap, Timer, Clock } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  providerColor: string;
  speed: 'fast' | 'medium' | 'slow';
  cost: 1 | 2 | 3;
  quality: number;
}

export interface ModelSelectorProps {
  selectedModel: string;
  onSelect: (model: string) => void;
  compareMode: boolean;
  selectedModels: string[];
  onToggleCompare: () => void;
  onCompareSelect: (models: string[]) => void;
}

/* ------------------------------------------------------------------ */
/*  Mock model data                                                    */
/* ------------------------------------------------------------------ */

export const MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    providerColor: '#D97757',
    speed: 'medium',
    cost: 3,
    quality: 4.5,
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    provider: 'DeepSeek',
    providerColor: '#4D6BFE',
    speed: 'fast',
    cost: 1,
    quality: 4.0,
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'OpenAI',
    providerColor: '#10A37F',
    speed: 'medium',
    cost: 2,
    quality: 4.3,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    providerColor: '#4285F4',
    speed: 'fast',
    cost: 2,
    quality: 4.2,
  },
  {
    id: 'qwen-plus',
    name: 'Qwen Plus',
    provider: 'Alibaba',
    providerColor: '#FF6A00',
    speed: 'fast',
    cost: 1,
    quality: 3.8,
  },
];

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function SpeedChip({ speed }: { speed: ModelInfo['speed'] }) {
  const cfg = {
    fast: { icon: <Zap size={14} />, label: 'Fast', color: '#4ade80' },
    medium: { icon: <Timer size={14} />, label: 'Medium', color: '#facc15' },
    slow: { icon: <Clock size={14} />, label: 'Slow', color: '#f87171' },
  }[speed];

  return (
    <Chip
      icon={
        <span className="flex items-center" style={{ color: cfg.color }}>
          {cfg.icon}
        </span>
      }
      label={cfg.label}
      size="small"
      variant="outlined"
      sx={{
        borderColor: cfg.color + '40',
        color: cfg.color,
        fontSize: '0.7rem',
        height: 24,
        '& .MuiChip-icon': { ml: '4px' },
      }}
    />
  );
}

function CostChip({ cost }: { cost: number }) {
  const label = '$'.repeat(cost);
  const color = cost === 1 ? '#4ade80' : cost === 2 ? '#facc15' : '#f87171';
  return (
    <Chip
      label={label}
      size="small"
      sx={{
        bgcolor: color + '18',
        color,
        fontWeight: 700,
        fontSize: '0.7rem',
        height: 24,
        minWidth: 40,
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ModelSelector({
  selectedModel,
  onSelect,
  compareMode,
  selectedModels,
  onToggleCompare,
  onCompareSelect,
}: ModelSelectorProps) {
  const isSelected = useMemo(
    () => (id: string) => (compareMode ? selectedModels.includes(id) : selectedModel === id),
    [compareMode, selectedModels, selectedModel],
  );

  const handleClick = (id: string) => {
    if (compareMode) {
      const next = selectedModels.includes(id)
        ? selectedModels.filter((m) => m !== id)
        : [...selectedModels, id];
      onCompareSelect(next);
    } else {
      onSelect(id);
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box className="flex items-center justify-between mb-4">
        <Typography variant="h6" sx={{ fontWeight: 600, color: '#e2e8f0' }}>
          Select Model
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={compareMode}
              onChange={onToggleCompare}
              size="small"
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': { color: '#818cf8' },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                  bgcolor: '#818cf8',
                },
              }}
            />
          }
          label={
            <Typography variant="caption" sx={{ color: '#94a3b8' }}>
              Compare Mode
            </Typography>
          }
        />
      </Box>

      {compareMode && selectedModels.length > 0 && (
        <Typography variant="caption" sx={{ color: '#64748b', mb: 1, display: 'block' }}>
          {selectedModels.length} model{selectedModels.length !== 1 ? 's' : ''} selected
        </Typography>
      )}

      {/* Model Cards */}
      <Box className="flex flex-col gap-2">
        <AnimatePresence>
          {MODELS.map((model) => {
            const active = isSelected(model.id);
            return (
              <motion.div
                key={model.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.995 }}
              >
                <Card
                  onClick={() => handleClick(model.id)}
                  sx={{
                    cursor: 'pointer',
                    bgcolor: active ? '#1e1b4b' : '#0f172a',
                    border: '1px solid',
                    borderColor: active ? '#818cf8' : '#1e293b',
                    borderRadius: 2,
                    transition: 'border-color 0.2s, background-color 0.2s',
                    '&:hover': {
                      borderColor: active ? '#818cf8' : '#334155',
                      bgcolor: active ? '#1e1b4b' : '#1e293b30',
                    },
                    position: 'relative',
                    overflow: 'visible',
                  }}
                  elevation={0}
                >
                  {/* Checkmark badge */}
                  <AnimatePresence>
                    {active && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        style={{
                          position: 'absolute',
                          top: -6,
                          right: -6,
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: '#818cf8',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          zIndex: 1,
                        }}
                      >
                        <Check size={14} color="#fff" />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                    <Box className="flex items-center gap-3">
                      {/* Radio / Checkbox */}
                      <Box sx={{ flexShrink: 0 }}>
                        {compareMode ? (
                          <Checkbox
                            checked={active}
                            size="small"
                            sx={{
                              color: '#475569',
                              '&.Mui-checked': { color: '#818cf8' },
                              p: 0,
                            }}
                          />
                        ) : (
                          <Radio
                            checked={active}
                            size="small"
                            sx={{
                              color: '#475569',
                              '&.Mui-checked': { color: '#818cf8' },
                              p: 0,
                            }}
                          />
                        )}
                      </Box>

                      {/* Provider avatar */}
                      <Tooltip title={model.provider} arrow>
                        <Avatar
                          sx={{
                            width: 32,
                            height: 32,
                            bgcolor: model.providerColor + '20',
                            color: model.providerColor,
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {model.provider.slice(0, 2).toUpperCase()}
                        </Avatar>
                      </Tooltip>

                      {/* Name + provider label */}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 600,
                            color: '#e2e8f0',
                            lineHeight: 1.3,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {model.name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#64748b', lineHeight: 1.2 }}>
                          {model.provider}
                        </Typography>
                      </Box>

                      {/* Badges row */}
                      <Box className="flex items-center gap-2 flex-shrink-0">
                        <SpeedChip speed={model.speed} />
                        <CostChip cost={model.cost} />
                        <Rating
                          value={model.quality}
                          precision={0.1}
                          readOnly
                          size="small"
                          sx={{
                            '& .MuiRating-iconFilled': { color: '#facc15' },
                            '& .MuiRating-iconEmpty': { color: '#334155' },
                          }}
                        />
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </Box>
    </Box>
  );
}
