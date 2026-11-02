// PMI Leads service worker: network-first, falls back to cache when offline.
// Bump CACHE on every release.
const CACHE='pmi-leads-v3.2.0';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET'||new URL(r.url).origin!==self.location.origin)return; // never touch GitHub API calls
  e.respondWith(fetch(r,{cache:'no-store'}).then(res=>{if(res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp));}return res;})
    .catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||caches.match('./index.html'))));
});
