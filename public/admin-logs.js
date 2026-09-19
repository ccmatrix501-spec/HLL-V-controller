(() => {
  let entries = [];
  let loading = false;
  let backendEntryCount = 0;
  let hiddenAdminCameraCount = 0;
  let enhancedReady = false;

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

    const haystack = [entry?.log_class, entry?.raw_message, entry?.message]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes('admincamera') ||
      haystack.includes('admin camera') ||
      haystack.includes('entered admin camera') ||
      haystack.includes('left admin camera');
  }

  function isTeamkill(entry) {
    return String(entry?.type || '').toUpperCase() === 'TEAM KILL';
  }

  function backendEntriesFrom(data) {
    if (Array.isArray(data)) return data.filter(Boolean);
    if (!data || typeof data !== 'object') return [];
    for (const key of ['entries', 'logs', 'items', 'data', 'result', 'results']) {
      if (Array.isArray(data[key])) return data[key].filter(Boolean);
    }
    return [];
  }

  function rawFallback() {
    return $('#logsBox');
  }

  function showRawFallback(message = '') {
    const raw = rawFallback();
    if (!raw) return;
    raw.style.display = '';
    raw.removeAttribute('aria-hidden');
    raw.dataset.adminLogsFallback = 'visible';
    const current = String(raw.textContent || '').trim();
    if (message && (!current || current === '—' || current === 'Loading Admin Logs…')) {
      raw.textContent = message;
    }
  }

  function hideRawFallback() {
    const raw = rawFallback();
    if (!raw) return;
    raw.style.display = 'none';
    raw.setAttribute('aria-hidden', 'true');
    raw.dataset.adminLogsFallback = 'hidden';
  }

  function summary(entry) {
    const t = entry.type || 'OTHER';
    switch (t) {
      case 'CONNECT': return `${entry.player_name || 'Unknown player'} connected`;
      case 'DISCONNECT': return `${entry.player_name || 'Unknown player'} disconnected`;
      case 'KILL': return `${entry.instigator_name || 'Unknown'} killed ${entry.victim_name || 'Unknown'}${entry.weapon_id ? ` with ${entry.weapon_id}` : ''}`;
      case 'TEAM KILL': return `${entry.instigator_name || 'Unknown'} TEAMKILLED ${entry.victim_name || 'Unknown'}${entry.weapon_id ? ` with ${entry.weapon_id}` : ''}`;
      case 'CHAT': return `[${entry.channel || 'Chat'}] ${entry.player_name || 'Unknown'}: ${entry.message || ''}`;
      case 'MESSAGE': return `Server message to ${entry.player_name || 'player'}: ${entry.message || ''}`;
      case 'KICK': return `${entry.player_name || 'Player'} was kicked${entry.reason ? ` — ${entry.reason}` : ''}`;
      case 'BAN': return `${entry.player_name || 'Player'} was banned${entry.reason ? ` — ${entry.reason}` : ''}`;
      case 'TEAM SWITCH': return `${entry.player_name || 'Player'} switched ${entry.old_team_name || 'None'} → ${entry.new_team_name || 'None'}`;
      case 'MATCH START': return `Match started: ${entry.map_name || ''} ${entry.game_mode_id || ''}`.trim();
      case 'MATCH END': return `Match ended: ${entry.map_name || ''} — Allies ${entry.allied_score ?? '?'} / Axis ${entry.axis_score ?? '?'}`;
      case 'VOTE KICK': return entry.raw_message || t;
      default: return entry.raw_message || entry.message || entry.log_class || 'Admin log event';
    }
  }

  function attackerId(entry) {
    return String(entry?.instigator_id || entry?.player_id || '').trim();
  }

  function attackerName(entry) {
    return String(entry?.instigator_name || entry?.player_name || attackerId(entry) || 'Unknown player').trim();
  }

  function victimName(entry) {
    return String(entry?.victim_name || entry?.victim_id || 'Unknown player').trim();
  }

  function weaponName(entry) {
    return String(entry?.weapon_name || entry?.weapon_id || 'Unknown weapon / vehicle').trim();
  }

  function groupTeamkills(source) {
    const groups = new Map();

    for (const entry of source.filter(isTeamkill)) {
      const id = attackerId(entry);
      const name = attackerName(entry);
      const key = id || `name:${name.toLowerCase()}`;
      let group = groups.get(key);

      if (!group) {
        group = {
          key,
          id,
          name,
          events: [],
          latestAt: entry.timestamp || null,
          firstAt: entry.timestamp || null
        };
        groups.set(key, group);
      }

      group.events.push(entry);
      if (id) group.id = id;
      if (name) group.name = name;

      const when = new Date(entry.timestamp || 0).getTime();
      if (!group.firstAt || when < new Date(group.firstAt || 0).getTime()) group.firstAt = entry.timestamp;
      if (!group.latestAt || when > new Date(group.latestAt || 0).getTime()) group.latestAt = entry.timestamp;
    }

    return [...groups.values()]
      .sort((a, b) => b.events.length - a.events.length || new Date(b.latestAt || 0) - new Date(a.latestAt || 0));
  }

  function renderTeamkillGroups(source) {
    const groups = groupTeamkills(source);
    if (!groups.length) return '<div class="admin-log-empty">No matching teamkill events.</div>';

    return `<div class="admin-tk-groups">${groups.map((group) => {
      const events = [...group.events].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      return `
        <details class="admin-tk-group">
          <summary class="admin-tk-group-summary">
            <div class="admin-tk-group-player">
              <strong>${esc(group.name)}</strong>
              ${group.id ? `<span class="admin-tk-group-id">${esc(group.id)}</span>` : ''}
            </div>
            <div class="admin-tk-group-right">
              <span class="admin-tk-count">${group.events.length} TEAMKILL${group.events.length === 1 ? '' : 'S'}</span>
              <span class="admin-tk-latest">Latest ${esc(localTime(group.latestAt))}</span>
              <span class="admin-tk-chevron" aria-hidden="true">⌄</span>
            </div>
          </summary>
          <div class="admin-tk-event-list">
            ${events.map((entry, index) => {
              const raw = entry.raw_message || '';
              const friendly = summary(entry);
              return `
                <article class="admin-tk-event">
                  <div class="admin-tk-event-top">
                    <span class="admin-tk-victim">Victim: <strong>${esc(victimName(entry))}</strong></span>
                    <time>${esc(localTime(entry.timestamp))}</time>
                  </div>
                  <div class="admin-tk-event-weapon">${esc(weaponName(entry))}</div>
                  ${entry?.victim_id ? `<div class="admin-tk-event-id">Victim ID: ${esc(entry.victim_id)}</div>` : ''}
                  ${raw && raw !== friendly ? `<details class="admin-tk-raw"><summary>Raw teamkill log ${index + 1}</summary><code>${esc(raw)}</code></details>` : ''}
                </article>`;
            }).join('')}
          </div>
        </details>`;
    }).join('')}</div>`;
  }

  function renderEvent(entry) {
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
  }

  function adoptTeamkillPanels() {
    const pane = $('#adminLogTeamkillPane');
    if (!pane) return;

    const repeat = $('#teamkillWatch');
    const commander = $('#commanderTkWatch');

    if (repeat && repeat.parentElement !== pane) pane.appendChild(repeat);
    if (commander && commander.parentElement !== pane) pane.appendChild(commander);

    const placeholder = pane.querySelector('.admin-log-teamkill-empty');
    if (placeholder && (repeat || commander)) placeholder.remove();
  }

  function setSubtab(view) {
    const normal = $('#adminLogNormalPane');
    const teamkill = $('#adminLogTeamkillPane');
    if (!normal || !teamkill) return;

    adoptTeamkillPanels();

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

    // Keep the core app's raw JSON log box visible until this enhanced viewer
    // has completed at least one successful RCON render. If this feature script
    // ever errors or receives an unexpected payload, staff still see the live
    // RCON response instead of a blank Logs page.
    document.documentElement.dataset.adminLogsViewer = 'loading';
    showRawFallback('Loading Admin Logs…');

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
          <span class="admin-log-subtab-note">Repeat TKs and commander abilities</span>
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
            <option value="TEAM KILL">Teamkills (grouped)</option>
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

    const observer = new MutationObserver(() => adoptTeamkillPanels());
    observer.observe(viewer, { childList: true, subtree: true });

    // Always enter the Logs page on the actual Admin Logs pane. Persisting the
    // Teamkill subtab made successful log loads invisible after returning to this view.
    setSubtab('normal');

    const nav = document.querySelector('[data-view="logs"]');
    nav?.addEventListener('click', () => {
      setTimeout(() => {
        setSubtab('normal');
        adoptTeamkillPanels();
        load();
      }, 0);
    });

    const refresh = document.querySelector('[data-refresh="logs"]');
    refresh?.addEventListener('click', () => setTimeout(load, 0));

    setInterval(() => {
      const logsView = $('#logs');
      if ($('#adminLogAuto')?.checked && logsView?.classList.contains('active')) load();
    }, 10000);

    // Covers page restoration/direct activation where there was no fresh nav click.
    if ($('#logs')?.classList.contains('active')) setTimeout(load, 0);
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
      const backendEntries = backendEntriesFrom(data);
      backendEntryCount = Number.isFinite(Number(data?.count)) ? Number(data.count) : backendEntries.length;
      hiddenAdminCameraCount = backendEntries.filter(isAdminCameraEvent).length;
      entries = backendEntries.filter(entry => !isAdminCameraEvent(entry));
      entries.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      render();
      adoptTeamkillPanels();

      // Only retire the raw fallback after the enhanced view has successfully
      // consumed and rendered the backend payload.
      enhancedReady = true;
      hideRawFallback();
      document.documentElement.dataset.adminLogsViewer = 'ready';
      window.__HLLVAdminLogs = {
        ready: true,
        backendEntryCount,
        visibleEntryCount: entries.length,
        hiddenAdminCameraCount,
        loadedAt: Date.now()
      };
    } catch (error) {
      enhancedReady = false;
      document.documentElement.dataset.adminLogsViewer = 'fallback';
      const message = error?.message || String(error);
      rows.innerHTML = `<div class="admin-log-empty error">${esc(message)}</div>`;
      $('#adminLogCount').textContent = 'Enhanced viewer unavailable — raw RCON logs shown below';
      showRawFallback(`Admin Logs viewer error: ${message}`);
      window.__HLLVAdminLogs = {
        ready: false,
        error: message,
        backendEntryCount,
        loadedAt: Date.now()
      };
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

    const mobile = window.matchMedia?.('(max-width: 760px)')?.matches;
    const maxRendered = mobile ? 160 : 600;

    if (type === 'TEAM KILL') {
      const visible = filtered.slice(0, maxRendered);
      const groups = groupTeamkills(visible);
      const capped = filtered.length > visible.length ? ` • newest ${visible.length} rendered` : '';
      $('#adminLogCount').textContent = `${filtered.length} teamkill event${filtered.length === 1 ? '' : 's'} • ${groups.length} player${groups.length === 1 ? '' : 's'}${capped}`;
      rows.classList.add('teamkill-group-mode');
      rows.innerHTML = (filtered.length > visible.length
        ? `<div class="admin-log-empty">Showing the newest ${visible.length} matching events to keep this device responsive. Narrow the time range or search to see older entries.</div>`
        : '') + renderTeamkillGroups(visible);
      return;
    }

    rows.classList.remove('teamkill-group-mode');
    const hiddenNote = hiddenAdminCameraCount ? ` • ${hiddenAdminCameraCount} admin-camera hidden` : '';
    const visible = filtered.slice(0, maxRendered);
    const cappedNote = filtered.length > visible.length ? ` • newest ${visible.length} rendered` : '';
    $('#adminLogCount').textContent = `${filtered.length} matching • ${backendEntryCount} from RCON${hiddenNote}${cappedNote}`;
    if (!filtered.length) {
      rows.innerHTML = backendEntryCount > 0 && hiddenAdminCameraCount >= backendEntryCount
        ? `<div class="admin-log-empty">RCON returned ${backendEntryCount} event${backendEntryCount === 1 ? '' : 's'}, but they are all Admin Camera events and are hidden.</div>`
        : backendEntryCount > 0
          ? `<div class="admin-log-empty">RCON returned ${backendEntryCount} event${backendEntryCount === 1 ? '' : 's'}, but none match the current search/filter.</div>`
          : '<div class="admin-log-empty">RCON returned no events for this time range.</div>';
      return;
    }

    rows.innerHTML = (filtered.length > visible.length
      ? `<div class="admin-log-empty">Showing the newest ${visible.length} matching events to keep this device responsive. Narrow the time range or search to see older entries.</div>`
      : '') + visible.map(renderEvent).join('');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
