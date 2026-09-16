(() => {
  'use strict';

  // One place to coordinate every controller-side fetch. Several feature modules
  // poll the same RCON endpoints; without coordination they can overlap and put
  // multiple reads on the single HLL:V RCON socket at the same time.
  const nativeFetch = window.fetch.bind(window);
  const origin = window.location.origin;
  const inflight = new Map();
  const cache = new Map();
  const readQueue = [];
  let activeReads = 0;

  const MAX_CONCURRENT_READS = 1;
  const DEFAULT_TIMEOUT_MS = 28000;
  const CONNECT_TIMEOUT_MS = 45000;

  function resolveUrl(input) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      return new URL(raw, window.location.href);
    } catch {
      return null;
    }
  }

  function isControllerRequest(url) {
    return Boolean(url && url.origin === origin && (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/controller/') ||
      url.pathname === '/health' ||
      url.pathname === '/version'
    ));
  }

  function activeView(id) {
    return document.getElementById(id)?.classList.contains('active') === true;
  }

  function syntheticPayload(url) {
    // Heavy feature-specific endpoints should not run just because their JS file
    // exists on the page. Their own nav/refresh handlers request real data when
    // the user actually opens that section.
    if (url.pathname === '/api/v2/logs' && !activeView('logs')) {
      return { entries: [] };
    }
    if (url.pathname === '/api/v2/bans' && url.searchParams.get('type') === 'perma' && !activeView('logs') && !activeView('bans')) {
      return { banList: [] };
    }
    if (url.pathname === '/api/v2/votes' && !activeView('voting')) {
      return { active: null, history: [], templates: [] };
    }
    if (url.pathname === '/api/v2/map-catalog' && !activeView('maps')) {
      return { maps: [] };
    }
    return null;
  }

  function cacheTtl(url) {
    const path = url.pathname;
    if (path === '/api/v2/connection/status') return 1500;
    if (path === '/api/v2/server') return 2500;
    if (path === '/api/v2/players') return 2500;
    if (path === '/api/v2/logs') return 1500;
    if (path === '/api/v2/bans') return 2500;
    if (path === '/api/v2/map-sequence' || path === '/api/v2/map-rotation' || path === '/api/v2/map-shuffle') return 4000;
    if (path === '/api/v2/votes') return 1500;
    if (path.includes('player-stats')) return 4000;
    if (path === '/controller/repeat-jobs') return 1500;
    return 0;
  }

  function timeoutFor(url, method) {
    if (method !== 'GET' && url.pathname === '/api/v2/connect') return CONNECT_TIMEOUT_MS;
    return DEFAULT_TIMEOUT_MS;
  }

  function snapshotResponse(response, body) {
    return {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      body
    };
  }

  function restoreResponse(record) {
    return new Response(record.body.slice(0), {
      status: record.status,
      statusText: record.statusText,
      headers: record.headers
    });
  }

  function jsonResponse(payload) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }

  function pumpQueue() {
    while (activeReads < MAX_CONCURRENT_READS && readQueue.length) {
      const job = readQueue.shift();
      activeReads += 1;
      Promise.resolve()
        .then(job.run)
        .then(job.resolve, job.reject)
        .finally(() => {
          activeReads -= 1;
          pumpQueue();
        });
    }
  }

  function queueRead(run) {
    return new Promise((resolve, reject) => {
      readQueue.push({ run, resolve, reject });
      pumpQueue();
    });
  }

  async function fetchWithTimeout(input, init, timeoutMs) {
    if (init?.signal) return nativeFetch(input, init);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await nativeFetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  window.fetch = function coordinatedFetch(input, init = {}) {
    const url = resolveUrl(input);
    const method = String(init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();

    if (!isControllerRequest(url)) {
      return nativeFetch(input, init);
    }

    const synthetic = method === 'GET' ? syntheticPayload(url) : null;
    if (synthetic !== null) return Promise.resolve(jsonResponse(synthetic));

    // Commands must never wait behind background reads. They still get a bounded
    // browser wait, while the RCON bridge retains its own connection/reconnect logic.
    if (method !== 'GET') {
      return fetchWithTimeout(input, init, timeoutFor(url, method));
    }

    const key = `${method} ${url.pathname}${url.search}`;
    const ttl = cacheTtl(url);
    const cached = cache.get(key);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return Promise.resolve(restoreResponse(cached.record));
    }

    // If the browser tab is in the background, prefer the most recent response
    // instead of waking the RCON bridge just for a UI poll.
    if (document.visibilityState === 'hidden' && cached) {
      return Promise.resolve(restoreResponse(cached.record));
    }

    if (inflight.has(key)) {
      return inflight.get(key).then(restoreResponse);
    }

    const pending = queueRead(async () => {
      const response = await fetchWithTimeout(input, init, timeoutFor(url, method));
      const body = await response.arrayBuffer();
      const record = snapshotResponse(response, body);
      if (ttl > 0 && response.ok) cache.set(key, { record, expiresAt: Date.now() + ttl });
      return record;
    });

    inflight.set(key, pending);
    pending.finally(() => inflight.delete(key));
    return pending.then(restoreResponse);
  };

  window.__HLLVControllerRuntime = {
    version: '1.0.0',
    maxConcurrentReads: MAX_CONCURRENT_READS,
    clearCache() { cache.clear(); },
    status() {
      return {
        activeReads,
        queuedReads: readQueue.length,
        inFlight: [...inflight.keys()],
        cached: [...cache.keys()]
      };
    }
  };
})();
