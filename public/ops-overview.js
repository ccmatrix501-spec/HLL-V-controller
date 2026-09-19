(() => {
 function install(){
  const dash=document.querySelector('#dashboard'), stats=dash?.querySelector('.stats-grid'); if(!dash||!stats||document.querySelector('#opsOverview'))return;
  const wrap=document.createElement('div');wrap.id='opsOverview';wrap.className='ops-overview';
  wrap.innerHTML=`<article class="panel ops-attention"><p class="eyebrow">SHIFT SITUATION</p><strong id="opsAttention">Monitoring live server</strong><p id="opsAttentionSub" class="muted">Operational status is being read from the existing controller data.</p></article><article class="panel"><p class="eyebrow">CURRENT MATCH</p><h3 id="opsMatch">—</h3><div class="ops-live-grid"><div><span>Players</span><strong id="opsPlayers">—</strong></div><div><span>Remaining</span><strong id="opsTime">—</strong></div><div><span>Status</span><strong id="opsStatus">OFFLINE</strong></div></div></article>`;
  stats.insertAdjacentElement('afterend',wrap);
  const sync=()=>{
   const txt=id=>document.querySelector(id)?.textContent?.trim()||'—';
   document.querySelector('#opsMatch').textContent=txt('#statMap');
   document.querySelector('#opsPlayers').textContent=txt('#statPlayers');
   document.querySelector('#opsTime').textContent=txt('#statTime');
   const connected=document.documentElement.dataset.rconConnected==='1';
   const s=document.querySelector('#opsStatus');s.textContent=connected?'ONLINE':'OFFLINE';
   const a=document.querySelector('#opsAttention'),sub=document.querySelector('#opsAttentionSub');
   a.textContent=connected?'Server operational':'RCON needs attention';
   sub.textContent=connected?'Live match and player telemetry are available.':'The web controller is loaded, but the RCON bridge is not connected.';
  };
  sync();setInterval(()=>{if(!document.hidden)sync()},5000);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();