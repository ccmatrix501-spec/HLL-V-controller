(() => {
  'use strict';

  // Global fetch coordinator for every controller feature. New feature scripts can
  // keep using normal fetch(); this layer automatically deduplicates, prioritises,
  // caches and bounds same-origin controller/RCON reads.
  const nativeFetch = window.fetch.bind(window);
  const origin = window.location.origin;
  const inflight = new Map();
  const cache = new Map();
  const readQueue = [];
  let activeReads = 0;
  let consecutiveReadFailures = 0;
  let breakerOpenUntil = 0;

  // Default bridge pool is 3 connections: one command lane + two read lanes.
  // Two browser reads therefore keep the UI responsive without overdriving RCON.
  const MAX_CONCURRENT_READS = 2;
  const MAX_QUEUED_READS = 24;
  const MAX_QUEUE_WAIT_MS = 12000;
  const DEFAULT_TIMEOUT_MS = 24000;
  const CONNECT_TIMEOUT_MS = 45000;
  const STALE_FALLBACK_MS = 30000;
  const BREAKER_FAILURE_THRESHOLD = 4;
  const BREAKER_COOLDOWN_MS = 8000;

  const metrics = {
    requests: 0,
    networkReads: 0,
    cacheHits: 0,
    staleHits: 0,
    deduped: 0,
    queueDrops: 0,
    timeouts: 0,
    failures: 0,
    breakerOpens: 0
  };

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
    // exists on the page. Their nav/refresh handlers request real data when the
    // user opens that section.
    if (url.pathname === '/api/v2/logs' && !activeView('logs')) return { entries: [] };
    if (url.pathname === '/api/v2/bans' && url.searchParams.get('type') === 'perma' && !activeView('logs') && !activeView('bans')) return { banList: [] };
    if (url.pathname === '/api/v2/votes' && !activeView('voting')) return { active: null, history: [], templates: [] };
    if (url.pathname === '/api/v2/map-catalog' && !activeView('maps')) return { maps: [] };
    return null;
  }

  function cacheTtl(url) {
    const path = url.pathname;
    if (path === '/api/v2/connection/status' || path === '/api/v2/connection/pool') return 1200;
    if (path === '/api/v2/server') return 1800;
    if (path === '/api/v2/players') return 1800;
    if (path === '/api/v2/logs') return 1500;
    if (path === '/api/v2/bans') return 2500;
    if (path === '/api/v2/map-sequence' || path === '/api/v2/map-rotation' || path === '/api/v2/map-shuffle') return 3500;
    if (path === '/api/v2/votes') return 1500;
    if (path.includes('player-stats')) return 3500;
    if (path === '/controller/repeat-jobs') return 1500;
    return 0;
  }

  function requestPriority(url) {
    const path = url.pathname;
    // Connection and live dashboard data should win over historical/heavy reads.
    if (path === '/api/v2/connection/status' || path === '/api/v2/connection/pool') return 0;
    if (path === '/api/v2/server' || path === '/api/v2/players') return 1;
    if (activeView('logs') && (path === '/api/v2/logs' || path === '/api/v2/bans')) return 1;
    if (activeView('players') && path.includes('player')) return 1;
    if (activeView('maps') && path.includes('map')) return 1;
    if (activeView('bans') && path === '/api/v2/bans') return 1;
    return 3;
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
      body,
      storedAt: Date.now()
    };
  }

  function restoreResponse(record, extraHeaders = {}) {
    const headers = new Headers(record.headers);
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
    return new Response(record.body.slice(0), {
      status: record.status,
      statusText: record.statusText,
      headers
    });
  }

  function jsonResponse(payload, status = 200, headers = {}) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...headers
      }
    });
  }

  function cachedRecord(key, allowStale = false) {
    const cached = cache.get(key);
    if (!cached) return null;
    const now = Date.now();
    if (cached.expiresAt > now) return { ...cached, stale: false };
    if (allowStale && now - cached.record.storedAt <= STALE_FALLBACK_MS) return { ...cached, stale: true };
    return null;
  }

  function recordFailure() {
    metrics.failures += 1;
    consecutiveReadFailures += 1;
    if (consecutiveReadFailures >= BREAKER_FAILURE_THRESHOLD) {
      const wasOpen = breakerOpenUntil > Date.now();
      breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
      if (!wasOpen) metrics.breakerOpens += 1;
    }
  }

  function recordSuccess() {
    consecutiveReadFailures = 0;
    breakerOpenUntil = 0;
  }

  function queueError(message) {
    const err = new Error(message);
    err.name = 'ControllerQueueError';
    return err;
  }

  function pumpQueue() {
    const now = Date.now();
    // Expire old background work before starting more network traffic.
    for (let i = readQueue.length - 1; i >= 0; i -= 1) {
      const job = readQueue[i];
      if (now - job.enqueuedAt > MAX_QUEUE_WAIT_MS) {
        readQueue.splice(i, 1);
        metrics.queueDrops += 1;
        job.reject(queueError('Controller background request expired in the queue'));
      }
    }

    readQueue.sort((a, b) => (a.priority - b.priority) || (a.enqueuedAt - b.enqueuedAt));
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

  function queueRead(run, priority) {
    return new Promise((resolve, reject) => {
      if (readQueue.length >= MAX_QUEUED_READS) {
        // Drop the oldest lowest-priority request rather than letting the entire
        // controller build an unbounded backlog.
        let dropIndex = -1;
        let worstPriority = -Infinity;
        let oldest = Infinity;
        readQueue.forEach((job, index) => {
          if (job.priority > worstPriority || (job.priority === worstPriority && job.enqueuedAt < oldest)) {
            worstPriority = job.priority;
            oldest = job.enqueuedAt;
            dropIndex = index;
          }
        });
        if (dropIndex >= 0 && worstPriority >= priority) {
          const [dropped] = readQueue.splice(dropIndex, 1);
          metrics.queueDrops += 1;
          dropped.reject(queueError('Controller background request replaced by newer work'));
        } else {
          metrics.queueDrops += 1;
          reject(queueError('Controller background request queue is full'));
          return;
        }
      }
      readQueue.push({ run, resolve, reject, priority, enqueuedAt: Date.now() });
      pumpQueue();
    });
  }

  async function fetchWithTimeout(input, init, timeoutMs) {
    if (init?.signal) return nativeFetch(input, init);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await nativeFetch(input, { ...init, signal: controller.signal });
    } catch (err) {
      if (err?.name === 'AbortError') metrics.timeouts += 1;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  window.fetch = function coordinatedFetch(input, init = {}) {
    const url = resolveUrl(input);
    const method = String(init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();

    if (!isControllerRequest(url)) return nativeFetch(input, init);
    metrics.requests += 1;

    const synthetic = method === 'GET' ? syntheticPayload(url) : null;
    if (synthetic !== null) return Promise.resolve(jsonResponse(synthetic));

    // Commands must never wait behind background reads. They get a bounded browser
    // wait, while write retries remain disabled in the RCON bridge to avoid duplicate
    // kicks/bans/messages.
    if (method !== 'GET') {
      return fetchWithTimeout(input, init, timeoutFor(url, method));
    }

    const key = `${method} ${url.pathname}${url.search}`;
    const ttl = cacheTtl(url);
    const fresh = cachedRecord(key, false);
    if (fresh) {
      metrics.cacheHits += 1;
      return Promise.resolve(restoreResponse(fresh.record));
    }

    // Hidden tabs should not wake RCON merely to refresh UI that cannot be seen.
    const stale = cachedRecord(key, true);
    if (document.visibilityState === 'hidden' && stale) {
      metrics.staleHits += 1;
      return Promise.resolve(restoreResponse(stale.record, { 'X-HLLV-Stale': 'background-tab' }));
    }

    // During a brief backend failure, fail fast or show the last known good data
    // rather than creating another request storm.
    if (breakerOpenUntil > Date.now()) {
      if (stale) {
        metrics.staleHits += 1;
        return Promise.resolve(restoreResponse(stale.record, { 'X-HLLV-Stale': 'circuit-breaker' }));
      }
      return Promise.resolve(jsonResponse({ error: 'RCON bridge is recovering; retry shortly.' }, 503, { 'Retry-After': '8' }));
    }

    if (inflight.has(key)) {
      metrics.deduped += 1;
      return inflight.get(key).then(restoreResponse);
    }

    const pending = queueRead(async () => {
      metrics.networkReads += 1;
      try {
        const response = await fetchWithTimeout(input, init, timeoutFor(url, method));
        const body = await response.arrayBuffer();
        const record = snapshotResponse(response, body);
        if (response.ok) {
          recordSuccess();
          if (ttl > 0) cache.set(key, { record, expiresAt: Date.now() + ttl });
        } else if (response.status >= 500) {
          recordFailure();
        }
        return record;
      } catch (err) {
        recordFailure();
        const fallback = cachedRecord(key, true);
        if (fallback) {
          metrics.staleHits += 1;
          return snapshotResponse(
            restoreResponse(fallback.record, { 'X-HLLV-Stale': 'network-error' }),
            fallback.record.body.slice(0)
          );
        }
        throw err;
      }
    }, requestPriority(url));

    inflight.set(key, pending);
    pending.finally(() => inflight.delete(key));
    return pending.then(restoreResponse);
  };

  window.addEventListener('online', () => {
    consecutiveReadFailures = 0;
    breakerOpenUntil = 0;
    pumpQueue();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pumpQueue();
  });

  window.__HLLVControllerRuntime = {
    version: '2.0.0',
    maxConcurrentReads: MAX_CONCURRENT_READS,
    clearCache() { cache.clear(); },
    status() {
      return {
        activeReads,
        queuedReads: readQueue.length,
        inFlight: [...inflight.keys()],
        cached: [...cache.keys()],
        breakerOpen: breakerOpenUntil > Date.now(),
        breakerOpenForMs: Math.max(0, breakerOpenUntil - Date.now()),
        consecutiveReadFailures,
        metrics: { ...metrics }
      };
    }
  };
})();
