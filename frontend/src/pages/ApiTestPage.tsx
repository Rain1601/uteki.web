import { useState } from 'react';
import { Box, Button, TextField, Typography, Paper, Select, MenuItem, FormControl, InputLabel, CircularProgress } from '@mui/material';

const API_KEY = 'sk-LjEXAaCOFZEsnAEXE8D2C1254c554443B6915b199d95DdDb';
const BASE_URL = 'https://aihubmix.com/v1';

const MODELS = [
  'claude-sonnet-4-6',
  'claude-sonnet-4-6-think',
  'claude-opus-4-6',
  'claude-opus-4-6-think',
  'gemini-3.1-pro-preview',
  'gemini-2.5-pro',
  'gpt-4o-mini',
  'gpt-4o',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
  'deepseek-ai/DeepSeek-V3',
  'deepseek-ai/DeepSeek-R1',
  'google/gemini-2.0-flash-001',
];

export default function ApiTestPage() {
  const [model, setModel] = useState(MODELS[0]);
  const [prompt, setPrompt] = useState('Hello, who are you? Reply in one sentence.');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [latency, setLatency] = useState<number | null>(null);

  const testApi = async () => {
    setLoading(true);
    setResponse('');
    setError('');
    setLatency(null);
    const start = Date.now();

    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 512,
          stream: false,
        }),
      });

      const elapsed = Date.now() - start;
      setLatency(elapsed);

      if (!res.ok) {
        const errBody = await res.text();
        setError(`HTTP ${res.status}: ${errBody}`);
        return;
      }

      const data = await res.json();
      setResponse(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const testStream = async () => {
    setLoading(true);
    setResponse('');
    setError('');
    setLatency(null);
    const start = Date.now();

    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 512,
          stream: true,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        setError(`HTTP ${res.status}: ${errBody}`);
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let firstChunk = true;
      let fullText = '';

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              if (firstChunk) {
                setLatency(Date.now() - start);
                firstChunk = false;
              }
              fullText += content;
              setResponse(fullText);
            }
          } catch {}
        }
      }
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: 'auto' }}>
      <Typography variant="h4" gutterBottom>
        AIHubMix API Test
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Model</InputLabel>
          <Select value={model} label="Model" onChange={e => setModel(e.target.value)}>
            {MODELS.map(m => (
              <MenuItem key={m} value={m}>{m}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          fullWidth
          multiline
          rows={3}
          label="Prompt"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          sx={{ mb: 2 }}
        />

        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button variant="contained" onClick={testApi} disabled={loading}>
            {loading ? <CircularProgress size={20} /> : 'Test (Non-Stream)'}
          </Button>
          <Button variant="outlined" onClick={testStream} disabled={loading}>
            {loading ? <CircularProgress size={20} /> : 'Test (Stream)'}
          </Button>
        </Box>
      </Paper>

      {latency !== null && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Latency: {latency}ms {response.length > 0 && !error ? '(TTFB for stream)' : ''}
        </Typography>
      )}

      {error && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: 'error.dark' }}>
          <Typography color="error.contrastText" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13 }}>
            {error}
          </Typography>
        </Paper>
      )}

      {response && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>Response:</Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13 }}>
            {response}
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
