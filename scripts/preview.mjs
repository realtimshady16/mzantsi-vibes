#!/usr/bin/env node
/**
 * Preview the site locally, for design work.
 *
 *   node scripts/preview.mjs               http://127.0.0.1:8000
 *   node scripts/preview.mjs --port 9000
 *   node scripts/preview.mjs --no-api      static files only
 *   node scripts/preview.mjs --sample      add fake time-sensitive entries (see /__content below)
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
 * /__diag is a page that checks, in the browser you open it in, whether files are stale
 * and whether the theme logic works. Use it when a page looks half-restyled.
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
const sample = argv.includes('--sample');

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


/* ------------------------------------------------------------------ *
 * /__diag : a page you open in the browser that looks wrong. It checks, in that
 * browser, the things that make a page look half-restyled: a stale cached file,
 * the theme logic, and storage. Preview-only: it is not part of PUBLISH/.
 * ------------------------------------------------------------------ */
const DIAG_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Preview diagnostics</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px}
h1{font-size:22px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #8884;padding:6px 8px;text-align:left;vertical-align:top}
.ok{color:#0a7d3c;font-weight:700}.bad{color:#b3261e;font-weight:700}code,pre{font:13px ui-monospace,Menlo,monospace}pre{white-space:pre-wrap;background:#8881;padding:12px;border-radius:8px}
iframe{position:absolute;left:-9999px;width:1100px;height:700px}</style>
<script src="/theme.js"></script></head><body>
<h1>Preview diagnostics</h1>
<p>Open this in the browser where the page looks wrong. It takes a few seconds. Then copy the box at the bottom and send it to me.</p>
<table id="t"></table><h2>Copy this</h2><pre id="out">running…</pre><iframe id="f"></iframe>
<script>
(async () => {
  const rows = [], text = [];
  const add = (name, ok, detail) => { rows.push('<tr><td>' + name + '</td><td class="' + (ok === true ? 'ok' : ok === false ? 'bad' : '') + '">' + (ok === true ? 'OK' : ok === false ? 'PROBLEM' : '') + '</td><td>' + (detail || '') + '</td></tr>'); text.push((ok === true ? '[ok]  ' : ok === false ? '[BAD] ' : '[info] ') + name + (detail ? ' :: ' + String(detail).replace(/<[^>]+>/g, '') : '')); };
  const sha = async (t) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))).slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');

  add('Browser', null, navigator.userAgent);
  add('Device says dark?', null, String(matchMedia('(prefers-color-scheme: dark)').matches) + ' (Firefox privacy "resist fingerprinting" always reports light)');
  let ls; try { localStorage.setItem('__t', '1'); ls = localStorage.getItem('__t') === '1'; localStorage.removeItem('__t'); } catch (e) { ls = false; }
  add('localStorage works', ls, ls ? '' : 'blocked, so the theme choice cannot be remembered (the page still works)');
  add('theme.js set a theme', !!document.documentElement.getAttribute('data-theme'), 'data-theme = ' + document.documentElement.getAttribute('data-theme'));

  // 1. Is the browser's copy of each file the one on disk?
  const files = ['/theme.css', '/theme.js', '/style.css', '/contribute/style.css', '/contribute/index.html', '/contribute/script.js'];
  for (const f of files) {
    try {
      const cached = await (await fetch(f)).text();                       // however the browser normally fetches it
      const fresh = await (await fetch(f, { cache: 'reload' })).text();  // forced to ask the server
      const same = cached === fresh;
      add(f, same, same ? 'matches the file on disk (' + (await sha(fresh)) + ')' : 'STALE: the browser would use ' + (await sha(cached)) + ' but disk has ' + (await sha(fresh)) + '. Hard reload (Ctrl+Shift+R) or clear the cache for 127.0.0.1.');
    } catch (e) { add(f, false, String(e)); }
  }

  // 2. Load the real page in a frame and read what the browser actually applied.
  const frame = document.getElementById('f');
  for (const theme of ['light', 'dark']) {
    await new Promise((res) => { frame.onload = res; try { localStorage.setItem('mv-theme', theme); } catch (e) {} frame.src = '/contribute/?diag=' + theme + Date.now(); });
    await new Promise(r => setTimeout(r, 1500));
    const d = frame.contentDocument, w = frame.contentWindow;
    const cs = (el, p) => el ? w.getComputedStyle(el)[p] : 'missing';
    const want = theme === 'dark' ? { bg: 'rgb(5, 28, 30)', link: 'rgb(241, 234, 220)' } : { bg: 'rgb(250, 245, 234)', link: 'rgb(14, 38, 38)' };
    const bg = cs(d.body, 'backgroundColor'), link = cs(d.querySelector('.site-nav a'), 'color'), code = cs(d.querySelector('.format-help > code'), 'backgroundColor');
    add('Contribute page, ' + theme + ': page background', bg === want.bg, bg + ' (expected ' + want.bg + ')');
    add('Contribute page, ' + theme + ': nav link colour', link === want.link, link + ' (expected ' + want.link + (link === 'rgb(29, 107, 74)' ? ', and this green is the OLD stylesheet' : '') + ')');
    add('Contribute page, ' + theme + ': code sample background', code === 'rgb(14, 38, 38)', code + ' (expected rgb(14, 38, 38))');
  }
  try { localStorage.removeItem('mv-theme'); } catch (e) {}

  document.getElementById('t').innerHTML = rows.join('');
  document.getElementById('out').textContent = text.join('\\n');
})();
</script></body></html>`;

/* The site reads README.md and OPPORTUNITIES.md from GitHub in production. Here it
   reads the working copy (script.js switches to /__content/ on 127.0.0.1), so a
   content or parser change shows before it is merged. --sample swaps in
   test/fixtures/OPPORTUNITIES.sample.md, with its dates moved to be relative to today. */
const REPO = path.resolve(ROOT, '..');
const addDays = (n) => new Date(Date.now() + 2 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
function content(file) {
  if (file === 'OPPORTUNITIES.md' && sample) {
    return fs.readFileSync(path.join(REPO, 'test/fixtures/OPPORTUNITIES.sample.md'), 'utf8')
      .replaceAll('SOON', addDays(5)).replaceAll('LATER', addDays(60));
  }
  if (file === 'README.md' || file === 'OPPORTUNITIES.md') {
    const p = path.join(REPO, file);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }
  return null;
}

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

  if (pathname.startsWith('/__content/')) {
    const md = content(pathname.slice('/__content/'.length));
    return md === null ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, md, 'text/plain; charset=utf-8');
  }

  if (pathname === '/__diag') return send(res, 200, DIAG_HTML, 'text/html; charset=utf-8');

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
