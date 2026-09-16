(() => {
  'use strict';

  const STARTED_AT = Date.now();
  const WATCHDOG_MS = 7000;
  let lastError = '';

  function text(value, max = 700) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
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
    const login = document.getElementById('loginView');
    const app = document.getElementById('appView');
    if (!login || !app) return;

    if (authenticated) {
      login.classList.add('hidden');
      login.style.display = 'none';
      app.classList.remove('hidden');
      app.style.removeProperty('display');
      app.style.visibility = 'visible';
      app.style.opacity = '1';
      document.documentElement.dataset.controllerAuthenticated = '1';
    } else {
      document.documentElement.dataset.controllerAuthenticated = '0';
      if (!visible(app)) {
        login.classList.remove('hidden');
        login.style.removeProperty('display');
      }
    }
  }

  async function syncAuthView() {
    try {
      const response = await fetch('/controller/status', {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) return false;
      const status = await response.json().catch(() => null);
      const authenticated = Boolean(status?.authenticated);
      setAuthenticatedView(authenticated);
      return authenticated;
    } catch (err) {
      lastError = text(err?.message || err || 'Controller status check failed');
      return false;
    }
  }

  function installLoginFallback() {
    const form = document.getElementById('loginForm');
    const passwordInput = document.getElementById('loginPassword');
    const error = document.getElementById('loginError');
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
        const response = await fetch('/controller/login', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ password })
        });

        const raw = await response.text();
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch {}

        if (!response.ok) {
          throw new Error(data?.error || raw || `${response.status} ${response.statusText}`);
        }

        passwordInput.value = '';
        const authenticated = await syncAuthView();
        if (!authenticated) {
          throw new Error('Login succeeded but the controller session was not retained. Please retry.');
        }

        // Do not wait on the large feature bundle. The dashboard shell is already
        // visible; reload once to let all authenticated modules initialise cleanly.
        setTimeout(() => window.location.reload(), 100);
      } catch (err) {
        if (error) error.textContent = text(err?.message || err || 'Login failed');
        if (button) {
          button.disabled = false;
          button.textContent = oldText;
        }
      }
    }, true);
  }

  function errorPanel() {
    let panel = document.getElementById('controllerBootError');
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
    message.textContent = 'The controller interface did not finish loading. The login screen has been restored.';

    const actions = document.createElement('div');
    actions.style.marginTop = '10px';
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.flexWrap = 'wrap';

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry controller';
    Object.assign(retry.style, {
      cursor: 'pointer', padding: '8px 11px', borderRadius: '7px',
      border: '1px solid #d7b35a', background: '#d7b35a', color: '#171309', fontWeight: '700'
    });
    retry.addEventListener('click', () => location.reload());

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    Object.assign(dismiss.style, {
      cursor: 'pointer', padding: '8px 11px', borderRadius: '7px',
      border: '1px solid #4a514b', background: '#202620', color: '#f1f4ef', fontWeight: '700'
    });
    dismiss.addEventListener('click', () => panel.remove());

    actions.append(retry, dismiss);
    panel.append(title, message, actions);
    document.body?.appendChild(panel);
    return panel;
  }

  function showRecovery(reason) {
    ensureBasePaint();
    const login = document.getElementById('loginView');
    const app = document.getElementById('appView');

    // Never overwrite an authenticated app view with the login fallback.
    if (document.documentElement.dataset.controllerAuthenticated === '1') return;

    if (login && !visible(login) && (!app || !visible(app))) {
      login.classList.remove('hidden');
      login.style.display = 'grid';
      login.style.visibility = 'visible';
      login.style.opacity = '1';
    }

    const panel = errorPanel();
    const message = panel?.querySelector('#controllerBootErrorMessage');
    if (message) {
      const detail = text(reason || lastError || 'Unknown frontend startup failure');
      message.textContent = `The controller interface did not finish loading. Recovery mode restored the login screen.${detail ? ` Error: ${detail}` : ''}`;
    }
  }

  window.addEventListener('error', event => {
    lastError = text(event?.error?.stack || event?.message || 'JavaScript error');
    setTimeout(() => {
      const login = document.getElementById('loginView');
      const app = document.getElementById('appView');
      if (!visible(login) && !visible(app)) showRecovery(lastError);
    }, 0);
  }, true);

  window.addEventListener('unhandledrejection', event => {
    lastError = text(event?.reason?.stack || event?.reason?.message || event?.reason || 'Unhandled promise rejection');
    setTimeout(() => {
      const login = document.getElementById('loginView');
      const app = document.getElementById('appView');
      if (!visible(login) && !visible(app)) showRecovery(lastError);
    }, 0);
  });

  ensureBasePaint();
  installLoginFallback();
  void syncAuthView();

  document.addEventListener('DOMContentLoaded', () => {
    ensureBasePaint();
    installLoginFallback();
    void syncAuthView();

    setTimeout(async () => {
      const authenticated = await syncAuthView();
      if (authenticated) return;
      const currentLogin = document.getElementById('loginView');
      const currentApp = document.getElementById('appView');
      if (!visible(currentLogin) && !visible(currentApp)) {
        showRecovery(lastError || `No controller view became visible within ${Math.round((Date.now() - STARTED_AT) / 1000)} seconds`);
      }
    }, WATCHDOG_MS);
  }, { once: true });
})();
