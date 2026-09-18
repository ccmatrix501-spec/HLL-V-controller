(() => {
  'use strict';

  // Controller-wide GET coordinator. Prevents independently loaded feature
  // modules from hammering the same RCON endpoints at the same time.
  const nativeFetch = window.fetch.bind(window);
  const inflight = new Map();
  const cache = new Map();
  const API_TTL_MS = 2000;
  const ENDPOINT_TTL = [
    [/\/api\/v2\/connection\/status/, 5000],
    [/\/api\/v2\/server(?:\?|$)/, 3000],
    [/\/api\/v2\/players(?:\?|$)/, 3000],
    [/\/api\/v2\/map-(?:rotation|sequence)/, 10000],
    [/\/api\/v2\/maps(?:\?|$)/, 30000],
    [/\/api\/v2\/(?:vips|admins|bans)/, 10000],
    [/\/api\/v2\/logs/, 5000],
    [/\/api\/v2\/leaderboard/, 10000]
  ];

  function ttlFor(key) {
    for (const [pattern, ttl] of ENDPOINT_TTL) if (pattern.test(key)) return ttl;
    return API_TTL_MS;
  }

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
    if (hit && now - hit.at < ttlFor(key)) return Promise.resolve(hit.response.clone());

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
    endpointTtl: true,
    installedAt: Date.now()
  });
})();