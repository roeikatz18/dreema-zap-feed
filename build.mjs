// Builds the Zap price-comparison XML feed for dreema.co.il from the public Shopify storefront (/products.json).
// No secrets needed. Output: public/feed.xml
// Shipping cost and delivery time come from the coded variant weight (grams = kg*1000), same rules as the site's delivery profile.
import fs from 'node:fs';

const SITE = 'https://dreema.co.il';
const OUT = process.argv[2] || 'public/feed.xml';

// coded weight (kg) -> [shipping ILS paid in cash to the carrier, delivery business days]
const SHIP = {
  0: [0, 5], 0.1: [0, 5], 1: [0, 5],
  10: [170, 21], 30: [200, 21], 70: [300, 21], 100: [400, 21], 150: [250, 21],
  420: [100, 21], 500: [350, 21], 600: [150, 21], 840: [200, 21], 1000: [350, 21], 2500: [400, 21],
};
const WARRANTY = { 'מזרן': '10 שנים' };

async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DreemaFeedBuilder/1.0)', Accept: 'application/json' } });
    if (r.ok) return r.json();
    if (i === 3) throw new Error(`${url} -> ${r.status}`);
    await new Promise(res => setTimeout(res, 3000 * (i + 1)));
  }
}

const products = [];
for (let page = 1; ; page++) {
  const j = await getJson(`${SITE}/products.json?limit=250&page=${page}`);
  if (!j.products.length) break;
  products.push(...j.products);
  if (j.products.length < 250) break;
}
if (products.length < 50) throw new Error(`Only ${products.length} products fetched, refusing to publish a partial feed`);

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/["']/g, '');
const clean = (s, n) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').replace(/["']/g, '').trim().slice(0, n);
const headOf = s => String(s).split(/\s[–—-]\s/)[0].trim();

const items = [];
let skipped = 0;
for (const p of products) {
  for (const v of p.variants) {
    const price = Math.round(parseFloat(v.price));
    const ship = SHIP[v.grams / 1000];
    if (!price || !ship || !v.available) { skipped++; continue; }
    const opts = [v.option1, v.option2, v.option3].filter(o => o && o !== 'Default Title');
    const name = clean(`${headOf(p.title)} ${opts.map(headOf).join(' ')}`, 120);
    const base = `${SITE}/products/${encodeURIComponent(p.handle)}`;
    const withVar = `${base}?variant=${v.id}`;
    const url = withVar.length <= 340 ? withVar : base;
    if (url.length > 340) { skipped++; continue; }
    const img = v.featured_image?.src || p.images[0]?.src || '';
    items.push({ url, name, model: clean(v.sku, 60), details: clean(p.body_html, 255), code: v.sku || String(v.id), price, ship: ship[0], days: ship[1], img, warranty: WARRANTY[p.product_type] || '12 חודשים' });
  }
}

const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<STORE>', '<PRODUCTS>'];
for (const i of items) {
  xml.push('<PRODUCT>',
    `<PRODUCT_URL>${esc(i.url)}</PRODUCT_URL>`,
    `<PRODUCT_NAME>${esc(i.name)}</PRODUCT_NAME>`,
    `<MODEL>${esc(i.model)}</MODEL>`,
    `<DETAILS>${esc(i.details)}</DETAILS>`,
    '<CATALOG_NUMBER></CATALOG_NUMBER>',
    `<PRODUCTCODE>${esc(i.code)}</PRODUCTCODE>`,
    '<CURRENCY>ILS</CURRENCY>',
    `<PRICE>${i.price}</PRICE>`,
    `<SHIPMENT_COST>${i.ship}</SHIPMENT_COST>`,
    `<DELIVERY_TIME>${i.days}</DELIVERY_TIME>`,
    '<MANUFACTURER>Dreema</MANUFACTURER>',
    `<WARRANTY>${esc(i.warranty)}</WARRANTY>`,
    '<WARRANTYBY>Dreema</WARRANTYBY>',
    `<IMAGE>${esc(i.img)}</IMAGE>`,
    '<TAX>1</TAX>',
    '</PRODUCT>');
}
xml.push('</PRODUCTS>', '</STORE>');
fs.mkdirSync(OUT.replace(/[^/\\]+$/, '') || '.', { recursive: true });
fs.writeFileSync(OUT, xml.join('\n'), 'utf8');
console.log(`products ${products.length}, items ${items.length}, skipped ${skipped} -> ${OUT}`);
