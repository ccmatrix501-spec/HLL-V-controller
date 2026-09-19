(() => {
  const $ = (selector) => document.querySelector(selector);
  let loadingMatch = false;

  function esc(value) {
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  }
  function kd(k,d){ k=Number(k||0); d=Number(d||0); return d ? (k/d).toFixed(2) : (k ? 'INF' : '0.00'); }

  async function json(url, init={}) {
    const response = await fetch(url, { credentials:'include', cache:'no-store', ...init });
    const text = await response.text();
    let data=null; try { data=text?JSON.parse(text):null; } catch {}
    if(!response.ok) throw new Error(data?.detail||data?.error||text||response.statusText);
    return data;
  }

  function renderSide(selector, rows) {
    const body=$(selector); if(!body) return;
    if(!rows?.length){body.innerHTML='<tr><td colspan="6" class="empty">No players on this side.</td></tr>';return;}
    body.innerHTML=rows.map((p,i)=>`<tr><td>${i+1}</td><td><strong>${esc(p.name||p.player_name||p.player_id)}</strong></td><td>${Number(p.kills||0)}</td><td>${Number(p.deaths||0)}</td><td><strong>${kd(p.kills,p.deaths)}</strong></td><td>${Number(p.revives||0)}</td></tr>`).join('');
  }

  async function loadMatchStats(){
    if(loadingMatch || !$('#leaderboard')?.classList.contains('active')) return;
    loadingMatch=true;
    const status=$('#matchStatsStatus');
    if(status) status.textContent='Refreshing current match…';
    try{
      const data=await json('/api/v2/leaderboard/match');
      renderSide('#matchStatsUS',data?.us||[]);
      renderSide('#matchStatsNVA',data?.nva||[]);
      if(status) status.textContent=`${Number(data?.connected_players||0)} connected players • current match • updated ${new Date().toLocaleTimeString()}`;
    }catch(error){
      if(status) status.textContent=error?.message||'Could not load current match stats.';
    }finally{loadingMatch=false;}
  }

  async function postBroadcast() {
    const button=$('#leaderBroadcastMatch'), status=$('#leaderBroadcastStatus');
    if(!button || !window.confirm('Broadcast the current-match Top 5 US and Top 5 NVA leaderboard to every connected player?')) return;
    button.disabled=true; if(status) status.textContent='Broadcasting current match leaderboard…';
    try{
      const data=await json('/api/v2/leaderboard/broadcast',{method:'POST',headers:{Accept:'application/json'}});
      const sent=Number(data?.sent||0), failed=Number(data?.failed||0);
      if(status) status.textContent=failed?`Sent to ${sent}; ${failed} failed.`:`Sent to ${sent} player${sent===1?'':'s'}.`;
      void loadMatchStats();
    }catch(error){if(status)status.textContent=error?.message||'Could not broadcast the leaderboard.'}
    finally{button.disabled=false;}
  }

  function install(){
    const tryInstall=()=>{
      const view=$('#leaderboard'), intro=view?.querySelector('.leaderboard-intro');
      if(!view||!intro){setTimeout(tryInstall,100);return;}
      if($('#currentMatchStatsPanel')) return;

      const current=document.createElement('article');
      current.id='currentMatchStatsPanel'; current.className='panel';
      current.innerHTML=`
        <div class="panel-head"><div><p class="eyebrow">LIVE CURRENT MATCH</p><h3>Current Match Stats</h3></div><button id="matchStatsRefresh" class="btn ghost small" type="button">Refresh</button></div>
        <div id="matchStatsStatus" class="leaderboard-meta muted">Loading current match…</div>
        <div class="grid two">
          <div><h4>US</h4><div class="table-wrap"><table class="leaderboard-table"><thead><tr><th>#</th><th>Player</th><th>Kills</th><th>Deaths</th><th>K/D</th><th>Revives</th></tr></thead><tbody id="matchStatsUS"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody></table></div></div>
          <div><h4>NVA</h4><div class="table-wrap"><table class="leaderboard-table"><thead><tr><th>#</th><th>Player</th><th>Kills</th><th>Deaths</th><th>K/D</th><th>Revives</th></tr></thead><tbody id="matchStatsNVA"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody></table></div></div>
        </div>`;
      intro.insertAdjacentElement('afterend',current);

      const panel=document.createElement('div'); panel.className='leaderboard-command-help';
      panel.innerHTML='<strong>Current match broadcast</strong><span class="muted">Top 5 US + Top 5 NVA, ranked by kills.</span><button id="leaderBroadcastMatch" class="btn primary small" type="button">Broadcast Match Leaderboard</button><small id="leaderBroadcastStatus" class="muted">The !leaderboard command sends this same board to everyone.</small>';
      intro.appendChild(panel);
      $('#leaderBroadcastMatch')?.addEventListener('click',postBroadcast);
      $('#matchStatsRefresh')?.addEventListener('click',loadMatchStats);
      document.querySelector('[data-view="leaderboard"]')?.addEventListener('click',()=>setTimeout(loadMatchStats,50));
      setInterval(()=>{if(!document.hidden && $('#leaderboard')?.classList.contains('active')) void loadMatchStats();},15000);
      if(view.classList.contains('active')) void loadMatchStats();
    };
    tryInstall();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})();