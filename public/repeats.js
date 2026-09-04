(() => {
  const intervalPresets = [
    ['1 min', 1, 'minutes'],
    ['5 min', 5, 'minutes'],
    ['10 min', 10, 'minutes'],
    ['15 min', 15, 'minutes'],
    ['30 min', 30, 'minutes'],
    ['1 hour', 1, 'hours']
  ];

  function intervalSeconds(value, unit) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (unit === 'hours') return Math.round(n * 3600);
    if (unit === 'seconds') return Math.round(n);
    return Math.round(n * 60);
  }

  function makeRepeatControls(prefix, title) {
    const box = document.createElement('div');
    box.className = 'repeat-control';
    box.innerHTML = `
      <div class="repeat-control-head">
        <div><span class="repeat-kicker">REPEAT TIMER</span><strong>${title}</strong></div>
        <span class="repeat-live-badge">SERVER-SIDE</span>
      </div>
      <div class="repeat-presets" data-repeat-presets></div>
      <div class="repeat-grid">
        <label>Every
          <input id="${prefix}RepeatEvery" type="number" min="1" step="1" value="10" inputmode="numeric" />
        </label>
        <label>Interval
          <select id="${prefix}RepeatUnit">
            <option value="minutes" selected>Minutes</option>
            <option value="hours">Hours</option>
            <option value="seconds">Seconds</option>
          </select>
        </label>
        <label>Total sends
          <input id="${prefix}RepeatCount" type="number" min="0" max="10000" step="1" value="0" inputmode="numeric" />
          <small>0 = repeat until stopped</small>
        </label>
        <label class="repeat-check">
          <input id="${prefix}RepeatImmediate" type="checkbox" checked />
          <span>Send first one now</span>
        </label>
      </div>
      <div class="repeat-actions">
        <button id="${prefix}StartRepeat" class="btn primary" type="button">Start Repeating</button>
      </div>
      <p class="repeat-note">The timer runs on the controller service, so closing this browser page does not stop it.</p>
    `;

    const presetBar = box.querySelector('[data-repeat-presets]');
    for (const [label, value, unit] of intervalPresets) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'repeat-preset';
      button.textContent = label;
      button.addEventListener('click', () => {
        box.querySelector(`#${prefix}RepeatEvery`).value = String(value);
        box.querySelector(`#${prefix}RepeatUnit`).value = unit;
      });
      presetBar.appendChild(button);
    }
    return box;
  }

  function installBroadcastRepeat() {
    const form = document.querySelector('#broadcastForm');
    if (!form || document.querySelector('#broadcastRepeatControl')) return;
    const control = makeRepeatControls('broadcast', 'Repeat this broadcast');
    control.id = 'broadcastRepeatControl';
    const sendButton = form.querySelector('button[type="submit"]');
    form.insertBefore(control, sendButton);

    control.querySelector('#broadcastStartRepeat').addEventListener('click', async () => {
      const message = document.querySelector('#broadcastText')?.value.trim() || '';
      if (!message) return toast('Enter or choose a broadcast message first.', 'error');
      const seconds = intervalSeconds(
        control.querySelector('#broadcastRepeatEvery').value,
        control.querySelector('#broadcastRepeatUnit').value
      );
      const repeatCount = Number(control.querySelector('#broadcastRepeatCount').value || 0);
      const sendImmediately = control.querySelector('#broadcastRepeatImmediate').checked;
      const button = control.querySelector('#broadcastStartRepeat');
      button.disabled = true;
      button.textContent = 'Starting...';
      try {
        await post('/controller/repeat-jobs', {
          type: 'broadcast',
          message,
          interval_seconds: seconds,
          repeat_count: repeatCount,
          send_immediately: sendImmediately
        });
        toast(`Broadcast repeat started — every ${formatInterval(seconds)}.`);
        await loadRepeatJobs();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Start Repeating';
      }
    });
  }

  function installPlayerRepeat() {
    const messageLabel = document.querySelector('#messageLabel');
    if (!messageLabel || document.querySelector('#playerRepeatControl')) return;
    const control = makeRepeatControls('player', 'Repeat this player message');
    control.id = 'playerRepeatControl';
    messageLabel.appendChild(control);

    control.querySelector('#playerStartRepeat').addEventListener('click', async () => {
      const message = document.querySelector('#actionMessage')?.value.trim() || '';
      const playerId = document.querySelector('#actionPlayerId')?.value.trim() || '';
      const title = document.querySelector('#playerDialogTitle')?.textContent || '';
      const playerName = title.split(' — ')[0].trim() || playerId;
      if (!playerId) return toast('No player is selected.', 'error');
      if (!message) return toast('Enter a player message first.', 'error');
      const seconds = intervalSeconds(
        control.querySelector('#playerRepeatEvery').value,
        control.querySelector('#playerRepeatUnit').value
      );
      const repeatCount = Number(control.querySelector('#playerRepeatCount').value || 0);
      const sendImmediately = control.querySelector('#playerRepeatImmediate').checked;
      const button = control.querySelector('#playerStartRepeat');
      button.disabled = true;
      button.textContent = 'Starting...';
      try {
        await post('/controller/repeat-jobs', {
          type: 'player_message',
          player_id: playerId,
          player_name: playerName,
          message,
          interval_seconds: seconds,
          repeat_count: repeatCount,
          send_immediately: sendImmediately
        });
        toast(`Repeating message to ${playerName} every ${formatInterval(seconds)}.`);
        await loadRepeatJobs();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Start Repeating';
      }
    });
  }

  function installJobsPanel() {
    const dashboard = document.querySelector('#dashboard');
    if (!dashboard || document.querySelector('#repeatJobsPanel')) return;
    const panel = document.createElement('article');
    panel.id = 'repeatJobsPanel';
    panel.className = 'panel repeat-jobs-panel';
    panel.innerHTML = `
      <div class="panel-head repeat-panel-head">
        <div><p class="eyebrow">AUTOMATION</p><h3>Active Repeat Timers</h3><p class="muted repeat-subtitle">Each message can run at its own interval.</p></div>
        <div class="repeat-panel-actions">
          <button id="refreshRepeatJobs" class="btn ghost small" type="button">Refresh</button>
          <button id="stopAllRepeatJobs" class="btn danger-outline small" type="button">Stop All</button>
        </div>
      </div>
      <div id="repeatJobsList" class="repeat-jobs-list"><div class="repeat-empty">No repeat timers configured.</div></div>
    `;
    const warning = dashboard.querySelector('.warning-panel');
    if (warning) dashboard.insertBefore(panel, warning);
    else dashboard.appendChild(panel);

    panel.querySelector('#refreshRepeatJobs').addEventListener('click', loadRepeatJobs);
    panel.querySelector('#stopAllRepeatJobs').addEventListener('click', async () => {
      if (!confirm('Stop and remove every repeat timer?')) return;
      try {
        await del('/controller/repeat-jobs', {});
        toast('All repeat timers stopped.');
        await loadRepeatJobs();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function formatInterval(seconds) {
    if (seconds % 3600 === 0) {
      const n = seconds / 3600;
      return `${n} hour${n === 1 ? '' : 's'}`;
    }
    if (seconds % 60 === 0) {
      const n = seconds / 60;
      return `${n} minute${n === 1 ? '' : 's'}`;
    }
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }

  function formatNext(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const diff = Math.max(0, Math.round((d.getTime() - Date.now()) / 1000));
    let countdown;
    if (diff >= 3600) countdown = `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
    else if (diff >= 60) countdown = `${Math.floor(diff / 60)}m ${diff % 60}s`;
    else countdown = `${diff}s`;
    return `${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} (${countdown})`;
  }

  function messagePreview(text) {
    const flattened = String(text || '').replace(/\s+/g, ' ').trim();
    return flattened.length > 110 ? `${flattened.slice(0, 107)}...` : flattened;
  }

  function renderRepeatJobs(jobs) {
    const list = document.querySelector('#repeatJobsList');
    if (!list) return;
    list.innerHTML = '';
    if (!jobs.length) {
      const empty = document.createElement('div');
      empty.className = 'repeat-empty';
      empty.textContent = 'No repeat timers configured.';
      list.appendChild(empty);
      return;
    }

    const sorted = [...jobs].sort((a, b) => Number(b.active) - Number(a.active) || String(a.created_at).localeCompare(String(b.created_at)));
    for (const job of sorted) {
      const card = document.createElement('div');
      card.className = `repeat-job ${job.active ? 'active' : 'complete'}${job.last_error ? ' has-error' : ''}`;

      const head = document.createElement('div');
      head.className = 'repeat-job-head';
      const title = document.createElement('div');
      const kind = job.type === 'broadcast' ? 'BROADCAST' : 'PLAYER MESSAGE';
      const target = job.type === 'player_message' ? ` → ${job.player_name || job.player_id}` : '';
      title.innerHTML = `<span class="repeat-kind">${kind}</span><strong></strong>`;
      title.querySelector('strong').textContent = target ? target.slice(3) : 'All players';
      const status = document.createElement('span');
      status.className = `repeat-status ${job.active ? 'on' : 'done'}`;
      status.textContent = job.running ? 'SENDING' : (job.active ? 'ACTIVE' : 'COMPLETE');
      head.append(title, status);

      const preview = document.createElement('p');
      preview.className = 'repeat-message-preview';
      preview.textContent = messagePreview(job.message);

      const meta = document.createElement('div');
      meta.className = 'repeat-meta';
      const total = job.repeat_count === 0 ? '∞' : String(job.repeat_count);
      meta.innerHTML = `
        <span><b>Interval</b>${formatInterval(job.interval_seconds)}</span>
        <span><b>Sent</b>${job.sent_count} / ${total}</span>
        <span><b>Next</b>${job.active ? formatNext(job.next_run_at) : '—'}</span>
      `;

      if (job.last_error) {
        const error = document.createElement('div');
        error.className = 'repeat-job-error';
        error.textContent = `Last send failed: ${job.last_error} — timer will retry at the next interval.`;
        card.append(head, preview, meta, error);
      } else {
        card.append(head, preview, meta);
      }

      const actions = document.createElement('div');
      actions.className = 'repeat-job-actions';
      if (job.active) {
        const now = document.createElement('button');
        now.type = 'button';
        now.className = 'btn ghost small';
        now.textContent = 'Send Now';
        now.addEventListener('click', async () => {
          try {
            await post(`/controller/repeat-jobs/${encodeURIComponent(job.id)}/run-now`, {});
            toast('Repeat message queued to send now.');
            await loadRepeatJobs();
          } catch (err) { toast(err.message, 'error'); }
        });
        actions.appendChild(now);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn danger-outline small';
      remove.textContent = job.active ? 'Stop' : 'Remove';
      remove.addEventListener('click', async () => {
        try {
          await del(`/controller/repeat-jobs/${encodeURIComponent(job.id)}`, {});
          toast(job.active ? 'Repeat timer stopped.' : 'Repeat timer removed.');
          await loadRepeatJobs();
        } catch (err) { toast(err.message, 'error'); }
      });
      actions.appendChild(remove);
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  async function loadRepeatJobs() {
    try {
      const data = await request('/controller/repeat-jobs');
      renderRepeatJobs(Array.isArray(data?.jobs) ? data.jobs : []);
    } catch (err) {
      // 401 is normal while sitting on the controller login screen.
      if (!String(err.message).includes('401')) {
        const list = document.querySelector('#repeatJobsList');
        if (list) list.textContent = `Could not load repeat timers: ${err.message}`;
      }
    }
  }

  installBroadcastRepeat();
  installPlayerRepeat();
  installJobsPanel();
  loadRepeatJobs();
  setInterval(loadRepeatJobs, 5000);
})();
