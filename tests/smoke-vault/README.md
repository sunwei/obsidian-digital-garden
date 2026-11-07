# Smoke vault — MDFriday Digital Garden

Real Obsidian vault for authentic Digital Garden plugin testing (staging).

**Path:** `obsidian-digital-garden/tests/smoke-vault/`

## Prerequisites

- Obsidian desktop installed (`/Applications/Obsidian.app`)
- Node deps in repo root: `npm install`
- Staging API already deployed (`api.fsky.top` / `share.fsky.top`)

## Build & sync plugin into this vault

From `obsidian-digital-garden/` repo root:

```bash
npm run build:smoke
```

This runs a **staging** production bundle (`MDF_CF_ENV=staging`) then symlinks
`main.js` / `styles.css` / `manifest.json` into:

`.obsidian/plugins/mdfriday-garden/`

After every code change: re-run `build:smoke`, then in Obsidian **Reload app**.

## Open in Obsidian

1. Obsidian → **Open folder as vault**
2. Choose this folder:
   `/Users/sunwei/github/sunwei/workspace/obsidian-digital-garden/tests/smoke-vault`
3. Trust / enable community plugins if prompted
4. Confirm **MDFriday Digital Garden** is enabled

**Optional helper:**

```bash
npm run open:smoke-vault
```

## Smoke steps

1. In the file explorer, right-click the **`Garden`** folder.
2. Choose **Open in MDFriday Digital Garden** or **Publish with MDFriday Digital Garden**.
3. Ribbon icon should be a **two-pip die** (`dice-2`); sidebar hover **Garden service**.
4. First run may silently mint a Guest key (no Turnstile).
5. Expect:
   - Public URL host: **`share.fsky.top`**
   - Path like `/s/{id}/`
   - Expiry shown ≈ **7 days** (Guest)
   - Site tabs still include History; Domain / Subscribe available when plan allows

## Notes

- Only `mdfriday-garden` is enabled here (no Publish / Share) so ids / sidebar / protocol stay clean.
- `data.json` (API key) is **gitignored** — never commit credentials.

## Automated E2E (headless, no Obsidian UI)

```bash
npm run test:e2e:staging
```

See `tests/e2e/README.md`.
