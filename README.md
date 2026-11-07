# MDFriday Digital Garden

Right-click a folder. Publish a wiki or digital garden. No account, no Git.

1. Install **MDFriday Digital Garden** (desktop).
2. Right-click a folder → Publish with MDFriday Digital Garden.
3. Configure site chrome, theme, domain, and subscribe in the sidebar.

- Website: https://mdfriday.com
- Help: https://help.mdfriday.com
- Discord: https://discord.gg/t7FHJ6qNzT

## Plans (product)

| Stage | Who | Storage | Content TTL |
|-------|-----|---------|-------------|
| Guest | Not signed in | 100 MB | **7 days** rolling |
| Free | Signed in / claimed | 200 MB | Site permanent; account idle archive ~180 days |

Digital Garden is the site product (folder/wiki). Single-note public links live in **MDFriday Share**.

## Identity

| Item | Value |
|------|-------|
| Plugin id | `mdfriday-garden` |
| Sidebar view | `MDFriday_Garden` |
| Icon | `dice-2` |
| Protocol | `obsidian://mdfriday?plugin=garden&event=…` |
| Client header | `obsidian-garden/<version>` |
| Engine | `@mdfriday/core` (`26.11.0` from npm; local: `npm run build:with-core`) |

## Dev

```bash
npm install
npm run dev      # watch → …/obsidian/.obsidian/plugins/mdfriday-garden
npm run build    # production main.js + styles.css
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run lint` / `lint:ci` | Official Obsidian ESLint (`eslint-plugin-obsidianmd`) |
| `npm test` | Unit tests |
| `npm run build:smoke` | Staging build → `tests/smoke-vault` |
| `npm run test:e2e:staging` | Headless guest→folder garden E2E against staging |
