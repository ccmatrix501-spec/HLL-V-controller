(() => {
  let loading = false;
  let lastData = [];
  let permanentBanIds = new Set();
  let permanentBanNames = new Set();
  let permanentBanReady = false;

  const $ = (selector) => document.querySelector(selector);

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function localTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '—');
    return date.toLocaleString([], {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function commanderAbilityText(entry) {
    return [entry?.weapon_id, entry?.weapon_name, entry?.raw_message]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replaceAll('_', ' ')
      .replaceAll('-', ' ');
  }

  function isCommanderAbility(entry) {
    const text = commanderAbilityText(entry);
    const patterns = [
      'napalm',
      'bombing run',
      'bombingrun',
      'precision strike',
      'precisionstrike',
      'strafing run',
      'strafingrun',
      'air strike',
      'airstrike',
      'commander ability',
      'commander bombing',
      'rocket barrage',
      'katyusha barrage'
    ];
    return patterns.some((pattern) => text.includes(pattern));
  }

  function isTeamkill(entry) {
    return String(entry?.type || '').toUpperCase() === 'TEAM KILL';
  }

  function attackerId(entry) {
    return String(entry?.instigator_id || entry?.player_id || '').trim();
  }

  function attackerName(entry) {
    return String(entry?.instigator_name || entry?.player_name || attackerId(entry) || 'Unknown player').trim();
  }

  function victimName(entry) {
    return String(entry?.victim_name || entry?.victim_id || 'Unknown').trim();
  }

  function weaponName(entry) {
    return String(entry?.weapon_id || entry?.weapon_name || 'Unknown weapon / vehicle').trim();
  }

  function normalizeId(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function banListFrom(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of ['banList', 'bans', 'items', 'data']) {
      if (Array.isArray(data[key])) return data[key];
    }
    return [];
  }

  async function loadPermanentBans() {
    try {
      const response = await fetch('/api/v2/bans?type=perma', {
        credentials: 'include',
        cache: 'no-store'
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok) throw new Error(data?.error || data?.detail || text || `${response.status} ${response.statusText}`);

      const ids = new Set();
      const names = new Set();
      for (const record of banListFrom(data)) {
        const id = normalizeId(record?.userId || record?.player_id || record?.playerId || record?.id || record?.ID);
        const name = normalizeName(record?.userName || record?.username || record?.player_name || record?.playerName || record?.name);
        if (id) ids.add(id);
        if (name) names.add(name);
      }
      permanentBanIds = ids;
      permanentBanNames = names;
      permanentBanReady = true;
      return true;
    } catch (error) {
      permanentBanReady = false;
      console.warn(`Could not load permanent bans for Teamkill Watch: ${error?.message || error}`);
      return false;
    }
  }

  function isPermanentlyBanned(id, name = '') {
    const normalizedId = normalizeId(id);
    const normalizedName = normalizeName(name);
    return Boolean(
      (normalizedId && permanentBanIds.has(normalizedId)) ||
      (normalizedName && permanentBanNames.has(normalizedName))
    );
  }

  function groupTeamkills(entries, includeCommander, minimum) {
    const groups = new Map();
    const excludedPermanentPlayers = new Set();
    let excludedCommander = 0;
    let qualifyingEvents = 0;

    for (const entry of entries) {
      if (!isTeamkill(entry)) continue;

      const id = attackerId(entry);
      const name = attackerName(entry);
      if (permanentBanReady && isPermanentlyBanned(id, name)) {
        excludedPermanentPlayers.add(normalizeId(id) || `name:${normalizeName(name)}`);
        continue;
      }

      if (!includeCommander && isCommanderAbility(entry)) {
        excludedCommander += 1;
        continue;
      }

      qualifyingEvents += 1;
      const key = id || `name:${name.toLowerCase()}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          id,
          name,
          count: 0,
          weapons: new Map(),
          victims: new Map(),
          firstAt: entry.timestamp || null,
          lastAt: entry.timestamp || null,
          events: []
        });
      }

      const group = groups.get(key);
      group.count += 1;
      group.name = name || group.name;
      if (id) group.id = id;
      group.events.push(entry);

      const weapon = weaponName(entry);
      group.weapons.set(weapon, (group.weapons.get(weapon) || 0) + 1);
      const victim = victimName(entry);
      group.victims.set(victim, (group.victims.get(victim) || 0) + 1);

      const when = new Date(entry.timestamp || 0).getTime();
      const first = new Date(group.firstAt || 0).getTime();
      const last = new Date(group.lastAt || 0).getTime();
      if (!group.firstAt || when < first) group.firstAt = entry.timestamp;
      if (!group.lastAt || when > last) group.lastAt = entry.timestamp;
    }

    const repeaters = [...groups.values()]
      .filter((group) => group.count >= minimum)
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
      });

    return {
      repeaters,
      excludedCommander,
      qualifyingEvents,
      excludedPermanentPlayers: excludedPermanentPlayers.size
    };
  }

  function breakdown(map, limit = 6) {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name, count]) => `${name} ×${count}`)
      .join(' • ');
  }

  function ensureStylesheet() {
    if (document.querySelector('link[href="/teamkill-details.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/teamkill-details.css';
    document.head.appendChild(link);
  }

  function commanderCardIdentity(card) {
    const id = String(card?.querySelector('.cmdtk-id')?.textContent || '').trim();
    const title = String(card?.querySelector('.cmdtk-name')?.textContent || '').trim();
    const name = title.includes(' — ') ? title.split(' — ')[0].trim() : title;
    return { id, name };
  }

  function applyPermanentBanGuard() {
    const panel = $('#commanderTkWatch');
    if (!panel) return;

    let hidden = 0;
    const cards = [...panel.querySelectorAll('.cmdtk-card')];
    for (const card of cards) {
      const identity = commanderCardIdentity(card);
      const banned = permanentBanReady && isPermanentlyBanned(identity.id, identity.name);
      if (banned) {
        card.hidden = true;
        card.dataset.permanentBanHidden = 'true';
        hidden += 1;
      } else if (card.dataset.permanentBanHidden === 'true') {
        card.hidden = false;
        delete card.dataset.permanentBanHidden;
      }

      const actions = card.querySelectorAll('.cmdtk-policy-warn, .cmdtk-policy-kick, .cmdtk-policy-ban');
      for (const button of actions) {
        if (!permanentBanReady) {
          button.disabled = true;
          button.title = 'Permanent ban list is not available yet.';
        } else if (banned) {
          button.disabled = true;
          button.title = 'Player is permanently banned.';
        } else if (identity.id) {
          button.disabled = false;
          button.removeAttribute('title');
        }
      }
    }

    let note = panel.querySelector('#commanderPermabanNote');
    if (!note) {
      note = document.createElement('div');
      note.id = 'commanderPermabanNote';
      note.className = 'cmdtk-permaban-note muted';
      panel.querySelector('#commanderTkSummary')?.insertAdjacentElement('afterend', note);
    }

    if (!permanentBanReady) {
      note.textContent = 'Permanent-ban list unavailable — warning/kick/ban actions are disabled until it can be checked.';
      note.hidden = false;
    } else if (hidden > 0) {
      note.textContent = `${hidden} permanently banned commander incident${hidden === 1 ? '' : 's'} hidden from moderation actions.`;
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  function teamkillViewVisible() {
    const logsView = $('#logs');
    const pane = $('#adminLogTeamkillPane');
    return !document.hidden && Boolean(logsView?.classList.contains('active') && pane && !pane.hidden);
  }

  function install() {
    const viewer = $('#adminLogsViewer');
    const rows = $('#adminLogRows');
    const teamkillPane = $('#adminLogTeamkillPane');
    if (!viewer || !rows || $('#teamkillWatch')) return false;

    ensureStylesheet();
    const panel = document.createElement('section');
    panel.id = 'teamkillWatch';
    panel.className = 'tk-watch';
    panel.innerHTML = `
      <div class="tk-watch-head">
        <div>
          <div class="eyebrow">TEAMKILL WATCH</div>
          <h4>Repeat Teamkillers</h4>
          <div class="muted">Each player is collapsed into one card. Click a player to view their individual teamkill logs. Commander call-ins are ignored by default.</div>
        </div>
        <div class="tk-watch-controls">
          <label>Minimum <select id="tkMinimum"><option value="2" selected>2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select> TKs</label>
          <label><input id="tkIncludeCommander" type="checkbox" /> Include commander abilities</label>
          <div class="action-row">
          <button id="tkCommanderReview" type="button" class="btn ghost small">Load Commander Review</button>
          <button id="tkRefresh" type="button" class="btn ghost small">Refresh</button>
        </div>
        </div>
      </div>
      <div id="tkWatchSummary" class="tk-watch-summary muted">Loading teamkill history…</div>
      <div id="tkWatchList" class="tk-watch-list"><div class="tk-empty">Loading…</div></div>`;

    if (teamkillPane) {
      teamkillPane.querySelector('.admin-log-teamkill-empty')?.remove();
      teamkillPane.appendChild(panel);
    } else {
      rows.insertAdjacentElement('beforebegin', panel);
    }

    $('#tkMinimum')?.addEventListener('change', render);
    $('#tkIncludeCommander')?.addEventListener('change', render);
    $('#tkRefresh')?.addEventListener('click', () => { void load(); });
    $('#tkCommanderReview')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = 'Loading Commander Review…';
      try {
        for (const src of ['/commander-teamkill-review.js','/commander-tempban-policy.js']) {
          if (!document.querySelector(`script[src="${src}"]`)) {
            await new Promise((resolve, reject) => {
              const script = document.createElement('script');
              script.src = src;
              script.async = false;
              script.onload = resolve;
              script.onerror = () => reject(new Error(`Failed to load ${src}`));
              document.head.appendChild(script);
            });
          }
        }
        button.textContent = 'Commander Review Loaded';
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Load Commander Review';
        alert(error?.message || String(error));
      }
    });
    $('#logRange')?.addEventListener('change', () => {
      if (teamkillViewVisible()) void load();
    });

    const nav = document.querySelector('[data-view="logs"]');
    nav?.addEventListener('click', () => setTimeout(() => {
      if (teamkillViewVisible()) void load();
    }, 50));
    document.querySelector('.admin-log-subtab[data-admin-log-subtab="teamkill"]')
      ?.addEventListener('click', () => setTimeout(() => {
        if (teamkillViewVisible()) void load();
      }, 60));

    const root = teamkillPane || viewer;
    const observer = new MutationObserver(() => applyPermanentBanGuard());
    observer.observe(root, { childList: true, subtree: true });

    if (teamkillViewVisible()) void load();
    document.addEventListener('visibilitychange', () => {
      if (teamkillViewVisible()) void load();
    });
    return true;
  }

  async function load() {
    if (loading || !$('#teamkillWatch') || !teamkillViewVisible()) return;
    loading = true;
    try {
      const seconds = $('#logRange')?.value || '3600';
      const [logResult] = await Promise.all([
        fetch(`/api/v2/logs?seconds=${encodeURIComponent(seconds)}`, {
          credentials: 'include',
          cache: 'no-store'
        }),
        loadPermanentBans()
      ]);

      const text = await logResult.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!logResult.ok) throw new Error(data?.error || data?.detail || text || `${logResult.status} ${logResult.statusText}`);
      lastData = Array.isArray(data?.entries) ? data.entries : [];
      render();
      applyPermanentBanGuard();
    } catch (error) {
      $('#tkWatchList').innerHTML = `<div class="tk-empty">${esc(error.message || error)}</div>`;
      $('#tkWatchSummary').textContent = 'Could not load teamkill history.';
      applyPermanentBanGuard();
    } finally {
      loading = false;
    }
  }

  function render() {
    const list = $('#tkWatchList');
    const summary = $('#tkWatchSummary');
    if (!list || !summary) return;

    const minimum = Number($('#tkMinimum')?.value || 2);
    const includeCommander = Boolean($('#tkIncludeCommander')?.checked);
    const result = groupTeamkills(lastData, includeCommander, minimum);

    const permanentText = permanentBanReady
      ? ` • ${result.excludedPermanentPlayers} permanently banned player${result.excludedPermanentPlayers === 1 ? '' : 's'} hidden`
      : ' • permanent-ban list unavailable';

    summary.textContent = includeCommander
      ? `${result.qualifyingEvents} teamkill events analysed • ${result.repeaters.length} player(s) with ${minimum}+ teamkills${permanentText}.`
      : `${result.qualifyingEvents} non-commander teamkill events analysed • ${result.repeaters.length} player(s) with ${minimum}+ teamkills • ${result.excludedCommander} commander-ability teamkill(s) excluded${permanentText}.`;

    if (!result.repeaters.length) {
      list.innerHTML = `<div class="tk-empty">No players have ${minimum} or more matching teamkills in the selected log period.</div>`;
      return;
    }

    list.innerHTML = result.repeaters.map((group) => {
      const weapons = breakdown(group.weapons) || 'Unknown';
      const victims = breakdown(group.victims) || 'Unknown';
      const events = [...group.events].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

      return `
        <details class="tk-card tk-card-detail">
          <summary class="tk-card-summary">
            <div class="tk-card-player">
              <div class="tk-name">${esc(group.name)}</div>
              ${group.id ? `<div class="tk-id">${esc(group.id)}</div>` : ''}
            </div>
            <div class="tk-card-summary-right">
              <span class="tk-count">${group.count} TEAMKILLS</span>
              <span class="tk-card-latest">Latest ${esc(localTime(group.lastAt))}</span>
              <span class="tk-card-chevron" aria-hidden="true">⌄</span>
            </div>
          </summary>
          <div class="tk-card-body">
            <div class="tk-line"><span class="tk-label">Weapons / vehicles:</span> ${esc(weapons)}</div>
            <div class="tk-line"><span class="tk-label">Victims:</span> ${esc(victims)}</div>
            <div class="tk-times">First: ${esc(localTime(group.firstAt))} • Latest: ${esc(localTime(group.lastAt))}</div>
            <div class="tk-event-grid">
              ${events.map((entry, index) => {
                const raw = String(entry?.raw_message || '').trim();
                return `
                  <article class="tk-event-card">
                    <div class="tk-event-top">
                      <span><strong>${esc(victimName(entry))}</strong></span>
                      <time>${esc(localTime(entry.timestamp))}</time>
                    </div>
                    <div class="tk-event-weapon">${esc(weaponName(entry))}</div>
                    ${entry?.victim_id ? `<div class="tk-event-id">Victim ID: ${esc(entry.victim_id)}</div>` : ''}
                    ${raw ? `<details class="tk-event-raw"><summary>Raw teamkill log ${index + 1}</summary><code data-raw="${esc(raw)}">Open to inspect raw event</code></details>` : ''}
                  </article>`;
              }).join('')}
            </div>
          </div>
        </details>`;
    }).join('');
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('.cmdtk-policy-warn, .cmdtk-policy-kick, .cmdtk-policy-ban');
    if (!button) return;

    if (!permanentBanReady) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await loadPermanentBans();
      applyPermanentBanGuard();
      alert('Permanent-ban status was refreshed. Please click the action again.');
      return;
    }

    const card = button.closest('.cmdtk-card');
    const identity = commanderCardIdentity(card);
    if (isPermanentlyBanned(identity.id, identity.name)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      alert(`${identity.name || 'This player'} is already permanently banned. No warning or moderation action will be sent from Teamkill Watch.`);
    }
  }, true);

  function waitForViewer() {
    if (install()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts > 100) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitForViewer, { once: true });
  else waitForViewer();
})();