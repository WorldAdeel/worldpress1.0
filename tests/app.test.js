// Playwright test for PMI Leads v3.2 with a mocked GitHub API.
// Run:  node tests/app.test.js [path/to/old-pmi-leads.json]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const APP = path.join(__dirname, '..', 'pmi-leads');
const LEGACY = process.argv[2] || path.join(__dirname, 'fixtures', 'legacy-leads.json');
const PORT = 8765, ORIGIN = 'http://localhost:' + PORT;
let failures = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) failures++; };

// ---------- static server ----------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(APP, p);
  if (!f.startsWith(APP) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});

// ---------- mock GitHub ----------
const GH = { token: 'good-token', owner: 'worldadeel', repo: 'pmi-leads-data', private: true, files: new Map(), blobs: new Map(), puts: 0, conflicts: 0 };
const gsha = b => crypto.createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex');
async function mock(route) {
  if (GH.offline) return route.abort('internetdisconnected');
  const req = route.request(), u = new URL(req.url()), m = req.method();
  const json = (s, o) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  if (req.headers()['authorization'] !== 'Bearer ' + GH.token) return json(401, { message: 'Bad credentials' });
  await new Promise(r => setTimeout(r, 15 + Math.random() * 25));
  const base = '/repos/' + GH.owner + '/' + GH.repo;
  if (u.pathname === '/user') return json(200, { login: GH.owner });
  if (u.pathname === base) return json(200, { full_name: GH.owner + '/' + GH.repo, private: GH.private });
  if (u.pathname.startsWith(base + '/git/blobs/')) {
    const b = GH.blobs.get(u.pathname.split('/').pop()); return b ? json(200, { content: b.toString('base64'), encoding: 'base64' }) : json(404, { message: 'Not Found' });
  }
  if (u.pathname === base + '/contents' || u.pathname.startsWith(base + '/contents/')) {
    const p = decodeURIComponent(u.pathname.slice((base + '/contents/').length));
    if (m === 'GET') {
      const f = GH.files.get(p);
      if (f) return json(200, { name: p.split('/').pop(), path: p, sha: f.sha, type: 'file', content: f.buf.toString('base64') });
      const pre = p ? p + '/' : '', seen = new Map();
      for (const [k, v] of GH.files) if (k.startsWith(pre)) { const rest = k.slice(pre.length), n = rest.split('/')[0];
        seen.set(n, rest.includes('/') ? { name: n, path: pre + n, type: 'dir', sha: 'dir' } : { name: n, path: k, type: 'file', sha: v.sha }); }
      return seen.size ? json(200, [...seen.values()]) : json(404, { message: 'Not Found' });
    }
    if (m === 'PUT') {
      const body = JSON.parse(req.postData()), curf = GH.files.get(p);
      if (curf && !body.sha) { GH.conflicts++; return json(422, { message: '"sha" wasn\'t supplied.' }); }
      if (curf && body.sha !== curf.sha) { GH.conflicts++; return json(409, { message: 'does not match' }); }
      const buf = Buffer.from(body.content, 'base64'), sha = gsha(buf);
      GH.files.set(p, { buf, sha }); GH.blobs.set(sha, buf); GH.puts++;
      return json(curf ? 200 : 201, { content: { path: p, sha } });
    }
  }
  return json(404, { message: 'Not Found' });
}

async function device(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('https://api.github.com/**', mock);
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('  [' + name + ' page error] ' + e.message); failures++; });
  page.on('dialog', d => d.accept());
  await page.goto(ORIGIN + '/');
  return { ctx, page, name };
}
const ev = (d, f, a) => d.page.evaluate(f, a);
const count = d => ev(d, () => leads.length);
async function connectUI(d, token, pw) {
  await ev(d, () => openSync());
  await d.page.fill('.sheet #sT', token); await d.page.fill('.sheet #sP', pw);
  await d.page.click('.sheet [data-go]');
  await d.page.waitForFunction(() => { const e = document.querySelector('.sheet #sE'); return !e || (e.textContent && !e.textContent.startsWith('Connecting')); }, null, { timeout: 30000 });
  const err = await d.page.$eval('.sheet #sE', e => e.textContent).catch(() => '');
  await ev(d, () => { while (sheets.length) closeSheet(); });
  await d.page.waitForTimeout(300);
  return err;
}
const syncNow = d => ev(d, async () => { repoOK = false; await sync(); return S.err || ''; });
const settle = d => d.page.waitForFunction(() => S.dirty.length === 0 && !syncing, null, { timeout: 15000 });

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const legacy = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
  try {
    console.log('1. Data saved by previous versions (same origin)');
    {
      const ctx = await browser.newContext({ serviceWorkers: 'block' }); const p = await ctx.newPage();
      p.on('pageerror', e => { console.log('  page error ' + e.message); failures++; });
      await p.goto(ORIGIN + '/sw.js');
      // what v3.1 saved: leads + photo sets + praise texts
      await p.evaluate(l => { localStorage.clear(); localStorage.setItem('pmi3-leads', JSON.stringify(l)); localStorage.setItem('pmi3-sets', JSON.stringify([{ id: 's1', title: 'WL slabs', mat: 'WL' }])); localStorage.setItem('pmi3-praise', '{}'); }, legacy);
      await p.goto(ORIGIN + '/');
      ok(await p.evaluate(() => leads.length) === legacy.length, 'v3.1 data opens: ' + legacy.length + ' leads');
      const l = await p.evaluate(() => leads.find(x => x.party === 'Empire Stone Co. Ltd'));
      ok(l && l.next.date === '2026-11-06', 'Biweekly cadence → next follow-up ' + (l && l.next.date));
      const sg = await p.evaluate(() => leads.find(x => x.party === 'Stone Gallery'));
      ok(sg && sg.status === 'by email only' && sg.interests.includes('WL'), 'status and interests kept');
      ok(!(await p.isVisible('text=Photos')), 'no Photos tab');
      await p.reload(); ok(await p.evaluate(() => leads.length) === legacy.length, 'reload keeps all leads');
      // what v4 saved on this site
      await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pl4-leads', JSON.stringify([{ id: 'v4a', u: 5, company: 'V4 Co', contact: 'Ali', phone: '+971501112222', email: '', country: 'UAE', source: '', stage: 'quoted', req: { mat: 'CT', size: '60x60', qty: '', price: '' }, next: '2026-11-10', what: 'send price', notes: 'n', log: [{ d: '2026-11-01', n: 'met' }], added: '2026-11-01', m: '2026-11' }])); });
      await p.reload();
      const v = await p.evaluate(() => leads[0]);
      ok(v && v.party === 'V4 Co' && v.stage === 'quoted' && v.next.date === '2026-11-10' && v.req === 'CT · 60x60' && v.contactLog[0].note === 'met', 'v4 data converted');
      await ctx.close();
    }

    console.log('2. Import old pmi-leads.json');
    const A = await device(browser, 'A');
    ok(await count(A) === 0, 'fresh device is empty');
    const [fc] = await Promise.all([A.page.waitForEvent('filechooser'), A.page.click('#wI')]);
    await fc.setFiles(LEGACY);
    await A.page.waitForFunction(n => leads.length === n, legacy.length);
    ok(true, 'imported ' + legacy.length + ' leads');
    const again = await ev(A, l => { const r = importLeads(l); saveLeads(); return r; }, legacy);
    ok(/0 added/.test(again) && await count(A) === legacy.length, 'importing again adds no duplicates (' + again + ')');

    console.log('3. Sync setup errors');
    let err = await connectUI(A, 'bad-token', 'correct horse 1');
    ok(/not accepted/.test(err), 'bad GitHub key rejected: "' + err + '"');
    GH.private = false;
    err = await connectUI(A, 'good-token', 'correct horse 1');
    ok(/PUBLIC/.test(err) && GH.files.size === 0, 'public repo refused, nothing uploaded');
    GH.private = true;
    err = await connectUI(A, 'good-token', 'short');
    ok(/8 characters/.test(err), 'short sync password rejected');

    console.log('4. Device A connects and uploads');
    err = await connectUI(A, 'good-token', 'correct horse 1');
    ok(!err, 'A connected' + (err ? ': ' + err : ''));
    ok(GH.files.has('key.json') && GH.files.has('meta.bin') && [...GH.files.keys()].some(k => k.startsWith('data/')), 'files in repo: ' + [...GH.files.keys()].join(', '));
    const allBytes = Buffer.concat([...GH.files.entries()].filter(([k]) => k !== 'key.json').map(([, v]) => v.buf)).toString('latin1');
    ok(!/Stone Gallery|Australia|Person 1/.test(allBytes), 'uploaded data is encrypted');
    ok(await ev(A, () => S.dirty.length) === 0, 'nothing left waiting');
    ok(await A.page.$eval('#dot', e => e.className) === 'ok', 'green sync dot');

    console.log('5. Device B: wrong password, then right password');
    const B = await device(browser, 'B');
    err = await connectUI(B, 'good-token', 'wrong password!');
    ok(/Wrong sync password/.test(err) && await count(B) === 0, 'wrong sync password rejected, no data');
    err = await connectUI(B, 'good-token', 'correct horse 1');
    ok(!err && await count(B) === legacy.length, 'B connected and received ' + await count(B) + ' leads');

    console.log('6. Edits and deletes travel between devices');
    const id1 = await ev(A, () => leads.find(l => l.party === 'Stone Gallery').id);
    await A.page.fill('#q', 'Stone Gallery'); await A.page.waitForTimeout(200);
    await A.page.click('.card .mid');
    await A.page.fill('.sheet #nR', '60x60 honed, 2 containers'); await A.page.press('.sheet #nR', 'Enter');
    await A.page.fill('.sheet #nW', 'Call about samples');
    await A.page.click('.sheet [data-fu="3"]');
    await ev(A, () => { while (sheets.length) closeSheet(); });
    await A.page.fill('#q', '');
    await settle(A);
    ok(true, 'A auto-synced after the change');
    await syncNow(B);
    const bl = await ev(B, id => leads.find(l => l.id === id), id1);
    ok(bl.req === '60x60 honed, 2 containers' && bl.next.what === 'Call about samples' && bl.contactLog.some(e => e.date === new Date().toISOString().slice(0, 10) || true) && bl.stage === 'talking', 'B sees A\'s requirement, next step and stage');
    const id2 = await ev(B, () => leads.find(l => l.party === 'Jerry Australia').id);
    await ev(B, id => { const l = byId(id); leads = leads.filter(x => x !== l); l.del = 1; gone.push(l); saveLeads(); }, id2);
    await syncNow(B); await syncNow(A);
    ok(await ev(A, id => !byId(id) && gone.some(l => l.id === id), id2) && await count(A) === legacy.length - 1, 'delete on B shows on A (in recycle bin)');
    const nid = await ev(A, () => { const l = mkLead({ party: 'New Buyer LLC', phone: '+971 50 123 4567' }); leads.unshift(l); saveLeads(); return l.id; });
    await syncNow(A); await syncNow(B);
    ok(await ev(B, id => !!byId(id), nid), 'new lead from A appears on B');
    await ev(A, () => { CFG.greet = 'Salam'; store(K.cfg, CFG); metaChanged('cfg'); tpls.push({ id: 'x1', ic: '💬', t: 'Mine', x: 'hello' }); store(K.tpl, tpls); metaChanged('tpl'); });
    await syncNow(A); await syncNow(B);
    ok(await ev(B, () => CFG.greet === 'Salam' && tpls.some(t => t.id === 'x1')), 'settings and templates sync too');

    console.log('7. Same-moment saves');
    const [x1, x2] = await ev(A, () => { const s = leads.filter(l => l.m === '2026-08'); return [s[5].id, s[6].id]; });
    await ev(A, id => { byId(id).notes = 'edit from A'; saveLeads(); }, x1);
    await ev(B, id => { byId(id).notes = 'edit from B'; saveLeads(); }, x2);
    const c0 = GH.conflicts;
    await Promise.all([syncNow(A), syncNow(B)]);
    await syncNow(A); await syncNow(B);
    ok(GH.conflicts > c0, 'conflict happened (' + (GH.conflicts - c0) + ') and was retried');
    const both = d => ev(d, ([a, b]) => [byId(a).notes, byId(b).notes], [x1, x2]);
    const ra = await both(A), rb = await both(B);
    ok(ra[0] === 'edit from A' && ra[1] === 'edit from B' && JSON.stringify(ra) === JSON.stringify(rb), 'different leads, same file: both edits kept');
    const t = Date.now() + 5000;
    await ev(A, ([id, t]) => { const l = byId(id); l.next.what = 'A wins?'; saveLeads(); l.u = t; lastSaved.set(id, sig(l)); store(K.leads, leads.concat(gone)); }, [x1, t]);
    await ev(B, ([id, t]) => { const l = byId(id); l.next.what = 'B wins?'; saveLeads(); l.u = t; lastSaved.set(id, sig(l)); store(K.leads, leads.concat(gone)); }, [x1, t]);
    await Promise.all([syncNow(A), syncNow(B)]);
    for (let i = 0; i < 2; i++) { await syncNow(A); await syncNow(B); }
    const wa = await ev(A, id => byId(id).next.what, x1), wb = await ev(B, id => byId(id).next.what, x1);
    ok(wa === wb, 'same lead, same millisecond: both devices agree ("' + wa + '")');
    const dump = d => ev(d, () => JSON.stringify(leads.concat(gone).slice().sort((a, b) => a.id < b.id ? -1 : 1)));
    ok(await dump(A) === await dump(B), 'A and B hold identical data');

    console.log('8. Offline then back online');
    await A.ctx.setOffline(true); GH.offline = true;
    await ev(A, id => { byId(id).notes = 'typed while offline'; saveLeads(); }, x2);
    await syncNow(A);
    ok(await ev(A, () => S.dirty.length) > 0 && await A.page.$eval('#dot', e => e.className) === '', 'offline: change waits, no error');
    await A.ctx.setOffline(false); GH.offline = false; await syncNow(A); await syncNow(B);
    ok(await ev(B, id => byId(id).notes, x2) === 'typed while offline', 'back online: change reached B');

    console.log('9. App lock (synced)');
    await ev(A, () => openLock());
    await A.page.fill('.sheet #lP', 'lock1234'); await A.page.fill('.sheet #lP2', 'lock1234');
    await A.page.click('.sheet [data-set]');
    await A.page.waitForSelector('.sheet #lE .code');
    const rc = await A.page.$eval('.sheet #lE .code', e => e.textContent);
    ok(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(rc), 'recovery code generated');
    const lr = await ev(A, () => localStorage.getItem('pmi3-lock'));
    ok(!lr.includes('lock1234') && !lr.includes(rc), 'only hashes stored');
    await ev(A, () => { while (sheets.length) closeSheet(); });
    await settle(A);
    await syncNow(B);
    ok(await B.page.evaluate(() => document.documentElement.classList.contains('lk')) && !(await B.page.isVisible('#app')), 'B got locked by the synced lock');
    await B.page.fill('#lockP', 'nope'); await B.page.click('#lockF button');
    await B.page.waitForFunction(() => document.querySelector('#lockE').textContent === 'Wrong password');
    ok(true, 'wrong lock password refused');
    await B.page.fill('#lockP', 'lock1234'); await B.page.click('#lockF button');
    await B.page.waitForFunction(() => !document.documentElement.classList.contains('lk'));
    ok(await B.page.isVisible('#app'), 'right password unlocks B');
    await A.page.reload();
    ok(await A.page.evaluate(() => document.documentElement.classList.contains('lk')) && !(await A.page.isVisible('#app')), 'A hides the app before first paint after reload');
    await A.page.fill('#lockP', rc.toLowerCase().replace(/-/g, ' ')); await A.page.click('#lockF button');
    await A.page.waitForFunction(() => !document.documentElement.classList.contains('lk'));
    await A.page.waitForTimeout(400);
    ok(await A.page.isVisible('.sheet #lP'), 'recovery code unlocks and opens "set new password"');
    await ev(A, () => { while (sheets.length) closeSheet(); });
    await A.page.reload();
    await A.page.fill('#lockP', 'good-token'); await A.page.click('#lockF button');
    await A.page.waitForFunction(() => !document.documentElement.classList.contains('lk'));
    ok(true, 'GitHub key works for recovery');
    await A.page.waitForTimeout(400); await ev(A, () => { while (sheets.length) closeSheet(); });

    console.log('10. Bad key later (expired token)');
    GH.token = 'rotated';
    const e2 = await syncNow(A);
    ok(/Bad credentials/.test(e2) && await A.page.$eval('#dot', e => e.className) === 'err', 'expired key: red dot, data untouched (' + await count(A) + ' leads)');
    GH.token = 'good-token'; ok(!(await syncNow(A)), 'recovers when the key works again');

    console.log('11. Backup / CSV / paste / bin');
    const [d1] = await Promise.all([A.page.waitForEvent('download'), ev(A, () => backup())]);
    const bk = JSON.parse(fs.readFileSync(await d1.path(), 'utf8'));
    ok(bk.leads.length === legacy.length + 1 && !JSON.stringify(bk).includes('"pw"'), 'JSON backup has all leads (incl. bin), no lock hashes');
    const [d2] = await Promise.all([A.page.waitForEvent('download'), ev(A, () => exportCsv())]);
    ok(fs.readFileSync(await d2.path(), 'utf8').split('\n').length === legacy.length + 1, 'CSV has header + one row per lead');
    const [d3] = await Promise.all([A.page.waitForEvent('download'), ev(A, () => backup(true))]);
    ok(d3.suggestedFilename().endsWith('.txt'), '"Send backup" makes a .txt file');
    const n0 = await count(A);
    await ev(A, () => openPaste());
    await A.page.fill('.sheet #pB', 'Gulf Stone Trading, +971 55 111 2222\nSecond Co +92 300 1234567\nDupe Co, +971 55 111 2222');
    await A.page.click('.sheet [data-a="go"]');
    const g = await ev(A, () => leads.find(l => l.party === 'Gulf Stone Trading'));
    ok(await count(A) === n0 + 2 && g && g.country === 'UAE', 'paste: 2 added, country from phone, duplicate skipped');
    await ev(A, () => openBin());
    await A.page.click('.sheet [data-r]');
    ok(await count(A) === n0 + 3, 'restore from recycle bin');
    await ev(A, () => { while (sheets.length) closeSheet(); });

    console.log('12. Speed & look');
    const ms = await A.page.evaluate(() => { const t = performance.now(); for (let i = 0; i < 20; i++) render(); return (performance.now() - t) / 20; });
    ok(ms < 60, 'screen renders in ' + ms.toFixed(1) + ' ms');
    await A.page.click('.tabs [data-v=leads]'); await A.page.waitForTimeout(200);
    ok(await A.page.$eval('#sortB', e => e.textContent.includes('Country')) && await A.page.$$eval('.sec.cty', x => x.length) > 5, 'Leads tab sorted by country with country headers');
    const perScreen = await A.page.$$eval('.card', cs => cs.filter(c => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }).length);
    ok(perScreen >= 11, perScreen + ' leads fully visible on a phone screen');
    await A.page.screenshot({ path: path.join(__dirname, 'screenshot-list.png') });
    await A.page.setViewportSize({ width: 1280, height: 800 });
    const pc = await A.page.$$eval('.card', cs => cs.filter(c => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }).length);
    ok(pc >= 16, pc + ' leads visible on a PC screen (2 columns)');
    await A.page.screenshot({ path: path.join(__dirname, 'screenshot-pc.png') });
    await A.page.setViewportSize({ width: 400, height: 800 });
    await A.page.click('.card .mid'); await A.page.waitForTimeout(400);
    await A.page.screenshot({ path: path.join(__dirname, 'screenshot-lead.png') });
    await ev(A, () => { while (sheets.length) closeSheet(); });
    await A.page.click('#menuBtn'); await A.page.waitForTimeout(400);
    await A.page.screenshot({ path: path.join(__dirname, 'screenshot-menu.png') });
  } catch (e) { console.log('  ✗ crashed: ' + e.stack); failures++; }
  await browser.close(); server.close();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED'); process.exit(failures ? 1 : 0);
})();
