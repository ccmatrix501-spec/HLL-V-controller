(() => {
  'use strict';

  const LOGIN_TIMEOUT_MS = 12000;
  const STATUS_TIMEOUT_MS = 8000;
  const CORE_TIMEOUT_MS = 12000;
  const FEATURE_VERSION = '20260919-v14-advanced-admin';
  // Mobile stability: only load the core controller at startup. Heavy feature
  // modules are lazy-loaded when their view is actually opened.
  // Keep startup extremely small on mobile. View-specific modules are loaded
  // only when the administrator opens that view.
  const FEATURE_SCRIPTS = Object.freeze([
    '/controller-runtime.js',
    '/app.js',
    '/live-summary.js',
    '/repeats.js',
    '/saved-broadcasts.js'
  ]);
  const LAZY_FEATURES = Object.freeze({
    players: ['/player-roster.js'],
    maps: ['/map-manager.js', '/map-names.js'],
    access: ['/access-manager.js', '/record-name-editor.js'],
    bans: ['/record-name-editor.js', '/ban-player-search.js'],
    settings: ['/advanced-admin.js'],
    logs: ['/admin-logs.js']
  });
  const IDLE_FEATURES = Object.freeze(['/voting.js', '/leaderboard.js', '/match-leaderboard.js']);

  let coreBusy = false;
  let watchdog = null;
  let featureLoadPromise = null;
  const featureFailures = [];

  function byId(id) {
    return document.getElementById(id);
  }

  function setView(authenticated) {
    const login = byId('loginView');
    const app = byId('appView');
    if (!login || !app) return;

    document.documentElement.dataset.controllerAuthenticated = authenticated ? '1' : '0';

    if (authenticated) {
      login.classList.add('hidden');
      login.style.display = 'none';
      app.classList.remove('hidden');
      app.style.display = '';
      app.style.visibility = 'visible';
      app.style.opacity = '1';
    } else {
      app.classList.add('hidden');
      app.style.display = 'none';
      login.classList.remove('hidden');
      login.style.display = 'grid';
      login.style.visibility = 'visible';
      login.style.opacity = '1';
    }
  }

  function xhrJson(method, url, body, timeoutMs) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.timeout = timeoutMs;
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('Cache-Control', 'no-store');
      if (body !== undefined && body !== null) xhr.setRequestHeader('Content-Type', 'application/json');

      xhr.onload = () => {
        let data = null;
        try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; }
        catch { data = xhr.responseText; }

        if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
        const message = data && typeof data === 'object' && data.error
          ? data.error
          : `Request failed (${xhr.status || 'network error'})`;
        reject(new Error(message));
      };

      xhr.onerror = () => reject(new Error('Could not reach the controller service.'));
      xhr.ontimeout = () => reject(new Error(`Controller request timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
      xhr.onabort = () => reject(new Error('Controller request was cancelled.'));

      try {
        xhr.send(body !== undefined && body !== null ? JSON.stringify(body) : null);
      } catch (err) {
        reject(err);
      }
    });
  }

  function asArray(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of ['players', 'Players', 'items', 'Items', 'result', 'Result', 'data', 'Data']) {
      if (Array.isArray(data[key])) return data[key];
    }
    return [];
  }

  function first(obj, keys, fallback = '—') {
    for (const key of keys) {
      if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
    }
    return fallback;
  }

  function setConnection(connected) {
    document.documentElement.dataset.rconConnected = connected ? '1' : '0';
    const pill = byId('connectionPill');
    const button = byId('connectBtn');
    if (pill) {
      pill.className = `pill ${connected ? 'online' : 'offline'}`;
      pill.textContent = connected ? 'RCON CONNECTED' : 'RCON DISCONNECTED';
    }
    if (button) button.textContent = connected ? 'Disconnect RCON' : 'Connect RCON';
    if (!connected) {
      const sub = byId('statPlayerSub');
      if (sub) sub.textContent = 'No connection';
    }
  }

  function updateServer(data) {
    const box = byId('sessionRaw');
    if (box) box.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const obj = data && typeof data === 'object' ? data : {};

    const statMap = byId('statMap');
    const statNextMap = byId('statNextMap');
    const statTime = byId('statTime');
    const statPlayers = byId('statPlayers');
    const statPlayerSub = byId('statPlayerSub');

    if (statMap) statMap.textContent = String(first(obj, [
      'map','Map','map_name','mapName','MapName','map_id','mapId','current_map','currentMap','CurrentMap'
    ]));
    if (statNextMap) statNextMap.textContent = String(first(obj, [
      'next_map','nextMap','NextMap','next_map_name','nextMapName','next_map_id','nextMapId','MapNext'
    ]));
    if (statTime) statTime.textContent = String(first(obj, [
      'remaining_time','remainingTime','RemainingTime','remaining_match_time','remainingMatchTime',
      'time_remaining','timeRemaining','TimeRemaining','remaining'
    ]));

    const playerValue = first(obj, ['player_count','playerCount','current_players','currentPlayers','PlayerCount','CurrentPlayers'], null);
    const maxValue = first(obj, ['max_player_count','maxPlayerCount','max_players','maxPlayers','MaxPlayers'], null);
    const playerNumber = Number(playerValue);
    const maxNumber = Number(maxValue);
    if (statPlayers && playerValue !== null && Number.isFinite(playerNumber)) {
      statPlayers.textContent = maxValue !== null && Number.isFinite(maxNumber)
        ? `${playerNumber}/${maxNumber}`
        : String(playerNumber);
      if (statPlayerSub) statPlayerSub.textContent = 'live server population';
    }
  }

  function updatePlayers(data) {
    const players = asArray(data);
    const count = byId('statPlayers');
    const sub = byId('statPlayerSub');
    if (count) count.textContent = String(players.length);
    if (sub) sub.textContent = 'players currently loaded';
  }

  async function safeCoreBoot() {
    if (coreBusy || document.documentElement.dataset.controllerAuthenticated !== '1') return false;
    coreBusy = true;
    try {
      const status = await xhrJson('GET', `/api/v2/connection/status?_=${Date.now()}`, null, CORE_TIMEOUT_MS);
      const connected = Boolean(status && status.connected);
      setConnection(connected);
      if (!connected) {
        window.__HLLVSafeBootReady = true;
        return true;
      }

      // app.js owns live data refreshes. The failsafe only verifies connectivity;
      // duplicating server/player requests here bypassed the shared fetch
      // coordinator and was a major source of overlapping RCON traffic.
      window.__HLLVSafeBootReady = true;
      return true;
    } catch (err) {
      setConnection(false);
      console.warn('[controller core boot]', err);
      return false;
    } finally {
      coreBusy = false;
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-hllv-feature="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = `${src}?v=${encodeURIComponent(FEATURE_VERSION)}`;
      script.async = false;
      script.dataset.hllvFeature = src;
      script.onload = () => {
        script.dataset.loaded = '1';
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(script);
    });
  }

  const lazyLoaded = new Set();

  async function loadLazyView(view) {
    const scripts = LAZY_FEATURES[view];
    if (!scripts || lazyLoaded.has(view)) return;
    lazyLoaded.add(view);
    for (const src of scripts) {
      try { await loadScript(src); }
      catch (err) {
        featureFailures.push({ src, message: err?.message || String(err) });
        console.error('[controller lazy feature load]', src, err);
      }
    }
  }

  document.addEventListener('click', event => {
    const nav = event.target?.closest?.('[data-view]');
    const view = nav?.dataset?.view;
    if (view && LAZY_FEATURES[view]) setTimeout(() => void loadLazyView(view), 0);

    // Teamkill analysis is substantially heavier than the normal log viewer.
    // Load it only when explicitly requested, not merely by opening Admin Logs.
    const subtab = event.target?.closest?.('[data-admin-log-subtab="teamkill"]');
    if (subtab) setTimeout(async () => {
      try { await loadScript('/teamkill-monitor.js'); }
      catch (err) { console.error('[controller teamkill feature load]', '/teamkill-monitor.js', err); }
    }, 0);
  }, true);

  function loadFeatureScripts() {
    if (featureLoadPromise) return featureLoadPromise;
    featureLoadPromise = (async () => {
      document.documentElement.dataset.controllerFeatures = 'loading';
      for (const src of FEATURE_SCRIPTS) {
        try {
          await loadScript(src);
        } catch (err) {
          featureFailures.push({ src, message: err?.message || String(err) });
          console.error('[controller feature load]', src, err);
        }
      }
      document.documentElement.dataset.controllerFeatures = featureFailures.length ? 'degraded' : 'ready';
      window.__HLLVFeaturesLoaded = true;
      window.__HLLVFeatureFailures = featureFailures.slice();
      const idleLoad = () => {
        for (const src of IDLE_FEATURES) loadScript(src).catch(err => {
          featureFailures.push({ src, message: err?.message || String(err) });
          console.error('[controller idle feature load]', src, err);
        });
      };
      if ('requestIdleCallback' in window) requestIdleCallback(idleLoad, { timeout: 8000 });
      else setTimeout(idleLoad, 6000);
      return featureFailures.length === 0;
    })();
    return featureLoadPromise;
  }

  async function enterAuthenticatedController() {
    setView(true);
    await safeCoreBoot();
    void loadFeatureScripts();
  }

  async function syncStatus() {
    try {
      const status = await xhrJson('GET', `/controller/status?_=${Date.now()}`, null, STATUS_TIMEOUT_MS);
      const authenticated = Boolean(status && status.authenticated);
      if (authenticated) await enterAuthenticatedController();
      else setView(false);
      return authenticated;
    } catch (err) {
      setView(false);
      const error = byId('loginError');
      if (error) error.textContent = err.message || 'Controller status unavailable.';
      return false;
    }
  }

  function installLogin() {
    const form = byId('loginForm');
    const passwordInput = byId('loginPassword');
    const error = byId('loginError');
    if (!form || !passwordInput || form.dataset.emergencyLoginInstalled === '1') return;
    form.dataset.emergencyLoginInstalled = '1';

    form.addEventListener('submit', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const button = event.submitter || form.querySelector('button[type="submit"]');
      const password = String(passwordInput.value || '');
      if (!password) {
        if (error) error.textContent = 'Enter the controller password.';
        passwordInput.focus();
        return;
      }

      if (error) error.textContent = '';
      if (button) {
        button.disabled = true;
        button.textContent = 'Entering...';
      }

      try {
        await xhrJson('POST', '/controller/login', { password }, LOGIN_TIMEOUT_MS);
        passwordInput.value = '';
        const authenticated = await syncStatus();
        if (!authenticated) throw new Error('Login was accepted but the browser did not retain the controller session.');
      } catch (err) {
        if (error) error.textContent = err && err.message ? err.message : 'Login failed.';
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = 'Enter Controller';
        }
      }
    }, true);
  }

  function start() {
    installLogin();
    void syncStatus();
    clearInterval(watchdog);
    watchdog = setInterval(() => {
      // app.js owns normal polling after it loads. Only invoke the failsafe if
      // the feature loader is degraded or the app never became ready.
      if (document.visibilityState === 'visible' &&
          document.documentElement.dataset.controllerAuthenticated === '1' &&
          (!window.__HLLVFeaturesLoaded || document.documentElement.dataset.controllerFeatures === 'degraded')) {
        void safeCoreBoot();
      }
    }, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.addEventListener('pageshow', event => {
    installLogin();
    // DOMContentLoaded already performs the initial status check. Re-check only
    // when restoring a page from the back/forward cache.
    if (event.persisted) void syncStatus();
  });

  window.__HLLVSafeBoot = {
    version: '14.0.0-advanced-admin',
    retry() { return syncStatus(); },
    status() {
      return {
        authenticated: document.documentElement.dataset.controllerAuthenticated === '1',
        rconConnected: document.documentElement.dataset.rconConnected === '1',
        coreReady: Boolean(window.__HLLVSafeBootReady),
        features: document.documentElement.dataset.controllerFeatures || 'not-loaded',
        featureFailures: featureFailures.slice()
      };
    }
  };
})();
