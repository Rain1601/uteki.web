import { Box, Button, Typography, Alert } from '@mui/material';
import { GoogleColorIcon, GitHubIcon } from '../components/icons/SocialIcons';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../theme/ThemeProvider';
import { useResponsive } from '../hooks/useResponsive';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const MotionBox = motion.create(Box);

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function LoginPage() {
  const { loading, error, login, isAuthenticated } = useAuth();
  const { theme, isDark } = useTheme();
  const { isMobile } = useResponsive();
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/agent');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          bgcolor: theme.background.deepest,
        }}
      >
        <motion.div
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Typography
            sx={{
              fontSize: 28,
              fontWeight: 300,
              letterSpacing: '0.15em',
              color: theme.text.muted,
            }}
          >
            UTEKI
          </Typography>
        </motion.div>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        bgcolor: theme.background.deepest,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle gradient orb background */}
      <Box
        sx={{
          position: 'absolute',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: isDark
            ? 'radial-gradient(circle, rgba(100,149,237,0.06) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(100,149,237,0.08) 0%, transparent 70%)',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
        }}
      />

      <MotionBox
        initial={mounted ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        sx={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: isMobile ? '100%' : 380,
          px: isMobile ? 3 : 0,
          textAlign: 'center',
        }}
      >
        {/* Logo / Brand */}
        <motion.div
          initial={mounted ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Typography
            sx={{
              fontSize: isMobile ? 32 : 38,
              fontWeight: 200,
              letterSpacing: '0.2em',
              color: theme.text.primary,
              mb: 1,
              userSelect: 'none',
            }}
          >
            UTEKI
          </Typography>
          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 400,
              letterSpacing: '0.08em',
              color: theme.text.muted,
              mb: 6,
            }}
          >
            Intelligent Investment Platform
          </Typography>
        </motion.div>

        {/* Error message */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <Alert
                severity="error"
                sx={{
                  mb: 3,
                  bgcolor: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  color: theme.status.error,
                  '& .MuiAlert-icon': { color: theme.status.error },
                  borderRadius: 2,
                }}
              >
                {error}
              </Alert>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Login buttons */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <motion.div
            initial={mounted ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.25 }}
          >
            <Button
              fullWidth
              size="large"
              startIcon={<GitHubIcon sx={{ fontSize: 20 }} />}
              onClick={() => login('github')}
              sx={{
                py: 1.5,
                minHeight: 50,
                bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                color: theme.text.primary,
                fontWeight: 500,
                fontSize: '0.9rem',
                textTransform: 'none',
                borderRadius: 2.5,
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                backdropFilter: 'blur(20px)',
                transition: 'all 0.25s ease',
                '&:hover': {
                  bgcolor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
                  border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
                  transform: 'translateY(-1px)',
                },
                '& .MuiButton-startIcon': {
                  mr: 1.5,
                },
              }}
            >
              Continue with GitHub
            </Button>
          </motion.div>

          <motion.div
            initial={mounted ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.35 }}
          >
            <Button
              fullWidth
              size="large"
              startIcon={<GoogleColorIcon sx={{ fontSize: 20 }} />}
              onClick={() => login('google')}
              sx={{
                py: 1.5,
                minHeight: 50,
                bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                color: theme.text.primary,
                fontWeight: 500,
                fontSize: '0.9rem',
                textTransform: 'none',
                borderRadius: 2.5,
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
                backdropFilter: 'blur(20px)',
                transition: 'all 0.25s ease',
                '&:hover': {
                  bgcolor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)',
                  border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`,
                  transform: 'translateY(-1px)',
                },
                '& .MuiButton-startIcon': {
                  mr: 1.5,
                },
              }}
            >
              Continue with Google
            </Button>
          </motion.div>
        </Box>

          {import.meta.env.DEV && (
            <motion.div
              initial={mounted ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.45 }}
            >
              <Button
                fullWidth
                size="large"
                onClick={() => {
                  const redirectUrl = `${window.location.origin}/login`;
                  window.location.href = `${BACKEND_URL}/api/auth/dev/login?redirect_url=${encodeURIComponent(redirectUrl)}`;
                }}
                sx={{
                  py: 1.5,
                  minHeight: 50,
                  bgcolor: 'transparent',
                  color: theme.text.muted,
                  fontWeight: 400,
                  fontSize: '0.85rem',
                  textTransform: 'none',
                  borderRadius: 2.5,
                  border: `1px dashed ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`,
                  transition: 'all 0.25s ease',
                  '&:hover': {
                    bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                    color: theme.text.secondary,
                  },
                }}
              >
                Dev Login (skip auth)
              </Button>
            </motion.div>
          )}

        {/* Footer */}
        <motion.div
          initial={mounted ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <Typography
            sx={{
              mt: 5,
              fontSize: 11,
              color: theme.text.disabled,
              letterSpacing: '0.02em',
              lineHeight: 1.6,
            }}
          >
            By continuing, you agree to our Terms of Service and Privacy Policy
          </Typography>
        </motion.div>
      </MotionBox>
    </Box>
  );
}
