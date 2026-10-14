import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { publicProviderInfo, providerById, serverKeyFor, isAllowedTrackUrl } from './providers/index.js';
import { extractText, SUPPORTED_EXTENSIONS } from './scriptParser.js';
import { detectTopics, suggestQueries, DEFAULT_MAX_TOPICS, MAX_TOPICS } from './topics.js';
import { aiDetectTopics } from './aiTopics.js';
import { resolveProviders, searchAllTopics, MIN_PER_TYPE, MAX_PER_TYPE } from './search.js';
import { handleDownload, handleZip, trackUnsplash } from './download.js';
import { wordCount } from './text.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function cleanTopics(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_TOPICS).map((t, i) => ({
    id: String(t.id || `t${i + 1}`).slice(0, 20),
    title: String(t.title || `Topic ${i + 1}`).slice(0, 120),
    keywords: (Array.isArray(t.keywords) ? t.keywords : []).map((k) => String(k).slice(0, 80)).slice(0, 12),
    queries: (Array.isArray(t.queries) ? t.queries : []).map((q) => String(q).trim().slice(0, 100)).filter(Boolean).slice(0, 10),
  }))
    // A topic with a title but no phrases is searched by its title.
    .map((t) => (t.queries.length || !String(t.title).trim() ? t : { ...t, queries: [t.title.trim()] }))
    .filter((t) => t.queries.length);
}

export function createApp() {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "img-src 'self' https: data:", "media-src 'self' https:",
      "style-src 'self' 'unsafe-inline'", "script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'",
    ].join('; '));
    next();
  });
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: false, limit: '5mb' }));
  app.use(express.static(path.join(here, '..', 'public')));

  app.get('/api/config', (req, res) => {
    res.json({
      providers: publicProviderInfo(),
      ai: { serverKey: Boolean(process.env.ANTHROPIC_API_KEY) },
      limits: { minPerType: MIN_PER_TYPE, maxPerType: MAX_PER_TYPE, maxTopics: MAX_TOPICS },
      fileTypes: SUPPORTED_EXTENSIONS,
    });
  });

  app.post('/api/script', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file was uploaded.' });
    try {
      const text = await extractText(req.file.buffer, req.file.originalname, req.file.mimetype);
      if (!text.trim()) return res.status(422).json({ error: 'No readable text was found in that file.' });
      res.json({ text, filename: req.file.originalname, words: wordCount(text) });
    } catch (err) {
      res.status(err.status || 422).json({ error: err.status ? err.message : `Could not read the file: ${err.message}` });
    }
  });

  app.post('/api/topics', async (req, res) => {
    const text = String(req.body?.text || '');
    if (!text.trim()) return res.status(400).json({ error: 'The script is empty.' });
    const maxTopics = Math.max(1, Math.min(MAX_TOPICS, Number(req.body?.maxTopics) || DEFAULT_MAX_TOPICS));
    if (req.body?.method === 'ai') {
      try {
        const topics = await aiDetectTopics(text, { apiKey: req.body.anthropicKey, maxTopics });
        return res.json({ topics, method: 'ai' });
      } catch (err) {
        const topics = detectTopics(text, { maxTopics });
        return res.json({
          topics,
          method: 'auto',
          warning: `AI topic detection failed (${err.message}), so the built-in detector was used instead.`,
        });
      }
    }
    res.json({ topics: detectTopics(text, { maxTopics }), method: 'auto' });
  });

  // Search phrases for a topic typed in by hand.
  app.post('/api/suggest', (req, res) => {
    const title = String(req.body?.title || '').slice(0, 120);
    res.json({ queries: suggestQueries(title, String(req.body?.text || '')) });
  });

  app.post('/api/verify', async (req, res) => {
    const provider = providerById[req.body?.provider];
    if (!provider) return res.status(400).json({ ok: false, message: 'Unknown platform.' });
    const key = String(req.body?.key || '').trim() || serverKeyFor(provider.id);
    if (provider.requiresKey && !key) return res.json({ ok: false, message: 'Enter an API key first.' });
    try {
      const fn = provider.supports.includes('image') ? provider.searchImages : provider.searchVideos;
      await fn.call(provider, 'nature', { key, perPage: 3, page: 1 });
      res.json({ ok: true, message: `${provider.name} is connected.` });
    } catch (err) {
      res.json({ ok: false, message: err.message });
    }
  });

  // Streams one JSON object per line so results show up topic by topic.
  app.post('/api/search', async (req, res) => {
    const topics = cleanTopics(req.body?.topics);
    if (!topics.length) return res.status(400).json({ error: 'There are no topics to search for.' });
    const active = resolveProviders(req.body?.platforms || {});
    if (!active.length) return res.status(400).json({ error: 'Connect at least one platform first.' });

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const send = (obj) => res.write(`${JSON.stringify(obj)}\n`);
    send({ type: 'start', topics: topics.length, platforms: active.map((a) => a.provider.name) });
    try {
      await searchAllTopics(topics, active, req.body?.options || {}, {
        onTopic: (result, index) => send({ type: 'topic', index, result }),
        onWarning: (message) => send({ type: 'warning', message }),
      });
      send({ type: 'done' });
    } catch (err) {
      send({ type: 'error', message: err.message });
    }
    res.end();
  });

  app.post('/api/track', (req, res) => {
    const url = String(req.body?.url || '');
    if (!isAllowedTrackUrl(url)) return res.status(400).json({ ok: false });
    trackUnsplash(url, req.body?.key);
    res.json({ ok: true });
  });

  app.get('/api/download', handleDownload);
  app.post('/api/zip', handleZip);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status || 500;
    res.status(status).json({ error: status === 413 ? 'That file is too large (15 MB max).' : err.message });
  });
  return app;
}

// Starts the server and resolves once it is listening. Port 0 picks a free port.
export function startServer({ port = 3000, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = createApp().listen(port, host);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  startServer({ port, host }).then(() => {
    console.log(`RollScout is running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  });
}
