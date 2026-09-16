(() => {
  const POLICY_TEXT = '5-9 ability teamkills = warning. 10+ = 3-hour temporary ban. Below 5, the existing kick rule still applies when a strike gets fewer than 2 enemy kills or teamkills exceed enemy kills.';

  function toast(message, type) {
    if (typeof window.toast === 'function') window.toast(message, type);
    else alert(message);
  }

  async function apiAction(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw new Error(data?.error || data?.detail || text || `${response.status} ${response.statusText}`);
    return data;
  }

  function incidentFromCard(card) {
    const id = String(card?.querySelector('.cmdtk-id')?.textContent || '').trim();
    const title = String(card?.querySelector('.cmdtk-name')?.textContent || '').trim();
    const separator = title.indexOf(' — ');
    const name = separator >= 0 ? title.slice(0, separator).trim() : title || 'Player';
    const ability = separator >= 0 ? title.slice(separator + 3).trim() : 'Commander ability';
    const resultLine = [...(card?.querySelectorAll('.cmdtk-line') || [])]
      .map((node) => String(node.textContent || ''))
      .find((text) => text.toLowerCase().includes('result:')) || '';
    const match = resultLine.match(/(\d+)\s+enemy kill\(s\).*?(\d+)\s+teamkill\(s\)/i);
    const enemyKills = match ? Number(match[1]) : 0;
    const teamKills = match ? Number(match[2]) : 0;
    return { id, name, ability, enemyKills, teamKills };
  }

  function rewritePolicyUi() {
    const panel = document.getElementById('commanderTkWatch');
    if (!panel) return;

    const policy = panel.querySelector('.cmdtk-head .muted');
    if (policy && policy.textContent !== POLICY_TEXT) policy.textContent = POLICY_TEXT;

    const summary = panel.querySelector('#commanderTkSummary');
    if (summary) {
      const next = String(summary.textContent || '')
        .replace(/permanent-ban case\(s\)/gi, '3-hour temp-ban case(s)')
        .replace(/permanent ban/gi, '3-hour temporary ban');
      if (next !== summary.textContent) summary.textContent = next;
    }

    panel.querySelectorAll('.cmdtk-card').forEach((card) => {
      const badge = card.querySelector('.cmdtk-badge.ban');
      if (badge && badge.textContent !== '3H TEMP BAN') badge.textContent = '3H TEMP BAN';

      const banButton = card.querySelector('.cmdtk-ban');
      if (banButton && banButton.textContent !== '3-Hour Temp Ban') banButton.textContent = '3-Hour Temp Ban';

      card.querySelectorAll('.cmdtk-line').forEach((line) => {
        const current = String(line.textContent || '');
        if (!/permanent-ban|permanent ban/i.test(current)) return;
        const html = line.innerHTML
          .replace(/10\+ ability teamkills — permanent-ban threshold reached/gi, '10+ ability teamkills — 3-hour temporary-ban threshold reached')
          .replace(/permanent ban/gi, '3-hour temporary ban')
          .replace(/permanent-ban/gi, '3-hour temporary-ban');
        if (html !== line.innerHTML) line.innerHTML = html;
      });
    });
  }

  async function sendCorrectedWarning(button) {
    const card = button.closest('.cmdtk-card');
    const incident = incidentFromCard(card);
    if (!incident.id) {
      alert('This log incident does not include a player ID, so the controller cannot warn them automatically.');
      return;
    }

    const message = `[ 1ST M.I. COMMANDER WARNING ]\n\nYour ${incident.ability} caused ${incident.teamKills} teamkills.\nCommander abilities reaching 5 teamkills receive a warning.\n10 teamkills from an ability results in a 3-hour temporary ban.\n\nWatch friendly positions before using commander abilities.`;
    if (!confirm(`Send a commander-ability warning to ${incident.name}?\n\n${incident.teamKills} teamkill(s)`)) return;

    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Sending...';
    try {
      await apiAction(`/api/v2/players/${encodeURIComponent(incident.id)}/message`, { message });
      toast(`Warning sent to ${incident.name}`);
    } catch (error) {
      toast(error.message || String(error), 'error');
    } finally {
      button.disabled = false;
      button.textContent = oldText;
      rewritePolicyUi();
    }
  }

  async function applyThreeHourBan(button) {
    const card = button.closest('.cmdtk-card');
    const incident = incidentFromCard(card);
    if (!incident.id) {
      alert('This log incident does not include a player ID, so the controller cannot ban them automatically.');
      return;
    }

    const reason = `Commander ability teamkilling: ${incident.ability} caused ${incident.teamKills} teamkills (${incident.enemyKills} enemy kills) — 3-hour temporary ban`;
    if (!confirm(`Temporarily ban ${incident.name} for 3 hours?\n\n${incident.teamKills} commander-ability teamkills meets the 10+ temporary-ban threshold.\n\n${reason}`)) return;

    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Banning...';
    try {
      await apiAction('/api/v2/temp-ban', {
        player_id: incident.id,
        duration: 3,
        reason,
        admin_name: '1st M.I. Admin'
      });
      toast(`${incident.name} temporarily banned for 3 hours`);
    } catch (error) {
      toast(error.message || String(error), 'error');
    } finally {
      button.disabled = false;
      button.textContent = oldText;
      rewritePolicyUi();
    }
  }

  // Capture clicks before the older commander-review handlers run. This prevents
  // the previous permanent-ban action from ever being called after this policy update.
  document.addEventListener('click', (event) => {
    const banButton = event.target.closest?.('.cmdtk-ban');
    if (banButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyThreeHourBan(banButton);
      return;
    }

    const warnButton = event.target.closest?.('.cmdtk-warn');
    if (warnButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      sendCorrectedWarning(warnButton);
    }
  }, true);

  function installObserver() {
    rewritePolicyUi();
    const root = document.getElementById('logs') || document.body;
    const observer = new MutationObserver(() => rewritePolicyUi());
    observer.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installObserver, { once: true });
  else installObserver();
})();
