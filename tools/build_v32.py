#!/usr/bin/env python3
"""One-off: turn PMI Leads v3.1 (index.html) into v3.2.
Removes photos / material sets / material texts and adds sync, lock and backups.
Usage: python3 tools/build_v32.py <v3.1 index.html> <out index.html>
"""
import sys, re, json

src, out = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf8').read()
lines = s.split('\n')

def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f'expected {count} match(es), found {n}: {old[:90]!r}')
    s = s.replace(old, new)

# ---------- CSS: drop photo styles (exact lines) ----------
photo_css = ('.strip{', '.strip::', '.ph{', '.ph .c', '.ph .b', '.ph .b.s', '.ph.sent', '.sgrid{', '.st{', '.st .im', '.st .tx', '.st .tx span', '.gal{', '.gal .g', '.gal .add')
lines = [l for l in lines if not l.startswith(photo_css)]
s = '\n'.join(lines)

# ---------- head: pre-paint lock + icons ----------
rep('<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
    '<link rel="apple-touch-icon" href="icon-192.png">\n<meta name="referrer" content="no-referrer">\n'
    '<script>try{var L=JSON.parse(localStorage.getItem(\'pmi3-lock\')||\'null\');if(L&&L.on&&L.pw)document.documentElement.className=\'lk\';}catch(e){}</script>')
rep('.mini{font-size:12px;color:var(--mut)}',
    '.mini{font-size:12px;color:var(--mut)}\n'
    '.lk #app,.lk .fab{display:none}#lock{display:none}.lk #lock{display:flex}\n'
    '#lock{position:fixed;inset:0;z-index:400;background:var(--bg);align-items:center;justify-content:center;padding:20px}\n'
    '#lock .in{width:100%;max-width:320px;text-align:center}#lock input{margin:12px 0;text-align:center;font-size:17px}\n'
    '#dot{width:9px;height:9px;border-radius:50%;background:var(--line);flex:none}#dot.ok{background:var(--green)}#dot.busy{background:var(--amber)}#dot.err{background:var(--red)}\n'
    '.err{color:var(--red);font-size:13px}.okc{color:var(--green)}\n'
    '.code{font:700 18px ui-monospace,monospace;letter-spacing:.06em;background:var(--soft);padding:10px;border-radius:10px;text-align:center;user-select:all;margin:8px 0}\n'
    '.stack>*{margin-top:8px}')

# ---------- body ----------
rep('<div id="app">',
    '<div id="lock"><div class="in"><div style="font-size:40px">🔒</div><h3 style="margin:6px 0;font-family:Georgia,serif">PMI Leads is locked</h3>'
    '<form id="lockF"><input id="lockP" type="password" autocomplete="current-password" placeholder="Password"><button class="btn pri" style="width:100%">Unlock</button></form>'
    '<p class="mini">Forgot it? Type your recovery code or GitHub key in the same box.</p><p id="lockE" class="err"></p></div></div>\n<div id="app">')
rep('<button class="goal" id="goal"', '<span id="dot" title="Sync off"></span>\n    <button class="goal" id="goal"')
rep('<button data-v="leads">Leads</button><button data-v="photos">Photos</button>', '<button data-v="leads">Leads</button>')
rep('<input type="file" id="fImport" accept=".json,application/json" multiple hidden>\n<input type="file" id="fImgs" accept="image/*" multiple hidden>',
    '<input type="file" id="fImport" accept=".json,.txt,application/json,text/plain" multiple hidden>')

# ---------- constants ----------
rep("const APP_VER='3.1';", "const APP_VER='3.2';")
rep("const K={leads:'pmi3-leads',sets:'pmi3-sets',tpl:'pmi3-templates',cfg:'pmi3-settings',praise:'pmi3-praise',meta:'pmi3-meta',mats:'pmi3-mats',ui:'pmi3-ui'};",
    "const K={leads:'pmi3-leads',tpl:'pmi3-templates',cfg:'pmi3-settings',meta:'pmi3-meta',mats:'pmi3-mats',ui:'pmi3-ui',lock:'pmi3-lock',mu:'pmi3-mu',sync:'pmi3-sync'};")
rep("const V2={leads:'pmi-leads',sets:'pmi-sets',praise:'pmi-praise'};", "const V2={leads:'pmi-leads'};")
m = re.search(r"const DEFAULT_PRAISE=(\{.*?\});\n", s, re.S)
P = json.loads(m.group(1))
mats = [[k, v['n']] for k, v in P.items() if not v.get('media')]
s = s[:m.start()] + 'const BASE_MATS=' + json.dumps(mats, ensure_ascii=False) + ';\n' + s[m.end():]
rep(" {id:'photos',ic:'📸',t:'Photos',x:'{greet} {name},\\nSharing the latest photos of {interest}. Ready stock, multiple sizes & finishes 📦\\nSend me your sizes & quantity for the best price.'},\n", "")
rep("toast('⚠ Storage full. Back up, then delete some photos.')", "toast('⚠ Storage full on this device. Back up now.')")

# ---------- data load ----------
rep("let praise=loadPraise();\n", "")
rep("""let sets=load(K.sets,null);if(!Array.isArray(sets)){sets=load(V2.sets,[]);if(!Array.isArray(sets))sets=[];}
leads.forEach(normalize);sets.forEach(normSet);
if(leads.length)store(K.leads,leads);if(sets.length)store(K.sets,sets);
""", """if(!leads.length){const v4=load('pl4-leads',null);if(Array.isArray(v4)&&v4.length){leads=v4.map(fromV4);bootMsg='Moved '+v4.length+' leads from v4 ✓';}}
leads=leads.map(x=>normalize(fromV4(x)));
let gone=leads.filter(l=>l.del);leads=leads.filter(l=>!l.del);
const lastSaved=new Map();leads.concat(gone).forEach(l=>lastSaved.set(l.id,sig(l)));
if(leads.length||gone.length)store(K.leads,leads.concat(gone));
""")
rep("""function loadPraise(){const m=JSON.parse(JSON.stringify(DEFAULT_PRAISE));const ov=load(K.praise,null)||load(V2.praise,{})||{};for(const k in ov)if(m[k])['short','full','cta'].forEach(f=>{if(ov[k][f]!=null)m[k][f]=ov[k][f];});return m;}
function allMats(){const b=Object.keys(DEFAULT_PRAISE).filter(c=>!DEFAULT_PRAISE[c].media).map(c=>({code:c,n:DEFAULT_PRAISE[c].n}));return b.concat(customMats.filter(m=>!b.some(x=>x.code===m.code)));}
function matName(c){const m=allMats().find(x=>x.code===c)||(DEFAULT_PRAISE[c]&&{n:DEFAULT_PRAISE[c].n});return m?m.n:c;}""",
"""function allMats(){const b=BASE_MATS.map(([code,n])=>({code,n}));return b.concat(customMats.filter(m=>!b.some(x=>x.code===m.code)));}
function matName(c){const m=allMats().find(x=>x.code===c);return m?m.n:c;}
/* v4 record -> v3 record (v4 was the short-lived rewrite) */
function fromV4(l){if(!l||l.company===undefined||l.party!==undefined)return l;const cl=l.stage==='closed';
  return {id:l.id,u:l.u,del:l.del,m:l.m,party:l.company||'',contact:l.contact||'',phone:l.phone||'',email:l.email||'',country:l.country||'',source:l.source||'',status:'',notes:l.notes||'',req:[l.req&&l.req.mat,l.req&&l.req.size,l.req&&l.req.qty,l.req&&l.req.price].filter(Boolean).join(' · '),
    stage:cl?'talking':(l.stage||'new'),archived:cl?'Closed':'',contactLog:(l.log||[]).map(e=>({date:e.d,shared:[],note:e.n||''})),next:{date:l.next||'',what:l.what||''},dateAdded:l.added||'',updatedAt:l.u?new Date(l.u).toISOString():''};}
function sig(l){return JSON.stringify(l,(k,v)=>k==='u'?undefined:v);}""")
rep("  if(!l.dateAdded)l.dateAdded=String(l.createdAt||'').slice(0,10)||today();\n  return l;}",
    "  if(!l.dateAdded)l.dateAdded=String(l.createdAt||'').slice(0,10)||today();\n  if(l.req==null)l.req='';\n  if(!/^\\d{4}-\\d\\d$/.test(l.m||''))l.m=(/^\\d{4}-\\d\\d/.test(l.dateAdded)?l.dateAdded:today()).slice(0,7);\n  if(typeof l.u!=='number')l.u=Date.parse(l.updatedAt||'')||1;\n  return l;}")
m = re.search(r"function normSet\(s\)\{.*?\n", s)
s = s[:m.start()] + s[m.end():]
rep("function saveLeads(){store(K.leads,leads);meta.changes=(meta.changes||0)+1;store(K.meta,meta);}\nfunction saveSets(){store(K.sets,sets);}",
    """let lastU=0;function stampU(){let t=Date.now();if(t<=lastU)t=lastU+1;lastU=t;return t;}
/* every save: records whose content changed get a new u and are queued for sync */
function saveLeads(){let ch=0;for(const l of leads.concat(gone)){const g=sig(l);if(lastSaved.get(l.id)!==g){l.u=stampU();lastSaved.set(l.id,g);markDirty(l.id);ch++;}}
  store(K.leads,leads.concat(gone));if(ch){meta.changes=(meta.changes||0)+1;store(K.meta,meta);}}""")

# ---------- delete = soft delete; undo also restores from bin ----------
rep("function undo(){if(!undoSnap)return;const i=leads.findIndex(x=>x.id===undoSnap.id);if(i>=0)leads[i]=undoSnap.data;else leads.unshift(undoSnap.data);",
    "function undo(){if(!undoSnap)return;gone=gone.filter(x=>x.id!==undoSnap.id);delete undoSnap.data.del;const i=leads.findIndex(x=>x.id===undoSnap.id);if(i>=0)leads[i]=undoSnap.data;else leads.unshift(undoSnap.data);")
rep("if(confirm('Delete '+title(l)+'?')){snap(l);leads=leads.filter(x=>x.id!==l.id);saveLeads();",
    "if(confirm('Delete '+title(l)+'? (Kept in ⋯ › Recycle bin)')){snap(l);leads=leads.filter(x=>x.id!==l.id);l.del=1;gone.push(l);saveLeads();")

# ---------- views: no photos tab ----------
rep("$('#fab').onclick=()=>view==='photos'?newSet():openAdd();", "$('#fab').onclick=()=>openAdd();")
rep("  $('#q').placeholder=view==='photos'?'Search photo sets…':'Search name, country, number, material…';", "  $('#q').placeholder='Search name, country, number, material…';")
rep("function renderMain(){if(view==='leads')renderLeads();else if(view==='photos')renderPhotos();else renderToday();}",
    "function renderMain(){if(document.documentElement.classList.contains('lk'))return;if(view==='leads')renderLeads();else renderToday();}")
rep("l.status,l.notes,l.next.what,", "l.status,l.notes,l.req,l.next.what,")
rep("""  let best=null;sets.forEach(s=>{if(!s.mat)return;const n=active().filter(l=>l.interests.includes(s.mat)&&!sentDate(l,s)).length;if(n>=2&&(!best||n>best.n))best={s,n};});
  if(best)h+='<button class="nudge" data-n="set" data-id="'+best.s.id+'">📸<span>'+best.n+' leads want '+esc(best.s.mat)+' but haven’t got “'+esc(best.s.title)+'”</span><b>Send</b></button>';
""", "")
rep("if(meta.changes>0&&(bd===null||bd>=3))", "if(!S.on&&meta.changes>0&&(bd===null||bd>=3))")
rep("h+='<button class=\"nudge\" data-n=\"bk\">💾<span>'+(bd===null?'Not backed up yet':'Last backup '+bd+' days ago')+'</span><b>Back up</b></button>';",
    "h+='<button class=\"nudge\" data-n=\"bk\">💾<span>'+(bd===null?'Not backed up yet':'Last backup '+bd+' days ago')+' · or turn on sync</span><b>Back up</b></button>';")
rep("b.onclick=()=>{if(b.dataset.n==='bk')backup();else openSet(b.dataset.id);}", "b.onclick=()=>backup(true)")
rep("'<span class=\"ln\">'+esc(l.next.what||l.status)+'</span>'", "'<span class=\"ln\">'+esc(l.next.what||l.req||l.status)+'</span>'")

# ---------- lead sheet: no photos strip, add requirement ----------
rep("  const ps=sets.map(x=>({x,sent:sentDate(l,x),want:!!(x.mat&&l.interests.includes(x.mat)),hero:hero(x.id)})).sort((a,b)=>((a.sent?1:0)-(b.sent?1:0))||((b.want?1:0)-(a.want?1:0)));\n", "")
m = re.search(r"   \+\(ps\.length\?'<div class=\"box\"><div class=\"lbl\">📸 Send photos.*?\n", s)
s = s[:m.start()] + s[m.end():]
rep("<button class=\"chip\" data-a=\"mat\">＋</button></div></div>'",
    "<button class=\"chip\" data-a=\"mat\">＋</button></div><div class=\"lbl\" style=\"margin:12px 0 7px\">Requirement</div><input id=\"nR\" placeholder=\"Size, finish, quantity, target price\" value=\"'+esc(l.req||'')+'\" enterkeyhint=\"done\"></div>'")
rep("(e.sets&&e.sets.length)?e.sets:(e.sent?[e.sent]:[])).map(x=>'📸 '+x).join(', ')", "(e.sets&&e.sets.length)?e.sets:(e.sent?[e.sent]:[])).join(', ')")
rep("  q('[data-send]').forEach(b=>b.onclick=()=>sendSet(l,sets.find(x=>x.id===b.dataset.send)));\n",
    "  const nR=sc.querySelector('#nR');nR.onchange=()=>{l.req=nR.value.trim();touch(l);saveLeads();render();};nR.onkeydown=e=>{if(e.key==='Enter')nR.blur();};\n")
rep("if(allMats().some(m=>m.code===c)||DEFAULT_PRAISE[c]){toast(c+' already exists');return;}customMats.push({code:c,n});store(K.mats,customMats);",
    "if(allMats().some(m=>m.code===c)){toast(c+' already exists');return;}customMats.push({code:c,n});store(K.mats,customMats);metaChanged('mats');")

# ---------- photo sets block: remove ----------
a = s.index('/* ---------- photo sets ---------- */')
b = s.index('/* ---------- add lead ---------- */')
s = s[:a] + s[b:]

# add-lead: requirement field
rep("+'<input id=\"aW\" style=\"margin-top:8px\" placeholder=\"Next step, e.g. Send WL photos + price\"></div>'",
    "+'<input id=\"aR\" style=\"margin-top:8px\" placeholder=\"Requirement: size, finish, qty, price\"><input id=\"aW\" style=\"margin-top:8px\" placeholder=\"Next step, e.g. Send price list\"></div>'")
rep("notes:v('#aT'),interests:s.d.interests.slice()});", "notes:v('#aT'),req:v('#aR'),interests:s.d.interests.slice()});")
rep("  if(!isTouch())setTimeout(()=>sc.querySelector('#aN').focus(),250);}",
    "  if(!isTouch())setTimeout(()=>sc.querySelector('#aN').focus(),250);}\nconst isTouch=()=>(navigator.maxTouchPoints||0)>0&&/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);")
rep("function findDup(phone,email,exId){", "function findDup(phone,email,exId){/* live leads only */")

# ---------- backup / import ----------
rep("""async function backup(share){const name='pmi-leads3-'+stamp()+'.json',txt=JSON.stringify({app:'pmi-leads',version:3,exported:nowISO(),leads,sets,templates:tpls,settings:CFG,customMats,praise:load(K.praise,{})},null,1);
  if(share&&navigator.canShare){try{const f=new File([txt],name,{type:'application/json'});""",
"""async function backup(share){const name='pmi-leads3-'+stamp()+(share?'.txt':'.json'),txt=JSON.stringify({app:'pmi-leads',version:3,exported:nowISO(),leads:leads.concat(gone),templates:tpls,settings:CFG,customMats},null,1);
  if(share&&navigator.canShare){try{const f=new File([txt],name,{type:'text/plain'});""")
rep("  dl(name,txt,'application/json');meta.lastBackup=nowISO();", "  dl(name,txt,share?'text/plain':'application/json');meta.lastBackup=nowISO();")
rep("async function backupPhotos(){await ensureImgs();dl('pmi-material-images.json',JSON.stringify({sets,images:imgCache,plans:[]}),'application/json');toast('Photos backup saved');}\n", "")
rep("""    else if(o&&Array.isArray(o.leads)){msg.push(importLeads(o.leads));if(Array.isArray(o.sets))mergeSets(o.sets);if(Array.isArray(o.templates)&&o.templates.length){tpls=o.templates;store(K.tpl,tpls);}if(o.settings){CFG=Object.assign({},DEFAULT_CFG,o.settings);store(K.cfg,CFG);}if(Array.isArray(o.customMats)){o.customMats.forEach(m=>{if(!customMats.some(x=>x.code===m.code))customMats.push(m);});store(K.mats,customMats);}if(o.praise){store(K.praise,o.praise);praise=loadPraise();}}
    else if(o&&(o.images||o.sets)){if(Array.isArray(o.sets))mergeSets(o.sets);let n=0;for(const k in (o.images||{})){await imgsPut(k,o.images[k]);n+=(o.images[k]||[]).length;}imgsLoaded=false;await ensureImgs();msg.push('Photos: '+plural((o.sets||[]).length,'set')+', '+n+' pics');}
    else msg.push(f.name+': unknown file');}
  sets.forEach(normSet);saveSets();leads.forEach(normalize);store(K.leads,leads);fillCountries();render();toast(msg.join(' · '),null,null,6000);};""",
"""    else if(o&&Array.isArray(o.leads)){msg.push(importLeads(o.leads));if(o.version===3){if(Array.isArray(o.templates)&&o.templates.length&&!mu.tpl){tpls=o.templates.filter(t=>t&&t.id!=='photos');store(K.tpl,tpls);metaChanged('tpl');}if(o.settings&&!mu.cfg){CFG=Object.assign({},DEFAULT_CFG,o.settings);store(K.cfg,CFG);metaChanged('cfg');}if(Array.isArray(o.customMats)){let n=0;o.customMats.forEach(m=>{if(m&&m.code&&!customMats.some(x=>x.code===m.code)){customMats.push(m);n++;}});if(n){store(K.mats,customMats);metaChanged('mats');}}}}
    else if(o&&(o.images||o.sets))msg.push(f.name+': photo backups are no longer used');
    else msg.push(f.name+': unknown file');}
  saveLeads();fillCountries();render();toast(msg.join(' · '),null,null,6000);};""")
rep("""function importLeads(arr){let a=0,u=0;arr.forEach(x=>{if(!x||typeof x!=='object')return;const l=normalize(JSON.parse(JSON.stringify(x)));const i=leads.findIndex(y=>y.id===l.id);if(i<0){leads.push(l);a++;}else if(String(l.updatedAt||'')>String(leads[i].updatedAt||'')){leads[i]=l;u++;}});return 'Leads: '+a+' added'+(u?', '+u+' updated':'');}
function mergeSets(arr){arr.forEach(x=>{const s=normSet(JSON.parse(JSON.stringify(x)));const i=sets.findIndex(y=>y.id===s.id);i<0?sets.push(s):Object.assign(sets[i],s);});saveSets();}""",
"""/* import merges and never deletes: deleted records in a file are ignored */
function importLeads(arr){let a=0,u=0;arr.forEach(x=>{if(!x||typeof x!=='object'||x.del)return;const l=normalize(fromV4(JSON.parse(JSON.stringify(x))));
  const gi=gone.findIndex(y=>y.id===l.id),i=leads.findIndex(y=>y.id===l.id),cur=i>=0?leads[i]:gi>=0?gone[gi]:null;
  if(!cur){leads.push(l);a++;}else if(newerRec(l,cur)){if(gi>=0)gone.splice(gi,1);if(i>=0)leads[i]=l;else leads.push(l);u++;}});return 'Leads: '+a+' added'+(u?', '+u+' updated':'');}
function newerRec(a,b){const ua=Date.parse(a.updatedAt||'')||a.u||0,ub=Date.parse(b.updatedAt||'')||b.u||0;return ua>ub;}""")
rep("dl('pmi-leads-'+stamp()+'.csv','﻿'+[cols.join(',')].concat(leads.map(l=>{const o={...l,wants:l.interests.join(' '),",
    "dl('pmi-leads-'+stamp()+'.csv','﻿'+[cols.join(',')].concat(leads.map(l=>{const o={...l,wants:l.interests.join(' ')+(l.req?' | '+l.req:''),")

# ---------- menu ----------
rep("""   +'<div class="box menu"><button data-m="bk"><span class="i">💾</span><span>Back up now<small>Saves a file with all your leads</small></span></button>'+(share?'<button data-m="bks"><span class="i">📤</span><span>Share backup<small>To Google Drive, WhatsApp, email</small></span></button>':'')+'<button data-m="imp"><span class="i">📥</span><span>Restore / import<small>Leads 2 or Leads 3 backup, photos backup</small></span></button><button data-m="bkp"><span class="i">🖼</span><span>Back up photos</span></button></div>'""",
"""   +'<div class="box menu"><button data-m="sync"><span class="i">☁️</span><span>Sync phone ↔ PC<small id="syncMini">'+syncLine()+'</small></span></button><button data-m="lock"><span class="i">🔒</span><span>App lock<small>'+(lockOn()?'On':'Off')+'</small></span></button></div>'
   +'<div class="box menu">'+(share?'<button data-m="bks"><span class="i">📤</span><span>Send backup to…<small>Google Drive, WhatsApp, email (.txt file)</small></span></button>':'')+'<button data-m="bk"><span class="i">💾</span><span>Download backup<small>JSON file with all your leads</small></span></button><button data-m="imp"><span class="i">📥</span><span>Restore / import<small>Merges, never deletes. Old pmi-leads.json works too</small></span></button><button data-m="bin"><span class="i">🗑</span><span>Recycle bin<small>'+plural(gone.length,'deleted lead')+'</small></span></button></div>'""")
rep("imp:()=>{closeSheet();$('#fImport').click();},bkp:()=>{closeSheet();backupPhotos();},",
    "imp:()=>{closeSheet();$('#fImport').click();},sync:()=>swap(openSync),lock:()=>swap(openLock),bin:()=>swap(openBin),")
rep("s.sc.querySelectorAll('[data-k]').forEach(i=>i.onchange=()=>{const k=i.dataset.k;let v=i.value.trim();if(i.type==='number'){v=Math.max(1,parseInt(v,10)||DEFAULT_CFG[k]);i.value=v;}CFG[k]=v;store(K.cfg,CFG);render();toast('Saved');});}",
    "s.sc.querySelectorAll('[data-k]').forEach(i=>i.onchange=()=>{const k=i.dataset.k;let v=i.value.trim();if(i.type==='number'){v=Math.max(1,parseInt(v,10)||DEFAULT_CFG[k]);i.value=v;}CFG[k]=v;store(K.cfg,CFG);metaChanged('cfg');render();toast('Saved');});}")
rep("s.sc.querySelectorAll('[data-p]').forEach(i=>i.onchange=()=>{tpls[+i.dataset.i][i.dataset.p]=i.value;store(K.tpl,tpls);});",
    "s.sc.querySelectorAll('[data-p]').forEach(i=>i.onchange=()=>{tpls[+i.dataset.i][i.dataset.p]=i.value;store(K.tpl,tpls);metaChanged('tpl');});")
rep("if(confirm('Delete this template?')){tpls.splice(+b.dataset.del,1);store(K.tpl,tpls);draw();}", "if(confirm('Delete this template?')){tpls.splice(+b.dataset.del,1);store(K.tpl,tpls);metaChanged('tpl');draw();}")
rep("tpls.push({id:'c'+Date.now().toString(36),ic:'💬',t:'New',x:'{greet} {name},\\n'});store(K.tpl,tpls);draw();", "tpls.push({id:'c'+Date.now().toString(36),ic:'💬',t:'New',x:'{greet} {name},\\n'});store(K.tpl,tpls);metaChanged('tpl');draw();")
rep("if(confirm('Reset to the defaults?')){tpls=JSON.parse(JSON.stringify(DEFAULT_TPL));store(K.tpl,tpls);draw();}", "if(confirm('Reset to the defaults?')){tpls=JSON.parse(JSON.stringify(DEFAULT_TPL));store(K.tpl,tpls);metaChanged('tpl');draw();}")

# ---------- welcome & boot ----------
rep("<ol><li>In Leads 2, tap <b>↯ Backup</b>. It saves two files.</li><li>Tap <b>Import</b> below and pick both files.</li></ol><button class=\"btn pri\" id=\"wI\">📥 Import backup</button><button class=\"btn\" id=\"wA\">＋ Add a lead</button></div>';}",
    "<ol><li>Already using sync on another device? Tap <b>☁️ Connect sync</b>.</li><li>Otherwise tap <b>Import</b> and pick your <b>pmi-leads.json</b> or a backup file.</li></ol><button class=\"btn pri\" id=\"wS\">☁️ Connect sync</button><button class=\"btn\" id=\"wI\">📥 Import backup</button><button class=\"btn\" id=\"wA\">＋ Add a lead</button></div>';}")
rep("function wireWelcome(){$('#wI').onclick=()=>$('#fImport').click();$('#wA').onclick=openAdd;}",
    "function wireWelcome(){$('#wS').onclick=openSync;$('#wI').onclick=()=>$('#fImport').click();$('#wA').onclick=openAdd;}")
rep("else if(e.key==='2')go('leads');else if(e.key==='3')go('photos');});", "else if(e.key==='2')go('leads');});")
rep("ensureImgs();\n", "")


# ---------- layout: denser cards, Country sort, 2 columns on PC ----------
rep(".mini{font-size:12px;color:var(--mut)}\n",
    ".mini{font-size:12px;color:var(--mut)}\n"
    ".card{margin:2px 0;border-radius:9px}.card .in{gap:8px;padding:3px 4px 3px 9px;min-height:40px}.bar .chips{padding-top:6px}.bar{padding-bottom:2px}\n"
    ".nm{font-size:14.5px}.sub{margin-top:1px;font-size:12px}.wa{width:38px;height:32px;border-radius:9px}.wa svg{width:20px;height:20px}\n"
    ".tm{font-size:12px}.sec{margin:10px 4px 2px}.sec.cty{margin:8px 4px 1px;text-transform:none;letter-spacing:0;font-size:12.5px;color:var(--ink);gap:6px}\n"
    "@media(min-width:900px){#app{max-width:1180px}.bar{margin:0;padding:6px 0 4px}#main{display:grid;grid-template-columns:1fr 1fr;column-gap:8px;align-items:start}@media(min-width:1400px){#main{grid-template-columns:1fr 1fr 1fr}#app{max-width:1600px}}"
    "#main>.sec,#main>.empty,#main>.more,#main>.nudge,#main>.hint,#main>.welcome{grid-column:1/-1}.welcome{max-width:600px;justify-self:center;width:100%}}\n", 1)
rep("const SORTS={next:'Next step',az:'A–Z',time:'Their time'};", "const SORTS={next:'Next step',country:'Country',time:'Their time',az:'A–Z'};")
rep("const UI=Object.assign({stage:'',mat:'',sort:'next'},load(K.ui,{}));", "const UI=Object.assign({stage:'',mat:'',sort:'country'},load(K.ui,{}));if(!['next','country','time','az'].includes(UI.sort)||!load('pmi3-v32ui',0)){UI.sort='country';store('pmi3-v32ui',1);}")
rep("  if(UI.sort==='az')r.sort((a,b)=>title(a).localeCompare(title(b)));",
    "  const mins=l=>(clockOf(l)||{mins:9999}).mins;\n  if(UI.sort==='country')r.sort((a,b)=>(!a.country-!b.country)||(a.country||'').localeCompare(b.country||'')||mins(a)-mins(b)||title(a).localeCompare(title(b)));\n  else if(UI.sort==='az')r.sort((a,b)=>title(a).localeCompare(title(b)));")
rep("(r.length?r.slice(0,limit).map(card).join(''):'<div class=\"empty\">No leads here.</div>')",
    "(r.length?listHtml(r.slice(0,limit)):'<div class=\"empty\">No leads here.</div>')")
rep("let limit=80;",
    "let limit=150;\n/* in Country sort, a slim header per country */\nfunction listHtml(arr){if(UI.sort!=='country')return arr.map(card).join('');const n={};arr.forEach(l=>{const c=l.country||'';n[c]=(n[c]||0)+1;});let h='',last=null;arr.forEach(l=>{const c=l.country||'';if(c!==last){last=c;h+='<div class=\"sec cty\">'+(c?flag(c)+' '+esc(c):'No country')+' <span class=\"n\" style=\"color:var(--mut)\">'+n[c]+'</span></div>';}h+=card(l);});return h;}")
rep("function renderLeadList(more){if(!more)limit=80;", "function renderLeadList(more){if(!more)limit=150;")
rep("if(mb)mb.onclick=()=>{limit+=80;renderLeadList(true);};", "if(mb)mb.onclick=()=>{limit+=150;renderLeadList(true);};")

SYNC = open(__file__.replace('build_v32.py', 'sync_v32.js'), encoding='utf8').read()
rep("fillCountries();render();\n", SYNC + "\nfillCountries();render();\nif(document.documentElement.classList.contains('lk'))setTimeout(()=>$('#lockP').focus(),60);\nif(S.on)schedule(300);\n")

# leftovers check
for bad in ['DEFAULT_PRAISE', 'praise', 'imgCache', 'sendSet', 'openSet', 'renderPhotos', 'saveSets', 'normSet', 'ensureImgs', 'sentDate', 'hero(', "view==='photos'", "go('photos')", 'fImgs']:
    if bad in s:
        i = s.index(bad)
        raise SystemExit('leftover ' + bad + ': ' + s[max(0, i - 80):i + 80])
open(out, 'w', encoding='utf8').write(s)
print('ok', len(s))
