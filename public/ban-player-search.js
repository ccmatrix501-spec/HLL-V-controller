(() => {
  const LOG_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
  const MAX_RESULTS = 50;

  async function apiRequest(url) {
    const response = await fetch(url, { credentials: 'include' });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const message = data && typeof data === 'object'
        ? (data.error || data.detail || `${response.status} ${response.statusText}`)
        : (data || `${response.status} ${response.statusText}`);
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }
    return data;
  }

  function clean(value) {
    return String(value ?? '').trim();
  }

  function matches(value, query) {
    return clean(value).toLowerCase().includes(query);
  }

  function resultScore(result, query) {
    const id = result.id.toLowerCase();
    const name = result.name.toLowerCase();
    if (id === query) return 0;
    if (name === query) return 1;
    if (id.startsWith(query)) return 2;
    if (name.startsWith(query)) return 3;
    if (result.sources.has('Stats history')) return 4;
    return 5;
  }

  function mergeResult(map, candidate) {
    const id = clean(candidate.id);
    if (!id) return;
    const key = id.toLowerCase();
    let current = map.get(key);
    if (!current) {
      current = {
        id,
        name: clean(candidate.name) || 'Unknown player',
        sources: new Set(),
        lastSeen: '',
        stats: null
      };
      map.set(key, current);
    }

    const candidateName = clean(candidate.name);
    if (candidateName && (current.name === 'Unknown player' || candidate.source === 'Stats history')) {
      current.name = candidateName;
    }
    if (candidate.source) current.sources.add(candidate.source);
    if (candidate.lastSeen && (!current.lastSeen || candidate.lastSeen > current.lastSeen)) {
      current.lastSeen = candidate.lastSeen;
    }
    if (candidate.stats) current.stats = candidate.stats;
  }

  function statsCandidates(data, query, results) {
    const players = Array.isArray(data?.players) ? data.players : [];
    for (const player of players) {
      const id = clean(player.player_id ?? player.id);
      const name = clean(player.player_name ?? player.name);
      if (!id) continue;
      if (!matches(id, query) && !matches(name, query)) continue;
      mergeResult(results, {
        id,
        name,
        source: 'Stats history',
        lastSeen: clean(player.last_seen),
        stats: {
          kills: Number(player.kills || 0),
          deaths: Number(player.deaths || 0),
          revives: Number(player.revives || 0)
        }
      });
    }
  }

  function addPair(entry, idKey, nameKey, query, results) {
    const id = clean(entry?.[idKey]);
    const name = clean(entry?.[nameKey]);
    if (!id) return;
    if (!matches(id, query) && !matches(name, query)) return;
    mergeResult(results, {
      id,
      name,
      source: 'Server logs',
      lastSeen: clean(entry?.timestamp)
    });
  }

  function logCandidates(data, query, results) {
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    const knownPairs = [
      ['player_id', 'player_name'],
      ['instigator_id', 'instigator_name'],
      ['victim_id', 'victim_name'],
      ['killer_id', 'killer_name'],
      ['target_id', 'target_name'],
      ['offender_id', 'offender_name'],
      ['reporter_id', 'reporter_name']
    ];

    for (const entry of entries) {
      for (const [idKey, nameKey] of knownPairs) addPair(entry, idKey, nameKey, query, results);

      // Future HLL:V log classes may use another <prefix>_id / <prefix>_name pair.
      if (entry && typeof entry === 'object') {
        for (const key of Object.keys(entry)) {
          if (!key.endsWith('_id')) continue;
          const prefix = key.slice(0, -3);
          if (['weapon', 'vehicle', 'map', 'game_mode', 'role', 'faction', 'request'].includes(prefix)) continue;
          const nameKey = `${prefix}_name`;
          if (Object.prototype.hasOwnProperty.call(entry, nameKey)) {
            addPair(entry, key, nameKey, query, results);
          }
        }
      }

      // Raw log fallback, e.g. PlayerName(Allies/7656119...) or EOS IDs.
      const raw = clean(entry?.raw_message);
      if (!raw) continue;
      const regex = /([^\n()]{1,80})\((?:Allies|Axis|Unknown|None)\/([0-9]{17}|[a-fA-F0-9]{32})\)/g;
      let match;
      while ((match = regex.exec(raw)) !== null) {
        const name = clean(match[1]).replace(/^.*?:\s*/, '').trim();
        const id = clean(match[2]);
        if (matches(id, query) || matches(name, query)) {
          mergeResult(results, {
            id,
            name,
            source: 'Server logs',
            lastSeen: clean(entry?.timestamp)
          });
        }
      }
    }
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function renderResults(container, results, query, idInput, selectedLabel) {
    container.innerHTML = '';
    const rows = [...results.values()]
      .sort((a, b) => {
        const score = resultScore(a, query) - resultScore(b, query);
        if (score) return score;
        return (b.lastSeen || '').localeCompare(a.lastSeen || '');
      })
      .slice(0, MAX_RESULTS);

    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No matching player was found in tracked stats or the last 7 days of server logs.';
      container.appendChild(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Player</th><th>User ID</th><th>Source</th><th>Stats / Last Seen</th><th></th></tr></thead>';
    const body = document.createElement('tbody');

    for (const result of rows) {
      const tr = document.createElement('tr');
      const statsText = result.stats
        ? `K ${result.stats.kills} / D ${result.stats.deaths} / R ${result.stats.revives}`
        : `Last seen ${formatDate(result.lastSeen)}`;
      tr.innerHTML = '<td></td><td class="player-id"></td><td></td><td></td><td></td>';
      tr.children[0].textContent = result.name;
      tr.children[1].textContent = result.id;
      tr.children[2].textContent = [...result.sources].join(' + ');
      tr.children[3].textContent = result.stats && result.lastSeen
        ? `${statsText} • ${formatDate(result.lastSeen)}`
        : statsText;

      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'btn primary small';
      use.textContent = 'Use Player';
      use.addEventListener('click', () => {
        idInput.value = result.id;
        idInput.dispatchEvent(new Event('input', { bubbles: true }));
        selectedLabel.textContent = `Selected: ${result.name} — ${result.id}`;
        selectedLabel.dataset.playerName = result.name;
        idInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        idInput.focus();
      });
      tr.children[4].appendChild(use);
      body.appendChild(tr);
    }

    table.appendChild(body);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  function install() {
    const panel = document.getElementById('banByIdPanel');
    const form = document.getElementById('banByIdForm');
    const idInput = document.getElementById('banByIdPlayerId');
    if (!panel || !form || !idInput || document.getElementById('banPlayerLookup')) return;

    const lookup = document.createElement('div');
    lookup.id = 'banPlayerLookup';
    lookup.style.marginBottom = '18px';

    const heading = document.createElement('h4');
    heading.textContent = 'Find Player from History';
    heading.style.margin = '0 0 6px';

    const help = document.createElement('p');
    help.className = 'muted';
    help.textContent = 'Search by player name or user ID. Results combine saved player stats with up to 7 days of HLL:V server logs.';

    const searchRow = document.createElement('form');
    searchRow.className = 'mini-form';
    searchRow.autocomplete = 'off';

    const searchInput = document.createElement('input');
    searchInput.id = 'banPlayerHistorySearch';
    searchInput.placeholder = 'Player name or user ID';
    searchInput.autocomplete = 'off';

    const searchButton = document.createElement('button');
    searchButton.type = 'submit';
    searchButton.className = 'btn primary';
    searchButton.textContent = 'Search History';

    searchRow.append(searchInput, searchButton);

    const status = document.createElement('p');
    status.id = 'banPlayerLookupStatus';
    status.className = 'muted';
    status.style.margin = '8px 0';

    const resultsBox = document.createElement('div');
    resultsBox.id = 'banPlayerLookupResults';

    const selected = document.createElement('p');
    selected.id = 'banPlayerLookupSelected';
    selected.className = 'muted';
    selected.style.margin = '8px 0 0';

    lookup.append(heading, help, searchRow, status, resultsBox, selected);
    panel.insertBefore(lookup, form);

    searchRow.addEventListener('submit', async (event) => {
      event.preventDefault();
      const queryRaw = searchInput.value.trim();
      const query = queryRaw.toLowerCase();
      resultsBox.innerHTML = '';
      selected.textContent = '';

      if (query.length < 2) {
        status.textContent = 'Enter at least 2 characters of the player name or ID.';
        return;
      }

      const oldText = searchButton.textContent;
      searchButton.disabled = true;
      searchButton.textContent = 'Searching...';
      status.textContent = 'Searching saved stats and server logs...';

      const combined = new Map();
      try {
        const [statsResult, logsResult] = await Promise.allSettled([
          apiRequest('/api/v2/player-stats?limit=1000'),
          apiRequest(`/api/v2/logs?seconds=${LOG_LOOKBACK_SECONDS}`)
        ]);

        if (statsResult.status === 'fulfilled') statsCandidates(statsResult.value, query, combined);
        if (logsResult.status === 'fulfilled') logCandidates(logsResult.value, query, combined);

        const failures = [];
        if (statsResult.status === 'rejected') failures.push(`stats: ${statsResult.reason.message}`);
        if (logsResult.status === 'rejected') failures.push(`logs: ${logsResult.reason.message}`);

        renderResults(resultsBox, combined, query, idInput, selected);
        status.textContent = combined.size
          ? `Found ${combined.size} matching player record${combined.size === 1 ? '' : 's'}.${failures.length ? ` Partial search (${failures.join('; ')})` : ''}`
          : (failures.length ? `Search failed: ${failures.join('; ')}` : 'No matching player found.');
      } catch (error) {
        status.textContent = error.message;
        if (typeof window.toast === 'function') window.toast(error.message, 'error');
      } finally {
        searchButton.disabled = false;
        searchButton.textContent = oldText;
      }
    });

    // Clear the selected-name hint if the ID is manually changed after choosing a result.
    idInput.addEventListener('input', () => {
      if (!selected.dataset.playerName) return;
      if (!selected.textContent.endsWith(`— ${idInput.value.trim()}`)) {
        selected.textContent = '';
        delete selected.dataset.playerName;
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0), { once: true });
  } else {
    setTimeout(install, 0);
  }
})();
