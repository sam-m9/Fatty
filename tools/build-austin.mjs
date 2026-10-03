// Builds data/austin.json (bundled list) and data/austin.csv (for importing into the sheet)
// from the research files plus the ratings in the original list.
// Usage: node tools/build-austin.mjs <research-dir>
import fs from 'node:fs';
import path from 'node:path';
import { isOpenAt } from '../js/hours.js';
import { regionFor } from '../js/regions.js';

const dir = process.argv[2];
const TODAY = new Date().toISOString().slice(0, 10);
const CHUNKS = ['A', 'B1', 'B2', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const TAGS = new Set(['Date night', 'Cheap eats', 'Group friendly', 'Outdoor seating', 'Late night', 'Brunch', 'Solo',
  'Food truck', 'Work friendly', 'Dog friendly', 'Cocktails', 'Michelin']);

// The category each spot sat under in the original list (used when research has no cuisine).
const CATEGORY = {
  A: ['', '', 'Mexican', 'Mexican', 'Mexican', 'Mexican', ...Array(12).fill('Mexican')],
  B1: Array(12).fill('Mexican'), B2: Array(12).fill('Mexican'),
  C: ['Hawaiian', 'Italian', 'Italian', 'Sandwiches', ...Array(8).fill('Pizza'), ...Array(5).fill('Fried chicken')],
  D: [...Array(5).fill('Thai'), 'Vietnamese', ...Array(6).fill('Mediterranean'), ...Array(5).fill('Burgers'), 'Bakery'],
  E: [...Array(6).fill('Sushi'), 'Ramen', 'Ramen', ...Array(10).fill('Cafe')],
  F: Array(18).fill('Cafe'),
  G: [...Array(5).fill('Dessert'), ...Array(13).fill('Coffee')],
  H: [...Array(17).fill('Coffee'), 'Middle Eastern', 'Middle Eastern', 'Bakery'],
  I: Array(13).fill(''),
};
const BRUNCH_CHUNK_RANGES = { E: [8, 17], F: [0, 17] }; // listed under Brunch

// Ratings from the list (✅ score). Keyed chunk:index (0-based).
const RATING = {
  'A:1': 4, 'A:2': 4.7, 'A:5': 4.5, 'A:6': 4.1, 'A:7': 4, 'A:8': 4.7, 'A:9': 4.7, 'A:10': 4.2, 'A:12': 4.7,
  'A:15': 4.4, 'A:16': 4.5, 'A:17': 4.5,
  'B1:0': 4.7, 'B1:1': 4.7, 'B1:4': 3.9, 'B1:5': 3.8, 'B2:0': 4.5, 'B2:5': 4.7,
  'C:1': 4.5, 'C:5': 4.5, 'C:6': 4.5, 'C:12': 4.6, 'C:13': 4.5, 'C:14': 4.3, 'C:15': 4.6,
  'D:1': 4.3, 'D:3': 4.6, 'D:6': 4.7, 'D:9': 4.5, 'D:10': 4.5, 'D:13': 4.5, 'D:14': 4.8,
  'E:1': 4.5, 'E:2': 4.9, 'E:3': 4.9, 'E:6': 4.8, 'E:7': 4.8, 'E:8': 4.3, 'E:9': 4.5, 'E:14': 4.5, 'E:17': 4.6,
  'F:0': 4.4, 'F:3': 4.6, 'F:6': 3.8, 'F:10': 4, 'F:12': 4.5,
};
// Marked new in the list: El Xolito, Spread & Co, Daymaker, and the whole New section.
const NEW = new Set(['A:11', 'H:14', 'F:13', ...Array.from({ length: 13 }, (_, i) => `I:${i}`)]);

// Matches the research couldn't confirm: keep the list's name only.
const NAME_ONLY = {
  'A:0': 'Ham Honey', 'A:4': 'Mission Street Burrito', 'B1:5': "Coco'ma", 'D:0': 'Thai Crush',
  'E:8': 'Brooklyn Bagel', 'I:4': 'Chop Omakase', 'G:3': "Andy K's Donuts", 'H:15': 'Terrible Live Coffee',
};
// Values the researchers said were guesses.
const DROP = {
  'G:0': ['neighborhood'], 'B2:11': ['neighborhood'], 'I:10': ['hours'],
};
// Michelin tags that weren't confirmed.
const NO_MICHELIN = new Set(['I:5', 'I:9', 'I:10']);

const rows = [];
const report = { closed: [], nameOnly: [], unresearched: [], droppedHours: [] };

for (const chunk of CHUNKS) {
  const items = JSON.parse(fs.readFileSync(path.join(dir, `${chunk}.json`), 'utf8'));
  items.forEach((r, i) => {
    const key = `${chunk}:${i}`;
    const rating = RATING[key] ?? null;
    const isNew = NEW.has(key);
    const listName = r.input.replace(/\s*\(.*\)\s*$/, '').trim();
    const unresearched = /not researched/i.test(r.flags || '') || !r.name;
    const category = CATEGORY[chunk][i] || '';
    const brunchList = BRUNCH_CHUNK_RANGES[chunk] && i >= BRUNCH_CHUNK_RANGES[chunk][0] && i <= BRUNCH_CHUNK_RANGES[chunk][1];

    if (r.status === 'closed_permanently' && !NAME_ONLY[key]) {
      report.closed.push(`${r.name || r.input}${rating != null ? ` (rated ${rating})` : ''}`);
      return;
    }

    let p;
    if (NAME_ONLY[key] || unresearched || r.status === 'not_found') {
      const name = NAME_ONLY[key] || r.name || listName;
      (NAME_ONLY[key] ? report.nameOnly : report.unresearched).push(name);
      p = { name, area: '', address: '', cuisine: category, price: '', hours: '', link: '', note: '', tags: brunchList ? ['Brunch'] : [] };
    } else {
      const drop = DROP[key] || [];
      let hours = drop.includes('hours') ? '' : (r.hours || '');
      if (hours && isOpenAt(hours) === null) { report.droppedHours.push(`${r.name}: ${hours}`); hours = ''; }
      const area = drop.includes('neighborhood') ? '' : (r.neighborhood || '');
      let tags = (r.tags || []).filter((t) => TAGS.has(t));
      if (NO_MICHELIN.has(key)) tags = tags.filter((t) => t !== 'Michelin');
      if (brunchList && !tags.includes('Brunch')) tags.push('Brunch');
      p = {
        name: r.name,
        area: regionFor(area) ? area : '',
        address: r.address || '',
        cuisine: r.cuisine || category,
        price: r.price || '',
        hours,
        link: r.instagram || r.website || '',
        note: r.note || '',
        tags,
      };
    }
    if (isNew) p.tags = ['New', ...p.tags.filter((t) => t !== 'New')];
    rows.push({ ...p, rating, date: isNew ? TODAY : '', key });
  });
}

// Merge duplicates from the list (same spot under two categories).
const seen = new Map();
const out = [];
for (const p of rows) {
  const k = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (seen.has(k)) {
    const a = seen.get(k);
    a.rating ??= p.rating;
    a.tags = [...new Set([...a.tags, ...p.tags])];
    continue;
  }
  seen.set(k, p);
  out.push(p);
}

const COLS = ['Link', 'Score', 'Note', 'Date', 'Name', 'Region', 'Area', 'Address', 'Cuisine', 'Price', 'Hours', 'Map link', 'Tags', 'Lat', 'Lng'];
const toRow = (p) => [p.link, p.rating, p.note, p.date, p.name, regionFor(p.area), p.area, p.address, p.cuisine,
  p.price, p.hours, '', p.tags.join(', '), null, null];
const data = { cols: COLS, rows: out.map(toRow) };
fs.writeFileSync('data/austin.json', JSON.stringify(data));
const csvCell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
fs.writeFileSync('data/austin.csv', [COLS, ...data.rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n');

console.log(JSON.stringify({ spots: out.length, ...report }, null, 1));
