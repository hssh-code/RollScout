import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { stripSubtitles, stripRtf } from '../server/scriptParser.js';
import { safeZipPath } from '../server/download.js';
import { mockFetch, restoreFetch, json, pexelsPhotos, pexelsVideos } from './helpers.js';

let server;
let base;

test.before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());
test.afterEach(restoreFetch);

const post = (path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('config lists the platforms', async () => {
  const data = await (await fetch(`${base}/api/config`)).json();
  assert.deepEqual(data.providers.map((p) => p.id), ['pexels', 'pixabay', 'pixabay-videos', 'unsplash', 'wikimedia']);
  assert.equal(data.limits.minPerType, 5);
});

test('uploading a subtitle file returns its spoken text', async () => {
  const form = new FormData();
  form.append('file', new Blob(['1\n00:00:01,000 --> 00:00:03,000\nHello world.\n\n2\n00:00:04,000 --> 00:00:06,000\nCoffee grows on hills.\n']), 'talk.srt');
  const res = await fetch(`${base}/api/script`, { method: 'POST', body: form });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.text, 'Hello world. Coffee grows on hills.');
});

test('unsupported uploads are refused', async () => {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' }), 'movie.exe');
  const res = await fetch(`${base}/api/script`, { method: 'POST', body: form });
  assert.equal(res.status, 415);
});

test('topics endpoint falls back to the built-in detector when AI is unavailable', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const res = await post('/api/topics', { text: '## Coffee\nCoffee beans grow on farms in Brazil.\n\n## Tea\nTea leaves are picked in India.', method: 'ai' });
  const data = await res.json();
  if (prev) process.env.ANTHROPIC_API_KEY = prev;
  assert.equal(data.method, 'auto');
  assert.match(data.warning, /AI topic detection failed/);
  assert.deepEqual(data.topics.map((t) => t.title), ['Coffee', 'Tea']);
});

test('search streams one result per topic', async () => {
  mockFetch([
    [(u) => u.pathname === '/v1/search', (u) => json(pexelsPhotos(u.searchParams.get('query'), 10))],
    [(u) => u.pathname === '/videos/search', (u) => json(pexelsVideos(u.searchParams.get('query'), 10))],
  ]);
  const res = await post('/api/search', {
    topics: [{ id: 't1', title: 'Coffee', queries: ['coffee'] }, { id: 't2', title: 'Tea', queries: ['tea'] }],
    platforms: { pexels: { enabled: true, key: 'k' } },
    options: { perTopic: 5 },
  });
  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].type, 'start');
  const topics = lines.filter((l) => l.type === 'topic');
  assert.equal(topics.length, 2);
  for (const t of topics) {
    assert.equal(t.result.images.length, 5);
    assert.equal(t.result.videos.length, 5);
  }
  assert.equal(lines[lines.length - 1].type, 'done');
});

test('search requires a connected platform', async () => {
  const res = await post('/api/search', { topics: [{ title: 'x', queries: ['x'] }], platforms: { pexels: { enabled: true, key: '' } } });
  assert.equal(res.status, 400);
});

test('single download refuses hosts that are not media platforms', async () => {
  const res = await fetch(`${base}/api/download?url=${encodeURIComponent('https://example.com/a.jpg')}`);
  assert.equal(res.status, 400);
});

test('single download streams the file with a safe file name', async () => {
  mockFetch([[(u) => u.hostname === 'images.pexels.com', () => new Response('JPEGDATA', { headers: { 'content-type': 'image/jpeg' } })]]);
  const res = await fetch(`${base}/api/download?url=${encodeURIComponent('https://images.pexels.com/photos/1/a.jpeg')}&name=${encodeURIComponent('../../evil name.jpg')}`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'JPEGDATA');
  assert.match(res.headers.get('content-disposition'), /filename="evil-name.jpg"/);
});

test('redirects to non-platform hosts are not followed', async () => {
  mockFetch([[(u) => u.hostname === 'images.pexels.com', () => new Response(null, { status: 302, headers: { location: 'https://internal.example/secret' } })]]);
  const res = await fetch(`${base}/api/download?url=${encodeURIComponent('https://images.pexels.com/photos/1/a.jpeg')}`);
  assert.equal(res.status, 502);
});

test('ZIP download bundles files by topic with a credits file', async () => {
  mockFetch([
    [(u) => u.hostname === 'images.pexels.com', () => new Response('IMAGE-BYTES')],
    [(u) => u.hostname === 'videos.pexels.com', () => new Response('VIDEO-BYTES')],
    [(u) => u.hostname === 'cdn.pixabay.com', () => new Response('nope', { status: 404 })],
  ]);
  const payload = {
    name: 'my pack',
    items: [
      { url: 'https://images.pexels.com/photos/1/a.jpeg', path: '01-coffee/images/pexels-a.jpg', title: 'Beans', author: 'Jane', providerName: 'Pexels', pageUrl: 'https://www.pexels.com/photo/1/' },
      { url: 'https://videos.pexels.com/video-files/2/hd.mp4', path: '01-coffee/videos/pexels-b.mp4', title: 'Pour' },
      { url: 'https://cdn.pixabay.com/video/x.mp4', path: '02-tea/videos/missing.mp4' },
    ],
  };
  // Sent as a regular form post, the way the browser does it.
  const res = await fetch(`${base}/api/zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ payload: JSON.stringify(payload) }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /my-pack\.zip/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  const text = buf.toString('latin1');
  for (const name of ['01-coffee/images/pexels-a.jpg', '01-coffee/videos/pexels-b.mp4', 'CREDITS.txt', 'FAILED.txt', 'IMAGE-BYTES', 'VIDEO-BYTES', 'Author:   Jane']) {
    assert.ok(text.includes(name), `zip should contain ${name}`);
  }
});

test('ZIP download rejects files from unknown hosts', async () => {
  const res = await post('/api/zip', { items: [{ url: 'https://example.com/a.jpg', path: 'a.jpg' }] });
  assert.equal(res.status, 400);
});

test('parsing helpers', () => {
  assert.equal(stripSubtitles('WEBVTT\n\n00:00.000 --> 00:01.000\n<v Bob>Hi there</v>\n'), 'Hi there');
  assert.equal(stripRtf('{\\rtf1\\ansi {\\b Hello} world\\par Next}'), 'Hello world\nNext');
  assert.equal(safeZipPath('../../etc/passwd'), 'etc/passwd');
  assert.equal(safeZipPath('01 coffee/images/a b.jpg'), '01-coffee/images/a-b.jpg');
});
