(() => {
  // Compatibility layer for expandable teamkill cards.
  // Commander moderation policy is handled directly by commander-teamkill-review.js
  // so thresholds stay scoped to a single match.

  const SUMMARY_SELECTOR = '.tk-card-summary, .admin-tk-group-summary';
  const CARD_SELECTOR = 'details.tk-card-detail, details.admin-tk-group';

  function syncOne(details) {
    if (!details) return;
    const summary = details.querySelector(':scope > summary');
    if (!summary) return;
    summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');
    summary.setAttribute('role', 'button');
    if (!summary.hasAttribute('tabindex')) summary.tabIndex = 0;
    details.classList.toggle('is-open', Boolean(details.open));
  }

  function toggleCard(details) {
    if (!details) return;
    details.open = !details.open;
    syncOne(details);
  }

  // Let the browser perform the native <details> toggle first. If the browser/UI
  // does not change the state, force the toggle on the next frame. This avoids the
  // previous preventDefault handler interfering with native summary behaviour.
  document.addEventListener('click', (event) => {
    const summary = event.target.closest?.(SUMMARY_SELECTOR);
    if (summary) {
      const details = summary.closest('details');
      if (!details) return;
      const before = Boolean(details.open);
      requestAnimationFrame(() => {
        if (Boolean(details.open) === before) toggleCard(details);
        else syncOne(details);
      });
      return;
    }

    // Extra fallback: clicking the collapsed card shell itself also opens it.
    const card = event.target.closest?.(CARD_SELECTOR);
    if (!card || card.open) return;
    if (event.target.closest?.('button,a,input,select,textarea,label')) return;
    toggleCard(card);
  }, false);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const summary = event.target.closest?.(SUMMARY_SELECTOR);
    if (!summary) return;
    const details = summary.closest('details');
    if (!details) return;

    // Prevent scrolling on Space and make keyboard behaviour deterministic.
    event.preventDefault();
    toggleCard(details);
  }, false);

  function syncExpandedState(root = document) {
    if (root.matches?.(CARD_SELECTOR)) syncOne(root);
    root.querySelectorAll?.(CARD_SELECTOR).forEach(syncOne);
  }

  function install() {
    syncExpandedState();
    const root = document.getElementById('logs') || document.body;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          syncExpandedState(node);
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();