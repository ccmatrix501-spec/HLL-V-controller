(() => {
  const FACTIONS = {
    0: 'UNKNOWN',
    1: 'US',
    6: 'NVA',
    8: 'UNASSIGNED'
  };

  const ROLES = {
    0: 'Rifleman',
    3: 'Medic',
    4: 'Spotter',
    5: 'Specialist',
    6: 'Machine Gunner',
    7: 'Grenadier',
    8: 'Engineer',
    9: 'Squad Leader',
    10: 'Sniper',
    11: 'Crewman',
    12: 'Tank Commander',
    13: 'Support',
    14: 'Observer',
    15: 'Gunner',
    16: 'Pilot',
    17: 'Logistics Officer',
    20: 'Commander'
  };

  const sortState = { key: 'name', direction: 'asc' };

  function pick(obj, keys, fallback = undefined) {
    for (const key of keys) {
      if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
    }
    return fallback;
  }

  function playerKey(player) {
    return String(pick(player, ['id', 'ID', 'player_id', 'PlayerId', 'playerId', 'eosId', 'eos_id', 'steam_id_64', 'SteamID64', 'platform_id', 'PlatformId'], '')).trim();
  }

  function playerName(player) {
    return String(pick(player, ['name', 'Name', 'player_name', 'PlayerName'], 'Unknown Player'));
  }

  function sideFor(player) {
    const direct = pick(player, ['teamName', 'team_name', 'factionName', 'faction_name', 'faction']);
    if (direct && typeof direct === 'object') {
      const name = pick(direct, ['name', 'Name', 'id', 'Id']);
      if (name) return String(name).toUpperCase();
    }
    if (typeof direct === 'string' && direct.trim() && !/^\d+$/.test(direct.trim())) {
      const text = direct.trim().toUpperCase();
      if (text.includes('NVA') || text.includes('NORTH VIET')) return 'NVA';
      if (text === 'US' || text.includes('UNITED STATES') || text.includes('USA')) return 'US';
      if (text.includes('UNASSIGNED')) return 'UNASSIGNED';
      return text;
    }

    const raw = pick(player, ['factionId', 'faction_id', 'teamId', 'team_id', 'team', 'Team']);
    const id = Number(raw);
    return Number.isFinite(id) && Object.prototype.hasOwnProperty.call(FACTIONS, id) ? FACTIONS[id] : '—';
  }

  function unitFor(player) {
    const raw = pick(player, ['platoon', 'Platoon', 'unit', 'Unit', 'squad', 'Squad'], '—');
    if (raw && typeof raw === 'object') {
      return String(pick(raw, ['name', 'Name', 'id', 'Id'], '—'));
    }
    return String(raw ?? '—');
  }

  function roleFor(player) {
    const direct = pick(player, ['roleName', 'role_name']);
    if (direct) return String(direct);
    const rawRole = pick(player, ['role', 'Role']);
    if (typeof rawRole === 'string' && rawRole.trim() && !/^\d+$/.test(rawRole.trim())) return rawRole.trim();
    const roleId = Number(pick(player, ['roleId', 'role_id', 'role', 'Role']));
    return Number.isFinite(roleId) ? (ROLES[roleId] || `Role ${roleId}`) : '—';
  }

  function scoreFor(player) {
    const direct = pick(player, ['score', 'Score']);
    if (direct !== undefined) return direct;
    const score = pick(player, ['scoreData', 'score_data']);
    if (!score || typeof score !== 'object') return undefined;
    const combat = Number(pick(score, ['combat', 'cOMBAT'], 0)) || 0;
    const offense = Number(pick(score, ['offense'], 0)) || 0;
    const defense = Number(pick(score, ['defense'], 0)) || 0;
    const support = Number(pick(score, ['support'], 0)) || 0;
    return combat + offense + defense + support;
  }

  function installRosterStyles() {
    if (document.getElementById('hllvRosterSideStyles')) return;
    const style = document.createElement('style');
    style.id = 'hllvRosterSideStyles';
    style.textContent = `
      .hllv-side { display:inline-flex; align-items:center; min-width:52px; justify-content:center; padding:4px 8px; border:1px solid var(--line, #344238); border-radius:999px; font-weight:800; letter-spacing:.06em; font-size:.78rem; }
      .hllv-side.us { background:rgba(57,106,170,.16); border-color:rgba(89,137,198,.55); }
      .hllv-side.nva { background:rgba(152,58,48,.16); border-color:rgba(188,75,61,.55); }
      .hllv-side.unassigned, .hllv-side.unknown { opacity:.72; }
      .roster-sort-controls { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .roster-sort-controls select { min-width:120px; }
      .roster-sort-direction { min-width:42px; }
    `;
    document.head.appendChild(style);
  }

  function installSortControls() {
    if (document.querySelector('#playerSortBy')) return;
    const search = document.querySelector('#playerSearch');
    if (!search) return;
    const parent = search.parentElement;
    if (!parent) return;

    const controls = document.createElement('div');
    controls.className = 'roster-sort-controls';
    controls.innerHTML = `
      <select id="playerSortBy" title="Sort players">
        <option value="name">Sort: Name</option>
        <option value="side">Sort: Side</option>
        <option value="unit">Sort: Unit</option>
        <option value="role">Sort: Role</option>
      </select>
      <button id="playerSortDirection" type="button" class="btn ghost small roster-sort-direction" title="Reverse sort">A→Z</button>`;
    parent.insertBefore(controls, search);

    controls.querySelector('#playerSortBy').addEventListener('change', event => {
      sortState.key = event.target.value;
      renderPlayers();
    });
    controls.querySelector('#playerSortDirection').addEventListener('click', event => {
      sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
      event.currentTarget.textContent = sortState.direction === 'asc' ? 'A→Z' : 'Z→A';
      renderPlayers();
    });
  }

  function sideClass(side) {
    const value = String(side || '').toLowerCase();
    if (value === 'us') return 'us';
    if (value === 'nva') return 'nva';
    if (value === 'unassigned') return 'unassigned';
    return 'unknown';
  }

  function sortValue(player, key) {
    if (key === 'side') return sideFor(player);
    if (key === 'unit') return unitFor(player);
    if (key === 'role') return roleFor(player);
    return playerName(player);
  }

  function comparePlayers(a, b) {
    const av = String(sortValue(a, sortState.key) || '').toLocaleLowerCase();
    const bv = String(sortValue(b, sortState.key) || '').toLocaleLowerCase();
    const result = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
    if (result !== 0) return sortState.direction === 'asc' ? result : -result;
    return playerName(a).localeCompare(playerName(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  renderPlayers = function renderPlayersHllv(error = '') {
    installRosterStyles();
    installSortControls();
    const search = document.querySelector('#playerSearch');
    const q = (search?.value || '').trim().toLowerCase();
    const players = Array.isArray(state.players) ? state.players : [];
    const rows = players
      .filter(player => JSON.stringify(player).toLowerCase().includes(q))
      .sort(comparePlayers);
    const body = document.querySelector('#playersBody');
    if (!body) return;

    if (error) {
      body.innerHTML = '<tr><td colspan="5" class="empty"></td></tr>';
      body.querySelector('td').textContent = error;
      return;
    }
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty">No players found.</td></tr>';
      return;
    }

    body.innerHTML = '';
    for (const player of rows) {
      const id = playerKey(player);
      const name = playerName(player);
      const side = sideFor(player);
      const unit = unitFor(player);
      const role = roleFor(player);
      const score = scoreFor(player);
      const ping = pick(player, ['ping', 'Ping']);

      const tr = document.createElement('tr');
      tr.innerHTML = '<td><span class="player-name"></span><span class="player-id"></span></td><td><span class="hllv-side"></span></td><td></td><td></td><td><div class="action-row"></div></td>';
      tr.children[0].querySelector('.player-name').textContent = name;
      tr.children[0].querySelector('.player-id').textContent = id;

      const sideEl = tr.children[1].querySelector('.hllv-side');
      sideEl.textContent = side;
      sideEl.classList.add(sideClass(side));

      tr.children[2].textContent = [unit, role].filter(value => value && value !== '—').join(' / ') || '—';
      tr.children[3].textContent = [score !== undefined ? `Score ${score}` : '', ping !== undefined ? `Ping ${ping}` : ''].filter(Boolean).join(' / ') || '—';

      const actions = tr.querySelector('.action-row');
      [['message', 'Message'], ['punish', 'Punish'], ['force', 'Switch'], ['kick', 'Kick'], ['tempban', 'Temp Ban'], ['permaban', 'Perma Ban']].forEach(([action, label]) => {
        const button = document.createElement('button');
        button.className = `action-btn ${['kick', 'tempban', 'permaban'].includes(action) ? 'danger' : ''}`;
        button.textContent = label;
        button.type = 'button';
        button.onclick = () => openPlayerAction(action, id, name);
        actions.appendChild(button);
      });
      body.appendChild(tr);
    }
  };

  installRosterStyles();
  installSortControls();
  document.querySelector('#playerSearch')?.addEventListener('input', () => renderPlayers());
  if (Array.isArray(state.players) && state.players.length) renderPlayers();
})();
