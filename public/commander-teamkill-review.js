(() => {
  let loading = false;
  let events = [];
  let permanentBanIds = new Set();
  let permanentBanNames = new Set();
  let permanentBanReady = false;
  let lastCases = [];

  const $ = (selector) => document.querySelector(selector);
  const MIN_MATCH_LOOKBACK_SECONDS = 21600;

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

  function typeOf(entry) {
    return String(entry?.type || '').trim().toUpperCase();
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
      ['rocket barrage', 'Barrage / Wide Strike'],
      ['katyusha barrage', 'Barrage / Wide Strike'],
      ['katyusha', 'Barrage / Wide Strike'],
      ['wide strike', 'Barrage / Wide Strike'],
      ['barrage', 'Barrage / Wide Strike'],
      ['strafing run', 'Strafing Run'],
      ['strafingrun', 'Strafing Run'],
      ['air strike', 'Air Strike'],
      ['airstrike', 'Air Strike']
    ];
    for (const [needle, label] of checks) {
      if (text.includes(needle)) return label;
    }
    return null;
  }

  function isKill(entry) {
    const type = typeOf(entry);
    return type === 'KILL' || type === 'TEAM KILL';
  }

  function isTeamkill(entry) {
    return typeOf(entry) === 'TEAM KILL';
  }

  function isMatchStart(entry) {
    if (typeOf(entry) === 'MATCH START') return true;
    const text = String(entry?.raw_message || entry?.message || '').toLowerCase();
    return text.includes('match started:') || text.includes('match start:');
  }

  function isMatchEnd(entry) {
    if (typeOf(entry) === 'MATCH END') return true;
    const text = String(entry?.raw_message || entry?.message || '').toLowerCase();
    return text.includes('match ended:') || text.includes('match end:');
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
      console.warn(`Could not load permanent bans for Commander Teamkill Review: ${error?.message || error}`);
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

  function mapNameFrom(entry) {
    return String(entry?.map_name || entry?.map || entry?.MapName || '').trim();
  }

  function gameModeFrom(entry) {
    return String(entry?.game_mode_id || entry?.game_mode || entry?.mode || '').trim();
  }

  function makeMatch(entry, index, hasStart) {
    return {
      key: `${hasStart ? 'match' : 'partial'}:${entry?.timestamp || index}:${index}`,
      mapName: mapNameFrom(entry),
      gameMode: gameModeFrom(entry),
      startAt: hasStart ? (entry?.timestamp || null) : null,
      endAt: null,
      hasStart,
      hasEnd: false,
      events: [],
      active: true
    };
  }

  function segmentMatches(source) {
    const sorted = [...source].sort((a, b) => new Date(a?.timestamp || 0) - new Date(b?.timestamp || 0));
    const matches = [];
    let current = null;

    for (let index = 0; index < sorted.length; index += 1) {
      const entry = sorted[index];

      if (isMatchStart(entry)) {
        if (current) {
          current.active = false;
          if (!current.endAt) current.endAt = entry?.timestamp || null;
        }
        current = makeMatch(entry, index, true);
        current.events.push(entry);
        matches.push(current);
        continue;
      }

      if (!current) {
        current = makeMatch(entry, index, false);
        matches.push(current);
      }

      current.events.push(entry);
      if (!current.mapName) current.mapName = mapNameFrom(entry);
      if (!current.gameMode) current.gameMode = gameModeFrom(entry);

      if (isMatchEnd(entry)) {
        current.hasEnd = true;
        current.active = false;
        current.endAt = entry?.timestamp || null;
        if (!current.mapName) current.mapName = mapNameFrom(entry);
        if (!current.gameMode) current.gameMode = gameModeFrom(entry);
        current = null;
      }
    }

    return matches;
  }

  function decision(teamKills) {
    if (teamKills >= 10) {
      return {
        level: 'ban',
        label: '3H TEMP BAN',
        policy: '10+ commander-ability teamkills in this match — 3-hour temporary ban'
      };
    }
    if (teamKills >= 5) {
      return {
        level: 'kick',
        label: 'KICK + WARNING',
        policy: '5-9 commander-ability teamkills in this match — warning plus kick; 10+ is a 3-hour temporary ban'
      };
    }
    return {
      level: 'warn',
      label: 'WARNING',
      policy: '0-4 commander-ability teamkills in this match — warning that 5+ results in a kick'
    };
  }

  function buildMatchCases(source, selectedSeconds) {
    const matches = segmentMatches(source);
    const cutoff = Date.now() - (selectedSeconds * 1000);
    const cases = [];
    let excludedPermanent = 0;

    for (const match of matches) {
      const players = new Map();

      for (const entry of match.events) {
        if (!isKill(entry)) continue;
        const ability = abilityName(entry);
        if (!ability) continue;

        const id = attackerId(entry);
        const name = attackerName(entry);
        if (permanentBanReady && isPermanentlyBanned(id, name)) {
          excludedPermanent += 1;
          continue;
        }

        const key = id || `name:${name.toLowerCase()}`;
        if (!players.has(key)) {
          players.set(key, {
            key,
            id,
            name,
            teamKills: 0,
            enemyKills: 0,
            friendlies: [],
            enemies: [],
            abilities: new Map(),
            firstAt: entry?.timestamp || null,
            lastAt: entry?.timestamp || null
          });
        }

        const player = players.get(key);
        if (id) player.id = id;
        if (name) player.name = name;
        const abilityStats = player.abilities.get(ability) || { teamKills: 0, enemyKills: 0 };

        if (isTeamkill(entry)) {
          player.teamKills += 1;
          abilityStats.teamKills += 1;
          player.friendlies.push(victimName(entry));
        } else {
          player.enemyKills += 1;
          abilityStats.enemyKills += 1;
          player.enemies.push(victimName(entry));
        }
        player.abilities.set(ability, abilityStats);

        const when = new Date(entry?.timestamp || 0).getTime();
        const first = new Date(player.firstAt || 0).getTime();
        const last = new Date(player.lastAt || 0).getTime();
        if (!player.firstAt || when < first) player.firstAt = entry?.timestamp || player.firstAt;
        if (!player.lastAt || when > last) player.lastAt = entry?.timestamp || player.lastAt;
      }

      for (const player of players.values()) {
        if (player.teamKills <= 0) continue;
        const lastMs = new Date(player.lastAt || 0).getTime();
        const showByRange = match.active || (Number.isFinite(lastMs) && lastMs >= cutoff) || (match.endAt && new Date(match.endAt).getTime() >= cutoff);
        if (!showByRange) continue;

        cases.push({
          ...player,
          match,
          actionSafe: permanentBanReady && Boolean(player.id) && (match.hasStart || match.hasEnd),
          decision: decision(player.teamKills)
        });
      }
    }

    cases.sort((a, b) => {
      const timeDiff = new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
      if (timeDiff !== 0) return timeDiff;
      return b.teamKills - a.teamKills;
    });

    return { cases, excludedPermanent };
  }

  function abilityBreakdown(abilities) {
    return [...abilities.entries()]
      .sort((a, b) => (b[1].teamKills - a[1].teamKills) || (b[1].enemyKills - a[1].enemyKills))
      .map(([name, stats]) => `${name}: ${stats.teamKills} TK / ${stats.enemyKills} enemy`)
      .join(' • ');
  }

  function matchLabel(match) {
    const map = match.mapName || 'Unknown map';
    const mode = match.gameMode || '';
    return `${map}${mode ? ` — ${mode}` : ''}`;
  }

  function actionDisabledReason(item) {
    if (!permanentBanReady) return 'Permanent-ban list could not be checked.';
    if (!item.id) return 'No player ID is available for this log entry.';
    if (!item.match.hasStart && !item.match.hasEnd) return 'Match boundary is missing from the available logs, so automatic moderation is disabled to avoid mixing multiple matches.';
    return '';
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

  function warningMessage(item, kicked = false) {
    const match = matchLabel(item.match);
    if (kicked) {
      return `[ 1ST M.I. COMMANDER WARNING ]\n\nIn this match (${match}), your commander abilities caused ${item.teamKills} teamkills.\nYou are being KICKED for commander-ability teamkilling.\n\n10+ commander-ability teamkills in a single match results in a 3-hour temporary ban.`;
    }
    return `[ 1ST M.I. COMMANDER WARNING ]\n\nIn this match (${match}), your commander abilities caused ${item.teamKills} teamkill${item.teamKills === 1 ? '' : 's'}.\n\nTHIS IS A WARNING.\n5-9 commander-ability teamkills in one match results in a kick.\n10+ in one match results in a 3-hour temporary ban.`;
  }

  async function warnPlayer(item, button) {
    if (!confirm(`Warn ${item.name}?\n\n${item.teamKills} commander-ability teamkill(s) in ${matchLabel(item.match)}`)) return;
    const old = button.textContent;
    button.disabled = true;
    button.textContent = 'Sending...';
    try {
      await apiAction(`/api/v2/players/${encodeURIComponent(item.id)}/message`, { message: warningMessage(item, false) });
      if (typeof window.toast === 'function') window.toast(`Warning sent to ${item.name}`);
      else alert(`Warning sent to ${item.name}.`);
    } catch (error) {
      if (typeof window.toast === 'function') window.toast(error.message || String(error), 'error');
      else alert(error.message || String(error));
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  async function warnAndKickPlayer(item, button) {
    const reason = `Commander ability teamkilling in ${matchLabel(item.match)}: ${item.teamKills} teamkills this match (${item.enemyKills} enemy kills)`;
    if (!confirm(`Warn and kick ${item.name}?\n\n${item.teamKills} commander-ability teamkills in this match.`)) return;
    const old = button.textContent;
    button.disabled = true;
    button.textContent = 'Warning & Kicking...';
    try {
      await apiAction(`/api/v2/players/${encodeURIComponent(item.id)}/message`, { message: warningMessage(item, true) }).catch(() => {});
      await apiAction('/api/v2/kick', { player_id: item.id, reason });
      if (typeof window.toast === 'function') window.toast(`${item.name} warned and kicked`);
      else alert(`${item.name} warned and kicked.`);
    } catch (error) {
      if (typeof window.toast === 'function') window.toast(error.message || String(error), 'error');
      else alert(error.message || String(error));
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  async function tempBanPlayer(item, button) {
    const reason = `Commander ability teamkilling in ${matchLabel(item.match)}: ${item.teamKills} teamkills this match (${item.enemyKills} enemy kills) — 3-hour temporary ban`;
    if (!confirm(`Temporarily ban ${item.name} for 3 hours?\n\n${item.teamKills} commander-ability teamkills in this match meets the 10+ threshold.`)) return;
    const old = button.textContent;
    button.disabled = true;
    button.textContent = 'Banning 3 Hours...';
    try {
      await apiAction('/api/v2/temp-ban', {
        player_id: item.id,
        duration: 3,
        reason,
        admin_name: '1st M.I. Admin'
      });
      if (typeof window.toast === 'function') window.toast(`${item.name} temporarily banned for 3 hours`);
      else alert(`${item.name} temporarily banned for 3 hours.`);
    } catch (error) {
      if (typeof window.toast === 'function') window.toast(error.message || String(error), 'error');
      else alert(error.message || String(error));
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  function commanderViewVisible() {
    const logsView = $('#logs');
    const pane = $('#adminLogTeamkillPane');
    return !document.hidden && Boolean(logsView?.classList.contains('active') && pane && !pane.hidden);
  }

  function install() {
    const existingMonitor = $('#teamkillWatch');
    const rows = $('#adminLogRows');
    if (!rows || $('#commanderTkWatch')) return false;

    const panel = document.createElement('section');
    panel.id = 'commanderTkWatch';
    panel.className = 'cmdtk-watch';
    panel.innerHTML = `
      <div class="cmdtk-head">
        <div>
          <div class="eyebrow">COMMANDER ABILITY REVIEW</div>
          <h4>Commander Call-in Teamkills — Per Match</h4>
          <div class="muted">Thresholds reset every match. 0-4 ability teamkills in one match = warning. 5-9 = warning + kick. 10+ = 3-hour temporary ban.</div>
        </div>
        <button id="commanderTkRefresh" type="button" class="btn ghost small">Refresh</button>
      </div>
      <div id="commanderTkSummary" class="cmdtk-summary muted">Loading per-match commander ability totals…</div>
      <div id="commanderTkList" class="cmdtk-list"><div class="cmdtk-empty">Loading…</div></div>`;

    if (existingMonitor) existingMonitor.insertAdjacentElement('afterend', panel);
    else rows.insertAdjacentElement('beforebegin', panel);

    $('#commanderTkRefresh')?.addEventListener('click', () => { void load(); });
    $('#logRange')?.addEventListener('change', () => {
      if (commanderViewVisible()) void load();
    });
    document.querySelector('[data-view="logs"]')?.addEventListener('click', () => setTimeout(() => {
      if (commanderViewVisible()) void load();
    }, 80));
    document.querySelector('.admin-log-subtab[data-admin-log-subtab="teamkill"]')
      ?.addEventListener('click', () => setTimeout(() => {
        if (commanderViewVisible()) void load();
      }, 90));
    if (commanderViewVisible()) void load();
    document.addEventListener('visibilitychange', () => {
      if (commanderViewVisible()) void load();
    });
    return true;
  }

  async function load() {
    if (loading || !$('#commanderTkWatch') || !commanderViewVisible()) return;
    loading = true;
    try {
      const selectedSeconds = Number($('#logRange')?.value || 3600);
      const fetchSeconds = Math.max(selectedSeconds, MIN_MATCH_LOOKBACK_SECONDS);
      const [logResponse] = await Promise.all([
        fetch(`/api/v2/logs?seconds=${encodeURIComponent(fetchSeconds)}`, {
          credentials: 'include',
          cache: 'no-store'
        }),
        loadPermanentBans()
      ]);

      const text = await logResponse.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!logResponse.ok) throw new Error(data?.error || data?.detail || text || `${logResponse.status} ${logResponse.statusText}`);
      events = Array.isArray(data?.entries) ? data.entries : [];
      render(selectedSeconds);
    } catch (error) {
      $('#commanderTkSummary').textContent = 'Could not load commander ability match totals.';
      $('#commanderTkList').innerHTML = `<div class="cmdtk-empty">${esc(error.message || error)}</div>`;
    } finally {
      loading = false;
    }
  }

  function render(selectedSeconds = Number($('#logRange')?.value || 3600)) {
    const summary = $('#commanderTkSummary');
    const list = $('#commanderTkList');
    if (!summary || !list) return;

    const result = buildMatchCases(events, selectedSeconds);
    lastCases = result.cases;

    const counts = { warn: 0, kick: 0, ban: 0 };
    for (const item of lastCases) counts[item.decision.level] += 1;

    const banStatus = permanentBanReady
      ? `${result.excludedPermanent} permanent-ban commander kill event${result.excludedPermanent === 1 ? '' : 's'} hidden`
      : 'permanent-ban list unavailable — actions disabled';

    summary.textContent = `${lastCases.length} player/match commander teamkill case${lastCases.length === 1 ? '' : 's'} • ${counts.warn} warning • ${counts.kick} warn-and-kick • ${counts.ban} three-hour temp-ban • ${banStatus}. Thresholds reset at each match boundary.`;

    if (!lastCases.length) {
      list.innerHTML = '<div class="cmdtk-empty">No commander-ability teamkill cases in the selected match period.</div>';
      return;
    }

    list.innerHTML = lastCases.map((item, index) => {
      const resultDecision = item.decision;
      const disabledReason = actionDisabledReason(item);
      const disabled = Boolean(disabledReason);
      const abilityText = abilityBreakdown(item.abilities) || 'Unknown commander ability';
      const friendlyNames = item.friendlies.slice(0, 8).join(', ') || 'None';
      const enemyNames = item.enemies.slice(0, 8).join(', ') || 'None';
      const matchStatus = item.match.active ? 'CURRENT MATCH' : (item.match.hasEnd ? 'MATCH ENDED' : 'PARTIAL MATCH');
      const boundaryText = item.match.hasStart
        ? `Started ${localTime(item.match.startAt)}`
        : 'Match start is outside the available log window';
      const endText = item.match.hasEnd && item.match.endAt ? ` • Ended ${localTime(item.match.endAt)}` : '';

      let action = '';
      if (resultDecision.level === 'ban') {
        action = `<button type="button" class="btn danger small cmdtk-match-ban" data-index="${index}" ${disabled ? 'disabled' : ''} title="${esc(disabledReason)}">3-Hour Temp Ban</button>`;
      } else if (resultDecision.level === 'kick') {
        action = `<button type="button" class="btn danger small cmdtk-match-kick" data-index="${index}" ${disabled ? 'disabled' : ''} title="${esc(disabledReason)}">Warn & Kick</button>`;
      } else {
        action = `<button type="button" class="btn ghost small cmdtk-match-warn" data-index="${index}" ${disabled ? 'disabled' : ''} title="${esc(disabledReason)}">Send Kick Warning</button>`;
      }

      return `
        <article class="cmdtk-card ${esc(resultDecision.level)}" data-cmdtk-index="${index}">
          <div class="cmdtk-top">
            <div>
              <div class="cmdtk-name">${esc(item.name)}</div>
              ${item.id ? `<div class="cmdtk-id">${esc(item.id)}</div>` : ''}
              <div class="cmdtk-match-label">${esc(matchLabel(item.match))} • ${esc(matchStatus)}</div>
            </div>
            <span class="cmdtk-badge ${esc(resultDecision.level)}">${esc(resultDecision.label)}</span>
          </div>
          <div class="cmdtk-line"><span class="cmdtk-label">This match:</span> ${item.teamKills} commander-ability teamkill(s) • ${item.enemyKills} enemy kill(s)</div>
          <div class="cmdtk-line"><span class="cmdtk-label">Abilities:</span> ${esc(abilityText)}</div>
          <div class="cmdtk-line"><span class="cmdtk-label">Policy:</span> ${esc(resultDecision.policy)}</div>
          <div class="cmdtk-line"><span class="cmdtk-label">Friendly victims:</span> ${esc(friendlyNames)}</div>
          <div class="cmdtk-line"><span class="cmdtk-label">Enemy victims:</span> ${esc(enemyNames)}</div>
          <div class="cmdtk-times">${esc(boundaryText)}${esc(endText)} • TK activity ${esc(localTime(item.firstAt))}${item.lastAt && item.lastAt !== item.firstAt ? ` → ${esc(localTime(item.lastAt))}` : ''}</div>
          ${disabledReason ? `<div class="cmdtk-action-note muted">${esc(disabledReason)}</div>` : ''}
          <div class="cmdtk-actions">${action}</div>
        </article>`;
    }).join('');

    list.querySelectorAll('.cmdtk-match-warn').forEach((button) => {
      button.addEventListener('click', () => {
        const item = lastCases[Number(button.dataset.index)];
        if (item) warnPlayer(item, button);
      });
    });

    list.querySelectorAll('.cmdtk-match-kick').forEach((button) => {
      button.addEventListener('click', () => {
        const item = lastCases[Number(button.dataset.index)];
        if (item) warnAndKickPlayer(item, button);
      });
    });

    list.querySelectorAll('.cmdtk-match-ban').forEach((button) => {
      button.addEventListener('click', () => {
        const item = lastCases[Number(button.dataset.index)];
        if (item) tempBanPlayer(item, button);
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
