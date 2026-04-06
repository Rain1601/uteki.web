import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Collapse,
  IconButton,
  Alert,
  AlertTitle,
  Divider,
} from '@mui/material';
import {
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle,
  RotateCcw,
  Lightbulb,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';

// ── Types ──

export interface ReflectionData {
  afterGate: number;
  contradictions: string[];
  downstreamHints: string[];
  needsRevisit: number | null;
  raw: string;
}

interface ReflectionCardProps {
  reflection: ReflectionData;
  index?: number;
}

// ── Colors ──

const COLORS = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  orange: '#f97316',
  blue: '#3b82f6',
  bg: '#1a1a2e',
  bgCard: '#16213e',
  bgSurface: '#0f3460',
  textPrimary: '#e2e8f0',
  textSecondary: '#94a3b8',
  border: '#334155',
};

// ── Gate Names ──

const GATE_LABELS: Record<number, string> = {
  1: 'Business Analysis',
  2: 'Fisher 15Q',
  3: 'Moat Assessment',
  4: 'Management',
  5: 'Reverse Test',
  6: 'Valuation',
  7: 'Final Verdict',
};

// ── Helpers ──

function getSeverityColor(reflection: ReflectionData): string {
  if (reflection.needsRevisit !== null) return COLORS.red;
  if (reflection.contradictions.length > 0) return COLORS.orange;
  return COLORS.green;
}

function getSeverityLabel(reflection: ReflectionData): string {
  if (reflection.needsRevisit !== null) return 'Revisit Required';
  if (reflection.contradictions.length > 0) return 'Contradictions Found';
  return 'Consistent';
}

// ── Pipeline Visualization ──

interface PipelineNodeProps {
  gate: number;
  isReflection?: boolean;
  reflectionStatus?: 'green' | 'amber' | 'red';
  isActive?: boolean;
}

function PipelineNode({ gate, isReflection, reflectionStatus, isActive }: PipelineNodeProps) {
  if (isReflection) {
    const color =
      reflectionStatus === 'red'
        ? COLORS.red
        : reflectionStatus === 'amber'
          ? COLORS.orange
          : COLORS.green;
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Box sx={{ width: 20, height: 2, bgcolor: COLORS.border }} />
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
        >
          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: `2px solid ${color}`,
              bgcolor: `${color}15`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'default',
            }}
            title={`Reflection after Gate ${gate}`}
          >
            <Zap size={14} color={color} />
          </Box>
        </motion.div>
        <Box sx={{ width: 20, height: 2, bgcolor: COLORS.border }} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {gate > 1 && <Box sx={{ width: 20, height: 2, bgcolor: COLORS.border }} />}
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: '8px',
          bgcolor: isActive ? COLORS.bgSurface : COLORS.bgCard,
          border: `1px solid ${isActive ? COLORS.orange : COLORS.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s',
        }}
        title={GATE_LABELS[gate]}
      >
        <Typography
          variant="caption"
          sx={{ color: isActive ? COLORS.orange : COLORS.textSecondary, fontWeight: 600 }}
        >
          {gate}
        </Typography>
      </Box>
    </Box>
  );
}

export function GatePipelineView({ reflections }: { reflections: ReflectionData[] }) {
  const r3 = reflections.find((r) => r.afterGate === 3);
  const r5 = reflections.find((r) => r.afterGate === 5);

  function getStatus(r?: ReflectionData): 'green' | 'amber' | 'red' {
    if (!r) return 'green';
    if (r.needsRevisit !== null) return 'red';
    if (r.contradictions.length > 0) return 'amber';
    return 'green';
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 0,
        py: 2,
        px: 1,
      }}
    >
      <PipelineNode gate={1} />
      <PipelineNode gate={2} />
      <PipelineNode gate={3} isActive={r3 !== undefined && r3.contradictions.length > 0} />
      <PipelineNode gate={3} isReflection reflectionStatus={getStatus(r3)} />
      <PipelineNode gate={4} />
      <PipelineNode gate={5} isActive={r5 !== undefined && r5.contradictions.length > 0} />
      <PipelineNode gate={5} isReflection reflectionStatus={getStatus(r5)} />
      <PipelineNode gate={6} />
      <PipelineNode gate={7} />
    </Box>
  );
}

// ── Main ReflectionCard ──

export default function ReflectionCard({ reflection, index = 0 }: ReflectionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const color = getSeverityColor(reflection);
  const label = getSeverityLabel(reflection);
  const hasContradictions = reflection.contradictions.length > 0;
  const hasHints = reflection.downstreamHints.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.15, ease: 'easeOut' }}
    >
      <Card
        sx={{
          bgcolor: COLORS.bgCard,
          border: `1px solid ${color}40`,
          borderRadius: '12px',
          overflow: 'hidden',
          mb: 2,
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2.5,
            py: 1.5,
            bgcolor: `${color}08`,
            borderBottom: `1px solid ${color}20`,
            cursor: 'pointer',
          }}
          onClick={() => setExpanded(!expanded)}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                bgcolor: `${color}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {hasContradictions ? (
                <AlertTriangle size={18} color={color} />
              ) : (
                <CheckCircle size={18} color={color} />
              )}
            </Box>
            <Box>
              <Typography
                variant="subtitle2"
                sx={{ color: COLORS.textPrimary, fontWeight: 600, lineHeight: 1.3 }}
              >
                Reflection after Gate {reflection.afterGate}
              </Typography>
              <Typography variant="caption" sx={{ color: COLORS.textSecondary }}>
                {GATE_LABELS[reflection.afterGate]} checkpoint
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              label={label}
              size="small"
              sx={{
                bgcolor: `${color}20`,
                color,
                fontWeight: 600,
                fontSize: '0.7rem',
                height: 24,
                borderRadius: '6px',
              }}
            />
            {hasContradictions && (
              <Chip
                label={`${reflection.contradictions.length}`}
                size="small"
                sx={{
                  bgcolor: `${COLORS.orange}20`,
                  color: COLORS.orange,
                  fontWeight: 700,
                  fontSize: '0.7rem',
                  height: 24,
                  minWidth: 24,
                  borderRadius: '6px',
                }}
              />
            )}
            {reflection.needsRevisit !== null && (
              <Chip
                icon={<RotateCcw size={12} />}
                label={`Revisit G${reflection.needsRevisit}`}
                size="small"
                sx={{
                  bgcolor: `${COLORS.red}15`,
                  color: COLORS.red,
                  fontWeight: 600,
                  fontSize: '0.7rem',
                  height: 24,
                  borderRadius: '6px',
                  '& .MuiChip-icon': { color: COLORS.red },
                }}
              />
            )}
            <IconButton size="small" sx={{ color: COLORS.textSecondary }}>
              {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </IconButton>
          </Box>
        </Box>

        <CardContent sx={{ px: 2.5, py: 2 }}>
          {/* Contradictions (red/orange) */}
          {hasContradictions && (
            <Alert
              severity="warning"
              icon={<AlertTriangle size={20} />}
              sx={{
                bgcolor: `${COLORS.red}0a`,
                border: `1px solid ${COLORS.orange}30`,
                borderRadius: '8px',
                mb: 2,
                '& .MuiAlert-icon': { color: COLORS.orange },
                '& .MuiAlert-message': { color: COLORS.textPrimary },
              }}
            >
              <AlertTitle sx={{ color: COLORS.orange, fontWeight: 600, fontSize: '0.85rem' }}>
                {reflection.contradictions.length} Contradiction
                {reflection.contradictions.length > 1 ? 's' : ''} Detected
              </AlertTitle>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {reflection.contradictions.map((c, i) => (
                  <Box
                    component="li"
                    key={i}
                    sx={{ color: COLORS.textSecondary, fontSize: '0.82rem', mb: 0.5 }}
                  >
                    {c}
                  </Box>
                ))}
              </Box>
            </Alert>
          )}

          {/* Needs Revisit */}
          {reflection.needsRevisit !== null && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 1,
                bgcolor: `${COLORS.red}10`,
                border: `1px solid ${COLORS.red}25`,
                borderRadius: '8px',
                mb: 2,
              }}
            >
              <RotateCcw size={16} color={COLORS.red} />
              <Typography variant="body2" sx={{ color: COLORS.red, fontWeight: 500 }}>
                Gate {reflection.needsRevisit} ({GATE_LABELS[reflection.needsRevisit]}) flagged for
                revisit
              </Typography>
            </Box>
          )}

          {/* No contradictions */}
          {!hasContradictions && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 1.5,
                bgcolor: `${COLORS.green}08`,
                border: `1px solid ${COLORS.green}20`,
                borderRadius: '8px',
                mb: 2,
              }}
            >
              <CheckCircle size={16} color={COLORS.green} />
              <Typography variant="body2" sx={{ color: COLORS.green, fontWeight: 500 }}>
                No contradictions detected. Gates are consistent.
              </Typography>
            </Box>
          )}

          {/* Downstream Hints (blue) */}
          {hasHints && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                <Lightbulb size={14} color={COLORS.blue} />
                <Typography
                  variant="caption"
                  sx={{
                    color: COLORS.blue,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Downstream Hints
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {reflection.downstreamHints.map((hint, i) => (
                  <Alert
                    key={i}
                    severity="info"
                    variant="outlined"
                    sx={{
                      bgcolor: `${COLORS.blue}08`,
                      borderColor: `${COLORS.blue}30`,
                      color: '#93c5fd',
                      py: 0.25,
                      '& .MuiAlert-icon': { color: COLORS.blue },
                      '& .MuiAlert-message': { fontSize: '0.82rem' },
                    }}
                  >
                    {hint}
                  </Alert>
                ))}
              </Box>
            </Box>
          )}

          {/* Expandable Raw Output */}
          <Collapse in={expanded} timeout={300}>
            <Divider sx={{ borderColor: COLORS.border, my: 1.5 }} />
            <Typography
              variant="caption"
              sx={{
                color: COLORS.textSecondary,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                mb: 1,
                display: 'block',
              }}
            >
              Full Reflection Output
            </Typography>
            <Box
              sx={{
                bgcolor: COLORS.bg,
                border: `1px solid ${COLORS.border}`,
                borderRadius: '8px',
                p: 2,
                maxHeight: 300,
                overflowY: 'auto',
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: '0.78rem',
                lineHeight: 1.6,
                color: COLORS.textSecondary,
                whiteSpace: 'pre-wrap',
                '&::-webkit-scrollbar': { width: 6 },
                '&::-webkit-scrollbar-thumb': { bgcolor: COLORS.border, borderRadius: 3 },
              }}
            >
              {reflection.raw}
            </Box>
          </Collapse>
        </CardContent>
      </Card>
    </motion.div>
  );
}
