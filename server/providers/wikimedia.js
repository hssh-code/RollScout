import { fetchJson, stripHtml, extFromUrl } from '../http.js';

const NAME = 'Wikimedia Commons';
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_MIMES = new Set(['video/webm', 'video/ogg', 'video/mp4', 'application/ogg']);

async function search(query, filetype, { perPage = 15, page = 1, thumbWidth = 640 }) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*',
    generator: 'search', gsrsearch: `${query} filetype:${filetype}`, gsrnamespace: '6',
    gsrlimit: String(Math.min(perPage, 50)), gsroffset: String((page - 1) * perPage),
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(thumbWidth),
  });
  const data = await fetchJson(url, { provider: NAME });
  return (data.query?.pages || [])
    .filter((p) => p.imageinfo?.[0])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function baseItem(p, type, i) {
  const info = p.imageinfo[0];
  const meta = info.extmetadata || {};
  const title = p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
  const description = stripHtml(meta.ImageDescription?.value || '');
  const categories = stripHtml(meta.Categories?.value || '').split('|').filter(Boolean);
  return {
    id: `wikimedia-${type === 'image' ? 'img' : 'vid'}-${p.pageid}`,
    provider: 'wikimedia',
    providerName: NAME,
    type,
    title,
    tags: categories.slice(0, 10),
    searchText: `${title} ${description} ${categories.join(' ')}`,
    width: info.width,
    height: info.height,
    pageUrl: info.descriptionurl,
    author: stripHtml(meta.Artist?.value || '') || undefined,
    license: meta.LicenseShortName?.value
      ? `${meta.LicenseShortName.value} (check the file page for attribution terms)`
      : 'See file page for license',
    position: i,
  };
}

export default {
  id: 'wikimedia',
  name: NAME,
  supports: ['image', 'video'],
  requiresKey: false,
  signupUrl: 'https://commons.wikimedia.org/',
  license: 'Various Creative Commons / public domain licenses',
  mediaHosts: ['upload.wikimedia.org'],

  async searchImages(query, opts) {
    const pages = await search(query, 'bitmap', opts);
    return pages
      .filter((p) => IMAGE_MIMES.has(p.imageinfo[0].mime))
      .map((p, i) => {
        const info = p.imageinfo[0];
        let downloadUrl = info.url;
        // Wikimedia serves scaled copies by swapping the width segment in the thumb URL.
        if (opts.imageQuality !== 'original' && info.width > 1920 && info.thumburl) {
          downloadUrl = info.thumburl.replace(/\/\d+px-/, '/1920px-');
        }
        return {
          ...baseItem(p, 'image', i),
          previewUrl: info.thumburl || info.url,
          displayUrl: info.thumburl || info.url,
          downloadUrl,
          size: downloadUrl === info.url ? info.size : undefined,
          renditions: [
            { url: downloadUrl, width: downloadUrl === info.url ? info.width : 1920, size: downloadUrl === info.url ? info.size : undefined },
            info.thumburl && info.width > 1280 ? { url: info.thumburl.replace(/\/\d+px-/, '/1280px-'), width: 1280 } : null,
            info.thumburl ? { url: info.thumburl, width: 640 } : null,
          ].filter(Boolean),
          ext: extFromUrl(info.url, 'jpg'),
        };
      });
  },

  async searchVideos(query, opts) {
    const pages = await search(query, 'video', opts);
    return pages
      .filter((p) => VIDEO_MIMES.has(p.imageinfo[0].mime))
      .map((p, i) => {
        const info = p.imageinfo[0];
        return {
          ...baseItem(p, 'video', i),
          duration: undefined,
          previewUrl: info.thumburl,
          displayUrl: info.url,
          downloadUrl: info.url,
          size: info.size,
          renditions: [{ url: info.url, width: info.width, height: info.height, size: info.size }],
          ext: extFromUrl(info.url, 'webm'),
        };
      });
  },
};
