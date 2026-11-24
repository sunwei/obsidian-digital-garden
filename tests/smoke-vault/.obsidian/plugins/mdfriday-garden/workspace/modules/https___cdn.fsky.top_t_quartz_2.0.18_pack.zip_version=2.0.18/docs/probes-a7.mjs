/**
 * A7 staging acceptance probes for Beer-source quartz 2.x.
 * Usage:
 *   pnpm --filter @mdfriday/theme-verify run brew-a7
 *   node docs/probes-a7.mjs
 * Env: QUARTZ_URL (default https://fsky.top/demo/quartz/?v=a7)
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function loadChromium() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../../tools/theme-verify/node_modules/playwright"),
    join(here, "../../../../obsidian-digital-garden/node_modules/playwright"),
    "/tmp/pw-a7/node_modules/playwright",
  ];
  for (const dir of candidates) {
    if (!existsSync(join(dir, "package.json"))) continue;
    try {
      return (await import(pathToFileURL(join(dir, "index.mjs")).href)).chromium;
    } catch {
      try {
        return createRequire(join(dir, "package.json"))("playwright").chromium;
      } catch {
        /* next */
      }
    }
  }
  return (await import("playwright")).chromium;
}

const HOME = process.env.QUARTZ_URL || process.env.BREW_URL || "https://fsky.top/demo/quartz/?v=a7";
const ARTICLE =
  process.env.QUARTZ_ARTICLE ||
  process.env.BREW_ARTICLE ||
  "https://fsky.top/demo/quartz/get-started.html?v=a7";

async function shot(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2800);
}

async function main() {
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const report = { at: new Date().toISOString(), checks: {} };

  await shot(page, HOME);
  const home = await page.evaluate(async () => {
    const links = [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href);
    const btn = document.querySelector(".mdf-subscribe__button, .button.primary");
    const before = {
      primary: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
      btnBg: btn ? getComputedStyle(btn).backgroundColor : null,
      seed: document.documentElement.getAttribute("data-beer-seed"),
      hasPicker: !!document.querySelector("[data-brew-theme-preset]"),
      hasTokens: links.some((h) => h.includes("tokens.css")),
      hasDerive: links.some((h) => h.includes("_derive")),
      capCss: links.filter(
        (h) =>
          /\/t\/base\/[^/]+\/caps\//.test(h) &&
          h.endsWith(".css") &&
          !h.includes("caps-v2") &&
          !/\/caps\/(mdf-brand|gallery|katex)\//.test(h),
      ),
      capsV2Path: links.filter((h) => h.includes("caps-v2")),
      capCssNames: links
        .filter(
          (h) =>
            /\/t\/base\/[^/]+\/caps\//.test(h) &&
            h.endsWith(".css") &&
            !h.includes("caps-v2") &&
            !/\/caps\/(mdf-brand|gallery|katex)\//.test(h),
        )
        .map((h) => h.replace(/^.*\/caps\//, "caps/")),
      beer: links.some((h) => h.includes("beercss")),
      left: !!document.querySelector(".sidebar.left"),
      center: !!document.querySelector(".center"),
      right: !!document.querySelector(".sidebar.right"),
      explorer: !!document.querySelector(".explorer"),
      toc: !!document.querySelector(".toc"),
      search: !!document.querySelector(".search"),
      subscribe: !!document.querySelector("[data-mdf-subscribe]"),
      api: typeof mdfBeerTheme === "function",
      replay: typeof mdfBeerThemeReplay === "function",
      searchBtnBeer: !!document.querySelector(".search-button.button"),
      searchFieldBeer: !!document.querySelector(".search-field.field"),
      subBtnBeer: !!document.querySelector(".mdf-subscribe__button.button.primary"),
      subFieldBeer: !!document.querySelector(".mdf-subscribe__field.field"),
      explorerBtnBeer: !!document.querySelector(".explorer-toggle.button, .folder-button.button"),
      quartzClass: [...document.querySelectorAll("[class]")].some((el) =>
        [...el.classList].some((c) => c.startsWith("quartz-")),
      ),
      barePageShell: !!document.querySelector(".page.mdf-pricing-layout, .page.brew-shell, body > .page, #brew-body > .page, .brew-shell.page"),
      brewShell: !!document.querySelector(".brew-shell"),
      siteNav: !!document.querySelector(".brew-site-nav"),
    };
    await mdfBeerTheme("#c62828");
    await new Promise((r) => setTimeout(r, 400));
    const after = {
      primary: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
      btnBg: btn ? getComputedStyle(btn).backgroundColor : null,
    };
    // M2: dark toggle must replay cached theme halves
    const beforeDark = after.primary;
    document.documentElement.setAttribute("data-theme", "dark");
    document.body.classList.remove("light");
    document.body.classList.add("dark");
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: "dark" } }));
    await new Promise((r) => setTimeout(r, 350));
    const darkPrimary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
    document.documentElement.setAttribute("data-theme", "light");
    document.body.classList.remove("dark");
    document.body.classList.add("light");
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: "light" } }));
    await new Promise((r) => setTimeout(r, 350));
    return { before, after, darkPrimary, beforeDark };
  });

  report.checks.THEME_OK =
    !!home.before.api &&
    !!home.after.primary &&
    home.after.primary !== home.before.primary &&
    !!home.after.btnBg &&
    home.after.btnBg !== home.before.btnBg;
  report.checks.NO_MDF_COLOR =
    !home.before.hasTokens && !home.before.hasDerive && home.before.capsV2Path.length === 0 && home.before.beer;
  report.checks.NO_CAPS_V2_PATH = home.before.capsV2Path.length === 0;
  report.checks.CAP_CSS = home.before.capCss.length >= 3 && home.before.subscribe;
  report.checks.CAP_RECIPE =
    home.before.searchBtnBeer &&
    home.before.searchFieldBeer &&
    home.before.subBtnBeer &&
    home.before.subFieldBeer &&
    home.before.explorerBtnBeer;
  report.checks.DARK_REPLAY = !!home.before.replay && !!home.darkPrimary;
  report.checks.PRESET_UI = home.before.hasPicker && !!home.before.seed;
  report.checks.WIKI_L = home.before.left && home.before.center && home.before.right && home.before.explorer;
  report.checks.NO_QUARTZ_CLASS = !home.before.quartzClass;
  report.checks.NO_PAGE_SHELL = home.before.brewShell && !home.before.barePageShell;

  await shot(page, ARTICLE);
  const article = await page.evaluate(() => ({
    toc: !!document.querySelector(".toc"),
    article: !!document.querySelector(".article-content"),
  }));
  report.checks.WIKI_ARTICLE = article.toc && article.article;

  // Mintlify is a ThemePreset color seed (not a layout variant).
  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1200);
  const mint = await page.evaluate(async () => {
    try {
      localStorage.removeItem("mdf-beer-theme-seed");
    } catch (_) {}
    const hasMintSwatch = [...document.querySelectorAll("[data-seed]")].some(
      (el) => (el.getAttribute("data-seed") || "").toLowerCase() === "#0d9373",
    );
    await mdfBeerTheme("#0d9373");
    await new Promise((r) => setTimeout(r, 400));
    return {
      hasMintSwatch,
      seed: document.documentElement.getAttribute("data-beer-seed"),
      primary: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
    };
  });
  report.checks.PRESET_COLOR_MINT =
    mint.hasMintSwatch &&
    ((mint.seed || "").toLowerCase() === "#0d9373" ||
      (mint.primary || "").toLowerCase().includes("006c53") ||
      (mint.primary || "").toLowerCase().includes("0d9373"));

  report.home = home;
  report.article = article;
  report.mint = mint;
  report.PASS = Object.values(report.checks).every(Boolean);

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  if (!report.PASS) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
