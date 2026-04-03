import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  FormControl,
  Select,
  MenuItem,
  IconButton,
  Chip,
  SelectChangeEvent,
} from '@mui/material';
import { ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon, CalendarDays as TodayIcon, Lightbulb as AIIcon, ThumbsUp as ThumbUpIcon, ThumbsDown as ThumbDownIcon } from 'lucide-react';
import { useTheme } from '../theme/ThemeProvider';
import { getMonthlyNews, analyzeNewsStream, NewsSource } from '../api/news';
import ArticleDetailDialog from '../components/ArticleDetailDialog';
import LoadingDots from '../components/LoadingDots';
import { NewsItem, NewsDataByDate, NewsFilterType, AnalysisResult, ImportanceLevel, ImpactDirection, ConfidenceLevel } from '../types/news';
import { NewsLabelStrip } from '../components/news/NewsLabelBadges';
import { useResponsive } from '../hooks/useResponsive';

interface CalendarDay {
  day: number;
  isOtherMonth: boolean;
  date: Date;
  dateStr: string;
}

interface DateGroup {
  date: string;
  news: NewsItem[];
}

interface FeedbackState {
  [newsId: string]: {
    userFeedback: 'like' | 'dislike' | null;
  };
}

export default function NewsTimelinePage() {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const { isMobile, isSmallScreen } = useResponsive();
  const isCompact = isMobile || isSmallScreen;

  // State
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(today);
  const [activeFilter, setActiveFilter] = useState<NewsFilterType>('all');
  const [newsSource, setNewsSource] = useState<NewsSource>('jeff-cox');
  const [isScrolling, setIsScrolling] = useState(false);
  const [newsData, setNewsData] = useState<NewsDataByDate>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTitleId, setActiveTitleId] = useState<string | null>(null);
  const [loadedMonths, setLoadedMonths] = useState<Set<string>>(new Set());
  const loadedMonthsRef = useRef<Set<string>>(new Set());
  const pendingRequestsRef = useRef<Set<string>>(new Set());
  const isFirstRenderRef = useRef(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [dialogDefaultLanguage, setDialogDefaultLanguage] = useState<'en' | 'zh' | null>(null);

  // AI analysis state
  const [analysisResults, setAnalysisResults] = useState<{ [newsId: string]: AnalysisResult }>({});
  const [expandedAnalysis, setExpandedAnalysis] = useState<string | null>(null);
  const [feedbackState, setFeedbackState] = useState<FeedbackState>({});

  // Refs
  const newsListRef = useRef<HTMLDivElement>(null);

  // Format date
  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Render calendar
  const renderCalendar = useCallback((year: number, month: number): CalendarDay[] => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const prevLastDay = new Date(year, month, 0);

    const firstDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const daysInPrevMonth = prevLastDay.getDate();

    const days: CalendarDay[] = [];

    // Previous month days
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      const date = new Date(year, month - 1, day);
      days.push({ day, isOtherMonth: true, date, dateStr: formatDate(date) });
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      days.push({ day, isOtherMonth: false, date, dateStr: formatDate(date) });
    }

    // Next month days
    const remainingDays = 42 - (firstDayOfWeek + daysInMonth);
    for (let day = 1; day <= remainingDays; day++) {
      const date = new Date(year, month + 1, day);
      days.push({ day, isOtherMonth: true, date, dateStr: formatDate(date) });
    }

    return days;
  }, []);

  // Load monthly news
  const loadMonthlyNews = useCallback(async (year: number, month: number, append = false, force = false) => {
    const monthKey = `${year}-${month}`;
    // Use refs to check loaded/pending state to avoid stale closures and dependency cycles
    if (!force && (loadedMonthsRef.current.has(monthKey) || pendingRequestsRef.current.has(monthKey))) return;

    pendingRequestsRef.current.add(monthKey);

    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const response = await getMonthlyNews(year, month + 1, activeFilter, newsSource);
      if (response.success) {
        setNewsData((prev) => ({ ...prev, ...response.data }));
        loadedMonthsRef.current = new Set([...loadedMonthsRef.current, monthKey]);
        setLoadedMonths(new Set(loadedMonthsRef.current));

        // Load pre-existing AI analysis
        const newAnalysisResults: { [newsId: string]: AnalysisResult } = {};
        Object.values(response.data).forEach((dayNews) => {
          dayNews.forEach((newsItem) => {
            if (newsItem.ai_analysis_status === 'completed' && newsItem.ai_analysis) {
              newAnalysisResults[newsItem.id] = {
                loading: false,
                impact: newsItem.ai_impact,
                analysis: newsItem.ai_analysis,
                streamContent: '',
                error: null,
              };
            }
          });
        });

        if (Object.keys(newAnalysisResults).length > 0) {
          setAnalysisResults((prev) => ({ ...prev, ...newAnalysisResults }));
        }
      } else {
        setError('Failed to load news');
      }
    } catch (err) {
      setError('Network request failed');
      console.error('Load monthly news error:', err);
    } finally {
      pendingRequestsRef.current.delete(monthKey);
      if (append) {
        setIsLoadingMore(false);
      } else {
        setIsLoading(false);
      }
    }
  }, [activeFilter, newsSource]);

  // Load adjacent month
  const loadAdjacentMonth = useCallback(async (direction: 'prev' | 'next') => {
    let targetYear = currentYear;
    let targetMonth = currentMonth;

    if (direction === 'prev') {
      if (currentMonth === 0) {
        targetYear = currentYear - 1;
        targetMonth = 11;
      } else {
        targetMonth = currentMonth - 1;
      }
    } else {
      if (currentMonth === 11) {
        targetYear = currentYear + 1;
        targetMonth = 0;
      } else {
        targetMonth = currentMonth + 1;
      }
    }

    await loadMonthlyNews(targetYear, targetMonth, true);
  }, [currentYear, currentMonth, loadMonthlyNews]);

  // Initialize on mount — load months sequentially to avoid overwhelming Supabase
  useEffect(() => {
    const init = async () => {
      await loadMonthlyNews(currentYear, currentMonth, false);
      await loadAdjacentMonth('prev');
      await loadAdjacentMonth('next');
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when filter or source changes (skip first render — mount effect handles it)
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    setNewsData({});
    loadedMonthsRef.current = new Set();
    pendingRequestsRef.current.clear();
    setLoadedMonths(new Set());
    setAnalysisResults({});
    const reload = async () => {
      await loadMonthlyNews(currentYear, currentMonth, false, true);
      await loadAdjacentMonth('prev');
      await loadAdjacentMonth('next');
    };
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, newsSource]);

  // Navigation functions
  const previousMonth = () => {
    let targetYear = currentYear;
    let targetMonth = currentMonth;

    if (currentMonth === 0) {
      targetMonth = 11;
      targetYear = currentYear - 1;
    } else {
      targetMonth = currentMonth - 1;
    }

    setCurrentYear(targetYear);
    setCurrentMonth(targetMonth);
    loadMonthlyNews(targetYear, targetMonth, true);
  };

  const nextMonth = () => {
    let targetYear = currentYear;
    let targetMonth = currentMonth;

    if (currentMonth === 11) {
      targetMonth = 0;
      targetYear = currentYear + 1;
    } else {
      targetMonth = currentMonth + 1;
    }

    setCurrentYear(targetYear);
    setCurrentMonth(targetMonth);
    loadMonthlyNews(targetYear, targetMonth, true);
  };

  const todayMonth = () => {
    const today = new Date();
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
    setSelectedDate(today);
    loadMonthlyNews(today.getFullYear(), today.getMonth(), true);
  };

  const handleYearChange = (event: SelectChangeEvent<number>) => {
    const newYear = event.target.value as number;
    setCurrentYear(newYear);
    loadMonthlyNews(newYear, currentMonth, true);
  };

  const handleMonthChange = (event: SelectChangeEvent<number>) => {
    const newMonth = event.target.value as number;
    setCurrentMonth(newMonth);
    loadMonthlyNews(currentYear, newMonth, true);
  };

  const selectDate = (date: Date) => {
    setSelectedDate(date);
    const dateStr = formatDate(date);
    const targetGroup = document.querySelector(`[data-date="${dateStr}"]`);
    if (targetGroup && newsListRef.current) {
      setIsScrolling(true);
      targetGroup.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => setIsScrolling(false), 1000);
    }
  };

  // Check if date has news
  const hasNews = (dateStr: string): boolean => newsData[dateStr]?.length > 0;
  const getNewsCount = (dateStr: string): number => newsData[dateStr]?.length || 0;

  // Check if date has critical-importance articles
  const hasCriticalNews = (dateStr: string): boolean => {
    const articles = newsData[dateStr] || [];
    return articles.some((article) => article.importance_level === 'critical');
  };

  // Get news density level for visual indicator (0=none, 1=low, 2=medium, 3=high)
  const getNewsDensity = (dateStr: string): number => {
    const count = getNewsCount(dateStr);
    if (count === 0) return 0;
    if (count < 3) return 1;
    if (count < 5) return 2;
    return 3; // 5+ articles = high density
  };

  // Format date label
  const formatDateLabel = (dateStr: string): string => {
    const [, month, day] = dateStr.split('-');
    return `${parseInt(month)}/${parseInt(day)}`;
  };

  // Filter news
  const getFilteredNews = (): DateGroup[] => {
    const allNews: DateGroup[] = [];
    const sortedDates = Object.keys(newsData).sort((a, b) => b.localeCompare(a));

    sortedDates.forEach((dateStr) => {
      const dayNews = newsData[dateStr] || [];
      if (dayNews.length > 0) {
        const filtered = dayNews.filter((item) => {
          if (activeFilter === 'all') return true;
          if (activeFilter === 'important') return item.important;
          // Importance level filters
          if (activeFilter === 'critical') return item.importance_level === 'critical';
          if (activeFilter === 'high') return item.importance_level === 'high';
          if (activeFilter === 'medium') return item.importance_level === 'medium';
          if (activeFilter === 'low') return item.importance_level === 'low';
          // Category filters
          if (activeFilter === 'crypto')
            return item.tags.some((tag) => ['Bitcoin', 'Crypto', 'BTC', 'Ethereum', 'ETH'].includes(tag));
          if (activeFilter === 'stocks')
            return item.tags.some((tag) => ['Stocks', 'Market', 'NASDAQ', 'S&P', 'Tech'].includes(tag));
          if (activeFilter === 'forex')
            return item.tags.some((tag) => ['Forex', 'USD', 'EUR', 'GBP', 'JPY', 'CNY'].includes(tag));
          return true;
        });
        if (filtered.length > 0) {
          allNews.push({ date: dateStr, news: filtered });
        }
      }
    });

    return allNews;
  };

  // Render titles list
  const renderTitlesList = (): (NewsItem & { dateStr: string })[] => {
    const allTitles: (NewsItem & { dateStr: string })[] = [];
    const sortedDates = Object.keys(newsData).sort((a, b) => b.localeCompare(a));

    sortedDates.forEach((dateStr) => {
      const dayNews = newsData[dateStr] || [];
      dayNews.forEach((item) => {
        const matchesFilter =
          activeFilter === 'all' ||
          (activeFilter === 'important' && item.important) ||
          // Importance level filters
          (activeFilter === 'critical' && item.importance_level === 'critical') ||
          (activeFilter === 'high' && item.importance_level === 'high') ||
          (activeFilter === 'medium' && item.importance_level === 'medium') ||
          (activeFilter === 'low' && item.importance_level === 'low') ||
          // Category filters
          (activeFilter === 'crypto' && item.tags.some((tag) => ['Bitcoin', 'Crypto', 'BTC', 'Ethereum', 'ETH'].includes(tag))) ||
          (activeFilter === 'stocks' && item.tags.some((tag) => ['Stocks', 'Market', 'NASDAQ', 'S&P', 'Tech'].includes(tag))) ||
          (activeFilter === 'forex' && item.tags.some((tag) => ['Forex', 'USD', 'EUR', 'GBP', 'JPY', 'CNY'].includes(tag)));

        if (matchesFilter) {
          allTitles.push({ ...item, dateStr });
        }
      });
    });

    return allTitles;
  };

  // Scroll to news
  const scrollToNews = (newsId: string, dateStr: string) => {
    setActiveTitleId(newsId);
    const targetGroup = newsListRef.current?.querySelector(`[data-date="${dateStr}"]`) as HTMLElement;
    if (targetGroup) {
      setIsScrolling(true);
      targetGroup.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        targetGroup.style.background = `${theme.brand.primary}08`;
        targetGroup.style.borderLeft = `3px solid ${theme.brand.primary}50`;
        setTimeout(() => {
          targetGroup.style.background = '';
          targetGroup.style.borderLeft = '';
        }, 1500);
        setIsScrolling(false);
      }, 500);
    }

    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    setSelectedDate(date);
  };

  // Article dialog
  const openArticleInEnglish = (articleId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedArticleId(articleId);
    setDialogDefaultLanguage('en');
    setDetailDialogOpen(true);
  };

  const openArticleInChinese = (articleId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedArticleId(articleId);
    setDialogDefaultLanguage('zh');
    setDetailDialogOpen(true);
  };

  const handleOpenArticle = (articleId: string) => {
    setSelectedArticleId(articleId);
    setDetailDialogOpen(true);
  };

  const handleCloseArticle = () => {
    setDetailDialogOpen(false);
    setSelectedArticleId(null);
    setDialogDefaultLanguage(null);
  };

  // AI Analysis
  const analyzeNews = async (newsItem: NewsItem, event?: React.MouseEvent) => {
    if (event) event.stopPropagation();
    const newsId = newsItem.id;

    if (analysisResults[newsId]?.loading) return;

    if (expandedAnalysis === newsId) {
      setExpandedAnalysis(null);
      return;
    }

    if (analysisResults[newsId]?.analysis) {
      setExpandedAnalysis(newsId);
      return;
    }

    setAnalysisResults((prev) => ({
      ...prev,
      [newsId]: { loading: true, streamContent: '', error: null },
    }));
    setExpandedAnalysis(newsId);

    analyzeNewsStream(
      newsItem.headline || newsItem.title_zh || newsItem.title || '',
      newsItem.content_full_zh || newsItem.content_zh || newsItem.summary || newsItem.content_full || newsItem.content || '',
      newsItem.source,
      newsItem.id,
      (chunk) => {
        setAnalysisResults((prev) => ({
          ...prev,
          [newsId]: { ...prev[newsId], streamContent: (prev[newsId]?.streamContent || '') + chunk },
        }));
      },
      (impact, analysis) => {
        setAnalysisResults((prev) => ({
          ...prev,
          [newsId]: {
            loading: false,
            impact: impact as 'positive' | 'negative' | 'neutral',
            analysis,
            streamContent: '',
            error: null,
          },
        }));
      },
      (error) => {
        setAnalysisResults((prev) => ({
          ...prev,
          [newsId]: { loading: false, error, streamContent: '' },
        }));
      }
    );
  };

  // Feedback
  const submitFeedback = async (articleId: string, feedbackType: 'like' | 'dislike') => {
    const currentFeedback = feedbackState[articleId]?.userFeedback;
    const newFeedback = currentFeedback === feedbackType ? null : feedbackType;

    setFeedbackState((prev) => ({
      ...prev,
      [articleId]: { userFeedback: newFeedback },
    }));
  };

  // Scroll handler
  const updateCalendarByScroll = useCallback(() => {
    if (isScrolling || !newsListRef.current) return;

    const newsListElement = newsListRef.current;
    const newsGroups = newsListElement.querySelectorAll('[data-date]');
    const scrollTop = newsListElement.scrollTop;
    const scrollHeight = newsListElement.scrollHeight;
    const clientHeight = newsListElement.clientHeight;
    const viewportTop = scrollTop + 100;

    // Load more at top
    if (scrollTop < 200 && !isLoadingMore) {
      const sortedDates = Object.keys(newsData).sort((a, b) => b.localeCompare(a));
      if (sortedDates.length > 0) {
        const firstDate = sortedDates[0];
        const [year, month] = firstDate.split('-').map(Number);
        let targetYear = year;
        let targetMonth = month - 1;

        if (targetMonth === 11) {
          targetYear = year + 1;
          targetMonth = 0;
        } else {
          targetMonth = targetMonth + 1;
        }

        // Use ref to avoid stale closure — loadMonthlyNews also checks refs internally
        loadMonthlyNews(targetYear, targetMonth, true);
      }
    }

    // Load more at bottom
    if (scrollHeight - scrollTop - clientHeight < 200 && !isLoadingMore) {
      const sortedDates = Object.keys(newsData).sort((a, b) => b.localeCompare(a));
      if (sortedDates.length > 0) {
        const lastDate = sortedDates[sortedDates.length - 1];
        const [year, month] = lastDate.split('-').map(Number);
        let targetYear = year;
        let targetMonth = month - 1;

        if (targetMonth === 0) {
          targetYear = year - 1;
          targetMonth = 11;
        } else {
          targetMonth = targetMonth - 1;
        }

        // Use ref to avoid stale closure — loadMonthlyNews also checks refs internally
        loadMonthlyNews(targetYear, targetMonth, true);
      }
    }

    // Update calendar highlight
    let currentGroup: Element | null = null;
    newsGroups.forEach((group) => {
      const groupTop = (group as HTMLElement).offsetTop - newsListElement.offsetTop;
      if (groupTop <= viewportTop) {
        currentGroup = group;
      }
    });

    if (currentGroup) {
      const dateStr = (currentGroup as HTMLElement).dataset.date;
      if (dateStr) {
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day);

        if (dateStr !== formatDate(selectedDate)) {
          setSelectedDate(date);
          if (year !== currentYear || month - 1 !== currentMonth) {
            setCurrentYear(year);
            setCurrentMonth(month - 1);
          }
        }
      }
    }
  }, [isScrolling, selectedDate, newsData, isLoadingMore, loadMonthlyNews, currentYear, currentMonth]);

  // Setup scroll listener
  useEffect(() => {
    const newsListElement = newsListRef.current;
    if (!newsListElement) return;

    let scrollTimeout: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      if (isScrolling) return;
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(updateCalendarByScroll, 100);
    };

    newsListElement.addEventListener('scroll', handleScroll);
    return () => {
      newsListElement.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [updateCalendarByScroll, isScrolling]);

  const filteredNews = getFilteredNews();
  const titlesList = renderTitlesList();
  const calendarDays = renderCalendar(currentYear, currentMonth);

  return (
    <Box
      sx={{
        height: isCompact ? 'calc(100vh - 48px)' : '100vh',
        width: isCompact ? 'calc(100% + 32px)' : 'calc(100% + 48px)',
        display: 'flex',
        bgcolor: theme.background.primary,
        color: theme.text.primary,
        overflow: 'hidden',
        m: isCompact ? -2 : -3,
      }}
    >
      {/* Left Calendar Panel */}
      <Box
        sx={{
          width: '340px',
          minWidth: '340px',
          bgcolor: theme.background.secondary,
          borderRight: `1px solid ${theme.border.default}`,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        {/* Year/Month Selector */}
        <Box
          sx={{
            p: 2.5,
            bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
            borderBottom: `1px solid ${theme.border.default}`,
            flexShrink: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography
              sx={{
                fontSize: 20,
                fontWeight: 500,
                color: theme.text.primary,
                cursor: 'pointer',
                transition: 'color 0.3s ease',
                '&:hover': { color: theme.brand.primary },
              }}
            >
              {currentYear}/{currentMonth + 1}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <IconButton
                size="small"
                onClick={previousMonth}
                sx={{
                  width: 32,
                  height: 32,
                  bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  border: `1px solid ${theme.border.subtle}`,
                  borderRadius: 1,
                  color: theme.text.muted,
                  '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', color: theme.text.secondary },
                }}
              >
                <ChevronLeftIcon size={16} />
              </IconButton>
              <IconButton
                size="small"
                onClick={todayMonth}
                title="Today"
                sx={{
                  width: 32,
                  height: 32,
                  bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  border: `1px solid ${theme.border.subtle}`,
                  borderRadius: 1,
                  color: theme.text.muted,
                  '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', color: theme.text.secondary },
                }}
              >
                <TodayIcon size={16} />
              </IconButton>
              <IconButton
                size="small"
                onClick={nextMonth}
                sx={{
                  width: 32,
                  height: 32,
                  bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  border: `1px solid ${theme.border.subtle}`,
                  borderRadius: 1,
                  color: theme.text.muted,
                  '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', color: theme.text.secondary },
                }}
              >
                <ChevronRightIcon size={16} />
              </IconButton>
            </Box>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            <FormControl size="small">
              <Select
                value={currentYear}
                onChange={handleYearChange}
                sx={{
                  bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                  border: `1px solid ${theme.border.subtle}`,
                  borderRadius: 1,
                  color: theme.text.secondary,
                  fontSize: 14,
                  '& .MuiSelect-icon': { color: theme.text.muted },
                  '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
                }}
              >
                {[2026, 2025, 2024, 2023, 2022, 2021].map((year) => (
                  <MenuItem key={year} value={year}>{year}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small">
              <Select
                value={currentMonth}
                onChange={handleMonthChange}
                sx={{
                  bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                  border: `1px solid ${theme.border.subtle}`,
                  borderRadius: 1,
                  color: theme.text.secondary,
                  fontSize: 14,
                  '& .MuiSelect-icon': { color: theme.text.muted },
                  '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
                }}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <MenuItem key={i} value={i}>{i + 1}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </Box>

        {/* Calendar Grid */}
        <Box sx={{ p: 2.5, flexShrink: 0 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, mb: 1 }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <Box key={day} sx={{ textAlign: 'center', fontSize: 11, color: theme.text.muted, p: 1, fontWeight: 600, textTransform: 'uppercase' }}>
                {day}
              </Box>
            ))}
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
            {calendarDays.map((dayData, index) => {
              const isSelected = dayData.date.toDateString() === selectedDate.toDateString();
              const hasNewsData = hasNews(dayData.dateStr);
              const newsCount = getNewsCount(dayData.dateStr);
              const hasCritical = hasCriticalNews(dayData.dateStr);
              const density = getNewsDensity(dayData.dateStr);

              // Density-based background intensity
              const densityBg = density === 0
                ? (isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)')
                : density === 1
                  ? `${theme.brand.primary}08`
                  : density === 2
                    ? `${theme.brand.primary}15`
                    : `${theme.brand.primary}25`; // High density (5+ articles)

              return (
                <Box
                  key={index}
                  onClick={() => selectDate(dayData.date)}
                  sx={{
                    aspectRatio: '1',
                    bgcolor: isSelected ? `${theme.brand.primary}20` : densityBg,
                    border: `1px solid ${isSelected ? `${theme.brand.primary}40` : hasCritical ? 'rgba(244, 67, 54, 0.5)' : theme.border.subtle}`,
                    borderRadius: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    position: 'relative',
                    opacity: dayData.isOtherMonth ? 0.3 : 1,
                    '&:hover': {
                      bgcolor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                      borderColor: theme.border.hover,
                      transform: 'scale(1.05)',
                    },
                    // News indicator dot at bottom
                    '&::after': hasNewsData ? {
                      content: '""',
                      position: 'absolute',
                      bottom: 4,
                      width: density >= 3 ? 6 : 4,
                      height: density >= 3 ? 6 : 4,
                      bgcolor: hasCritical ? '#f44336' : theme.brand.primary,
                      borderRadius: '50%',
                      boxShadow: hasCritical ? '0 0 4px rgba(244, 67, 54, 0.5)' : undefined,
                    } : undefined,
                    // Critical news accent - red left border
                    ...(hasCritical && !dayData.isOtherMonth ? {
                      borderLeft: '3px solid #f44336',
                    } : {}),
                  }}
                >
                  <Typography sx={{ fontSize: 14, color: theme.text.secondary, fontWeight: 500 }}>
                    {dayData.day}
                  </Typography>
                  {newsCount > 0 && (
                    <Typography
                      sx={{
                        fontSize: 10,
                        color: hasCritical ? '#f44336' : theme.brand.primary,
                        mt: 0.25,
                        fontWeight: density >= 3 ? 600 : 400,
                      }}
                    >
                      {newsCount}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* News Titles Section */}
        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            borderTop: `1px solid ${theme.border.subtle}`,
            '&::-webkit-scrollbar': { width: 4 },
            '&::-webkit-scrollbar-track': { background: 'transparent' },
            '&::-webkit-scrollbar-thumb': { background: `${theme.text.muted}20`, borderRadius: 4 },
          }}
        >
          <Box
            sx={{
              px: 1.5,
              py: 1,
              borderBottom: `1px solid ${theme.border.subtle}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
            <Typography sx={{ fontSize: 10, textTransform: 'uppercase', color: theme.text.disabled, fontWeight: 600, letterSpacing: '0.05em', fontFamily: 'var(--font-ui)' }}>
              Headlines
            </Typography>
            <Typography
              sx={{
                fontSize: 10,
                color: theme.text.muted,
                bgcolor: theme.background.tertiary,
                px: 1,
                py: 0.25,
                borderRadius: '4px',
                fontWeight: 500,
                fontFamily: 'var(--font-ui)',
              }}
            >
              {isLoading ? <LoadingDots text="" fontSize={11} /> : `${titlesList.length} articles`}
            </Typography>
          </Box>
          <Box sx={{ p: 1 }}>
            {isLoading ? (
              <Box sx={{ textAlign: 'center', p: '30px 20px' }}>
                <LoadingDots text="Loading headlines" fontSize={12} />
              </Box>
            ) : error ? (
              <Typography sx={{ textAlign: 'center', color: theme.text.muted, p: '30px 20px', fontSize: 12 }}>
                Failed to load
              </Typography>
            ) : titlesList.length > 0 ? (
              titlesList.map((news) => {
                const [, month, day] = news.dateStr.split('-');
                const dateLabel = `${parseInt(month)}/${parseInt(day)} · ${news.time}`;

                return (
                  <Box
                    key={`${news.dateStr}-${news.id}`}
                    onClick={() => scrollToNews(news.id, news.dateStr)}
                    sx={{
                      p: 1.75,
                      mb: 0.5,
                      bgcolor: 'transparent',
                      borderLeft: activeTitleId === news.id
                        ? `3px solid ${theme.brand.primary}`
                        : '3px solid transparent',
                      borderRadius: 0,
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                      '&:hover': {
                        bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                      },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                      <Typography sx={{ fontSize: 11, color: theme.text.muted, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        {dateLabel}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {news.important && (
                          <Typography
                            sx={{
                              fontSize: 9,
                              px: 0.75,
                              py: 0.25,
                              borderRadius: 0.5,
                              fontWeight: 500,
                              bgcolor: 'rgba(255, 107, 107, 0.15)',
                              border: '1px solid rgba(255, 107, 107, 0.3)',
                              color: 'rgba(255, 107, 107, 0.9)',
                            }}
                          >
                            Important
                          </Typography>
                        )}
                        {news.source && (
                          <Typography
                            sx={{
                              fontSize: 9,
                              px: 0.75,
                              py: 0.25,
                              borderRadius: 0.5,
                              fontWeight: 500,
                              bgcolor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                              border: `1px solid ${theme.border.subtle}`,
                              color: theme.text.muted,
                            }}
                          >
                            {news.source}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                    <Typography sx={{ fontSize: 13, color: theme.text.secondary, lineHeight: 1.5, fontWeight: 400 }}>
                      {news.headline}
                    </Typography>
                  </Box>
                );
              })
            ) : (
              <Typography sx={{ textAlign: 'center', color: theme.text.muted, p: '30px 20px', fontSize: 12 }}>
                No headlines
              </Typography>
            )}
          </Box>
        </Box>
      </Box>

      {/* Right News Panel */}
      <Box sx={{ flex: 1, bgcolor: theme.background.primary, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* News Header */}
        <Box
          sx={{
            px: 2.5,
            py: 1.5,
            borderBottom: `1px solid ${theme.border.subtle}`,
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box>
              <Typography sx={{ fontSize: 20, fontWeight: 700, color: theme.text.primary, fontFamily: 'var(--font-reading)', letterSpacing: '-0.02em' }}>
                Market News
              </Typography>
              <Typography sx={{ fontSize: 12, color: theme.text.muted, mt: 0.25, fontFamily: 'var(--font-ui)' }}>
                {currentYear}/{currentMonth + 1}
              </Typography>
            </Box>
            {/* Source Tabs */}
            <Box
              sx={{
                display: 'flex',
                bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                border: `1px solid ${theme.border.subtle}`,
                borderRadius: 1,
                p: 0.25,
              }}
            >
              {([
                { value: 'jeff-cox' as NewsSource, label: 'CNBC' },
                { value: 'bloomberg' as NewsSource, label: 'Bloomberg' },
              ]).map((src) => (
                <Box
                  key={src.value}
                  onClick={() => setNewsSource(src.value)}
                  sx={{
                    px: 1.5,
                    py: 0.5,
                    borderRadius: 0.75,
                    fontSize: 12,
                    fontFamily: 'var(--font-ui)',
                    fontWeight: newsSource === src.value ? 600 : 400,
                    color: newsSource === src.value ? theme.brand.primary : theme.text.muted,
                    bgcolor: newsSource === src.value
                      ? `${theme.brand.primary}15`
                      : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      bgcolor: newsSource === src.value
                        ? `${theme.brand.primary}20`
                        : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                    },
                  }}
                >
                  {src.label}
                </Box>
              ))}
            </Box>
          </Box>

          {/* Filter Bar */}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {/* Category Filters */}
            {(['all', 'important', 'crypto', 'stocks', 'forex'] as NewsFilterType[]).map((filter) => (
              <Chip
                key={filter}
                label={filter.charAt(0).toUpperCase() + filter.slice(1)}
                size="small"
                onClick={() => setActiveFilter(filter)}
                sx={{
                  bgcolor: activeFilter === filter ? `${theme.brand.primary}1F` : 'transparent',
                  border: `1px solid ${activeFilter === filter ? `${theme.brand.primary}4D` : (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)')}`,
                  color: activeFilter === filter ? theme.brand.primary : theme.text.muted,
                  fontWeight: activeFilter === filter ? 600 : 400,
                  fontSize: 12,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  '&:hover': {
                    bgcolor: activeFilter === filter
                      ? `${theme.brand.primary}25`
                      : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                  },
                }}
              />
            ))}

            {/* Separator */}
            <Box sx={{ width: 1, bgcolor: theme.border.subtle, mx: 0.5 }} />

            {/* Importance Level Filters */}
            {([
              { value: 'critical' as NewsFilterType, label: 'Critical', color: '#f44336' },
              { value: 'high' as NewsFilterType, label: 'High', color: '#ff9800' },
              { value: 'medium' as NewsFilterType, label: 'Medium', color: '#2196f3' },
              { value: 'low' as NewsFilterType, label: 'Low', color: '#9e9e9e' },
            ]).map((filter) => (
              <Chip
                key={filter.value}
                label={filter.label}
                size="small"
                onClick={() => setActiveFilter(filter.value)}
                sx={{
                  bgcolor: activeFilter === filter.value ? `${filter.color}1F` : 'transparent',
                  border: `1px solid ${activeFilter === filter.value ? `${filter.color}4D` : (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)')}`,
                  color: activeFilter === filter.value ? filter.color : theme.text.muted,
                  fontWeight: activeFilter === filter.value ? 600 : 400,
                  fontSize: 12,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  '&:hover': {
                    bgcolor: activeFilter === filter.value
                      ? `${filter.color}25`
                      : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                  },
                }}
              />
            ))}
          </Box>
        </Box>

        {/* News List */}
        <Box
          ref={newsListRef}
          sx={{
            flex: 1,
            overflowY: 'auto',
            px: 2.5,
            pt: 2.5,
            pb: 1,
            scrollBehavior: 'smooth',
          }}
        >
          {isLoading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 7.5 }}>
              <LoadingDots text="Loading news" fontSize={16} />
            </Box>
          ) : error ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 7.5, color: theme.text.muted }}>
              <Typography sx={{ fontSize: 48, mb: 2, opacity: 0.5 }}>❌</Typography>
              <Typography sx={{ fontSize: 16 }}>{error}</Typography>
            </Box>
          ) : filteredNews.length > 0 ? (
            <>
              {isLoadingMore && (
                <Box sx={{ textAlign: 'center', p: 2.5 }}>
                  <LoadingDots text="Loading more" />
                </Box>
              )}
              {filteredNews.map((dateGroup) => (
                <Box key={dateGroup.date} data-date={dateGroup.date} sx={{ '&:last-child': { mb: 0 } }}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      pt: 2,
                      pb: 1,
                      position: 'sticky',
                      top: 0,
                      bgcolor: theme.background.primary,
                      zIndex: 5,
                      borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: 12,
                        color: theme.text.muted,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        fontFamily: 'var(--font-ui)',
                        letterSpacing: '0.02em',
                      }}
                    >
                      {formatDateLabel(dateGroup.date)}
                    </Typography>
                    <Box sx={{ flex: 1, height: '0.5px', bgcolor: theme.border.subtle, ml: 1.5 }} />
                  </Box>

                  {dateGroup.news.map((newsItem) => (
                    <Box
                      key={newsItem.id}
                      onClick={() => handleOpenArticle(newsItem.id)}
                      sx={{
                        borderBottom: `1px solid ${theme.border.divider}`,
                        px: 1,
                        py: 2,
                        '&:last-child': { borderBottom: 'none' },
                        cursor: 'pointer',
                        transition: 'background-color 150ms ease',
                        '&:hover': {
                          bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                        },
                      }}
                    >
                      {/* Top Row: Labels + Source + Time */}
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <NewsLabelStrip
                            importanceLevel={newsItem.importance_level}
                            impact={newsItem.ai_impact}
                            confidence={newsItem.impact_confidence}
                            size="small"
                          />
                          <Typography sx={{ fontSize: 12, color: theme.text.muted, ml: 0.5 }}>
                            {newsItem.source}
                          </Typography>
                        </Box>
                        <Typography sx={{ fontSize: 12, color: theme.text.muted }}>
                          {newsItem.time}
                        </Typography>
                      </Box>

                      {/* Title */}
                      <Typography
                        sx={{
                          fontSize: '1.15rem',
                          fontWeight: 700,
                          color: theme.text.primary,
                          mb: 0.75,
                          lineHeight: 1.45,
                          fontFamily: 'var(--font-reading)',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        {newsItem.title_zh || newsItem.headline}
                      </Typography>

                      {/* Summary */}
                      <Typography
                        sx={{
                          fontSize: '0.9rem',
                          color: theme.text.secondary,
                          lineHeight: 1.75,
                          fontFamily: 'var(--font-reading)',
                          mb: 1.5,
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {newsItem.content_full_zh || newsItem.content_zh || newsItem.summary || newsItem.content_full || newsItem.content}
                      </Typography>

                      {/* Bottom Row: Tags + Action Buttons */}
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                          {newsItem.important && (
                            <Chip
                              label="Important"
                              size="small"
                              sx={{
                                bgcolor: 'rgba(255, 107, 107, 0.1)',
                                borderColor: 'rgba(255, 107, 107, 0.3)',
                                color: 'rgba(255, 107, 107, 0.9)',
                                border: '1px solid',
                                height: 22,
                                fontSize: 10,
                              }}
                            />
                          )}
                          {newsItem.tags.slice(0, 3).map((tag, index) => (
                            <Chip
                              key={index}
                              label={tag}
                              size="small"
                              sx={{
                                bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                                border: `1px solid ${theme.border.subtle}`,
                                color: theme.text.muted,
                                fontSize: 10,
                                height: 22,
                              }}
                            />
                          ))}
                        </Box>
                        <Box sx={{ display: 'flex', gap: 0.75 }}>
                          <Button
                            size="small"
                            onClick={(e) => openArticleInEnglish(newsItem.id, e)}
                            sx={{
                              px: 1.5,
                              py: 0.5,
                              minWidth: 'auto',
                              fontSize: 11,
                              bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                              border: `1px solid ${theme.border.subtle}`,
                              borderRadius: 1.5,
                              color: theme.text.secondary,
                              textTransform: 'none',
                              '&:hover': {
                                bgcolor: `${theme.brand.primary}15`,
                                borderColor: `${theme.brand.primary}30`,
                                color: theme.brand.primary,
                              },
                            }}
                          >
                            EN
                          </Button>
                          <Button
                            size="small"
                            onClick={(e) => openArticleInChinese(newsItem.id, e)}
                            sx={{
                              px: 1.5,
                              py: 0.5,
                              minWidth: 'auto',
                              fontSize: 11,
                              bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                              border: `1px solid ${theme.border.subtle}`,
                              borderRadius: 1.5,
                              color: theme.text.secondary,
                              textTransform: 'none',
                              '&:hover': {
                                bgcolor: `${theme.brand.primary}15`,
                                borderColor: `${theme.brand.primary}30`,
                                color: theme.brand.primary,
                              },
                            }}
                          >
                            CN
                          </Button>
                          <Button
                            size="small"
                            onClick={(e) => analyzeNews(newsItem, e)}
                            startIcon={<AIIcon size={14} />}
                            sx={{
                              px: 1.5,
                              py: 0.5,
                              minWidth: 'auto',
                              fontSize: 11,
                              background: 'linear-gradient(135deg, rgba(138, 43, 226, 0.1) 0%, rgba(75, 0, 130, 0.1) 100%)',
                              border: '1px solid rgba(138, 43, 226, 0.2)',
                              borderRadius: 1.5,
                              color: '#c8a2ff',
                              textTransform: 'none',
                              '&:hover': {
                                background: 'linear-gradient(135deg, rgba(138, 43, 226, 0.2) 0%, rgba(75, 0, 130, 0.15) 100%)',
                                borderColor: 'rgba(138, 43, 226, 0.4)',
                              },
                            }}
                          >
                            AI
                          </Button>
                        </Box>
                      </Box>

                      {/* AI Analysis Card */}
                      {expandedAnalysis === newsItem.id && (
                        <Box
                          onClick={(e) => e.stopPropagation()}
                          sx={{
                            mt: 2,
                            borderLeft: '2px solid rgba(138, 43, 226, 0.4)',
                            pl: 2,
                            animation: 'fadeIn 0.3s ease-in-out',
                            '@keyframes fadeIn': {
                              from: { opacity: 0, transform: 'translateY(-10px)' },
                              to: { opacity: 1, transform: 'translateY(0)' },
                            },
                          }}
                        >
                          {analysisResults[newsItem.id]?.loading ? (
                            <Box>
                              <Box
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 1.5,
                                  mb: 2,
                                  pb: 1.5,
                                  borderBottom: '1px solid rgba(200, 162, 255, 0.15)',
                                }}
                              >
                                <LoadingDots text="AI analyzing" fontSize={14} color="#c8a2ff" />
                              </Box>
                              {analysisResults[newsItem.id]?.streamContent && (
                                <Typography
                                  sx={{
                                    color: theme.text.primary,
                                    fontSize: 14,
                                    lineHeight: 1.8,
                                    whiteSpace: 'pre-wrap',
                                    minHeight: 60,
                                  }}
                                >
                                  {analysisResults[newsItem.id].streamContent}
                                  <Box
                                    component="span"
                                    sx={{
                                      display: 'inline-block',
                                      width: 8,
                                      height: 16,
                                      bgcolor: '#c8a2ff',
                                      ml: 0.25,
                                      animation: 'blink 1s infinite',
                                      '@keyframes blink': {
                                        '0%, 49%': { opacity: 1 },
                                        '50%, 100%': { opacity: 0 },
                                      },
                                    }}
                                  />
                                </Typography>
                              )}
                            </Box>
                          ) : analysisResults[newsItem.id]?.error ? (
                            <Typography sx={{ p: 2.5, textAlign: 'center', color: '#f44336', fontSize: 14 }}>
                              {analysisResults[newsItem.id].error}
                            </Typography>
                          ) : analysisResults[newsItem.id]?.analysis ? (
                            <Box>
                              <Box
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 1.5,
                                  mb: 2,
                                  pb: 1.5,
                                  borderBottom: '1px solid rgba(200, 162, 255, 0.15)',
                                }}
                              >
                                <Typography sx={{ fontSize: 14, color: theme.text.muted, fontWeight: 500 }}>
                                  Impact:
                                </Typography>
                                <Chip
                                  label={
                                    analysisResults[newsItem.id].impact === 'positive' ? 'Positive' :
                                    analysisResults[newsItem.id].impact === 'negative' ? 'Negative' : 'Neutral'
                                  }
                                  size="small"
                                  sx={{
                                    bgcolor:
                                      analysisResults[newsItem.id].impact === 'positive' ? 'rgba(76, 175, 80, 0.2)' :
                                      analysisResults[newsItem.id].impact === 'negative' ? 'rgba(244, 67, 54, 0.2)' :
                                      'rgba(158, 158, 158, 0.2)',
                                    color:
                                      analysisResults[newsItem.id].impact === 'positive' ? '#4caf50' :
                                      analysisResults[newsItem.id].impact === 'negative' ? '#f44336' : '#9e9e9e',
                                    border: `1px solid ${
                                      analysisResults[newsItem.id].impact === 'positive' ? 'rgba(76, 175, 80, 0.4)' :
                                      analysisResults[newsItem.id].impact === 'negative' ? 'rgba(244, 67, 54, 0.4)' :
                                      'rgba(158, 158, 158, 0.4)'
                                    }`,
                                    fontSize: 13,
                                    fontWeight: 600,
                                  }}
                                />
                              </Box>
                              <Typography
                                sx={{
                                  color: theme.text.primary,
                                  fontSize: 14,
                                  lineHeight: 1.8,
                                  whiteSpace: 'pre-wrap',
                                }}
                              >
                                {analysisResults[newsItem.id].analysis}
                              </Typography>
                              <Box
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 1,
                                  mt: 2.5,
                                  pt: 2,
                                  borderTop: '1px solid rgba(200, 162, 255, 0.15)',
                                }}
                              >
                                <Typography sx={{ fontSize: 13, color: theme.text.muted, fontWeight: 500 }}>
                                  Feedback:
                                </Typography>
                                <IconButton
                                  size="small"
                                  onClick={() => submitFeedback(newsItem.id, 'like')}
                                  sx={{
                                    p: 0.75,
                                    color: feedbackState[newsItem.id]?.userFeedback === 'like' ? '#5eddac' : theme.text.muted,
                                    bgcolor: feedbackState[newsItem.id]?.userFeedback === 'like' ? 'rgba(94, 221, 172, 0.1)' : 'transparent',
                                    borderRadius: 0.5,
                                  }}
                                >
                                  <ThumbUpIcon size={18} />
                                </IconButton>
                                <IconButton
                                  size="small"
                                  onClick={() => submitFeedback(newsItem.id, 'dislike')}
                                  sx={{
                                    p: 0.75,
                                    color: feedbackState[newsItem.id]?.userFeedback === 'dislike' ? '#f44336' : theme.text.muted,
                                    bgcolor: feedbackState[newsItem.id]?.userFeedback === 'dislike' ? 'rgba(244, 67, 54, 0.1)' : 'transparent',
                                    borderRadius: 0.5,
                                  }}
                                >
                                  <ThumbDownIcon size={18} />
                                </IconButton>
                              </Box>
                            </Box>
                          ) : null}
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>
              ))}
              {isLoadingMore && (
                <Box sx={{ textAlign: 'center', p: 2.5 }}>
                  <LoadingDots text="Loading more" />
                </Box>
              )}
            </>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 7.5, color: theme.text.muted }}>
              <Typography sx={{ fontSize: 48, mb: 2, opacity: 0.5 }}>📰</Typography>
              <Typography sx={{ fontSize: 16 }}>
                {activeFilter === 'all' ? 'No news this month' : `No ${activeFilter} news`}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* Article Detail Dialog */}
      <ArticleDetailDialog
        open={detailDialogOpen}
        onClose={handleCloseArticle}
        articleId={selectedArticleId}
        defaultLanguage={dialogDefaultLanguage}
        source={newsSource}
      />
    </Box>
  );
}
