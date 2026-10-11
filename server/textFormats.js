// Plain-text script formats. Shared by the server and the browser-only web version.

export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.fountain', '.srt', '.vtt', '.docx', '.pdf', '.rtf'];

export function stripSubtitles(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/^WEBVTT.*$/m, '')
    .split('\n')
    .filter((l) => !/^\s*\d+\s*$/.test(l) && !/-->/.test(l) && !/^(?:NOTE|STYLE|REGION)\b/.test(l))
    .map((l) => l.replace(/<[^>]+>/g, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripRtf(text) {
  return String(text)
    .replace(/\\par[d]?\s?/g, '\n')
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\'[0-9a-f]{2}/gi, '')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
