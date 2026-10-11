// Test helpers: a fake `fetch` that answers like the real platform APIs.
const realFetch = globalThis.fetch;

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// `routes` is a list of [predicate(url), handler(url, opts)] pairs; local URLs go to the real fetch.
export function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async (input, opts = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input, opts);
    calls.push({ url, opts });
    for (const [match, handler] of routes) {
      if (match(url)) return handler(url, opts);
    }
    return new Response('not mocked', { status: 599 });
  };
  return calls;
}

export function restoreFetch() {
  globalThis.fetch = realFetch;
}

export function pexelsPhotos(query, n, offset = 0) {
  return {
    total_results: n,
    photos: Array.from({ length: n }, (_, i) => ({
      id: 1000 + offset + i,
      width: 4000,
      height: 2667,
      url: `https://www.pexels.com/photo/${query.replace(/\s+/g, '-')}-shot-${1000 + offset + i}/`,
      photographer: 'Jane Doe',
      photographer_url: 'https://www.pexels.com/@jane',
      alt: `${query} photo number ${i}`,
      src: {
        original: `https://images.pexels.com/photos/${1000 + offset + i}/pexels-photo-${1000 + offset + i}.jpeg`,
        large: `https://images.pexels.com/photos/${1000 + offset + i}/pexels-photo.jpeg?h=650`,
        medium: `https://images.pexels.com/photos/${1000 + offset + i}/pexels-photo.jpeg?h=350`,
        small: `https://images.pexels.com/photos/${1000 + offset + i}/pexels-photo.jpeg?h=130`,
      },
    })),
  };
}

export function pexelsVideos(query, n, offset = 0) {
  return {
    total_results: n,
    videos: Array.from({ length: n }, (_, i) => ({
      id: 5000 + offset + i,
      width: 3840,
      height: 2160,
      duration: 12,
      url: `https://www.pexels.com/video/${query.replace(/\s+/g, '-')}-clip-${5000 + offset + i}/`,
      image: `https://images.pexels.com/videos/${5000 + offset + i}/thumb.jpeg`,
      user: { name: 'Sam Lee', url: 'https://www.pexels.com/@sam' },
      video_files: [
        { quality: 'sd', file_type: 'video/mp4', width: 960, height: 540, link: `https://videos.pexels.com/video-files/${5000 + offset + i}/sd_960_540.mp4` },
        { quality: 'hd', file_type: 'video/mp4', width: 1920, height: 1080, link: `https://videos.pexels.com/video-files/${5000 + offset + i}/hd_1920_1080.mp4` },
        { quality: 'uhd', file_type: 'video/mp4', width: 3840, height: 2160, link: `https://videos.pexels.com/video-files/${5000 + offset + i}/uhd_3840_2160.mp4` },
      ],
    })),
  };
}

export function pixabayHits(query, n, video = false) {
  return {
    total: n,
    totalHits: n,
    hits: Array.from({ length: n }, (_, i) => (video ? {
      id: 9000 + i,
      pageURL: `https://pixabay.com/videos/id-${9000 + i}/`,
      tags: `${query}, nature, outdoor`,
      duration: 20,
      user: 'pixuser',
      user_id: 42,
      videos: {
        large: { url: '', width: 0, height: 0, size: 0, thumbnail: '' },
        medium: { url: `https://cdn.pixabay.com/video/2024/01/01/${9000 + i}-medium.mp4`, width: 1920, height: 1080, thumbnail: `https://cdn.pixabay.com/video/2024/01/01/${9000 + i}-medium.jpg` },
        small: { url: `https://cdn.pixabay.com/video/2024/01/01/${9000 + i}-small.mp4`, width: 1280, height: 720, thumbnail: '' },
        tiny: { url: `https://cdn.pixabay.com/video/2024/01/01/${9000 + i}-tiny.mp4`, width: 960, height: 540, thumbnail: '' },
      },
    } : {
      id: 7000 + i,
      pageURL: `https://pixabay.com/photos/${7000 + i}/`,
      tags: `${query}, landscape`,
      webformatURL: `https://pixabay.com/get/${7000 + i}_640.jpg`,
      largeImageURL: `https://pixabay.com/get/${7000 + i}_1280.jpg`,
      imageWidth: 5000,
      imageHeight: 3000,
      user: 'pixuser',
      user_id: 42,
    })),
  };
}
