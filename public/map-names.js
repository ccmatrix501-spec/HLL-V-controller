(() => {
  const MAPS = {
    wdeva: 'Vạn Tường',
    wdevb: 'Quảng Ngãi',
    wdevc: 'Huế Outskirts',
    wdevd: 'Đăk Tô Airfield',
    wdeve: 'Cam Ranh Port',
    wdevf: 'Thanh Hòa Bridge'
  };

  const MODES = {
    warfare: 'Warfare',
    offensivenva: 'Offensive - NVA',
    offensiveus: 'Offensive - US',
    domination: 'Domination',
    conquest: 'Conquest'
  };

  function labelFor(layer) {
    const id = String(layer || '').trim().toLowerCase();
    const match = id.match(/^(wdev[a-f])_(warfare|offensivenva|offensiveus|domination|conquest)_(day|night)$/i);
    if (!match) return layer;
    const [, mapId, modeId, tod] = match;
    return `${MAPS[mapId] || mapId.toUpperCase()} — ${MODES[modeId] || modeId} — ${tod === 'day' ? 'Day' : 'Night'}`;
  }

  function replaceLayerIds(text) {
    let output = String(text || '');
    const ids = [];
    for (const mapId of Object.keys(MAPS)) {
      for (const modeId of Object.keys(MODES)) ids.push(`${mapId}_${modeId}_day`);
    }
    ids.sort((a, b) => b.length - a.length);
    for (const id of ids) output = output.replaceAll(id, labelFor(id));
    return output;
  }

  function setTextIfChanged(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

  function patchSelect(select) {
    if (!select) return;
    for (const option of select.options) {
      const value = String(option.value || '').toLowerCase();
      if (/^wdev[a-f]_/.test(value)) setTextIfChanged(option, labelFor(value));
    }
  }

  function patchRotationDraft() {
    document.querySelectorAll('#rotationDraftList .rotation-draft-item').forEach(item => {
      const small = item.querySelector('small');
      const strong = item.querySelector('strong');
      if (!small || !strong) return;
      const id = small.textContent.trim().toLowerCase();
      if (/^wdev[a-f]_/.test(id)) setTextIfChanged(strong, labelFor(id));
    });
  }

  function patchSummary() {
    for (const selector of ['#statMap', '#statNextMap']) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const raw = String(el.textContent || '').trim().toLowerCase();
      if (/^wdev[a-f]_/.test(raw)) setTextIfChanged(el, labelFor(raw));
    }
  }

  function patchRawBox(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    const current = String(el.textContent || '');
    const changed = replaceLayerIds(current);
    if (changed !== current) el.textContent = changed;
  }

  function patchAll() {
    patchSelect(document.querySelector('#mapSelect'));
    patchSelect(document.querySelector('#rotationMapSelect'));
    patchRotationDraft();
    patchSummary();
    patchRawBox('#rotationBox');
    patchRawBox('#sequenceBox');
  }

  function install() {
    patchAll();
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        patchAll();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(patchSummary, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
