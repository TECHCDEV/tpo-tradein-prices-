/* © The People's Operator 2026 */
import { readFileSync } from "fs";

const STORE   = process.env.SHOPIFY_STORE;                 // e.g. tpoteststore.myshopify.com
const TOKEN   = process.env.SHOPIFY_ADMIN_TOKEN;           // GitHub Secret — never hard-code
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const SUFFIX  = process.env.TPO_PAGE_TEMPLATE  || "tradein"; // page template_suffix → page.tradein
const PRICES  = process.env.TPO_OUT_FILE        || "prices.json";

if (!STORE || !TOKEN) {
  console.log("SHOPIFY_STORE / SHOPIFY_ADMIN_TOKEN not set — skipping page creation.");
  process.exit(0);
}

const base = `https://${STORE}/admin/api/${VERSION}`;
const headers = { "X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json", "Accept": "application/json" };
const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function existingHandles() {
  const set = new Set();
  let url = `${base}/pages.json?limit=250&fields=id,handle`;
  while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`List pages failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    (data.pages || []).forEach(p => set.add(p.handle));
    const link = res.headers.get("link") || res.headers.get("Link");
    const m = link && link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
    await sleep(300);
  }
  return set;
}

async function createPage(name) {
  const body = { page: { title: name, handle: slug(name), template_suffix: SUFFIX, published: true, body_html: "" } };
  const res = await fetch(`${base}/pages.json`, { method: "POST", headers, body: JSON.stringify(body) });
  if (res.status === 429) { await sleep(2000); return createPage(name); }
  if (!res.ok) { console.error(`  x ${name}: ${res.status} ${await res.text()}`); return false; }
  console.log(`  + created /pages/${slug(name)}`);
  return true;
}

(async () => {
  const feed = JSON.parse(readFileSync(PRICES, "utf8"));
  const devices = (feed.devices || []).filter(d => d && d.name);
  if (!devices.length) { console.log("No devices in feed — nothing to create."); return; }

  const have = await existingHandles();
  let created = 0, skipped = 0;
  for (const d of devices) {
    const h = slug(d.name);
    if (have.has(h)) { skipped++; continue; }
    if (await createPage(d.name)) { created++; have.add(h); }
    await sleep(600); // stay under REST rate limits (~2/s)
  }
  console.log(`Pages: ${created} created, ${skipped} already existed, ${devices.length} total.`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
