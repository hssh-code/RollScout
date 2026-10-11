// Turns an uploaded script file into plain text.
import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { stripSubtitles, stripRtf, SUPPORTED_EXTENSIONS } from './textFormats.js';

export { stripSubtitles, stripRtf, SUPPORTED_EXTENSIONS };

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
