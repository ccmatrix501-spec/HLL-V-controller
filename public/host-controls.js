(() => {
  const $ = s => document.querySelector(s);

  async function req(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const error = data?.error || data?.detail || `${res.status} ${res.statusText}`;
      throw new Error(typeof error === 'string' ? error : JSON.stringify(error));
    }
    return data;
  }

  function setMessage(text, error = false) {
    const el = $('#hostControlMessage');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('host-control-error', error);
  }

  async function runAction(action) {
    const word = action === 'restart' ? 'RESTART' : 'STOP';
    const label = action === 'restart' ? 'restart the HLL:V server' : 'stop the HLL:V server';
    const typed = window.prompt(`This is a host-level command.\n\nType ${word} to ${label}.`);
    if (typed !== word) {
      if (typed !== null) setMessage(`${action === 'restart' ? 'Restart' : 'Stop'} cancelled — confirmation did not match.`, true);
      return;
    }

    const button = action === 'restart' ? $('#restartServerBtn') : $('#stopServerBtn');
    const old = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = action === 'restart' ? 'Restarting…' : 'Stopping…';
    }
    setMessage(`Sending ${action} command to Qonzer qPanel…`);

    try {
      await req(`/controller/host-control/${action}`, {
        method: 'POST',
        body: JSON.stringify({ confirm: word })
      });
      if (action === 'restart') {
        setMessage('Restart command accepted by qPanel. The game server may be unavailable for a short time while it reboots.');
      } else {
        setMessage('Stop command accepted by qPanel. The game server is being stopped.');
      }
    } catch (err) {
      setMessage(err.message, true);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = old;
      }
    }
  }

  async function install() {
    const panel = [...document.querySelectorAll('.panel')].find(el => el.querySelector('h3')?.textContent?.trim() === 'Host-level controls');
    if (!panel || $('#hostControlPanelReady')) return;

    panel.id = 'hostControlPanelReady';
    panel.classList.add('host-control-panel');
    panel.innerHTML = `
      <div class="panel-head">
        <div>
          <p class="eyebrow">HOST CONTROL</p>
          <h3>Server Power</h3>
        </div>
        <span id="hostControlStatus" class="host-control-status">Checking qPanel…</span>
      </div>
      <p class="muted">Restart and stop are host-level Qonzer actions, separate from HLL:V RCON.</p>
      <div class="host-control-actions">
        <button id="restartServerBtn" class="btn primary" type="button">Restart Server</button>
        <button id="stopServerBtn" class="btn danger" type="button">Stop Server</button>
        <button id="openQpanelHostBtn" class="btn ghost" type="button">Open qPanel</button>
      </div>
      <p id="hostControlMessage" class="host-control-message">Loading host-control configuration…</p>`;

    $('#restartServerBtn').addEventListener('click', () => runAction('restart'));
    $('#stopServerBtn').addEventListener('click', () => runAction('stop'));

    let status;
    try {
      status = await req('/controller/host-control/status');
    } catch (err) {
      $('#hostControlStatus').textContent = 'Unavailable';
      $('#restartServerBtn').disabled = true;
      $('#stopServerBtn').disabled = true;
      setMessage(err.message, true);
      return;
    }

    $('#openQpanelHostBtn').addEventListener('click', () => {
      window.open(status.qpanel_url || 'https://qp.qonzer.com/', '_blank', 'noopener');
    });

    $('#restartServerBtn').disabled = !status.restart_configured;
    $('#stopServerBtn').disabled = !status.stop_configured;

    if (status.restart_configured && status.stop_configured) {
      $('#hostControlStatus').textContent = 'Ready';
      setMessage('Restart and Stop are connected to Qonzer qPanel.');
    } else {
      $('#hostControlStatus').textContent = 'Needs qPanel link';
      const missing = [
        !status.restart_configured ? 'Restart' : '',
        !status.stop_configured ? 'Stop' : ''
      ].filter(Boolean).join(' and ');
      setMessage(`${missing} still needs the matching qPanel action request configured in Railway.`);
    }
  }

  window.addEventListener('load', () => setTimeout(install, 0));
})();
