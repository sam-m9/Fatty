// Reads the Google Sheet through the gviz endpoint and turns rows into places.
// The sheet must be shared as "Anyone with the link can view".

import { isOpenAt } from './hours.js';
import { regionFor, normalizeRegion } from './regions.js';

const DAY = 86400000;

export function isSheetLink(url) {
  return /docs\.google\.com\/spreadsheets\/(u\/\d+\/)?d\/[\w-]{20,}/.test(url || '');
}

export function isFolderLink(url) {
  return /drive\.google\.com\/.*folders\/[\w-]{10,}/.test(url || '');
}

export function folderId(url) {
  const m = /\/folders\/([\w-]+)/.exec(url || '');
  return m ? m[1] : '';
}

export function parseSheetLink(url) {
  const m = /\/spreadsheets\/(?:u\/\d+\/)?d\/([\w-]+)/.exec(url || '');
  if (!m) return null;
  const g = /[#?&]gid=(\d+)/.exec(url);
  return { id: m[1], gid: g ? g[1] : null };
}

function gvizUrl({ id, gid }, extra = '') {
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?headers=1&tqx=out:json${extra}` +
    (gid ? `&gid=${gid}` : '') + `&_=${Date.now()}`;
}

function unwrap(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('not-shared');
  return JSON.parse(text.slice(start, end + 1));
}

// Fallback for browsers where the fetch is blocked: gviz also supports a JSONP-style handler.
function jsonp(ref) {
  return new Promise((resolve, reject) => {
    const cb = `__fatty${Date.now()}`;
    const s = document.createElement('script');
    const done = () => { delete window[cb]; s.remove(); };
    const timer = setTimeout(() => { done(); reject(new Error('timeout')); }, 15000);
    window[cb] = (data) => { clearTimeout(timer); done(); resolve(data); };
    s.onerror = () => { clearTimeout(timer); done(); reject(new Error('not-shared')); };
    s.onload = () => setTimeout(() => {
      if (window[cb]) { clearTimeout(timer); done(); reject(new Error('not-shared')); }
    }, 50);
    s.src = gvizUrl(ref, `;responseHandler:${cb}`);
    document.head.appendChild(s);
  });
}

async function fetchTable(ref) {
  let data;
  try {
    const res = await fetch(gvizUrl(ref), { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error('http');
    data = unwrap(await res.text());
  } catch (e) {
    if (!navigator.onLine) throw new Error('offline');
    data = await jsonp(ref);
  }
  if (data.status === 'error') {
    const msg = (data.errors || []).map((e) => e.detailed_message || e.message).join(' ');
    throw new Error(/access|permission|sign in/i.test(msg) ? 'not-shared' : msg || 'sheet-error');
  }
  return data.table;
}

export function errorText(err) {
  const m = err && err.message;
  if (m === 'offline') return "You're offline. Showing what was saved on this device.";
  if (m === 'not-shared') return 'Fatty could not read the sheet. In Google Sheets, tap Share and set General access to "Anyone with the link" (Viewer).';
  if (m === 'timeout') return 'The sheet took too long to answer.';
  return m || 'Something went wrong reading the sheet.';
}

// ---------- Row → place ----------

const ALIASES = {
  link: ['link', 'url', 'reel', 'post'],
  score: ['score', 'rating', 'stars'],
  note: ['note', 'notes', 'comment'],
  date: ['date', 'added', 'saved', 'date added', 'timestamp'],
  name: ['name', 'restaurant', 'spot', 'place'],
  area: ['area', 'neighborhood', 'neighbourhood', 'hood'],
  region: ['region', 'side', 'part of town'],
  address: ['address', 'street address', 'location'],
  cuisine: ['cuisine', 'type', 'food'],
  price: ['price', 'cost', '$'],
  hours: ['hours', 'opening hours'],
  maplink: ['map link', 'maps link', 'map', 'maps', 'google maps', 'apple maps'],
  tags: ['tags', 'tag', 'mood', 'moods'],
  lat: ['lat', 'latitude'],
  lng: ['lng', 'lon', 'long', 'longitude'],
  open: ['open', 'open now', 'open flag'],
  photo: ['photo', 'image', 'picture', 'thumbnail'],
};

function columnMap(cols) {
  const map = {};
  cols.forEach((c, i) => {
    const label = String(c.label || '').trim().toLowerCase();
    for (const [key, names] of Object.entries(ALIASES)) {
      if (map[key] == null && names.includes(label)) map[key] = i;
    }
  });
  return map;
}

function parseGvizDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const m = /^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/.exec(v);
    if (m) return new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    const d = new Date(v);
    if (!isNaN(d)) return d;
  }
  if (typeof v === 'number') {
    // Sheets serial date.
    return new Date(Math.round((v - 25569) * DAY));
  }
  return null;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return isFinite(n) ? n : null;
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

function parsePrice(v) {
  const s = str(v);
  if (!s) return '';
  const dollars = (s.match(/\$/g) || []).length;
  if (dollars) return '$'.repeat(Math.min(dollars, 4));
  const n = parseInt(s, 10);
  return n >= 1 && n <= 4 ? '$'.repeat(n) : '';
}

function parseBool(v) {
  if (v === true || v === false) return v;
  const s = str(v).toLowerCase();
  if (['true', 'yes', 'y', 'open', '1'].includes(s)) return true;
  if (['false', 'no', 'n', 'closed', '0'].includes(s)) return false;
  return null;
}

function safeDecode(v) {
  try { return decodeURIComponent(v); } catch { return v; } // one bad %-sequence shouldn't break the sheet
}

// Pulls coordinates out of common Google / Apple Maps link shapes.
function coordsFromLink(url) {
  const s = url || '';
  const m = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(s) ||
    /[?&](?:ll|q|query|sll|daddr)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(safeDecode(s)) ||
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(s);
  return m ? [+m[1], +m[2]] : null;
}

function nameFromLink(link) {
  try {
    const u = new URL(link);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'Untitled spot';
  }
}

export function rowsToPlaces(table, now = new Date()) {
  const col = columnMap(table.cols || []);
  const cell = (row, key) => {
    const i = col[key];
    if (i == null) return null;
    const c = row.c && row.c[i];
    if (!c) return null;
    return c.v != null ? c.v : c.f;
  };

  const places = [];
  (table.rows || []).forEach((row, idx) => {
    const link = str(cell(row, 'link'));
    const name = str(cell(row, 'name'));
    if (!link && !name) return;

    const score = num(cell(row, 'score'));
    const rating = score == null ? null : Math.round(Math.max(0, Math.min(5, score)) * 10) / 10;
    const date = parseGvizDate(cell(row, 'date'));
    const mapLink = str(cell(row, 'maplink'));
    let lat = num(cell(row, 'lat'));
    let lng = num(cell(row, 'lng'));
    if (lat == null || lng == null) {
      const c = coordsFromLink(mapLink);
      if (c) [lat, lng] = c;
    }
    const hours = str(cell(row, 'hours'));
    let openNow = parseBool(cell(row, 'open'));
    const fromHours = isOpenAt(hours, now);
    if (fromHours != null) openNow = fromHours;

    const area = str(cell(row, 'area'));
    places.push({
      id: `r${idx + 2}`,
      name: name || nameFromLink(link),
      area,
      region: normalizeRegion(cell(row, 'region')) || regionFor(area),
      address: str(cell(row, 'address')),
      cuisine: str(cell(row, 'cuisine')),
      price: parsePrice(cell(row, 'price')),
      rating,
      lat,
      lng,
      hours,
      openNow,
      addedDaysAgo: date ? Math.max(0, Math.floor((now - date) / DAY)) : null,
      addedAt: date ? date.getTime() : 0,
      tags: str(cell(row, 'tags')).split(/\s*[,;|]\s*/).filter(Boolean),
      note: str(cell(row, 'note')),
      link,
      mapLink,
      photo: str(cell(row, 'photo')),
    });
  });
  return places;
}

// The built-in list ships as {cols: [labels], rows: [[values]]}; reshape it like a gviz table.
export async function loadBundled(url = 'data/austin.json') {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('bundle');
  const data = await res.json();
  return rowsToPlaces({
    cols: data.cols.map((label) => ({ label })),
    rows: data.rows.map((r) => ({ c: r.map((v) => (v === null || v === '' ? null : { v })) })),
  });
}

export async function loadPlaces(sheetUrl) {
  const ref = parseSheetLink(sheetUrl);
  if (!ref) throw new Error('That does not look like a Google Sheets link.');
  const table = await fetchTable(ref);
  return rowsToPlaces(table);
}
