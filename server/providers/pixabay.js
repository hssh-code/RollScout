import { fetchJson, extFromUrl, pickRendition, fallbackRenditions } from '../http.js';

const NAME = 'Pixabay';

function splitTags(tags = '') {
  return String(tags).split(',').map((t) => t.trim()).filter(Boolean);
}

const LICENSE = 'Pixabay Content License (free to use, no attribution required)';

// Pixabay has separate APIs for images and videos, so each gets its own connector and key.
export const pixabayImages = {
  id: 'pixabay',
  name: 'Pixabay Images',
  supports: ['image'],
  requiresKey: true,
  signupUrl: 'https://pixabay.com/api/docs/#api_search_images',
  keyHint: 'Pixabay image API key',
  license: LICENSE,
  mediaHosts: ['pixabay.com'],

  async searchImages(query, { key, perPage = 15, page = 1 }) {
    const url = new URL('https://pixabay.com/api/');
    url.search = new URLSearchParams({
      key, q: query.slice(0, 100), image_type: 'photo', safesearch: 'true',
      per_page: String(Math.max(3, Math.min(perPage, 200))), page: String(page),
    });
    const data = await fetchJson(url, { provider: NAME });
    return (data.hits || []).map((h, i) => ({
      id: `pixabay-img-${h.id}`,
      provider: 'pixabay',
      providerName: NAME,
      type: 'image',
      title: h.tags || 'Pixabay image',
      tags: splitTags(h.tags),
      searchText: h.tags || '',
      width: h.imageWidth,
      height: h.imageHeight,
      previewUrl: h.webformatURL || h.previewURL,
      displayUrl: h.largeImageURL || h.webformatURL,
      downloadUrl: h.largeImageURL || h.webformatURL,
      renditions: [
        { url: h.largeImageURL, width: 1280 },
        { url: h.webformatURL, width: 640 },
      ].filter((r) => r.url),
      ext: extFromUrl(h.largeImageURL || h.webformatURL, 'jpg'),
      pageUrl: h.pageURL,
      author: h.user,
      authorUrl: h.user && h.user_id ? `https://pixabay.com/users/${h.user}-${h.user_id}/` : undefined,
      license: this.license,
      position: i,
    }));
  },
};

export const pixabayVideos = {
  id: 'pixabay-videos',
  name: 'Pixabay Videos',
  supports: ['video'],
  requiresKey: true,
  signupUrl: 'https://pixabay.com/api/docs/#api_search_videos',
  keyHint: 'Pixabay video API key',
  license: LICENSE,
  mediaHosts: ['pixabay.com', 'vimeocdn.com'],

  async searchVideos(query, { key, perPage = 15, page = 1, videoQuality = 'hd' }) {
    const url = new URL('https://pixabay.com/api/videos/');
    url.search = new URLSearchParams({
      key, q: query.slice(0, 100), safesearch: 'true',
      per_page: String(Math.max(3, Math.min(perPage, 200))), page: String(page),
    });
    const data = await fetchJson(url, { provider: NAME });
    return (data.hits || []).map((h, i) => {
      const sizes = h.videos || {};
      const files = ['tiny', 'small', 'medium', 'large']
        .map((k) => sizes[k])
        .filter((f) => f && f.url)
        .map((f) => ({ url: f.url, width: f.width, height: f.height, size: f.size || undefined, thumbnail: f.thumbnail }));
      const best = pickRendition(files, videoQuality);
      const small = pickRendition(files, 'sd');
      if (!best) return null;
      const thumb = files.find((f) => f.thumbnail)?.thumbnail
        || (h.picture_id ? `https://i.vimeocdn.com/video/${h.picture_id}_640x360.jpg` : undefined);
      return {
        id: `pixabay-vid-${h.id}`,
        provider: 'pixabay',
        providerName: NAME,
        type: 'video',
        title: h.tags || 'Pixabay video',
        tags: splitTags(h.tags),
        searchText: h.tags || '',
        width: best.width,
        height: best.height,
        duration: h.duration,
        previewUrl: thumb,
        displayUrl: small?.url || best.url,
        downloadUrl: best.url,
        size: best.size,
        renditions: fallbackRenditions(best, files),
        ext: extFromUrl(best.url, 'mp4'),
        pageUrl: h.pageURL,
        author: h.user,
        authorUrl: h.user && h.user_id ? `https://pixabay.com/users/${h.user}-${h.user_id}/` : undefined,
        license: this.license,
        position: i,
      };
    }).filter(Boolean);
  },
};
