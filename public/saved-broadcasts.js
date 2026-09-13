(() => {
  const DRAFT_KEY = '1stmi_hllv_broadcast_draft_v1';
  const SAVED_KEY = '1stmi_hllv_saved_broadcasts_v1';

  function readSaved() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(x => x && x.name && x.message) : [];
    } catch {
      return [];
    }
  }

  function writeSaved(items) {
    localStorage.setItem(SAVED_KEY, JSON.stringify(items.slice(0, 100)));
  }

  function installStyles() {
    if (document.querySelector('#savedBroadcastStyles')) return;
    const style = document.createElement('style');
    style.id = 'savedBroadcastStyles';
    style.textContent = `
      .saved-broadcasts { border:1px solid var(--line,#344238); border-radius:12px; padding:12px; display:grid; gap:10px; background:rgba(255,255,255,.015); }
      .saved-broadcasts-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .saved-broadcasts-grid { display:grid; grid-template-columns:minmax(140px,1fr) minmax(170px,1fr) auto auto auto; gap:8px; align-items:end; }
      .saved-broadcasts-grid label { margin:0; }
      @media (max-width:900px){.saved-broadcasts-grid{grid-template-columns:1fr 1fr}.saved-broadcasts-grid .btn{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function install() {
    const form = document.querySelector('#broadcastForm');
    const box = document.querySelector('#broadcastText');
    if (!form || !box || document.querySelector('#savedBroadcastsPanel')) return;
    installStyles();

    const storedDraft = localStorage.getItem(DRAFT_KEY);
    if (storedDraft && !box.value) {
      box.value = storedDraft;
      if (typeof window.updateBroadcastCounter === 'function') window.updateBroadcastCounter();
    }

    const panel = document.createElement('div');
    panel.id = 'savedBroadcastsPanel';
    panel.className = 'saved-broadcasts';
    panel.innerHTML = `
      <div class="saved-broadcasts-head"><div><span class="repeat-kicker">SAVED BROADCASTS</span><div class="muted">Saved in this browser and kept through controller updates.</div></div></div>
      <div class="saved-broadcasts-grid">
        <label>Saved message<select id="savedBroadcastSelect"><option value="">Select saved message...</option></select></label>
        <label>Name<input id="savedBroadcastName" maxlength="60" placeholder="e.g. Friday Recruitment" /></label>
        <button id="savedBroadcastSave" class="btn primary small" type="button">Save</button>
        <button id="savedBroadcastLoad" class="btn ghost small" type="button">Load</button>
        <button id="savedBroadcastDelete" class="btn danger-outline small" type="button">Delete</button>
      </div>`;

    const templateBar = document.querySelector('#broadcastTemplateBar');
    if (templateBar) templateBar.insertAdjacentElement('afterend', panel);
    else form.insertBefore(panel, box);

    const select = panel.querySelector('#savedBroadcastSelect');
    const nameInput = panel.querySelector('#savedBroadcastName');

    function renderSaved() {
      const items = readSaved();
      const old = select.value;
      select.innerHTML = '<option value="">Select saved message...</option>';
      items.forEach((item, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = item.name;
        select.appendChild(option);
      });
      if ([...select.options].some(o => o.value === old)) select.value = old;
    }

    function saveDraft() {
      localStorage.setItem(DRAFT_KEY, box.value);
    }

    box.addEventListener('input', saveDraft);
    form.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      setTimeout(() => {
        if (button.textContent.trim() === 'Clear') localStorage.removeItem(DRAFT_KEY);
        else if (button.closest('#broadcastTemplateBar')) saveDraft();
      }, 0);
    });

    panel.querySelector('#savedBroadcastSave').addEventListener('click', () => {
      const name = nameInput.value.trim();
      const message = box.value.trim();
      if (!name) return window.toast?.('Give the saved broadcast a name.', 'error');
      if (!message) return window.toast?.('Enter a broadcast message first.', 'error');
      const items = readSaved();
      const existing = items.findIndex(item => item.name.toLowerCase() === name.toLowerCase());
      const record = { name, message, updated_at: new Date().toISOString() };
      if (existing >= 0) items[existing] = record;
      else items.push(record);
      writeSaved(items);
      saveDraft();
      renderSaved();
      const idx = readSaved().findIndex(item => item.name.toLowerCase() === name.toLowerCase());
      select.value = idx >= 0 ? String(idx) : '';
      window.toast?.(existing >= 0 ? 'Saved broadcast updated.' : 'Broadcast saved.');
    });

    panel.querySelector('#savedBroadcastLoad').addEventListener('click', () => {
      const index = Number(select.value);
      const items = readSaved();
      if (!Number.isInteger(index) || !items[index]) return window.toast?.('Choose a saved broadcast first.', 'error');
      box.value = items[index].message;
      nameInput.value = items[index].name;
      saveDraft();
      if (typeof window.updateBroadcastCounter === 'function') window.updateBroadcastCounter();
      box.focus();
    });

    panel.querySelector('#savedBroadcastDelete').addEventListener('click', () => {
      const index = Number(select.value);
      const items = readSaved();
      if (!Number.isInteger(index) || !items[index]) return window.toast?.('Choose a saved broadcast first.', 'error');
      if (!confirm(`Delete saved broadcast “${items[index].name}”?`)) return;
      items.splice(index, 1);
      writeSaved(items);
      select.value = '';
      nameInput.value = '';
      renderSaved();
      window.toast?.('Saved broadcast deleted.');
    });

    select.addEventListener('change', () => {
      const index = Number(select.value);
      const items = readSaved();
      nameInput.value = Number.isInteger(index) && items[index] ? items[index].name : '';
    });

    renderSaved();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
