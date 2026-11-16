// Builds the Zap price-comparison XML feed for dreema.co.il from the public Shopify storefront (/products.json).
// No secrets needed. Output: public/feed.xml
// Shipping cost and delivery time come from the coded variant weight (grams = kg*1000), same rules as the site's delivery profile.
import fs from 'node:fs';

const SITE = 'https://dreema.co.il';
const OUT = process.argv[2] || 'public/feed.xml';

// coded weight (kg) -> [shipping ILS paid in cash to the carrier, delivery business days]
const SHIP = {
  // weights 0 and 1 = Abstract supplier furniture (free delivery only Gedera-Hadera): excluded until a nationwide price is known
  0.1: [0, 5],
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
    // Zap asked for the bed/mattress type (single / 1.5 / double) in the product name
    const sm = opts.join(' ').match(/(\d{2,3})\s*[x×X\/]\s*(\d{3})/);
    const width = sm ? parseInt(sm[1], 10) : 0;
    let title = headOf(p.title);
    if (width && ['מזרן', 'מיטה', 'טופר'].includes(p.product_type)) {
      const t = width <= 100 ? 0 : width <= 120 ? 1 : 2;
      const mat = ['יחיד', 'וחצי', 'זוגי'][t], bed = ['יחידה', 'וחצי', 'זוגית'][t];
      if (/^בסיס מיטה/.test(title)) title = title.replace('בסיס מיטה', `בסיס מיטה ${bed}`);
      else if (/^מיטה /.test(title)) title = title.replace('מיטה', `מיטה ${bed}`);
      else if (/^מיטת /.test(title)) title = `${title} ${bed}`;
      else if (/^מזרן/.test(title)) title = title.replace('מזרן', `מזרן ${mat}`);
      else if (/^טופר/.test(title)) title = `${title} ל${t === 1 ? 'מיטה וחצי' : 'מזרן ' + mat}`;
    }
    const name = clean(`${title} ${opts.map(headOf).join(' ')}`, 120);
    const base = `${SITE}/products/${encodeURIComponent(p.handle)}`;
    const withVar = `${base}?variant=${v.id}`;
    const url = withVar.length <= 340 ? withVar : base;
    if (url.length > 340) { skipped++; continue; }
    const img = v.featured_image?.src || p.images[0]?.src || '';
    items.push({ url, name, model: clean(v.sku, 60), details: clean(p.body_html, 255), code: v.sku || String(v.id), price, ship: ship[0], days: ship[1], img, warranty: WARRANTY[p.product_type] || '12 חודשים', type: p.product_type });
  }
}

const CATS = {
  'מזרן': ['mattresses', 'מזרנים'], 'טופר': ['toppers', 'טופרים ורפידות למזרן'], 'מיטה': ['beds', 'מיטות ובסיסי מיטה'],
  'ספות': ['sofas', 'ספות'], 'כורסאות': ['armchairs', 'כורסאות'], 'כיסאות': ['chairs', 'כיסאות אוכל'],
  'כיסאות בר': ['bar-stools', 'כיסאות בר'], 'כיסאות משרד': ['office-chairs', 'כיסאות משרד'],
  'שולחן סלון': ['coffee-tables', 'שולחנות סלון'], 'שולחן צד': ['side-tables', 'שולחנות צד'], 'קונסולה': ['consoles', 'קונסולות'],
  'ספסל': ['benches', 'ספסלים'], 'ספריות': ['bookcases', 'ספריות'], 'שידת לילה': ['nightstands', 'שידות לילה'],
  'מוצרים נלווים': ['bedding', 'כריות, שמיכות ומגני מזרן'], 'bundle': ['bedding', 'כריות, שמיכות ומגני מזרן'],
  'אקססוריז לבית': ['home-decor', 'אביזרי עיצוב לבית'],
};
const toXml = list => {
  const x = ['<?xml version="1.0" encoding="UTF-8"?>', '<STORE>', '<PRODUCTS>'];
  for (const i of list) {
    x.push('<PRODUCT>',
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
  x.push('</PRODUCTS>', '</STORE>');
  return x.join('\n');
};
const dir = OUT.replace(/[^/\\]+$/, '') || '.';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(OUT, toXml(items), 'utf8'); // everything in one file (kept for reference)
const groups = {};
const unknown = new Set();
for (const i of items) {
  const c = CATS[i.type];
  if (!c) { unknown.add(i.type); continue; }
  (groups[c[0]] ??= { label: c[1], list: [] }).list.push(i);
}
if (unknown.size) throw new Error('Unmapped product types: ' + [...unknown].join(', '));
fs.mkdirSync(dir + 'cat', { recursive: true });
const rows = [];
for (const [slug, g] of Object.entries(groups)) {
  fs.writeFileSync(`${dir}cat/${slug}.xml`, toXml(g.list), 'utf8');
  rows.push(`<li><a href="cat/${slug}.xml">${g.label}</a> (${g.list.length})</li>`);
}
fs.writeFileSync(dir + 'index.html', `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>Dreema - zap mirror</title></head><body><h1>Dreema - אתר מראה לזאפ</h1><ul>${rows.join('')}</ul></body></html>`, 'utf8');
console.log(`products ${products.length}, items ${items.length}, skipped ${skipped}, categories ${Object.keys(groups).length} -> ${dir}`);
