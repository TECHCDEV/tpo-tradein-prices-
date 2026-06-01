/* © The People's Operator 2026 */
import { chromium } from "playwright";
import { writeFileSync } from "fs";

const TENANT = process.env.TPO_TENANT_ID || "04fedcfc9da62eabfa3b1b499dd67f3133ce8599c810a44b5b5616f8a7c01120";
const TRADEIN_URL = process.env.TPO_TRADEIN_URL || "https://tpoteststore.myshopify.com/pages/tpo-trade-in";
const OUT_FILE = process.env.TPO_OUT_FILE || "prices.json";
const CATEGORIES = (process.env.TPO_CATEGORIES || "iPhone,Galaxy S Series,Pixel").split(",").map(s => s.trim()).filter(Boolean);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(TRADEIN_URL, { waitUntil: "networkidle", timeout: 60000 });

  await page.evaluate(async (tenant) => {
    await new Promise((res) => {
      if (window.Buyback) return res();
      const s = document.createElement("script");
      s.src = "https://widget.reusely.com/v3.js"; s.defer = true;
      s.onload = res; s.onerror = res; document.head.appendChild(s);
      setTimeout(res, 8000);
    });
    try { new Buyback({ tenantId: tenant, disableFloatButton: true }); } catch (e) {}
  }, TENANT);

  await sleep(4000);

  const devices = [];
  for (const cat of CATEGORIES) {
    const models = await page.evaluate(scrapeCategoryInPage, cat);
    if (Array.isArray(models)) devices.push(...models);
    await sleep(500);
  }
  await browser.close();

  if (!devices.length) { console.error("No devices scraped — aborting (keeping previous prices.json)."); process.exit(1); }

  const json = JSON.stringify({ updated: new Date().toISOString(), currency: "GBP", devices }, null, 0);
  writeFileSync(OUT_FILE, json);
  console.log(`Wrote ${devices.length} devices to ${OUT_FILE}`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
