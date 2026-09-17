(() => {
  'use strict';

  // Capture the browser's real fetch before controller-runtime.js replaces it.
  // The recovery/bootstrap path must always be able to reach the controller even
  // if another frontend module or the request coordinator fails to initialise.
  const nativeFetch = window.fetch.bind(window);
  const STARTED_AT = Date.now();
  const WATCHDOG_MS = 8000;
  const CORE_TIMEOUT_MS = 10000;
  let lastError = '';
  let coreBootRunning = false;
  let coreBootTimer = null;

  function text(value, max = 700) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function ensureBasePaint() {
    document.documentElement.style.backgroundColor = '#0d100f';
    if (document.body) {
      document.body.style.backgroundColor = '#0d100f';
      document.body.style.minHeight = '100vh';
    }
  }

  function setAuthenticatedView(authenticated) {
    const login = byId('loginView');
    const app = byId('appView');
    if (!login || !app) return;

    if (authenticated) {
      login.classList.add('hidden');
      login.style.display = 'none';
      app.classList.remove('hidden');
      app.style.visibility = 'visible';
      app.style.opacity = '1';
      if (getComputedStyle(app).display === 'none') app.style.display = 'grid';
      else app.style.removeProperty('display');
      document.documentElement.dataset.controllerAuthenticated = '1';
    } else {
      document.documentElement.dataset.controllerAuthenticated = '0';
      app.classList.add('hidden');
      app.style.removeProperty('display');
      login.classList.remove('hidden');
      login.style.display = 'grid';
      login.style.visibility = 'visible';
      login.style.opacity = '1';
    }
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = CORE_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await nativeFetch(url, {
        credentials: 'include',
        cache: 'no-store',
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options.headers || {})
        }
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function jsonRequest(url, options = {}, timeoutMs = CORE_TIMEOUT_MS) {
    const response = await fetchWithTimeout(url, options, timeoutMs);
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    if (!response.ok) {
      const message = data && typeof data === 'object' ? data.error : raw;
      throw new Error(message || `${response.status} ${response.statusText}`);
    }
    return data;
  }

  function setConnectionUi(connected) {
    const pill = byId('connectionPill');
    const button = byId('connectBtn');
    if (pill) {
      pill.classList.toggle('online', Boolean(connected));
      pill.classList.toggle('offline', !connected);
      pill.textContent = connected ? 'RCON CONNECTED' : 'RCON DISCONNECTED';
    }
    if (button) button.textContent = connected ? 'Disconnect RCON' : 'Connect RCON';
    if (!connected) {
      const sub = byId('statPlayerSub');
      if (sub) sub.textContent = 'No connection';
    }
  }

  function first(obj, keys, fallback = '—') {
    for (const key of keys) {
      if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
    }
    return fallback;
  }

  function asArray(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of ['players', 'Players', 'items', 'Items', 'result', 'Result', 'data', 'Data']) {
      if (Array.isArray(data[key])) return data[key];
    }
    return [];
  }

  function updateServerSummary(data) {
    const session = byId('sessionRaw');
    if (session) session.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const obj = data && typeof data === 'object' ? data : {};

    const players = first(obj, ['player_count', 'PlayerCount', 'players', 'Players', 'current_players', 'CurrentPlayers'], null);
    const max = first(obj, ['max_players', 'MaxPlayers', 'slots', 'Slots'], null);
    const statPlayers = byId('statPlayers');
    if (statPlayers && typeof players === 'number') {
      statPlayers.textContent = typeof max === 'number' ? `${players}/${max}` : String(players);
    }

    const statMap = byId('statMap');
    const statNextMap = byId('statNextMap');
    const statTime = byId('statTime');
    if (statMap) statMap.textContent = String(first(obj, ['map', 'Map', 'map_name', 'MapName', 'current_map', 'CurrentMap']));
    if (statNextMap) statNextMap.textContent = String(first(obj, ['next_map', 'NextMap', 'nextMap', 'MapNext']));
    if (statTime) statTime.textContent = String(first(obj, ['remaining_time', 'RemainingTime', 'time_remaining', 'TimeRemaining', 'remaining']));
  }

  function updatePlayerCount(data) {
    const players = asArray(data);
    const statPlayers = byId('statPlayers');
    const statPlayerSub = byId('statPlayerSub');
    if (statPlayers) statPlayers.textContent = String(players.length);
    if (statPlayerSub) statPlayerSub.textContent = 'players currently loaded';
  }

  async function safeCoreBoot() {
    if (coreBootRunning || document.documentElement.dataset.controllerAuthenticated !== '1') return;
    coreBootRunning = true;
    try {
      const status = await jsonRequest('/api/v2/connection/status', {}, 10000);
      const connected = Boolean(status?.connected);
      setConnectionUi(connected);
      document.documentElement.dataset.rconConnected = connected ? '1' : '0';

      if (!connected) return;

      const [serverResult, playersResult] = await Promise.allSettled([
        jsonRequest('/api/v2/server?type=session', {}, 15000),
        jsonRequest('/api/v2/players', {}, 15000)
      ]);

      if (serverResult.status === 'fulfilled') updateServerSummary(serverResult.value);
      if (playersResult.status === 'fulfilled') updatePlayerCount(playersResult.value);
      window.__HLLVSafeBootReady = true;
    } catch (err) {
      lastError = text(err?.message || err || 'Core controller startup failed');
      setConnectionUi(false);
      console.warn('[controller safe boot]', err);
    } finally {
      coreBootRunning = false;
    }
  }

  async function syncAuthView() {
    try {
      const status = await jsonRequest('/controller/status', {}, 8000);
      const authenticated = Boolean(status?.authenticated);
      setAuthenticatedView(authenticated);
      if (authenticated) void safeCoreBoot();
      return authenticated;
    } catch (err) {
      lastError = text(err?.message || err || 'Controller status check failed');
      setAuthenticatedView(false);
      return false;
    }
  }

  function installLoginFallback() {
    const form = byId('loginForm');
    const passwordInput = byId('loginPassword');
    const error = byId('loginError');
    if (!form || !passwordInput || form.dataset.failsafeLoginInstalled === '1') return;

    form.dataset.failsafeLoginInstalled = '1';
    form.addEventListener('submit', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const button = event.submitter || form.querySelector('button[type="submit"]');
      const oldText = button?.textContent || 'Enter Controller';
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
        await jsonRequest('/controller/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        }, 10000);

        passwordInput.value = '';
        const authenticated = await syncAuthView();
        if (!authenticated) throw new Error('Login succeeded but the controller session was not retained.');

        // No forced reload. Show the controller immediately and let the safe core
        // bootstrap establish dashboard state. This prevents login/reload loops.
        setAuthenticatedView(true);
        void safeCoreBoot();
      } catch (err) {
        if (error) error.textContent = text(err?.message || err || 'Login failed');
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = oldText;
        }
      }
    }, true);
  }

  function errorPanel() {
    let panel = byId('controllerBootError');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'controllerBootError';
    panel.setAttribute('role', 'alert');
    Object.assign(panel.style, {
      position: 'fixed', left: '16px', right: '16px', bottom: '16px',
      zIndex: '2147483647', padding: '14px 16px', border: '1px solid #844743',
      borderRadius: '10px', background: '#211716', color: '#f4e9e7',
      font: '14px/1.45 system-ui, sans-serif', boxShadow: '0 12px 40px rgba(0,0,0,.45)'
    });

    const title = document.createElement('strong');
    title.textContent = 'Controller frontend recovery mode';
    title.style.display = 'block';
    title.style.marginBottom = '5px';

    const message = document.createElement('div');
    message.id = 'controllerBootErrorMessage';

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry controller';
    Object.assign(retry.style, {
      cursor: 'pointer', marginTop: '10px', padding: '8px 11px', borderRadius: '7px',
      border: '1px solid #d7b35a', background: '#d7b35a', color: '#171309', fontWeight: '700'
    });
    retry.addEventListener('click', () => {
      panel.remove();
      void syncAuthView();
      void safeCoreBoot();
    });

    panel.append(title, message, retry);
    document.body?.appendChild(panel);
    return panel;
  }

  function showRecovery(reason) {
    ensureBasePaint();
    const authenticated = document.documentElement.dataset.controllerAuthenticated === '1';
    if (authenticated) {
      // Keep the dashboard visible. A secondary feature failure must never replace
      // an authenticated controller with the login screen.
      setAuthenticatedView(true);
      void safeCoreBoot();
    }

    const panel = errorPanel();
    const message = panel?.querySelector('#controllerBootErrorMessage');
    if (message) {
      const detail = text(reason || lastError || 'Unknown frontend startup failure');
      message.textContent = `A controller feature did not finish loading. Core controls remain available.${detail ? ` Error: ${detail}` : ''}`;
    }
  }

  window.addEventListener('error', event => {
    lastError = text(event?.error?.stack || event?.message || 'JavaScript error');
    console.error('[controller frontend]', lastError);
    setTimeout(() => {
      const authenticated = document.documentElement.dataset.controllerAuthenticated === '1';
      if (authenticated) showRecovery(lastError);
      else if (!visible(byId('loginView')) && !visible(byId('appView'))) showRecovery(lastError);
    }, 0);
  }, true);

  window.addEventListener('unhandledrejection', event => {
    lastError = text(event?.reason?.stack || event?.reason?.message || event?.reason || 'Unhandled promise rejection');
    console.error('[controller promise]', lastError);
    setTimeout(() => {
      if (document.documentElement.dataset.controllerAuthenticated === '1') showRecovery(lastError);
    }, 0);
  });

  ensureBasePaint();
  installLoginFallback();
  void syncAuthView();

  document.addEventListener('DOMContentLoaded', () => {
    ensureBasePaint();
    installLoginFallback();
    void syncAuthView();

    clearInterval(coreBootTimer);
    coreBootTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && document.documentElement.dataset.controllerAuthenticated === '1') {
        void safeCoreBoot();
      }
    }, 15000);

    setTimeout(async () => {
      const authenticated = await syncAuthView();
      if (authenticated) {
        void safeCoreBoot();
        const app = byId('appView');
        if (!visible(app)) showRecovery(lastError || 'Authenticated controller view is not visible');
        return;
      }
      if (!visible(byId('loginView'))) {
        showRecovery(lastError || `No controller view became visible within ${Math.round((Date.now() - STARTED_AT) / 1000)} seconds`);
      }
    }, WATCHDOG_MS);
  }, { once: true });

  window.__HLLVSafeBoot = {
    version: '2.0.0',
    retry() { return syncAuthView().then(() => safeCoreBoot()); },
    status() {
      return {
        authenticated: document.documentElement.dataset.controllerAuthenticated === '1',
        rconConnected: document.documentElement.dataset.rconConnected === '1',
        coreReady: Boolean(window.__HLLVSafeBootReady),
        lastError
      };
    }
  };
})();
