// Builds the browser-only web version (for GitHub Pages) into _site/.
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] || '_site');
const r = (...p) => path.join(root, ...p);

await rm(out, { recursive: true, force: true });
await cp(r('public'), out, { recursive: true });

// Shared code that runs in the browser too. Node-only files (index, download, scriptParser, aiTopics) stay out.
const shared = ['text.js', 'topics.js', 'rank.js', 'search.js', 'http.js', 'textFormats.js'];
await mkdir(path.join(out, 'server', 'providers'), { recursive: true });
for (const f of shared) await cp(r('server', f), path.join(out, 'server', f));
await cp(r('server', 'providers'), path.join(out, 'server', 'providers'), { recursive: true });

// Libraries for reading DOCX and PDF scripts and for building ZIP files in the browser.
const vendor = path.join(out, 'vendor');
await mkdir(vendor, { recursive: true });
await cp(r('node_modules', 'mammoth', 'mammoth.browser.min.js'), path.join(vendor, 'mammoth.browser.min.js'));
await cp(r('node_modules', 'pdfjs-dist', 'build', 'pdf.min.mjs'), path.join(vendor, 'pdf.min.mjs'));
await cp(r('node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'), path.join(vendor, 'pdf.worker.min.mjs'));
await cp(r('node_modules', 'client-zip', 'index.js'), path.join(vendor, 'client-zip.js'));

console.log(`Web version built in ${path.relative(root, out)}/`);
