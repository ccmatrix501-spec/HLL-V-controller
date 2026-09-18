(() => {
  'use strict';

  const LOGIN_TIMEOUT_MS = 12000;
  const STATUS_TIMEOUT_MS = 8000;
  const CORE_TIMEOUT_MS = 12000;
  const FEATURE_VERSION = '20260918-v7-mobile-stability';
  const FEATURE_SCRIPTS = Object.freeze([
    '/controller-runtime.js',
    '/app.js',
    '/player-roster.js',
    '/access-manager.js',
    '/record-name-editor.js',
    '/ban-player-search.js',
    '/live-summary.js',
    '/repeats.js',
    '/map-manager.js',
    '/saved-broadcasts.js',
    '/map-names.js',
    '/voting.js',
    '/leaderboard.js',
    '/match-leaderboard.js',
    '/admin-logs.js',
    '/teamkill-monitor.js',
    '/commander-teamkill-review.js',
    '/commander-tempban-policy.js'
  ]);

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
    if (statMap) statMap.textContent = String(first(obj, ['map','Map','map_name','MapName','current_map','CurrentMap']));
    if (statNextMap) statNextMap.textContent = String(first(obj, ['next_map','NextMap','nextMap','MapNext']));
    if (statTime) statTime.textContent = String(first(obj, ['remaining_time','RemainingTime','time_remaining','TimeRemaining','remaining','remaining_match_time']));
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

      const results = await Promise.allSettled([
        xhrJson('GET', `/api/v2/server?type=session&_=${Date.now()}`, null, CORE_TIMEOUT_MS),
        xhrJson('GET', `/api/v2/players?_=${Date.now()}`, null, CORE_TIMEOUT_MS)
      ]);
      if (results[0].status === 'fulfilled') updateServer(results[0].value);
      if (results[1].status === 'fulfilled') updatePlayers(results[1].value);
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
      if (document.visibilityState === 'visible' && document.documentElement.dataset.controllerAuthenticated === '1') {
        void safeCoreBoot();
      }
    }, 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.addEventListener('pageshow', () => {
    installLogin();
    void syncStatus();
  });

  window.__HLLVSafeBoot = {
    version: '7.0.0-mobile-stability',
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
