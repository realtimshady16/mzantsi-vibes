#!/usr/bin/env node
/**
 * Preview the site locally, for design work.
 *
 *   node scripts/preview.mjs               http://127.0.0.1:8000
 *   node scripts/preview.mjs --port 9000
 *   node scripts/preview.mjs --no-api      static files only
 *
 * It serves PUBLISH/ the way the Worker does, with two differences that matter
 * when you are iterating on the look:
 *
 *   - Every response says Cache-Control: no-store, so a reload always shows the
 *     file on disk. (A plain static server sends none, and browsers, Firefox
 *     especially, can keep an old stylesheet while using a new page.)
 *   - It answers the two API calls the Contribute form makes, with a MOCK:
 *     /api/sections returns the real section list (read from the live README),
 *     and /api/submit accepts anything sensible and returns a fake pull request.
 *     NOTHING IS SENT TO GITHUB. Each submission is printed here instead.
 *
 * Binds to 127.0.0.1 only. Needs no dependencies and no secrets.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sectionOptions } from '../src/readme.js';

const ROOT = fileURLToPath(new URL('../PUBLISH/', import.meta.url));
const argv = process.argv.slice(2);
const port = argv.includes('--port') ? Number(argv[argv.indexOf('--port') + 1]) : 8000;
const withApi = !argv.includes('--no-api');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

const FALLBACK_GROUPS = [
  { pillar: "🎓 I'm Going to Study", sections: ['Before You Apply', 'Paying for It', 'Getting There', "While You're There", 'After Your Degree'] },
  { pillar: "💼 I'm Going to Work", sections: ['Getting Work-Ready', 'Finding Work', 'Starting Something', 'Understanding Your Money'] },
  { pillar: "🤷 I Don't Know Yet", sections: ['Things you can do right now'] },
  { pillar: '📋 For Everyone', sections: ['How Do I Adult?', 'Mental Health 101', 'Being Healthy 101', 'Book Summaries', 'TED Talks & Speeches'] },
];

let groups = FALLBACK_GROUPS;
let groupsSource = 'a saved copy';
try {
  const res = await fetch('https://raw.githubusercontent.com/realtimshady16/mzantsi-vibes/main/README.md', { signal: AbortSignal.timeout(8000) });
  if (res.ok) {
    groups = sectionOptions(await res.text());
    groupsSource = 'the live README';
  }
} catch { /* offline: the saved copy is fine for design work */ }

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Preview-Mock': '1' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function api(req, res, pathname) {
  if (pathname === '/api/health') return send(res, 200, { ok: true, service: 'preview (mock)' });
  if (pathname === '/api/sections' && req.method === 'GET') return send(res, 200, { ok: true, groups });
  if (pathname === '/api/submit') {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Use POST.' });
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { ok: false, error: 'Could not read the submission.' }); }
      if (!body.content || !String(body.content).trim()) return send(res, 400, { ok: false, error: 'Please add the content you want to submit.' });
      if (body.website) return send(res, 200, { ok: true, prUrl: null, prNumber: null }); // what the real Worker does for the honeypot
      console.log(`\n  [mock submit] ${body.flow} · ${body.format} · ${body.pillar} › ${body.section}${body.newSectionName ? ` (new: ${body.newSectionName})` : ''}\n  ${String(body.content).replace(/\n/g, '\n  ')}\n`);
      send(res, 201, { ok: true, prNumber: 123, prUrl: 'https://example.com/this-is-a-mock-nothing-was-sent', handle: body.handle || '' });
    });
    return;
  }
  return send(res, 404, { ok: false, error: 'Not part of the preview.' });
}

http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, 'Bad request', 'text/plain'); }

  if (pathname.startsWith('/api/')) return withApi ? api(req, res, pathname) : send(res, 404, { ok: false, error: 'API disabled (--no-api).' });

  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden', 'text/plain');

  let target = file;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    // Like the Worker: /contribute -> /contribute/
    if (!pathname.endsWith('/')) {
      res.writeHead(307, { Location: pathname + '/', 'Cache-Control': 'no-store' });
      return res.end();
    }
    target = path.join(target, 'index.html');
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return send(res, 404, 'Not found', 'text/plain');

  send(res, 200, fs.readFileSync(target), TYPES[path.extname(target)] || 'application/octet-stream');
}).listen(port, '127.0.0.1', () => {
  console.log(`Previewing PUBLISH/ at http://127.0.0.1:${port}/   (no caching: reload always shows what is on disk)`);
  console.log(withApi
    ? `Mock API on. Sections from ${groupsSource}. Submitting prints here and sends NOTHING to GitHub.`
    : 'API off: the Contribute form will show its "saved copy" notice and cannot submit.');
  console.log('Ctrl+C to stop.\n');
});
