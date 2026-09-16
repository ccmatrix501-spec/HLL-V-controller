(() => {
  const NORMAL_ID = 'adminLogNormalPane';
  const TEAMKILL_ID = 'adminLogTeamkillPane';

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function setActive(view) {
    const normalPane = document.getElementById(NORMAL_ID);
    const teamkillPane = document.getElementById(TEAMKILL_ID);
    const tabs = document.querySelectorAll('.admin-log-subtab');
    if (!normalPane || !teamkillPane) return;

    const showTeamkill = view === 'teamkill';
    normalPane.hidden = showTeamkill;
    teamkillPane.hidden = !showTeamkill;

    tabs.forEach((button) => {
      const active = button.dataset.adminLogSubtab === (showTeamkill ? 'teamkill' : 'normal');
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });

    try { sessionStorage.setItem('hll-admin-log-subtab', showTeamkill ? 'teamkill' : 'normal'); } catch {}
  }

  function moveTeamkillPanels() {
    const pane = document.getElementById(TEAMKILL_ID);
    if (!pane) return;
    const repeat = document.getElementById('teamkillWatch');
    const commander = document.getElementById('commanderTkWatch');
    if (repeat && repeat.parentElement !== pane) pane.appendChild(repeat);
    if (commander && commander.parentElement !== pane) pane.appendChild(commander);
  }

  function install() {
    const viewer = document.getElementById('adminLogsViewer');
    if (!viewer || document.getElementById('adminLogSubtabs')) return false;

    const toolbar = $('#adminLogSearch', viewer)?.closest('.admin-log-toolbar');
    const rows = document.getElementById('adminLogRows');
    if (!toolbar || !rows) return false;

    const tabs = document.createElement('div');
    tabs.id = 'adminLogSubtabs';
    tabs.className = 'admin-log-subtabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Admin log views');
    tabs.innerHTML = `
      <button type="button" class="admin-log-subtab active" data-admin-log-subtab="normal" role="tab" aria-selected="true">
        <span class="admin-log-subtab-title">Admin Logs</span>
        <span class="admin-log-subtab-note">All server and moderation events</span>
      </button>
      <button type="button" class="admin-log-subtab" data-admin-log-subtab="teamkill" role="tab" aria-selected="false" tabindex="-1">
        <span class="admin-log-subtab-title">Teamkill Watch</span>
        <span class="admin-log-subtab-note">Repeat TKs and commander abilities</span>
      </button>`;

    const normalPane = document.createElement('div');
    normalPane.id = NORMAL_ID;
    normalPane.className = 'admin-log-subpane admin-log-normal-pane';

    const teamkillPane = document.createElement('div');
    teamkillPane.id = TEAMKILL_ID;
    teamkillPane.className = 'admin-log-subpane admin-log-teamkill-pane';
    teamkillPane.hidden = true;

    viewer.prepend(tabs);
    tabs.insertAdjacentElement('afterend', normalPane);
    normalPane.insertAdjacentElement('afterend', teamkillPane);
    normalPane.append(toolbar, rows);
    moveTeamkillPanels();

    tabs.querySelectorAll('.admin-log-subtab').forEach((button) => {
      button.addEventListener('click', () => {
        setActive(button.dataset.adminLogSubtab || 'normal');
        moveTeamkillPanels();
      });
    });

    const observer = new MutationObserver(() => moveTeamkillPanels());
    observer.observe(viewer, { childList: true, subtree: true });

    let initial = 'normal';
    try {
      const saved = sessionStorage.getItem('hll-admin-log-subtab');
      if (saved === 'teamkill') initial = 'teamkill';
    } catch {}
    setActive(initial);
    return true;
  }

  function waitForViewer() {
    if (install()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts > 100) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitForViewer, { once: true });
  else waitForViewer();
})();
