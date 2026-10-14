// Runs the searches for every topic across the platforms the user connected.
import { providers, serverKeyFor } from './providers/index.js';
import { topicTerms, scoreItem } from './rank.js';
import { words, isContentWord } from './text.js';

// The user picks how many images and how many videos each topic gets.
export const MIN_PER_TYPE = 1;
export const MAX_PER_TYPE = 30;
const TYPES = ['image', 'video'];

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 400;
const cache = new Map();

// Short fingerprint so cached results are kept per API key without storing the key itself.
function fingerprint(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.items;
}

function cacheSet(key, items) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), items });
}

export function clearSearchCache() {
  cache.clear();
}

// `requested` looks like { pexels: { enabled: true, key: '...' }, wikimedia: { enabled: true } }.
// Keys set in the server environment are used when the user leaves the field empty.
export function resolveProviders(requested = {}) {
  const active = [];
  for (const provider of providers) {
    const r = requested[provider.id];
    if (!r || r.enabled === false) continue;
    const key = String(r.key || '').trim() || serverKeyFor(provider.id);
    if (provider.requiresKey && !key) continue;
    active.push({ provider, key });
  }
  return active;
}

function broaderQueries(topic) {
  const out = [];
  const first = topic.keywords?.[0] || topic.queries?.[0] || '';
  const head = words(first).filter(isContentWord).pop();
  if (head) out.push(head);
  const titleWords = words(topic.title || '').filter(isContentWord);
  if (titleWords.length) out.push(titleWords[titleWords.length - 1]);
  return out;
}

export class SearchRun {
  constructor(active, { perTopic = 10, imageQuality = 'large', videoQuality = 'hd', onWarning = () => {} } = {}) {
    this.active = active;
    this.perTopic = Math.max(MIN_PER_TYPE, Math.min(MAX_PER_TYPE, Number(perTopic) || 10));
    this.imageQuality = imageQuality === 'original' ? 'original' : 'large';
    this.videoQuality = ['sd', 'hd', 'highest'].includes(videoQuality) ? videoQuality : 'hd';
    this.onWarning = onWarning;
    this.disabled = new Set();
    this.warned = new Set();
    this.usedIds = new Set();
    this.perPage = Math.min(30, Math.max(12, this.perTopic * 2));
  }

  supports(type) {
    return this.active.some((a) => a.provider.supports.includes(type) && !this.disabled.has(a.provider.id));
  }

  warn(message) {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    this.onWarning(message);
  }

  async query({ provider, key }, type, q, page = 1) {
    if (this.disabled.has(provider.id) || !provider.supports.includes(type)) return [];
    const keyHash = key ? fingerprint(key) : '-';
    const ck = [provider.id, type, q.toLowerCase(), page, this.perPage, this.imageQuality, this.videoQuality, keyHash].join('|');
    const cached = cacheGet(ck);
    if (cached) return cached.map((i) => ({ ...i }));
    const fn = type === 'image' ? provider.searchImages : provider.searchVideos;
    try {
      const items = await fn.call(provider, q, {
        key, perPage: this.perPage, page, imageQuality: this.imageQuality, videoQuality: this.videoQuality,
      });
      cacheSet(ck, items);
      return items.map((i) => ({ ...i }));
    } catch (err) {
      if (err.fatal) {
        this.disabled.add(provider.id);
        this.warn(`${err.message}. ${provider.name} was skipped for the rest of this search.`);
      } else {
        this.warn(err.message || `${provider.name}: search failed`);
      }
      return [];
    }
  }

  async searchTopic(topic) {
    const terms = topicTerms(topic);
    const pools = { image: new Map(), video: new Map() };
    const fresh = (type) => [...pools[type].values()].filter((i) => !this.usedIds.has(i.id)).length;
    // Gather some surplus so ranking has real choices, not just the first hits.
    const wanted = Math.max(6, Math.ceil(this.perTopic * 1.5));
    const queries = [...topic.queries];
    for (const b of broaderQueries(topic)) {
      if (!queries.some((q) => q.toLowerCase() === b.toLowerCase())) queries.push(b);
    }
    const tried = [];

    const collect = async (q, qi, page, types) => {
      tried.push(page > 1 ? `${q} (page ${page})` : q);
      await Promise.all(this.active.flatMap((entry) => types.map(async (type) => {
        const items = await this.query(entry, type, q, page);
        for (const item of items) {
          if (pools[type].has(item.id)) continue;
          item.query = q;
          item.score = scoreItem(item, terms, { queryIndex: qi + (page - 1), perPage: this.perPage });
          pools[type].set(item.id, item);
        }
      })));
    };

    for (let qi = 0; qi < queries.length; qi++) {
      const types = TYPES.filter((t) => fresh(t) < wanted && this.supports(t));
      if (!types.length) break;
      await collect(queries[qi], qi, 1, types);
    }
    // Still short after every query: dig one page deeper on the strongest queries.
    for (let qi = 0; qi < Math.min(2, queries.length); qi++) {
      const types = TYPES.filter((t) => fresh(t) < this.perTopic && this.supports(t));
      if (!types.length) break;
      await collect(queries[qi], qi, 2, types);
    }

    const pick = (type) => {
      const ranked = [...pools[type].values()].sort((a, b) => b.score - a.score);
      const chosen = ranked.filter((i) => !this.usedIds.has(i.id)).slice(0, this.perTopic);
      // Only reuse a file another topic already took if that is the only way to reach the number asked for.
      if (chosen.length < this.perTopic) {
        for (const i of ranked) {
          if (chosen.length >= this.perTopic) break;
          if (!chosen.includes(i)) chosen.push({ ...i, sharedWithOtherTopic: true });
        }
      }
      chosen.forEach((i) => this.usedIds.add(i.id));
      return chosen;
    };

    const images = pick('image');
    const videos = pick('video');
    const notes = [];
    for (const [type, list] of [['image', images], ['video', videos]]) {
      const label = type === 'image' ? 'images' : 'videos';
      if (!this.active.some((a) => a.provider.supports.includes(type))) {
        notes.push(`None of the connected platforms provide ${label}. Add a key for a platform that provides ${label} (for example Pexels${type === 'video' ? ' or Pixabay Videos' : ' or Pixabay Images'}).`);
      } else if (list.length < this.perTopic) {
        notes.push(`Only ${list.length} of the ${this.perTopic} requested ${label} could be found for this topic across the connected platforms.`);
      }
    }

    return {
      topicId: topic.id,
      images,
      videos,
      queriesTried: tried,
      notes,
      short: { images: images.length < this.perTopic, videos: videos.length < this.perTopic },
    };
  }
}

async function mapLimit(list, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      await fn(list[i], i);
    }
  });
  await Promise.all(workers);
}

export async function searchAllTopics(topics, active, options = {}, { onTopic = () => {}, onWarning = () => {} } = {}) {
  const run = new SearchRun(active, { ...options, onWarning });
  const results = new Array(topics.length);
  await mapLimit(topics, 2, async (topic, i) => {
    results[i] = await run.searchTopic(topic);
    onTopic(results[i], i);
  });
  return results;
}
