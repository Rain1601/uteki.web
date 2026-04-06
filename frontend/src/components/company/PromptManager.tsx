import { useState, useEffect, useCallback } from 'react';
import {
  Drawer,
  Box,
  Typography,
  Tabs,
  Tab,
  TextField,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Snackbar,
  Alert,
  CircularProgress,
} from '@mui/material';
import { X, Plus, CheckCircle, FlaskConical } from 'lucide-react';
import { useTheme } from '../../theme/ThemeProvider';
import { listPrompts, createPrompt, activatePrompt, runABTest } from '../../api/company';

interface Props {
  open: boolean;
  onClose: () => void;
}

const GATE_TABS = [
  { gate: 1, label: '业务解析' },
  { gate: 2, label: '成长质量' },
  { gate: 3, label: '护城河' },
  { gate: 4, label: '管理层' },
  { gate: 5, label: '逆向检验' },
  { gate: 6, label: '估值' },
  { gate: 7, label: '综合裁决' },
];

interface PromptVersion {
  id: string;
  gate_number: number;
  version: number;
  description: string;
  system_prompt: string;
  is_active: boolean;
  created_at: string;
}

export default function PromptManager({ open, onClose }: Props) {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState(0);
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptVersion | null>(null);
  const [editText, setEditText] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  // A/B Test dialog
  const [abOpen, setAbOpen] = useState(false);
  const [abSymbol, setAbSymbol] = useState('AAPL');
  const [abVersionA, setAbVersionA] = useState('');
  const [abVersionB, setAbVersionB] = useState('');
  const [abRuns, setAbRuns] = useState(3);
  const [abJudgeModel, setAbJudgeModel] = useState('deepseek-chat');
  const [abRunning, setAbRunning] = useState(false);

  const currentGate = GATE_TABS[activeTab].gate;

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPrompts(currentGate);
      setPrompts(Array.isArray(data) ? data : []);
    } catch {
      setPrompts([]);
    } finally {
      setLoading(false);
    }
  }, [currentGate]);

  useEffect(() => {
    if (open) loadPrompts();
  }, [open, loadPrompts]);

  useEffect(() => {
    setSelectedPrompt(null);
    setEditText('');
    setNewDescription('');
  }, [activeTab]);

  const handleSelectPrompt = (p: PromptVersion) => {
    setSelectedPrompt(p);
    setEditText(p.system_prompt);
    setNewDescription('');
  };

  const handleSaveNew = async () => {
    if (!editText.trim() || !newDescription.trim()) return;
    setSaving(true);
    try {
      await createPrompt({
        gate_number: currentGate,
        system_prompt: editText,
        description: newDescription,
      });
      setSnackbar({ open: true, message: '新版本已创建', severity: 'success' });
      setNewDescription('');
      await loadPrompts();
    } catch {
      setSnackbar({ open: true, message: '创建失败', severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (id: string) => {
    try {
      await activatePrompt(id);
      setSnackbar({ open: true, message: '已激活', severity: 'success' });
      await loadPrompts();
    } catch {
      setSnackbar({ open: true, message: '激活失败', severity: 'error' });
    }
  };

  const handleRunAB = async () => {
    if (!abVersionA || !abVersionB || abVersionA === abVersionB) return;
    setAbRunning(true);
    try {
      await runABTest({
        symbol: abSymbol,
        gate_number: currentGate,
        version_a_id: abVersionA,
        version_b_id: abVersionB,
        runs_per_version: abRuns,
        judge_model: abJudgeModel,
      });
      setSnackbar({ open: true, message: 'A/B 测试已提交', severity: 'success' });
      setAbOpen(false);
    } catch {
      setSnackbar({ open: true, message: 'A/B 测试失败', severity: 'error' });
    } finally {
      setAbRunning(false);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: {
            width: 640,
            bgcolor: theme.background.primary,
            color: theme.text.primary,
            borderLeft: `1px solid ${theme.border.subtle}`,
          },
        }}
      >
        {/* Header */}
        <Box sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${theme.border.subtle}` }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>Prompt 版本管理</Typography>
          <Box onClick={onClose} sx={{ cursor: 'pointer', p: 0.5, borderRadius: 1, color: theme.text.disabled, '&:hover': { bgcolor: theme.background.hover, color: theme.text.secondary } }}>
            <X size={16} />
          </Box>
        </Box>

        {/* Gate Tabs */}
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 36,
            borderBottom: `1px solid ${theme.border.subtle}`,
            '& .MuiTab-root': {
              minHeight: 36,
              fontSize: 12,
              fontWeight: 600,
              color: theme.text.muted,
              textTransform: 'none',
              py: 0.5,
              '&.Mui-selected': { color: theme.brand.primary },
            },
            '& .MuiTabs-indicator': { bgcolor: theme.brand.primary, height: 2 },
          }}
        >
          {GATE_TABS.map((t) => (
            <Tab key={t.gate} label={`G${t.gate} ${t.label}`} />
          ))}
        </Tabs>

        {/* Content */}
        <Box sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <>
              {/* Version list */}
              <Box sx={{ px: 2, py: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.text.disabled, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    版本列表 ({prompts.length})
                  </Typography>
                  {prompts.length >= 2 && (
                    <Box
                      onClick={() => setAbOpen(true)}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 0.4,
                        px: 1, py: 0.3, borderRadius: '6px', cursor: 'pointer',
                        fontSize: 10, fontWeight: 500, color: theme.text.muted,
                        '&:hover': { bgcolor: `${theme.text.primary}06`, color: theme.text.secondary },
                      }}
                    >
                      <FlaskConical size={11} />
                      <span>A/B Test</span>
                    </Box>
                  )}
                </Box>

                {prompts.length === 0 ? (
                  <Typography sx={{ fontSize: 12, color: theme.text.disabled, py: 2, textAlign: 'center' }}>
                    暂无 Prompt 版本
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {prompts.map((p) => (
                      <Box
                        key={p.id}
                        onClick={() => handleSelectPrompt(p)}
                        sx={{
                          display: 'flex', alignItems: 'center', gap: 1,
                          px: 1.5, py: 1, borderRadius: 1, cursor: 'pointer',
                          bgcolor: selectedPrompt?.id === p.id ? `${theme.brand.primary}10` : 'transparent',
                          border: `1px solid ${selectedPrompt?.id === p.id ? `${theme.brand.primary}30` : theme.border.subtle}`,
                          '&:hover': { bgcolor: `${theme.text.primary}05` },
                        }}
                      >
                        <Typography sx={{ fontSize: 12, fontWeight: 700, color: theme.text.primary, flexShrink: 0, width: 32 }}>
                          v{p.version}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: theme.text.secondary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.description || '(无描述)'}
                        </Typography>
                        {p.is_active && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3, px: 0.75, py: 0.15, borderRadius: '4px', bgcolor: 'rgba(76,175,80,0.1)' }}>
                            <CheckCircle size={10} color="#4caf50" />
                            <Typography sx={{ fontSize: 9, fontWeight: 600, color: '#4caf50' }}>Active</Typography>
                          </Box>
                        )}
                        <Typography sx={{ fontSize: 10, color: theme.text.disabled, flexShrink: 0 }}>
                          {formatDate(p.created_at)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>

              {/* Editor */}
              {selectedPrompt && (
                <Box sx={{ px: 2, py: 1.5, borderTop: `1px solid ${theme.border.subtle}`, flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.text.disabled, mb: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Prompt 编辑 (v{selectedPrompt.version})
                  </Typography>

                  <TextField
                    multiline
                    fullWidth
                    minRows={8}
                    maxRows={20}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    sx={{
                      mb: 1.5,
                      '& .MuiOutlinedInput-root': {
                        bgcolor: theme.background.secondary,
                        color: theme.text.primary,
                        fontSize: 12,
                        fontFamily: "'SF Mono', Monaco, Consolas, monospace",
                        lineHeight: 1.6,
                        '& fieldset': { borderColor: theme.border.subtle },
                        '&:hover fieldset': { borderColor: theme.border.default },
                        '&.Mui-focused fieldset': { borderColor: theme.brand.primary },
                      },
                    }}
                  />

                  <TextField
                    size="small"
                    fullWidth
                    placeholder="版本描述（必填）"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    sx={{
                      mb: 1.5,
                      '& .MuiOutlinedInput-root': {
                        bgcolor: theme.background.secondary,
                        color: theme.text.primary,
                        fontSize: 12,
                        '& fieldset': { borderColor: theme.border.subtle },
                        '&:hover fieldset': { borderColor: theme.border.default },
                        '&.Mui-focused fieldset': { borderColor: theme.brand.primary },
                      },
                    }}
                  />

                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<Plus size={14} />}
                      onClick={handleSaveNew}
                      disabled={saving || !editText.trim() || !newDescription.trim()}
                      sx={{
                        fontSize: 12, textTransform: 'none', fontWeight: 600,
                        borderColor: theme.border.default, color: theme.text.secondary,
                        '&:hover': { borderColor: theme.brand.primary, color: theme.brand.primary },
                      }}
                    >
                      {saving ? '保存中...' : '保存为新版本'}
                    </Button>

                    {!selectedPrompt.is_active && (
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<CheckCircle size={14} />}
                        onClick={() => handleActivate(selectedPrompt.id)}
                        sx={{
                          fontSize: 12, textTransform: 'none', fontWeight: 600,
                          bgcolor: theme.brand.primary,
                          '&:hover': { bgcolor: theme.brand.hover },
                        }}
                      >
                        激活此版本
                      </Button>
                    )}
                  </Box>
                </Box>
              )}
            </>
          )}
        </Box>
      </Drawer>

      {/* A/B Test Dialog */}
      <Dialog
        open={abOpen}
        onClose={() => setAbOpen(false)}
        PaperProps={{
          sx: {
            bgcolor: theme.background.primary,
            color: theme.text.primary,
            minWidth: 400,
          },
        }}
      >
        <DialogTitle sx={{ fontSize: 14, fontWeight: 700 }}>A/B 测试</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <TextField
            size="small"
            label="测试股票代码"
            value={abSymbol}
            onChange={(e) => setAbSymbol(e.target.value.toUpperCase())}
            sx={{
              '& .MuiOutlinedInput-root': { color: theme.text.primary, '& fieldset': { borderColor: theme.border.subtle } },
              '& .MuiInputLabel-root': { color: theme.text.muted },
            }}
          />
          <FormControl size="small">
            <InputLabel sx={{ color: theme.text.muted }}>版本 A</InputLabel>
            <Select
              value={abVersionA}
              onChange={(e) => setAbVersionA(e.target.value)}
              label="版本 A"
              sx={{ color: theme.text.primary, '& fieldset': { borderColor: theme.border.subtle } }}
            >
              {prompts.map((p) => (
                <MenuItem key={p.id} value={p.id}>v{p.version} — {p.description}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small">
            <InputLabel sx={{ color: theme.text.muted }}>版本 B</InputLabel>
            <Select
              value={abVersionB}
              onChange={(e) => setAbVersionB(e.target.value)}
              label="版本 B"
              sx={{ color: theme.text.primary, '& fieldset': { borderColor: theme.border.subtle } }}
            >
              {prompts.map((p) => (
                <MenuItem key={p.id} value={p.id}>v{p.version} — {p.description}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="每版本运行次数"
            type="number"
            value={abRuns}
            onChange={(e) => setAbRuns(Number(e.target.value))}
            inputProps={{ min: 1, max: 10 }}
            sx={{
              '& .MuiOutlinedInput-root': { color: theme.text.primary, '& fieldset': { borderColor: theme.border.subtle } },
              '& .MuiInputLabel-root': { color: theme.text.muted },
            }}
          />
          <TextField
            size="small"
            label="评判模型"
            value={abJudgeModel}
            onChange={(e) => setAbJudgeModel(e.target.value)}
            sx={{
              '& .MuiOutlinedInput-root': { color: theme.text.primary, '& fieldset': { borderColor: theme.border.subtle } },
              '& .MuiInputLabel-root': { color: theme.text.muted },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAbOpen(false)} sx={{ color: theme.text.muted, textTransform: 'none' }}>
            取消
          </Button>
          <Button
            onClick={handleRunAB}
            disabled={abRunning || !abVersionA || !abVersionB || abVersionA === abVersionB}
            variant="contained"
            sx={{ textTransform: 'none', bgcolor: theme.brand.primary, '&:hover': { bgcolor: theme.brand.hover } }}
          >
            {abRunning ? '运行中...' : '开始测试'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} variant="filled" sx={{ fontSize: 12 }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
