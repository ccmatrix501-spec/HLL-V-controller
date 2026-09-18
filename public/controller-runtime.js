(() => {
  'use strict';

  // Controller-wide GET coordinator. Prevents independently loaded feature
  // modules from hammering the same RCON endpoints at the same time.
  const nativeFetch = window.fetch.bind(window);
  const inflight = new Map();
  const cache = new Map();
  const API_TTL_MS = 1250;

  function isShareable(input, init) {
    const method = String(init?.method || 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : input?.url;
    return method === 'GET' && typeof url === 'string' && url.startsWith('/api/');
  }

  function keyFor(input) {
    const url = typeof input === 'string' ? input : input.url;
    return url.replace(/([?&])_=[^&]*/g, '$1').replace(/[?&]$/, '');
  }

  window.fetch = function coordinatedFetch(input, init = {}) {
    if (!isShareable(input, init)) return nativeFetch(input, init);
    const key = keyFor(input);
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at < API_TTL_MS) return Promise.resolve(hit.response.clone());

    const active = inflight.get(key);
    if (active) return active.then(response => response.clone());

    const p = nativeFetch(input, init).then(response => {
      if (response.ok) cache.set(key, { at: Date.now(), response: response.clone() });
      return response;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p.then(response => response.clone());
  };

  window.__HLLVRuntime = Object.freeze({
    version: 'coordinated-fetch-2',
    nativeFetch: false,
    apiTtlMs: API_TTL_MS,
    installedAt: Date.now()
  });
})();