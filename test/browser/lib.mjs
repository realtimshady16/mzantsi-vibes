/**
 * Shared plumbing for the browser tests: start the preview server, drive headless
 * Chromium over the DevTools protocol, and report results. No dependencies.
 *
 * These tests need Chromium on the PATH (chromium, chromium-browser or
 * google-chrome). Without it they print SKIPPED and exit 0, like the integration
 * suite does without network.
 */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChromium() {
  for (const bin of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    if (spawnSync('which', [bin], { stdio: 'ignore' }).status === 0) return bin;
  }
  return null;
}

/** Print SKIPPED and exit 0 when there is no browser to drive. Call first. */
export function skipWithoutChromium(name) {
  if (!findChromium()) {
    console.log(`\n  SKIPPED ${name}: no Chromium on the PATH.\n`);
    process.exit(0);
  }
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** Start scripts/preview.mjs on a free port. Resolves once it is listening. */
export async function startPreview() {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(REPO, 'scripts/preview.mjs'), '--port', String(port)], {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('preview server did not start')), 20000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('Previewing')) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (code) => reject(new Error(`preview server exited early (${code})`)));
  });
  return { base: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

/**
 * Launch Chromium and return the helpers the tests use:
 *   send(method, params)  raw DevTools call
 *   ev(expression)        evaluate in the page, return the value
 *   key(name, code)       press a key
 *   ok(name, cond, extra) record a check
 *   sec(title)            print a heading
 *   errors                uncaught page errors seen so far
 *   done()                print the summary, clean up, exit non-zero on any failure
 *   base                  the preview server's origin (unless preview:false)
 */
export async function start({ preview = true, width = 1100, height = 900 } = {}) {
  const server = preview ? await startPreview() : null;
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-chrome-'));
  const chrome = spawn(
    findChromium(),
    ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: 'ignore' }
  );

  let targets;
  for (let i = 0; i < 80; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.length) break;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  if (!targets?.length) throw new Error('Chromium did not start');

  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  };

  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result.result.value;
  };
  const key = async (k, code) => {
    const vk = k === 'Tab' ? 9 : 0;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  let pass = 0, fail = 0;
  const ok = (name, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
  };
  const sec = (title) => console.log(`\n== ${title} ==`);

  const done = async () => {
    console.log(`\n==============================================\n  ${pass} passed, ${fail} failed\n==============================================`);
    chrome.kill();
    ws.close();
    server?.stop();
    fs.rmSync(profile, { recursive: true, force: true });
    process.exit(fail ? 1 : 0);
  };

  return { send, ev, key, ok, sec, errors, done, sleep, base: server?.base };
}
