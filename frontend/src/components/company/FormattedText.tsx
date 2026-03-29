import { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import ReactMarkdown from 'react-markdown';

interface Props {
  text: string;
  theme: any;
  streaming?: boolean;
}

/** Renders raw LLM text — full markdown in static mode, plain text in streaming mode */
export default function FormattedText({ text, theme, streaming }: Props) {
  if (streaming) {
    // Streaming: plain text to avoid half-parsed markdown flicker
    return (
      <>
        {text.split('\n').map((line, i) => {
          const trimmed = line.trim();
          if (!trimmed) return <Box key={`br-${i}`} sx={{ height: 6 }} />;
          return (
            <Typography
              key={`s-${i}`}
              sx={{ fontSize: 13, color: theme.text.secondary, lineHeight: 1.7, wordBreak: 'break-word' }}
            >
              {trimmed}
            </Typography>
          );
        })}
      </>
    );
  }

  // Static: full markdown rendering
  return (
    <Box
      sx={{
        fontSize: 13,
        color: theme.text.secondary,
        lineHeight: 1.8,
        wordBreak: 'break-word',
        '& p': { m: 0, mb: 1, '&:last-child': { mb: 0 } },
        '& h1': { fontSize: 16, fontWeight: 700, color: theme.text.primary, mt: 2, mb: 1 },
        '& h2': { fontSize: 15, fontWeight: 700, color: theme.text.primary, mt: 1.5, mb: 0.75 },
        '& h3': { fontSize: 14, fontWeight: 600, color: theme.text.primary, mt: 1, mb: 0.5 },
        '& h4': { fontSize: 13, fontWeight: 600, color: theme.text.primary, mt: 0.75, mb: 0.25 },
        '& ul, & ol': { m: 0, pl: 2.5, py: 0.3 },
        '& li': { lineHeight: 1.8, py: 0.1 },
        '& strong': { fontWeight: 700, color: theme.text.primary },
        '& em': { fontStyle: 'italic' },
        '& code': {
          bgcolor: `${theme.text.muted}10`,
          color: theme.brand.secondary || theme.brand.primary,
          px: 0.75, py: 0.15, borderRadius: '4px',
          fontSize: '0.9em', fontFamily: 'Monaco, Consolas, monospace',
        },
        '& pre': {
          m: '0.75em 0', p: 1.5, borderRadius: '8px',
          bgcolor: `${theme.text.muted}08`, overflow: 'auto',
          '& code': { bgcolor: 'transparent', p: 0, borderRadius: 0, fontSize: '0.85em' },
        },
        '& blockquote': {
          borderLeft: `3px solid ${theme.brand.primary}`,
          pl: 1.5, ml: 0, my: 1,
          color: theme.text.muted, fontStyle: 'italic',
        },
        '& table': { borderCollapse: 'collapse', width: '100%', my: 1 },
        '& th, & td': {
          border: `1px solid ${theme.border.default}`,
          px: 1.5, py: 0.75, textAlign: 'left', fontSize: 12,
        },
        '& th': { bgcolor: theme.background.tertiary, fontWeight: 600 },
        '& a': { color: theme.brand.primary, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } },
        '& hr': { border: 'none', borderTop: `1px solid ${theme.border.subtle}`, my: 1.5 },
      }}
    >
      <ReactMarkdown>{text}</ReactMarkdown>
    </Box>
  );
}
