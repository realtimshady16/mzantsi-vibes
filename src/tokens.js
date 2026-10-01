/**
 * Stateless signed tokens for the approve/reject links in the digest email.
 *
 * Format: <base64url(payload)>.<base64url(hmac)>
 * Payload: { p: prNumber, a: 'approve'|'reject', e: expiryUnixSeconds }
 *
 * No KV, no database, no session. The signature is the only state.
 */

const enc = new TextEncoder();

function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return new Uint8Array(sig);
}

/** Length-independent comparison that doesn't short-circuit on first mismatch. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signToken(secret, { pr, action, ttlHours }) {
  const payload = {
    p: pr,
    a: action,
    e: Math.floor(Date.now() / 1000) + ttlHours * 3600,
  };
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmac(secret, body));
  return `${body}.${sig}`;
}

export async function verifyToken(secret, token) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, error: 'Malformed token.' };
  }

  const [body, sig] = token.split('.');
  if (!body || !sig) return { ok: false, error: 'Malformed token.' };

  const expected = await hmac(secret, body);
  let provided;
  try {
    provided = b64urlDecode(sig);
  } catch {
    return { ok: false, error: 'Malformed token.' };
  }

  if (!timingSafeEqual(expected, provided)) {
    return { ok: false, error: 'Signature does not match. This link was not issued by us.' };
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return { ok: false, error: 'Malformed token.' };
  }

  if (!Number.isInteger(payload.p) || !['approve', 'reject'].includes(payload.a)) {
    return { ok: false, error: 'Token is missing required fields.' };
  }

  if (typeof payload.e !== 'number' || payload.e * 1000 < Date.now()) {
    return { ok: false, error: 'This link has expired. Run a fresh digest to get new links.' };
  }

  return { ok: true, payload };
}
