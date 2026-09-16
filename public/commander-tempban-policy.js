(() => {
  const POLICY_VERSION = '2026-09-16-v2';
  const POLICY_TEXT = '0-4 ability teamkills = warning of a kick. 5-9 = warning + kick, with a warning that 10+ will receive a 3-hour temporary ban. 10+ = 3-hour temporary ban.';

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
    return {
      id,
      name,
      ability,
      enemyKills: match ? Number(match[1]) : 0,
      teamKills: match ? Number(match[2]) : 0
    };
  }

  function levelFor(teamKills) {
    if (teamKills >= 10) return 'ban';
    if (teamKills >= 5) return 'kick';
    return 'warn';
  }

  function policyReason(incident) {
    if (incident.teamKills >= 10) return `${incident.teamKills} ability teamkills — 3-hour temporary-ban threshold reached`;
    if (incident.teamKills >= 5) return `${incident.teamKills} ability teamkills — kick threshold reached; 10+ will receive a 3-hour temporary ban`;
    return `${incident.teamKills} ability teamkill${incident.teamKills === 1 ? '' : 's'} — warning issued; 5-9 results in a kick`;
  }

  function makeButton(className, text, disabled) {
    return `<button type="button" class="btn ${className.includes('ban') || className.includes('kick') ? 'danger' : 'ghost'} small ${className}" ${disabled ? 'disabled' : ''}>${text}</button>`;
  }

  function rewriteCard(card) {
    const incident = incidentFromCard(card);
    if (card.dataset.commanderPolicy === POLICY_VERSION && Number(card.dataset.teamKills) === incident.teamKills) return;

    const level = levelFor(incident.teamKills);
    card.dataset.commanderPolicy = POLICY_VERSION;
    card.dataset.teamKills = String(incident.teamKills);
    card.classList.remove('ok', 'warn', 'kick', 'ban');
    card.classList.add(level);

    const badge = card.querySelector('.cmdtk-badge');
    if (badge) {
      badge.classList.remove('ok', 'warn', 'kick', 'ban');
      badge.classList.add(level);
      badge.textContent = level === 'ban' ? '3H TEMP BAN' : level === 'kick' ? 'KICK + WARNING' : 'WARNING';
    }

    const lines = [...card.querySelectorAll('.cmdtk-line')];
    let policyLine = lines.find((line) => String(line.textContent || '').toLowerCase().includes('policy:'));
    if (policyLine) policyLine.innerHTML = `<span class="cmdtk-label">Policy:</span> ${policyReason(incident)}`;

    let actions = card.querySelector('.cmdtk-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'cmdtk-actions';
      card.appendChild(actions);
    }
    const disabled = !incident.id;
    if (level === 'ban') {
      actions.innerHTML = makeButton('cmdtk-policy-ban', '3-Hour Temp Ban', disabled);
    } else if (level === 'kick') {
      actions.innerHTML = makeButton('cmdtk-policy-kick', 'Warn & Kick', disabled);
    } else {
      actions.innerHTML = makeButton('cmdtk-policy-warn', 'Send Warning', disabled);
    }
  }

  function rewritePolicyUi() {
    const panel = document.getElementById('commanderTkWatch');
    if (!panel) return;

    const policy = panel.querySelector('.cmdtk-head .muted');
    if (policy) policy.textContent = POLICY_TEXT;

    const cards = [...panel.querySelectorAll('.cmdtk-card')];
    cards.forEach(rewriteCard);

    const counts = { warn: 0, kick: 0, ban: 0 };
    cards.forEach((card) => {
      const level = levelFor(incidentFromCard(card).teamKills);
      counts[level] += 1;
    });
    const summary = panel.querySelector('#commanderTkSummary');
    if (summary) {
      summary.textContent = `${cards.length} commander incident(s) with friendly kills • ${counts.warn} warning case(s) • ${counts.kick} warn-and-kick case(s) • ${counts.ban} three-hour temp-ban case(s).`;
    }
  }

  async function sendWarning(incident, button) {
    const message = `[ 1ST M.I. COMMANDER WARNING ]\n\nYour ${incident.ability} caused ${incident.teamKills} teamkill${incident.teamKills === 1 ? '' : 's'}.\n\nTHIS IS A WARNING.\n5-9 commander-ability teamkills results in a kick.\n10+ results in a 3-hour temporary ban.\n\nCheck friendly positions before using commander abilities.`;
    if (!confirm(`Warn ${incident.name}?\n\n${incident.teamKills} commander-ability teamkill(s)`)) return;
    const old = button.textContent;
    button.disabled = true;
    button.textContent = 'Sending...';
    try {
      await apiAction(`/api/v2/players/${encodeURIComponent(incident.id)}/message`, { message });
      toast(`Warning sent to ${incident.name}`);
    } catch (error) {
      toast(error.message || String(error), 'error');
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  async function warnAndKick(incident, button) {
    const reason = `Commander ability teamkilling: ${incident.ability} caused ${incident.teamKills} teamkills (${incident.enemyKills} enemy kills)`;
    if (!confirm(`Warn and kick ${incident.name}?\n\n${incident.teamKills} ability teamkills is within the 5-9 kick range.`)) return;
    const old = button.textContent;
    button.disabled = true;
    button.textContent = 'Kicking...';
    try {
      const message = `[ 1ST M.I. COMMANDER WARNING ]\n\nYour ${incident.ability} caused ${incident.teamKills} teamkills.\nYou are being KICKED for commander-ability teamkilling.\n\n10+ commander-ability teamkills results in a 3-hour temporary ban.`;
      await apiAction(`/api/v2/players/${encodeURIComponent(incident.id)}/message`, { message }).catch(() => {});
      await apiAction('/api/v2/kick', { player_id: incident.id, reason });
      toast(`${incident.name} warned and kicked`);
    } catch (error) {
      toast(error.message || String(error), 'error');
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  async function applyThreeHourBan(incident, button) {
    const reason = `Commander ability teamkilling: ${incident.ability} caused ${incident.teamKills} teamkills (${incident.enemyKills} enemy kills) — 3-hour temporary ban`;
    if (!confirm(`Temporarily ban ${incident.name} for 3 hours?\n\n${incident.teamKills} commander-ability teamkills meets the 10+ temporary-ban threshold.`)) return;
    const old = button.textContent;
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
      button.textContent = old;
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('.cmdtk-policy-warn, .cmdtk-policy-kick, .cmdtk-policy-ban');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const incident = incidentFromCard(button.closest('.cmdtk-card'));
    if (!incident.id) return alert('This incident does not include a player ID.');
    if (button.classList.contains('cmdtk-policy-ban')) applyThreeHourBan(incident, button);
    else if (button.classList.contains('cmdtk-policy-kick')) warnAndKick(incident, button);
    else sendWarning(incident, button);
  }, true);

  function installObserver() {
    rewritePolicyUi();
    const root = document.getElementById('logs') || document.body;
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        rewritePolicyUi();
      });
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installObserver, { once: true });
  else installObserver();
})();
