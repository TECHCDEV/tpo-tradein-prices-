/* © The People's Operator 2026 */
import { chromium } from "playwright";
import { writeFileSync } from "fs";

const TENANT = process.env.TPO_TENANT_ID || "04fedcfc9da62eabfa3b1b499dd67f3133ce8599c810a44b5b5616f8a7c01120";
const TRADEIN_URL = process.env.TPO_TRADEIN_URL || "https://tpoteststore.myshopify.com/pages/tpo-trade-in";
const OUT_FILE = process.env.TPO_OUT_FILE || "prices.json";
/* Leave TPO_CATEGORIES unset to auto-discover & scrape every category Reusely offers.
   Set it to a comma list only if you want to restrict to specific categories. */
const CATEGORIES = (process.env.TPO_CATEGORIES || "").split(",").map(s => s.trim()).filter(Boolean);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* in-page: list every top-level category (cards without a "get up to" price) */
function discoverCategoriesInPage() {
  return new Promise(async (resolve) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const sr = () => { const bw = document.querySelector(".buyback-widget"); return bw && bw.shadowRoot; };
    const fc = (el) => { if (!el) return; const r = el.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, composed: true, clientX: r.left + 5, clientY: r.top + 5, view: window }; ["pointerover","pointerdown","mousedown","pointerup","mouseup","click"].forEach(t => { const E = t.indexOf("pointer") === 0 ? PointerEvent : MouseEvent; el.dispatchEvent(new E(t, o)); }); };
    const back = () => { const b = sr() && sr().querySelector('[class*="back" i] button,button[class*="back" i],button[aria-label*="back" i]'); if (b) { fc(b); return true; } return false; };
    if (!sr()) return resolve([]);
    for (let i = 0; i < 6; i++) { if (!back()) break; await sleep(450); }
    await sleep(500);
    const titles = [...sr().querySelectorAll(".section-card-container,.section-card,.card")]
      .map(c => { const t = c.querySelector(".section-card-title"); return t ? t.textContent.replace(/\s+/g, " ").trim() : ""; })
      .filter(t => t && !/get up to/i.test(t));
    resolve([...new Set(titles)]);
  });
}

/* in-page scrape for one category */
function scrapeCategoryInPage(categoryName) {
  return new Promise(async (resolve) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const sr = () => { const bw = document.querySelector(".buyback-widget"); return bw && bw.shadowRoot; };
    const fc = (el) => { if (!el) return; const r = el.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, composed: true, clientX: r.left + 5, clientY: r.top + 5, view: window }; ["pointerover","pointerdown","mousedown","pointerup","mouseup","click"].forEach(t => { const E = t.indexOf("pointer") === 0 ? PointerEvent : MouseEvent; el.dispatchEvent(new E(t, o)); }); };
    const cards = () => [...(sr() ? sr().querySelectorAll(".section-card-container,.section-card,.card") : [])];
    const title = (c) => { const t = c.querySelector(".section-card-title"); return t ? t.textContent.replace(/\s+/g, " ").trim() : ""; };
    const back = () => { const b = sr() && sr().querySelector('[class*="back" i] button,button[class*="back" i],button[aria-label*="back" i]'); if (b) { fc(b); return true; } return false; };
    const num = (s) => { const m = (s || "").match(/£\s?([\d,]+(?:\.\d{2})?)/); return m ? parseFloat(m[1].replace(/,/g, "")) : null; };
    const clickLabel = (rx) => { let hit = null;[...sr().querySelectorAll("div,span,p,button,label")].forEach(e => { if (!hit && e.childNodes.length === 1 && e.childNodes[0].nodeType === 3 && rx.test(e.textContent.trim())) hit = e.closest('button,[role=button],.card,[class*="card"],[class*="cursor"],div[class*="text-center"]') || e.parentElement; }); if (hit) { fc(hit); return true; } return false; };
    const topPrice = () => { let node = null;[...sr().querySelectorAll("div,span,p")].forEach(e => { if (!node && e.childNodes.length === 1 && e.childNodes[0].nodeType === 3 && /^like new$/i.test(e.textContent.trim())) node = e; }); if (!node) return null; const c = node.closest('[class*="text-center"]') || node.parentElement; return num(c && c.textContent); };
    const capacities = () => { const caps = [];[...sr().querySelectorAll("div,span,p,button,label")].forEach(e => { if (e.childNodes.length === 1 && e.childNodes[0].nodeType === 3) { const t = e.textContent.trim(); if (/^(8|16|32|64|128|256|512)GB$|^1TB$/i.test(t) && caps.indexOf(t) < 0) caps.push(t); } }); return caps; };

    async function openCategory() {
      for (let i = 0; i < 5; i++) { if (!back()) break; await sleep(420); }
      await sleep(400);
      const cat = cards().find(c => title(c) === categoryName);
      if (!cat) return false;
      fc(cat.querySelector("a,button,img,.section-card-img") || cat);
      await sleep(1300);
      for (let i = 0; i < 8; i++) { const more = [...sr().querySelectorAll("*")].find(e => e.childNodes.length === 1 && /load more/i.test(e.textContent || "")); if (!more) break; fc(more.closest('button,.card,[class*="card"]') || more); await sleep(850); }
      return true;
    }
    async function scrapeModel(card) {
      const name = title(card).split(/Get up to/i)[0].trim().replace(/^Apple\s+/, "");
      const img = (card.querySelector("img") || {}).currentSrc || (card.querySelector("img") || {}).src || "";
      fc(card.querySelector("a,button,img,.section-card-img") || card); await sleep(1400);
      if (/connectivity/i.test(sr().textContent)) clickLabel(/^unlocked$/i);
      await sleep(300);
      const caps = capacities(); const storage = {};
      if (caps.length) { for (const cap of caps) { clickLabel(new RegExp("^" + cap + "$", "i")); await sleep(700); const p = topPrice(); if (p != null) storage[cap] = p; } }
      else { const p = topPrice(); if (p != null) storage["default"] = p; }
      let topStorage = null, price = null;
      Object.keys(storage).forEach(k => { if (price == null || storage[k] > price) { price = storage[k]; topStorage = k; } });
      return { name, image: img, price, topStorage, storage };
    }

    if (!await openCategory()) return resolve([]);
    const titles = cards().map(title).filter(t => /get up to/i.test(t)).map(t => t.split(/Get up to/i)[0].trim());
    const out = [];
    for (let i = 0; i < titles.length; i++) {
      if (i > 0) await openCategory();
      const card = cards().find(c => title(c).split(/Get up to/i)[0].trim() === titles[i]);
      if (!card) continue;
      try { out.push(await scrapeModel(card)); } catch (e) {}
    }
    resolve(out);
  });
}

(async () => {
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 2200 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  });
  /* hide the headless automation flag some widgets sniff for */
  await page.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
  page.on("console", (m) => { const t = m.text(); if (/error|fail|reusely|buyback/i.test(t)) console.log("[page]", t); });

  /* Serve our own minimal shell at the store URL. The document origin stays the
     store domain (so the widget's domain allowlist passes) but there's no
     password gate and no dependency on the live page's markup. */
  await page.route(TRADEIN_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=1280"></head><body><div class="buyback-widget"></div></body></html>'
  }));
  await page.goto(TRADEIN_URL, { waitUntil: "load", timeout: 60000 });

  const loadInfo = await page.evaluate(async (tenant) => {
    let scriptErr = false;
    await new Promise((res) => {
      if (window.Buyback) return res();
      const s = document.createElement("script");
      s.src = "https://widget.reusely.com/v3.js"; s.defer = true;
      s.onload = res; s.onerror = () => { scriptErr = true; res(); }; document.head.appendChild(s);
      setTimeout(res, 15000);
    });
    let initErr = null;
    try { new Buyback({ tenantId: tenant, disableFloatButton: true }); } catch (e) { initErr = String(e && e.message || e); }
    return { scriptLoaded: !!window.Buyback, scriptErr, initErr };
  }, TENANT);
  console.log(`Widget script: loaded=${loadInfo.scriptLoaded} scriptErr=${loadInfo.scriptErr} initErr=${loadInfo.initErr || "none"}`);

  /* wait (up to ~40s) for the widget to actually render its category cards */
  const rendered = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 40; i++) {
      const bw = document.querySelector(".buyback-widget");
      const sr = bw && bw.shadowRoot;
      const cards = sr ? sr.querySelectorAll(".section-card-container,.section-card,.card") : [];
      if (cards.length) return { ok: true, cards: cards.length, waitedMs: i * 1000 };
      await sleep(1000);
    }
    const bw = document.querySelector(".buyback-widget");
    return { ok: false, hasWidget: !!bw, hasShadow: !!(bw && bw.shadowRoot) };
  });
  if (!rendered.ok) {
    console.error(`Widget never rendered: ${JSON.stringify(rendered)} — aborting (keeping previous prices.json).`);
    process.exit(1);
  }
  console.log(`Widget rendered ${rendered.cards} cards after ${rendered.waitedMs}ms.`);

  let categories = CATEGORIES;
  if (!categories.length) {
    categories = await page.evaluate(discoverCategoriesInPage);
    console.log(`Discovered ${categories.length} categories: ${categories.join(", ")}`);
  }
  if (!categories.length) { console.error("No categories found — aborting (keeping previous prices.json)."); process.exit(1); }

  const devices = [];
  for (const cat of categories) {
    const models = await page.evaluate(scrapeCategoryInPage, cat);
    const n = Array.isArray(models) ? models.length : 0;
    console.log(`  ${cat}: ${n} model(s)`);
    if (Array.isArray(models)) { models.forEach(m => { if (m) m.category = cat; }); devices.push(...models); }
    await sleep(500);
  }
  await browser.close();

  if (!devices.length) { console.error("No devices scraped — aborting (keeping previous prices.json)."); process.exit(1); }

  /* dedupe by name — keep the richest entry (most storage tiers, then highest price) */
  const byName = new Map();
  for (const d of devices) {
    if (!d || !d.name || d.price == null) continue;
    const prev = byName.get(d.name);
    const score = (x) => (x.storage ? Object.keys(x.storage).length : 0) * 1e6 + (x.price || 0);
    if (!prev || score(d) > score(prev)) byName.set(d.name, d);
  }
  const unique = [...byName.values()].sort((a, b) => (b.price || 0) - (a.price || 0));

  const json = JSON.stringify({ updated: new Date().toISOString(), currency: "GBP", devices: unique }, null, 0);
  writeFileSync(OUT_FILE, json);
  console.log(`Wrote ${unique.length} unique devices (from ${devices.length} scraped) to ${OUT_FILE}`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
