(() => {
  'use strict';

  const LOGIN_TIMEOUT_MS = 12000;
  const STATUS_TIMEOUT_MS = 8000;

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
      if (body !== undefined && body !== null) {
        xhr.setRequestHeader('Content-Type', 'application/json');
      }

      xhr.onload = () => {
        let data = null;
        try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; }
        catch { data = xhr.responseText; }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
          return;
        }

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

  async function syncStatus() {
    try {
      const status = await xhrJson('GET', `/controller/status?_=${Date.now()}`, null, STATUS_TIMEOUT_MS);
      const authenticated = Boolean(status && status.authenticated);
      setView(authenticated);
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

        // Verify that the browser retained the session cookie before changing view.
        const authenticated = await syncStatus();
        if (!authenticated) {
          throw new Error('Login was accepted but the browser did not retain the controller session.');
        }

        // Use a clean navigation after authentication. This deliberately avoids
        // relying on any of the larger dashboard JavaScript bundles to complete
        // the login transition.
        window.location.replace(`/?logged_in=${Date.now()}`);
      } catch (err) {
        if (error) error.textContent = err && err.message ? err.message : 'Login failed.';
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  // Reinstall after BFCache restores/navigation oddities.
  window.addEventListener('pageshow', () => {
    installLogin();
    void syncStatus();
  });

  window.__HLLVSafeBoot = {
    version: '3.0.0-xhr',
    retry: syncStatus,
    status() {
      return {
        authenticated: document.documentElement.dataset.controllerAuthenticated === '1'
      };
    }
  };
})();
