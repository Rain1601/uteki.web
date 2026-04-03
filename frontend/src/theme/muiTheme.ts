import { createTheme, ThemeOptions } from '@mui/material/styles';
import { darkTheme as darkColors, lightTheme as lightColors } from './colors';

// MUI 深色主题配置（uchu_trade 蓝色主题 #6495ed + 无缝线设计）
const darkThemeOptions: ThemeOptions = {
  palette: {
    mode: 'dark',
    primary: {
      main: darkColors.brand.primary,     // #6495ed - 道奇蓝
      light: darkColors.brand.secondary,  // #90caf9 - 浅蓝
      dark: darkColors.brand.active,      // #4a67c4
      contrastText: '#ffffff',
    },
    secondary: {
      main: darkColors.brand.secondary,   // #90caf9 - 浅蓝
      light: '#b3e5fc',
      dark: '#0288d1',
      contrastText: '#000000',
    },
    error: {
      main: darkColors.status.error,
      light: '#ff6659',
      dark: '#d32f2f',
    },
    warning: {
      main: darkColors.status.warning,
      light: '#ffb74d',
      dark: '#f57c00',
    },
    info: {
      main: darkColors.status.info,
      light: '#4fc3f7',
      dark: '#0288d1',
    },
    success: {
      main: darkColors.status.success,    // #4caf50 - 绿色
      light: '#66bb6a',
      dark: '#388e3c',
    },
    background: {
      default: darkColors.background.primary,    // BG2 #181c1f
      paper: darkColors.background.tertiary,     // BG4 #262830
    },
    text: {
      primary: darkColors.text.primary,          // #ffffff
      secondary: darkColors.text.secondary,      // #cccccc
      disabled: darkColors.text.disabled,        // #444444
    },
    divider: darkColors.border.subtle,
    action: {
      active: darkColors.text.secondary,
      hover: darkColors.background.hover,
      selected: darkColors.background.active,
      disabled: darkColors.text.disabled,
      disabledBackground: darkColors.background.tertiary,
    },
  },
  typography: {
    fontFamily: [
      'Inter',
      '-apple-system',
      'BlinkMacSystemFont',
      'Segoe UI',
      'sans-serif',
    ].join(','),
    fontSize: 14,
    fontWeightLight: 300,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 600,
    h1: { letterSpacing: '-0.03em', fontWeight: 700 },
    h2: { letterSpacing: '-0.02em', fontWeight: 700 },
    h3: { letterSpacing: '-0.01em', fontWeight: 600 },
    h4: { letterSpacing: '-0.01em', fontWeight: 600 },
    body1: { lineHeight: 1.7 },
    body2: { lineHeight: 1.6 },
  },
  shape: {
    borderRadius: 8, // 统一圆角（从12降到8，更克制）
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarColor: `${darkColors.border.default} ${darkColors.background.secondary}`,
          '&::-webkit-scrollbar': {
            width: '6px',
            height: '6px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(255,255,255,0.08)',
            borderRadius: '6px',
            '&:hover': {
              background: 'rgba(255,255,255,0.16)',
            },
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: '8px',
          fontWeight: 600,
          padding: '10px 20px',
          boxShadow: 'none',
          '&:hover': {
            boxShadow: 'none',
            transform: 'translateY(-1px)',
          },
        },
        contained: {
          boxShadow: 'none',
          '&:hover': {
            boxShadow: '0 2px 8px rgba(100, 149, 237, 0.20)',
          },
        },
        containedPrimary: {
          backgroundColor: darkColors.brand.primary,  // #6495ed
          color: '#ffffff',
          '&:hover': {
            backgroundColor: darkColors.brand.hover,
          },
        },
        outlined: {
          borderWidth: '1.5px',
          '&:hover': {
            borderWidth: '1.5px',
            backgroundColor: 'rgba(100, 149, 237, 0.08)',
          },
        },
        outlinedPrimary: {
          color: darkColors.brand.primary,
          borderColor: darkColors.brand.primary,
          '&:hover': {
            borderColor: darkColors.brand.hover,
            backgroundColor: 'rgba(100, 149, 237, 0.08)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: darkColors.background.tertiary,
          border: 'none',
          boxShadow: 'none',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: darkColors.background.tertiary,
        },
        elevation0: {
          boxShadow: 'none',
        },
        elevation1: {
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)',
        },
        elevation2: {
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        },
        elevation3: {
          boxShadow: '0 10px 15px rgba(0, 0, 0, 0.15)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: darkColors.background.secondary,  // #1E1E1E
          boxShadow: 'none',
          borderBottom: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: darkColors.background.secondary,
          border: 'none',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: darkColors.background.secondary,  // #1E1E1E
            borderRadius: '8px',
            '& fieldset': {
              borderColor: darkColors.border.subtle,
              borderWidth: '1px',
            },
            '&:hover fieldset': {
              borderColor: 'rgba(255, 255, 255, 0.2)',
            },
            '&.Mui-focused fieldset': {
              borderColor: darkColors.brand.primary,          // #6495ed - 道奇蓝
              borderWidth: '1px',
              boxShadow: '0 0 0 3px rgba(100, 149, 237, 0.1)',
            },
          },
          '& .MuiInputLabel-root': {
            color: 'rgba(255, 255, 255, 0.7)',
            '&.Mui-focused': {
              color: darkColors.brand.primary,                // #6495ed
            },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: '20px',  // pills stay rounded
          fontWeight: 500,
        },
        filled: {
          border: 'none',
        },
        colorSuccess: {
          backgroundColor: darkColors.trading.buy,
          color: '#ffffff',
        },
        colorError: {
          backgroundColor: darkColors.trading.sell,
          color: '#ffffff',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: 'none',  // 无缝线设计 - 去掉表格边框
          padding: '16px',
        },
        head: {
          backgroundColor: darkColors.background.primary,    // #121212
          fontWeight: 600,
          color: darkColors.text.tertiary,                   // #999999
        },
        body: {
          color: darkColors.text.primary,
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:nth-of-type(odd)': {
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
          },
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
          },
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: darkColors.border.subtle,
          opacity: 0.5,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: darkColors.background.secondary,
          backgroundImage: 'none',
          boxShadow: '0 20px 25px rgba(0, 0, 0, 0.2)',
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
          minHeight: '48px',
          '&.Mui-selected': {
            color: darkColors.brand.primary,
          },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          backgroundColor: darkColors.brand.primary,
          height: '2px',
          borderRadius: '2px 2px 0 0',
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          '&.Mui-checked': {
            color: darkColors.brand.primary,  // #6495ed - 道奇蓝
            '& + .MuiSwitch-track': {
              backgroundColor: darkColors.brand.primary,
            },
          },
        },
      },
    },
  },
};

// MUI 浅色主题配置
const lightThemeOptions: ThemeOptions = {
  ...darkThemeOptions,
  palette: {
    mode: 'light',
    primary: {
      main: lightColors.brand.primary,
      light: lightColors.brand.secondary,
      dark: lightColors.brand.active,
      contrastText: '#000000',
    },
    secondary: {
      main: lightColors.brand.accent,
      light: '#6ee7dc',
      dark: '#26a69a',
      contrastText: '#000000',
    },
    error: {
      main: lightColors.status.error,
      light: '#ff6659',
      dark: '#d32f2f',
    },
    warning: {
      main: lightColors.status.warning,
      light: '#ffb74d',
      dark: '#f57c00',
    },
    info: {
      main: lightColors.status.info,
      light: '#64b5f6',
      dark: '#1976d2',
    },
    success: {
      main: lightColors.brand.primary,
      light: lightColors.brand.secondary,
      dark: lightColors.brand.active,
    },
    background: {
      default: lightColors.background.primary,
      paper: lightColors.background.quaternary,
    },
    text: {
      primary: lightColors.text.primary,
      secondary: lightColors.text.secondary,
      disabled: lightColors.text.disabled,
    },
    divider: lightColors.border.subtle,
    action: {
      active: lightColors.text.secondary,
      hover: lightColors.background.hover,
      selected: lightColors.background.active,
      disabled: lightColors.text.disabled,
      disabledBackground: lightColors.background.tertiary,
    },
  },
  components: {
    ...darkThemeOptions.components,
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: lightColors.background.tertiary,
          border: 'none',
          boxShadow: 'none',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: lightColors.background.tertiary,
        },
        elevation0: {
          boxShadow: 'none',
        },
        elevation1: {
          boxShadow: lightColors.effects.shadow.sm,
        },
        elevation2: {
          boxShadow: lightColors.effects.shadow.md,
        },
        elevation3: {
          boxShadow: lightColors.effects.shadow.lg,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: lightColors.background.secondary,
          boxShadow: 'none',
          borderBottom: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: lightColors.background.secondary,
          border: 'none',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: '#ffffff',  // 输入框用纯白，形成对比
            borderRadius: '8px',
            '& fieldset': {
              borderColor: lightColors.border.default,
              borderWidth: '1px',
            },
            '&:hover fieldset': {
              borderColor: lightColors.border.hover,
            },
            '&.Mui-focused fieldset': {
              borderColor: lightColors.brand.primary,
              borderWidth: '1px',
              boxShadow: '0 0 0 3px rgba(100, 149, 237, 0.1)',
            },
          },
          '& .MuiInputLabel-root': {
            color: lightColors.text.secondary,
            '&.Mui-focused': {
              color: lightColors.brand.primary,
            },
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: 'none',
          padding: '16px',
        },
        head: {
          backgroundColor: lightColors.background.secondary,
          fontWeight: 600,
          color: lightColors.text.muted,
        },
        body: {
          color: lightColors.text.primary,
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:nth-of-type(odd)': {
            backgroundColor: 'rgba(26, 35, 50, 0.02)',
          },
          '&:hover': {
            backgroundColor: 'rgba(26, 35, 50, 0.04)',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        colorSuccess: {
          backgroundColor: lightColors.trading.buy,
          color: '#ffffff',
        },
        colorError: {
          backgroundColor: lightColors.trading.sell,
          color: '#ffffff',
        },
      },
    },
  },
};

export const createMuiTheme = (mode: 'light' | 'dark') => {
  return createTheme(mode === 'dark' ? darkThemeOptions : lightThemeOptions);
};

export const darkMuiTheme = createTheme(darkThemeOptions);
export const lightMuiTheme = createTheme(lightThemeOptions);
