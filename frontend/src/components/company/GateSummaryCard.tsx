import { useState } from 'react';
import { Box, Typography, Collapse } from '@mui/material';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { StatusBadge } from './ui';
import FormattedText from './FormattedText';
import type { GateResult } from '../../api/company';

interface Props {
  gateNum: number;
  result: GateResult;
  theme: any;
}

// ── Metric chip ──
function MetricChip({ label, value, theme }: { label: string; value: string | number; theme: any }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography sx={{ fontSize: 11, color: theme.text.muted, whiteSpace: 'nowrap' }}>{label}</Typography>
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, whiteSpace: 'nowrap' }}>
        {value}
      </Typography>
    </Box>
  );
}

// ── Divider ──
function VDivider({ theme }: { theme: any }) {
  return <Box sx={{ width: 1, height: 16, bgcolor: theme.border.subtle, mx: 0.5 }} />;
}

// ── Badge variant mapping ──
type BadgeVariant = 'quality' | 'action' | 'width' | 'assessment' | 'risk' | 'score';

const GATE_BADGE_VARIANT: Record<string, BadgeVariant> = {
  quality: 'quality',
  score: 'score',
  width: 'width',
  resilience: 'score',
  assessment: 'assessment',
  action: 'action',
};

// ── Extract summary + metrics per gate type ──
function extractGateInfo(gateNum: number, result: GateResult) {
  const p = result.parsed || {};
  const raw = result.raw || '';
  const fallbackSummary = p.summary || raw.slice(0, 120).replace(/\n/g, ' ') + (raw.length > 120 ? '...' : '');

  switch (gateNum) {
    case 1: { // business_analysis
      const quality = p.business_quality || '';
      const sustainability = p.sustainability_score;
      return {
        badge: { type: 'quality' as const, value: quality },
        metrics: [
          sustainability != null && { label: '持续性', value: `${sustainability}/10` },
          p.is_good_business != null && { label: '好生意', value: p.is_good_business ? 'Yes' : 'No' },
        ].filter(Boolean),
        summary: fallbackSummary,
      };
    }
    case 2: { // fisher_qa
      const total = p.total_score;
      const verdict = p.growth_verdict || '';
      return {
        badge: { type: 'score' as const, value: total != null ? `${total}/150` : verdict },
        metrics: [
          total != null && { label: '得分', value: `${total}/150` },
          verdict && { label: '成长判定', value: verdict },
        ].filter(Boolean),
        summary: fallbackSummary,
      };
    }
    case 3: { // moat_assessment
      const width = p.moat_width || '';
      const trend = p.moat_trend || '';
      const durability = p.moat_durability_years;
      const trendIcon = trend === 'strengthening' ? ' ↑' : trend === 'eroding' ? ' ↓' : ' →';
      return {
        badge: { type: 'width' as const, value: width },
        metrics: [
          trend && { label: '趋势', value: trend + trendIcon },
          durability != null && { label: '耐久', value: `${durability}yr` },
        ].filter(Boolean),
        summary: fallbackSummary,
      };
    }
    case 4: { // management_assessment
      const mgmtScore = p.management_score;
      const integrity = p.integrity_score;
      const succession = p.succession_risk || '';
      return {
        badge: { type: 'score' as const, value: mgmtScore != null ? `${mgmtScore}/10` : '—' },
        metrics: [
          integrity != null && { label: '诚信', value: `${integrity}/10` },
          succession && { label: '继任风险', value: succession },
        ].filter(Boolean),
        summary: fallbackSummary,
      };
    }
    case 5: { // reverse_test
      const resilience = p.resilience_score;
      const flags = Array.isArray(p.red_flags) ? p.red_flags.filter((f: any) => f.triggered).length : 0;
      return {
        badge: { type: 'resilience' as const, value: resilience != null ? `${resilience}/10` : '—' },
        metrics: [
          resilience != null && { label: '韧性', value: `${resilience}/10` },
          { label: '红旗', value: `${flags}项` },
        ].filter(Boolean),
        summary: fallbackSummary,
      };
    }
    case 6: { // valuation
      const assessment = p.price_assessment || '';
      const margin = p.safety_margin || '';
      const confidence = p.buy_confidence;
      return {
        badge: { type: 'assessment' as const, value: assessment },
        metrics: [
          margin && { label: '安全边际', value: margin },
          confidence != null && { label: '买入信心', value: `${confidence}/10` },
        ].filter(Boolean),
        summary: fallbackSummary,
      };
    }
    case 7: { // final_verdict
      const action = p.action || '';
      const conviction = p.conviction;
      const quality = p.quality_verdict || '';
      const oneSentence = p.one_sentence || fallbackSummary;
      return {
        badge: { type: 'action' as const, value: action },
        metrics: [
          conviction != null && { label: '信念', value: `${(conviction * 100).toFixed(0)}%` },
          quality && { label: '品质', value: quality },
        ].filter(Boolean),
        summary: oneSentence,
      };
    }
    default:
      return { badge: null, metrics: [], summary: fallbackSummary };
  }
}

export default function GateSummaryCard({ gateNum, result, theme }: Props) {
  const [expanded, setExpanded] = useState(false);
  const info = extractGateInfo(gateNum, result);
  const hasRawText = !!(result.raw && result.raw.length > 0);

  return (
    <Box
      sx={{
        ml: '32px',
        pl: 2,
        mt: 0.5,
        mb: 1,
        animation: 'tl-card-in 0.3s ease-out',
      }}
    >
      <Box
        onClick={hasRawText ? () => setExpanded(!expanded) : undefined}
        sx={{
          p: 2,
          bgcolor: theme.background.secondary,
          borderRadius: 2,
          border: `1px solid ${theme.border.subtle}`,
          cursor: hasRawText ? 'pointer' : 'default',
          transition: 'border-color 0.2s',
          '&:hover': hasRawText ? { borderColor: theme.border.default } : {},
        }}
      >
        {/* Top row: badge + metrics */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {info.badge && info.badge.value && (
            <StatusBadge
              variant={GATE_BADGE_VARIANT[info.badge.type] || 'score'}
              value={String(info.badge.value)}
            />
          )}
          {info.metrics.map((m: any, i: number) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {i > 0 || info.badge?.value ? <VDivider theme={theme} /> : null}
              <MetricChip label={m.label} value={m.value} theme={theme} />
            </Box>
          ))}
        </Box>

        {/* Summary line */}
        {info.summary && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
            <Typography
              sx={{
                fontSize: 13,
                color: theme.text.secondary,
                lineHeight: 1.5,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                flex: 1,
              }}
            >
              {info.summary}
            </Typography>
            {hasRawText && (
              <Box sx={{ color: theme.text.disabled, display: 'flex', flexShrink: 0, ml: 0.5 }}>
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* Expanded raw text */}
      <Collapse in={expanded}>
        <Box
          sx={{
            p: 2.5,
            mt: 0.5,
            bgcolor: theme.background.secondary,
            borderRadius: 1.5,
            maxHeight: 400,
            overflow: 'auto',
            '&::-webkit-scrollbar': { width: 4 },
            '&::-webkit-scrollbar-thumb': { bgcolor: theme.border.default, borderRadius: 2 },
          }}
        >
          <FormattedText text={result.raw || ''} theme={theme} />
        </Box>
      </Collapse>
    </Box>
  );
}
