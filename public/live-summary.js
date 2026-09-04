(() => {
  const POLL_MS = 5000;

  function pick(obj, keys, fallback = null) {
    if (!obj || typeof obj !== 'object') return fallback;
    for (const key of keys) {
      const value = obj[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return fallback;
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error(data?.error || data?.detail || `${res.status} ${res.statusText}`);
    return data;
  }

  function formatRemaining(value) {
    if (value === null || value === undefined || value === '' || value === '—') return '—';

    let totalSeconds = null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      totalSeconds = Math.max(0, Math.round(value));
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        totalSeconds = Math.max(0, Math.round(Number(trimmed)));
      } else if (/^\d{1,3}:\d{2}:\d{2}$/.test(trimmed)) {
        const [h, m, s] = trimmed.split(':').map(Number);
        totalSeconds = h * 3600 + m * 60 + s;
      } else {
        const iso = trimmed.match(/^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
        if (iso) {
          totalSeconds = Math.round((Number(iso[1] || 0) * 3600) + (Number(iso[2] || 0) * 60) + Number(iso[3] || 0));
        }
      }
    }

    if (totalSeconds === null || !Number.isFinite(totalSeconds)) return String(value);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function sequenceMaps(sequence) {
    if (!sequence || typeof sequence !== 'object') return [];
    const raw = pick(sequence, ['maps', 'mAPS', 'MAPS'], []);
    if (!Array.isArray(raw)) return [];
    return raw.map(entry => {
      if (typeof entry === 'string') return entry;
      return String(pick(entry, ['name', 'mapName', 'map_name', 'mapId', 'map_id'], '') || '');
    }).filter(Boolean);
  }

  function deriveNextMap(session, sequence, currentMap) {
    const direct = pick(session, ['next_map', 'nextMap', 'NextMap', 'next_map_name', 'nextMapName', 'next_map_id', 'nextMapId']);
    if (direct) return String(direct);

    const maps = sequenceMaps(sequence);
    if (!maps.length) return '—';

    if (currentMap) {
      const currentByName = maps.findIndex(name => String(name).toLowerCase() === String(currentMap).toLowerCase());
      if (currentByName >= 0) return maps[(currentByName + 1) % maps.length];
    }

    const rawIndex = Number(pick(sequence, ['current_index', 'currentIndex', 'CurrentIndex'], -1));
    if (Number.isInteger(rawIndex) && rawIndex >= 0) return maps[(rawIndex + 1) % maps.length];
    return maps[0] || '—';
  }

  async function refreshLiveSummary() {
    try {
      const status = await getJson('/api/v2/connection/status');
      if (!status?.connected) return;

      const [sessionResult, sequenceResult] = await Promise.allSettled([
        getJson('/api/v2/server?type=session'),
        getJson('/api/v2/map-sequence')
      ]);
      if (sessionResult.status !== 'fulfilled') return;

      const session = sessionResult.value || {};
      const sequence = sequenceResult.status === 'fulfilled' ? sequenceResult.value : null;

      const currentMap = pick(session, ['map', 'map_name', 'mapName', 'MapName', 'current_map', 'currentMap', 'map_id', 'mapId'], '—');
      const remaining = pick(session, ['remaining_time', 'remainingTime', 'remaining_match_time', 'remainingMatchTime', 'time_remaining', 'timeRemaining', 'remaining'], '—');
      const players = pick(session, ['player_count', 'playerCount', 'current_players', 'currentPlayers', 'players', 'Players'], null);
      const maxPlayers = pick(session, ['max_player_count', 'maxPlayerCount', 'max_players', 'maxPlayers', 'slots', 'Slots'], null);
      const nextMap = deriveNextMap(session, sequence, currentMap === '—' ? null : currentMap);

      const mapEl = document.querySelector('#statMap');
      const nextEl = document.querySelector('#statNextMap');
      const timeEl = document.querySelector('#statTime');
      const playersEl = document.querySelector('#statPlayers');
      const playerSub = document.querySelector('#statPlayerSub');

      if (mapEl) mapEl.textContent = String(currentMap || '—');
      if (nextEl) nextEl.textContent = String(nextMap || '—');
      if (timeEl) timeEl.textContent = formatRemaining(remaining);

      if (playersEl && players !== null && !Number.isNaN(Number(players))) {
        const p = Number(players);
        const max = maxPlayers !== null && !Number.isNaN(Number(maxPlayers)) ? Number(maxPlayers) : null;
        playersEl.textContent = max !== null ? `${p}/${max}` : String(p);
        if (playerSub) playerSub.textContent = 'live server population';
      }
    } catch (err) {
      // Login screens, brief RCON transitions and map loads can temporarily fail.
      // Keep the last known values instead of flashing errors on the dashboard cards.
    }
  }

  window.addEventListener('load', () => {
    refreshLiveSummary();
    setInterval(refreshLiveSummary, POLL_MS);

    const refreshButton = document.querySelector('[data-refresh="server"]');
    if (refreshButton) refreshButton.addEventListener('click', () => setTimeout(refreshLiveSummary, 50));
  });
})();
