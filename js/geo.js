// Fills in missing coordinates from street addresses using OpenStreetMap's Nominatim.
// Runs on the device, one request per ~1.1s (Nominatim's usage policy), and caches
// every answer in localStorage so each address is only looked up once.

const KEY = 'fatty.v1.geo';
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

// Looks up every place that has an address but no coordinates.
// onFound is called after each successful lookup so the map can update.
export async function geocodeMissing(places, onFound) {
  if (running || !navigator.onLine) return;
  const c = load();
  const todo = places.filter((p) => (p.lat == null || p.lng == null) && p.address && !(p.address in c));
  if (!todo.length) return;
  running = true;
  try {
    for (const p of todo) {
      if (!navigator.onLine) break;
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(p.address)}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (res.ok) {
          const [hit] = await res.json();
          c[p.address] = hit ? [+hit.lat, +hit.lon] : 0;
          save();
          if (hit) {
            p.lat = +hit.lat;
            p.lng = +hit.lon;
            onFound();
          }
        }
      } catch { /* try again next session */ }
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  } finally {
    running = false;
  }
}
