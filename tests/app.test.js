// Playwright test for PMI Leads v4 with a mocked GitHub API.
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
const count = d => ev(d, () => live().length);
async function connectUI(d, token, pw) {
  await d.page.click('[data-a=settings]');
  await d.page.fill('#sT', token); await d.page.fill('#sP', pw);
  await d.page.click('[data-a=conn]');
  await d.page.waitForFunction(() => { const e = document.querySelector('#sE'); return !e || (e.textContent && !e.textContent.startsWith('Connecting')); }, null, { timeout: 30000 });
  const err = await d.page.$eval('#sE', e => e.textContent).catch(() => '');
  await d.page.click('[data-a=close]');
  return err;
}
const syncNow = d => ev(d, async () => { repoOK = false; await sync(); return S.err || ''; });

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const legacy = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
  try {
    console.log('1. Data saved by the previous version (same origin)');
    {
      const ctx = await browser.newContext({ serviceWorkers: 'block' }); const p = await ctx.newPage();
      p.on('pageerror', e => { console.log('  page error ' + e.message); failures++; });
      await p.goto(ORIGIN + '/sw.js'); // same origin, before app runs
      await p.evaluate(l => { localStorage.clear(); localStorage.setItem('pmi3-leads', JSON.stringify(l)); }, legacy);
      await p.goto(ORIGIN + '/');
      ok(await p.evaluate(() => live().length) === legacy.length, 'old pmi3-leads data picked up: ' + legacy.length + ' leads');
      const l = await p.evaluate(() => leads.find(x => x.company === 'Empire Stone Co. Ltd'));
      ok(l && l.next === '2026-11-06' && l.country === 'Thailand', 'Biweekly cadence turned into a next follow-up date (' + (l && l.next) + ')');
      const sg = await p.evaluate(() => leads.find(x => x.company === 'Stone Gallery'));
      ok(sg && sg.log[0].n === 'Shared WL' && sg.notes === 'by email only', 'old log + status kept as timeline/notes');
      await p.reload(); ok(await p.evaluate(() => live().length) === legacy.length, 'reload keeps all leads');
      await ctx.close();
    }

    console.log('2. Import old pmi-leads.json via the Import button');
    const A = await device(browser, 'A');
    ok(await count(A) === 0, 'fresh device is empty');
    await A.page.click('[data-a=settings]');
    const [fc] = await Promise.all([A.page.waitForEvent('filechooser'), A.page.click('#sheet [data-a=import]')]);
    await fc.setFiles(LEGACY);
    await A.page.waitForFunction(n => live().length === n, legacy.length);
    ok(true, 'imported ' + legacy.length + ' leads');
    await A.page.click('[data-a=close]');
    const again = await ev(A, l => importData(l), legacy);
    ok(again === '0 new, 0 updated' && await count(A) === legacy.length, 'importing again adds no duplicates (' + again + ')');

    console.log('3. Sync setup errors');
    let err = await connectUI(A, 'bad-token', 'correct horse 1');
    ok(/not accepted/.test(err), 'bad GitHub key rejected: "' + err + '"');
    GH.private = false;
    err = await connectUI(A, 'good-token', 'correct horse 1');
    ok(/PUBLIC/.test(err), 'public repo refused: "' + err.slice(0, 50) + '…"');
    ok(GH.files.size === 0, 'nothing uploaded to the public repo');
    GH.private = true;
    err = await connectUI(A, 'good-token', 'short');
    ok(/8 characters/.test(err), 'short sync password rejected');

    console.log('4. Device A connects and uploads');
    err = await connectUI(A, 'good-token', 'correct horse 1');
    ok(!err, 'A connected' + (err ? ': ' + err : ''));
    ok(GH.files.has('key.json') && GH.files.has('meta.bin') || [...GH.files.keys()].some(k => k.startsWith('data/')), 'files in repo: ' + [...GH.files.keys()].join(', '));
    const allBytes = Buffer.concat([...GH.files.entries()].filter(([k]) => k !== 'key.json').map(([, v]) => v.buf)).toString('latin1');
    ok(!/Stone Gallery|scott@|Australia/.test(allBytes), 'uploaded data is encrypted (no plain text names/emails)');
    ok(await ev(A, () => S.dirty.length) === 0, 'nothing left waiting');

    console.log('5. Device B: wrong password, then right password');
    const B = await device(browser, 'B');
    err = await connectUI(B, 'good-token', 'wrong password!');
    ok(/Wrong sync password/.test(err), 'wrong sync password rejected');
    ok(await count(B) === 0, 'B got no data with wrong password');
    err = await connectUI(B, 'good-token', 'correct horse 1');
    ok(!err && await count(B) === legacy.length, 'B connected and received ' + await count(B) + ' leads');

    console.log('6. Edits and deletes travel between devices');
    const id1 = await ev(A, () => leads.find(l => l.company === 'Stone Gallery').id);
    await A.page.fill('#q', 'Stone Gallery'); await A.page.waitForTimeout(250);
    await A.page.click('.card [data-a=done]');
    await A.page.fill('#nt', 'Sent price for cream travertine'); await A.page.fill('#dw', 'Call about samples');
    await A.page.click('[data-a=donesave][data-v="3"]');
    await A.page.fill('#q', '');
    await A.page.waitForFunction(() => S.dirty.length === 0 && !syncing, null, { timeout: 15000 });
    ok(true, 'A auto-synced the "Done" ~2.5s after the change');
    await syncNow(B);
    const bl = await ev(B, id => leads.find(l => l.id === id), id1);
    ok(bl.log.some(e => e.n === 'Sent price for cream travertine') && bl.what === 'Call about samples' && bl.stage === 'talking', 'B sees A\'s note, next step and stage');
    const id2 = await ev(B, () => leads.find(l => l.company === 'Jerry Australia').id);
    await ev(B, id => { const l = leads.find(x => x.id === id); l.del = 1; touch(l); }, id2);
    await syncNow(B); await syncNow(A);
    ok(await ev(A, id => !!leads.find(l => l.id === id).del, id2) && await count(A) === legacy.length - 1, 'delete on B shows on A (soft delete, still restorable)');
    const nid = await ev(A, () => { const l = fix({ id: uid(), company: 'New Buyer LLC', phone: '+971 50 123 4567', added: today() }); leads.push(l); touch(l); return l.id; });
    await syncNow(A); await syncNow(B);
    ok(await ev(B, id => !!leads.find(l => l.id === id), nid), 'new lead from A appears on B');

    console.log('7. Same-moment saves');
    const [x1, x2] = await ev(A, () => { const s = leads.filter(l => l.m === '2026-08' && !l.del); return [s[5].id, s[6].id]; });
    await ev(A, id => { const l = leads.find(x => x.id === id); l.notes = 'edit from A'; touch(l); }, x1);
    await ev(B, id => { const l = leads.find(x => x.id === id); l.notes = 'edit from B'; touch(l); }, x2);
    const c0 = GH.conflicts;
    await Promise.all([syncNow(A), syncNow(B)]);
    await syncNow(A); await syncNow(B);
    ok(GH.conflicts > c0, 'conflict happened (' + (GH.conflicts - c0) + ') and was retried');
    const both = async d => ev(d, ([a, b]) => [leads.find(l => l.id === a).notes, leads.find(l => l.id === b).notes], [x1, x2]);
    const ra = await both(A), rb = await both(B);
    ok(ra[0] === 'edit from A' && ra[1] === 'edit from B' && JSON.stringify(ra) === JSON.stringify(rb), 'different leads, same file: both edits kept on both devices');
    // same lead, same millisecond
    const t = Date.now() + 5000;
    await ev(A, ([id, t]) => { const l = leads.find(x => x.id === id); l.what = 'A wins?'; l.u = t; persist(); dirty(id); }, [x1, t]);
    await ev(B, ([id, t]) => { const l = leads.find(x => x.id === id); l.what = 'B wins?'; l.u = t; persist(); dirty(id); }, [x1, t]);
    await Promise.all([syncNow(A), syncNow(B)]);
    for (let i = 0; i < 2; i++) { await syncNow(A); await syncNow(B); }
    const wa = await ev(A, id => leads.find(l => l.id === id).what, x1), wb = await ev(B, id => leads.find(l => l.id === id).what, x1);
    ok(wa === wb, 'same lead edited at the same moment: both devices agree ("' + wa + '")');
    const fa = await ev(A, () => JSON.stringify(leads.slice().sort((a, b) => a.id < b.id ? -1 : 1)));
    const fb = await ev(B, () => JSON.stringify(leads.slice().sort((a, b) => a.id < b.id ? -1 : 1)));
    ok(fa === fb, 'A and B hold identical data');

    console.log('8. Offline then back online');
    await A.ctx.setOffline(true); GH.offline = true;
    await ev(A, id => { const l = leads.find(x => x.id === id); l.notes = 'typed while offline'; touch(l); }, x2);
    await syncNow(A);
    ok(await ev(A, () => S.dirty.length) > 0 && await A.page.$eval('#dot', e => e.className) === '', 'offline: change kept as waiting, no error shown');
    await A.ctx.setOffline(false); GH.offline = false; await syncNow(A); await syncNow(B);
    ok(await ev(B, id => leads.find(l => l.id === id).notes, x2) === 'typed while offline', 'back online: change reached B');

    console.log('9. App lock (synced)');
    await A.page.click('[data-a=settings]');
    await A.page.fill('#lP', 'lock1234'); await A.page.fill('#lP2', 'lock1234');
    await A.page.click('[data-a=setlock]');
    await A.page.waitForSelector('#lE .code');
    const rc = await A.page.$eval('#lE .code', e => e.textContent);
    ok(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(rc), 'recovery code generated');
    const lr = await ev(A, () => JSON.stringify(lockRec()));
    ok(!lr.includes('lock1234') && !lr.includes(rc), 'only hashes stored');
    await A.page.click('[data-a=close]');
    await A.page.waitForFunction(() => S.dirty.length === 0 && !syncing, null, { timeout: 15000 });
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
    ok(await A.page.isVisible('#lP'), 'recovery code unlocks and opens "set new password"');
    await A.page.click('[data-a=close]');
    await A.page.reload();
    await A.page.fill('#lockP', 'good-token'); await A.page.click('#lockF button');
    await A.page.waitForFunction(() => !document.documentElement.classList.contains('lk'));
    ok(true, 'GitHub key works for recovery');
    await A.page.click('[data-a=close]');

    console.log('10. Bad key later (expired token)');
    GH.token = 'rotated';
    const e2 = await syncNow(A);
    ok(/Bad credentials/.test(e2) && await A.page.$eval('#dot', e => e.className) === 'err', 'expired key shows red sync dot, data untouched (' + await count(A) + ' leads)');
    GH.token = 'good-token'; ok(!(await syncNow(A)), 'recovers when key works again');

    console.log('11. Backup / CSV / paste');
    const [d1] = await Promise.all([A.page.waitForEvent('download'), ev(A, () => ACT.json())]);
    const bk = JSON.parse(fs.readFileSync(await d1.path(), 'utf8'));
    ok(bk.leads.length === legacy.length + 1 && !bk.meta.some(r => r.id === 'lock'), 'JSON backup has all leads, no lock hashes');
    const [d2] = await Promise.all([A.page.waitForEvent('download'), ev(A, () => ACT.csv())]);
    const csv = fs.readFileSync(await d2.path(), 'utf8');
    ok(csv.split('\n').length === legacy.length + 1, 'CSV has header + ' + (csv.split('\n').length - 1) + ' rows');
    const [d3] = await Promise.all([A.page.waitForEvent('download'), ev(A, () => ACT.share())]);
    ok(d3.suggestedFilename().endsWith('.txt'), '"Send backup" falls back to a .txt download when sharing is unavailable');
    const n0 = await count(A);
    await A.page.click('[data-a=settings]'); await A.page.click('#sheet [data-a=paste]');
    await A.page.fill('#pt', 'Gulf Stone Trading, Ahmed, +971 55 111 2222, ahmed@gulf.ae, white limestone 2cm\nSecond Co\t+92 300 1234567\tPakistan\nDupe Co, +971 55 111 2222');
    await A.page.click('[data-a=pasteadd]');
    const g = await ev(A, () => leads.find(l => l.company === 'Gulf Stone Trading'));
    ok(await count(A) === n0 + 2 && g.country === 'UAE' && g.email === 'ahmed@gulf.ae' && g.req.mat === 'white limestone 2cm', 'paste: 2 added, country from phone, duplicate skipped');

    console.log('12. Speed');
    const ms = await A.page.evaluate(() => { const t = performance.now(); for (let i = 0; i < 20; i++) render(); return (performance.now() - t) / 20; });
    ok(ms < 50, 'list renders in ' + ms.toFixed(1) + ' ms');
    await A.page.screenshot({ path: path.join(__dirname, 'screenshot-list.png') });
    await A.page.click('.card'); await A.page.screenshot({ path: path.join(__dirname, 'screenshot-lead.png') });
  } catch (e) { console.log('  ✗ crashed: ' + e.stack); failures++; }
  await browser.close(); server.close();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED'); process.exit(failures ? 1 : 0);
})();
