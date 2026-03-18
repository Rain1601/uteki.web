import { Box, Typography } from '@mui/material';
import { X, FileText } from 'lucide-react';
import { useTheme } from '../../theme/ThemeProvider';
import { GATE_NAMES, type GateResult, type PositionHoldingOutput } from '../../api/company';
import { DataTable } from './ui';
import VerdictBanner from './VerdictBanner';
import FormattedText from './FormattedText';
import BusinessAnalysisCard from './gates/BusinessAnalysisCard';
import FisherQACard from './gates/FisherQACard';
import MoatAssessmentCard from './gates/MoatAssessmentCard';
import ManagementCard from './gates/ManagementCard';
import ReverseTestCard from './gates/ReverseTestCard';
import ValuationCard from './gates/ValuationCard';
import PositionHoldingCard from './gates/PositionHoldingCard';

interface Props {
  open: boolean;
  onClose: () => void;
  skills: Record<string, GateResult>;
  verdict?: PositionHoldingOutput;
  companyInfo: { name: string; symbol: string; sector: string; industry: string; price: number } | null;
  totalLatencyMs?: number;
  modelUsed?: string;
  dataFreshness?: { cached: boolean; fetched_at?: string };
  toolCallsCount?: number;
}

const GATE_ORDER = [
  'business_analysis',
  'fisher_qa',
  'moat_assessment',
  'management_assessment',
  'reverse_test',
  'valuation',
  'final_verdict',
] as const;

const GATE_EN_NAMES: Record<string, string> = {
  business_analysis: 'Business Analysis',
  fisher_qa: 'Fisher 15 Questions',
  moat_assessment: 'Moat Assessment',
  management_assessment: 'Management Assessment',
  reverse_test: 'Reverse Test',
  valuation: 'Valuation & Timing',
  final_verdict: 'Final Verdict',
};

const GATE_COMPONENTS: Record<string, React.FC<{ data: Record<string, any> }>> = {
  business_analysis: BusinessAnalysisCard,
  fisher_qa: FisherQACard,
  moat_assessment: MoatAssessmentCard,
  management_assessment: ManagementCard,
  reverse_test: ReverseTestCard,
  valuation: ValuationCard,
  final_verdict: PositionHoldingCard,
};

export default function ReportPanel({
  open,
  onClose,
  skills,
  verdict,
  companyInfo,
  totalLatencyMs,
  modelUsed,
  dataFreshness,
  toolCallsCount,
}: Props) {
  const { theme } = useTheme();

  const hasVerdict = verdict && verdict.action;
  const companyName = companyInfo?.name || companyInfo?.symbol || '';

  return (
    <Box
      sx={{
        width: open ? '55%' : 0,
        minWidth: open ? 480 : 0,
        maxWidth: open ? 800 : 0,
        height: '100%',
        overflow: 'hidden',
        transition: 'width 0.3s ease, min-width 0.3s ease, max-width 0.3s ease',
        borderLeft: open ? `1px solid ${theme.border.subtle}` : 'none',
        boxShadow: open ? '-4px 0 16px rgba(0,0,0,0.06)' : 'none',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      <Box
        sx={{
          height: '100%',
          overflowY: 'auto',
          bgcolor: theme.background.primary,
          '&::-webkit-scrollbar': { width: 6 },
          '&::-webkit-scrollbar-thumb': { bgcolor: theme.border.default, borderRadius: 3 },
        }}
      >
        {/* Header */}
        <Box
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            bgcolor: theme.background.primary,
            borderBottom: `1px solid ${theme.border.subtle}`,
            px: 3,
            py: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            minWidth: 460,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <FileText size={18} color={theme.brand.primary} />
            <Box>
              <Typography sx={{ fontSize: 16, fontWeight: 700, color: theme.text.primary, lineHeight: 1.3 }}>
                {companyInfo?.symbol || ''} 投研报告
              </Typography>
              <Typography sx={{ fontSize: 12, color: theme.text.muted }}>
                {companyName}{companyInfo?.sector ? ` · ${companyInfo.sector}` : ''}
              </Typography>
            </Box>
          </Box>
          <Box
            onClick={onClose}
            sx={{
              cursor: 'pointer',
              p: 0.5,
              borderRadius: 1,
              display: 'flex',
              color: theme.text.muted,
              '&:hover': { bgcolor: theme.background.hover, color: theme.text.primary },
            }}
          >
            <X size={18} />
          </Box>
        </Box>

        {/* Body */}
        <Box sx={{ px: 3, py: 3, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 460 }}>
          {/* Verdict Banner */}
          {hasVerdict && (
            <VerdictBanner verdict={verdict!} companyName={companyName} />
          )}

          {/* Gate Sections */}
          {GATE_ORDER.map((skillName) => {
            const result = skills[skillName];
            if (!result) return null;

            const gateNum = result.gate ?? (GATE_ORDER.indexOf(skillName) + 1);
            const parsedData = skillName === 'final_verdict' && result.parsed?.position_holding
              ? result.parsed.position_holding
              : result.parsed;
            const hasParsed = parsedData && Object.keys(parsedData).length > 0;
            const Component = GATE_COMPONENTS[skillName];

            return (
              <Box key={skillName}>
                {/* Section divider — thick top rule */}
                <Box sx={{ borderTop: `2px solid ${theme.border.default}`, pt: 2, mb: 2.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box
                      sx={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        bgcolor: theme.brand.primary + '15',
                        color: theme.brand.primary,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {gateNum}
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                        <Typography sx={{ fontSize: 15, fontWeight: 700, color: theme.text.primary }}>
                          {GATE_NAMES[gateNum] || skillName}
                        </Typography>
                        <Typography sx={{ fontSize: 12, color: theme.text.muted }}>
                          {GATE_EN_NAMES[skillName] || ''}
                        </Typography>
                      </Box>
                    </Box>
                    {result.latency_ms != null && (
                      <Typography sx={{ fontSize: 12, color: theme.text.disabled, flexShrink: 0 }}>
                        {(result.latency_ms / 1000).toFixed(1)}s
                      </Typography>
                    )}
                  </Box>
                </Box>

                {/* Content: structured card or raw text */}
                <Box sx={{ bgcolor: theme.background.secondary, borderRadius: 2, p: 3 }}>
                  {hasParsed && Component ? (
                    <Component data={parsedData} />
                  ) : result.raw ? (
                    <FormattedText text={result.raw} theme={theme} />
                  ) : (
                    <Typography sx={{ fontSize: 13, color: theme.text.muted, fontStyle: 'italic' }}>
                      无输出数据
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          })}

          {/* Metadata footer */}
          <Box sx={{ mt: 1 }}>
            <DataTable
              rows={[
                ...(modelUsed ? [{ label: 'Model', value: modelUsed }] : []),
                ...(totalLatencyMs != null ? [{ label: 'Total Time', value: `${(totalLatencyMs / 1000).toFixed(1)}s` }] : []),
                ...(dataFreshness ? [{
                  label: 'Data',
                  value: `${dataFreshness.cached ? 'Cached' : 'Fresh'}${dataFreshness.fetched_at ? ` (${new Date(dataFreshness.fetched_at).toLocaleDateString()})` : ''}`,
                }] : []),
                ...(toolCallsCount != null && toolCallsCount > 0 ? [{ label: 'Web Searches', value: String(toolCallsCount) }] : []),
              ]}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
