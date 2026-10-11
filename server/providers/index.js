import pexels from './pexels.js';
import pixabay from './pixabay.js';
import unsplash from './unsplash.js';
import wikimedia from './wikimedia.js';

// To add a platform, create a connector with the same shape and list it here.
export const providers = [pexels, pixabay, unsplash, wikimedia];

export const providerById = Object.fromEntries(providers.map((p) => [p.id, p]));

const ENV_KEYS = {
  pexels: 'PEXELS_API_KEY',
  pixabay: 'PIXABAY_API_KEY',
  unsplash: 'UNSPLASH_ACCESS_KEY',
};

export function serverKeyFor(id) {
  const name = ENV_KEYS[id];
  return name ? process.env[name] || '' : '';
}

export function publicProviderInfo() {
  return providers.map((p) => ({
    id: p.id,
    name: p.name,
    supports: p.supports,
    requiresKey: p.requiresKey,
    signupUrl: p.signupUrl,
    keyHint: p.keyHint,
    license: p.license,
    serverKey: Boolean(serverKeyFor(p.id)),
  }));
}

function hostAllowed(host, suffixes) {
  return suffixes.some((s) => host === s || host.endsWith(`.${s}`));
}

const ALL_MEDIA_HOSTS = providers.flatMap((p) => p.mediaHosts);

// Downloads are proxied through the server, so only platform media hosts may be fetched.
export function isAllowedMediaUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && hostAllowed(url.hostname.toLowerCase(), ALL_MEDIA_HOSTS);
}

export function isAllowedTrackUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'api.unsplash.com';
  } catch {
    return false;
  }
}
