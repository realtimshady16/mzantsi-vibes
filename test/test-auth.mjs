/**
 * GitHub App authentication: key handling, JWT, installation tokens, caching,
 * the client's retry, and the safety check on which PRs the jobs may touch.
 * GitHub is faked and the keys are generated here: no network, no secrets.
 *
 * Run: node test/test-auth.mjs
 */
import { generateKeyPairSync, createPrivateKey } from 'node:crypto';
import {
  importPrivateKey, createAppJwt, appTokenProvider, clearTokenCache, pkcs1ToPkcs8, normalizePem,
} from '../src/github-auth.js';
import { github, isContributionPull } from '../src/github.js';
import { readConfig } from '../src/config.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const sec = (t) => console.log(`\n== ${t} ==`);
const rejects = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

/* A real key, in the two PEM shapes GitHub and tools produce. */
const { privateKey: pkcs1Pem, publicKey: publicPem } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});
const pkcs8Pem = createPrivateKey(pkcs1Pem).export({ type: 'pkcs8', format: 'pem' });

const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const decodePart = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

const publicKey = await crypto.subtle.importKey(
  'spki',
  Uint8Array.from(atob(publicPem.replace(/-----[A-Z ]+-----|\s/g, '')), (c) => c.charCodeAt(0)),
  { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
  false,
  ['verify']
);

/* -------------------------------------------------------------- */
sec('the private key');
{
  ok('a PKCS#1 key (the "BEGIN RSA PRIVATE KEY" GitHub gives you) imports', !!(await importPrivateKey(pkcs1Pem)));
  ok('a PKCS#8 key imports too', !!(await importPrivateKey(pkcs8Pem)));
  ok('a one-line key with literal \\n (as .dev.vars needs) imports',
    !!(await importPrivateKey(pkcs1Pem.trim().replace(/\n/g, '\\n'))));
  ok('Windows line endings and stray whitespace are fine', !!(await importPrivateKey('  ' + pkcs1Pem.replace(/\n/g, '\r\n') + '\n\n')));
  ok('normalizePem is idempotent', normalizePem(normalizePem(pkcs1Pem)) === normalizePem(pkcs1Pem));

  const empty = await rejects(() => importPrivateKey(''));
  ok('an empty key says what to paste', /not a PEM private key.*BEGIN and END/.test(empty || ''), empty);
  const wrong = await rejects(() => importPrivateKey('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----'));
  ok('a public key is refused with the same guidance', /not a PEM private key/.test(wrong || ''), wrong);

  const pkcs1Der = Uint8Array.from(atob(pkcs1Pem.replace(/-----[A-Z ]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const wrapped = pkcs1ToPkcs8(pkcs1Der);
  const reference = Uint8Array.from(atob(pkcs8Pem.replace(/-----[A-Z ]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  ok('the PKCS#1 wrapper is byte-identical to what OpenSSL produces', Buffer.from(wrapped).equals(Buffer.from(reference)));
}

/* -------------------------------------------------------------- */
sec('the JWT');
{
  const key = await importPrivateKey(pkcs1Pem);
  const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
  const jwt = await createAppJwt({ appId: 1234567, key, now: NOW });
  const [h, p, sig] = jwt.split('.');

  ok('three base64url parts, no padding', jwt.split('.').length === 3 && !/[=+/]/.test(jwt));
  ok('RS256', decodePart(h).alg === 'RS256' && decodePart(h).typ === 'JWT');
  ok('issuer is the app id, as a string', decodePart(p).iss === '1234567');
  const secs = NOW / 1000;
  ok('issued 60s in the past, to tolerate clock drift', decodePart(p).iat === secs - 60);
  ok('expires within GitHub\'s 10-minute limit', decodePart(p).exp - secs <= 600 && decodePart(p).exp > secs);
  ok('the signature verifies with the matching public key',
    await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`)));
  ok('and fails if the payload is tampered with',
    !(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}x`))));
}

/* -------------------------------------------------------------- */
/** A fake GitHub that records calls and can be told to misbehave. */
function fakeGitHub({ installStatus = 200, tokenStatus = 201, expiresInMs = 3600 * 1000, clock } = {}) {
  const calls = [];
  let issued = 0;
  const fetchImpl = async (url, init = {}) => {
    const path = url.replace('https://api.github.com', '');
    calls.push({ path, method: init.method || 'GET', headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const json = (status, body) => new Response(JSON.stringify(body), { status });
    if (path.endsWith('/installation')) {
      return installStatus === 200 ? json(200, { id: 42 }) : json(installStatus, { message: installStatus === 401 ? 'A JSON web token could not be decoded' : 'Not Found' });
    }
    if (path === '/app/installations/42/access_tokens') {
      issued++;
      return tokenStatus === 201
        ? json(201, { token: `ghs_token_${issued}`, expires_at: new Date(clock() + expiresInMs).toISOString() })
        : json(tokenStatus, { message: 'Bad credentials' });
    }
    return json(404, { message: 'unexpected ' + path });
  };
  return { fetchImpl, calls, issuedCount: () => issued };
}

sec('the installation token');
{
  clearTokenCache();
  let t = Date.UTC(2026, 9, 1, 12, 0, 0);
  const clock = () => t;
  const gh = fakeGitHub({ clock });
  const provider = appTokenProvider({ appId: 7, privateKey: pkcs1Pem, owner: 'o', repo: 'r', fetchImpl: gh.fetchImpl, now: clock });

  const first = await provider();
  ok('returns the installation token', first === 'ghs_token_1');
  ok('looked the installation up from the repo, so no installation-id secret is needed', gh.calls[0].path === '/repos/o/r/installation');
  ok('authenticated those calls with the app JWT, not a token', /^Bearer eyJ/.test(gh.calls[0].headers.Authorization));
  ok('asked for a token limited to this one repo', JSON.stringify(gh.calls[1].body) === JSON.stringify({ repositories: ['r'] }) && gh.calls[1].method === 'POST');
  ok('sent a User-Agent (GitHub rejects requests without one)', !!gh.calls[0].headers['User-Agent']);

  const callsAfterFirst = gh.calls.length;
  ok('a second call reuses the cached token with no requests', (await provider()) === 'ghs_token_1' && gh.calls.length === callsAfterFirst);

  t += 56 * 60 * 1000; // 4 minutes before expiry: inside the refresh margin
  ok('refreshes before the token actually expires', (await provider()) === 'ghs_token_2');
  ok('...without looking the installation up again', gh.calls.filter((c) => c.path.endsWith('/installation')).length === 1);

  provider.invalidate();
  ok('invalidate() forces a fresh token', (await provider()) === 'ghs_token_3');
  ok('...still without another installation lookup', gh.calls.filter((c) => c.path.endsWith('/installation')).length === 1);

  const other = appTokenProvider({ appId: 7, privateKey: pkcs1Pem, owner: 'o', repo: 'other', fetchImpl: gh.fetchImpl, now: clock });
  ok('tokens are cached per repo', (await other()) === 'ghs_token_4');
}

sec('when GitHub says no');
{
  clearTokenCache();
  const clock = () => Date.now();
  const notInstalled = appTokenProvider({ appId: 7, privateKey: pkcs1Pem, owner: 'o', repo: 'r', fetchImpl: fakeGitHub({ installStatus: 404, clock }).fetchImpl });
  const m1 = await rejects(notInstalled);
  ok('app not installed on the repo: says so and where to fix it', /not installed on o\/r/.test(m1 || '') && /Install it/.test(m1 || ''), m1);

  clearTokenCache();
  const badKey = appTokenProvider({ appId: 7, privateKey: pkcs1Pem, owner: 'o', repo: 'r', fetchImpl: fakeGitHub({ installStatus: 401, clock }).fetchImpl });
  const m2 = await rejects(badKey);
  ok('wrong id or key: names both secrets', /GITHUB_APP_ID/.test(m2 || '') && /GITHUB_APP_PRIVATE_KEY/.test(m2 || ''), m2);

  clearTokenCache();
  const noToken = appTokenProvider({ appId: 7, privateKey: pkcs1Pem, owner: 'o', repo: 'r', fetchImpl: fakeGitHub({ tokenStatus: 403, clock }).fetchImpl });
  ok('token request refused: reported', /installation token/.test((await rejects(noToken)) || ''));

  clearTokenCache();
  const garbage = appTokenProvider({ appId: 7, privateKey: 'not a key', owner: 'o', repo: 'r', fetchImpl: fakeGitHub({ clock }).fetchImpl });
  ok('a malformed key fails before any request is made', /not a PEM private key/.test((await rejects(garbage)) || ''));
}

/* -------------------------------------------------------------- */
sec('the GitHub client');
{
  const realFetch = globalThis.fetch;
  try {
    // plain token: used as-is
    const seen = [];
    globalThis.fetch = async (url, init) => { seen.push(init.headers.Authorization); return new Response('{"ok":true}', { status: 200 }); };
    await github('plain-token').api('/user');
    ok('a plain token string still works (scripts, tests)', seen[0] === 'Bearer plain-token');

    // provider: token fetched per request, and refreshed once on a 401
    let n = 0;
    const provider = async () => `tok${++n}`;
    provider.invalidate = () => {};
    const log = [];
    globalThis.fetch = async (url, init) => {
      log.push(init.headers.Authorization);
      return log.length === 1 ? new Response('{"message":"Bad credentials"}', { status: 401 }) : new Response('{"ok":true}', { status: 200 });
    };
    const data = await github(provider).api('/user');
    ok('a revoked token (401) is replaced once and the request retried', data.ok === true && log.join() === 'Bearer tok1,Bearer tok2', log.join());

    // a second 401 is a real failure, not a loop
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('{"message":"Bad credentials"}', { status: 401 }); };
    const err = await rejects(() => github(provider).api('/user'));
    ok('a second 401 fails instead of looping', calls === 2 && /Bad credentials/.test(err || ''), `${calls} calls, ${err}`);

    // a plain token never retries
    calls = 0;
    await rejects(() => github('t').api('/user'));
    ok('a plain token is not retried', calls === 1);

    // deleteBranch builds the right ref path
    const paths = [];
    globalThis.fetch = async (url, init) => { paths.push(`${init.method} ${url}`); return new Response(null, { status: 204 }); };
    await github('t').deleteBranch('o', 'r', 'contribute/new-section-abc');
    ok('deleteBranch keeps the slash in the ref', paths[0] === 'DELETE https://api.github.com/repos/o/r/git/refs/heads/contribute/new-section-abc', paths[0]);
  } finally {
    globalThis.fetch = realFetch;
  }
}

/* -------------------------------------------------------------- */
sec('which PRs the jobs may touch');
{
  const cfg = { owner: 'realtimshady16', repo: 'mzantsi-vibes', branchPrefix: 'contribute' };
  const pr = (over = {}) => ({
    user: { type: 'Bot', login: 'mzantsi-vibes-contribute[bot]' },
    head: { ref: 'contribute/new-law-abc', repo: { full_name: 'realtimshady16/mzantsi-vibes' } },
    ...over,
  });
  ok('an app PR on a contribute/ branch in this repo', isContributionPull(pr(), cfg));
  ok('the owner\'s own PR is not one of ours', !isContributionPull(pr({ user: { type: 'User', login: 'realtimshady16' } }), cfg));
  ok('a Bot PR on some other branch is not', !isContributionPull(pr({ head: { ref: 'feature/x', repo: { full_name: 'realtimshady16/mzantsi-vibes' } } }), cfg));
  ok('"contribute-readme-…" (the old tool\'s branches) is not', !isContributionPull(pr({ head: { ref: 'contribute-readme-123', repo: { full_name: 'realtimshady16/mzantsi-vibes' } } }), cfg));
  ok('a PR from a fork is not', !isContributionPull(pr({ head: { ref: 'contribute/x', repo: { full_name: 'someone/mzantsi-vibes' } } }), cfg));
  ok('a PR whose fork was deleted (head.repo null) is not, and does not crash', !isContributionPull(pr({ head: { ref: 'contribute/x', repo: null } }), cfg));
  ok('owner/repo comparison ignores case', isContributionPull(pr({ head: { ref: 'contribute/x', repo: { full_name: 'RealTimShady16/Mzantsi-Vibes' } } }), cfg));
  ok('undefined is safe', !isContributionPull(undefined, cfg));
}

/* -------------------------------------------------------------- */
sec('configuration');
{
  const full = { GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: pkcs1Pem, HMAC_SECRET: 'h', RESEND_API_KEY: 'r', REVIEWER_EMAIL: 'a@b.c' };
  const cfg = readConfig(full);
  ok('with all four secrets, githubAuth is a token provider', typeof cfg.githubAuth === 'function' && typeof cfg.githubAuth.invalidate === 'function');
  ok('the old PAT is gone from the config', !('token' in cfg));

  const e = await rejects(async () => readConfig({ HMAC_SECRET: 'h', RESEND_API_KEY: 'r' }));
  ok('missing app credentials are named', /GITHUB_APP_ID/.test(e || '') && /GITHUB_APP_PRIVATE_KEY/.test(e || ''), e);
  const legacy = await rejects(async () => readConfig({ BOT_GITHUB_PAT: 'ghp_old', HMAC_SECRET: 'h', RESEND_API_KEY: 'r' }));
  ok('a leftover PAT does not satisfy the requirement', /GITHUB_APP_ID/.test(legacy || ''), legacy);
  const noTavily = readConfig(full);
  ok('Tavily stays optional', noTavily.tavilyKey === '');
}

console.log(`\n==============================================\n  ${pass} passed, ${fail} failed\n==============================================`);
process.exit(fail ? 1 : 0);
