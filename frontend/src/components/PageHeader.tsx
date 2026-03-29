import { Box, Typography } from '@mui/material';
import { useTheme } from '../theme/ThemeProvider';

interface PageHeaderProps {
  title: string;
  children?: React.ReactNode;  // right side content (company info, controls, etc.)
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
        fontSize: 14,
        fontWeight: 600,
        color: theme.text.primary,
        flexShrink: 0,
      }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}
