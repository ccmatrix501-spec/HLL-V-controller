(() => {
  const $ = (selector) => document.querySelector(selector);

  async function postBroadcast() {
    const button = $('#leaderBroadcastMatch');
    const status = $('#leaderBroadcastStatus');
    if (!button) return;

    if (!window.confirm('Broadcast the current-match Top 5 US and Top 5 NVA leaderboard to every connected player?')) {
      return;
    }

    button.disabled = true;
    if (status) status.textContent = 'Broadcasting current match leaderboard…';

    try {
      const response = await fetch('/api/v2/leaderboard/broadcast', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok) {
        throw new Error(data?.detail || data?.error || text || `${response.status} ${response.statusText}`);
      }

      const sent = Number(data?.sent || 0);
      const failed = Number(data?.failed || 0);
      if (status) {
        status.textContent = failed
          ? `Sent to ${sent} player${sent === 1 ? '' : 's'}; ${failed} delivery failure${failed === 1 ? '' : 's'}.`
          : `Sent to ${sent} player${sent === 1 ? '' : 's'}.`;
      }
    } catch (error) {
      if (status) status.textContent = error?.message || 'Could not broadcast the leaderboard.';
    } finally {
      button.disabled = false;
    }
  }

  function install() {
    const tryInstall = () => {
      const view = $('#leaderboard');
      const intro = view?.querySelector('.leaderboard-intro');
      if (!view || !intro) {
        setTimeout(tryInstall, 50);
        return;
      }
      if ($('#leaderBroadcastMatch')) return;

      const panel = document.createElement('div');
      panel.className = 'leaderboard-command-help';
      panel.innerHTML = `
        <strong>Current match broadcast</strong>
        <span class="muted">Top 5 US + Top 5 NVA, ranked by kills.</span>
        <button id="leaderBroadcastMatch" class="btn primary small" type="button">Broadcast Match Leaderboard</button>
        <small id="leaderBroadcastStatus" class="muted">The !leaderboard command sends this same board to everyone.</small>`;
      intro.appendChild(panel);

      $('#leaderBroadcastMatch')?.addEventListener('click', postBroadcast);
    };

    tryInstall();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
