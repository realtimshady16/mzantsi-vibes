#!/usr/bin/env node
/**
 * Serve the site locally, reading content from this working copy instead of
 * GitHub, so a change to README.md, OPPORTUNITIES.md or the parser can be seen
 * before it is merged. No dependencies, no Worker, no secrets: the contribute
 * API is not available here, only the public site.
 *
 *   node scripts/dev-site.mjs            # http://localhost:8787
 *   node scripts/dev-site.mjs --sample   # also load sample opportunities (dates relative to today)
 *   node scripts/dev-site.mjs --port 9000
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { todayInSA } from '../PUBLISH/entry-meta.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const sample = args.includes('--sample');
const port = Number(args[args.indexOf('--port') + 1]) || 8787;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

const addDays = (n) => new Date(Date.parse(`${todayInSA()}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

async function content(file) {
  if (file === 'OPPORTUNITIES.md' && sample) {
    const md = await readFile(join(ROOT, 'test/fixtures/OPPORTUNITIES.sample.md'), 'utf8');
    return md.replaceAll('SOON', addDays(5)).replaceAll('LATER', addDays(60));
  }
  if (file === 'README.md' || file === 'OPPORTUNITIES.md') return readFile(join(ROOT, file), 'utf8');
  return null;
}

createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://x').pathname;
    const md = path.startsWith('/__content/') ? await content(path.slice('/__content/'.length)) : null;
    if (md !== null) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(md);
    }
    let rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
    if (rel.endsWith('/')) rel += 'index.html';
    const file = join(ROOT, 'PUBLISH', rel);
    if (!file.startsWith(join(ROOT, 'PUBLISH'))) throw new Error('outside');
    const body = await readFile(file).catch(() => readFile(join(file, 'index.html')));
    res.writeHead(200, { 'Content-Type': (TYPES[extname(file)] || 'application/octet-stream') + (extname(file) === '.png' ? '' : '; charset=utf-8'), 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Mzantsi Vibes (local) → http://localhost:${port}${sample ? '   [sample opportunities on]' : ''}`);
});
