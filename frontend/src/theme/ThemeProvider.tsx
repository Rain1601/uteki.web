import { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { ColorScheme, darkTheme, lightTheme } from './colors';
import { createMuiTheme } from './muiTheme';

interface ThemeContextType {
  theme: ColorScheme;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: 'light' | 'dark';
}

export function ThemeProvider({ children, defaultTheme = 'dark' }: ThemeProviderProps) {
  // 从 localStorage 读取保存的主题，如果没有则使用默认值
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('uteki-theme');
    return (saved as 'light' | 'dark') || defaultTheme;
  });

  const theme = currentTheme === 'dark' ? darkTheme : lightTheme;
  const isDark = currentTheme === 'dark';

  // 创建 MUI 主题
  const muiTheme = useMemo(() => createMuiTheme(currentTheme), [currentTheme]);

  // 更新 HTML 根元素的 class 以应用 Tailwind 的 dark 模式
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  // 保存主题设置到 localStorage
  useEffect(() => {
    localStorage.setItem('uteki-theme', currentTheme);
  }, [currentTheme]);

  const toggleTheme = () => {
    setCurrentTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const setTheme = (newTheme: 'light' | 'dark') => {
    setCurrentTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggleTheme, setTheme }}>
      <MuiThemeProvider theme={muiTheme}>
        <CssBaseline />
        {/* Global CSS custom properties for font stacks + transitions */}
        <style>{`
          :root {
            --font-reading: 'Times New Roman', 'SimSun', '宋体', Georgia, serif;
            --font-ui: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            --font-mono: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
            --transition-fast: 0.15s ease;
            --transition-normal: 0.25s ease;
            --radius-sm: 4px;
            --radius-md: 8px;
            --radius-lg: 12px;
            --radius-pill: 20px;
          }
        `}</style>
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
}

// Hook for using theme
export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
