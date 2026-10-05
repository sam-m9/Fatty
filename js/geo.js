// Fills in missing coordinates from street addresses using OpenStreetMap's Nominatim.
// Runs on the device, one request per ~1.1s (Nominatim's usage policy), and caches
// every answer in localStorage so each address is only looked up once.

const KEY = 'fatty.v1.geo2';
const GAP_MS = 1100;

let cache = null;
function load() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { cache = {}; }
  return cache;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* full or blocked */ }
}

// Suite and building numbers confuse the geocoder; drop them.
function cleanAddress(a) {
  return a
    .replace(/,?\s*\b(ste|suite|unit|bldg|building)\b\.?\s*[\w-]+|\s*#\s*[\w-]+/gi, '')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function lookup(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`geo ${res.status}`);
  const [hit] = await res.json();
  return hit ? [+hit.lat, +hit.lon] : null;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Applies cached coordinates without any network. Returns how many were filled.
export function applyCachedCoords(places) {
  const c = load();
  let n = 0;
  for (const p of places) {
    if (p.lat != null && p.lng != null) continue;
    const hit = p.address && c[p.address];
    if (Array.isArray(hit)) { [p.lat, p.lng] = hit; n++; }
  }
  return n;
}

let running = false;
let current = null; // the places array the running loop reads from
const priority = new Set(); // addresses to look up before anything else
export const progress = { done: 0, total: 0, active: false };

const needs = (p, c, tried) =>
  (p.lat == null || p.lng == null) && p.address && !(p.address in c) && !tried.has(p.address);

// Looks up every place that has an address but no coordinates, one at a time.
// onFound runs after each lookup (hit or miss) so the map and progress can update.
// Calling it again while it runs (e.g. after you edit an address) moves that address
// to the front of the line instead of waiting for the whole batch.
export async function geocodeMissing(places, onFound, first = null) {
  current = places;
  if (first?.address) priority.add(first.address);
  if (running || !navigator.onLine) return;
  const c = load();
  const tried = new Set();
  const remaining = () => current.filter((p) => needs(p, c, tried));
  if (!remaining().length) return;
  running = true;
  Object.assign(progress, { done: 0, total: new Set(remaining().map((p) => p.address)).size, active: true });
  try {
    for (;;) {
      if (!navigator.onLine) break;
      const left = remaining();
      if (!left.length) break;
      const p = left.find((x) => priority.has(x.address)) || left[0];
      priority.delete(p.address);
      tried.add(p.address);
      progress.total = progress.done + new Set(left.map((x) => x.address)).size;
      try {
        let hit = await lookup(cleanAddress(p.address));
        if (!hit) {
          await wait(GAP_MS);
          hit = await lookup(`${p.name}, ${/kyle|cedar park|round rock|pflugerville|leander/i.test(p.address) ? p.address.split(',').slice(-2).join(',') : 'Austin, TX'}`);
        }
        c[p.address] = hit || 0;
        save();
        if (hit) {
          for (const q of current) if (q.address === p.address) [q.lat, q.lng] = hit;
        }
      } catch { /* network hiccup: try again next launch */ }
      progress.done++;
      onFound();
      await wait(GAP_MS);
    }
  } finally {
    running = false;
    progress.active = false;
    onFound();
  }
}
