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
    .replace(/,?\s*(ste|suite|unit|bldg|building|#)\.?\s*[\w-]+/gi, '')
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
export const progress = { done: 0, total: 0, active: false };

// Looks up every place that has an address but no coordinates.
// onFound runs after each lookup (hit or miss) so the map and progress can update.
export async function geocodeMissing(places, onFound) {
  if (running || !navigator.onLine) return;
  const c = load();
  const seen = new Set();
  const todo = places.filter((p) => {
    if ((p.lat != null && p.lng != null) || !p.address || p.address in c || seen.has(p.address)) return false;
    seen.add(p.address);
    return true;
  });
  if (!todo.length) return;
  running = true;
  Object.assign(progress, { done: 0, total: todo.length, active: true });
  try {
    for (const p of todo) {
      if (!navigator.onLine) break;
      try {
        let hit = await lookup(cleanAddress(p.address));
        if (!hit) {
          await wait(GAP_MS);
          hit = await lookup(`${p.name}, ${/kyle|cedar park|round rock|pflugerville|leander/i.test(p.address) ? p.address.split(',').slice(-2).join(',') : 'Austin, TX'}`);
        }
        c[p.address] = hit || 0;
        save();
        if (hit) {
          for (const q of places) if (q.address === p.address) [q.lat, q.lng] = hit;
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
