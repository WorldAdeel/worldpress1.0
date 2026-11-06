# PMI Leads: handoff notes for the next session

Last updated: 6 Nov 2026. Branch: `claude/clever-ramanujan-3qe4ny` (pushed).

## What the user wants
- A leads app focused on **leads, requirements and follow-ups**. Fast, compact and readable, with as many leads per screen as possible.
- The user liked the **v3 design** (Today / Leads tabs, swipe, flags, their local time, sorting by country and time).
- No photo, material-set or material-text features.
- Data must live **online and safely**, because the user lost leads to a Google Drive file sync problem with Leads 2 v1.4.
- The user wants **short replies, one step at a time**. Never ask them to paste passwords, tokens or codes in chat.

## Current version: v3.2.1 (`pmi-leads/`)
- Built from the user's v3.1 `index.html` by `tools/build_v32.py`, which adds `tools/sync_v32.js`.
  To change the app, edit the build script or `sync_v32.js` and rebuild:
  `python3 tools/build_v32.py <v3.1 index.html> pmi-leads/index.html`
  The v3.1 source isn't in the repo; it was an upload. In practice, editing `pmi-leads/index.html` directly is fine from now on.
- Changes from v3.1:
  - **Removed:** the Photos tab, photo sets and images, material texts and photo nudges.
  - **Added:** a Requirement field, encrypted GitHub sync, a synced app lock with recovery code, Send backup (.txt), merge-only import, soft delete with a recycle bin, Country sort as the default with country headers, denser cards (about 11 per phone screen) and 2–3 columns on PC.
- Data: v3 lead format plus `u` (updated time in ms), `del:1` and `m` (YYYY-MM bucket). It reads v3.1 data (`pmi3-*` keys) and v4 data (`pl4-*`) on the same site.
- Sync goes to the private repo `WorldAdeel/pmi-leads-data`, holding `key.json`, `meta.bin` and `data/YYYY-MM.bin`, encrypted with AES-GCM (PBKDF2 310k).
  The merge rule is that the newer `u` wins.
- Service worker cache name: `pmi-leads-v3.2.1`. Bump it on every release.
- Tests: `node tests/app.test.js [old-pmi-leads.json]` (Playwright plus a mocked GitHub API; all checks passing).
  The sample fixture is in `tests/fixtures/`. The user's real lead data is **not** committed.

## Hosting (Netlify, free credit-based plan)
- Leads app: project **adeelpak-leads** → https://adeelpak-leads.netlify.app
- Expense app ("Cash & Bank Ledger"): project **adeelpak** → https://adeelpak.netlify.app (also an older copy at sweet-begonia-504b14). **Don't deploy leads there.** That happened once and was rolled back.
- Update by unzipping the build and dragging the folder onto the project's Deploys page. Each deploy costs about 15 credits, and the AI agent box spends credits too.
- `v4.0` (a slim rewrite) was rejected by the user, but it stays in git history.

## Status at end of session
- PC: v3.2 is deployed, the 152 leads are in and sync is connected (green dot).
- v3.2.1 (the layout tweak) was handed over as a zip. **Ask whether it was deployed to adeelpak-leads.**
- Not done yet:
  1. Phone setup: open the link, ⋯ → Sync → same key and sync password → Add to Home screen.
  2. Turn on the app lock (⋯ → App lock) and keep the recovery code on paper.
  3. Old Leads 2 v1.4: stop using it. It saves to a Drive file and caused the data loss.
- GitHub token "ledger" (fine-grained, no expiry) covers the ledger repo and `pmi-leads-data` with Contents read/write. Both apps use it.

## Open ideas, not requested yet
- The 152 leads are still at the old state from the file, so the user may still have newer data somewhere (Drive Trash or version history).
