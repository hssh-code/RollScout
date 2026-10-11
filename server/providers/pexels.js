import { fetchJson, extFromUrl, slugWords, pickRendition } from '../http.js';

const NAME = 'Pexels';

export default {
  id: 'pexels',
  name: NAME,
  supports: ['image', 'video'],
  requiresKey: true,
  signupUrl: 'https://www.pexels.com/api/',
  license: 'Pexels License (free to use, attribution appreciated)',
  mediaHosts: ['images.pexels.com', 'videos.pexels.com', 'player.vimeo.com', 'vimeocdn.com'],

  async searchImages(query, { key, perPage = 15, page = 1, imageQuality = 'large' }) {
    const url = new URL('https://api.pexels.com/v1/search');
    url.search = new URLSearchParams({ query, per_page: String(Math.min(perPage, 80)), page: String(page) });
    const data = await fetchJson(url, { headers: { Authorization: key }, provider: NAME });
    return (data.photos || []).map((p, i) => {
      const original = p.src?.original;
      const downloadUrl = imageQuality === 'original'
        ? original
        : `${original}?auto=compress&cs=tinysrgb&w=1920`;
      return {
        id: `pexels-img-${p.id}`,
        provider: 'pexels',
        providerName: NAME,
        type: 'image',
        title: p.alt || slugWords(p.url) || 'Pexels photo',
        tags: [],
        searchText: `${p.alt || ''} ${slugWords(p.url)}`,
        width: p.width,
        height: p.height,
        previewUrl: p.src?.medium || p.src?.small,
        displayUrl: p.src?.large || p.src?.medium,
        downloadUrl,
        ext: extFromUrl(original, 'jpg'),
        pageUrl: p.url,
        author: p.photographer,
        authorUrl: p.photographer_url,
        license: this.license,
        position: i,
      };
    });
  },

  async searchVideos(query, { key, perPage = 15, page = 1, videoQuality = 'hd' }) {
    const url = new URL('https://api.pexels.com/videos/search');
    url.search = new URLSearchParams({ query, per_page: String(Math.min(perPage, 80)), page: String(page) });
    const data = await fetchJson(url, { headers: { Authorization: key }, provider: NAME });
    return (data.videos || []).map((v, i) => {
      const files = (v.video_files || [])
        .filter((f) => (f.file_type || '').startsWith('video/'))
        .map((f) => ({ url: f.link, width: f.width, height: f.height }));
      const best = pickRendition(files, videoQuality);
      const small = pickRendition(files, 'sd');
      if (!best) return null;
      return {
        id: `pexels-vid-${v.id}`,
        provider: 'pexels',
        providerName: NAME,
        type: 'video',
        title: slugWords(v.url) || 'Pexels video',
        tags: (v.tags || []).map(String),
        searchText: slugWords(v.url),
        width: best.width,
        height: best.height,
        duration: v.duration,
        previewUrl: v.image,
        displayUrl: small?.url || best.url,
        downloadUrl: best.url,
        ext: extFromUrl(best.url, 'mp4'),
        pageUrl: v.url,
        author: v.user?.name,
        authorUrl: v.user?.url,
        license: this.license,
        position: i,
      };
    }).filter(Boolean);
  },
};
