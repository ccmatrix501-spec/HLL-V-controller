const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const state = { authenticated:false, connected:false, qpanel:'https://qp.qonzer.com/', players:[], maps:[], server:null };

function toast(message, type='ok'){const el=$('#toast');el.textContent=message;el.className=`toast show ${type==='error'?'error-toast':'ok-toast'}`;clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.className='toast',3200)}
function pretty(v){if(v===undefined||v===null)return '—';if(typeof v==='string')return v;return JSON.stringify(v,null,2)}
function first(obj, keys, fallback='—'){for(const k of keys){if(obj && obj[k]!==undefined && obj[k]!==null && obj[k]!=='')return obj[k]}return fallback}
function asArray(data){if(Array.isArray(data))return data;if(!data||typeof data!=='object')return [];for(const k of ['players','Players','items','Items','result','Result','data','Data'])if(Array.isArray(data[k]))return data[k];return []}
function normalizeBool(v){return v===true||v==='true'||v==='1'||v===1}

async function request(url, options={}){
  const res=await fetch(url,{credentials:'include',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  const text=await res.text();let data=text;try{data=text?JSON.parse(text):null}catch{}
  if(res.status===401 && !url.startsWith('/controller/')){state.connected=false;updateConnection(false)}
  if(!res.ok)throw new Error((data&&data.error)||`${res.status} ${res.statusText}`);
  return data;
}
async function post(url, body){return request(url,{method:'POST',body:JSON.stringify(body)})}
async function del(url, body){return request(url,{method:'DELETE',body:JSON.stringify(body)})}

async function boot(){
  try{const s=await request('/controller/status');state.authenticated=s.authenticated;state.qpanel=s.qpanel_url||state.qpanel;if(s.authenticated){showApp();await checkRcon()}else showLogin()}catch{showLogin()}
}
function showLogin(){$('#loginView').classList.remove('hidden');$('#appView').classList.add('hidden')}
function showApp(){$('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden')}

$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';try{await post('/controller/login',{password:$('#loginPassword').value});$('#loginPassword').value='';showApp();await checkRcon()}catch(err){$('#loginError').textContent=err.message}})
$('#logoutBtn').addEventListener('click',async()=>{await post('/controller/logout',{}).catch(()=>{});location.reload()})
function openQpanel(){window.open(state.qpanel,'_blank','noopener')};$('#qpanelBtn').onclick=openQpanel;$('#qpanelBtn2').onclick=openQpanel;

$$('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{const v=btn.dataset.view;$$('.nav-item').forEach(x=>x.classList.toggle('active',x===btn));$$('.view').forEach(x=>x.classList.toggle('active',x.id===v));const titles={dashboard:'Server Dashboard',players:'Live Players',maps:'Map Control',access:'Admins & VIPs',bans:'Ban Management',settings:'Server Settings',logs:'Admin Logs'};$('#pageTitle').textContent=titles[v]||'Server Controller';if(state.connected)refreshView(v)}));

function updateConnection(connected){state.connected=connected;const p=$('#connectionPill');p.className=`pill ${connected?'online':'offline'}`;p.textContent=connected?'RCON CONNECTED':'RCON DISCONNECTED';$('#connectBtn').textContent=connected?'Disconnect RCON':'Connect RCON';if(!connected){$('#statPlayerSub').textContent='No connection'}}
async function checkRcon(){try{const s=await request('/api/v2/connection/status');updateConnection(Boolean(s.connected));if(s.connected){await refreshAllCore()}}catch{updateConnection(false)}}
$('#connectBtn').addEventListener('click',async()=>{if(state.connected){if(confirm('Disconnect this RCON session?')){try{await post('/api/v2/disconnect',{});updateConnection(false);toast('RCON disconnected')}catch(e){toast(e.message,'error')}}}else{$('#rconHost').value=localStorage.getItem('hll_rcon_host')||'';$('#rconPort').value=localStorage.getItem('hll_rcon_port')||'';$('#connectError').textContent='';$('#connectDialog').showModal()}})
$$('[data-close-dialog]').forEach(b=>b.onclick=()=>$('#connectDialog').close())
$('#connectForm').addEventListener('submit',async e=>{e.preventDefault();$('#connectError').textContent='';const host=$('#rconHost').value.trim(),port=Number($('#rconPort').value),password=$('#rconPassword').value;try{await post('/api/v2/connect',{host,port,password});localStorage.setItem('hll_rcon_host',host);localStorage.setItem('hll_rcon_port',String(port));$('#rconPassword').value='';$('#connectDialog').close();updateConnection(true);toast('Connected to Hell Let Loose RCON');await refreshAllCore()}catch(err){$('#connectError').textContent=err.message}})

async function refreshAllCore(){await Promise.allSettled([loadServer(),loadPlayers(),loadMaps(),loadRotation()])}
async function loadServer(){if(!state.connected)return;try{const data=await request('/api/v2/server?type=session');state.server=data;$('#sessionRaw').textContent=pretty(data);const o=(data&&typeof data==='object')?data:{};const players=first(o,['player_count','PlayerCount','players','Players','current_players','CurrentPlayers'],null);const max=first(o,['max_players','MaxPlayers','slots','Slots'],null);if(typeof players==='number'){$('#statPlayers').textContent=max&&typeof max==='number'?`${players}/${max}`:String(players)}
    const map=first(o,['map','Map','map_name','MapName','current_map','CurrentMap']);const next=first(o,['next_map','NextMap','nextMap','MapNext']);const time=first(o,['remaining_time','RemainingTime','time_remaining','TimeRemaining','remaining']);$('#statMap').textContent=String(map);$('#statNextMap').textContent=String(next);$('#statTime').textContent=String(time)
  }catch(e){$('#sessionRaw').textContent=e.message}}
async function loadPlayers(){if(!state.connected)return;try{const data=await request('/api/v2/players');state.players=asArray(data);renderPlayers();const n=state.players.length;$('#statPlayers').textContent=String(n);$('#statPlayerSub').textContent='players currently loaded'}catch(e){state.players=[];renderPlayers(e.message)}}
function playerId(p){return String(first(p,['id','ID','player_id','PlayerId','playerId','steam_id_64','SteamID64','platform_id','PlatformId'],'')).trim()}
function renderPlayers(error=''){const q=$('#playerSearch').value.trim().toLowerCase();const rows=state.players.filter(p=>pretty(p).toLowerCase().includes(q));const body=$('#playersBody');if(error){body.innerHTML=`<tr><td colspan="5" class="empty"></td></tr>`;body.querySelector('td').textContent=error;return}if(!rows.length){body.innerHTML='<tr><td colspan="5" class="empty">No players found.</td></tr>';return}body.innerHTML='';for(const p of rows){const id=playerId(p);const name=first(p,['name','Name','player_name','PlayerName'],'Unknown Player');const team=first(p,['team','Team','team_name','TeamName']);const unit=first(p,['unit','Unit','platoon','Platoon','squad','Squad']);const role=first(p,['role','Role']);const score=first(p,['score','Score','combat','Combat']);const ping=first(p,['ping','Ping']);const tr=document.createElement('tr');tr.innerHTML=`<td><span class="player-name"></span><span class="player-id"></span></td><td></td><td></td><td></td><td><div class="action-row"></div></td>`;tr.children[0].querySelector('.player-name').textContent=name;tr.children[0].querySelector('.player-id').textContent=id;tr.children[1].textContent=team;tr.children[2].textContent=[unit,role].filter(x=>x&&x!=='—').join(' / ')||'—';tr.children[3].textContent=[score!== '—'?`Score ${score}`:'',ping!=='—'?`Ping ${ping}`:''].filter(Boolean).join(' / ')||'—';const ar=tr.querySelector('.action-row');[['message','Message'],['punish','Punish'],['force','Switch'],['kick','Kick'],['tempban','Temp Ban'],['permaban','Perma Ban']].forEach(([a,label])=>{const b=document.createElement('button');b.className=`action-btn ${['kick','tempban','permaban'].includes(a)?'danger':''}`;b.textContent=label;b.type='button';b.onclick=()=>openPlayerAction(a,id,String(name));ar.appendChild(b)});body.appendChild(tr)}}
$('#playerSearch').addEventListener('input',()=>renderPlayers())

function openPlayerAction(type,id,name){$('#actionType').value=type;$('#actionPlayerId').value=id;$('#playerDialogTitle').textContent=`${name} — ${type.toUpperCase()}`;$('#reasonLabel').classList.toggle('hidden',type==='message'||type==='force');$('#messageLabel').classList.toggle('hidden',type!=='message');$('#durationLabel').classList.toggle('hidden',type!=='tempban');$('#adminNameLabel').classList.toggle('hidden',!['tempban','permaban'].includes(type));$('#forceModeLabel').classList.toggle('hidden',type!=='force');$('#playerActionSubmit').textContent=type==='message'?'Send':type==='force'?'Switch Team':'Confirm';$('#playerDialog').showModal()}
$$('[data-close-player]').forEach(b=>b.onclick=()=>$('#playerDialog').close())
$('#playerActionForm').addEventListener('submit',async e=>{e.preventDefault();const type=$('#actionType').value,id=$('#actionPlayerId').value,reason=$('#actionReason').value.trim();try{if(type==='message')await post(`/api/v2/players/${encodeURIComponent(id)}/message`,{message:$('#actionMessage').value});if(type==='punish')await post('/api/v2/punish',{player_id:id,reason});if(type==='kick')await post('/api/v2/kick',{player_id:id,reason});if(type==='force')await post('/api/v2/force-team-switch',{player_id:id,force_mode:Number($('#actionForceMode').value)});if(type==='tempban')await post('/api/v2/temp-ban',{player_id:id,duration:Number($('#actionDuration').value),reason,admin_name:$('#actionAdminName').value});if(type==='permaban')await post('/api/v2/perma-ban',{player_id:id,reason,admin_name:$('#actionAdminName').value});$('#playerDialog').close();toast('Player action sent successfully');setTimeout(loadPlayers,800)}catch(err){toast(err.message,'error')}})

$('#broadcastForm').addEventListener('submit',async e=>{e.preventDefault();try{await post('/api/v2/broadcast',{message:$('#broadcastText').value});$('#broadcastText').value='';toast('Broadcast sent')}catch(err){toast(err.message,'error')}})

async function loadMaps(){if(!state.connected)return;try{const raw=await request('/api/v2/maps');let maps=[];if(Array.isArray(raw))maps=raw;else if(typeof raw==='string')maps=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);else maps=asArray(raw);state.maps=maps.map(m=>typeof m==='string'?m:first(m,['name','Name','id','Id','map_name','MapName'],pretty(m)));const sel=$('#mapSelect');sel.innerHTML='<option value="">Select map...</option>';for(const m of state.maps){const o=document.createElement('option');o.value=m;o.textContent=m;sel.appendChild(o)}}catch(e){toast(`Map list: ${e.message}`,'error')}}
async function loadRotation(){if(!state.connected)return;const [r,s]=await Promise.allSettled([request('/api/v2/map-rotation'),request('/api/v2/map-sequence')]);$('#rotationBox').textContent=r.status==='fulfilled'?pretty(r.value):r.reason.message;$('#sequenceBox').textContent=s.status==='fulfilled'?pretty(s.value):s.reason.message}
$('#changeMapForm').addEventListener('submit',async e=>{e.preventDefault();const map=$('#mapSelect').value;if(!map)return;if(!confirm(`Change the live server to ${map} now?`))return;try{await post('/api/v2/change-map',{map_name:map});toast('Map change command sent')}catch(err){toast(err.message,'error')}})

async function loadAccess(){if(!state.connected)return;const [v,a]=await Promise.allSettled([request('/api/v2/vips'),request('/api/v2/admins')]);$('#vipBox').textContent=v.status==='fulfilled'?pretty(v.value):v.reason.message;$('#adminBox').textContent=a.status==='fulfilled'?pretty(a.value):a.reason.message}
$('#vipForm').addEventListener('submit',async e=>{e.preventDefault();try{await post('/api/v2/vips',{player_id:$('#vipId').value.trim(),comment:$('#vipComment').value.trim()});toast('VIP added');e.target.reset();loadAccess()}catch(err){toast(err.message,'error')}})
$('#adminForm').addEventListener('submit',async e=>{e.preventDefault();try{await post('/api/v2/admins',{player_id:$('#adminId').value.trim(),admin_group:$('#adminGroup').value.trim(),comment:$('#adminComment').value.trim()});toast('Admin added');e.target.reset();loadAccess()}catch(err){toast(err.message,'error')}})

async function loadBans(){if(!state.connected)return;const [t,p]=await Promise.allSettled([request('/api/v2/bans?type=temp'),request('/api/v2/bans?type=perma')]);$('#tempBansBox').textContent=t.status==='fulfilled'?pretty(t.value):t.reason.message;$('#permaBansBox').textContent=p.status==='fulfilled'?pretty(p.value):p.reason.message}
$('#unbanForm').addEventListener('submit',async e=>{e.preventDefault();const type=$('#unbanType').value,id=$('#unbanId').value.trim();try{await del(type==='temp'?'/api/v2/temp-ban':'/api/v2/perma-ban',{player_id:id});toast('Ban removed');e.target.reset();loadBans()}catch(err){toast(err.message,'error')}})

$$('.setting-form').forEach(form=>form.addEventListener('submit',async e=>{e.preventDefault();const body={};new FormData(form).forEach((v,k)=>{if(v==='true'||v==='false')body[k]=normalizeBool(v);else if(v!==''&&!Number.isNaN(Number(v))&&form.elements[k]?.type==='number')body[k]=Number(v);else body[k]=v});try{await post(form.dataset.endpoint,body);toast('Setting applied')}catch(err){toast(err.message,'error')}}))

async function loadLogs(){if(!state.connected)return;try{$('#logsBox').textContent=pretty(await request(`/api/v2/logs?seconds=${encodeURIComponent($('#logRange').value)}`))}catch(e){$('#logsBox').textContent=e.message}}

function refreshView(v){if(v==='dashboard')loadServer();if(v==='players')loadPlayers();if(v==='maps'){loadMaps();loadRotation()}if(v==='access')loadAccess();if(v==='bans')loadBans();if(v==='logs')loadLogs()}
$$('[data-refresh]').forEach(b=>b.onclick=()=>refreshView(b.dataset.refresh==='server'?'dashboard':b.dataset.refresh))

setInterval(()=>{if(state.authenticated&&state.connected){loadServer();loadPlayers()}},10000)
boot();
