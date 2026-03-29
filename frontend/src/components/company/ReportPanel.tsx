import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { X, FileText, Download, Maximize2, Minimize2 } from 'lucide-react';
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
  scrollToGate?: number | null;
  onScrollToGateConsumed?: () => void;
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
  scrollToGate,
  onScrollToGateConsumed,
}: Props) {
  const { theme } = useTheme();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollToGate == null || !open) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`gate-section-${scrollToGate}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      onScrollToGateConsumed?.();
    }, 350);
    return () => clearTimeout(timer);
  }, [scrollToGate, open]);

  const hasVerdict = verdict && verdict.action;
  const companyName = companyInfo?.name || companyInfo?.symbol || '';
  const [exporting, setExporting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const handleExportPDF = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container || exporting) return;

    setExporting(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');

      const symbol = companyInfo?.symbol || 'report';
      const dateStr = new Date().toISOString().slice(0, 10);

      // Temporarily expand to full height for capture
      const origHeight = container.style.height;
      const origOverflow = container.style.overflow;
      container.style.height = 'auto';
      container.style.overflow = 'visible';

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#181c1f',
        scrollY: 0,
        windowWidth: container.scrollWidth,
      });

      container.style.height = origHeight;
      container.style.overflow = origOverflow;

      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const imgW = canvas.width;
      const imgH = canvas.height;

      // A4 dimensions in mm
      const pdfW = 210;
      const pdfH = 297;
      const margin = 8;
      const contentW = pdfW - margin * 2;
      const contentH = (imgH * contentW) / imgW;

      const pdf = new jsPDF({
        orientation: contentH > pdfH * 1.5 ? 'portrait' : 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      // Paginate: split the image across pages
      const pageContentH = pdfH - margin * 2;
      let yOffset = 0;
      let page = 0;

      while (yOffset < contentH) {
        if (page > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', margin, margin - yOffset, contentW, contentH);
        yOffset += pageContentH;
        page++;
      }

      pdf.save(`${symbol}_投研报告_${dateStr}.pdf`);
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      setExporting(false);
    }
  }, [companyInfo, exporting]);

  // Escape key exits fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  return (
    <Box
      sx={{
        // Fullscreen: fixed overlay covering entire viewport
        ...(fullscreen ? {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          minWidth: 0,
          maxWidth: 'none',
          zIndex: 1300,
        } : {
          width: open ? '55%' : 0,
          minWidth: open ? 480 : 0,
          maxWidth: open ? 800 : 0,
          position: 'relative',
        }),
        height: '100%',
        overflow: 'hidden',
        transition: fullscreen ? 'none' : 'width 0.3s ease, min-width 0.3s ease, max-width 0.3s ease',
        borderLeft: open && !fullscreen ? `1px solid ${theme.border.subtle}` : 'none',
        flexShrink: 0,
      }}
    >
      <Box
        ref={scrollContainerRef}
        sx={{
          height: '100%',
          overflowY: 'auto',
          bgcolor: theme.background.primary,
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
          '&::-webkit-scrollbar-thumb': {
            bgcolor: `${theme.text.muted}20`,
            borderRadius: 4,
            '&:hover': { bgcolor: `${theme.text.muted}40` },
          },
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
            px: 2.5,
            py: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            minWidth: 460,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <FileText size={16} color={theme.text.muted} />
            <Box>
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: theme.text.primary, lineHeight: 1.3 }}>
                {companyInfo?.symbol || ''} 投研报告
              </Typography>
              <Typography sx={{ fontSize: 11, color: theme.text.disabled }}>
                {companyName}{companyInfo?.sector ? ` · ${companyInfo.sector}` : ''}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {/* Export PDF */}
            <Box
              onClick={handleExportPDF}
              sx={{
                cursor: exporting ? 'wait' : 'pointer',
                p: 0.5,
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                color: theme.text.disabled,
                opacity: exporting ? 0.5 : 1,
                transition: 'all 0.15s',
                '&:hover': { bgcolor: theme.background.hover, color: theme.text.secondary },
              }}
            >
              <Download size={15} />
              <Typography sx={{ fontSize: 11, fontWeight: 600 }}>PDF</Typography>
            </Box>
            {/* Fullscreen toggle */}
            <Box
              onClick={() => setFullscreen((f) => !f)}
              sx={{
                cursor: 'pointer',
                p: 0.5,
                borderRadius: 1,
                display: 'flex',
                color: theme.text.disabled,
                transition: 'all 0.15s',
                '&:hover': { bgcolor: theme.background.hover, color: theme.text.secondary },
              }}
              title={fullscreen ? '退出全屏 (Esc)' : '全屏查看'}
            >
              {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </Box>
            {/* Close */}
            <Box
              onClick={() => { setFullscreen(false); onClose(); }}
              sx={{
                cursor: 'pointer',
                p: 0.5,
                borderRadius: 1,
                display: 'flex',
                color: theme.text.disabled,
                '&:hover': { bgcolor: theme.background.hover, color: theme.text.secondary },
              }}
            >
              <X size={16} />
            </Box>
          </Box>
        </Box>

        {/* Body — compact spacing, centered in fullscreen */}
        <Box sx={{
          px: fullscreen ? 4 : 2.5,
          py: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 2.5,
          minWidth: 460,
          maxWidth: fullscreen ? 840 : 'none',
          mx: fullscreen ? 'auto' : 0,
        }}>
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
              <Box key={skillName} id={`gate-section-${gateNum}`}>
                {/* Section header — clean divider */}
                <Box sx={{ borderTop: `1px solid ${theme.border.subtle}`, pt: 1.5, mb: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography
                      sx={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        bgcolor: `${theme.brand.primary}12`,
                        color: `${theme.brand.primary}aa`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {gateNum}
                    </Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: theme.text.primary }}>
                      {GATE_NAMES[gateNum] || skillName}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: theme.text.disabled }}>
                      {GATE_EN_NAMES[skillName] || ''}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    {result.latency_ms != null && (
                      <Typography sx={{ fontSize: 11, color: theme.text.disabled, flexShrink: 0 }}>
                        {(result.latency_ms / 1000).toFixed(1)}s
                      </Typography>
                    )}
                  </Box>
                </Box>

                {/* Content */}
                <Box sx={{ bgcolor: theme.background.secondary, borderRadius: 1.5, p: 2 }}>
                  {hasParsed && Component ? (
                    <Component data={parsedData} />
                  ) : result.raw ? (
                    <FormattedText text={result.raw} theme={theme} />
                  ) : (
                    <Typography sx={{ fontSize: 12, color: theme.text.disabled, fontStyle: 'italic' }}>
                      无输出数据
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          })}

          {/* Metadata footer */}
          <Box sx={{ mt: 0.5, opacity: 0.7 }}>
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
