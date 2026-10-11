import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProviders, searchAllTopics, clearSearchCache } from '../server/search.js';
import { mockFetch, restoreFetch, json, pexelsPhotos, pexelsVideos, pixabayHits } from './helpers.js';

test.afterEach(() => {
  restoreFetch();
  clearSearchCache();
});

const topic = (id, title, queries) => ({ id, title, queries, keywords: queries });

test('only platforms with a key (or no key requirement) are used', () => {
  const active = resolveProviders({
    pexels: { enabled: true, key: 'abc' },
    pixabay: { enabled: true, key: '' },
    unsplash: { enabled: false, key: 'x' },
    wikimedia: { enabled: true },
  });
  assert.deepEqual(active.map((a) => a.provider.id), ['pexels', 'wikimedia']);
});

test('collects at least 5 images and 5 videos per topic across several queries', async () => {
  // Each query only returns 2 results, so the search has to keep going.
  mockFetch([
    [(u) => u.pathname === '/v1/search', (u) => json(pexelsPhotos(u.searchParams.get('query'), 2, u.searchParams.get('query').length * 10))],
    [(u) => u.pathname === '/videos/search', (u) => json(pexelsVideos(u.searchParams.get('query'), 2, u.searchParams.get('query').length * 10))],
  ]);
  const active = resolveProviders({ pexels: { enabled: true, key: 'k' } });
  const [r] = await searchAllTopics([topic('t1', 'Ocean life', ['sea turtle', 'coral reef', 'ocean fish', 'kelp'])], active, { perTopic: 5 });
  assert.ok(r.images.length >= 5, `got ${r.images.length} images`);
  assert.ok(r.videos.length >= 5, `got ${r.videos.length} videos`);
  assert.equal(r.short.images, false);
  assert.equal(new Set(r.images.map((i) => i.id)).size, r.images.length);
});

test('reports a shortfall when the platforms do not have enough', async () => {
  mockFetch([
    [(u) => u.pathname === '/v1/search', (u) => json(pexelsPhotos('rare', u.searchParams.get('page') === '1' && u.searchParams.get('query') === 'rare thing' ? 2 : 0))],
    [(u) => u.pathname === '/videos/search', () => json({ videos: [] })],
  ]);
  const active = resolveProviders({ pexels: { enabled: true, key: 'k' } });
  const [r] = await searchAllTopics([topic('t1', 'Rare', ['rare thing'])], active, { perTopic: 8 });
  assert.equal(r.images.length, 2);
  assert.equal(r.videos.length, 0);
  assert.equal(r.short.images, true);
  assert.ok(r.notes.some((n) => /Only 2 images/.test(n)));
  assert.ok(r.notes.some((n) => /Only 0 videos/.test(n)));
});

test('explains when no connected platform offers videos', async () => {
  mockFetch([[(u) => u.hostname === 'api.unsplash.com', () => json({ results: [] })]]);
  const active = resolveProviders({ unsplash: { enabled: true, key: 'k' } });
  const [r] = await searchAllTopics([topic('t1', 'X', ['x'])], active, {});
  assert.ok(r.notes.some((n) => /None of the connected platforms provide videos/.test(n)));
});

test('merges platforms and keeps each file in one topic when there is enough', async () => {
  mockFetch([
    [(u) => u.pathname === '/v1/search', (u) => json(pexelsPhotos(u.searchParams.get('query'), 12))],
    [(u) => u.pathname === '/videos/search', (u) => json(pexelsVideos(u.searchParams.get('query'), 12))],
    [(u) => u.pathname === '/api/', (u) => json(pixabayHits(u.searchParams.get('q'), 12))],
    [(u) => u.pathname === '/api/videos/', (u) => json(pixabayHits(u.searchParams.get('q'), 12, true))],
  ]);
  const active = resolveProviders({
    pexels: { enabled: true, key: 'a' },
    pixabay: { enabled: true, key: 'b' },
    'pixabay-videos': { enabled: true, key: 'c' },
  });
  // Both topics get identical results from the mock, so the second must not repeat the first.
  const results = await searchAllTopics(
    [topic('t1', 'Forest', ['forest']), topic('t2', 'Forest again', ['forest'])],
    active,
    { perTopic: 6 },
  );
  const ids1 = new Set([...results[0].images, ...results[0].videos].map((i) => i.id));
  const overlap = [...results[1].images, ...results[1].videos].filter((i) => ids1.has(i.id));
  assert.equal(overlap.length, 0);
  assert.equal(results[0].images.length, 6);
  assert.ok(new Set(results[0].images.map((i) => i.provider)).size === 2, 'results come from both platforms');
});

test('a rejected key skips that platform and reports a warning', async () => {
  const calls = mockFetch([
    [(u) => u.hostname === 'api.pexels.com', () => json({}, 401)],
    [(u) => u.pathname === '/api/', (u) => json(pixabayHits(u.searchParams.get('q'), 10))],
    [(u) => u.pathname === '/api/videos/', (u) => json(pixabayHits(u.searchParams.get('q'), 10, true))],
  ]);
  const warnings = [];
  const active = resolveProviders({
    pexels: { enabled: true, key: 'bad' },
    pixabay: { enabled: true, key: 'ok' },
    'pixabay-videos': { enabled: true, key: 'ok' },
  });
  const [r] = await searchAllTopics([topic('t1', 'Sky', ['sky', 'clouds', 'sunset'])], active, { perTopic: 5 }, {
    onWarning: (m) => warnings.push(m),
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Pexels: the API key was rejected/);
  assert.ok(calls.filter((c) => c.url.hostname === 'api.pexels.com').length <= 2);
  assert.equal(r.images.length, 5);
});

test('Pixabay image and video keys work independently', async () => {
  const calls = mockFetch([
    [(u) => u.pathname === '/api/', (u) => json(pixabayHits(u.searchParams.get('q'), 10))],
    [(u) => u.pathname === '/api/videos/', () => json({}, 401)],
  ]);
  const warnings = [];
  const active = resolveProviders({
    pixabay: { enabled: true, key: 'image-key' },
    'pixabay-videos': { enabled: true, key: 'wrong-video-key' },
  });
  const [r] = await searchAllTopics([topic('t1', 'Sky', ['sky'])], active, { perTopic: 5 }, {
    onWarning: (m) => warnings.push(m),
  });
  // A rejected video key only switches off Pixabay Videos; images still come through.
  assert.equal(r.images.length, 5);
  assert.equal(r.videos.length, 0);
  assert.match(warnings[0], /Pixabay Videos/);
  assert.ok(calls.filter((c) => c.url.pathname === '/api/').every((c) => c.url.searchParams.get('key') === 'image-key'));
  assert.ok(calls.filter((c) => c.url.pathname === '/api/videos/').every((c) => c.url.searchParams.get('key') === 'wrong-video-key'));
});

test('only the Pixabay card that has a key is searched', async () => {
  const calls = mockFetch([
    [(u) => u.pathname === '/api/videos/', (u) => json(pixabayHits(u.searchParams.get('q'), 10, true))],
  ]);
  const active = resolveProviders({ pixabay: { enabled: true, key: '' }, 'pixabay-videos': { enabled: true, key: 'v' } });
  assert.deepEqual(active.map((a) => a.provider.id), ['pixabay-videos']);
  const [r] = await searchAllTopics([topic('t1', 'Sea', ['sea'])], active, { perTopic: 5 });
  assert.equal(r.videos.length, 5);
  assert.ok(calls.every((c) => c.url.pathname === '/api/videos/'));
});
