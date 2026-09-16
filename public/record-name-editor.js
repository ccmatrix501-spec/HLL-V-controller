(() => {
  const $ = (selector) => document.querySelector(selector);
  const labels = {};
  const statsNames = {};
  const configs = [
    { boxId: 'vipBox', editorId: 'vipNameEditor', type: 'VIP', listKeys: ['vips', 'vipUsers', 'items'] },
    { boxId: 'adminBox', editorId: 'adminNameEditor', type: 'Admin', listKeys: ['adminUsers', 'admins', 'items'] },
    { boxId: 'tempBansBox', editorId: 'tempBanNameEditor', type: 'Temporary Ban', listKeys: ['banList', 'bans', 'items'] },
    { boxId: 'permaBansBox', editorId: 'permaBanNameEditor', type: 'Permanent Ban', listKeys: ['banList', 'bans', 'items'] }
  ];

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function parseBox(box) {
    const text = String(box?.textContent || '').trim();
    if (!text || text === '—') return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  function listFrom(data, keys) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of keys) if (Array.isArray(data[key])) return data[key];
    return [];
  }

  function recordId(record) {
    return String(record?.userId || record?.player_id || record?.playerId || record?.id || record?.ID || '').trim();
  }

  function nativeName(record, type) {
    const explicit = String(record?.userName || record?.username || record?.player_name || record?.playerName || record?.name || '').trim();
    if (explicit) return explicit;
    // qPanel/HLL stores an optional comment for VIP/admin records. Existing
    // installs commonly use that field for the person's name.
    if (type === 'VIP' || type === 'Admin') {
      const comment = String(record?.comment || '').trim();
      if (comment) return comment;
    }
    return '';
  }

  function secondary(record, type) {
    const parts = [];
    if (type === 'Admin' && record?.group) parts.push(`Group: ${record.group}`);
    if (type.includes('Ban')) {
      if (record?.banReason) parts.push(`Reason: ${record.banReason}`);
      if (record?.durationHours !== undefined && Number(record.durationHours) > 0) parts.push(`Duration: ${record.durationHours}h`);
      if (record?.adminName) parts.push(`Admin: ${record.adminName}`);
    }
    return parts.join(' • ');
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const message = data && typeof data === 'object' ? (data.error || data.detail) : data;
      throw new Error(message || `${response.status} ${response.statusText}`);
    }
    return data;
  }

  async function loadLookups() {
    const [labelResult, statsResult] = await Promise.allSettled([
      api('/api/v2/player-labels'),
      api('/api/v2/public-player-stats?limit=10000')
    ]);

    if (labelResult.status === 'fulfilled') {
      Object.assign(labels, labelResult.value?.labels || {});
    }
    if (statsResult.status === 'fulfilled') {
      for (const player of statsResult.value?.players || []) {
        const id = String(player?.player_id || '').trim();
        const name = String(player?.player_name || '').trim();
        if (id && name) statsNames[id] = name;
      }
    }
  }

  async function saveName(id, name) {
    const clean = String(name || '').trim();
    if (!id) throw new Error('Player ID is missing from this record.');
    if (!clean) throw new Error('Enter a player name first.');
    await api(`/api/v2/player-labels/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ name: clean })
    });
    labels[id] = clean;
  }

  async function clearName(id) {
    if (!id) throw new Error('Player ID is missing from this record.');
    await api(`/api/v2/player-labels/${encodeURIComponent(id)}`, { method: 'DELETE' });
    delete labels[id];
  }

  function injectStyles() {
    if ($('#recordNameEditorStyle')) return;
    const style = document.createElement('style');
    style.id = 'recordNameEditorStyle';
    style.textContent = `
      .record-name-editor{display:grid;gap:9px;margin-top:10px}
      .record-name-row{display:grid;grid-template-columns:minmax(180px,1.1fr) minmax(250px,1.6fr) auto;gap:10px;align-items:center;padding:10px;border:1px solid rgba(255,255,255,.11);border-radius:10px;background:rgba(255,255,255,.025)}
      .record-name-id{font-family:monospace;font-size:.78rem;opacity:.72;word-break:break-all}.record-name-meta{font-size:.79rem;opacity:.7;margin-top:3px}
      .record-name-input{width:100%;min-width:0}.record-name-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
      .record-name-empty{padding:14px 2px;opacity:.7}.record-name-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:8px}
      .record-name-heading h4{margin:0}.record-name-note{font-size:.8rem;opacity:.72;margin:3px 0 0}.record-raw-toggle{margin-left:auto}
      @media(max-width:850px){.record-name-row{grid-template-columns:1fr}.record-name-actions{justify-content:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function buildEditor(config, box) {
    let editor = document.getElementById(config.editorId);
    if (editor) return editor;

    editor = document.createElement('div');
    editor.id = config.editorId;
    editor.className = 'record-name-editor';

    const header = document.createElement('div');
    header.className = 'record-name-heading';
    header.innerHTML = `<div><h4>Edit Player Names</h4><p class="record-name-note">Names are saved by user ID and stay available after controller updates. Existing stats history is used as a suggested name when available.</p></div>`;

    const rawButton = document.createElement('button');
    rawButton.type = 'button';
    rawButton.className = 'btn ghost small record-raw-toggle';
    rawButton.textContent = 'Show Raw Data';
    rawButton.addEventListener('click', () => {
      const hidden = box.style.display === 'none';
      box.style.display = hidden ? '' : 'none';
      rawButton.textContent = hidden ? 'Hide Raw Data' : 'Show Raw Data';
    });
    header.appendChild(rawButton);

    const list = document.createElement('div');
    list.dataset.recordList = 'true';
    editor.append(header, list);
    box.insertAdjacentElement('beforebegin', editor);
    box.style.display = 'none';
    return editor;
  }

  function renderConfig(config) {
    const box = document.getElementById(config.boxId);
    if (!box) return;
    const editor = buildEditor(config, box);
    const list = editor.querySelector('[data-record-list]');
    const data = parseBox(box);

    if (!data) {
      list.innerHTML = '<div class="record-name-empty">Waiting for server data…</div>';
      return;
    }

    const records = listFrom(data, config.listKeys);
    if (!records.length) {
      list.innerHTML = '<div class="record-name-empty">No entries.</div>';
      return;
    }

    list.innerHTML = records.map((record, index) => {
      const id = recordId(record);
      const existing = labels[id] || '';
      const native = nativeName(record, config.type);
      const suggested = statsNames[id] || '';
      const value = existing || native || suggested;
      const source = existing ? 'Saved controller name' : native ? 'Existing server name/comment' : suggested ? 'Suggested from stats history' : 'No name saved';
      const meta = secondary(record, config.type);
      return `
        <div class="record-name-row" data-record-index="${index}">
          <div>
            <div><strong>${esc(value || 'Unnamed player')}</strong></div>
            <div class="record-name-id">${esc(id || 'No user ID')}</div>
            ${meta ? `<div class="record-name-meta">${esc(meta)}</div>` : ''}
          </div>
          <div>
            <input class="record-name-input" value="${esc(value)}" placeholder="Enter player name" maxlength="80" />
            <div class="record-name-meta">${esc(source)}</div>
          </div>
          <div class="record-name-actions">
            <button type="button" class="btn primary small record-name-save" ${id ? '' : 'disabled'}>Save Name</button>
            ${existing ? `<button type="button" class="btn ghost small record-name-clear" ${id ? '' : 'disabled'}>Clear</button>` : ''}
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.record-name-row').forEach((row) => {
      const index = Number(row.dataset.recordIndex);
      const record = records[index];
      const id = recordId(record);
      const input = row.querySelector('.record-name-input');
      const save = row.querySelector('.record-name-save');
      const clear = row.querySelector('.record-name-clear');

      save?.addEventListener('click', async () => {
        const old = save.textContent;
        save.disabled = true;
        save.textContent = 'Saving...';
        try {
          await saveName(id, input.value);
          if (typeof window.toast === 'function') window.toast(`Name saved for ${input.value.trim()}`);
          renderAll();
        } catch (error) {
          if (typeof window.toast === 'function') window.toast(error.message, 'error');
          else alert(error.message);
        } finally {
          save.disabled = false;
          save.textContent = old;
        }
      });

      clear?.addEventListener('click', async () => {
        if (!confirm(`Clear the saved controller name for ${id}?`)) return;
        try {
          await clearName(id);
          if (typeof window.toast === 'function') window.toast('Saved name cleared');
          renderAll();
        } catch (error) {
          if (typeof window.toast === 'function') window.toast(error.message, 'error');
          else alert(error.message);
        }
      });
    });
  }

  function renderAll() {
    for (const config of configs) renderConfig(config);
  }

  function watchBoxes() {
    for (const config of configs) {
      const box = document.getElementById(config.boxId);
      if (!box) continue;
      new MutationObserver(() => renderConfig(config)).observe(box, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
  }

  async function install() {
    injectStyles();
    await loadLookups().catch(() => {});
    renderAll();
    watchBoxes();

    document.querySelector('[data-view="access"]')?.addEventListener('click', () => setTimeout(renderAll, 200));
    document.querySelector('[data-view="bans"]')?.addEventListener('click', () => setTimeout(renderAll, 200));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
