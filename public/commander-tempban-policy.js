(() => {
  // Compatibility layer for expandable teamkill cards.
  // Commander moderation policy is handled directly by commander-teamkill-review.js
  // so thresholds stay scoped to a single match instead of being rewritten globally.

  function toggleDetailsFromSummary(event) {
    const summary = event.target.closest?.('.tk-card-summary, .admin-tk-group-summary');
    if (!summary) return;

    const details = summary.closest('details');
    if (!details) return;

    event.preventDefault();
    event.stopPropagation();
    details.open = !details.open;
    summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');
  }

  document.addEventListener('click', toggleDetailsFromSummary, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const summary = event.target.closest?.('.tk-card-summary, .admin-tk-group-summary');
    if (!summary) return;
    const details = summary.closest('details');
    if (!details) return;

    event.preventDefault();
    details.open = !details.open;
    summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');
  }, true);

  function syncExpandedState(root = document) {
    root.querySelectorAll?.('.tk-card-summary, .admin-tk-group-summary').forEach((summary) => {
      const details = summary.closest('details');
      if (!details) return;
      summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');
      summary.setAttribute('role', 'button');
      if (!summary.hasAttribute('tabindex')) summary.tabIndex = 0;
    });
  }

  function install() {
    syncExpandedState();
    const root = document.getElementById('logs') || document.body;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          syncExpandedState(node);
          if (node.matches?.('.tk-card-summary, .admin-tk-group-summary')) syncExpandedState(node.parentElement || node);
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
