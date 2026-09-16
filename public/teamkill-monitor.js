(() => {
  let loading = false;
  let lastData = [];

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

  function groupTeamkills(entries, includeCommander, minimum) {
    const groups = new Map();
    let excludedCommander = 0;
    let qualifyingEvents = 0;

    for (const entry of entries) {
      if (!isTeamkill(entry)) continue;
      if (!includeCommander && isCommanderAbility(entry)) {
        excludedCommander += 1;
        continue;
      }

      qualifyingEvents += 1;
      const id = attackerId(entry);
      const name = attackerName(entry);
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

    return { repeaters, excludedCommander, qualifyingEvents };
  }

  function breakdown(map, limit = 6) {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name, count]) => `${name} ×${count}`)
      .join(' • ');
  }

  function injectStyle() {
    if ($('#teamkillMonitorStyle')) return;
    const style = document.createElement('style');
    style.id = 'teamkillMonitorStyle';
    style.textContent = `
      .tk-watch{margin:0 0 16px;padding:14px;border:1px solid rgba(220,75,75,.42);border-radius:12px;background:rgba(120,25,25,.08)}
      .tk-watch-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:10px}
      .tk-watch-head h4{margin:2px 0 4px}.tk-watch-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .tk-watch-controls label{display:flex;gap:6px;align-items:center;font-size:.86rem}.tk-watch-controls select{min-width:64px}
      .tk-watch-summary{font-size:.86rem;margin:0 0 10px}.tk-watch-list{display:grid;gap:9px}
      .tk-card{border:1px solid rgba(220,75,75,.32);border-radius:10px;padding:10px 12px;background:rgba(255,255,255,.025)}
      .tk-card-top{display:flex;justify-content:space-between;gap:12px;align-items:center}.tk-name{font-weight:700}.tk-count{font-weight:800;color:#ff8c8c;white-space:nowrap}
      .tk-id{font-family:monospace;font-size:.78rem;opacity:.75;margin-top:2px;word-break:break-all}.tk-line{font-size:.84rem;margin-top:6px;line-height:1.4}.tk-label{font-weight:700;opacity:.78}
      .tk-times{font-size:.78rem;opacity:.7;margin-top:6px}.tk-empty{padding:8px 0;opacity:.72}
    `;
    document.head.appendChild(style);
  }

  function install() {
    const viewer = $('#adminLogsViewer');
    const rows = $('#adminLogRows');
    const teamkillPane = $('#adminLogTeamkillPane');
    if (!viewer || !rows || $('#teamkillWatch')) return false;

    injectStyle();
    const panel = document.createElement('section');
    panel.id = 'teamkillWatch';
    panel.className = 'tk-watch';
    panel.innerHTML = `
      <div class="tk-watch-head">
        <div>
          <div class="eyebrow">TEAMKILL WATCH</div>
          <h4>Repeat Teamkillers</h4>
          <div class="muted">Groups repeated teamkills by player. Commander call-ins are ignored by default; normal weapons and vehicle kills still count.</div>
        </div>
        <div class="tk-watch-controls">
          <label>Minimum <select id="tkMinimum"><option value="2" selected>2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select> TKs</label>
          <label><input id="tkIncludeCommander" type="checkbox" /> Include commander abilities</label>
          <button id="tkRefresh" type="button" class="btn ghost small">Refresh</button>
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
    $('#tkRefresh')?.addEventListener('click', load);
    $('#logRange')?.addEventListener('change', load);

    const nav = document.querySelector('[data-view="logs"]');
    nav?.addEventListener('click', () => setTimeout(load, 50));
    load();
    return true;
  }

  async function load() {
    if (loading || !$('#teamkillWatch')) return;
    loading = true;
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
      lastData = Array.isArray(data?.entries) ? data.entries : [];
      render();
    } catch (error) {
      $('#tkWatchList').innerHTML = `<div class="tk-empty">${esc(error.message || error)}</div>`;
      $('#tkWatchSummary').textContent = 'Could not load teamkill history.';
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

    summary.textContent = includeCommander
      ? `${result.qualifyingEvents} teamkill events analysed • ${result.repeaters.length} player(s) with ${minimum}+ teamkills.`
      : `${result.qualifyingEvents} non-commander teamkill events analysed • ${result.repeaters.length} player(s) with ${minimum}+ teamkills • ${result.excludedCommander} commander-ability teamkill(s) excluded.`;

    if (!result.repeaters.length) {
      list.innerHTML = `<div class="tk-empty">No players have ${minimum} or more matching teamkills in the selected log period.</div>`;
      return;
    }

    list.innerHTML = result.repeaters.map((group) => {
      const weapons = breakdown(group.weapons) || 'Unknown';
      const victims = breakdown(group.victims) || 'Unknown';
      return `
        <article class="tk-card">
          <div class="tk-card-top">
            <div><div class="tk-name">${esc(group.name)}</div>${group.id ? `<div class="tk-id">${esc(group.id)}</div>` : ''}</div>
            <div class="tk-count">${group.count} TEAMKILLS</div>
          </div>
          <div class="tk-line"><span class="tk-label">Weapons / vehicles:</span> ${esc(weapons)}</div>
          <div class="tk-line"><span class="tk-label">Victims:</span> ${esc(victims)}</div>
          <div class="tk-times">First: ${esc(localTime(group.firstAt))} • Latest: ${esc(localTime(group.lastAt))}</div>
        </article>`;
    }).join('');
  }

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