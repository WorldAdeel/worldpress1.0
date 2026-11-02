/* ---------- sync state ---------- */
let S=load(K.sync,{});if(!S.shas)S.shas={};if(!Array.isArray(S.dirty))S.dirty=[];
let mu=load(K.mu,{});
const saveSync=()=>store(K.sync,S);
function markDirty(id){if(!S.dirty.includes(id))S.dirty.push(id);saveSync();schedule();}
function metaChanged(k){mu[k]=stampU();store(K.mu,mu);markDirty('m:meta');}
function lockRec(){return load(K.lock,null);}
function lockOn(){const l=lockRec();return !!(l&&l.on&&l.pw);}
function metaRecs(){const r=[{id:'cfg3',u:mu.cfg||0,v:CFG},{id:'tpl3',u:mu.tpl||0,v:tpls},{id:'mats3',u:mu.mats||0,v:customMats}];const L=lockRec();if(L)r.push(Object.assign({},L,{id:'lock'}));return r;}
const newerR=(a,b)=>!b||a.u>b.u||(a.u===b.u&&JSON.stringify(a)>JSON.stringify(b));
function mergeMeta(recs){let ch=false,lockCh=false;const cur={};metaRecs().forEach(r=>cur[r.id]=r);
  for(const r of recs||[]){if(!r||!r.id||!newerR(r,cur[r.id])||(cur[r.id]&&JSON.stringify(r)===JSON.stringify(cur[r.id])))continue;
    if(r.id==='cfg3'){CFG=Object.assign({},DEFAULT_CFG,r.v);store(K.cfg,CFG);mu.cfg=r.u;ch=true;}
    else if(r.id==='tpl3'&&Array.isArray(r.v)){tpls=r.v;store(K.tpl,tpls);mu.tpl=r.u;ch=true;}
    else if(r.id==='mats3'&&Array.isArray(r.v)){customMats=r.v;store(K.mats,customMats);mu.mats=r.u;ch=true;}
    else if(r.id==='lock'){store(K.lock,r);ch=true;lockCh=true;}}
  if(ch)store(K.mu,mu);if(lockCh)afterLockSync();return ch;}
function mergeLeads(recs){let ch=false;
  for(let r of recs||[]){if(!r||!r.id)continue;r=normalize(fromV4(r));
    const i=leads.findIndex(x=>x.id===r.id),gi=gone.findIndex(x=>x.id===r.id),cur=i>=0?leads[i]:gi>=0?gone[gi]:null;
    if(cur&&!newerR(r,cur))continue;if(cur&&JSON.stringify(r)===JSON.stringify(cur))continue;
    if(i>=0)leads.splice(i,1);if(gi>=0)gone.splice(gi,1);(r.del?gone:leads).push(r);lastSaved.set(r.id,sig(r));ch=true;}
  if(ch)store(K.leads,leads.concat(gone));return ch;}

/* ---------- crypto: AES-GCM, key = PBKDF2-SHA256(310k) of the sync password, gzip first ---------- */
const TE=new TextEncoder(),TD=new TextDecoder(),ITER=310000;
const b64=u8=>{let s='';for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(s);};
const unb64=x=>Uint8Array.from(atob(String(x).replace(/\s/g,'')),c=>c.charCodeAt(0));
const rand=n=>crypto.getRandomValues(new Uint8Array(n));
async function pbkdf(pw,salt,iter){const k=await crypto.subtle.importKey('raw',TE.encode(pw),'PBKDF2',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:iter||ITER},k,256));}
const aes=raw=>crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
async function gz(u8,on){if(!window.CompressionStream)return null;const st=new Blob([u8]).stream().pipeThrough(on?new CompressionStream('gzip'):new DecompressionStream('gzip'));return new Uint8Array(await new Response(st).arrayBuffer());}
async function seal(key,obj){let p=TE.encode(JSON.stringify(obj)),f=0;const z=await gz(p,1);if(z){p=z;f=1;}const iv=rand(12);const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,p));const o=new Uint8Array(14+ct.length);o[0]=1;o[1]=f;o.set(iv,2);o.set(ct,14);return o;}
async function unseal(key,u8){if(u8[0]!==1)throw new Error('Unknown file format');let p=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:u8.subarray(2,14)},key,u8.subarray(14)));if(u8[1]&1){const z=await gz(p,0);if(!z)throw new Error('This browser cannot unzip');p=z;}return JSON.parse(TD.decode(p));}

/* ---------- GitHub (your private repo) ---------- */
async function gh(method,path,body){let r;
  try{r=await fetch('https://api.github.com'+path,{method,cache:'no-store',headers:Object.assign({Authorization:'Bearer '+S.token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},body?{'Content-Type':'application/json'}:{}),body:body?JSON.stringify(body):undefined});}
  catch(e){const x=new Error('Offline');x.offline=1;throw x;}
  let j=null;try{j=await r.json();}catch(e){}
  if(!r.ok){const x=new Error((j&&j.message)||('HTTP '+r.status));x.status=r.status;throw x;}return j;}
const R=()=>'/repos/'+encodeURIComponent(S.owner)+'/'+encodeURIComponent(S.repo);
async function lsDir(dir){try{const j=await gh('GET',R()+'/contents'+(dir?'/'+dir:''));return Array.isArray(j)?j:[];}catch(e){if(e.status===404)return [];throw e;}}
async function blob(sha){const j=await gh('GET',R()+'/git/blobs/'+sha);return unb64(j.content);}
async function putFile(path,u8,sha){const j=await gh('PUT',R()+'/contents/'+path,Object.assign({message:'sync '+path,content:b64(u8)},sha?{sha}:{}));return j.content.sha;}
let keyObj=null,syncing=false,again=false,syncT=null,repoOK=false;
async function KEY(){if(!keyObj)keyObj=await aes(unb64(S.key));return keyObj;}
function schedule(ms){if(!S.on)return;clearTimeout(syncT);syncT=setTimeout(sync,ms==null?2500:ms);}
function syncLine(){if(!S.on)return 'Off · data only on this device';return S.err?'⚠ '+S.err:'✓ '+S.owner+'/'+S.repo+(S.last?' · '+new Date(S.last).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'');}
function setDot(c,t){const d=$('#dot');if(d){d.className=c||'';d.title=t||'';}const m=$('#syncMini');if(m)m.textContent=syncLine();const st=$('#syncSt');if(st)st.innerHTML=syncBox();}
async function checkRepo(){const info=await gh('GET',R());if(!info.private){const x=new Error('Repo '+S.owner+'/'+S.repo+' is PUBLIC. Make it private first. Sync refused.');x.pub=1;throw x;}repoOK=true;}
async function sync(){if(!S.on||!S.key)return;if(syncing){again=true;return;}syncing=true;setDot('busy','Syncing…');
  try{if(!repoOK)await checkRepo();await pull();await push();S.last=Date.now();S.err='';setDot('ok','Synced');}
  catch(e){S.err=e.message;if(e.pub)S.on=false;setDot(e.offline?'':'err',e.offline?'Offline · will sync later':'Sync problem: '+e.message);}
  finally{saveSync();syncing=false;if(again){again=false;schedule(400);}}}
function mergeFile(p,recs){return p==='meta.bin'?mergeMeta(recs):mergeLeads(recs);}
async function pull(){const root=await lsDir('');const files=[];
  for(const f of root){if(f.name==='meta.bin')files.push(f);if(f.name==='data'&&f.type==='dir')(await lsDir('data')).forEach(x=>{if(/\.bin$/.test(x.name))files.push(x);});}
  let ch=false;for(const f of files){if(S.shas[f.path]===f.sha)continue;if(mergeFile(f.path,await unseal(await KEY(),await blob(f.sha))))ch=true;S.shas[f.path]=f.sha;}
  if(ch)syncRefresh();}
const allRecs=()=>leads.concat(gone);
const findRec=id=>allRecs().find(l=>l.id===id);
const pathOf=id=>{if(id==='m:meta')return 'meta.bin';const l=findRec(id);return l?'data/'+l.m+'.bin':null;};
const verOf=id=>id==='m:meta'?JSON.stringify(metaRecs()):(findRec(id)||{}).u;
async function push(){if(!S.dirty.length)return;const snap={},paths=new Set();
  for(const id of S.dirty){const p=pathOf(id);if(p){paths.add(p);snap[id]=verOf(id);}}
  for(const p of paths)await pushPath(p);
  S.dirty=S.dirty.filter(id=>snap[id]!==undefined&&verOf(id)!==snap[id]);}
async function pushPath(p){for(let i=0;i<5;i++){const recs=p==='meta.bin'?metaRecs():allRecs().filter(l=>'data/'+l.m+'.bin'===p);
  try{S.shas[p]=await putFile(p,await seal(await KEY(),recs),S.shas[p]);return;}
  catch(e){if(e.status!==409&&e.status!==422)throw e;let c=null;try{c=await gh('GET',R()+'/contents/'+p);}catch(x){if(x.status!==404)throw x;}
    if(c){if(mergeFile(p,await unseal(await KEY(),await blob(c.sha))))syncRefresh();S.shas[p]=c.sha;}else delete S.shas[p];}}
  throw new Error('Could not save '+p+' (busy), will retry');}
function syncRefresh(){fillCountries();const a=document.activeElement;const typing=a&&/input|textarea/i.test(a.tagName)&&a.closest('.sheet');if(typing)render();else refresh();}
async function connect(token,repo,pw){const old=JSON.parse(JSON.stringify(S));
  try{S.token=String(token||'').trim();if(!S.token)throw new Error('Paste your GitHub key');if(!pw)throw new Error('Enter a sync password');
    const me=await gh('GET','/user').catch(e=>{if(e.status===401)throw new Error('GitHub key not accepted (wrong or expired)');throw e;});
    let owner=me.login,name=String(repo||'pmi-leads-data').trim();if(name.includes('/'))[owner,name]=name.split('/');S.owner=owner;S.repo=name;
    try{await checkRepo();}catch(e){if(e.status===404)throw new Error('Repo '+owner+'/'+name+' not found, or the key has no access to it');throw e;}
    let kf=null;try{kf=await gh('GET',R()+'/contents/key.json');}catch(e){if(e.status!==404)throw e;}
    let raw;
    if(kf){const k=JSON.parse(TD.decode(unb64(kf.content)));raw=await pbkdf(pw,unb64(k.salt),k.iter);try{await unseal(await aes(raw),unb64(k.check));}catch(e){throw new Error('Wrong sync password');}}
    else{if(pw.length<8)throw new Error('Sync password: at least 8 characters');const salt=rand(16);raw=await pbkdf(pw,salt);const check=await seal(await aes(raw),{ok:'pmi-leads'});
      await putFile('key.json',TE.encode(JSON.stringify({v:1,kdf:'PBKDF2-SHA256',iter:ITER,salt:b64(salt),check:b64(check)},null,1)));}
    S.key=b64(raw);keyObj=null;S.shas={};S.on=true;S.err='';S.dirty=[...new Set(S.dirty.concat(allRecs().map(l=>l.id),['m:meta']))];saveSync();
    await sync();if(S.err)throw new Error(S.err);}
  catch(e){const d=S.dirty;S=old;S.dirty=d;keyObj=null;repoOK=false;saveSync();throw e;}}
function syncBox(){return !S.on?'<div class="mini">Not connected. Your leads are only on this device.</div>'
  :'<div>Connected to <b>'+esc(S.owner+'/'+S.repo)+'</b></div><div class="mini">'+(S.err?'<span class="err">⚠ '+esc(S.err)+'</span>':'<span class="okc">✓ Last sync '+(S.last?new Date(S.last).toLocaleTimeString():'—')+'</span>')+(S.dirty.length?' · '+S.dirty.length+' waiting':'')+'</div>';}
function openSync(){const s=openSheet('sync');const draw=()=>{s.sc.innerHTML='<div class="hd"><div class="t"><h2>☁️ Sync phone ↔ PC</h2><div class="m">Through your own private GitHub repo. Encrypted on this device before upload.</div></div><button class="ib" data-x>✕</button></div><div class="box"><div id="syncSt">'+syncBox()+'</div>'
   +(S.on?'<div class="row" style="margin-top:10px"><button class="btn sm f" data-now>Sync now</button><button class="btn sm red" data-off>Disconnect</button></div>'
     :'<div class="stack"><input id="sR" value="pmi-leads-data" placeholder="Repo name" autocomplete="off"><input id="sT" type="password" placeholder="GitHub key (fine-grained token)" autocomplete="off"><input id="sP" type="password" placeholder="Sync password (same on every device)" autocomplete="new-password"><button class="btn pri" style="width:100%" data-go>Connect</button><div id="sE" class="err"></div></div><p class="mini">Never type your GitHub password here, only the key.</p>')+'</div>';
  s.sc.querySelector('[data-x]').onclick=()=>closeSheet();
  const now=s.sc.querySelector('[data-now]');if(now)now.onclick=async()=>{repoOK=false;await sync();toast(S.err?'⚠ '+S.err:'Synced ✓');};
  const off=s.sc.querySelector('[data-off]');if(off)off.onclick=()=>{if(!confirm('Disconnect sync on this device? Your leads stay here and in GitHub.'))return;S={shas:{},dirty:[]};keyObj=null;repoOK=false;saveSync();setDot('');draw();};
  const go=s.sc.querySelector('[data-go]');if(go)go.onclick=async()=>{const e=s.sc.querySelector('#sE');e.textContent='Connecting… (a few seconds)';go.disabled=true;
    try{await connect(s.sc.querySelector('#sT').value,s.sc.querySelector('#sR').value,s.sc.querySelector('#sP').value);toast('Sync connected ✓');draw();render();}catch(x){e.textContent=x.message;go.disabled=false;}};};
  draw();}

/* ---------- app lock (password hashes only, synced so one password locks every device) ---------- */
const normRc=x=>String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const hpw=async(pw,salt)=>b64(await pbkdf(pw,unb64(salt)));
function genRc(){const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',r=rand(16);let x='';for(let i=0;i<16;i++){x+=A[r[i]%32];if(i%4===3&&i<15)x+='-';}return x;}
function putLock(o){o.u=stampU();store(K.lock,o);markDirty('m:meta');}
let locked=document.documentElement.classList.contains('lk'),mustReset=false,hiddenAt=0,settingLock=false;
function lockNow(){if(!lockOn())return;locked=true;while(sheets.length)closeSheet();document.documentElement.classList.add('lk');$('#lockE').textContent='';$('#lockP').value='';setTimeout(()=>$('#lockP').focus(),60);}
function unlockApp(){locked=false;document.documentElement.classList.remove('lk');render();if(mustReset){mustReset=false;openLock();toast('Set a new lock password now',null,null,4000);}}
function afterLockSync(){if(settingLock)return;if(lockOn()&&!locked&&!mustReset)lockNow();else if(!lockOn()&&locked)unlockApp();}
$('#lockF').addEventListener('submit',async e=>{e.preventDefault();const v=$('#lockP').value;if(!v)return;const L=lockRec();$('#lockE').textContent='Checking…';
  try{if(L&&L.pw&&await hpw(v,L.pw.s)===L.pw.h)return unlockApp();
    if(L&&L.rc&&await hpw(normRc(v),L.rc.s)===L.rc.h){mustReset=true;return unlockApp();}
    if(S.token&&v.trim()===S.token){mustReset=true;return unlockApp();}
    $('#lockE').textContent='Wrong password';$('#lockP').select();}catch(x){$('#lockE').textContent='Error: '+x.message;}});
function openLock(){const s=openSheet('lock');const L=lockRec(),on=lockOn();
  s.sc.innerHTML='<div class="hd"><div class="t"><h2>🔒 App lock</h2><div class="m">'+(on?'On · asks on open and after you leave the app':'Off')+'</div></div><button class="ib" data-x>✕</button></div>'
   +(on?'<div class="box"><div class="lbl">Lock after leaving the app for</div><select id="lA">'+[[0,'Immediately'],[60,'1 minute'],[300,'5 minutes'],[900,'15 minutes']].map(x=>'<option value="'+x[0]+'"'+(+(L.after||0)===x[0]?' selected':'')+'>'+x[1]+'</option>').join('')+'</select></div>':'')
   +'<div class="box stack" style="margin-top:8px"><input id="lP" type="password" placeholder="'+(on?'New password':'Password')+'" autocomplete="new-password"><input id="lP2" type="password" placeholder="Repeat password" autocomplete="new-password"><input id="lR" placeholder="Recovery code (empty = make one for me)" autocomplete="off"><button class="btn pri" style="width:100%" data-set>'+(on?'Change password':'Turn on lock')+'</button>'+(on?'<button class="btn red" style="width:100%" data-off>Turn off lock</button>':'')+'<div id="lE"></div></div>'
   +'<div class="mini" style="padding:0 4px">Your GitHub key also works as a recovery code. With sync on, the lock applies to all your devices.</div>';
  const sc=s.sc;sc.querySelector('[data-x]').onclick=()=>closeSheet();
  const la=sc.querySelector('#lA');if(la)la.onchange=()=>{putLock(Object.assign({},lockRec(),{after:+la.value}));toast('Saved');};
  const off=sc.querySelector('[data-off]');if(off)off.onclick=()=>{if(!confirm('Turn off the app lock on all devices?'))return;putLock({on:false});closeSheet();toast('Lock off');};
  sc.querySelector('[data-set]').onclick=async b=>{const btn=b.currentTarget,p=sc.querySelector('#lP').value,p2=sc.querySelector('#lP2').value,e=sc.querySelector('#lE');e.className='err';
    if(p.length<4)return e.textContent='Password: at least 4 characters';if(p!==p2)return e.textContent='Passwords do not match';
    let rc=sc.querySelector('#lR').value.trim();if(rc&&normRc(rc).length<8)return e.textContent='Recovery code: at least 8 letters/numbers';const gen=!rc;if(gen)rc=genRc();
    btn.disabled=true;e.className='mini';e.textContent='Saving…';settingLock=true;
    const s1=b64(rand(16)),s2=b64(rand(16)),cur=lockRec();putLock({on:true,pw:{s:s1,h:await hpw(p,s1)},rc:{s:s2,h:await hpw(normRc(rc),s2)},after:cur&&cur.after!=null?cur.after:60});settingLock=false;
    e.className='';e.innerHTML='<p class="okc">✓ Lock is on.</p>'+(gen?'<div class="mini">Your recovery code. Write it on paper. Never paste it in any chat:</div><div class="code">'+rc+'</div>':'<div class="mini">Your own recovery code is saved.</div>');
    sc.querySelectorAll('#lP,#lP2,#lR').forEach(i=>i.value='');btn.disabled=false;};}
document.addEventListener('visibilitychange',()=>{if(document.hidden){hiddenAt=Date.now();return;}const L=lockRec();if(lockOn()&&!locked&&hiddenAt&&Date.now()-hiddenAt>=(L.after||0)*1000)lockNow();schedule(300);});
window.addEventListener('focus',()=>schedule(300));
window.addEventListener('online',()=>schedule(300));
setInterval(()=>{if(!document.hidden)sync();},30000);

/* ---------- recycle bin ---------- */
function openBin(){const s=openSheet('bin');const draw=()=>{const B=gone.slice().sort((a,b)=>b.u-a.u);
  s.sc.innerHTML='<div class="hd"><div class="t"><h2>🗑 Recycle bin</h2><div class="m">'+plural(B.length,'deleted lead')+'</div></div><button class="ib" data-x>✕</button></div>'+(B.length?'<div class="box">'+B.map(l=>'<div class="rr">'+flag(l.country)+'<div class="mid"><div class="nm">'+esc(title(l))+'</div><div class="sub"><span class="ln">Deleted '+new Date(l.u).toLocaleDateString()+'</span></div></div><button class="btn sm" data-r="'+l.id+'">Restore</button></div>').join('')+'</div>':'<div class="empty">Empty.</div>');
  s.sc.querySelector('[data-x]').onclick=()=>closeSheet();
  s.sc.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{const i=gone.findIndex(x=>x.id===b.dataset.r);if(i<0)return;const l=gone.splice(i,1)[0];delete l.del;touch(l);leads.unshift(l);saveLeads();render();draw();toast('Restored '+title(l));});};draw();}
