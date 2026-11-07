# MDFriday Digital Garden — E2E (`tests/e2e`)

Owned by **obsidian-digital-garden**. Does **not** modify `obsidian-publish`.

## What this suite covers

| Test | Type | Asserts |
|------|------|---------|
| `00-packaging` | Local | `mdfriday-garden` manifest, smoke-vault plugin install, `@mdfriday/core` not `file:` |
| `01-guest-garden-folder` | Staging network (headless) | Guest mint → folder bind/build/publish → `share.fsky.top` 200 → `expiresAt` ≈ **7d** → client `obsidian-garden/<ver>` |
| `ui/02-ui-guest-garden-folder` | **Headed Obsidian UI** (macOS) | Launch real Obsidian → click `Garden` → Publish panel → public URL 200 |

Headless tests use the same path as the plugin (`@mdfriday/core` + Garden `theme-config`), not Obsidian UI.

## Headless (CI required)

```bash
cd /Users/sunwei/github/sunwei/workspace/obsidian-digital-garden
npm run test:e2e:staging
```

Linux CI runs packaging only (`E2E_SKIP=1` for the network suite) via `.github/workflows/ci.yml`. The UI suite is **not** part of that job.

## Headed UI E2E (local Obsidian — you can watch)

Requires `/Applications/Obsidian.app`. Uses a dedicated `--user-data-dir` so your normal vaults/session stay untouched, launches Obsidian **headed** with `--remote-debugging-port`, and drives clicks with Playwright CDP.

```bash
# Keep the published site for manual inspection:
E2E_KEEP_DATA=1 npm run test:e2e:ui:staging

# Default: publish then DELETE the staging project
npm run test:e2e:ui:staging
```

Env:

| Var | Default | Meaning |
|-----|---------|---------|
| `MDF_E2E_ENV` | `staging` | Only staging supported today |
| `E2E_SKIP=1` | — | Skip network headless suite (`01-…`) |
| `E2E_SKIP_UI=1` | — | Skip UI suite |
| `E2E_KEEP_DATA=1` | — | Do not DELETE the staging project after run |
| `MDFRIDAY_CORE_DIR` | sibling `../core` | Override core package (headless only) |

### UI path notes

Obsidian’s file **context menu does not open** under Electron CDP mouse events (known limitation). The UI test therefore:

1. Clicks the `Garden` folder in the file explorer (visible).
2. Opens the publish panel the same way **Open in MDFriday Digital Garden** does.
3. Clicks the real **Publish** / **Publish again** button in the panel.
4. Waits for the **Published** result URL (building progress is visible).

If Obsidian.app is missing, `test:e2e:ui` skips cleanly so Linux CI stays green.

### Trust / first open / Restricted Mode

The harness writes a fresh Obsidian profile that already lists `tests/smoke-vault` as an open vault (avoids `obsidian://open?path=` “Vault not found” on first URI open).

**Restricted Mode** is turned off by pre-seeding `localStorage[enable-plugin-<vaultId>]=true` and reloading — **not** by clicking “Trust author and enable plugins” (that Obsidian button opens Settings → Community plugins, which this suite must never visit). The plugin is already installed at `tests/smoke-vault/.obsidian/plugins/mdfriday-garden` from `npm run build:smoke`. If Community plugins UI appears, the harness closes it and does not click Download/Install/Browse.


## Not covered (yet)

- Claim / Free upgrade OAuth
- Custom domain attach
- Subscribe form end-to-end
- Native OS right-click context menu (CDP limitation; panel path covers the same publish handler)
