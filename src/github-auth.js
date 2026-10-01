/**
 * GitHub App authentication.
 *
 * The Worker acts as a GitHub App instead of a bot user account, so there is
 * no account to suspend, and the token it gets is limited to this one repo.
 *
 *   private key --signs--> short JWT --exchanged for--> installation token (~1h)
 *
 * Two secrets are needed, GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY. The
 * installation id is looked up from the repo, so it is not a third secret.
 *
 * Everything here is WebCrypto, so it runs in a Worker and in Node alike.
 */

const API = 'https://api.github.com';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * Private key
 * ------------------------------------------------------------------ */

function derLength(n) {
  if (n < 128) return [n];
  const bytes = [];
  for (; n > 0; n >>= 8) bytes.unshift(n & 255);
  return [0x80 | bytes.length, ...bytes];
}

/**
 * GitHub hands out keys as PKCS#1 ("BEGIN RSA PRIVATE KEY") but WebCrypto only
 * imports PKCS#8. Wrapping is just adding a fixed header, so do it here rather
 * than asking whoever sets the secret to run openssl.
 */
export function pkcs1ToPkcs8(pkcs1) {
  const version = [0x02, 0x01, 0x00];
  // AlgorithmIdentifier: rsaEncryption (1.2.840.113549.1.1.1), NULL parameters
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLength(pkcs1.length)];
  const inner = version.length + algorithm.length + octet.length + pkcs1.length;
  return Uint8Array.from([0x30, ...derLength(inner), ...version, ...algorithm, ...octet, ...pkcs1]);
}

/** Accepts the PEM as pasted, or on one line with literal "\n" (as .dev.vars needs). */
export function normalizePem(pem) {
  return String(pem ?? '').replace(/\\n/g, '\n').replace(/\r/g, '').trim();
}

export async function importPrivateKey(pem) {
  const text = normalizePem(pem);
  const match = /-----BEGIN ((?:RSA )?PRIVATE KEY)-----([\s\S]+?)-----END \1-----/.exec(text);
  if (!match) {
    throw new Error(
      'GITHUB_APP_PRIVATE_KEY is not a PEM private key. Paste the whole .pem file GitHub gave you, ' +
        'including the BEGIN and END lines.'
    );
  }

  const der = Uint8Array.from(atob(match[2].replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const pkcs8 = match[1] === 'RSA PRIVATE KEY' ? pkcs1ToPkcs8(der) : der;

  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/* ------------------------------------------------------------------ *
 * JWT
 * ------------------------------------------------------------------ */

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

/** GitHub allows 10 minutes at most, and tolerates a little clock drift, so back-date `iat`. */
export async function createAppJwt({ appId, key, now = Date.now() }) {
  const seconds = Math.floor(now / 1000);
  const unsigned = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({
    iat: seconds - 60,
    exp: seconds + 540,
    iss: String(appId),
  })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(signature)}`;
}

/* ------------------------------------------------------------------ *
 * Installation token, cached per isolate
 * ------------------------------------------------------------------ */

// Keyed by app and repo. A Worker isolate serves many requests, so this saves
// a JWT signature and two API calls on nearly every one of them.
const cache = new Map();

export function clearTokenCache() {
  cache.clear();
}

/**
 * Returns an async function that yields a valid installation token. It has an
 * `invalidate()` so the GitHub client can drop a token GitHub rejected.
 */
export function appTokenProvider({ appId, privateKey, owner, repo, fetchImpl = fetch, now = () => Date.now() }) {
  const cacheKey = `${appId}/${owner}/${repo}`;
  let keyPromise = null;

  async function call(path, jwt, init = {}) {
    const res = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'mzantsi-vibes-contribute',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 200) }; }
    return { res, data };
  }

  async function provider() {
    const entry = cache.get(cacheKey) || {};
    if (entry.token && entry.expiresAt - now() > REFRESH_MARGIN_MS) return entry.token;

    keyPromise ||= importPrivateKey(privateKey);
    const jwt = await createAppJwt({ appId, key: await keyPromise, now: now() });

    let installationId = entry.installationId;
    if (!installationId) {
      const { res, data } = await call(`/repos/${owner}/${repo}/installation`, jwt);
      if (res.status === 404) {
        throw new Error(
          `The GitHub App (id ${appId}) is not installed on ${owner}/${repo}. ` +
            `Install it on that repository from the app's page on GitHub.`
        );
      }
      if (res.status === 401) {
        throw new Error(
          `GitHub rejected the app credentials: ${data.message || res.status}. ` +
            `Check GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY belong to the same app.`
        );
      }
      if (!res.ok) throw new Error(`Could not find the app installation: ${data.message || res.status}`);
      installationId = data.id;
    }

    // Limit the token to this repo, so a leaked token cannot touch anything else
    // the app is installed on.
    const { res, data } = await call(`/app/installations/${installationId}/access_tokens`, jwt, {
      method: 'POST',
      body: JSON.stringify({ repositories: [repo] }),
    });
    if (!res.ok) throw new Error(`Could not get an installation token: ${data.message || res.status}`);

    cache.set(cacheKey, { installationId, token: data.token, expiresAt: Date.parse(data.expires_at) });
    return data.token;
  }

  provider.invalidate = () => {
    const entry = cache.get(cacheKey);
    if (entry) cache.set(cacheKey, { installationId: entry.installationId });
  };

  return provider;
}
