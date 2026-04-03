import { Box, Typography } from '@mui/material';
import { useTheme } from '../theme/ThemeProvider';

interface PageHeaderProps {
  title: string;
  children?: React.ReactNode;
}

export default function PageHeader({ title, children }: PageHeaderProps) {
  const { theme } = useTheme();

  return (
    <Box sx={{
      px: 2,
      py: 0.75,
      flexShrink: 0,
      borderBottom: `1px solid ${theme.border.subtle}`,
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      minHeight: 40,
    }}>
      <Typography sx={{
        fontSize: 13,
        fontWeight: 600,
        color: theme.text.primary,
        letterSpacing: '-0.01em',
        flexShrink: 0,
        fontFamily: "var(--font-ui)",
        textTransform: 'none',
      }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}
