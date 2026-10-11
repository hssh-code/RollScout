// Single-file downloads and ZIP bundles. Files are streamed from the platforms through the
// server so the browser can save them (most media CDNs do not allow direct cross-site downloads).
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { ZipArchive } from 'archiver';
import { isAllowedMediaUrl, isAllowedTrackUrl, serverKeyFor } from './providers/index.js';
import { USER_AGENT } from './http.js';

const MAX_ZIP_ITEMS = 600;

export async function fetchMedia(url, { maxRedirects = 5, connectTimeoutMs = 30000 } = {}) {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    if (!isAllowedMediaUrl(current)) throw new Error('This file is not hosted on a supported platform');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), connectTimeoutMs);
    let res;
    try {
      res = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Redirect without a location');
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`The platform returned HTTP ${res.status}`);
    return res;
  }
  throw new Error('Too many redirects');
}

export function safeSegment(s, fallback = 'file') {
  const clean = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '').slice(0, 80);
  return clean || fallback;
}

export function safeZipPath(p) {
  const parts = String(p || '').split(/[\\/]+/).filter((x) => x && x !== '.' && x !== '..').map((x) => safeSegment(x));
  return parts.length ? parts.join('/') : 'file';
}

function uniquePath(path, used) {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const dot = path.lastIndexOf('.');
  const base = dot > path.lastIndexOf('/') ? path.slice(0, dot) : path;
  const ext = dot > path.lastIndexOf('/') ? path.slice(dot) : '';
  let n = 2;
  while (used.has(`${base}-${n}${ext}`)) n++;
  used.add(`${base}-${n}${ext}`);
  return `${base}-${n}${ext}`;
}

export function trackUnsplash(trackUrl, key) {
  const k = key || serverKeyFor('unsplash');
  if (!trackUrl || !k || !isAllowedTrackUrl(trackUrl)) return;
  fetch(trackUrl, { headers: { Authorization: `Client-ID ${k}`, 'User-Agent': USER_AGENT } }).catch(() => {});
}

export async function handleDownload(req, res) {
  const url = String(req.query.url || '');
  if (!isAllowedMediaUrl(url)) return res.status(400).json({ error: 'This file is not hosted on a supported platform.' });
  try {
    const upstream = await fetchMedia(url);
    const name = safeSegment(req.query.name, 'rollscout-file');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    const body = Readable.fromWeb(upstream.body);
    req.on('close', () => body.destroy());
    body.on('error', () => res.destroy());
    body.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message });
  }
}

function readPayload(req) {
  if (typeof req.body?.payload === 'string') return JSON.parse(req.body.payload);
  return req.body || {};
}

function creditsText(entries) {
  const lines = [
    'RollScout media credits',
    '=======================',
    '',
    'Each file keeps the license of the platform it came from. Check the source page before publishing.',
    '',
  ];
  for (const e of entries) {
    lines.push(`${e.path}`);
    if (e.title) lines.push(`  Title:    ${e.title}`);
    if (e.author) lines.push(`  Author:   ${e.author}${e.authorUrl ? ` (${e.authorUrl})` : ''}`);
    if (e.providerName) lines.push(`  Platform: ${e.providerName}`);
    if (e.pageUrl) lines.push(`  Source:   ${e.pageUrl}`);
    if (e.license) lines.push(`  License:  ${e.license}`);
    lines.push('');
  }
  return lines.join('\n');
}

export async function handleZip(req, res) {
  let payload;
  try {
    payload = readPayload(req);
  } catch {
    return res.status(400).json({ error: 'Invalid download request.' });
  }
  const items = Array.isArray(payload.items) ? payload.items.slice(0, MAX_ZIP_ITEMS) : [];
  if (!items.length) return res.status(400).json({ error: 'No files were selected.' });
  if (items.some((i) => !isAllowedMediaUrl(i.url))) {
    return res.status(400).json({ error: 'One or more files are not hosted on a supported platform.' });
  }

  const zipName = safeSegment(payload.name, 'rollscout');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}.zip"`);

  const archive = new ZipArchive({ store: true });
  let aborted = false;
  res.on('close', () => {
    if (!res.writableFinished) {
      aborted = true;
      archive.abort();
    }
  });
  archive.on('error', () => res.destroy());
  archive.pipe(res);

  const used = new Set();
  const written = [];
  const failed = [];
  for (const item of items) {
    if (aborted) return;
    const path = uniquePath(safeZipPath(item.path || item.filename), used);
    try {
      const upstream = await fetchMedia(item.url);
      archive.append(Readable.fromWeb(upstream.body), { name: path });
      await once(archive, 'entry');
      written.push({ ...item, path });
      if (item.trackUrl) trackUnsplash(item.trackUrl, payload.unsplashKey);
    } catch (err) {
      failed.push(`${path}: ${err.message}`);
    }
  }
  if (aborted) return;
  if (written.length) archive.append(creditsText(written), { name: 'CREDITS.txt' });
  if (failed.length) {
    archive.append(`These files could not be downloaded:\n\n${failed.join('\n')}\n`, { name: 'FAILED.txt' });
  }
  await archive.finalize();
}
