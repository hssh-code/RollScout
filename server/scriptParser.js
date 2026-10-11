// Turns an uploaded script file into plain text.
import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

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

export async function extractText(buffer, filename = '', mimetype = '') {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ buffer });
    return value.trim();
  }
  if (ext === '.pdf' || mimetype === 'application/pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const { text } = await parser.getText();
      return text.replace(/\n-- \d+ of \d+ --\n/g, '\n').trim();
    } finally {
      await parser.destroy();
    }
  }
  const raw = buffer.toString('utf8').replace(/^﻿/, '');
  if (ext === '.srt' || ext === '.vtt') return stripSubtitles(raw);
  if (ext === '.rtf') return stripRtf(raw);
  if (SUPPORTED_EXTENSIONS.includes(ext) || mimetype.startsWith('text/')) return raw.trim();
  const err = new Error(`Unsupported file type "${ext || mimetype}". Use ${SUPPORTED_EXTENSIONS.join(', ')}.`);
  err.status = 415;
  throw err;
}
