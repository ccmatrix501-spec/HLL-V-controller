(() => {
  async function apiRequest(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) {
      const message = data && typeof data === 'object'
        ? (data.error || data.detail || `${res.status} ${res.statusText}`)
        : (data || `${res.status} ${res.statusText}`);
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }
    return data;
  }

  async function removeAccess(kind, playerId) {
    const id = String(playerId || '').trim();
    if (!id) throw new Error('Player ID is required');

    const label = kind === 'admins' ? 'admin' : 'VIP';
    if (!confirm(`Remove ${id} from the ${label} list?`)) return false;

    await apiRequest(`/api/v2/${kind}`, {
      method: 'DELETE',
      body: JSON.stringify({ player_id: id })
    });
    return true;
  }

  function addRemoveForm(addFormId, kind, title) {
    const addForm = document.getElementById(addFormId);
    if (!addForm || document.getElementById(`remove-${kind}-form`)) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'access-remove-block';

    const heading = document.createElement('h4');
    heading.textContent = `Remove ${title}`;
    heading.style.margin = '14px 0 8px';

    const form = document.createElement('form');
    form.id = `remove-${kind}-form`;
    form.className = 'mini-form';

    const input = document.createElement('input');
    input.id = `remove-${kind}-id`;
    input.placeholder = 'Player ID';
    input.required = true;

    const button = document.createElement('button');
    button.type = 'submit';
    button.className = 'btn danger-outline';
    button.textContent = `Remove ${title}`;

    form.append(input, button);
    wrapper.append(heading, form);
    addForm.insertAdjacentElement('afterend', wrapper);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const oldText = button.textContent;
      button.disabled = true;
      button.textContent = 'Removing...';
      try {
        const removed = await removeAccess(kind, input.value);
        if (!removed) return;
        input.value = '';
        if (typeof window.toast === 'function') window.toast(`${title} removed`);
        if (typeof window.loadAccess === 'function') await window.loadAccess();
      } catch (error) {
        if (typeof window.toast === 'function') window.toast(error.message, 'error');
        else alert(error.message);
      } finally {
        button.disabled = false;
        button.textContent = oldText;
      }
    });
  }

  function refreshBans() {
    if (typeof window.loadBans === 'function') {
      Promise.resolve(window.loadBans()).catch(() => {});
      return;
    }
    document.querySelector('[data-refresh="bans"]')?.click();
  }

  function installBanByIdForm() {
    const section = document.getElementById('bans');
    if (!section || document.getElementById('banByIdForm')) return;

    const removePanel = document.getElementById('unbanForm')?.closest('article.panel');
    const panel = document.createElement('article');
    panel.className = 'panel';
    panel.id = 'banByIdPanel';

    const heading = document.createElement('div');
    heading.className = 'panel-head';
    heading.innerHTML = '<div><p class="eyebrow">MODERATION</p><h3>Ban Player by ID</h3></div>';

    const help = document.createElement('p');
    help.className = 'muted';
    help.textContent = 'Ban a player using their HLL:V / platform user ID, even if you are entering it manually.';

    const form = document.createElement('form');
    form.id = 'banByIdForm';
    form.className = 'stack';

    const typeLabel = document.createElement('label');
    typeLabel.textContent = 'Ban Type';
    const type = document.createElement('select');
    type.id = 'banByIdType';
    type.innerHTML = '<option value="temp">Temporary Ban</option><option value="perma">Permanent Ban</option>';
    typeLabel.appendChild(type);

    const idLabel = document.createElement('label');
    idLabel.textContent = 'Player / User ID';
    const id = document.createElement('input');
    id.id = 'banByIdPlayerId';
    id.placeholder = 'Paste player ID';
    id.autocomplete = 'off';
    id.required = true;
    idLabel.appendChild(id);

    const durationLabel = document.createElement('label');
    durationLabel.id = 'banByIdDurationLabel';
    durationLabel.textContent = 'Duration (hours)';
    const duration = document.createElement('input');
    duration.id = 'banByIdDuration';
    duration.type = 'number';
    duration.min = '1';
    duration.value = '24';
    duration.required = true;
    durationLabel.appendChild(duration);

    const reasonLabel = document.createElement('label');
    reasonLabel.textContent = 'Reason';
    const reason = document.createElement('input');
    reason.id = 'banByIdReason';
    reason.placeholder = 'Reason for ban';
    reason.value = 'Banned by server administration';
    reasonLabel.appendChild(reason);

    const adminLabel = document.createElement('label');
    adminLabel.textContent = 'Admin Name';
    const admin = document.createElement('input');
    admin.id = 'banByIdAdminName';
    admin.value = '1st M.I. Admin';
    adminLabel.appendChild(admin);

    const button = document.createElement('button');
    button.type = 'submit';
    button.className = 'btn danger';
    button.textContent = 'Ban Player';

    const error = document.createElement('p');
    error.id = 'banByIdError';
    error.className = 'error';

    function syncType() {
      const isTemp = type.value === 'temp';
      durationLabel.classList.toggle('hidden', !isTemp);
      duration.required = isTemp;
      button.textContent = isTemp ? 'Temporary Ban Player' : 'Permanently Ban Player';
    }

    type.addEventListener('change', syncType);

    form.append(typeLabel, idLabel, durationLabel, reasonLabel, adminLabel, button, error);
    panel.append(heading, help, form);
    if (removePanel) section.insertBefore(panel, removePanel);
    else section.appendChild(panel);
    syncType();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';

      const playerId = id.value.trim();
      const banType = type.value;
      const durationHours = Number(duration.value);
      const banReason = reason.value.trim() || 'Banned by server administration';
      const adminName = admin.value.trim() || '1st M.I. Admin';

      if (!playerId) {
        error.textContent = 'Player ID is required.';
        return;
      }
      if (banType === 'temp' && (!Number.isInteger(durationHours) || durationHours < 1)) {
        error.textContent = 'Temporary ban duration must be at least 1 hour.';
        return;
      }

      const description = banType === 'temp'
        ? `${durationHours}-hour temporary ban`
        : 'permanent ban';
      if (!confirm(`Apply a ${description} to player ID ${playerId}?`)) return;

      const oldText = button.textContent;
      button.disabled = true;
      button.textContent = 'Applying Ban...';
      try {
        if (banType === 'temp') {
          await apiRequest('/api/v2/temp-ban', {
            method: 'POST',
            body: JSON.stringify({
              player_id: playerId,
              duration: durationHours,
              reason: banReason,
              admin_name: adminName
            })
          });
        } else {
          await apiRequest('/api/v2/perma-ban', {
            method: 'POST',
            body: JSON.stringify({
              player_id: playerId,
              reason: banReason,
              admin_name: adminName
            })
          });
        }

        if (typeof window.toast === 'function') {
          window.toast(banType === 'temp' ? 'Temporary ban added' : 'Permanent ban added');
        }
        id.value = '';
        refreshBans();
      } catch (err) {
        error.textContent = err.message;
        if (typeof window.toast === 'function') window.toast(err.message, 'error');
      } finally {
        button.disabled = false;
        syncType();
        if (!button.textContent) button.textContent = oldText;
      }
    });
  }

  function loadAdminLogViewerAssets() {
    if (!document.querySelector('link[href="/admin-logs.css"]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = '/admin-logs.css';
      document.head.appendChild(css);
    }
    if (!document.querySelector('script[src="/admin-logs.js"]')) {
      const script = document.createElement('script');
      script.src = '/admin-logs.js';
      script.defer = true;
      document.head.appendChild(script);
    }
  }

  function install() {
    addRemoveForm('vipForm', 'vips', 'VIP');
    addRemoveForm('adminForm', 'admins', 'Admin');
    installBanByIdForm();
    loadAdminLogViewerAssets();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
