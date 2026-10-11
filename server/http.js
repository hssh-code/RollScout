// Small HTTP helpers shared by the platform connectors.

export const USER_AGENT = 'RollScout/1.0 (+https://github.com/hssh-code/rollscout)';

export class ProviderError extends Error {
  constructor(provider, status, message) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    // Bad keys and rate limits will not fix themselves during one run, so the
    // search stops calling that platform for the rest of the run.
    this.fatal = status === 401 || status === 403 || status === 429;
  }
}

function describeStatus(status) {
  if (status === 401 || status === 403) return 'the API key was rejected (check that it is correct and active)';
  if (status === 429) return 'the rate limit was reached (wait a bit or use another key)';
  if (status >= 500) return 'the platform returned a server error';
  return `the request failed with HTTP ${status}`;
}

export async function fetchJson(url, { headers = {}, provider = 'platform', timeoutMs = 15000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
    throw new ProviderError(provider, 0, `${provider}: the request ${reason}`);
  }
  if (!res.ok) {
    throw new ProviderError(provider, res.status, `${provider}: ${describeStatus(res.status)}`);
  }
  return res.json();
}

export function extFromUrl(url, fallback) {
  try {
    const m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (m) return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  } catch { /* ignore */ }
  return fallback;
}

export function stripHtml(s = '') {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

// "https://www.pexels.com/photo/brown-rocks-during-golden-hour-2014422/" -> "brown rocks during golden hour"
export function slugWords(pageUrl = '') {
  try {
    const parts = new URL(pageUrl).pathname.split('/').filter(Boolean);
    const slug = parts[parts.length - 1] || '';
    return slug.replace(/-?\d+$/, '').replace(/[-_]+/g, ' ').trim();
  } catch {
    return '';
  }
}

// Picks the rendition closest to a target width. `files` items need a `width`.
export function pickRendition(files, quality = 'hd') {
  const usable = files.filter((f) => f && f.url && f.width);
  if (!usable.length) return null;
  const sorted = [...usable].sort((a, b) => a.width - b.width);
  if (quality === 'highest') return sorted[sorted.length - 1];
  const target = quality === 'sd' ? 960 : 1920;
  const atMost = sorted.filter((f) => f.width <= target * 1.05);
  return atMost.length ? atMost[atMost.length - 1] : sorted[0];
}
