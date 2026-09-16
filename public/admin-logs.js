(() => {
  let entries = [];
  let loading = false;

  const $ = (selector) => document.querySelector(selector);

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function typeClass(type) {
    return String(type || 'OTHER').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function localTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '—');
    return date.toLocaleString([], {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function isAdminCameraEvent(entry) {
    const type = String(entry?.type || '').toUpperCase();
    if (type === 'ADMIN CAMERA') return true;

    const haystack = [
      entry?.log_class,
      entry?.raw_message,
      entry?.message
    ].filter(Boolean).join(' ').toLowerCase();

    return haystack.includes('admincamera') ||
      haystack.includes('admin camera') ||
      haystack.includes('entered admin camera') ||
      haystack.includes('left admin camera');
  }

  function summary(entry) {
    const t = entry.type || 'OTHER';
    switch (t) {
      case 'CONNECT':
        return `${entry.player_name || 'Unknown player'} connected`;
      case 'DISCONNECT':
        return `${entry.player_name || 'Unknown player'} disconnected`;
      case 'KILL':
        return `${entry.instigator_name || 'Unknown'} killed ${entry.victim_name || 'Unknown'}${entry.weapon_id ? ` with ${entry.weapon_id}` : ''}`;
      case 'TEAM KILL':
        return `${entry.instigator_name || 'Unknown'} TEAMKILLED ${entry.victim_name || 'Unknown'}${entry.weapon_id ? ` with ${entry.weapon_id}` : ''}`;
      case 'CHAT':
        return `[${entry.channel || 'Chat'}] ${entry.player_name || 'Unknown'}: ${entry.message || ''}`;
      case 'MESSAGE':
        return `Server message to ${entry.player_name || 'player'}: ${entry.message || ''}`;
      case 'KICK':
        return `${entry.player_name || 'Player'} was kicked${entry.reason ? ` — ${entry.reason}` : ''}`;
      case 'BAN':
        return `${entry.player_name || 'Player'} was banned${entry.reason ? ` — ${entry.reason}` : ''}`;
      case 'TEAM SWITCH':
        return `${entry.player_name || 'Player'} switched ${entry.old_team_name || 'None'} → ${entry.new_team_name || 'None'}`;
      case 'MATCH START':
        return `Match started: ${entry.map_name || ''} ${entry.game_mode_id || ''}`.trim();
      case 'MATCH END':
        return `Match ended: ${entry.map_name || ''} — Allies ${entry.allied_score ?? '?'} / Axis ${entry.axis_score ?? '?'}`;
      case 'VOTE KICK':
        return entry.raw_message || t;
      default:
        return entry.raw_message || entry.message || entry.log_class || 'Admin log event';
    }
  }

  function setSubtab(view) {
    const normal = $('#adminLogNormalPane');
    const teamkill = $('#adminLogTeamkillPane');
    if (!normal || !teamkill) return;

    const target = view === 'teamkill' ? 'teamkill' : 'normal';
    normal.hidden = target !== 'normal';
    teamkill.hidden = target !== 'teamkill';

    document.querySelectorAll('.admin-log-subtab').forEach((button) => {
      const active = button.dataset.adminLogSubtab === target;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });

    try { sessionStorage.setItem('hll-admin-log-subtab', target); } catch {}
  }

  function install() {
    const raw = $('#logsBox');
    if (!raw || $('#adminLogsViewer')) return;

    raw.style.display = 'none';

    const viewer = document.createElement('div');
    viewer.id = 'adminLogsViewer';
    viewer.className = 'admin-log-viewer';
    viewer.innerHTML = `
      <div class="admin-log-subtabs" role="tablist" aria-label="Admin log views">
        <button type="button" class="admin-log-subtab active" data-admin-log-subtab="normal" role="tab" aria-selected="true">
          <span class="admin-log-subtab-title">Admin Logs</span>
          <span class="admin-log-subtab-note">All server and moderation events</span>
        </button>
        <button type="button" class="admin-log-subtab" data-admin-log-subtab="teamkill" role="tab" aria-selected="false" tabindex="-1">
          <span class="admin-log-subtab-title">Teamkill Watch</span>
          <span class="admin-log-subtab-note">Repeat teamkills and commander abilities</span>
        </button>
      </div>

      <div id="adminLogNormalPane" class="admin-log-subpane">
        <div class="admin-log-toolbar">
          <input id="adminLogSearch" type="search" placeholder="Search player, weapon, message..." autocomplete="off" />
          <select id="adminLogType">
            <option value="ALL">All events</option>
            <option value="CONNECT">Connect</option>
            <option value="DISCONNECT">Disconnect</option>
            <option value="KILL">Kills</option>
            <option value="TEAM KILL">Teamkills</option>
            <option value="CHAT">Chat</option>
            <option value="MESSAGE">Server messages</option>
            <option value="KICK">Kicks</option>
            <option value="BAN">Bans</option>
            <option value="TEAM SWITCH">Team switches</option>
            <option value="MATCH START">Match start</option>
            <option value="MATCH END">Match end</option>
            <option value="VOTE KICK">Vote kicks</option>
            <option value="OTHER">Other</option>
          </select>
          <label class="admin-log-auto"><input id="adminLogAuto" type="checkbox" checked /> Live refresh</label>
          <span id="adminLogCount" class="muted"></span>
        </div>
        <div id="adminLogRows" class="admin-log-rows">
          <div class="admin-log-empty">Open Admin Logs to load events.</div>
        </div>
      </div>

      <div id="adminLogTeamkillPane" class="admin-log-subpane admin-log-teamkill-pane" hidden>
        <div class="admin-log-teamkill-empty">Loading Teamkill Watch tools…</div>
      </div>`;
    raw.insertAdjacentElement('afterend', viewer);

    $('#adminLogSearch').addEventListener('input', render);
    $('#adminLogType').addEventListener('change', render);
    $('#logRange')?.addEventListener('change', load);

    document.querySelectorAll('.admin-log-subtab').forEach((button) => {
      button.addEventListener('click', () => setSubtab(button.dataset.adminLogSubtab));
    });

    let initial = 'normal';
    try {
      if (sessionStorage.getItem('hll-admin-log-subtab') === 'teamkill') initial = 'teamkill';
    } catch {}
    setSubtab(initial);

    const nav = document.querySelector('[data-view="logs"]');
    nav?.addEventListener('click', () => setTimeout(load, 0));

    const refresh = document.querySelector('[data-refresh="logs"]');
    refresh?.addEventListener('click', () => setTimeout(load, 0));

    setInterval(() => {
      const logsView = $('#logs');
      if ($('#adminLogAuto')?.checked && logsView?.classList.contains('active')) load();
    }, 5000);
  }

  async function load() {
    if (loading) return;
    const rows = $('#adminLogRows');
    if (!rows) return;
    loading = true;
    rows.classList.add('loading');
    try {
      const seconds = $('#logRange')?.value || '3600';
      const response = await fetch(`/api/v2/logs?seconds=${encodeURIComponent(seconds)}`, {
        credentials: 'include',
        cache: 'no-store'
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok) throw new Error(data?.error || data?.detail || text || `${response.status} ${response.statusText}`);
      entries = (Array.isArray(data?.entries) ? data.entries : []).filter(entry => !isAdminCameraEvent(entry));
      entries.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      render();
    } catch (error) {
      rows.innerHTML = `<div class="admin-log-empty error">${esc(error.message || error)}</div>`;
      $('#adminLogCount').textContent = '';
    } finally {
      rows.classList.remove('loading');
      loading = false;
    }
  }

  function render() {
    const rows = $('#adminLogRows');
    if (!rows) return;
    const query = ($('#adminLogSearch')?.value || '').trim().toLowerCase();
    const type = $('#adminLogType')?.value || 'ALL';

    const filtered = entries.filter((entry) => {
      if (isAdminCameraEvent(entry)) return false;
      if (type !== 'ALL' && String(entry.type || 'OTHER') !== type) return false;
      if (!query) return true;
      return JSON.stringify(entry).toLowerCase().includes(query);
    });

    $('#adminLogCount').textContent = `${filtered.length} / ${entries.length} events`;
    if (!filtered.length) {
      rows.innerHTML = '<div class="admin-log-empty">No matching admin log events.</div>';
      return;
    }

    rows.innerHTML = filtered.map((entry) => {
      const eventType = entry.type || 'OTHER';
      const raw = entry.raw_message || '';
      const friendly = summary(entry);
      const details = Object.entries(entry)
        .filter(([key, value]) => !['timestamp', 'type', 'raw_message', 'log_class'].includes(key) && value !== null && value !== undefined && value !== '')
        .map(([key, value]) => `<span><b>${esc(key.replaceAll('_', ' '))}:</b> ${esc(value)}</span>`)
        .join('');
      return `
        <article class="admin-log-row log-${typeClass(eventType)}">
          <div class="admin-log-meta">
            <span class="admin-log-badge">${esc(eventType)}</span>
            <time>${esc(localTime(entry.timestamp))}</time>
          </div>
          <div class="admin-log-summary">${esc(friendly)}</div>
          ${details ? `<div class="admin-log-details">${details}</div>` : ''}
          ${raw && raw !== friendly ? `<details><summary>Raw event</summary><code>${esc(raw)}</code></details>` : ''}
        </article>`;
    }).join('');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
