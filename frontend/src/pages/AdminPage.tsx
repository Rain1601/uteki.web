import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  IconButton,
  Alert,
  Tooltip,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Switch,
  Collapse,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Slider,
} from '@mui/material';
import { RefreshCw as RefreshIcon, Copy as CopyIcon, Globe as PublicIcon, Plus as AddIcon, Trash2 as DeleteIcon, X as CloseIcon, Pencil as EditIcon, Save as SaveIcon, Eye as VisibilityIcon, EyeOff as VisibilityOffIcon, ChevronDown as ExpandMoreIcon, ChevronUp as ExpandLessIcon, Star as StarIcon, LogOut as LogOutIcon, ShieldCheck as ShieldCheckIcon, Zap as ZapIcon, CircleCheck as CheckIcon, CircleAlert as AlertIcon } from 'lucide-react';
import LoadingDots from '../components/LoadingDots';
import { useTheme } from '../theme/ThemeProvider';
import { toast } from 'sonner';
import { get } from '../api/client';
import { adminApi } from '../api/admin';
import { useSystemHealth } from '../hooks/useAdmin';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { ModelLogo, getProviderDisplayName } from '../components/index/ModelLogos';
import type { APIKey, LLMProvider, AggregatorConfig, AggregatorBalance, AggregatorProvider } from '../types/admin';

/* ─── constants ─── */

const EXCHANGES = [
  { name: 'snb', label: '雪盈证券 (SNB)', features: ['现货', '港美股'], fields: ['api_key', 'account', 'totp_secret'] },
  { name: 'binance', label: '币安 (Binance)', features: ['现货', '合约', '加密货币'], fields: ['api_key', 'api_secret'] },
];

const PROVIDER_DEFAULTS: Record<string, { model: string; base_url?: string }> = {
  anthropic: { model: 'claude-sonnet-4-20250514' },
  openai: { model: 'gpt-4o' },
  deepseek: { model: 'deepseek-chat', base_url: 'https://api.deepseek.com' },
  google: { model: 'gemini-2.5-pro-thinking' },
  qwen: { model: 'qwen-plus', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  minimax: { model: 'MiniMax-Text-01', base_url: 'https://api.minimax.chat/v1' },
  doubao: { model: 'doubao-seed-2-0-pro-260215', base_url: 'https://ark.cn-beijing.volces.com/api/v3' },
};

const PROVIDERS = Object.keys(PROVIDER_DEFAULTS);

/* ═══════════════ Main Page ═══════════════ */

export default function AdminPage() {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'overview' | 'exchanges' | 'models'>('overview');
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);

  const handleLogoutConfirm = async () => {
    await logout();
    setLogoutDialogOpen(false);
    navigate('/login');
  };

  const cardBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)';
  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  return (
    <Box sx={{ height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, color: theme.text.primary, mb: 0.5 }}>
            Admin
          </Typography>
          <Typography sx={{ fontSize: 13, color: theme.text.muted }}>
            系统配置与管理
          </Typography>
        </Box>
        <Tooltip title="登出">
          <IconButton
            onClick={() => setLogoutDialogOpen(true)}
            sx={{
              color: theme.text.muted,
              '&:hover': { color: theme.status.error, bgcolor: isDark ? 'rgba(244,67,54,0.1)' : 'rgba(244,67,54,0.06)' },
            }}
          >
            <LogOutIcon size={20} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Tabs */}
      <Box sx={{ display: 'flex', gap: 0.5, mb: 3 }}>
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'exchanges', label: 'Exchanges' },
          { key: 'models', label: 'Models' },
        ].map(t => (
          <Chip
            key={t.key}
            label={t.label}
            onClick={() => setTab(t.key as any)}
            sx={{
              fontWeight: 600, fontSize: 12, cursor: 'pointer',
              bgcolor: tab === t.key ? 'rgba(100,149,237,0.15)' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              color: tab === t.key ? theme.brand.primary : theme.text.secondary,
              border: `1px solid ${tab === t.key ? 'rgba(100,149,237,0.3)' : 'transparent'}`,
            }}
          />
        ))}
      </Box>

      {tab === 'overview' && <OverviewTab theme={theme} isDark={isDark} />}
      {tab === 'exchanges' && <ExchangesTab theme={theme} isDark={isDark} cardBg={cardBg} cardBorder={cardBorder} />}
      {tab === 'models' && <ModelsTab theme={theme} isDark={isDark} cardBg={cardBg} cardBorder={cardBorder} />}

      {/* Logout Confirmation */}
      <Dialog open={logoutDialogOpen} onClose={() => setLogoutDialogOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { bgcolor: theme.background.secondary, color: theme.text.primary } }}>
        <DialogTitle>确认登出</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>确定要退出登录吗？</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setLogoutDialogOpen(false)} sx={{ color: theme.text.muted, textTransform: 'none' }}>取消</Button>
          <Button onClick={handleLogoutConfirm} sx={{ bgcolor: '#f44336', color: '#fff', textTransform: 'none', fontWeight: 600, '&:hover': { bgcolor: '#d32f2f' } }}>登出</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* ═══════════════ Overview Tab ═══════════════ */

function OverviewTab({ theme, isDark }: { theme: any; isDark: boolean }) {
  const [ipAddress, setIpAddress] = useState<string | null>(null);
  const [ipLoading, setIpLoading] = useState(false);
  const [ipCopied, setIpCopied] = useState(false);
  const { data: healthData, isLoading: healthLoading, refetch: refetchHealth } = useSystemHealth();

  const fetchIp = async () => {
    setIpLoading(true);
    try {
      const data = await get<{ ip: string | null }>('/api/admin/system/server-ip');
      setIpAddress(data.ip);
    } catch { setIpAddress(null); }
    finally { setIpLoading(false); }
  };

  const copyIp = async () => {
    if (!ipAddress) return;
    try {
      await navigator.clipboard.writeText(ipAddress);
      setIpCopied(true);
      toast.success('IP 已复制');
      setTimeout(() => setIpCopied(false), 2000);
    } catch { toast.error('复制失败'); }
  };

  useEffect(() => { fetchIp(); }, []);

  const statusChip = (s: string) => {
    const cfg: Record<string, { label: string; color: string; bg: string }> = {
      connected: { label: '已连接', color: theme.brand.primary, bg: 'rgba(46,229,172,0.2)' },
      disconnected: { label: '断开', color: theme.status.error, bg: 'rgba(244,67,54,0.2)' },
      degraded: { label: '降级', color: theme.status.warning, bg: 'rgba(255,167,38,0.2)' },
      disabled: { label: '禁用', color: theme.status.warning, bg: 'rgba(255,167,38,0.2)' },
    };
    const c = cfg[s] || cfg.disconnected;
    return <Chip label={c.label} size="small" sx={{ mt: 1, bgcolor: c.bg, color: c.color }} />;
  };

  return (
    <Grid container spacing={3}>
      {/* IP */}
      <Grid item xs={12} md={4}>
        <Card sx={{ bgcolor: isDark ? 'rgba(255,255,255,0.02)' : undefined }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PublicIcon size={24} style={{ color: theme.brand.primary }} />
                <Typography sx={{ fontWeight: 600, fontSize: 15 }}>服务器 IP</Typography>
              </Box>
              <IconButton size="small" onClick={fetchIp} disabled={ipLoading}><RefreshIcon /></IconButton>
            </Box>
            {ipLoading ? <LoadingDots text="获取中" /> : ipAddress ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.5, bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', borderRadius: 1, border: `1px solid ${theme.border.default}` }}>
                <Typography sx={{ flex: 1, fontFamily: 'monospace', fontSize: 18, fontWeight: 600, color: theme.brand.primary }}>{ipAddress}</Typography>
                <Tooltip title={ipCopied ? '已复制!' : '复制'}><IconButton size="small" onClick={copyIp}><CopyIcon size={18} /></IconButton></Tooltip>
              </Box>
            ) : <Alert severity="error">无法获取 IP</Alert>}
          </CardContent>
        </Card>
      </Grid>

      {/* Health */}
      <Grid item xs={12} md={8}>
        <Card sx={{ bgcolor: isDark ? 'rgba(255,255,255,0.02)' : undefined }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography sx={{ fontWeight: 600, fontSize: 15 }}>系统健康状态</Typography>
              <IconButton size="small" onClick={() => refetchHealth()}><RefreshIcon /></IconButton>
            </Box>
            {healthLoading ? <LoadingDots text="检查中" /> : healthData ? (
              <Grid container spacing={2}>
                {Object.entries(healthData.databases).map(([name, db]) => (
                  <Grid item xs={6} sm={4} md={2.4} key={name}>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{name}</Typography>
                      {statusChip((db as any).status)}
                    </Box>
                  </Grid>
                ))}
              </Grid>
            ) : <Alert severity="error">无法获取状态</Alert>}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

/* ═══════════════ Exchanges Tab ═══════════════ */

function ExchangesTab({ theme, isDark, cardBg, cardBorder }: { theme: any; isDark: boolean; cardBg: string; cardBorder: string }) {
  const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [editExchange, setEditExchange] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.apiKeys.list();
      setApiKeys(res.items);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const getExchangeKey = (name: string) => apiKeys.find(k => k.provider === name && k.is_active);

  const handleSave = async (exchangeName: string) => {
    setSaving(true);
    try {
      const existing = getExchangeKey(exchangeName);
      const extraConfig: Record<string, string> = {};
      const ex = EXCHANGES.find(e => e.name === exchangeName)!;

      // Separate api_key/api_secret from extra fields
      const apiKey = form.api_key || '';
      const apiSecret = form.api_secret || undefined;
      ex.fields.filter(f => f !== 'api_key' && f !== 'api_secret').forEach(f => {
        if (form[f]) extraConfig[f] = form[f];
      });

      if (existing) {
        // Update
        await adminApi.apiKeys.update(existing.id, {
          ...(apiKey ? { api_key: apiKey } : {}),
          ...(apiSecret ? { api_secret: apiSecret } : {}),
          extra_config: Object.keys(extraConfig).length > 0 ? extraConfig : undefined,
        });
        toast.success('已更新');
      } else {
        // Create
        if (!apiKey) { toast.error('请输入 API Key'); setSaving(false); return; }
        await adminApi.apiKeys.create({
          provider: exchangeName,
          display_name: ex.label,
          api_key: apiKey,
          api_secret: apiSecret,
          extra_config: Object.keys(extraConfig).length > 0 ? extraConfig : undefined,
          environment: 'production',
          is_active: true,
        });
        toast.success('已创建');
      }
      setEditExchange(null);
      setForm({});
      load();
    } catch (e: any) {
      toast.error(e.message || '保存失败');
    } finally { setSaving(false); }
  };

  const handleDelete = async (exchangeName: string) => {
    const key = getExchangeKey(exchangeName);
    if (!key) return;
    try {
      await adminApi.apiKeys.delete(key.id);
      toast.success('已删除');
      setDeleteConfirm(null);
      load();
    } catch (e: any) { toast.error(e.message || '删除失败'); }
  };

  if (loading) return <LoadingDots text="加载中" fontSize={13} />;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {EXCHANGES.map(ex => {
        const key = getExchangeKey(ex.name);
        const configured = !!key;
        const isEditing = editExchange === ex.name;

        return (
          <Box key={ex.name} sx={{ border: `1px solid ${isEditing ? theme.brand.primary + '40' : cardBorder}`, borderRadius: 2, bgcolor: cardBg, overflow: 'hidden' }}>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5 }}>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 600, color: theme.text.primary }}>{ex.label}</Typography>
                  <Chip
                    label={configured ? '已配置' : '未配置'}
                    size="small"
                    sx={{
                      fontSize: 10, height: 20,
                      bgcolor: configured ? 'rgba(46,229,172,0.15)' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                      color: configured ? theme.brand.primary : theme.text.muted,
                    }}
                  />
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                  {ex.features.map(f => (
                    <Chip key={f} label={f} size="small" variant="outlined" sx={{ fontSize: 10, height: 18, color: theme.text.muted, borderColor: theme.border.subtle }} />
                  ))}
                  {configured && key && (
                    <Typography sx={{ fontSize: 11, color: theme.text.muted, ml: 1, fontFamily: 'monospace' }}>
                      {key.api_key_masked}
                    </Typography>
                  )}
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button
                  size="small"
                  startIcon={configured ? <EditIcon /> : <AddIcon />}
                  onClick={() => { setEditExchange(isEditing ? null : ex.name); setForm({}); }}
                  sx={{ textTransform: 'none', fontSize: 12, fontWeight: 600, color: theme.brand.primary }}
                >
                  {configured ? '编辑' : '配置'}
                </Button>
                {configured && (
                  <IconButton size="small" onClick={() => setDeleteConfirm(ex.name)} sx={{ color: theme.text.muted, '&:hover': { color: '#f44336' } }}>
                    <DeleteIcon size={18} />
                  </IconButton>
                )}
              </Box>
            </Box>

            {/* Edit form */}
            <Collapse in={isEditing}>
              <Box sx={{ px: 2, pb: 2, pt: 0.5, display: 'flex', flexDirection: 'column', gap: 1.5, borderTop: `1px solid ${cardBorder}` }}>
                {ex.fields.map(field => (
                  <TextField
                    key={field}
                    label={field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    size="small"
                    fullWidth
                    type={showSecret[field] ? 'text' : 'password'}
                    value={form[field] || ''}
                    onChange={e => setForm({ ...form, [field]: e.target.value })}
                    placeholder={configured ? '留空不修改' : ''}
                    InputProps={{
                      sx: { color: theme.text.primary, fontSize: 13, fontFamily: 'monospace' },
                      endAdornment: (
                        <IconButton size="small" onClick={() => setShowSecret({ ...showSecret, [field]: !showSecret[field] })} sx={{ color: theme.text.muted }}>
                          {showSecret[field] ? <VisibilityOffIcon size={18} /> : <VisibilityIcon size={18} />}
                        </IconButton>
                      ),
                    }}
                    InputLabelProps={{ sx: { color: theme.text.muted, fontSize: 13 } }}
                    sx={{ '.MuiOutlinedInput-notchedOutline': { borderColor: cardBorder } }}
                  />
                ))}
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                  <Button size="small" onClick={() => setEditExchange(null)} sx={{ textTransform: 'none', color: theme.text.muted }}>取消</Button>
                  <Button
                    size="small"
                    startIcon={<SaveIcon />}
                    onClick={() => handleSave(ex.name)}
                    disabled={saving}
                    sx={{ bgcolor: theme.brand.primary, color: '#fff', textTransform: 'none', fontWeight: 600, fontSize: 12, borderRadius: 2, '&:hover': { bgcolor: theme.brand.hover } }}
                  >
                    {saving ? '保存中...' : '保存'}
                  </Button>
                </Box>
              </Box>
            </Collapse>
          </Box>
        );
      })}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { bgcolor: theme.background.secondary, color: theme.text.primary } }}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>确定要删除此交易所的 API Key 配置吗？此操作不可撤销。</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteConfirm(null)} sx={{ color: theme.text.muted, textTransform: 'none' }}>取消</Button>
          <Button onClick={() => deleteConfirm && handleDelete(deleteConfirm)} sx={{ bgcolor: '#f44336', color: '#fff', textTransform: 'none', fontWeight: 600, '&:hover': { bgcolor: '#d32f2f' } }}>删除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* ═══════════════ Interface For LLMs (Unified Aggregators) ═══════════════ */

const AGGREGATOR_META: Record<AggregatorProvider, { accent: string; tagline: string }> = {
  aihubmix: {
    accent: '#6366f1',
    tagline: '国内友好 · 单一 Key 访问 GPT/Claude/Gemini/DeepSeek 等',
  },
  openrouter: {
    accent: '#f59e0b',
    tagline: '全球开放 · 覆盖 300+ 模型，余额实时可查',
  },
};

function formatCredits(balance: AggregatorBalance | null | undefined): {
  text: string;
  color: string;
} | null {
  if (!balance) return null;
  if (balance.credits == null) return null;
  const c = balance.credits;
  const text = `${balance.currency === 'USD' ? '$' : ''}${c.toFixed(2)}`;
  let color = '#10b981'; // green
  if (c < 1) color = '#ef4444';
  else if (c < 5) color = '#f59e0b';
  return { text, color };
}

function InterfaceForLLMs({
  theme,
  isDark,
  cardBg,
  cardBorder,
}: {
  theme: any;
  isDark: boolean;
  cardBg: string;
  cardBorder: string;
}) {
  const [configs, setConfigs] = useState<AggregatorConfig[]>([]);
  const [balances, setBalances] = useState<Record<string, AggregatorBalance | null>>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await adminApi.aggregators.list();
      setConfigs(items);
      // Auto-refresh balance for configured providers that support it
      items.forEach(cfg => {
        if (cfg.configured && cfg.supports_balance) {
          adminApi.aggregators.balance(cfg.provider as AggregatorProvider)
            .then(r => setBalances(prev => ({ ...prev, [cfg.provider]: r.balance || null })))
            .catch(() => {});
        }
      });
    } catch {
      toast.error('加载聚合 Provider 失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleVerify = async (provider: AggregatorProvider) => {
    const key = inputs[provider]?.trim();
    if (!key) { toast.error('请先输入 API Key'); return; }
    setVerifying(prev => ({ ...prev, [provider]: true }));
    try {
      const r = await adminApi.aggregators.verify(provider, key);
      if (r.valid) {
        const balanceInfo = formatCredits(r.balance);
        toast.success(balanceInfo
          ? `Key 有效 · 余额 ${balanceInfo.text}`
          : 'Key 有效（余额查询不支持）');
      } else {
        toast.error(r.error || 'Key 无效');
      }
    } catch (e: any) {
      toast.error(e.message || '验证失败');
    } finally {
      setVerifying(prev => ({ ...prev, [provider]: false }));
    }
  };

  const handleSave = async (provider: AggregatorProvider) => {
    const key = inputs[provider]?.trim();
    if (!key) { toast.error('请先输入 API Key'); return; }
    setSaving(prev => ({ ...prev, [provider]: true }));
    try {
      await adminApi.aggregators.save(provider, key);
      toast.success('已保存');
      setInputs(prev => ({ ...prev, [provider]: '' }));
      setEditing(prev => ({ ...prev, [provider]: false }));
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e.message || '保存失败');
    } finally {
      setSaving(prev => ({ ...prev, [provider]: false }));
    }
  };

  const handleRefreshBalance = async (provider: AggregatorProvider) => {
    setRefreshing(prev => ({ ...prev, [provider]: true }));
    try {
      const r = await adminApi.aggregators.balance(provider);
      setBalances(prev => ({ ...prev, [provider]: r.balance || null }));
      const balanceInfo = formatCredits(r.balance);
      if (balanceInfo) toast.success(`余额 ${balanceInfo.text}`);
      else toast.info('该 provider 暂不支持余额查询');
    } catch (e: any) {
      toast.error(e.message || '刷新失败');
    } finally {
      setRefreshing(prev => ({ ...prev, [provider]: false }));
    }
  };

  const handleDelete = async (provider: AggregatorProvider) => {
    if (!confirm(`确定删除 ${provider} 的 Key 配置？`)) return;
    try {
      await adminApi.aggregators.delete(provider);
      toast.success('已删除');
      setBalances(prev => { const next = { ...prev }; delete next[provider]; return next; });
      await load();
    } catch (e: any) {
      toast.error(e.message || '删除失败');
    }
  };

  return (
    <Box sx={{ mb: 4 }}>
      <Box sx={{ mb: 1.5 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: theme.text.primary, display: 'flex', alignItems: 'center', gap: 1 }}>
          <ZapIcon size={16} style={{ color: theme.brand.primary }} />
          Interface For LLMs
        </Typography>
        <Typography sx={{ fontSize: 11.5, color: theme.text.muted, mt: 0.25 }}>
          统一 LLM 聚合入口 — 单一 API Key 访问多家模型。密钥仅属于当前账号，已加密存储。
        </Typography>
      </Box>

      {loading ? (
        <LoadingDots text="加载中" fontSize={12} />
      ) : (
        <Grid container spacing={2}>
          {configs.map(cfg => {
            const provider = cfg.provider as AggregatorProvider;
            const meta = AGGREGATOR_META[provider];
            const balance = balances[provider];
            const balanceInfo = formatCredits(balance);
            const isEditing = editing[provider] || !cfg.configured;
            const inputVal = inputs[provider] ?? '';

            return (
              <Grid item xs={12} md={6} key={provider}>
                <Box sx={{
                  position: 'relative',
                  p: 2.25,
                  bgcolor: cardBg,
                  border: `1px solid ${cfg.configured ? meta.accent + '30' : cardBorder}`,
                  borderRadius: 2,
                  transition: 'border-color 0.2s',
                }}>
                  {/* Accent bar */}
                  <Box sx={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, bgcolor: meta.accent, borderRadius: 2 }} />

                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Box>
                      <Typography sx={{ fontSize: 14, fontWeight: 700, color: theme.text.primary }}>
                        {cfg.display_name}
                      </Typography>
                      <Typography sx={{ fontSize: 11, color: theme.text.muted, mt: 0.25 }}>
                        {meta.tagline}
                      </Typography>
                    </Box>

                    {cfg.configured && (
                      <Chip
                        icon={<CheckIcon size={12} />}
                        label="已配置"
                        size="small"
                        sx={{
                          height: 20, fontSize: 10, fontWeight: 600,
                          bgcolor: meta.accent + '20',
                          color: meta.accent,
                          '& .MuiChip-icon': { color: meta.accent },
                        }}
                      />
                    )}
                  </Box>

                  {/* Configured read-only view */}
                  {cfg.configured && !isEditing && (
                    <>
                      <Box sx={{
                        display: 'flex', alignItems: 'center', gap: 1,
                        py: 1, px: 1.5, mt: 1.5,
                        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
                        borderRadius: 1,
                        fontFamily: 'monospace', fontSize: 12,
                        color: theme.text.secondary,
                      }}>
                        <span>{cfg.api_key_masked || '****'}</span>
                        <Box sx={{ flex: 1 }} />
                        {cfg.supports_balance && balanceInfo && (
                          <Typography sx={{ fontSize: 12, fontWeight: 700, color: balanceInfo.color }}>
                            {balanceInfo.text}
                          </Typography>
                        )}
                      </Box>

                      <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
                        {cfg.supports_balance && (
                          <Button
                            size="small"
                            startIcon={<RefreshIcon size={14} />}
                            onClick={() => handleRefreshBalance(provider)}
                            disabled={refreshing[provider]}
                            sx={{ textTransform: 'none', fontSize: 12, color: theme.text.secondary }}
                          >
                            {refreshing[provider] ? '刷新中…' : '刷新余额'}
                          </Button>
                        )}
                        <Button
                          size="small"
                          startIcon={<EditIcon size={14} />}
                          onClick={() => setEditing(prev => ({ ...prev, [provider]: true }))}
                          sx={{ textTransform: 'none', fontSize: 12, color: theme.text.secondary }}
                        >
                          更换 Key
                        </Button>
                        <Box sx={{ flex: 1 }} />
                        <Button
                          size="small"
                          startIcon={<DeleteIcon size={14} />}
                          onClick={() => handleDelete(provider)}
                          sx={{ textTransform: 'none', fontSize: 12, color: theme.status.error }}
                        >
                          删除
                        </Button>
                      </Box>

                      {!cfg.supports_balance && (
                        <Typography sx={{ fontSize: 10.5, color: theme.text.muted, mt: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <AlertIcon size={11} /> 该 provider 暂不支持通过 API 查询余额
                        </Typography>
                      )}
                    </>
                  )}

                  {/* Edit / Add view */}
                  {isEditing && (
                    <>
                      <TextField
                        fullWidth
                        size="small"
                        type={showKey[provider] ? 'text' : 'password'}
                        placeholder={`sk-... (${cfg.display_name} API Key)`}
                        value={inputVal}
                        onChange={e => setInputs(prev => ({ ...prev, [provider]: e.target.value }))}
                        sx={{
                          mt: 1.5,
                          '& .MuiOutlinedInput-root': {
                            fontSize: 12.5,
                            fontFamily: 'monospace',
                            bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                          },
                        }}
                        InputProps={{
                          endAdornment: (
                            <IconButton
                              size="small"
                              onClick={() => setShowKey(prev => ({ ...prev, [provider]: !prev[provider] }))}
                              sx={{ color: theme.text.muted }}
                            >
                              {showKey[provider] ? <VisibilityOffIcon size={14} /> : <VisibilityIcon size={14} />}
                            </IconButton>
                          ),
                        }}
                      />

                      <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
                        <Button
                          size="small"
                          startIcon={<ShieldCheckIcon size={14} />}
                          onClick={() => handleVerify(provider)}
                          disabled={!inputVal || verifying[provider] || saving[provider]}
                          sx={{
                            textTransform: 'none', fontSize: 12, fontWeight: 600,
                            color: theme.text.secondary,
                            border: `1px solid ${cardBorder}`,
                          }}
                        >
                          {verifying[provider] ? '验证中…' : '验证'}
                        </Button>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<SaveIcon size={14} />}
                          onClick={() => handleSave(provider)}
                          disabled={!inputVal || saving[provider] || verifying[provider]}
                          sx={{
                            textTransform: 'none', fontSize: 12, fontWeight: 600,
                            bgcolor: meta.accent,
                            '&:hover': { bgcolor: meta.accent, filter: 'brightness(1.1)' },
                          }}
                        >
                          {saving[provider] ? '保存中…' : '保存'}
                        </Button>
                        <Box sx={{ flex: 1 }} />
                        {cfg.configured && (
                          <Button
                            size="small"
                            onClick={() => {
                              setEditing(prev => ({ ...prev, [provider]: false }));
                              setInputs(prev => ({ ...prev, [provider]: '' }));
                            }}
                            sx={{ textTransform: 'none', fontSize: 12, color: theme.text.muted }}
                          >
                            取消
                          </Button>
                        )}
                      </Box>
                    </>
                  )}
                </Box>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Box>
  );
}

/* ═══════════════ Models Tab ═══════════════ */

function ModelsTab({ theme, isDark, cardBg, cardBorder }: { theme: any; isDark: boolean; cardBg: string; cardBorder: string }) {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Edit state
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const provRes = await adminApi.llmProviders.list();
      setProviders(provRes.items);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAddModel = async (providerName: string) => {
    setAddDialogOpen(false);
    const defaults = PROVIDER_DEFAULTS[providerName];
    // Open a pre-filled edit form for the new model
    setEditForm({
      _isNew: true,
      provider: providerName,
      model: defaults.model,
      display_name: getProviderDisplayName(providerName),
      api_key: '',
      base_url: defaults.base_url || '',
      temperature: 0,
      max_tokens: 4096,
      is_default: false,
    });
    setExpandedId('_new');
  };

  const handleSaveNew = async () => {
    if (!editForm.api_key) { toast.error('请输入 API Key'); return; }
    setSaving(true);
    try {
      await adminApi.llmProviders.createWithKey({
        provider: editForm.provider,
        model: editForm.model,
        display_name: editForm.display_name,
        api_key: editForm.api_key,
        base_url: editForm.base_url || undefined,
        temperature: editForm.temperature,
        max_tokens: editForm.max_tokens,
        is_default: editForm.is_default,
      });
      toast.success('模型已添加');
      setExpandedId(null);
      setEditForm({});
      load();
    } catch (e: any) { toast.error(e.message || '创建失败'); }
    finally { setSaving(false); }
  };

  const handleSaveEdit = async (id: string) => {
    setSaving(true);
    try {
      const update: Record<string, any> = {};
      if (editForm.model) update.model = editForm.model;
      if (editForm.display_name) update.display_name = editForm.display_name;
      if (editForm.api_key) update.api_key = editForm.api_key;
      if (editForm.is_default !== undefined) update.is_default = editForm.is_default;
      if (editForm.is_active !== undefined) update.is_active = editForm.is_active;
      const config: Record<string, any> = {};
      if (editForm.base_url !== undefined) config.base_url = editForm.base_url;
      if (editForm.temperature !== undefined) config.temperature = editForm.temperature;
      if (editForm.max_tokens !== undefined) config.max_tokens = editForm.max_tokens;
      if (Object.keys(config).length > 0) update.config = config;

      await adminApi.llmProviders.update(id, update);
      toast.success('已更新');
      setExpandedId(null);
      setEditForm({});
      load();
    } catch (e: any) { toast.error(e.message || '更新失败'); }
    finally { setSaving(false); }
  };

  const handleToggle = async (id: string, field: 'is_active' | 'is_default', value: boolean) => {
    try {
      await adminApi.llmProviders.update(id, { [field]: value });
      load();
    } catch { toast.error('操作失败'); }
  };

  const handleDelete = async (id: string) => {
    try {
      await adminApi.llmProviders.delete(id);
      toast.success('已删除');
      setDeleteConfirm(null);
      load();
    } catch (e: any) { toast.error(e.message || '删除失败'); }
  };

  const startEdit = (p: LLMProvider) => {
    setEditForm({
      model: p.model,
      display_name: p.display_name,
      api_key: '',
      base_url: p.config?.base_url || '',
      temperature: p.config?.temperature ?? 0,
      max_tokens: p.config?.max_tokens ?? 4096,
      is_default: p.is_default,
      is_active: p.is_active,
    });
    setShowKey(false);
    setExpandedId(expandedId === p.id ? null : p.id);
  };

  if (loading) return <LoadingDots text="加载中" fontSize={13} />;

  return (
    <Box>
      {/* Interface For LLMs — unified aggregator keys (AIHubMix / OpenRouter) */}
      <InterfaceForLLMs theme={theme} isDark={isDark} cardBg={cardBg} cardBorder={cardBorder} />

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600, color: theme.text.secondary }}>
          LLM Models ({providers.length})
        </Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={() => setAddDialogOpen(true)}
          sx={{ textTransform: 'none', fontSize: 13, fontWeight: 600, borderRadius: 2, color: theme.brand.primary, border: `1px solid ${theme.brand.primary}40` }}>
          添加模型
        </Button>
      </Box>

      {providers.length === 0 && expandedId !== '_new' ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography sx={{ color: theme.text.muted, fontSize: 13, mb: 2 }}>未配置任何模型</Typography>
          <Button startIcon={<AddIcon />} onClick={() => setAddDialogOpen(true)} sx={{ textTransform: 'none', fontSize: 13, fontWeight: 600, color: theme.brand.primary }}>添加第一个模型</Button>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {/* New model form (inline) */}
          {expandedId === '_new' && editForm._isNew && (
            <ModelEditCard
              theme={theme} isDark={isDark} cardBg={cardBg} cardBorder={cardBorder}
              editForm={editForm} setEditForm={setEditForm}
              showKey={showKey} setShowKey={setShowKey}
              saving={saving}
              isNew
              onSave={handleSaveNew}
              onCancel={() => { setExpandedId(null); setEditForm({}); }}
            />
          )}

          {/* Existing models */}
          {providers.map(p => (
            <Box key={p.id} sx={{ border: `1px solid ${expandedId === p.id ? theme.brand.primary + '40' : cardBorder}`, borderRadius: 1.5, bgcolor: cardBg, overflow: 'hidden' }}>
              {/* Row */}
              <Box onClick={() => startEdit(p)} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 0.8, cursor: 'pointer', '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' } }}>
                <ModelLogo provider={p.provider} size={22} isDark={isDark} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: theme.text.primary }}>{p.model}</Typography>
                    {p.is_default && (
                      <Chip icon={<StarIcon size={10} />} label="默认" size="small" sx={{ height: 18, fontSize: 10, bgcolor: 'rgba(255,193,7,0.15)', color: '#ffc107', '& .MuiChip-icon': { color: '#ffc107' } }} />
                    )}
                  </Box>
                  <Typography sx={{ fontSize: 11, color: theme.text.muted, lineHeight: 1.3 }}>
                    {getProviderDisplayName(p.provider)}
                    {p.config?.temperature != null ? ` · temp=${p.config.temperature}` : ''}
                  </Typography>
                </Box>
                <Switch
                  checked={p.is_active}
                  onChange={e => { e.stopPropagation(); handleToggle(p.id, 'is_active', !p.is_active); }}
                  size="small"
                  onClick={e => e.stopPropagation()}
                  sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: theme.brand.primary }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: theme.brand.primary } }}
                />
                {expandedId === p.id ? <ExpandLessIcon size={18} style={{ color: theme.text.muted }} /> : <ExpandMoreIcon size={18} style={{ color: theme.text.muted }} />}
              </Box>

              {/* Expanded edit */}
              <Collapse in={expandedId === p.id}>
                <ModelEditCard
                  theme={theme} isDark={isDark} cardBg={cardBg} cardBorder={cardBorder}
                  editForm={editForm} setEditForm={setEditForm}
                  showKey={showKey} setShowKey={setShowKey}
                  saving={saving}
                  isNew={false}
                  onSave={() => handleSaveEdit(p.id)}
                  onCancel={() => { setExpandedId(null); setEditForm({}); }}
                  onDelete={() => setDeleteConfirm(p.id)}
                  onToggleDefault={() => handleToggle(p.id, 'is_default', !p.is_default)}
                  isDefault={p.is_default}
                />
              </Collapse>
            </Box>
          ))}
        </Box>
      )}

      {/* Add Model Dialog */}
      <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { bgcolor: theme.background.secondary, color: theme.text.primary } }}>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 600 }}>选择 LLM 厂商</Typography>
          <IconButton size="small" onClick={() => setAddDialogOpen(false)} sx={{ color: theme.text.muted }}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {PROVIDERS.map(p => (
              <Button key={p} onClick={() => handleAddModel(p)} sx={{
                justifyContent: 'flex-start', gap: 1.5, px: 2, py: 1.2, textTransform: 'none', color: theme.text.primary,
                bgcolor: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 2,
                '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' },
              }}>
                <ModelLogo provider={p} size={24} isDark={isDark} />
                <Box sx={{ textAlign: 'left' }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{getProviderDisplayName(p)}</Typography>
                  <Typography sx={{ fontSize: 11, color: theme.text.muted }}>{PROVIDER_DEFAULTS[p].model}</Typography>
                </Box>
              </Button>
            ))}
          </Box>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { bgcolor: theme.background.secondary, color: theme.text.primary } }}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent><Typography sx={{ fontSize: 14 }}>确定要删除此模型配置吗？关联的 API Key 也会被删除。</Typography></DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteConfirm(null)} sx={{ color: theme.text.muted, textTransform: 'none' }}>取消</Button>
          <Button onClick={() => deleteConfirm && handleDelete(deleteConfirm)} sx={{ bgcolor: '#f44336', color: '#fff', textTransform: 'none', fontWeight: 600, '&:hover': { bgcolor: '#d32f2f' } }}>删除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* ─── Shared Model Edit Card ─── */

function ModelEditCard({ theme, isDark, cardBorder, editForm, setEditForm, showKey, setShowKey, saving, isNew, onSave, onCancel, onDelete, onToggleDefault, isDefault }: {
  theme: any; isDark: boolean; cardBg: string; cardBorder: string;
  editForm: Record<string, any>; setEditForm: (f: Record<string, any>) => void;
  showKey: boolean; setShowKey: (v: boolean) => void;
  saving: boolean; isNew: boolean;
  onSave: () => void; onCancel: () => void;
  onDelete?: () => void; onToggleDefault?: () => void; isDefault?: boolean;
}) {
  const inputSx = { '.MuiOutlinedInput-notchedOutline': { borderColor: cardBorder } };
  const labelSx = { sx: { color: theme.text.muted, fontSize: 12 } };
  const fieldSx = { sx: { color: theme.text.primary, fontSize: 13 } };

  return (
    <Box sx={{ px: 2, pb: 1.5, pt: isNew ? 1.5 : 0.5, display: 'flex', flexDirection: 'column', gap: 1, borderTop: isNew ? undefined : `1px solid ${cardBorder}`, border: isNew ? `1px solid ${theme.brand.primary}40` : undefined, borderRadius: isNew ? 2 : 0, bgcolor: isNew ? (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)') : undefined }}>
      {isNew && <Typography sx={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, mb: 0.5 }}>添加新模型</Typography>}

      {/* Row 1: Provider + Model */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        {isNew ? (
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel sx={{ color: theme.text.muted, fontSize: 12 }}>LLM 厂商</InputLabel>
            <Select value={editForm.provider || ''} label="LLM 厂商"
              onChange={e => {
                const p = e.target.value;
                const d = PROVIDER_DEFAULTS[p];
                if (d) setEditForm({ ...editForm, provider: p, model: d.model, base_url: d.base_url || '' });
              }}
              sx={{ color: theme.text.primary, fontSize: 13, ...inputSx }}>
              {PROVIDERS.map(p => <MenuItem key={p} value={p}>{getProviderDisplayName(p)}</MenuItem>)}
            </Select>
          </FormControl>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.75, borderRadius: 1, bgcolor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', minWidth: 100 }}>
            <ModelLogo provider={editForm.provider || ''} size={18} isDark={isDark} />
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.text.secondary, whiteSpace: 'nowrap' }}>
              {getProviderDisplayName(editForm.provider || '')}
            </Typography>
          </Box>
        )}
        <TextField label="模型 ID" size="small" fullWidth value={editForm.model || ''} onChange={e => setEditForm({ ...editForm, model: e.target.value })}
          InputProps={fieldSx} InputLabelProps={labelSx} sx={inputSx} />
      </Box>

      {/* Row 2: API Key + Base URL side by side */}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          label={isNew ? 'API Key' : 'API Key (留空不修改)'}
          size="small" type={showKey ? 'text' : 'password'}
          value={editForm.api_key || ''} onChange={e => setEditForm({ ...editForm, api_key: e.target.value })}
          InputProps={{
            sx: { color: theme.text.primary, fontSize: 12, fontFamily: 'monospace' },
            endAdornment: <IconButton size="small" onClick={() => setShowKey(!showKey)} sx={{ color: theme.text.muted }}>{showKey ? <VisibilityOffIcon size={16} /> : <VisibilityIcon size={16} />}</IconButton>,
          }}
          InputLabelProps={labelSx} sx={{ flex: 1, ...inputSx }}
        />
        <TextField label="Base URL (可选)" size="small" value={editForm.base_url || ''} onChange={e => setEditForm({ ...editForm, base_url: e.target.value })}
          placeholder="默认" InputProps={{ sx: { color: theme.text.primary, fontSize: 12 } }} InputLabelProps={labelSx} sx={{ flex: 1, ...inputSx }} />
      </Box>

      {/* Row 3: Temperature + Max Tokens + Actions */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ fontSize: 11, color: theme.text.muted, whiteSpace: 'nowrap' }}>Temp: {editForm.temperature ?? 0}</Typography>
          <Slider value={editForm.temperature ?? 0} onChange={(_, v) => setEditForm({ ...editForm, temperature: v as number })} min={0} max={2} step={0.1} size="small" sx={{ color: theme.brand.primary, maxWidth: 160 }} />
        </Box>
        <TextField label="Max Tokens" size="small" type="number" value={editForm.max_tokens ?? 4096} onChange={e => setEditForm({ ...editForm, max_tokens: parseInt(e.target.value) || 4096 })}
          InputProps={{ sx: { color: theme.text.primary, fontSize: 12 } }} InputLabelProps={labelSx}
          sx={{ width: 100, ...inputSx }} />
        <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
          {onToggleDefault && (
            <IconButton size="small" onClick={onToggleDefault} sx={{ color: isDefault ? '#ffc107' : theme.text.muted }}>
              <StarIcon size={18} />
            </IconButton>
          )}
          {onDelete && (
            <IconButton size="small" onClick={onDelete} sx={{ color: theme.text.muted, '&:hover': { color: '#f44336' } }}>
              <DeleteIcon size={18} />
            </IconButton>
          )}
          <Button size="small" onClick={onCancel} sx={{ textTransform: 'none', fontSize: 12, color: theme.text.muted, minWidth: 'auto', px: 1 }}>取消</Button>
          <Button size="small" startIcon={<SaveIcon size={14} />} onClick={onSave} disabled={saving}
            sx={{ bgcolor: theme.brand.primary, color: '#fff', textTransform: 'none', fontWeight: 600, fontSize: 12, borderRadius: 1.5, minWidth: 'auto', px: 1.5, '&:hover': { bgcolor: theme.brand.hover }, '&.Mui-disabled': { bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: theme.text.muted } }}>
            {saving ? '...' : '保存'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
