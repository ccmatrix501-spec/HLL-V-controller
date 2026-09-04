(() => {
  const MODE_LABELS = {
    all: 'All configured modes',
    warfare: 'Warfare',
    offensivenva: 'Offensive - NVA',
    offensiveus: 'Offensive - US',
    domination: 'Domination',
    conquest: 'Conquest'
  };

  const FALLBACK_CATALOG = [
    'wdeva_warfare_day','wdeva_offensivenva_day','wdeva_offensiveus_day','wdeva_domination_day','wdeva_conquest_day',
    'wdevb_warfare_day','wdevb_offensivenva_day','wdevb_offensiveus_day','wdevb_domination_day','wdevb_conquest_day',
    'wdevc_warfare_day','wdevc_offensivenva_day','wdevc_offensiveus_day','wdevc_domination_day','wdevc_conquest_day',
    'wdevd_warfare_day','wdevd_offensivenva_day','wdevd_offensiveus_day','wdevd_domination_day','wdevd_conquest_day',
    'wdeve_warfare_day','wdeve_conquest_day','wdeve_offensivenva_day','wdeve_offensiveus_day','wdeve_domination_day',
    'wdevf_warfare_day','wdevf_offensivenva_day','wdevf_offensiveus_day','wdevf_domination_day','wdevf_conquest_day'
  ];

  let catalog = [];
  let rotationDraft = [];
  let renderingChangeSelect = false;

  function mapMode(mapName) {
    const name = String(mapName || '').toLowerCase();
    if (name.includes('_warfare_')) return 'warfare';
    if (name.includes('_offensivenva_')) return 'offensivenva';
    if (name.includes('_offensiveus_')) return 'offensiveus';
    if (name.includes('_domination_')) return 'domination';
    if (name.includes('_conquest_')) return 'conquest';
    return 'other';
  }

  function mapLabel(mapName) {
    const name = String(mapName || '');
    const m = name.match(/^wdev([a-f])_/i);
    const area = m ? `WDEV ${m[1].toUpperCase()}` : name.split('_')[0].toUpperCase();
    const mode = MODE_LABELS[mapMode(name)] || mapMode(name);
    const tod = name.endsWith('_day') ? 'Day' : '';
    return `${area} — ${mode}${tod ? ` — ${tod}` : ''}`;
  }

  function errorText(data, statusText) {
    const raw = data?.error ?? data?.detail ?? statusText;
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object') return raw.message || JSON.stringify(raw);
    return String(raw || 'Request failed');
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error(errorText(data, `${res.status} ${res.statusText}`));
    return data;
  }

  function modeOptions(select, includeAll = true) {
    select.innerHTML = '';
    const modes = includeAll
      ? ['all', 'warfare', 'offensivenva', 'offensiveus', 'domination', 'conquest']
      : ['warfare', 'offensivenva', 'offensiveus', 'domination', 'conquest'];
    for (const mode of modes) {
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = MODE_LABELS[mode];
      select.appendChild(opt);
    }
  }

  function mapsForMode(mode) {
    return catalog.filter(map => mode === 'all' || mapMode(map) === mode);
  }

  function renderChangeMapOptions() {
    const select = document.querySelector('#mapSelect');
    const modeSelect = document.querySelector('#mapGameMode');
    if (!select || !modeSelect || !catalog.length) return;

    const old = select.value;
    renderingChangeSelect = true;
    select.innerHTML = '<option value="">Select map...</option>';
    for (const map of mapsForMode(modeSelect.value)) {
      const opt = document.createElement('option');
      opt.value = map;
      opt.textContent = mapLabel(map);
      select.appendChild(opt);
    }
    if ([...select.options].some(o => o.value === old)) select.value = old;
    renderingChangeSelect = false;
  }

  function installGameModeSelector() {
    const form = document.querySelector('#changeMapForm');
    const mapSelect = document.querySelector('#mapSelect');
    if (!form || !mapSelect || document.querySelector('#mapGameMode')) return;

    const label = document.createElement('label');
    label.className = 'map-mode-label';
    label.innerHTML = 'Game Mode<select id="mapGameMode"></select>';
    form.insertBefore(label, mapSelect.closest('label'));
    const select = label.querySelector('select');
    modeOptions(select, true);
    select.addEventListener('change', renderChangeMapOptions);

    const note = document.createElement('div');
    note.className = 'map-mode-note';
    note.textContent = 'Choose a game mode first; the Map list will only show matching HLL:V maps.';
    form.insertBefore(note, mapSelect.closest('label'));

    const observer = new MutationObserver(() => {
      if (!renderingChangeSelect) setTimeout(renderChangeMapOptions, 0);
    });
    observer.observe(mapSelect, { childList: true });

    const refresh = document.querySelector('#maps [data-refresh="maps"]');
    if (refresh) refresh.addEventListener('click', () => setTimeout(renderChangeMapOptions, 150));
  }

  function installChangeMapSubmitOverride() {
    const form = document.querySelector('#changeMapForm');
    const select = document.querySelector('#mapSelect');
    if (!form || !select || form.dataset.hllvModeAware === '1') return;
    form.dataset.hllvModeAware = '1';

    form.addEventListener('submit', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const mapName = String(select.value || '').trim().toLowerCase();
      if (!mapName) return;
      if (!catalog.includes(mapName)) {
        if (typeof window.toast === 'function') window.toast('That map is not in the configured HLL:V catalog.', 'error');
        else alert('That map is not in the configured HLL:V catalog.');
        return;
      }
      if (!confirm(`Change the live server to ${mapLabel(mapName)} now?`)) return;
      const button = form.querySelector('button[type="submit"]');
      const oldText = button?.textContent;
      if (button) { button.disabled = true; button.textContent = 'Changing Map...'; }
      try {
        await api('/api/v2/map-change', {
          method: 'POST',
          body: JSON.stringify({ map_name: mapName })
        });
        if (typeof window.toast === 'function') window.toast(`Map change sent: ${mapLabel(mapName)}`);
        setTimeout(() => {
          document.querySelector('[data-refresh="server"]')?.click();
          document.querySelector('#maps [data-refresh="maps"]')?.click();
        }, 1200);
      } catch (err) {
        if (typeof window.toast === 'function') window.toast(err.message, 'error');
        else alert(err.message);
      } finally {
        if (button) { button.disabled = false; button.textContent = oldText || 'Change Map Now'; }
      }
    }, true);
  }

  function parseRotation(data) {
    if (!data || typeof data !== 'object') return [];
    const entries = data.maps || data.mAPS || data.MAPS || data.rotation || [];
    if (!Array.isArray(entries)) return [];
    return entries.map(entry => {
      if (typeof entry === 'string') return entry.toLowerCase();
      return String(entry?.name || entry?.mapName || entry?.map_name || '').trim().toLowerCase();
    }).filter(Boolean);
  }

  function renderRotationMapOptions() {
    const modeSelect = document.querySelector('#rotationGameMode');
    const mapSelect = document.querySelector('#rotationMapSelect');
    if (!modeSelect || !mapSelect) return;
    mapSelect.innerHTML = '<option value="">Select map to add...</option>';
    for (const map of mapsForMode(modeSelect.value)) {
      const opt = document.createElement('option');
      opt.value = map;
      opt.textContent = mapLabel(map);
      mapSelect.appendChild(opt);
    }
  }

  function renderDraft() {
    const list = document.querySelector('#rotationDraftList');
    const count = document.querySelector('#rotationDraftCount');
    if (!list) return;
    if (count) count.textContent = `${rotationDraft.length} map${rotationDraft.length === 1 ? '' : 's'}`;

    list.innerHTML = '';
    if (!rotationDraft.length) {
      const empty = document.createElement('div');
      empty.className = 'rotation-empty';
      empty.textContent = 'No maps in the draft rotation. Load the current rotation or add maps.';
      list.appendChild(empty);
      return;
    }

    rotationDraft.forEach((map, index) => {
      const li = document.createElement('li');
      li.className = 'rotation-draft-item';

      const num = document.createElement('span');
      num.className = 'rotation-index';
      num.textContent = String(index + 1);

      const info = document.createElement('div');
      info.className = 'rotation-map-name';
      const strong = document.createElement('strong');
      strong.textContent = mapLabel(map);
      const small = document.createElement('small');
      small.textContent = map;
      info.append(strong, small);

      const actions = document.createElement('div');
      actions.className = 'rotation-item-actions';
      const specs = [
        ['↑', 'Move up', () => moveDraft(index, -1)],
        ['↓', 'Move down', () => moveDraft(index, 1)],
        ['×', 'Remove', () => { rotationDraft.splice(index, 1); renderDraft(); }]
      ];
      for (const [text, title, handler] of specs) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ghost small';
        b.textContent = text;
        b.title = title;
        b.disabled = (text === '↑' && index === 0) || (text === '↓' && index === rotationDraft.length - 1);
        b.addEventListener('click', handler);
        actions.appendChild(b);
      }

      li.append(num, info, actions);
      list.appendChild(li);
    });
  }

  function moveDraft(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= rotationDraft.length) return;
    [rotationDraft[index], rotationDraft[target]] = [rotationDraft[target], rotationDraft[index]];
    renderDraft();
  }

  function setRotationStatus(text, isError = false) {
    const el = document.querySelector('#rotationManagerStatus');
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? '#e46b66' : '';
  }

  async function loadCurrentRotation() {
    const button = document.querySelector('#loadRotationBtn');
    if (button) { button.disabled = true; button.textContent = 'Loading...'; }
    setRotationStatus('Loading current server rotation...');
    try {
      const [rotation, shuffle] = await Promise.all([
        api('/api/v2/map-rotation'),
        api('/api/v2/map-shuffle')
      ]);
      rotationDraft = parseRotation(rotation).filter(map => catalog.includes(map));
      const shuffleBox = document.querySelector('#rotationShuffle');
      if (shuffleBox) shuffleBox.checked = Boolean(shuffle?.enabled);
      renderDraft();
      setRotationStatus(`Loaded ${rotationDraft.length} map(s) from the live server.`);
    } catch (err) {
      setRotationStatus(err.message, true);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Load Current Rotation'; }
    }
  }

  async function applyRotation() {
    if (!rotationDraft.length) {
      setRotationStatus('Add at least one map before applying the rotation.', true);
      return;
    }
    if (!confirm(`Replace the live server rotation with these ${rotationDraft.length} map entries?`)) return;

    const button = document.querySelector('#applyRotationBtn');
    if (button) { button.disabled = true; button.textContent = 'Applying...'; }
    setRotationStatus('Applying rotation to HLL:V. Existing rotation is protected with rollback if an RCON command fails...');
    try {
      const result = await api('/api/v2/map-rotation', {
        method: 'PUT',
        body: JSON.stringify({
          maps: rotationDraft,
          shuffle: Boolean(document.querySelector('#rotationShuffle')?.checked)
        })
      });
      rotationDraft = Array.isArray(result?.maps) ? result.maps.map(x => String(x).toLowerCase()) : rotationDraft;
      renderDraft();
      const rotationBox = document.querySelector('#rotationBox');
      if (rotationBox && result?.rotation) rotationBox.textContent = JSON.stringify(result.rotation, null, 2);
      setRotationStatus(`Rotation applied successfully. Shuffle is ${result?.shuffle ? 'ON' : 'OFF'}.`);
    } catch (err) {
      setRotationStatus(err.message, true);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Apply Rotation to Server'; }
    }
  }

  function installRotationBuilder() {
    const mapsView = document.querySelector('#maps');
    if (!mapsView || document.querySelector('#rotationManagerPanel')) return;

    const panel = document.createElement('article');
    panel.id = 'rotationManagerPanel';
    panel.className = 'panel rotation-manager-panel';
    panel.innerHTML = `
      <div class="panel-head">
        <div><p class="eyebrow">ROTATION BUILDER</p><h3>Set Map Rotation</h3></div>
        <button id="loadRotationBtn" class="btn ghost small" type="button">Load Current Rotation</button>
      </div>
      <div class="rotation-builder-grid">
        <div class="stack">
          <label>Game Mode<select id="rotationGameMode"></select></label>
          <label>Map<select id="rotationMapSelect"><option value="">Select map to add...</option></select></label>
          <button id="addRotationMapBtn" class="btn primary" type="button">Add Map to Rotation</button>
          <label class="shuffle-row"><input id="rotationShuffle" type="checkbox" /> Shuffle rotation</label>
          <p class="muted" style="margin:0">Maps can be added more than once. Use the arrows to set the exact order.</p>
        </div>
        <div>
          <div class="panel-head" style="margin-bottom:10px"><div><strong>Draft Rotation</strong> <span id="rotationDraftCount" class="rotation-count">0 maps</span></div></div>
          <ol id="rotationDraftList" class="rotation-draft"></ol>
        </div>
      </div>
      <div class="rotation-footer">
        <p id="rotationManagerStatus" class="rotation-status">Load the current server rotation or build a new one.</p>
        <div class="action-row">
          <button id="clearRotationDraftBtn" class="btn ghost small" type="button">Clear Draft</button>
          <button id="applyRotationBtn" class="btn danger" type="button">Apply Rotation to Server</button>
        </div>
      </div>`;

    const sequencePanel = [...mapsView.querySelectorAll(':scope > article.panel')].find(x => x.querySelector('h3')?.textContent?.includes('Map Sequence'));
    if (sequencePanel) mapsView.insertBefore(panel, sequencePanel);
    else mapsView.appendChild(panel);

    const modeSelect = panel.querySelector('#rotationGameMode');
    modeOptions(modeSelect, true);
    modeSelect.addEventListener('change', renderRotationMapOptions);
    panel.querySelector('#addRotationMapBtn').addEventListener('click', () => {
      const value = panel.querySelector('#rotationMapSelect').value;
      if (!value) return setRotationStatus('Select a map first.', true);
      rotationDraft.push(value);
      renderDraft();
      setRotationStatus(`${mapLabel(value)} added to the draft.`);
    });
    panel.querySelector('#clearRotationDraftBtn').addEventListener('click', () => {
      rotationDraft = [];
      renderDraft();
      setRotationStatus('Draft cleared. The live server rotation has not been changed.');
    });
    panel.querySelector('#loadRotationBtn').addEventListener('click', loadCurrentRotation);
    panel.querySelector('#applyRotationBtn').addEventListener('click', applyRotation);
    renderRotationMapOptions();
    renderDraft();

    const mapsNav = document.querySelector('.nav-item[data-view="maps"]');
    if (mapsNav) mapsNav.addEventListener('click', () => setTimeout(loadCurrentRotation, 120));
  }

  async function init() {
    try {
      const raw = await api('/api/v2/map-catalog');
      const entries = Array.isArray(raw?.maps) ? raw.maps : [];
      catalog = entries
        .map(entry => typeof entry === 'string' ? entry : entry?.id)
        .map(x => String(x || '').trim().toLowerCase())
        .filter(Boolean);
      if (!catalog.length) throw new Error('Empty map catalog');
    } catch {
      catalog = [...FALLBACK_CATALOG];
    }
    installGameModeSelector();
    installChangeMapSubmitOverride();
    installRotationBuilder();
    renderChangeMapOptions();
  }

  window.addEventListener('load', init);
})();
