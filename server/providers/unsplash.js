import { fetchJson } from '../http.js';

const NAME = 'Unsplash';

export default {
  id: 'unsplash',
  name: NAME,
  supports: ['image'],
  requiresKey: true,
  signupUrl: 'https://unsplash.com/developers',
  keyHint: 'Use the "Access Key" of your Unsplash app',
  license: 'Unsplash License (free to use, attribution appreciated)',
  mediaHosts: ['images.unsplash.com', 'plus.unsplash.com'],

  async searchImages(query, { key, perPage = 15, page = 1, imageQuality = 'large' }) {
    const url = new URL('https://api.unsplash.com/search/photos');
    url.search = new URLSearchParams({
      query, per_page: String(Math.min(perPage, 30)), page: String(page), content_filter: 'high',
    });
    const data = await fetchJson(url, {
      headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
      provider: NAME,
    });
    return (data.results || [])
      .filter((r) => !r.premium && !(r.urls?.raw || '').includes('plus.unsplash.com'))
      .map((r, i) => {
        const tags = (r.tags || []).map((t) => t.title).filter(Boolean);
        const title = r.alt_description || r.description || tags.join(', ') || 'Unsplash photo';
        const downloadUrl = imageQuality === 'original'
          ? r.urls?.full
          : `${r.urls?.raw}&w=1920&q=85&fm=jpg`;
        return {
          id: `unsplash-img-${r.id}`,
          provider: 'unsplash',
          providerName: NAME,
          type: 'image',
          title,
          tags,
          searchText: `${r.alt_description || ''} ${r.description || ''} ${tags.join(' ')}`,
          width: r.width,
          height: r.height,
          previewUrl: r.urls?.small,
          displayUrl: r.urls?.regular,
          downloadUrl,
          renditions: [
            { url: downloadUrl, width: imageQuality === 'original' ? r.width : 1920 },
            { url: r.urls?.regular, width: 1080 },
            { url: r.urls?.small, width: 400 },
          ].filter((x) => x.url),
          ext: 'jpg',
          pageUrl: r.links?.html,
          author: r.user?.name,
          authorUrl: r.user?.links?.html,
          license: this.license,
          // Unsplash API guidelines ask apps to ping this when a photo is downloaded.
          trackUrl: r.links?.download_location,
          position: i,
        };
      });
  },
};
