# PMI Leads v3.2

The v3 app without photos, material sets and material texts, plus encrypted sync, an app lock and backups.
A static web app with no server, no build step and no framework.

## Files
- `index.html`: the whole app (CSS + JS inline)
- `sw.js`: offline support (network-first). Bump `CACHE` on every release.
- `manifest.webmanifest`, `icon-192.png`, `icon-512.png`: "Add to Home screen"
- `_headers`: Netlify security headers (only GitHub API calls are allowed out)

## Put it online (Netlify, free)
1. Log in at app.netlify.com.
2. New site: drag this folder onto app.netlify.com/drop.
   Update: Site, Deploys, drag the new folder onto the same project.
3. Rollback: Deploys, pick an older deploy, "Publish deploy".

## Sync between phone and PC (optional)
1. On GitHub, create a **private** repo called `pmi-leads-data`.
2. Create a fine-grained token: Settings, Developer settings, Fine-grained tokens.
   Repository access: only `pmi-leads-data`. Permissions: Contents = Read and write.
3. In the app, open Settings, Sync. Paste the token, choose a sync password (the same on every device), then Connect.
- Everything is encrypted on the device (AES-GCM, key from PBKDF2-SHA256 with 310k rounds) before upload.
- The app refuses to sync to a public repo.
- Never type your GitHub password into the app or into any chat. Only paste the token into the app.

## Moving old data
Settings, Backup, Import. Pick your old `pmi-leads.json` or a v3 backup. Import merges and never deletes.

## Data format (keep backward compatible)
Leads keep the v3 format (`party`, `contactLog`, `next`, `interests`…) plus `u` (updated time in ms), `del:1` when deleted (never hard deleted) and `m` (the YYYY-MM bucket, fixed at creation). Data saved by v3.1 or v4 on the same site is picked up automatically.
Repo layout: `key.json` (salt + encrypted check), `meta.bin` (settings, templates, custom materials, lock), `data/YYYY-MM.bin`.
Merge rule: newer `u` wins per record.

## Tests
`node tests/app.test.js [old-pmi-leads.json]`. Playwright with a mocked GitHub API covering two devices, edits, deletes, same-moment saves, offline, wrong password, bad key, public repo and lock.

## Rebuilding from v3.1
`python3 tools/build_v32.py <v3.1 index.html> pmi-leads/index.html` (uses `tools/sync_v32.js`).
