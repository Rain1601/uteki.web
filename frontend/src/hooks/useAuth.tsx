import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';

// API calls use relative paths to go through vite proxy (no CORS issues)
// Login redirects need absolute URL since the browser navigates directly to the backend
const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

// Token storage key
const TOKEN_KEY = 'auth_token';

// User interface
export interface User {
  user_id: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
  provider: string;
}

// Auth context interface
interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  login: (provider: 'github' | 'google') => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

// Get token from localStorage
function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

// Store token in localStorage
function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

// Remove token from localStorage
function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// Create context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Auth Provider component
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch current user — relative path goes through vite proxy
  const refreshUser = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const token = getStoredToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/auth/me', {
        credentials: 'include',
        headers,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.authenticated && data.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
        if (response.status === 401) {
          removeToken();
        }
      }
    } catch (err) {
      console.error('Failed to fetch user:', err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Login — browser navigates directly to backend (absolute URL)
  const login = useCallback((provider: 'github' | 'google') => {
    const redirectUrl = `${window.location.origin}/login`;
    const loginUrl = `${BACKEND_URL}/api/auth/${provider}/login?redirect_url=${encodeURIComponent(redirectUrl)}`;
    window.location.href = loginUrl;
  }, []);

  // Logout — relative path goes through vite proxy
  const logout = useCallback(async () => {
    try {
      const token = getStoredToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers,
      });
      removeToken();
      setUser(null);
    } catch (err) {
      console.error('Logout failed:', err);
      removeToken();
      setUser(null);
    }
  }, []);

  // Check for token in URL hash (from OAuth redirect)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('token=')) {
      const tokenMatch = hash.match(/token=([^&]+)/);
      if (tokenMatch && tokenMatch[1]) {
        const token = tokenMatch[1];
        storeToken(token);
        // Clean URL hash
        window.history.replaceState({}, document.title, window.location.pathname);
        // Refresh user with new token
        refreshUser();
      }
    }
  }, [refreshUser]);

  // Check for login errors in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const loginError = urlParams.get('error');
    if (loginError) {
      setError(loginError === 'github_auth_failed'
        ? 'GitHub 登录失败，请重试'
        : loginError === 'google_auth_failed'
        ? 'Google 登录失败，请重试'
        : '登录失败，请重试');
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Fetch user on mount
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const value: AuthContextType = {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    login,
    logout,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook to use auth context
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Export helper to get auth headers for API calls
export function getAuthHeaders(): Record<string, string> {
  const token = getStoredToken();
  if (token) {
    return { 'Authorization': `Bearer ${token}` };
  }
  return {};
}
