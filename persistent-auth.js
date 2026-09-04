const crypto = require('crypto');

// This module is preloaded before server.js. It wraps express-session with a
// stateless, signed remember-session store so a successful controller login can
// survive Railway container restarts/deployments without storing the panel
// password in the browser.
const sessionModulePath = require.resolve('express-session');
const originalSession = require('express-session');

const secret = process.env.SESSION_SECRET || '';
const requestedDays = Number(process.env.LOGIN_PERSIST_DAYS || 90);
const persistDays = Number.isFinite(requestedDays)
  ? Math.min(365, Math.max(1, Math.floor(requestedDays)))
  : 90;
const maxAgeMs = persistDays * 24 * 60 * 60 * 1000;
const PURPOSE = '1stmi-hllv-controller-login-v1';

function timingSafeTextEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function signToken(expires, nonce) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${PURPOSE}|${expires}|${nonce}`)
    .digest('base64url');
}

function createPersistentSid() {
  const expires = Date.now() + maxAgeMs;
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = signToken(expires, nonce);
  return `v1.${expires}.${nonce}.${signature}`;
}

function validPersistentSid(sid) {
  if (!secret || typeof sid !== 'string') return false;
  const parts = sid.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const expires = Number(parts[1]);
  const nonce = parts[2];
  const signature = parts[3];
  if (!Number.isFinite(expires) || expires <= Date.now()) return false;
  if (!nonce || !signature) return false;
  return timingSafeTextEqual(signature, signToken(expires, nonce));
}

class PersistentRememberStore extends originalSession.Store {
  constructor(cookieDefaults) {
    super();
    this.cookieDefaults = cookieDefaults || {};
    this.revoked = new Map();
  }

  cleanupRevocations() {
    const now = Date.now();
    for (const [sid, until] of this.revoked.entries()) {
      if (until <= now) this.revoked.delete(sid);
    }
  }

  get(sid, callback) {
    this.cleanupRevocations();
    if (this.revoked.has(sid) || !validPersistentSid(sid)) {
      return callback(null, null);
    }

    const cookie = {
      path: this.cookieDefaults.path || '/',
      httpOnly: this.cookieDefaults.httpOnly !== false,
      secure: Boolean(this.cookieDefaults.secure),
      sameSite: this.cookieDefaults.sameSite || 'strict',
      originalMaxAge: maxAgeMs,
      expires: new Date(Date.now() + maxAgeMs)
    };

    return callback(null, {
      authenticated: true,
      persistentLogin: true,
      cookie
    });
  }

  set(sid, sessionData, callback) {
    // Authentication state is represented by the cryptographically signed SID.
    // We intentionally do not persist panel credentials or passwords anywhere.
    if (callback) callback(null);
  }

  touch(sid, sessionData, callback) {
    if (callback) callback(null);
  }

  destroy(sid, callback) {
    // Keep a short in-process revocation so a copied cookie cannot immediately be
    // reused after logout. The browser cookie is also explicitly cleared by server.js.
    this.revoked.set(sid, Date.now() + maxAgeMs);
    if (callback) callback(null);
  }
}

function persistentSession(options = {}) {
  const cookie = {
    ...(options.cookie || {}),
    maxAge: maxAgeMs
  };

  const wrappedOptions = {
    ...options,
    cookie,
    genid: createPersistentSid,
    store: new PersistentRememberStore(cookie)
  };

  return originalSession(wrappedOptions);
}

Object.assign(persistentSession, originalSession);
require.cache[sessionModulePath].exports = persistentSession;

console.log(`Persistent controller login enabled (${persistDays} day${persistDays === 1 ? '' : 's'}).`);
