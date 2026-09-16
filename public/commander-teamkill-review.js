(() => {
  let loading = false;
  let events = [];

  const $ = (selector) => document.querySelector(selector);
  const INCIDENT_WINDOW_MS = 60 * 1000;

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

  function eventText(entry) {
    return [entry?.weapon_id, entry?.weapon_name, entry?.raw_message]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replaceAll('_', ' ')
      .replaceAll('-', ' ');
  }

  function abilityName(entry) {
    const text = eventText(entry);
    const checks = [
      ['napalm', 'Napalm / Area Denial'],
      ['precision strike', 'Precision / Concentrated Strike'],
      ['precisionstrike', 'Precision / Concentrated Strike'],
      ['concentrated strike', 'Precision / Concentrated Strike'],
      ['bombing run', 'Bombing Run'],
      ['bombingrun', 'Bombing Run'],
      ['barrage', 'Barrage / Wide Strike'],
      ['rocket barrage', 'Barrage / Wide Strike'],
      ['katyusha', 'Barrage / Wide Strike'],
      ['wide strike', 'Barrage / Wide Strike'],
      ['strafing run', 'Strafing Run'],
      ['strafingrun', 'Strafing Run'],
      ['air strike', 'Air Strike'],
      ['airstrike', 'Air Strike']
    ];
    for (const [needle, label] of checks) if (text.includes(needle)) return label;
    return null;
  }

  function isKill(entry) {
    const type = String(entry?.type || '').toUpperCase();
    return type === 'KILL' || type === 'TEAM KILL';
  }

  function isTeamkill(entry) {
    return String(entry?.type || '').toUpperCase() === 'TEAM KILL';
  }

  function attackerId(entry) {
    return String(entry?.instigator_id || entry?.player_id || '').trim();
  }

  function attackerName(entry) {
    return String(entry?.instigator_name || entry?.player_name || attackerId(entry) || 'Unknown commander').trim();
  }

  function victimName(entry) {
    return String(entry?.victim_name || entry?.victim_id || 'Unknown').trim();
  }

  function buildIncidents(source) {
    const abilityKills = source
      .filter(isKill)
      .map((entry) => ({ entry, ability: abilityName(entry) }))
      .filter((item) => item.ability)
      .sort((a, b) => new Date(a.entry.timestamp || 0) - new Date(b.entry.timestamp || 0));

    const incidents = [];
    const open = new Map();

    for (const item of abilityKills) {
      const entry = item.entry;
      const id = attackerId(entry);
      const name = attackerName(entry);
      const ownerKey = id || `name:${name.toLowerCase()}`;
      const key = `${ownerKey}|${item.ability}`;
      const when = new Date(entry.timestamp || 0).getTime();
      let incident = open.get(key);

      if (!incident || !Number.isFinite(when) || when - incident.lastMs > INCIDENT_WINDOW_MS) {
        incident = {
          key: `${key}|${entry.timestamp || incidents.length}`,
          id,
          name,
          ability: item.ability,
          enemyKills: 0,
          teamKills: 0,
          enemies: [],
          friendlies: [],
          firstAt: entry.timestamp || null,
          lastAt: entry.timestamp || null,
          lastMs: when
        };
        incidents.push(incident);
        open.set(key, incident);
      }

      if (id) incident.id = id;
      if (name) incident.name = name;
      incident.lastAt = entry.timestamp || incident.lastAt;
      incident.lastMs = Number.isFinite(when) ? when : incident.lastMs;

      if (isTeamkill(entry)) {
        incident.teamKills += 1;
        incident.friendlies.push(victimName(entry));
      } else {
        incident.enemyKills += 1;
        incident.enemies.push(victimName(entry));
      }
    }

    return incidents
      .filter((incident) => incident.teamKills > 0)
      .sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0));
  }

  // 1st M.I. commander-call-in escalation policy:
  // - 0-4 teamkills => warning that further ability teamkills will result in a kick.
  // - 5-9 teamkills => kick plus warning that 10+ results in a 3-hour temporary ban.
  // - 10+ teamkills => 3-hour temporary ban.
  // Commander-ability teamkills remain separate from normal repeat-teamkill ban logic.
  function decision(incident) {
    if (incident.teamKills >= 10) {
      return {
        tempBan: true,
        kick: false,
        warn: false,
        label: '3H TEMP BAN',
        severity: 'ban',
        reason: `${incident.teamKills} commander-ability teamkills meets the 10+ three-hour temporary-ban threshold`
      };
    }

    if (incident.teamKills >= 5) {
      return {
        tempBan: false,
        kick: true,
        warn: true,
        label: 'KICK + TEMP BAN WARNING',
        severity: 'kick',
        reason: `${incident.teamKills} commander-ability teamkills is within the 5-9 kick threshold; 10+ results in a three-hour temporary ban`
      };
    }

    return {
      tempBan: false,
      kick: false,
      warn: true,
      label: 'KICK WARNING',
      severity: 'warn',
      reason: `${incident.teamKills} commander-ability teamkill${incident.teamKills === 1 ? '' : 's'} — warning issued; 5+ results in a kick`
    };
  }

  function injectStyle() {
    if ($('#commanderTkStyle')) return;
    const style = document.createElement('style');
    style.id = 'commanderTkStyle';
    style.textContent = `
      .cmdtk-watch{margin:0 0 16px;padding:14px;border:1px solid rgba(225,184,76,.38);border-radius:12px;background:rgba(140,110,20,.07)}
      .cmdtk-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:10px}
      .cmdtk-head h4{margin:2px 0 4px}.cmdtk-list{display:grid;gap:9px}.cmdtk-summary{font-size:.86rem;margin:0 0 10px}
      .cmdtk-card{border:1px solid rgba(225,184,76,.28);border-radius:10px;padding:11px 12px;background:rgba(255,255,255,.025)}
      .cmdtk-card.kick{border-color:rgba(220,75,75,.55);background:rgba(120,25,25,.07)}
      .cmdtk-card.warn{border-color:rgba(238,193,73,.58);background:rgba(128,96,18,.09)}
      .cmdtk-card.ban{border-color:rgba(255,70,70,.72);background:rgba(135,15,15,.13)}
      .cmdtk-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.cmdtk-name{font-weight:700}.cmdtk-id{font-family:monospace;font-size:.78rem;opacity:.72;word-break:break-all}
      .cmdtk-badge{font-weight:800;padding:4px 8px;border-radius:999px;font-size:.78rem}.cmdtk-badge.kick{color:#ff9b9b;border:1px solid rgba(255,90,90,.45)}.cmdtk-badge.warn{color:#f3cf70;border:1px solid rgba(235,190,70,.5)}.cmdtk-badge.ban{color:#ff7d7d;border:1px solid rgba(255,70,70,.6)}.cmdtk-badge.ok{color:#9fdfae;border:1px solid rgba(80,190,110,.4)}
      .cmdtk-line{margin-top:6px;font-size:.84rem;line-height:1.4}.cmdtk-label{font-weight:700;opacity:.78}.cmdtk-times{margin-top:6px;font-size:.78rem;opacity:.68}.cmdtk-actions{margin-top:9px;display:flex;gap:8px;flex-wrap:wrap}
      .cmdtk-empty{padding:8px 0;opacity:.72}
    `;
    document.head.appendChild(style);
  }

  async function apiAction(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw new Error(data?.error || data?.detail || text || `${response.status} ${response.statusText}`);
    return data;
  }

  function warningMessage(incident) {
    if (incident.teamKills >= 5) {
      return `[ 1ST M.I. COMMANDER WARNING ]\n\nYour ${incident.ability} caused ${incident.teamKills} teamkills.\nYou are being removed from the server for commander-ability teamkilling.\n10 or more teamkills from one commander ability results in a 3-hour temporary ban.\n\nCheck friendly positions before using commander abilities.`;
    }

    return `[ 1ST M.I. COMMANDER WARNING ]\n\nYour ${incident.ability} caused ${incident.teamKills} teamkill${incident.teamKills === 1 ? '' : 's'}.\nThis is a warning.\n5 or more teamkills from one commander ability results in a kick.\n10 or more results in a 3-hour temporary ban.\n\nCheck friendly positions before using commander abilities.`;
  }

  async function warnPlayer(incident, button) {
    if (!incident.id) {
      alert('This log incident does not include a player ID, so the controller cannot warn them automatically.');
      return;
    }

    if (!confirm(`Send a commander-ability warning to ${incident.name}?\n\n${incident.teamKills} teamkill(s)`)) return;

    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Sending...';
    try {
      await apiAction(`/api/v2/players/${encodeURIComponent(incident.id)}/message`, { message: warningMessage(incident) });
      if (typeof window.toast === 'function') window.toast(`Warning sent to ${incident.name}`);
      else alert(`Warning sent to ${incident.name}.`);
    } catch (error) {
      if (typeof window.toast === 'function') window.toast(error.message, 'error');
      else alert(error.message);
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  async function warnAndKickPlayer(incident, button) {
    if (!incident.id) {
      alert('This log incident does not include a player ID, so the controller cannot warn and kick them automatically.');
      return;
    }

    const reason = `Commander ability teamkilling: ${incident.ability} caused ${incident.teamKills} teamkills (${incident.enemyKills} enemy kills)`;
    if (!confirm(`Warn and kick ${incident.name}?\n\n${incident.teamKills} commander-ability teamkills is within the 5-9 kick threshold.`)) return;

    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Warning & Kicking...';
    try {
      // Send the warning before the kick so the player can see the escalation notice.
      await apiAction(`/api/v2/players/${encodeURIComponent(incident.id)}/message`, { message: warningMessage(incident) });
      await apiAction('/api/v2/kick', { player_id: incident.id, reason });
      if (typeof window.toast === 'function') window.toast(`${incident.name} warned and kicked`);
      else alert(`${incident.name} warned and kicked.`);
    } catch (error) {
      if (typeof window.toast === 'function') window.toast(error.message, 'error');
      else alert(error.message);
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  async function tempBanPlayer(incident, button) {
    if (!incident.id) {
      alert('This log incident does not include a player ID, so the controller cannot temporarily ban them automatically.');
      return;
    }

    const reason = `Commander ability teamkilling: ${incident.ability} caused ${incident.teamKills} teamkills (${incident.enemyKills} enemy kills)`;
    if (!confirm(`Temporarily ban ${incident.name} for 3 hours?\n\n${incident.teamKills} commander-ability teamkills meets the 10+ temporary-ban threshold.\n\n${reason}`)) return;

    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Banning 3 Hours...';
    try {
      await apiAction('/api/v2/temp-ban', {
        player_id: incident.id,
        duration: 3,
        reason,
        admin_name: '1st M.I. Admin'
      });
      if (typeof window.toast === 'function') window.toast(`${incident.name} temporarily banned for 3 hours`);
      else alert(`${incident.name} temporarily banned for 3 hours.`);
    } catch (error) {
      if (typeof window.toast === 'function') window.toast(error.message, 'error');
      else alert(error.message);
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  function install() {
    const existingMonitor = $('#teamkillWatch');
    const rows = $('#adminLogRows');
    if (!rows || $('#commanderTkWatch')) return false;

    injectStyle();
    const panel = document.createElement('section');
    panel.id = 'commanderTkWatch';
    panel.className = 'cmdtk-watch';
    panel.innerHTML = `
      <div class="cmdtk-head">
        <div>
          <div class="eyebrow">COMMANDER ABILITY REVIEW</div>
          <h4>Commander Call-in Teamkills</h4>
          <div class="muted">0-4 ability teamkills = warning of a kick. 5-9 = warning plus kick, with notice that 10+ results in a temporary ban. 10+ = 3-hour temporary ban.</div>
        </div>
        <button id="commanderTkRefresh" type="button" class="btn ghost small">Refresh</button>
      </div>
      <div id="commanderTkSummary" class="cmdtk-summary muted">Loading commander ability incidents…</div>
      <div id="commanderTkList" class="cmdtk-list"><div class="cmdtk-empty">Loading…</div></div>`;

    if (existingMonitor) existingMonitor.insertAdjacentElement('afterend', panel);
    else rows.insertAdjacentElement('beforebegin', panel);

    $('#commanderTkRefresh')?.addEventListener('click', load);
    $('#logRange')?.addEventListener('change', load);
    document.querySelector('[data-view="logs"]')?.addEventListener('click', () => setTimeout(load, 80));
    load();
    return true;
  }

  async function load() {
    if (loading || !$('#commanderTkWatch')) return;
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
      events = Array.isArray(data?.entries) ? data.entries : [];
      render();
    } catch (error) {
      $('#commanderTkSummary').textContent = 'Could not load commander ability incidents.';
      $('#commanderTkList').innerHTML = `<div class="cmdtk-empty">${esc(error.message || error)}</div>`;
    } finally {
      loading = false;
    }
  }

  function render() {
    const summary = $('#commanderTkSummary');
    const list = $('#commanderTkList');
    if (!summary || !list) return;

    const incidents = buildIncidents(events);
    const decisions = incidents.map((incident) => decision(incident));
    const warningCases = decisions.filter((result) => result.warn && !result.kick).length;
    const kickCases = decisions.filter((result) => result.kick).length;
    const tempBanCases = decisions.filter((result) => result.tempBan).length;
    summary.textContent = `${incidents.length} commander incident(s) with friendly kills • ${warningCases} kick-warning case(s) • ${kickCases} warn-and-kick case(s) • ${tempBanCases} three-hour temp-ban case(s).`;

    if (!incidents.length) {
      list.innerHTML = '<div class="cmdtk-empty">No commander-ability teamkill incidents in the selected log period.</div>';
      return;
    }

    list.innerHTML = incidents.map((incident, index) => {
      const result = decision(incident);
      const enemyNames = incident.enemies.slice(0, 6).join(', ') || 'None';
      const friendlyNames = incident.friendlies.slice(0, 6).join(', ') || 'None';

      const policyText = result.tempBan
        ? '10+ ability teamkills — 3-hour temporary-ban threshold reached'
        : result.kick
          ? '5-9 ability teamkills — warning plus kick; 10+ results in a 3-hour temporary ban'
          : '0-4 ability teamkills — warning that 5+ results in a kick';

      const actions = [];
      if (result.tempBan) {
        actions.push(`<button type="button" class="btn danger small cmdtk-tempban" data-index="${index}" ${incident.id ? '' : 'disabled'}>3-Hour Temp Ban</button>`);
      } else if (result.kick) {
        actions.push(`<button type="button" class="btn danger small cmdtk-warnkick" data-index="${index}" ${incident.id ? '' : 'disabled'}>Warn & Kick</button>`);
      } else if (result.warn) {
        actions.push(`<button type="button" class="btn ghost small cmdtk-warn" data-index="${index}" ${incident.id ? '' : 'disabled'}>Send Kick Warning</button>`);
      }

      return `
        <article class="cmdtk-card ${esc(result.severity)}" data-cmdtk-index="${index}">
          <div class="cmdtk-top">
            <div>
              <div class="cmdtk-name">${esc(incident.name)} — ${esc(incident.ability)}</div>
              ${incident.id ? `<div class="cmdtk-id">${esc(incident.id)}</div>` : ''}
            </div>
            <span class="cmdtk-badge ${esc(result.severity)}">${esc(result.label)}</span>
          </div>
          <div class="cmdtk-line"><span class="cmdtk-label">Result:</span> ${incident.enemyKills} enemy kill(s) • ${incident.teamKills} teamkill(s)</div>
          <div class="cmdtk-line"><span class="cmdtk-label">Policy:</span> ${esc(policyText)}</div>
          <div class="cmdtk-line"><span class="cmdtk-label">Enemy victims:</span> ${esc(enemyNames)}</div>
          <div class="cmdtk-line"><span class="cmdtk-label">Friendly victims:</span> ${esc(friendlyNames)}</div>
          <div class="cmdtk-times">${esc(localTime(incident.firstAt))}${incident.lastAt && incident.lastAt !== incident.firstAt ? ` → ${esc(localTime(incident.lastAt))}` : ''}</div>
          ${actions.length ? `<div class="cmdtk-actions">${actions.join('')}</div>` : ''}
        </article>`;
    }).join('');

    list.querySelectorAll('.cmdtk-warn').forEach((button) => {
      button.addEventListener('click', () => {
        const incident = incidents[Number(button.dataset.index)];
        if (incident) warnPlayer(incident, button);
      });
    });

    list.querySelectorAll('.cmdtk-warnkick').forEach((button) => {
      button.addEventListener('click', () => {
        const incident = incidents[Number(button.dataset.index)];
        if (incident) warnAndKickPlayer(incident, button);
      });
    });

    list.querySelectorAll('.cmdtk-tempban').forEach((button) => {
      button.addEventListener('click', () => {
        const incident = incidents[Number(button.dataset.index)];
        if (incident) tempBanPlayer(incident, button);
      });
    });
  }

  function waitForLogs() {
    if (install()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts > 120) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitForLogs, { once: true });
  else waitForLogs();
})();