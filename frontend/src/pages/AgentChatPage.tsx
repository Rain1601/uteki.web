import { useState, useRef, useEffect } from 'react';
import { getAuthHeaders } from '../hooks/useAuth';

import { API_BASE } from '../api/client';
import {
  Box,
  TextField,
  IconButton,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Tooltip,
  SwipeableDrawer,
} from '@mui/material';
import { SendHorizonal as SendIcon, Plus as AddIcon, History as HistoryIcon, Search as SearchIcon, Loader2, Globe } from 'lucide-react';
import { useTheme } from '../theme/ThemeProvider';
import { useResponsive, useKeyboardVisibility } from '../hooks/useResponsive';
import ChatMessage from '../components/ChatMessage';
import {
  EnhancedMessage,
  ResearchStatusCard,
  TypingIndicator,
} from '../components/chat';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  modelIcon?: string;
  research_data?: {
    thoughts?: string[];
    sources?: Record<string, number>;
    sourceUrls?: Array<{
      title: string;
      url: string;
      snippet: string;
      source: string;
    }>;
  };
}

interface Conversation {
  id: string;
  title: string;
  mode: string;
  created_at: string;
}

interface ModelOption {
  id: string;
  name: string;
  provider: string;
  icon: string;
  available: boolean;
}


export default function AgentChatPage() {
  const { theme, isDark } = useTheme();
  const { isMobile, isSmallScreen } = useResponsive();
  const { isKeyboardVisible, keyboardHeight } = useKeyboardVisibility();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedMode, setSelectedMode] = useState('research');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('claude-sonnet-4-20250514');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const textFieldRef = useRef<HTMLTextAreaElement>(null);

  // Deep Research state
  // researchMode removed — auto-detected by intent router
  const [researchStatus, setResearchStatus] = useState('');
  const [researchThoughts, setResearchThoughts] = useState<string[]>([]);
  const [researchSources, setResearchSources] = useState<Record<string, number>>({});
  const [researchSourceUrls, setResearchSourceUrls] = useState<any[]>([]);
  const [researchInProgress, setResearchInProgress] = useState(false);
  const [currentSourceReading, setCurrentSourceReading] = useState('');

  const scrollToBottom = () => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 100;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    loadConversations();
    loadAvailableModels();
  }, []);

  const loadAvailableModels = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/agent/models/available`, { headers: getAuthHeaders(), credentials: 'include' });
      const data = await response.json();
      setModelOptions(data.models || []);
      if (data.default_model && data.models.length > 0) {
        setSelectedModelId(data.default_model);
      }
    } catch (error) {
      console.error('Failed to load available models:', error);
    }
  };

  const loadConversations = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/agent/conversations`, { headers: getAuthHeaders(), credentials: 'include' });
      const data = await response.json();
      setConversations(data.items || []);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  // Deep Research 发送处理
  // Direct variants that accept message text (for auto-routing)
  const handleDeepResearchSendDirect = (text: string) => handleDeepResearchSend(text);
  const handleRegularChatDirect = (text: string) => handleRegularChat(text);

  const handleDeepResearchSend = async (overrideText?: string) => {
    const text = overrideText || message;
    if (!text.trim() || isStreaming) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setMessage('');
    setIsStreaming(true);
    setResearchInProgress(true);
    setResearchThoughts([]);
    setResearchSources({});
    setResearchSourceUrls([]);
    setResearchStatus('Initializing research...');

    const assistantMessageId = (Date.now() + 1).toString();
    const currentIcon = modelOptions.find((m) => m.id === selectedModelId)?.icon;
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      modelIcon: currentIcon,
      research_data: { thoughts: [], sources: {}, sourceUrls: [] },
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const response = await fetch(`${API_BASE}/api/agent/research/stream`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ query: userMessage.content, max_sources: 20, max_scrape: 10 }),
      });

      if (!response.ok) throw new Error('Failed to start research');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let accumulatedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const eventData = JSON.parse(line.slice(6));
            switch (eventData.type) {
              case 'research_start':
                setResearchStatus('Research started...');
                break;
              case 'thought':
                if (eventData.data.thoughts) {
                  setResearchThoughts(eventData.data.thoughts);
                  setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, research_data: { ...msg.research_data, thoughts: eventData.data.thoughts } } : msg));
                }
                break;
              case 'status':
                setResearchStatus(eventData.data.message);
                break;
              case 'plan_created':
                setResearchStatus('Research plan created');
                break;
              case 'sources_update':
                setResearchStatus(`Found ${eventData.data.count} sources (${eventData.data.current_subtask}/${eventData.data.total_subtasks})`);
                break;
              case 'sources_complete':
                setResearchSources(eventData.data.sources || {});
                setResearchSourceUrls(eventData.data.sourceUrls || []);
                setResearchStatus('Sources collected, reading content...');
                setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, research_data: { ...msg.research_data, sources: eventData.data.sources, sourceUrls: eventData.data.sourceUrls } } : msg));
                break;
              case 'source_read': {
                const urlParts = eventData.data.url.split('/');
                const domain = urlParts[2] || eventData.data.url;
                setCurrentSourceReading(domain);
                setResearchStatus(`Reading: ${domain} (${eventData.data.current}/${eventData.data.total})`);
                break;
              }
              case 'content_chunk':
                accumulatedContent += eventData.data.content;
                setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, content: accumulatedContent } : msg));
                break;
              case 'research_complete':
                setResearchInProgress(false);
                setResearchStatus('');
                setCurrentSourceReading('');
                setIsStreaming(false);
                break;
              case 'error':
                setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, content: `Error: ${eventData.data.message}` } : msg));
                setResearchInProgress(false);
                setIsStreaming(false);
                break;
            }
          }
        }
      }
    } catch (error) {
      console.error('Research error:', error);
      setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, content: 'Sorry, an error occurred during research.' } : msg));
      setResearchInProgress(false);
      setIsStreaming(false);
    }
  };

  // ── Intent Router: LLM-based classification ──
  const classifyIntent = async (text: string): Promise<'research' | 'chat'> => {
    // Quick local shortcut for obvious cases (saves an API call)
    if (text.trim().length < 6) return 'chat';

    try {
      const context = messages.slice(-4).map((m) => ({
        role: m.role,
        content: m.content.slice(0, 200),
      }));

      const resp = await fetch(`${API_BASE}/api/agent/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          message: text,
          conversation_context: context.length > 0 ? context : undefined,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        return data.route === 'research' ? 'research' : 'chat';
      }
    } catch (e) {
      console.warn('Intent classification failed, defaulting to chat:', e);
    }
    return 'chat';
  };

  // ── Research confirmation state ──
  const [pendingResearchMsg, setPendingResearchMsg] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);

  const confirmResearch = () => {
    if (pendingResearchMsg) {
      const msg = pendingResearchMsg;
      setPendingResearchMsg(null);
      handleDeepResearchSend(msg);
    }
  };

  const declineResearch = () => {
    if (pendingResearchMsg) {
      const msg = pendingResearchMsg;
      setPendingResearchMsg(null);
      handleRegularChat(msg);
    }
  };

  // 发送消息（SSE流式）
  const handleSendMessage = async () => {
    if (!message.trim() || isStreaming || classifying) return;

    // Always auto-classify intent
    setClassifying(true);
    const intent = await classifyIntent(message);
    setClassifying(false);

    if (intent === 'research') {
      // Show confirmation card
      setPendingResearchMsg(message);
      setMessage('');
      return;
    }

    // Regular chat
    handleRegularChat(message);
  };

  const handleRegularChat = async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setMessage('');
    setIsStreaming(true);

    const assistantMessageId = (Date.now() + 1).toString();
    const currentIcon = modelOptions.find((m) => m.id === selectedModelId)?.icon;
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      modelIcon: currentIcon,
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const response = await fetch(`${API_BASE}/api/agent/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          conversation_id: currentConversationId,
          message: userMessage.content,
          mode: selectedMode,
          stream: true,
          model_id: selectedModelId,
        }),
      });

      if (!response.ok) throw new Error('Failed to send message');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let accumulatedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (data.conversation_id && !currentConversationId) {
              setCurrentConversationId(data.conversation_id);
            }
            if (!data.done && data.chunk) {
              accumulatedContent += data.chunk;
              setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, content: accumulatedContent } : msg));
            }
            if (data.done) {
              setIsStreaming(false);
              loadConversations();
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, content: '抱歉，发送消息时出现错误。' } : msg));
      setIsStreaming(false);
    }
  };

  const loadConversation = async (conversationId: string) => {
    try {
      const response = await fetch(`/api/agent/conversations/${conversationId}`, { headers: getAuthHeaders(), credentials: 'include' });
      const data = await response.json();
      const loadedMessages: Message[] = data.messages.map((msg: any) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.created_at),
      }));
      setMessages(loadedMessages);
      setCurrentConversationId(conversationId);
      setHistoryDrawerOpen(false);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleNewConversation = () => {
    setMessages([]);
    setCurrentConversationId(null);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const isEmpty = messages.length === 0;
  const compact = isMobile || isSmallScreen;
  const selectedModel = modelOptions.find((m) => m.id === selectedModelId);

  // ── Shared input composer (used in both empty + chat states) ──
  const renderComposer = () => (
    <Box
      sx={{
        width: '100%',
        maxWidth: 800,
        mx: 'auto',
        px: compact ? 1.5 : 0,
      }}
    >
      {/* Unified input card */}
      <Box
        sx={{
          position: 'relative',
          bgcolor: theme.background.secondary,
          border: `1px solid ${theme.border.default}`,
          borderRadius: '12px',
          overflow: 'hidden',
          transition: 'border-color 0.2s',
          '&:focus-within': {
            borderColor: theme.border.active,
          },
        }}
      >
        {/* Text area */}
        <TextField
          inputRef={textFieldRef}
          fullWidth
          multiline
          maxRows={6}
          minRows={1}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={isEmpty ? 'Ask anything...' : 'Reply...'}
          sx={{
            '& .MuiOutlinedInput-root': {
              bgcolor: 'transparent',
              fontSize: '0.95rem',
              color: theme.text.primary,
              lineHeight: 1.6,
              // Kill every possible source of a visible edge between the
              // textarea and the toolbar sibling below it.
              '& fieldset, &:hover fieldset, &.Mui-focused fieldset': {
                border: 'none',
              },
              '& .MuiOutlinedInput-notchedOutline': { border: 'none !important' },
              boxShadow: 'none',
            },
            '& .MuiInputBase-input': {
              py: 1.5,
              px: 2.5,
              color: theme.text.primary,
              border: 'none',
              outline: 'none',
              boxShadow: 'none',
              '&::placeholder': {
                color: theme.text.muted,
                opacity: 0.5,
              },
            },
            '& textarea': {
              resize: 'none',
              border: 'none',
              outline: 'none',
              boxShadow: 'none',
            },
          }}
        />

        {/* Bottom toolbar inside the card */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            px: 1.5,
            pb: 1,
            pt: 0,
          }}
        >
          {/* Left: classifying indicator */}
          {classifying ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, color: theme.text.muted, fontSize: '0.75rem' }}>
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              <span>Routing...</span>
            </Box>
          ) : (
            <Box sx={{ width: 1 }} />
          )}

          {/* Right: Model selector + Send */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {/* Model icons */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.25,
              }}
            >
              {modelOptions.map((model) => (
                <Tooltip key={model.id} title={model.available ? model.name : `${model.name} (未配置)`} placement="top">
                  <Box
                    onClick={() => model.available && setSelectedModelId(model.id)}
                    sx={{
                      width: 30,
                      height: 30,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: model.available ? 'pointer' : 'default',
                      borderRadius: '8px',
                      bgcolor: selectedModelId === model.id ? `${theme.brand.primary}18` : 'transparent',
                      opacity: model.available ? (selectedModelId === model.id ? 1 : 0.5) : 0.2,
                      transition: 'all 0.15s',
                      '&:hover': {
                        opacity: model.available ? 1 : 0.2,
                        bgcolor: model.available ? theme.background.hover : 'transparent',
                      },
                    }}
                  >
                    <Box
                      component="img"
                      src={model.icon}
                      alt={model.provider}
                      sx={{
                        width: 20,
                        height: 20,
                        borderRadius: '4px',
                        objectFit: 'contain',
                        filter: !model.available
                          ? 'grayscale(100%)'
                          : model.provider === 'OpenAI' && isDark
                          ? 'invert(1)'
                          : 'none',
                      }}
                      onError={(e: any) => { e.target.style.display = 'none'; }}
                    />
                  </Box>
                </Tooltip>
              ))}
            </Box>

            {/* Send button */}
            <IconButton
              onClick={handleSendMessage}
              disabled={!message.trim() || isStreaming}
              sx={{
                width: 32,
                height: 32,
                borderRadius: '10px',
                bgcolor: message.trim() && !isStreaming ? theme.brand.primary : 'transparent',
                color: message.trim() && !isStreaming ? '#fff' : theme.text.disabled,
                transition: 'all 0.2s',
                '&:hover': {
                  bgcolor: message.trim() && !isStreaming ? theme.brand.hover : 'transparent',
                },
                '&.Mui-disabled': {
                  color: theme.text.disabled,
                },
              }}
            >
              <SendIcon size={16} />
            </IconButton>
          </Box>
        </Box>
      </Box>

      {/* Subtle hint below */}
      {isEmpty && (
        <Typography
          sx={{
            textAlign: 'center',
            mt: 1.5,
            fontSize: '0.72rem',
            color: theme.text.muted,
            opacity: 0.4,
            letterSpacing: '0.02em',
          }}
        >
          {selectedModel?.name || 'AI'} · Shift+Enter for new line
        </Typography>
      )}
    </Box>
  );

  return (
    <Box
      sx={{
        height: 'calc(100vh - 48px)',
        m: -3,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: theme.background.primary,
        color: theme.text.primary,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Top bar — minimal, only when in chat */}
      {!isEmpty && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            px: compact ? 1.5 : 3,
            py: 1,
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          <Box sx={{ display: 'flex', gap: 0.75, pointerEvents: 'auto' }}>
            <IconButton
              onClick={() => setHistoryDrawerOpen(true)}
              size="small"
              sx={{
                color: theme.text.muted,
                opacity: 0.6,
                '&:hover': { opacity: 1, bgcolor: theme.background.secondary },
              }}
            >
              <HistoryIcon size={18} />
            </IconButton>
            <IconButton
              onClick={handleNewConversation}
              size="small"
              sx={{
                color: theme.text.muted,
                opacity: 0.6,
                '&:hover': { opacity: 1, bgcolor: theme.background.secondary },
              }}
            >
              <AddIcon size={18} />
            </IconButton>
          </Box>
        </Box>
      )}

      {/* Main content */}
      {isEmpty ? (
        /* ── Empty state ── */
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            px: 3,
            pb: 8,
          }}
        >
          {/* Top buttons in empty state */}
          <Box
            sx={{
              position: 'absolute',
              top: compact ? 8 : 16,
              right: compact ? 8 : 24,
              display: 'flex',
              gap: 0.75,
            }}
          >
            <IconButton
              onClick={() => setHistoryDrawerOpen(true)}
              size="small"
              sx={{
                color: theme.text.muted,
                opacity: 0.5,
                '&:hover': { opacity: 1, bgcolor: theme.background.secondary },
              }}
            >
              <HistoryIcon size={18} />
            </IconButton>
          </Box>

          {/* Welcome */}
          <Typography
            sx={{
              fontSize: compact ? '1.5rem' : '1.75rem',
              fontWeight: 400,
              textAlign: 'center',
              color: theme.text.secondary,
              mb: 5,
              letterSpacing: '-0.03em',
              fontFamily: "'Times New Roman', Georgia, serif",
            }}
          >
            What can I help with?
          </Typography>

          {renderComposer()}
        </Box>
      ) : (
        /* ── Chat state ── */
        <>
          {/* Messages */}
          <Box
            ref={scrollContainerRef}
            onScroll={handleScroll}
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: compact ? 1.5 : 2,
              px: compact ? 0 : 3,
              pt: compact ? 5 : 6,
              pb: 2,
              '&::-webkit-scrollbar': { width: 4 },
              '&::-webkit-scrollbar-track': { background: 'transparent' },
              '&::-webkit-scrollbar-thumb': {
                background: theme.text.muted,
                opacity: 0.2,
                borderRadius: 2,
                '&:hover': { opacity: 0.4 },
              },
            }}
          >
            <Box sx={{ maxWidth: 800, width: '100%', mx: 'auto', display: 'flex', flexDirection: 'column', gap: compact ? 1.5 : 2 }}>
              {messages.map((msg) => {
                if (msg.research_data) {
                  return <EnhancedMessage key={msg.id} message={msg} modelIcon={msg.modelIcon} />;
                }
                return <ChatMessage key={msg.id} message={msg} modelIcon={msg.modelIcon} />;
              })}

              {researchInProgress && (
                <>
                  {researchStatus && (
                    <ResearchStatusCard
                      status={researchStatus}
                      sourcesCount={Object.values(researchSources).reduce((a, b) => a + b, 0)}
                      currentSource={currentSourceReading}
                    />
                  )}
                  <TypingIndicator />
                </>
              )}

              {isStreaming && !researchInProgress && <TypingIndicator />}

              {/* Research confirmation card */}
              {pendingResearchMsg && (
                <Box sx={{
                  display: 'flex', flexDirection: 'column', gap: 1.5,
                  p: 2, borderRadius: '12px',
                  bgcolor: theme.background.secondary,
                  border: `1px solid ${theme.border.default}`,
                  maxWidth: 480,
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Globe size={16} style={{ color: theme.brand.primary }} />
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, fontFamily: 'var(--font-ui)' }}>
                      This needs web research
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: 12, color: theme.text.muted, lineHeight: 1.6 }}>
                    "{pendingResearchMsg.slice(0, 80)}{pendingResearchMsg.length > 80 ? '...' : ''}"
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Box
                      onClick={confirmResearch}
                      sx={{
                        px: 2, py: 0.6, borderRadius: '8px', cursor: 'pointer',
                        bgcolor: theme.brand.primary, color: '#fff',
                        fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-ui)',
                        transition: 'all 0.15s',
                        '&:hover': { bgcolor: theme.brand.hover },
                      }}
                    >
                      Search the web
                    </Box>
                    <Box
                      onClick={declineResearch}
                      sx={{
                        px: 2, py: 0.6, borderRadius: '8px', cursor: 'pointer',
                        border: `1px solid ${theme.border.default}`, color: theme.text.muted,
                        fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-ui)',
                        transition: 'all 0.15s',
                        '&:hover': { bgcolor: theme.background.hover, color: theme.text.secondary },
                      }}
                    >
                      Just answer
                    </Box>
                  </Box>
                </Box>
              )}

              <div ref={messagesEndRef} />
            </Box>
          </Box>

          {/* Bottom composer — seamless, no hard separator */}
          <Box
            sx={{
              position: compact ? 'fixed' : 'relative',
              bottom: isKeyboardVisible ? keyboardHeight : 0,
              left: 0,
              right: 0,
              py: compact ? 1 : 1.5,
              px: compact ? 1 : 3,
              zIndex: 100,
              bgcolor: theme.background.primary,
              // Soft fade instead of hard border
              '&::before': compact ? {} : {
                content: '""',
                position: 'absolute',
                top: -24,
                left: 0,
                right: 0,
                height: 24,
                background: `linear-gradient(transparent, ${theme.background.primary})`,
                pointerEvents: 'none',
              },
              transition: 'bottom 0.2s ease-out',
            }}
          >
            {renderComposer()}
          </Box>
        </>
      )}

      {/* History drawer */}
      <SwipeableDrawer
        anchor="right"
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        onOpen={() => setHistoryDrawerOpen(true)}
        disableBackdropTransition={false}
        disableDiscovery={false}
        sx={{
          '& .MuiDrawer-paper': {
            width: compact ? '85%' : 320,
            maxWidth: 360,
            bgcolor: theme.background.secondary,
            borderLeft: `1px solid ${theme.border.subtle}`,
          },
        }}
      >
        <Box sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            历史对话
          </Typography>
          <List>
            {conversations.map((conv) => (
              <ListItem key={conv.id} disablePadding>
                <ListItemButton
                  onClick={() => loadConversation(conv.id)}
                  selected={conv.id === currentConversationId}
                  sx={{
                    borderRadius: 1,
                    mb: 0.5,
                    minHeight: 48,
                    '&.Mui-selected': {
                      bgcolor: `rgba(100, 149, 237, 0.12)`,
                      borderLeft: `3px solid ${theme.brand.primary}`,
                    },
                  }}
                >
                  <ListItemText
                    primary={conv.title}
                    secondary={new Date(conv.created_at).toLocaleDateString()}
                    primaryTypographyProps={{
                      sx: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
      </SwipeableDrawer>
    </Box>
  );
}
