(() => {
  let players = [];
  let board = null;
  let loading = false;
  let sortKey = 'kills';
  let sortDirection = 'desc';

  const $ = (selector) => document.querySelector(selector);

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  async function api(url) {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw new Error(data?.detail || data?.error || text || `${response.status} ${response.statusText}`);
    return data;
  }

  function kd(player) {
    const kills = Math.max(0, Number(player?.kills || 0));
    const deaths = Math.max(0, Number(player?.deaths || 0));
    return deaths === 0 ? kills : kills / deaths;
  }

  function kdText(player) {
    const kills = Math.max(0, Number(player?.kills || 0));
    const deaths = Math.max(0, Number(player?.deaths || 0));
    if (!deaths) return kills > 0 ? 'INF' : '0.00';
    return (kills / deaths).toFixed(2);
  }

  function favoriteText(value) {
    if (!value) return '—';
    const name = value.name || value.id || 'Unknown';
    const kills = Number(value.kills || 0);
    return `${name} (${kills})`;
  }

  function localDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  }

  function addNavAndView() {
    if (!$('#leaderboard')) {
      const section = document.createElement('section');
      section.id = 'leaderboard';
      section.className = 'view';
      section.innerHTML = `
        <div class="leaderboard-intro panel">
          <div>
            <p class="eyebrow">SERVER RECORDS</p>
            <h3>Player Stats Leaderboard</h3>
            <p class="muted">Persistent totals recorded on this HLL:V server.</p>
          </div>
          <div class="leaderboard-command-help">
            <strong>In-game commands</strong>
            <code>!topstats</code><code>!topkills</code><code>!toprevives</code><code>!topkd</code>
          </div>
        </div>

        <div class="leaderboard-top-grid">
          <article class="panel leaderboard-card"><p class="eyebrow">TOP KILLS</p><div id="leaderTopKills" class="leaderboard-mini">Loading…</div></article>
          <article class="panel leaderboard-card"><p class="eyebrow">TOP REVIVES</p><div id="leaderTopRevives" class="leaderboard-mini">Loading…</div></article>
          <article class="panel leaderboard-card"><p class="eyebrow">BEST K/D</p><div id="leaderTopKd" class="leaderboard-mini">Loading…</div><small id="leaderKdRule" class="muted"></small></article>
        </div>

        <article class="panel">
          <div class="panel-head">
            <div><p class="eyebrow">ALL TRACKED PLAYERS</p><h3>Server Totals</h3></div>
            <div class="inline"><input id="leaderSearch" type="search" placeholder="Search player..." autocomplete="off" /><button id="leaderRefresh" class="btn ghost small" type="button">Refresh</button></div>
          </div>
          <div class="leaderboard-meta"><span id="leaderTracked" class="muted"></span><span id="leaderUpdated" class="muted"></span></div>
          <div class="table-wrap">
            <table class="leaderboard-table">
              <thead><tr>
                <th>#</th>
                <th><button data-leader-sort="player_name">Player</button></th>
                <th><button data-leader-sort="kills">Kills</button></th>
                <th><button data-leader-sort="deaths">Deaths</button></th>
                <th><button data-leader-sort="kd">K/D</button></th>
                <th><button data-leader-sort="revives">Revives</button></th>
                <th>Favourite Weapon</th>
                <th>Favourite Vehicle</th>
                <th><button data-leader-sort="last_seen">Last Seen</button></th>
              </tr></thead>
              <tbody id="leaderTableBody"><tr><td colspan="9" class="empty">Loading player stats…</td></tr></tbody>
            </table>
          </div>
        </article>`;
      document.querySelector('.main')?.appendChild(section);
    }

    if (!document.querySelector('[data-view="leaderboard"]')) {
      const nav = $('#nav');
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.view = 'leaderboard';
      button.textContent = 'Player Stats';
      const playersButton = nav?.querySelector('[data-view="players"]');
      if (playersButton?.nextSibling) nav.insertBefore(button, playersButton.nextSibling);
      else nav?.appendChild(button);
      button.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item === button));
        document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === 'leaderboard'));
        const title = $('#pageTitle');
        if (title) title.textContent = 'Player Stats';
        load();
      });
    }
  }

  function renderMini(selector, rows, field) {
    const box = $(selector);
    if (!box) return;
    if (!rows?.length) {
      box.innerHTML = '<div class="leaderboard-empty">No data yet.</div>';
      return;
    }
    box.innerHTML = rows.slice(0, 5).map((row, index) => {
      const value = field === 'kd' ? (row.kd_display || kdText(row)) : Number(row[field] || 0);
      return `<div class="leaderboard-mini-row"><span class="leader-rank">${index + 1}</span><strong>${esc(row.player_name || row.player_id)}</strong><span>${esc(value)}</span></div>`;
    }).join('');
  }

  function sortValue(player, key) {
    if (key === 'player_name') return String(player.player_name || '').toLocaleLowerCase();
    if (key === 'kd') return kd(player);
    if (key === 'last_seen') return Date.parse(player.last_seen || 0) || 0;
    return Number(player[key] || 0);
  }

  function renderTable() {
    const tbody = $('#leaderTableBody');
    if (!tbody) return;
    const query = ($('#leaderSearch')?.value || '').trim().toLocaleLowerCase();
    const filtered = players.filter(player => !query || String(player.player_name || '').toLocaleLowerCase().includes(query) || String(player.player_id || '').toLocaleLowerCase().includes(query));
    filtered.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      let cmp = 0;
      if (typeof av === 'string') cmp = av.localeCompare(bv);
      else cmp = av - bv;
      if (cmp === 0) cmp = String(a.player_name || '').localeCompare(String(b.player_name || ''));
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    document.querySelectorAll('[data-leader-sort]').forEach(button => {
      const active = button.dataset.leaderSort === sortKey;
      button.classList.toggle('active', active);
      button.dataset.direction = active ? sortDirection : '';
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">No tracked player statistics yet.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map((player, index) => `
      <tr>
        <td class="leader-rank-cell">${index + 1}</td>
        <td><strong>${esc(player.player_name || 'Unknown')}</strong><small>${esc(player.player_id || '')}</small></td>
        <td>${Number(player.kills || 0)}</td>
        <td>${Number(player.deaths || 0)}</td>
        <td><strong>${esc(kdText(player))}</strong></td>
        <td>${Number(player.revives || 0)}</td>
        <td>${esc(favoriteText(player.favorite_weapon))}</td>
        <td>${esc(favoriteText(player.favorite_vehicle))}</td>
        <td>${esc(localDate(player.last_seen))}</td>
      </tr>`).join('');
  }

  function render() {
    renderMini('#leaderTopKills', board?.top_kills || [], 'kills');
    renderMini('#leaderTopRevives', board?.top_revives || [], 'revives');
    renderMini('#leaderTopKd', board?.top_kd || [], 'kd');
    const kdRule = $('#leaderKdRule');
    if (kdRule) kdRule.textContent = `Minimum ${Number(board?.min_kd_kills || 10)} server kills to qualify.`;
    const tracked = $('#leaderTracked');
    if (tracked) tracked.textContent = `${Number(board?.tracked_players ?? players.length)} tracked players`;
    const updated = $('#leaderUpdated');
    if (updated) updated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    renderTable();
  }

  function renderLoadError(error) {
    const message = esc(error?.message || error || 'Unable to load leaderboard.');
    ['#leaderTopKills', '#leaderTopRevives', '#leaderTopKd'].forEach(selector => {
      const box = $(selector);
      if (box) box.innerHTML = `<div class="leaderboard-empty error">Unable to load: ${message}</div>`;
    });
    const tbody = $('#leaderTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="empty error">${message}</td></tr>`;
  }

  async function load() {
    if (loading) return;
    loading = true;
    try {
      // Leaderboard lives outside /player-stats/{player_id}; otherwise FastAPI's
      // dynamic player route treats the word "leaderboard" as an actual player ID.
      const [all, leaders] = await Promise.all([
        api('/api/v2/player-stats?limit=1000'),
        api('/api/v2/leaderboard?limit=5')
      ]);
      players = Array.isArray(all?.players) ? all.players : [];
      board = leaders || {};
      render();
    } catch (error) {
      renderLoadError(error);
    } finally {
      loading = false;
    }
  }

  function install() {
    addNavAndView();
    $('#leaderSearch')?.addEventListener('input', renderTable);
    $('#leaderRefresh')?.addEventListener('click', load);
    document.querySelectorAll('[data-leader-sort]').forEach(button => {
      button.addEventListener('click', () => {
        const key = button.dataset.leaderSort;
        if (sortKey === key) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        else {
          sortKey = key;
          sortDirection = key === 'player_name' ? 'asc' : 'desc';
        }
        renderTable();
      });
    });
    setInterval(() => {
      if ($('#leaderboard')?.classList.contains('active')) load();
    }, 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
