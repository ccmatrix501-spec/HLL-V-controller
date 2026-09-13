(() => {
  async function removeAccess(kind, playerId) {
    const id = String(playerId || '').trim();
    if (!id) throw new Error('Player ID is required');

    const label = kind === 'admins' ? 'admin' : 'VIP';
    if (!confirm(`Remove ${id} from the ${label} list?`)) return false;

    const res = await fetch(`/api/v2/${kind}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: id })
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
    loadAdminLogViewerAssets();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
