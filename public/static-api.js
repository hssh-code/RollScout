// Web version (GitHub Pages): everything the server normally does, done in the browser.
// Platform requests go straight from the browser to each platform with the user's own keys.
import { detectTopics } from './server/topics.js';
import { providerById, publicProviderInfo } from './server/providers/index.js';
import { resolveProviders, searchAllTopics, MIN_PER_TYPE, MAX_PER_TYPE } from './server/search.js';
import { stripSubtitles, stripRtf, SUPPORTED_EXTENSIONS } from './server/textFormats.js';
import { wordCount } from './server/text.js';

const MAX_TOPICS = 20;

export function config() {
  return {
    mode: 'static',
    providers: publicProviderInfo().map((p) => ({ ...p, serverKey: false })),
    ai: { serverKey: false, available: false },
    limits: { minPerType: MIN_PER_TYPE, maxPerType: MAX_PER_TYPE, maxTopics: MAX_TOPICS },
    fileTypes: SUPPORTED_EXTENSIONS,
  };
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(s);
  });
}

async function pdfText(buffer) {
  const pdfjs = await import('./vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join(''));
  }
  await doc.destroy();
  return pages.join('\n\n');
}

export async function parseScriptFile(file) {
  const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  let text;
  if (ext === '.docx') {
    if (!window.mammoth) await loadClassicScript(new URL('./vendor/mammoth.browser.min.js', import.meta.url).href);
    text = (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  } else if (ext === '.pdf') {
    text = await pdfText(await file.arrayBuffer());
  } else if (SUPPORTED_EXTENSIONS.includes(ext) || file.type.startsWith('text/')) {
    const raw = (await file.text()).replace(/^﻿/, '');
    text = ext === '.srt' || ext === '.vtt' ? stripSubtitles(raw) : ext === '.rtf' ? stripRtf(raw) : raw;
  } else {
    throw new Error(`Unsupported file type "${ext}". Use ${SUPPORTED_EXTENSIONS.join(', ')}.`);
  }
  text = text.trim();
  if (!text) throw new Error('No readable text was found in that file.');
  return { text, filename: file.name, words: wordCount(text) };
}

export function topics(text, maxTopics) {
  return { topics: detectTopics(text, { maxTopics: Math.min(MAX_TOPICS, maxTopics || 8) }), method: 'auto' };
}

export async function verify(providerId, key) {
  const provider = providerById[providerId];
  if (!provider) return { ok: false, message: 'Unknown platform.' };
  if (provider.requiresKey && !key) return { ok: false, message: 'Enter an API key first.' };
  try {
    const fn = provider.supports.includes('image') ? provider.searchImages : provider.searchVideos;
    await fn.call(provider, 'nature', { key, perPage: 3, page: 1 });
    return { ok: true, message: `${provider.name} is connected.` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// Emits the same messages the server streams: start, topic, warning, done.
export async function search({ topics: list, platforms, options }, emit) {
  const active = resolveProviders(platforms);
  if (!active.length) throw new Error('Connect at least one platform first.');
  emit({ type: 'start', topics: list.length, platforms: active.map((a) => a.provider.name) });
  await searchAllTopics(list, active, options || {}, {
    onTopic: (result, index) => emit({ type: 'topic', index, result }),
    onWarning: (message) => emit({ type: 'warning', message }),
  });
  emit({ type: 'done' });
}

export function trackUnsplash(trackUrl, key) {
  if (!trackUrl || !key || !trackUrl.startsWith('https://api.unsplash.com/')) return;
  fetch(trackUrl, { headers: { Authorization: `Client-ID ${key}` } }).catch(() => {});
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Keep the file available long enough for a slow "Save as" dialog.
  setTimeout(() => URL.revokeObjectURL(url), 30 * 60 * 1000);
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function downloadOne(url, filename) {
  try {
    saveBlob(new Blob([await fetchBytes(url)]), filename);
  } catch {
    // Some platforms do not let other websites fetch their files. Open it instead,
    // so the user can save it from the new tab.
    window.open(url, '_blank', 'noopener');
  }
}

function creditsText(entries) {
  const lines = ['RollScout media credits', '=======================', '',
    'Each file keeps the license of the platform it came from. Check the source page before publishing.', ''];
  for (const e of entries) {
    lines.push(e.path);
    if (e.title) lines.push(`  Title:    ${e.title}`);
    if (e.author) lines.push(`  Author:   ${e.author}${e.authorUrl ? ` (${e.authorUrl})` : ''}`);
    if (e.providerName) lines.push(`  Platform: ${e.providerName}`);
    if (e.pageUrl) lines.push(`  Source:   ${e.pageUrl}`);
    if (e.license) lines.push(`  License:  ${e.license}`);
    lines.push('');
  }
  return lines.join('\n');
}

// Asks where to save the ZIP. Must be called straight from a click, before any await.
// Chrome and Edge then stream the ZIP directly into that file, so even very large
// downloads never sit in memory. Other browsers return null and use the fallback below.
export function chooseZipTarget(filename) {
  if (typeof window.showSaveFilePicker !== 'function') return Promise.resolve(null);
  return window.showSaveFilePicker({
    suggestedName: filename,
    types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
  });
}

// Builds the ZIP as a stream: each file is fetched only when the ZIP writer reaches it,
// and its bytes flow straight through to the output. Files are stored uncompressed
// (media is already compressed). ZIP64 is used automatically for archives over 4 GB.
export async function downloadZip({ name, items, unsplashKey }, { target = null, onProgress = () => {} } = {}) {
  const { downloadZip: makeZip } = await import('./vendor/client-zip.js');
  const written = [];
  const failed = [];
  const used = new Set();

  async function* entries() {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let path = item.path;
      for (let n = 2; used.has(path); n++) path = item.path.replace(/(\.[^./]+)?$/, `-${n}$1`);
      used.add(path);
      onProgress(i, items.length);
      let res;
      try {
        res = await fetch(item.url);
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      } catch {
        failed.push(`${path}\n  Download it here: ${item.url}`);
        continue;
      }
      written.push({ ...item, path });
      if (item.trackUrl) trackUnsplash(item.trackUrl, unsplashKey);
      yield { name: path, input: res, lastModified: new Date() };
    }
    onProgress(items.length, items.length);
    if (written.length) yield { name: 'CREDITS.txt', input: creditsText(written), lastModified: new Date() };
    if (failed.length) {
      yield {
        name: 'FAILED.txt',
        input: `These files could not be added from the web version (the platform blocks it).\nOpen each link to save it, or use the RollScout desktop app, which has no such limit.\n\n${failed.join('\n\n')}\n`,
        lastModified: new Date(),
      };
    }
  }

  const zip = makeZip(entries());
  if (target) {
    await zip.body.pipeTo(await target.createWritable());
  } else {
    // Fallback: the browser assembles the file (it can keep large ones on disk), then saves it.
    saveBlob(await zip.blob(), `${name || 'rollscout'}.zip`);
  }
  return { added: written.length, failed: failed.length };
}
