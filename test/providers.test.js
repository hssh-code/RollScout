import test from 'node:test';
import assert from 'node:assert/strict';
import pexels from '../server/providers/pexels.js';
import { pixabayImages, pixabayVideos } from '../server/providers/pixabay.js';
import unsplash from '../server/providers/unsplash.js';
import wikimedia from '../server/providers/wikimedia.js';
import { isAllowedMediaUrl, isAllowedTrackUrl } from '../server/providers/index.js';
import { mockFetch, restoreFetch, json, pexelsPhotos, pexelsVideos, pixabayHits } from './helpers.js';

test.afterEach(restoreFetch);

test('Pexels images: sends the key and normalises results', async () => {
  const calls = mockFetch([[(u) => u.pathname === '/v1/search', (u) => json(pexelsPhotos(u.searchParams.get('query'), 3))]]);
  const items = await pexels.searchImages('coral reef', { key: 'PX', perPage: 3 });
  assert.equal(calls[0].opts.headers.Authorization, 'PX');
  assert.equal(items.length, 3);
  assert.equal(items[0].type, 'image');
  assert.equal(items[0].provider, 'pexels');
  assert.match(items[0].downloadUrl, /w=1920/);
  assert.equal(items[0].ext, 'jpg');
  assert.match(items[0].searchText, /coral reef/);
});

test('Pexels videos: picks the HD file by default and SD for preview', async () => {
  mockFetch([[(u) => u.pathname === '/videos/search', () => json(pexelsVideos('turtle', 2))]]);
  const items = await pexels.searchVideos('turtle', { key: 'PX' });
  assert.match(items[0].downloadUrl, /hd_1920_1080/);
  assert.match(items[0].displayUrl, /sd_960_540/);
  const highest = await pexels.searchVideos('turtle', { key: 'PX', videoQuality: 'highest' });
  assert.match(highest[0].downloadUrl, /uhd_3840/);
});

test('Pixabay: images and videos are separate connectors with their own keys', async () => {
  const calls = mockFetch([
    [(u) => u.pathname === '/api/', (u) => json(pixabayHits(u.searchParams.get('q'), 4))],
    [(u) => u.pathname === '/api/videos/', (u) => json(pixabayHits(u.searchParams.get('q'), 2, true))],
  ]);
  assert.deepEqual(pixabayImages.supports, ['image']);
  assert.deepEqual(pixabayVideos.supports, ['video']);
  const imgs = await pixabayImages.searchImages('forest', { key: 'IMG-KEY' });
  assert.equal(imgs.length, 4);
  assert.deepEqual(imgs[0].tags, ['forest', 'landscape']);
  const vids = await pixabayVideos.searchVideos('forest', { key: 'VID-KEY' });
  assert.match(vids[0].downloadUrl, /medium\.mp4$/);
  assert.equal(calls[0].url.pathname, '/api/');
  assert.equal(calls[0].url.searchParams.get('key'), 'IMG-KEY');
  assert.equal(calls[1].url.pathname, '/api/videos/');
  assert.equal(calls[1].url.searchParams.get('key'), 'VID-KEY');
  assert.match(vids[0].previewUrl, /medium\.jpg$/);
});

test('Unsplash: uses Client-ID auth and keeps the download tracking link', async () => {
  const calls = mockFetch([[(u) => u.hostname === 'api.unsplash.com', () => json({
    results: [{
      id: 'abc', width: 6000, height: 4000, alt_description: 'a sea turtle swimming', description: null,
      urls: { raw: 'https://images.unsplash.com/photo-1?ixid=x', full: 'https://images.unsplash.com/photo-1?full', regular: 'r', small: 's' },
      links: { html: 'https://unsplash.com/photos/abc', download_location: 'https://api.unsplash.com/photos/abc/download?ixid=x' },
      user: { name: 'Ann', links: { html: 'https://unsplash.com/@ann' } },
      tags: [{ title: 'turtle' }],
    }],
  })]]);
  const items = await unsplash.searchImages('turtle', { key: 'US' });
  assert.equal(calls[0].opts.headers.Authorization, 'Client-ID US');
  assert.equal(items[0].trackUrl, 'https://api.unsplash.com/photos/abc/download?ixid=x');
  assert.match(items[0].downloadUrl, /w=1920/);
});

test('Wikimedia Commons: filters unsupported formats and ranks by search index', async () => {
  mockFetch([[(u) => u.hostname === 'commons.wikimedia.org', () => json({
    query: {
      pages: [
        { pageid: 2, index: 2, title: 'File:Turtle_beach.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/a/Turtle_beach.jpg', thumburl: 'https://upload.wikimedia.org/thumb/a/640px-Turtle_beach.jpg', width: 4000, height: 3000, mime: 'image/jpeg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Turtle_beach.jpg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="x">Bob</a>' } } }] },
        { pageid: 1, index: 1, title: 'File:Sea_turtle.png', imageinfo: [{ url: 'https://upload.wikimedia.org/b/Sea_turtle.png', width: 800, height: 600, mime: 'image/png', descriptionurl: 'd', extmetadata: {} }] },
        { pageid: 3, index: 3, title: 'File:Turtle.tif', imageinfo: [{ url: 'https://upload.wikimedia.org/c/Turtle.tif', width: 800, height: 600, mime: 'image/tiff', descriptionurl: 'd', extmetadata: {} }] },
      ],
    },
  })]]);
  const items = await wikimedia.searchImages('turtle', { perPage: 10 });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Sea turtle');
  assert.equal(items[1].author, 'Bob');
  assert.match(items[1].downloadUrl, /1920px-Turtle_beach/);
  assert.match(items[1].license, /CC BY-SA 4.0/);
});

test('a rejected key raises a fatal error', async () => {
  mockFetch([[() => true, () => json({ error: 'bad' }, 401)]]);
  await assert.rejects(pexels.searchImages('x', { key: 'bad' }), (err) => err.fatal === true && /rejected/.test(err.message));
});

test('only platform media hosts may be downloaded', () => {
  assert.ok(isAllowedMediaUrl('https://images.pexels.com/photos/1/a.jpeg'));
  assert.ok(isAllowedMediaUrl('https://cdn.pixabay.com/video/a.mp4'));
  assert.ok(isAllowedMediaUrl('https://upload.wikimedia.org/a.jpg'));
  assert.ok(!isAllowedMediaUrl('http://images.pexels.com/a.jpg'));
  assert.ok(!isAllowedMediaUrl('https://evilpexels.com/a.jpg'));
  assert.ok(!isAllowedMediaUrl('https://images.pexels.com.evil.net/a.jpg'));
  assert.ok(!isAllowedMediaUrl('https://169.254.169.254/latest'));
  assert.ok(!isAllowedMediaUrl('not a url'));
  assert.ok(isAllowedTrackUrl('https://api.unsplash.com/photos/a/download'));
  assert.ok(!isAllowedTrackUrl('https://example.com/'));
});
