(() => {
  const MAP_OPTIONS = ['Vạn Tường', 'Quảng Ngãi', 'Huế Outskirts', 'Đăk Tô Airfield', 'Cam Ranh Port', 'Thanh Hòa Bridge'];
  const MODE_OPTIONS = ['Warfare', 'Offensive - NVA', 'Offensive - US', 'Domination', 'Conquest'];
  let latest = { active: null, history: [], templates: [] };
  let loading = false;

  const $ = (s) => document.querySelector(s);

  async function api(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
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
      const detail = data?.detail ?? data?.error ?? text ?? `${res.status} ${res.statusText}`;
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    return data;
  }

  function toastMsg(message, type = 'ok') {
    if (typeof window.toast === 'function') return window.toast(message, type);
    alert(message);
  }

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatDuration(seconds) {
    seconds = Math.max(0, Number(seconds || 0));
    if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
    if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  function secondsFrom(value, unit) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (unit === 'hours') return Math.round(n * 3600);
    if (unit === 'minutes') return Math.round(n * 60);
    return Math.round(n);
  }

  function addNavAndView() {
    if (!$('#voting')) {
      const main = document.querySelector('.main');
      const section = document.createElement('section');
      section.id = 'voting';
      section.className = 'view';
      section.innerHTML = `
        <div class="grid two voting-grid">
          <article class="panel">
            <div class="panel-head"><div><p class="eyebrow">SERVER POLL</p><h3>Create Vote</h3></div></div>
            <form id="voteCreateForm" class="stack">
              <label>Vote Type
                <select id="voteType">
                  <option value="custom">Custom Vote</option>
                  <option value="map">Map Vote</option>
                  <option value="game_mode">Game Mode Vote</option>
                  <option value="yes_no">Yes / No Vote</option>
                  <option value="event">Event Vote</option>
                  <option value="restart">Restart Vote</option>
                </select>
              </label>
              <label>Vote Question<input id="voteQuestion" maxlength="140" required placeholder="What should everyone vote on?" /></label>
              <div>
                <div class="vote-answer-head"><strong>Vote Answers</strong><button id="addVoteAnswer" class="btn ghost small" type="button">+ Add Answer</button></div>
                <div id="voteAnswers" class="vote-answers"></div>
                <small class="muted">Players vote with <b>!vote 1</b>, <b>!vote 2</b>, etc. Maximum 6 answers.</small>
              </div>
              <div class="vote-duration-grid">
                <label>Open for<input id="voteDurationValue" type="number" min="1" step="1" value="2" required /></label>
                <label>Duration<select id="voteDurationUnit"><option value="seconds">Seconds</option><option value="minutes" selected>Minutes</option><option value="hours">Hours</option></select></label>
                <label>Reminder every<input id="voteReminderValue" type="number" min="0" step="1" value="30" /></label>
                <label>Reminder unit<select id="voteReminderUnit"><option value="seconds" selected>Seconds</option><option value="minutes">Minutes</option><option value="hours">Hours</option></select></label>
              </div>
              <div class="vote-options">
                <label><input id="voteAllowChanges" type="checkbox" checked /> Allow players to change their vote</label>
                <label><input id="voteAnnounceResult" type="checkbox" checked /> Announce final result to everyone</label>
                <label><input id="voteConfirmVotes" type="checkbox" checked /> Privately confirm each player's vote</label>
                <label><input id="voteUseReminder" type="checkbox" checked /> Repeat voting reminder</label>
              </div>
              <div class="vote-create-actions">
                <button id="saveVoteTemplate" class="btn ghost" type="button">Save as Template</button>
                <button id="startVote" class="btn primary" type="submit">Start Vote</button>
              </div>
            </form>
          </article>

          <article class="panel">
            <div class="panel-head"><div><p class="eyebrow">LIVE RESULTS</p><h3>Active Vote</h3></div><button id="refreshVote" class="btn ghost small" type="button">Refresh</button></div>
            <div id="activeVoteBox" class="vote-active-box"><div class="vote-empty">No active vote.</div></div>
          </article>
        </div>

        <div class="grid two voting-grid-lower">
          <article class="panel">
            <div class="panel-head"><div><p class="eyebrow">REUSE</p><h3>Saved Votes</h3></div></div>
            <div id="voteTemplates" class="vote-template-list"><div class="vote-empty">No saved vote templates.</div></div>
          </article>
          <article class="panel">
            <div class="panel-head"><div><p class="eyebrow">RECENT</p><h3>Vote History</h3></div></div>
            <div id="voteHistory" class="vote-history"><div class="vote-empty">No completed votes yet.</div></div>
          </article>
        </div>`;
      main.appendChild(section);
    }

    if (!document.querySelector('[data-view="voting"]')) {
      const nav = $('#nav');
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.view = 'voting';
      button.textContent = 'Voting';
      const logs = nav?.querySelector('[data-view="logs"]');
      if (logs) nav.insertBefore(button, logs);
      else nav?.appendChild(button);
      button.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(x => x.classList.toggle('active', x === button));
        document.querySelectorAll('.view').forEach(x => x.classList.toggle('active', x.id === 'voting'));
        const title = $('#pageTitle');
        if (title) title.textContent = 'Server Voting';
        loadVoteState();
      });
    }
  }

  function answerValues() {
    return [...document.querySelectorAll('#voteAnswers input')].map(input => input.value.trim()).filter(Boolean);
  }

  function addAnswer(value = '') {
    const box = $('#voteAnswers');
    if (!box || box.children.length >= 6) return;
    const row = document.createElement('div');
    row.className = 'vote-answer-row';
    row.innerHTML = `<span class="vote-answer-number"></span><input maxlength="60" placeholder="Answer" required /><button class="btn ghost small vote-remove-answer" type="button">×</button>`;
    row.querySelector('input').value = value;
    row.querySelector('.vote-remove-answer').addEventListener('click', () => {
      if (box.children.length <= 2) return toastMsg('A vote needs at least two answers.', 'error');
      row.remove();
      renumberAnswers();
    });
    box.appendChild(row);
    renumberAnswers();
  }

  function renumberAnswers() {
    document.querySelectorAll('#voteAnswers .vote-answer-row').forEach((row, index) => {
      row.querySelector('.vote-answer-number').textContent = `${index + 1}.`;
    });
    const add = $('#addVoteAnswer');
    if (add) add.disabled = document.querySelectorAll('#voteAnswers .vote-answer-row').length >= 6;
  }

  function setAnswers(values) {
    const box = $('#voteAnswers');
    if (!box) return;
    box.innerHTML = '';
    for (const value of values.slice(0, 6)) addAnswer(value);
    while (box.children.length < 2) addAnswer('');
  }

  function applyTypePreset() {
    const type = $('#voteType')?.value || 'custom';
    const question = $('#voteQuestion');
    if (!question) return;
    if (type === 'map') {
      question.value = 'Which map should we play next?';
      setAnswers(MAP_OPTIONS);
    } else if (type === 'game_mode') {
      question.value = 'Which game mode should we play next?';
      setAnswers(MODE_OPTIONS);
    } else if (type === 'yes_no') {
      if (!question.value || question.value === 'Which map should we play next?' || question.value === 'Which game mode should we play next?') question.value = 'Should we do this?';
      setAnswers(['Yes', 'No']);
    } else if (type === 'restart') {
      question.value = 'Should the server be restarted?';
      setAnswers(['Yes', 'No']);
    } else if (type === 'event') {
      question.value = 'Which event should we run?';
      setAnswers(['Infantry Only', 'Armour Night', 'Helicopter Night']);
    } else {
      if (!answerValues().length) setAnswers(['Yes', 'No']);
    }
  }

  function currentConfig() {
    const useReminder = $('#voteUseReminder')?.checked;
    const duration = secondsFrom($('#voteDurationValue')?.value, $('#voteDurationUnit')?.value);
    const reminder = useReminder ? secondsFrom($('#voteReminderValue')?.value, $('#voteReminderUnit')?.value) : 0;
    return {
      vote_type: $('#voteType')?.value || 'custom',
      question: $('#voteQuestion')?.value.trim() || '',
      answers: answerValues(),
      duration_seconds: duration,
      reminder_interval_seconds: reminder,
      allow_changes: Boolean($('#voteAllowChanges')?.checked),
      announce_result: Boolean($('#voteAnnounceResult')?.checked),
      confirm_votes: Boolean($('#voteConfirmVotes')?.checked)
    };
  }

  function loadConfig(config = {}) {
    $('#voteType').value = config.vote_type || 'custom';
    $('#voteQuestion').value = config.question || '';
    setAnswers(Array.isArray(config.answers) ? config.answers : ['Yes', 'No']);
    const duration = Number(config.duration_seconds || 120);
    if (duration % 3600 === 0) { $('#voteDurationValue').value = duration / 3600; $('#voteDurationUnit').value = 'hours'; }
    else if (duration % 60 === 0) { $('#voteDurationValue').value = duration / 60; $('#voteDurationUnit').value = 'minutes'; }
    else { $('#voteDurationValue').value = duration; $('#voteDurationUnit').value = 'seconds'; }
    const reminder = Number(config.reminder_interval_seconds || 0);
    $('#voteUseReminder').checked = reminder > 0;
    if (reminder > 0 && reminder % 60 === 0) { $('#voteReminderValue').value = reminder / 60; $('#voteReminderUnit').value = 'minutes'; }
    else { $('#voteReminderValue').value = reminder || 30; $('#voteReminderUnit').value = 'seconds'; }
    $('#voteAllowChanges').checked = config.allow_changes !== false;
    $('#voteAnnounceResult').checked = config.announce_result !== false;
    $('#voteConfirmVotes').checked = config.confirm_votes !== false;
  }

  async function startVote(event) {
    event.preventDefault();
    const config = currentConfig();
    if (config.answers.length < 2) return toastMsg('Add at least two vote answers.', 'error');
    if (!config.question) return toastMsg('Enter a vote question.', 'error');
    const button = $('#startVote');
    button.disabled = true;
    button.textContent = 'Starting Vote...';
    try {
      await api('/api/v2/votes', { method: 'POST', body: JSON.stringify(config) });
      toastMsg('Server vote started. Players can vote with !vote <number>.');
      await loadVoteState();
    } catch (err) {
      toastMsg(err.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Start Vote';
    }
  }

  function renderActive(vote) {
    const box = $('#activeVoteBox');
    if (!box) return;
    if (!vote) {
      box.innerHTML = '<div class="vote-empty">No active vote.</div>';
      return;
    }
    const counts = Array.isArray(vote.counts) ? vote.counts : [];
    const total = Number(vote.total_votes || 0);
    const answerHtml = (vote.answers || []).map((answer, index) => {
      const count = Number(counts[index] || 0);
      const pct = total ? Math.round((count / total) * 100) : 0;
      return `<div class="vote-result-row"><div class="vote-result-line"><span><b>${index + 1}.</b> ${esc(answer)}</span><strong>${count} vote${count === 1 ? '' : 's'}</strong></div><div class="vote-bar"><span style="width:${pct}%"></span></div></div>`;
    }).join('');
    box.innerHTML = `
      <div class="vote-live-head"><span class="vote-live-badge">ACTIVE</span><strong>${esc(String(vote.vote_type || '').replaceAll('_', ' ').toUpperCase())}</strong></div>
      <h4>${esc(vote.question)}</h4>
      <div class="vote-results">${answerHtml}</div>
      <div class="vote-live-meta"><span><b>${total}</b> total vote${total === 1 ? '' : 's'}</span><span><b>${formatDuration(vote.remaining_seconds)}</b> remaining</span></div>
      ${vote.last_error ? `<div class="vote-error">${esc(vote.last_error)}</div>` : ''}
      <p class="muted">Players vote in Team or Unit chat using <b>!vote 1</b>, <b>!vote 2</b>, etc.</p>
      <div class="vote-live-actions"><button id="endVoteNow" class="btn primary" type="button">End Vote Now</button><button id="cancelVote" class="btn danger-outline" type="button">Cancel Vote</button></div>`;
    $('#endVoteNow').onclick = async () => {
      if (!confirm('End this vote now and announce the current result?')) return;
      try { await api('/api/v2/votes/end', { method: 'POST', body: '{}' }); toastMsg('Vote ended.'); await loadVoteState(); } catch (err) { toastMsg(err.message, 'error'); }
    };
    $('#cancelVote').onclick = async () => {
      if (!confirm('Cancel this vote without a result?')) return;
      try { await api('/api/v2/votes/cancel', { method: 'POST', body: '{}' }); toastMsg('Vote cancelled.'); await loadVoteState(); } catch (err) { toastMsg(err.message, 'error'); }
    };
  }

  function renderTemplates(templates) {
    const box = $('#voteTemplates');
    if (!box) return;
    if (!templates.length) {
      box.innerHTML = '<div class="vote-empty">No saved vote templates.</div>';
      return;
    }
    box.innerHTML = templates.map(t => `<div class="vote-template"><div><strong>${esc(t.name)}</strong><small>${esc(String(t.config?.vote_type || 'custom').replaceAll('_', ' '))} · ${esc(t.config?.question || '')}</small></div><div class="action-row"><button class="btn ghost small vote-load-template" data-id="${esc(t.id)}" type="button">Load</button><button class="btn danger-outline small vote-delete-template" data-id="${esc(t.id)}" type="button">Delete</button></div></div>`).join('');
    box.querySelectorAll('.vote-load-template').forEach(button => button.onclick = () => {
      const item = templates.find(t => t.id === button.dataset.id);
      if (item) { loadConfig(item.config || {}); toastMsg(`Loaded vote template: ${item.name}`); }
    });
    box.querySelectorAll('.vote-delete-template').forEach(button => button.onclick = async () => {
      if (!confirm('Delete this saved vote template?')) return;
      try { await api(`/api/v2/votes/templates/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' }); await loadVoteState(); } catch (err) { toastMsg(err.message, 'error'); }
    });
  }

  function renderHistory(history) {
    const box = $('#voteHistory');
    if (!box) return;
    if (!history.length) {
      box.innerHTML = '<div class="vote-empty">No completed votes yet.</div>';
      return;
    }
    box.innerHTML = history.slice(0, 8).map(vote => {
      const result = vote.result || {};
      const winner = Array.isArray(result.winner_answers) && result.winner_answers.length ? result.winner_answers.join(' / ') : (vote.status === 'cancelled' ? 'Cancelled' : 'No valid votes');
      return `<div class="vote-history-item"><div><strong>${esc(vote.question || 'Server Vote')}</strong><small>${esc(String(vote.vote_type || '').replaceAll('_', ' '))} · ${esc(vote.status || '')}</small></div><div class="vote-history-result"><b>${esc(winner)}</b><span>${Number(vote.total_votes || 0)} votes</span></div></div>`;
    }).join('');
  }

  async function loadVoteState() {
    if (loading) return;
    loading = true;
    try {
      latest = await api('/api/v2/votes');
      renderActive(latest.active);
      renderTemplates(Array.isArray(latest.templates) ? latest.templates : []);
      renderHistory(Array.isArray(latest.history) ? latest.history : []);
    } catch (err) {
      const box = $('#activeVoteBox');
      if (box) box.innerHTML = `<div class="vote-empty vote-error">${esc(err.message)}</div>`;
    } finally {
      loading = false;
    }
  }

  async function saveTemplate() {
    const config = currentConfig();
    if (!config.question || config.answers.length < 2) return toastMsg('Set the vote question and answers before saving.', 'error');
    const name = prompt('Template name:', config.question.slice(0, 50));
    if (!name) return;
    try {
      await api('/api/v2/votes/templates', { method: 'POST', body: JSON.stringify({ name, config }) });
      toastMsg('Vote template saved.');
      await loadVoteState();
    } catch (err) { toastMsg(err.message, 'error'); }
  }

  function install() {
    addNavAndView();
    setAnswers(['Yes', 'No']);
    $('#voteType')?.addEventListener('change', applyTypePreset);
    $('#addVoteAnswer')?.addEventListener('click', () => addAnswer(''));
    $('#voteCreateForm')?.addEventListener('submit', startVote);
    $('#saveVoteTemplate')?.addEventListener('click', saveTemplate);
    $('#refreshVote')?.addEventListener('click', loadVoteState);
    loadVoteState();
    setInterval(() => {
      if ($('#voting')?.classList.contains('active') || latest.active) loadVoteState();
    }, 2000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
