(() => {
 const $=s=>document.querySelector(s);
 async function api(url,method='GET',body){
  const r=await fetch(url,{method,credentials:'include',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t} if(!r.ok)throw new Error(d?.detail||d?.error||t||r.statusText);return d;
 }
 function status(msg,err=false){const e=$('#advancedAdminStatus');if(e){e.textContent=typeof msg==='string'?msg:JSON.stringify(msg,null,2);e.classList.toggle('error',err)}}
 function install(){
  const settings=$('#settings'); if(!settings||$('#advancedAdminPanel'))return;
  const panel=document.createElement('article');panel.id='advancedAdminPanel';panel.className='panel';panel.innerHTML=`
   <div class="panel-head"><div><p class="eyebrow">ADVANCED RCON</p><h3>Advanced Administration</h3></div></div>
   <p class="muted">Commands are sent only when you press their action button. Unsupported commands return a clear error instead of affecting the controller.</p>
   <div class="settings-grid">
    <form id="removePlatoonPlayer" class="setting-form"><h3>Remove Player From Platoon</h3><input name="player_id" placeholder="Player ID" required><input name="reason" placeholder="Reason"><button class="btn danger">Remove</button></form>
    <form id="disbandPlatoon" class="setting-form"><h3>Disband Platoon</h3><select name="team_index"><option value="1">NVA</option><option value="2">US</option></select><input name="squad_index" type="number" min="0" placeholder="Platoon index" required><input name="reason" placeholder="Reason"><button class="btn danger">Disband</button></form>
    <form id="matchTimer" class="setting-form"><h3>Match Timer</h3><select name="game_mode"><option>Warfare</option><option>Offensive</option><option>Domination</option><option>Conquest</option></select><input name="minutes" type="number" min="1" placeholder="Minutes" required><button class="btn primary">Set</button><button class="btn ghost" type="button" data-remove-timer="match">Reset Override</button></form>
    <form id="warmupTimer" class="setting-form"><h3>Warmup Timer</h3><select name="game_mode"><option>Warfare</option><option>Domination</option><option>Conquest</option></select><input name="minutes" type="number" min="0" placeholder="Minutes" required><button class="btn primary">Set</button><button class="btn ghost" type="button" data-remove-timer="warmup">Reset Override</button></form>
    <form id="dynamicWeather" class="setting-form"><h3>Dynamic Weather</h3><input name="map_id" placeholder="Map ID" required><select name="enabled"><option value="true">Enabled</option><option value="false">Disabled</option></select><button class="btn primary">Apply</button></form>
    <form id="rotationItem" class="setting-form"><h3>Rotation Item</h3><input name="map_name" placeholder="Map ID" required><input name="index" type="number" min="0" value="0"><button class="btn primary">Add at Index</button><input name="remove_index" type="number" min="0" placeholder="Index to remove"><button class="btn danger-outline" type="button" id="removeRotationItem">Remove Index</button></form>
   </div>
   <div class="action-row"><button id="loadAdminGroups" class="btn ghost" type="button">Get Admin Groups</button><button id="loadServerInfo" class="btn ghost" type="button">Server Information</button></div>
   <pre id="advancedAdminStatus" class="data-box">Ready.</pre>`;
  settings.appendChild(panel);
  const bind=(id,url)=>$('#'+id)?.addEventListener('submit',async e=>{e.preventDefault();const o=Object.fromEntries(new FormData(e.currentTarget));for(const k of ['minutes','team_index','squad_index','index'])if(k in o)o[k]=Number(o[k]);if('enabled'in o)o.enabled=o.enabled==='true';try{status(await api(url,'POST',o))}catch(x){status(x.message,true)}});
  bind('removePlatoonPlayer','/api/v2/platoon/remove-player');bind('disbandPlatoon','/api/v2/platoon/disband');bind('matchTimer','/api/v2/match-timer');bind('warmupTimer','/api/v2/warmup-timer');bind('dynamicWeather','/api/v2/dynamic-weather');bind('rotationItem','/api/v2/map-rotation/item');
  document.querySelectorAll('[data-remove-timer]').forEach(b=>b.addEventListener('click',async()=>{const f=b.closest('form'),mode=f.elements.game_mode.value,type=b.dataset.removeTimer;try{status(await api(`/api/v2/${type}-timer/${encodeURIComponent(mode)}`,'DELETE'))}catch(x){status(x.message,true)}}));
  $('#removeRotationItem')?.addEventListener('click',async()=>{const i=$('#rotationItem').elements.remove_index.value;if(i==='')return;try{status(await api('/api/v2/map-rotation/item/'+Number(i),'DELETE'))}catch(x){status(x.message,true)}});
  $('#loadAdminGroups')?.addEventListener('click',async()=>{try{status(await api('/api/v2/admin-groups'))}catch(x){status(x.message,true)}});
  $('#loadServerInfo')?.addEventListener('click',async()=>{try{status(await api('/api/v2/server-information'))}catch(x){status(x.message,true)}});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();