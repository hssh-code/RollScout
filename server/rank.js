// Scores search results against a topic so the most relevant ones are shown first.
import { contentStems } from './text.js';

export function topicTerms(topic) {
  const weights = new Map();
  const add = (text, w) => {
    for (const s of contentStems(text)) weights.set(s, Math.max(weights.get(s) || 0, w));
  };
  (topic.queries || []).forEach((q, i) => add(q, 1 - Math.min(i, 5) * 0.08));
  (topic.keywords || []).forEach((k, i) => add(k, 0.7 - Math.min(i, 6) * 0.05));
  add(topic.title || '', 0.6);
  return weights;
}

export function scoreItem(item, terms, { queryIndex = 0, perPage = 15 } = {}) {
  const itemStems = contentStems(`${item.title || ''} ${(item.tags || []).join(' ')} ${item.searchText || ''}`);
  const weights = [...terms.values()].sort((a, b) => b - a);
  // Normalise against the strongest few terms; a photo rarely mentions every keyword.
  const ideal = weights.slice(0, 3).reduce((s, w) => s + w, 0) || 1;
  let hit = 0;
  for (const [stem, w] of terms) if (itemStems.has(stem)) hit += w;
  const overlap = Math.min(1, hit / ideal);

  const positionScore = 1 - Math.min(item.position ?? 0, perPage) / perPage;
  const queryScore = 1 / (1 + queryIndex);
  let quality = 0;
  const shortSide = Math.min(item.width || 0, item.height || 0);
  if (shortSide >= 1080) quality += 0.5;
  else if (shortSide >= 720) quality += 0.25;
  if (item.type === 'video' && item.duration) {
    if (item.duration >= 4 && item.duration <= 60) quality += 0.5;
    else if (item.duration > 180) quality -= 0.25;
  } else if (item.type === 'image') {
    quality += 0.25;
  }

  const score = overlap * 0.5 + positionScore * 0.25 + queryScore * 0.15 + quality * 0.1;
  return Math.round(score * 1000) / 1000;
}
