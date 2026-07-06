#!/usr/bin/env node
/**
 * reddit_fetch.mjs — fetch Reddit JSON that survives the datacenter 403 block.
 *
 * Reddit hard-blocks curl / WebFetch / plain HTTP from datacenter IPs (serves a
 * "Welcome to Reddit" HTML wall even with a browser User-Agent, and even after the
 * DuckDuckGo cookie trick). The only thing that reliably breaks through is a REAL
 * browser engine. This drives the user's installed Playwright Chromium: it loads
 * reddit.com to establish a genuine session, then fetch()es the `.json` from inside
 * the page context so it inherits cookies. Verified working (returns raw JSON).
 *
 * Usage:
 *   node reddit_fetch.mjs "<reddit url with .json>"
 *   node reddit_fetch.mjs --search "query" [--sub SUBREDDIT] [--sort top] [--t all] [--limit 25]
 *   node reddit_fetch.mjs --sub SUBREDDIT [--listing top] [--t week] [--limit 25]
 *
 * Prints raw JSON to stdout. Non-zero exit + stderr message on block/failure.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// ---- resolve playwright-core wherever it lives (repo, global, or npx cache) ----
function resolvePlaywright() {
  const req = createRequire(import.meta.url);
  const candidates = [];
  try { candidates.push(req.resolve('playwright-core')); } catch {}
  try { candidates.push(req.resolve('playwright')); } catch {}
  // npx cache: ~/.npm/_npx/<hash>/node_modules/playwright-core
  const npx = path.join(os.homedir(), '.npm', '_npx');
  if (fs.existsSync(npx)) {
    for (const d of fs.readdirSync(npx)) {
      const p = path.join(npx, d, 'node_modules', 'playwright-core', 'index.mjs');
      if (fs.existsSync(p)) candidates.push(p);
    }
  }
  for (const c of candidates) { try { return c; } catch {} }
  return null;
}

// ---- find a browser to drive ----
// Returns one of:
//   { executablePath }  → Playwright's bundled full Chromium (preferred)
//   { channel }         → an installed Chrome/Edge to fall back on (no bundled Chromium)
//   null                → nothing usable found
// NOTE: this resolves a CHROMIUM ENGINE, not the user's consumer browser. Playwright's
// bundled Chromium is self-contained and works regardless of whether Chrome/Edge/Safari
// are installed. Edge/Chrome only matter as a fallback when the bundled binary is absent;
// Safari is never usable (Playwright drives WebKit, its own build, not Safari the app).
function resolveChromium() {
  // ms-playwright cache root per-OS: macOS, Linux, Windows.
  const roots = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),        // macOS
    path.join(os.homedir(), '.cache', 'ms-playwright'),                    // Linux
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),          // Windows
  ];
  const root = roots.find(r => fs.existsSync(r));
  if (root) {
    const dirs = fs.readdirSync(root)
      .filter(d => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])); // newest first
    for (const d of dirs) {
      for (const rel of [
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-linux/chrome',
        'chrome-win/chrome.exe',                                           // Windows
      ]) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return { executablePath: p };
      }
    }
  }
  // No bundled Chromium — fall back to an installed Chrome or Edge if present.
  // Playwright can drive either via `channel` (both are Chromium under the hood).
  for (const channel of ['chrome', 'msedge']) {
    if (installedChannelExists(channel)) return { channel };
  }
  return null;
}

// Best-effort check that an installed Chrome/Edge exists at a well-known location.
function installedChannelExists(channel) {
  const plat = os.platform();
  const home = os.homedir();
  const paths = { chrome: [], msedge: [] };
  if (plat === 'darwin') {
    paths.chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    paths.msedge = ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  } else if (plat === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    paths.chrome = [path.join(pf, 'Google/Chrome/Application/chrome.exe'), path.join(pfx86, 'Google/Chrome/Application/chrome.exe')];
    paths.msedge = [path.join(pf, 'Microsoft/Edge/Application/msedge.exe'), path.join(pfx86, 'Microsoft/Edge/Application/msedge.exe')];
  } else {
    paths.chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', path.join(home, '.local/bin/google-chrome')];
    paths.msedge = ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'];
  }
  return (paths[channel] || []).some(p => { try { return fs.existsSync(p); } catch { return false; } });
}

// ---- build a reddit .json URL from flags, or use a positional url ----
function buildUrl(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  if (pos[0]) {
    let u = pos[0];
    if (!/\.json(\?|$)/.test(u)) u = u.replace(/\/?($|\?)/, '/.json$1');
    return u;
  }
  const q = flags.search;
  const sub = flags.sub;
  const sort = flags.sort || (q ? 'relevance' : (flags.listing || 'top'));
  const t = flags.t || 'all';
  const limit = flags.limit || '25';
  if (q && sub)  return `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(q)}&restrict_sr=1&sort=${sort}&t=${t}&limit=${limit}`;
  if (q)         return `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=${sort}&t=${t}&limit=${limit}`;
  if (sub)       return `https://www.reddit.com/r/${sub}/${flags.listing || 'top'}.json?t=${t}&limit=${limit}`;
  return null;
}

// --batch collects every remaining positional arg (or --url flags) as a list of
// Reddit URLs and fetches them all in ONE browser session. Output is a JSON array:
// [{ url, ok, data|error }, ...]. This avoids paying the ~5-8s browser launch/warm
// cost per URL — the slow part when reading many post bodies.
const rawArgs = process.argv.slice(2);
const isBatch = rawArgs.includes('--batch');
let batchUrls = [];
if (isBatch) {
  batchUrls = rawArgs
    .filter(a => a !== '--batch' && (a.startsWith('http') || a.includes('reddit.com')))
    .map(u => (/\.json(\?|$)/.test(u) ? u : u.replace(/\/?($|\?)/, '/.json$1')));
}

const url = isBatch ? null : buildUrl(rawArgs);
if (!isBatch && !url) { console.error('Usage: reddit_fetch.mjs <url.json> | --search Q [--sub S] | --sub S [--listing top] | --batch <url1> <url2> ...'); process.exit(1); }
if (isBatch && batchUrls.length === 0) { console.error('BATCH: no reddit URLs given'); process.exit(1); }

const pwPath = resolvePlaywright();
if (!pwPath) { console.error('BLOCKED_SETUP: playwright-core not found. Run: npx playwright install chromium'); process.exit(3); }
const browserChoice = resolveChromium();
if (!browserChoice) { console.error('BLOCKED_SETUP: no Chromium engine found (no bundled Playwright Chromium and no installed Chrome/Edge). Run: npx playwright install chromium'); process.exit(3); }

const { chromium } = await import(pwPath);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let browser;
try {
  // Launch bundled Chromium (executablePath) or fall back to an installed Chrome/Edge (channel).
  browser = await chromium.launch({ headless: true, ...browserChoice });
  const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' });
  const page = await ctx.newPage();

  // Accept only COMPLETE, valid JSON — a truncated/partial nav read fails JSON.parse
  // and falls through to the next strategy instead of returning partial data.
  const parseJson = t => {
    const s = (t || '').trim();
    if (!(s.startsWith('{') || s.startsWith('['))) return null;
    try { return JSON.parse(s); } catch { return null; }
  };
  const looksJson = t => parseJson(t) !== null;
  // A hard IP-level block ("You've been blocked by network security" / rate limit).
  // When this appears, DDG-reset + retry is pointless — the whole IP is blocked — so
  // we bail fast with a clear message instead of grinding through the full strategy.
  const isHardBlock = t => /blocked by network security|too many requests|rate.?limit/i.test(t || '');

  // Warm a real session ONCE (this is what defeats the block). In batch mode this
  // single warm-up is reused for every URL — that's the whole speed win.
  await page.goto('https://www.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(700); // trimmed from 1500ms; session cookie is set by domcontentloaded

  // Primary: navigate straight to the .json URL and read the rendered body.
  // Reddit serves raw JSON as text/plain here, which sidesteps the page's own
  // window.fetch override (that override throws "Failed to fetch" on comment pages).
  async function fetchViaNav(u) {
    try {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const body = await page.evaluate(() => document.body ? document.body.innerText : '');
      return { status: 200, text: body };
    } catch { return { status: 0, text: '' }; }
  }
  // Secondary: in-page fetch (works for search/listing endpoints).
  async function fetchInPage(u) {
    try {
      return await page.evaluate(async (x) => {
        const r = await fetch(x, { headers: { Accept: 'application/json' } });
        return { status: r.status, text: await r.text() };
      }, u);
    } catch { return { status: 0, text: '' }; }
  }

  // Fetch one URL through the full strategy (nav → in-page fetch → DDG-reset retry).
  async function fetchOne(u) {
    let d = await fetchViaNav(u);
    if (isHardBlock(d.text)) return { status: 429, text: d.text, hardBlock: true };
    if (!looksJson(d.text)) d = await fetchInPage(u);
    if (!looksJson(d.text)) {
      await page.goto('https://duckduckgo.com/?q=site:reddit.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.goto('https://www.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      d = await fetchViaNav(u);
      if (isHardBlock(d.text)) return { status: 429, text: d.text, hardBlock: true };
      if (!looksJson(d.text)) d = await fetchInPage(u);
    }
    return d;
  }

  // Overall per-URL cap so one hanging link can't stall a whole batch for minutes.
  const PER_URL_CAP_MS = 75000; // ~2 nav timeouts + retry, generous but bounded
  const withCap = (p) => {
    let timer;
    const capped = new Promise(res => { timer = setTimeout(() => res({ status: 408, text: '' }), PER_URL_CAP_MS); });
    if (timer.unref) timer.unref(); // don't let the pending timer keep Node alive after we resolve
    return Promise.race([p, capped]).finally(() => clearTimeout(timer));
  };

  if (isBatch) {
    // All URLs share this one warmed session — pay browser startup once, not N times.
    const out = [];
    for (const u of batchUrls) {
      const d = await withCap(fetchOne(u));
      const parsed = parseJson(d.text);
      if (parsed !== null) out.push({ url: u, ok: true, data: parsed });
      else {
        const err = d.hardBlock ? 'rate_limited' : (d.status === 408 ? 'timeout' : `blocked_status_${d.status}`);
        out.push({ url: u, ok: false, error: err });
      }
    }
    process.stdout.write(JSON.stringify(out));
  } else {
    const data = await withCap(fetchOne(url));
    if (parseJson(data.text) === null) {
      if (data.hardBlock) {
        console.error('RATE_LIMITED: Reddit is temporarily blocking this IP ("network security" / too many requests). Wait a few minutes and retry.');
        process.exit(5);
      }
      console.error(`BLOCKED: status=${data.status} (got HTML wall or partial JSON) for ${url}`);
      process.exit(2);
    }
    process.stdout.write(data.text);
  }
} catch (e) {
  console.error('ERROR: ' + (e && e.message ? e.message : String(e)));
  process.exit(4);
} finally {
  if (browser) await browser.close();
}
