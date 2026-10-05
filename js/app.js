import { I } from './icons.js';
import { loadPlaces, loadBundled, errorText, isSheetLink, isFolderLink, folderId } from './sheet.js';
import { REGIONS } from './regions.js';
import { applyCachedCoords, geocodeMissing, progress as geoProgress } from './geo.js';
import { backupScript, endpointScript } from './scripts.js';

// ---------- Persistence ----------

const STORE = 'fatty.v1';
const DATA_KEY = 'fatty.v1.data';
const EDITS_KEY = 'fatty.v1.edits';

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage full or blocked */ }
}

const saved = readJSON(STORE) || {};

// ---------- State ----------

const emptyFood = () => ({ region: [], area: [], cuisine: [], price: [], status: [], hours: [] });
const emptyDunno = () => ({ cuisine: [], price: [], distance: [], mood: [], status: [], rating: [] });

const state = {
  tab: 'food',
  dark: true, // always opens in dark mode; the toggle lasts for the session
  sort: saved.sort || 'rating',
  cfg: { sheet: saved.cfg?.sheet || '', folder: saved.cfg?.folder || '' },
  places: [],
  status: 'idle', // idle | loading | ready | error
  source: 'none', // none | bundle | sheet
  error: '',
  fetchedAt: 0,
  q: '',
  f: emptyFood(),
  d: emptyDunno(),
  open: null, // open dropdown id, e.g. "food:area"
  expanded: null,
  statsOpen: false,
  mapSel: null,
  spin: { phase: 'idle' },
  loc: null,
  sheet: null, // 'data' | 'setup'
  ui: { editing: { sheet: false, folder: false }, confirm: { sheet: false, folder: false }, err: { sheet: '', folder: '' }, copied: '' },
};

// ---------- Your edits (ratings, notes, price, tags), kept on this device ----------

const editKey = (p) => p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
let edits = readJSON(EDITS_KEY) || {};

function applyEdits(places) {
  for (const p of places) {
    const e = edits[editKey(p)];
    if (!e) continue;
    p.rating = e.rating;
    p.note = e.note;
    p.price = e.price;
    p.tags = e.tags.slice();
  }
}

function saveEdit(p, e) {
  if (e.rating != null) e.tags = e.tags.filter((t) => t !== 'New'); // rated = visited, no longer new
  edits[editKey(p)] = { ...e, at: Date.now() };
  writeJSON(EDITS_KEY, edits);
  Object.assign(p, { rating: e.rating, note: e.note, price: e.price, tags: e.tags.slice() });
}

function persist() {
  writeJSON(STORE, { cfg: state.cfg, dark: state.dark, sort: state.sort });
}

// ---------- Helpers ----------

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NEW_DAYS = 183;
const TAGS = ['Date night', 'Cheap eats', 'Group friendly', 'Outdoor seating', 'Late night', 'Brunch', 'Solo'];
const PRICES = ['$', '$$', '$$$', '$$$$'];
const STATUSES = ['New', 'Visited', 'Want to try'];

const isNew = (p) => p.rating == null && p.addedDaysAgo != null && p.addedDaysAgo <= NEW_DAYS;
const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));

function ratingColor(r) {
  const stops = [[2.5, [241, 169, 160]], [3.5, [245, 214, 139]], [5, [143, 211, 160]]];
  const v = Math.max(2.5, Math.min(5, r));
  const i = v <= 3.5 ? 0 : 1;
  const [a, ca] = stops[i];
  const [b, cb] = stops[i + 1];
  const t = (v - a) / (b - a);
  const c = ca.map((x, k) => Math.round(x + (cb[k] - x) * t));
  return `rgb(${c.join(',')})`;
}
const fmtRating = (r) => r.toFixed(1);
const badge = (r) => `<span class="badge" style="background:${ratingColor(r)}">${fmtRating(r)}</span>`;
const meta = (p) => [p.area || p.region, p.cuisine, p.price].filter(Boolean).join(' · ');

function facts(p, closedWord = 'Closed now') {
  const out = [];
  if (p.distance != null) out.push(`${p.distance.toFixed(1)} mi away`);
  if (p.openNow === true) out.push('Open now');
  if (p.openNow === false) out.push(closedWord);
  if (p.addedDaysAgo != null) out.push(p.addedDaysAgo === 0 ? 'saved today' : `saved ${p.addedDaysAgo}d ago`);
  return out.join(' · ');
}

function mapsUrl(p) {
  if (p.mapLink) return p.mapLink;
  if (p.address) return `https://maps.apple.com/?q=${encodeURIComponent(p.name)}&address=${encodeURIComponent(p.address)}`;
  const q = encodeURIComponent([p.name, p.area].filter(Boolean).join(' '));
  if (p.lat != null && p.lng != null) return `https://maps.apple.com/?ll=${p.lat},${p.lng}&q=${encodeURIComponent(p.name)}`;
  return `https://maps.apple.com/?q=${q}`;
}

function linkBtn(href, cls, label, extra = '') {
  if (!href) return `<span class="btn ${cls} disabled" aria-disabled="true" ${extra}>${label}</span>`;
  return `<a class="btn ${cls}" href="${esc(href)}" target="_blank" rel="noopener" ${extra}>${label}</a>`;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function hash(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// ---------- Location ----------

function haversine(a, b) {
  const R = 3958.8;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function applyDistances() {
  for (const p of state.places) {
    p.distance = state.loc && p.lat != null && p.lng != null ? haversine(state.loc, p) : null;
  }
}

let locPromise = null;
function ensureLocation({ quiet = false } = {}) {
  if (state.loc) return Promise.resolve(state.loc);
  if (locPromise) return locPromise;
  if (!navigator.geolocation) {
    if (!quiet) toast('Location is not available on this device.');
    return Promise.resolve(null);
  }
  locPromise = new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        applyDistances();
        renderData();
        resolve(state.loc);
      },
      () => {
        locPromise = null;
        if (!quiet) toast('Turn on location to use distance.');
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
  return locPromise;
}

// ---------- Filtering & sorting ----------

const PRED = {
  region: (p, v) => p.region === v,
  area: (p, v) => p.area === v,
  cuisine: (p, v) => p.cuisine === v,
  price: (p, v) => p.price === v,
  status: (p, v) => (v === 'Visited' ? p.rating != null : v === 'Want to try' ? p.rating == null : isNew(p)),
  hours: (p, v) => (v === 'Open now' ? p.openNow === true : p.openNow === false),
  mood: (p, v) => p.tags.includes(v),
  distance: (p, v) => p.distance != null && p.distance < parseFloat(v.replace(/[^\d.]/g, '')),
  rating: (p, v) => p.rating != null && p.rating >= parseFloat(v),
};

function applyFilters(list, filters) {
  return list.filter((p) =>
    Object.entries(filters).every(([k, vals]) => !vals.length || vals.some((v) => PRED[k](p, v))));
}

function applySearch(list, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((p) => {
    const hay = [p.name, p.area, p.cuisine, p.note, p.price, ...p.tags].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const byName = (a, b) => a.name.localeCompare(b.name);
const lastIfEmpty = (a, b) => (a === '' || a == null) - (b === '' || b == null);
const SORTS = {
  rating: (a, b) => (a.rating == null) - (b.rating == null) || (b.rating ?? 0) - (a.rating ?? 0) || b.addedAt - a.addedAt,
  newest: (a, b) => b.addedAt - a.addedAt || byName(a, b),
  nearest: (a, b) => (a.distance == null) - (b.distance == null) || (a.distance ?? 0) - (b.distance ?? 0) || byName(a, b),
  area: (a, b) => lastIfEmpty(a.area, b.area) || a.area.localeCompare(b.area) || byName(a, b),
  price: (a, b) => lastIfEmpty(a.price, b.price) || a.price.length - b.price.length || byName(a, b),
  cuisine: (a, b) => lastIfEmpty(a.cuisine, b.cuisine) || a.cuisine.localeCompare(b.cuisine) || byName(a, b),
};

function foodResults() {
  return applySearch(applyFilters(state.places, state.f), state.q).sort(SORTS[state.sort] || SORTS.rating);
}

// ---------- Filter definitions ----------

function moodOptions() {
  const extra = uniq(state.places.flatMap((p) => p.tags)).filter((t) => !TAGS.includes(t));
  return [...TAGS, ...extra];
}

function filterDefs(scope) {
  if (scope === 'dunno') {
    return [
      { key: 'cuisine', label: 'Cuisine', opts: uniq(state.places.map((p) => p.cuisine)) },
      { key: 'price', label: 'Price', opts: PRICES },
      { key: 'distance', label: 'Distance', opts: ['Under 3 mi', 'Under 5 mi'] },
      { key: 'mood', label: 'Mood', opts: moodOptions() },
      { key: 'status', label: 'Status', opts: STATUSES },
      { key: 'rating', label: 'Rating', opts: ['4.0+', '4.5+'] },
    ];
  }
  // Area options narrow to the chosen regions.
  const inRegion = state.f.region.length ? state.places.filter((p) => state.f.region.includes(p.region)) : state.places;
  const defs = [
    { key: 'region', label: 'Region', opts: REGIONS.filter((r) => state.places.some((p) => p.region === r)) },
    { key: 'area', label: 'Area', opts: uniq(inRegion.map((p) => p.area)) },
    { key: 'cuisine', label: 'Cuisine', opts: uniq(state.places.map((p) => p.cuisine)) },
    { key: 'price', label: 'Price', opts: PRICES },
    { key: 'status', label: 'Status', opts: STATUSES },
    { key: 'hours', label: 'Hours', opts: ['Open now', 'Closed now'] },
  ];
  return scope === 'map' ? defs.slice(0, 3) : defs;
}

const filtersFor = (scope) => (scope === 'dunno' ? state.d : state.f);

function filterLabel(def, sel) {
  if (!sel.length) return def.label;
  if (sel.length === 1) return sel[0];
  return `${def.label} · ${sel.length}`;
}

function renderFilters(scope) {
  const el = $(`#${scope}-filters`);
  const prevPanel = el.querySelector('.panel');
  const panelScroll = prevPanel ? prevPanel.scrollTop : 0;
  const values = filtersFor(scope);
  const html = filterDefs(scope).map((def, i) => {
    const id = `${scope}:${def.key}`;
    const sel = values[def.key];
    const open = state.open === id;
    let panel = '';
    if (open) {
      const opts = def.opts.length
        ? def.opts.map((o, k) => {
          const on = sel.includes(o);
          return `<button class="opt${on ? ' on' : ''}" role="option" aria-selected="${on}" data-opt="${id}" data-i="${k}"><span class="check">${I.check}</span>${esc(o)}</button>`;
        }).join('')
        : `<div class="opt" style="color:var(--sub);cursor:default">Nothing yet</div>`;
      panel = `<div class="panel${i % 3 === 2 ? ' right' : ''}" role="listbox" aria-multiselectable="true" aria-label="${def.label}">
        ${sel.length ? `<button class="panel-clear" data-clear="${id}">Clear</button>` : ''}${opts}</div>`;
    }
    return `<div class="filter">
      <button class="filter-btn${sel.length ? ' on' : ''}" data-dd="${id}" aria-haspopup="listbox" aria-expanded="${open}">
        <span class="label">${esc(filterLabel(def, sel))}</span><span class="chev">${I.chev}</span>
      </button>${panel}</div>`;
  });
  el.innerHTML = html.join('');
  const panel = el.querySelector('.panel');
  if (panel) panel.scrollTop = panelScroll;
}

function closeDropdown() {
  if (!state.open) return;
  const scope = state.open.split(':')[0];
  state.open = null;
  $('#backdrop').hidden = true;
  renderFilters(scope);
}

function onFiltersChanged(scope) {
  if (scope === 'dunno') {
    if (state.d.distance.length) { ensureLocation(); fillCoords(); }
    if (state.spin.phase === 'result' || state.spin.phase === 'miss') state.spin = { phase: 'idle' };
    renderFilters('dunno');
    renderStage();
  } else {
    userMovedMap = false;
    if (state.f.region.length) {
      // Drop areas that no longer belong to a selected region.
      const ok = new Set(state.places.filter((p) => state.f.region.includes(p.region)).map((p) => p.area));
      state.f.area = state.f.area.filter((a) => ok.has(a));
    }
    renderFilters('food');
    renderFilters('map');
    renderFood();
    renderMap();
  }
}

// ---------- Header & tabs ----------

const TABS = [
  { id: 'food', label: 'Food', icon: 'food', sub: 'Hungry?' },
  { id: 'map', label: 'Map', icon: 'pin', sub: 'Where to' },
  { id: 'dunno', label: 'Dunno', icon: 'shuffle', sub: 'Let Fatty decide' },
  { id: 'happy', label: 'Happy Hr', icon: 'martini', sub: 'After work' },
];

function renderTabs() {
  $('#tabbar').innerHTML = TABS.map((t) =>
    `<button class="tab${state.tab === t.id ? ' on' : ''}" data-tab="${t.id}" aria-current="${state.tab === t.id ? 'page' : 'false'}">${I[t.icon]}<span>${t.label}</span></button>`).join('');
  $('#subtitle').textContent = TABS.find((t) => t.id === state.tab).sub;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.tab !== state.tab; });
}

function setTab(tab) {
  if (tab === state.tab) return;
  closeDropdown();
  state.tab = tab;
  renderTabs();
  if (tab === 'map') showMap();
}

function renderTheme() {
  document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
  const b = $('#btn-theme');
  b.innerHTML = state.dark ? I.sun : I.moon;
  b.setAttribute('aria-label', state.dark ? 'Switch to light mode' : 'Switch to dark mode');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.content = state.dark ? '#1B1D18' : '#F7F4EC'; });
  if (map) setTiles();
}

// ---------- Food ----------

function rateButton(p, extra = '') {
  const label = p.rating != null ? `${I.pencil}<span>Edit rating and note</span>` : `${I.star}<span>Been here? Rate it</span>`;
  return `<button class="btn btn-rate" data-edit-place="${p.id}" ${extra}>${label}</button>`;
}

function placeCard(p) {
  const open = state.expanded === p.id;
  const right = p.rating != null ? badge(p.rating) : `<span class="bookmark" aria-label="Want to try">${I.bookmark}</span>`;
  const photo = p.photo
    ? `<div class="photo" style="background-image:url('${esc(p.photo).replace(/'/g, '%27')}')"></div>`
    : `<div class="photo">${I.food}</div>`;
  return `<article class="card${open ? ' open' : ''}" data-id="${p.id}">
    <div class="card-head" data-toggle="${p.id}" role="button" tabindex="0" aria-expanded="${open}">
      ${photo}
      <div class="card-main">
        <div class="card-top"><h3 class="name">${esc(p.name)}</h3>${right}</div>
        ${meta(p) ? `<div class="meta">${esc(meta(p))}</div>` : ''}
        ${p.tags.length ? `<div class="chips">${p.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="collapse"><div><div class="card-more">
      ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
      ${facts(p) ? `<div class="facts">${esc(facts(p))}</div>` : ''}
      <div class="btn-row">${linkBtn(mapsUrl(p), 'btn-accent', 'Open in Maps')}${linkBtn(p.link, 'btn-soft', 'View reel')}</div>
      ${rateButton(p)}
    </div></div></div>
  </article>`;
}

function statsCard() {
  const rated = state.places.filter((p) => p.rating != null);
  const avg = rated.length ? rated.reduce((s, p) => s + p.rating, 0) / rated.length : null;
  const areas = {};
  for (const p of rated) {
    if (!p.area) continue;
    const a = (areas[p.area] ||= { n: 0, sum: 0 });
    a.n++;
    a.sum += p.rating;
  }
  const top = Object.entries(areas).sort(([, a], [, b]) => b.n - a.n || b.sum / b.n - a.sum / a.n)[0];
  const avgText = avg == null ? '–' : avg.toFixed(1);
  return `<section class="stats${state.statsOpen ? ' open' : ''}">
    <button class="stats-head" data-stats aria-expanded="${state.statsOpen}">
      <span><b>Your stats</b><span class="muted"> · avg ${avgText}</span></span><span class="chev">${I.chev}</span>
    </button>
    <div class="collapse"><div><div class="stats-tiles">
      <div class="tile"><div class="tile-label">Avg score</div><div class="tile-val">${avgText}</div></div>
      <div class="tile"><div class="tile-label">Top area</div><div class="tile-val sm">${esc(top ? top[0] : '–')}</div></div>
      <div class="tile"><div class="tile-label">Visited / to try</div><div class="tile-val">${rated.length} / ${state.places.length - rated.length}</div></div>
    </div></div></div>
  </section>`;
}

function emptyState() {
  return `<div class="empty-state">
    <div class="empty-tile">${I.food}</div>
    <h2 class="empty-title">Nothing saved yet</h2>
    <p class="empty-body">Share an Instagram post or a map pin to the Fatty shortcut and it shows up here.</p>
    <button class="btn btn-accent" data-open-sheet="setup">Set up share sheet</button>
  </div>`;
}

function skeleton() {
  const one = `<div class="card skel"><div class="card-head" style="cursor:default"><div class="photo"></div>
    <div class="card-main"><div class="skel-line" style="width:60%;height:16px;margin-top:6px"></div><div class="skel-line" style="width:80%"></div><div class="skel-line" style="width:40%"></div></div></div></div>`;
  return one.repeat(4);
}

function errorCard() {
  return `<div class="error-card" role="alert">
    <div class="err-title">Couldn't load your sheet</div>
    <div class="err-body">${esc(state.error)}</div>
    <button class="btn btn-accent" data-retry>Try again</button>
  </div>`;
}

const hasData = () => state.places.length > 0;

function renderFood() {
  const el = $('#food-list');
  const noData = state.status === 'ready' && !hasData();
  $('#view-food .search-row').hidden = noData;
  $('#food-filters').hidden = noData;
  if (noData) { el.innerHTML = emptyState(); return; }
  if (!hasData()) {
    el.innerHTML = state.status === 'error' ? errorCard() : skeleton();
    return;
  }
  const list = foodResults();
  if (state.expanded && !list.some((p) => p.id === state.expanded)) state.expanded = null;
  const active = state.q.trim() || Object.values(state.f).some((v) => v.length);
  const results = `<div class="results-row"><span>${list.length} ${list.length === 1 ? 'spot' : 'spots'}</span>
    ${active ? '<button class="clear-all" data-clear-all>Clear all</button>' : ''}</div>`;
  el.innerHTML = (state.status === 'error' ? errorCard() : '') + statsCard() + results +
    (list.length ? list.map(placeCard).join('') : `<div class="list-empty">No spots match these filters.</div>`);
}

function toggleCard(id) {
  const list = $('#food-list');
  const prev = state.expanded && list.querySelector(`.card[data-id="${state.expanded}"]`);
  if (prev) {
    prev.classList.remove('open');
    prev.querySelector('.card-head').setAttribute('aria-expanded', 'false');
  }
  state.expanded = state.expanded === id ? null : id;
  if (state.expanded) {
    const card = list.querySelector(`.card[data-id="${id}"]`);
    card.classList.add('open');
    card.querySelector('.card-head').setAttribute('aria-expanded', 'true');
  }
}

// ---------- Map ----------

let map = null;
let tiles = null;
let markers = null;
let lastFitKey = '';
let userMovedMap = false; // stop auto-fitting once you pan the map yourself

// OpenStreetMap's standard tiles need no API key. CSS tints them to match the theme.
function setTiles() {
  if (tiles) return;
  tiles = window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
}

function showMap() {
  if (!window.L) {
    // Leaflet loads with `defer`; try again shortly if it isn't ready yet.
    setTimeout(() => state.tab === 'map' && showMap(), 150);
    return;
  }
  if (!map) {
    map = window.L.map('map', { zoomControl: false, attributionControl: false }).setView([34.05, -118.3], 11);
    window.L.control.attribution({ position: 'topright', prefix: false }).addTo(map);
    setTiles();
    markers = window.L.layerGroup().addTo(map);
    map.on('dragstart', () => { userMovedMap = true; });
  }
  map.invalidateSize();
  renderMap();
  fillCoords();
}

function mapResults() {
  return applySearch(applyFilters(state.places, state.f), state.q).sort(SORTS.rating);
}

function pinHtml(p, sel) {
  const rated = p.rating != null;
  return `<div class="pin${rated ? '' : ' unrated'}${sel ? ' sel' : ''}" style="${rated ? `background:${ratingColor(p.rating)}` : ''}" role="button" aria-label="${esc(p.name)}">${rated ? fmtRating(p.rating) : I.bookmark}</div>`;
}

function renderMap() {
  const list = mapResults();
  const located = list.filter((p) => p.lat != null && p.lng != null);
  if (!list.some((p) => p.id === state.mapSel)) state.mapSel = (located[0] || list[0])?.id ?? null;
  const sel = list.find((p) => p.id === state.mapSel);

  const empty = $('#map-empty');
  if (!hasData()) {
    empty.hidden = false;
    empty.textContent = state.cfg.sheet ? (state.status === 'error' ? state.error : 'Loading your spots…') : 'Connect your sheet to see your spots here.';
  } else if (!list.length) {
    empty.hidden = false;
    empty.textContent = 'No spots match these filters.';
  } else if (!located.length) {
    empty.hidden = false;
    empty.textContent = 'None of these spots have a location yet. Add Lat and Lng or a Map link in the sheet.';
  } else {
    empty.hidden = true;
  }

  const card = $('#map-card');
  if (sel) {
    card.hidden = false;
    card.innerHTML = `<div class="map-card-top"><div style="flex:1;min-width:0">
        <h3 class="map-card-name">${esc(sel.name)}</h3>${meta(sel) ? `<div class="meta">${esc(meta(sel))}</div>` : ''}
      </div>${sel.rating != null ? badge(sel.rating) : `<span class="bookmark" aria-label="Want to try">${I.bookmark}</span>`}</div>
      <div class="btn-row">${linkBtn(mapsUrl(sel), 'btn-accent', 'Open in Maps')}${linkBtn(sel.link, 'btn-soft', 'View reel')}
        <button class="btn btn-soft btn-icon" data-edit-place="${sel.id}" aria-label="${sel.rating != null ? 'Edit rating' : 'Rate it'}">${sel.rating != null ? I.pencil : I.star}</button></div>`;
  } else {
    card.hidden = true;
  }

  if (!map) return;
  markers.clearLayers();
  for (const p of located) {
    const isSel = p.id === state.mapSel;
    const m = window.L.marker([p.lat, p.lng], {
      icon: window.L.divIcon({ className: 'pin-wrap', html: pinHtml(p, isSel), iconSize: [0, 0] }),
      zIndexOffset: isSel ? 1000 : Math.round((p.rating ?? 0) * 10),
      keyboard: false,
    });
    m.on('click', () => { state.mapSel = p.id; renderMap(); });
    markers.addLayer(m);
  }
  const fitKey = located.map((p) => p.id).join(',');
  // Fitting a hidden map measures a 0×0 box, so wait until the Map tab is visible.
  if (fitKey && fitKey !== lastFitKey && state.tab === 'map' && !userMovedMap) {
    lastFitKey = fitKey;
    const bounds = window.L.latLngBounds(located.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { paddingTopLeft: [40, 40], paddingBottomRight: [40, 160], maxZoom: 15, animate: false });
  }
}

// ---------- Dunno ----------

const RESULT_LINES = ["Since you can't decide, we're eating at", 'Decision made. No appeals.', "Fine, I'll choose. Tonight it's"];
let spinTimer = null;

function renderStage() {
  const el = $('#stage');
  const s = state.spin;
  el.classList.toggle('spinning', s.phase === 'spinning');
  el.classList.toggle('result', s.phase === 'result');
  el.setAttribute('aria-busy', String(s.phase === 'spinning'));

  if (s.phase === 'idle') {
    el.innerHTML = `<div class="eyebrow">Feeling stuck?</div>
      <h2 class="headline">Too many options. Zero opinions.</h2>
      <span class="stage-pill">Tap, I'll decide</span>
      <div class="hint">Set filters above first, or spin them all.</div>`;
  } else if (s.phase === 'miss') {
    el.innerHTML = `<h2 class="miss-title">Your filters are pickier than you.</h2>
      <div class="miss-body">${hasData() ? 'Nothing matches all of that. Loosen one up, then tap.' : 'Nothing saved yet. Connect your sheet first, then tap.'}</div>`;
  } else if (s.phase === 'spinning') {
    el.innerHTML = `<div class="small">Thinking…</div>
      <div class="reel-side" data-reel="prev"></div>
      <div class="reel-main spin-cur" data-reel="cur"></div>
      <div class="reel-side" data-reel="next"></div>`;
    updateReel();
  } else {
    const p = s.winner;
    const f = [p.distance != null ? `${p.distance.toFixed(1)} mi` : '', p.openNow === true ? 'Open now' : p.openNow === false ? 'Closed' : '']
      .filter(Boolean).join(' · ');
    el.innerHTML = `<div class="small" style="opacity:.75">${RESULT_LINES[hash(p.id) % RESULT_LINES.length]}</div>
      <div class="reel-side">${esc(s.prev)}</div>
      <div class="reel-main">${esc(p.name)}</div>
      ${p.rating != null || meta(p) ? `<div class="result-line">${p.rating != null ? badge(p.rating) : ''}<span class="meta">${esc(meta(p))}</span></div>` : ''}
      ${p.note ? `<p class="result-note">${esc(p.note)}</p>` : ''}
      ${f ? `<div class="result-facts">${esc(f)}</div>` : ''}
      <div class="btn-row">${linkBtn(mapsUrl(p), 'btn-cream', 'Take me there', 'data-stop')}${linkBtn(p.link, 'btn-outline', 'View reel', 'data-stop')}
        <button class="btn btn-outline btn-icon" data-stop data-edit-place="${p.id}" aria-label="${p.rating != null ? 'Edit rating' : 'Rate it'}">${p.rating != null ? I.pencil : I.star}</button></div>
      <div class="footer-hint">Tap anywhere to spin again</div>`;
  }
}

function updateReel() {
  const { seq, k } = state.spin;
  const el = $('#stage');
  el.querySelector('[data-reel="prev"]').textContent = seq[k - 1]?.name ?? '';
  el.querySelector('[data-reel="cur"]').textContent = seq[k].name;
  el.querySelector('[data-reel="next"]').textContent = seq[k + 1]?.name ?? '';
}

function spin() {
  if (state.spin.phase === 'spinning') return;
  closeDropdown();
  const pool = applyFilters(state.places, state.d);
  if (!pool.length) {
    state.spin = { phase: 'miss' };
    renderStage();
    return;
  }
  const winner = pool[Math.floor(Math.random() * pool.length)];
  const src = pool.length <= 2 && state.places.length > pool.length ? state.places : pool;
  const seq = [];
  for (let i = 0; i < 26; i++) {
    let pick;
    let tries = 0;
    do { pick = src[Math.floor(Math.random() * src.length)]; } while (src.length > 1 && pick === seq[i - 1] && ++tries < 10);
    seq.push(pick);
  }
  seq[24] = winner;
  // Avoid the winner flashing right before or after landing when there's an alternative.
  const others = src.filter((p) => p !== winner);
  if (others.length) {
    if (seq[23] === winner) seq[23] = others[Math.floor(Math.random() * others.length)];
    if (seq[25] === winner) seq[25] = others[Math.floor(Math.random() * others.length)];
  }
  state.spin = { phase: 'spinning', seq, k: 0, winner };
  renderStage();

  const step = () => {
    const k = state.spin.k;
    if (k >= 24) {
      spinTimer = setTimeout(() => {
        state.spin = { phase: 'result', winner, prev: seq[23].name };
        renderStage();
      }, 260);
      return;
    }
    spinTimer = setTimeout(() => {
      state.spin.k = k + 1;
      updateReel();
      step();
    }, 55 + Math.pow(k / 24, 3) * 420);
  };
  step();
}

// ---------- Bottom sheets ----------

function nextMonday(now = new Date()) {
  const d = new Date(now);
  const add = (8 - d.getDay()) % 7 || (d.getHours() < 3 ? 0 : 7);
  d.setDate(d.getDate() + add);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
}

const LINKS = {
  sheet: { label: 'Google Sheet', hint: 'Paste your sheet link', valid: isSheetLink, err: 'That does not look like a Google Sheets link.' },
  folder: { label: 'Drive backup folder', hint: 'Paste your Drive folder link', valid: isFolderLink, err: 'Use the folder share link (drive.google.com/…/folders/…).' },
};

function linkCard(kind) {
  const def = LINKS[kind];
  const val = state.cfg[kind];
  const editing = state.ui.editing[kind] || !val;
  let body;
  if (editing) {
    const draft = state.ui.editing[kind] ? (state.ui.draft?.[kind] ?? val) : (state.ui.draft?.[kind] ?? '');
    const ok = def.valid(draft.trim());
    body = `<input class="field" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="${def.hint}" value="${esc(draft)}" data-field="${kind}" aria-label="${def.label} link">
      <div class="field-err" data-err="${kind}" ${state.ui.err[kind] ? '' : 'hidden'}>${esc(state.ui.err[kind])}</div>
      <div class="btn-row">
        <button class="btn btn-grow ${ok ? 'btn-accent' : 'btn-soft disabled'}" data-save="${kind}">Save and lock</button>
        ${val ? `<button class="btn btn-soft" data-cancel="${kind}">Cancel</button>` : ''}
      </div>`;
  } else {
    const confirm = state.ui.confirm[kind];
    body = `<div class="locked">${I.lock}<span>${esc(val)}</span></div>
      <div class="btn-row">
        <a class="btn btn-soft" href="${esc(val)}" target="_blank" rel="noopener">Open</a>
        <button class="btn btn-soft" data-edit="${kind}">Edit</button>
        <button class="btn ${confirm ? 'btn-danger' : 'btn-soft'}" data-delete="${kind}">${confirm ? 'Tap to confirm' : 'Delete'}</button>
      </div>`;
  }
  return `<div class="sheet-card"><div class="sheet-label">${def.label}</div>${body}</div>`;
}

function dataSheet() {
  const hasFolder = !!state.cfg.folder;
  const copied = state.ui.copied === 'backup';
  return `<h2 class="sheet-title" id="sheet-title">Data and backup</h2>
    <p class="sheet-lead">Your spots live in Google Drive. Fatty only remembers the links, on this device.</p>
    ${linkCard('sheet')}
    ${linkCard('folder')}
    <div class="sheet-card">
      <div class="sheet-label">Your ratings on this phone</div>
      <p class="sheet-text">${Object.keys(edits).length ? `${Object.keys(edits).length} spots rated or edited here.` : 'Scores and notes you add in the app are saved here.'} Copy them to paste into your sheet or keep a backup.</p>
      <button class="btn ${Object.keys(edits).length ? 'btn-accent' : 'btn-soft disabled'}" style="width:100%" data-copy="ratings">${state.ui.copied === 'ratings' ? 'Copied' : 'Copy my ratings'}</button>
    </div>
    <div class="sheet-card">
      <div class="sheet-label">Weekly backup</div>
      <div class="next-run">Next: ${nextMonday()}</div>
      <p class="sheet-text">Every Monday at 3am a copy of your sheet goes into the backup folder. Two copies are kept, so a bad week never wipes your list.</p>
      <div class="file-row"><div class="file-ico">${I.file}</div><div><div class="file-name">Fatty backup (latest)</div><div class="file-sub">Replaced each Monday</div></div></div>
      <div class="file-row"><div class="file-ico">${I.file}</div><div><div class="file-name">Fatty backup (previous)</div><div class="file-sub">Last week's copy</div></div></div>
      <button class="btn ${hasFolder ? 'btn-accent' : 'btn-soft disabled'}" style="width:100%" data-copy="backup" ${hasFolder ? '' : 'aria-disabled="true"'}>
        ${hasFolder ? (copied ? 'Copied' : 'Copy backup script') : 'Add the folder link first'}</button>
      <p class="sheet-text" style="margin:12px 0 0">Paste it in the sheet under Extensions, Apps Script. Run setup once and it repeats every Monday on its own.</p>
    </div>
    <button class="btn btn-accent done" data-close-sheet>Done</button>`;
}

function setupSheet() {
  const copied = state.ui.copied === 'endpoint';
  const steps = [
    ['Make the sheet', 'Columns Link, Score, Note, Date are filled by the shortcut. Name, Area, Cuisine, Price, Hours and Map link stay blank.'],
    ['Add a web endpoint', 'Extensions, Apps Script: deploy a web app that appends one row per request.'],
    ['Build the shortcut', 'Receive URLs from Share Sheet, Ask for Input (score), Ask for Input (note, optional), Get Contents of URL with a POST. Two taps per save.'],
    ['Fill in the rest later', 'Ask Fatty to look up the blank columns for new rows and update the sheet. The app reads whatever is there.'],
  ];
  return `<h2 class="sheet-title" id="sheet-title">Share sheet setup</h2>
    <p class="sheet-lead">Save a spot from Instagram or Maps in two taps.</p>
    <ol class="steps">${steps.map(([t, b], i) => `<li class="step"><span class="step-num">${i + 1}</span><div>
      <div class="step-title">${t}</div><div class="step-body">${b}</div>
      ${i === 1 ? `<button class="btn btn-soft" style="margin-top:10px;min-height:40px;padding:9px 16px;font-size:13px" data-copy="endpoint">${copied ? 'Copied' : 'Copy endpoint script'}</button>` : ''}
    </div></li>`).join('')}</ol>
    <button class="btn btn-accent done" data-close-sheet>Done</button>`;
}

const EDIT_TAGS = ['Date night', 'Cheap eats', 'Group friendly', 'Outdoor seating', 'Late night', 'Brunch', 'Solo',
  'Food truck', 'Work friendly', 'Dog friendly', 'Cocktails', 'Michelin', 'New'];

function rateDisplay(r) {
  return r == null
    ? { text: '–', style: 'background:var(--soft);color:var(--sub)' }
    : { text: fmtRating(r), style: `background:${ratingColor(r)}` };
}

function editSheet() {
  const p = state.places.find((x) => x.id === state.editing.id);
  const d = state.editing;
  if (!p) return '';
  const rd = rateDisplay(d.rating);
  const tags = [...new Set([...EDIT_TAGS, ...d.tags])];
  return `<h2 class="sheet-title" id="sheet-title">${esc(p.name)}</h2>
    <p class="sheet-lead">${esc(meta(p) || 'Austin')}</p>
    <div class="sheet-card">
      <div class="sheet-label">Your score</div>
      <div class="rate-row">
        <button class="step" data-rate-step="-0.1" aria-label="Lower score">−</button>
        <span class="badge rate-big" data-rate-badge style="${rd.style}">${rd.text}</span>
        <button class="step" data-rate-step="0.1" aria-label="Raise score">+</button>
      </div>
      <input class="range" type="range" min="0" max="5" step="0.1" value="${d.rating ?? 4}" data-rate-range aria-label="Score from 0 to 5">
      <div class="rate-hint" data-rate-hint>${d.rating == null ? 'Slide or tap + to score it. Saving a score marks it visited.' : 'Saving keeps it in your visited list.'}</div>
      ${d.rating != null ? '<button class="panel-clear" style="padding-left:0" data-rate-clear>Clear score (back to want to try)</button>' : ''}
    </div>
    <div class="sheet-card">
      <div class="sheet-label">Note</div>
      <textarea class="field note-field" rows="3" placeholder="What did you order? Would you go back?" data-edit-note>${esc(d.note)}</textarea>
    </div>
    <div class="sheet-card">
      <div class="sheet-label">Price</div>
      <div class="chip-pick">${['$', '$$', '$$$', '$$$$'].map((v) => `<button class="pick${d.price === v ? ' on' : ''}" data-edit-price="${v}">${v}</button>`).join('')}</div>
    </div>
    <div class="sheet-card">
      <div class="sheet-label">Tags</div>
      <div class="chip-pick">${tags.map((t) => `<button class="pick${d.tags.includes(t) ? ' on' : ''}" data-edit-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    </div>
    <div class="btn-row">
      <button class="btn btn-accent btn-grow" data-edit-save>Save</button>
      <button class="btn btn-soft" data-close-sheet>Cancel</button>
    </div>
    <p class="sheet-text" style="margin:12px 0 0;text-align:center">Saved on this phone. Copy them anytime from the cloud button.</p>`;
}

function openEdit(id) {
  const p = state.places.find((x) => x.id === id);
  if (!p) return;
  state.editing = { id, rating: p.rating, note: p.note || '', price: p.price || '', tags: p.tags.slice() };
  openSheet('edit');
}

function updateRateUI() {
  const d = state.editing;
  const rd = rateDisplay(d.rating);
  const b = $('[data-rate-badge]');
  b.textContent = rd.text;
  b.setAttribute('style', rd.style);
  if (d.rating != null) $('[data-rate-range]').value = d.rating;
  $('[data-rate-hint]').textContent = d.rating == null
    ? 'Slide or tap + to score it. Saving a score marks it visited.'
    : 'Saving a score marks it visited.';
}

function saveEditing() {
  const d = state.editing;
  const p = state.places.find((x) => x.id === d.id);
  if (!p) return closeSheet();
  const wasNew = p.rating == null;
  saveEdit(p, { rating: d.rating, note: d.note.trim(), price: d.price, tags: d.tags });
  if (state.source === 'sheet') writeJSON(DATA_KEY, { sheet: state.cfg.sheet, places: state.places, at: state.fetchedAt });
  closeSheet();
  renderData();
  if (state.spin.phase === 'result' && state.spin.winner.id === p.id) renderStage();
  toast(d.rating != null && wasNew ? `Marked visited · ${fmtRating(d.rating)}` : 'Saved');
}

function ratingsCsv() {
  const rows = [['Name', 'Score', 'Note', 'Price', 'Tags']];
  for (const p of state.places) {
    if (edits[editKey(p)]) rows.push([p.name, p.rating ?? '', p.note, p.price, p.tags.join(', ')]);
  }
  return rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n');
}

function openSheet(which) {
  closeDropdown();
  state.sheet = which;
  state.ui = { editing: { sheet: false, folder: false }, confirm: { sheet: false, folder: false }, err: { sheet: '', folder: '' }, copied: '', draft: {} };
  $('#sheet-root').innerHTML = `<div class="scrim" data-scrim><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="grabber"></div><div class="sheet-body"></div></div></div>`;
  renderSheet();
}

function renderSheet() {
  const body = $('#sheet-root .sheet-body');
  if (!body) return;
  body.innerHTML = state.sheet === 'data' ? dataSheet() : state.sheet === 'edit' ? editSheet() : setupSheet();
}

function closeSheet() {
  const scrim = $('#sheet-root .scrim');
  if (!scrim) return;
  state.sheet = null;
  scrim.classList.add('closing');
  setTimeout(() => scrim.remove(), 220);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function saveLink(kind) {
  const input = $(`[data-field="${kind}"]`);
  const val = (input?.value || '').trim();
  if (!LINKS[kind].valid(val)) {
    state.ui.err[kind] = val ? LINKS[kind].err : '';
    renderSheet();
    return;
  }
  const changed = state.cfg[kind] !== val;
  state.cfg[kind] = val;
  state.ui.editing[kind] = false;
  state.ui.err[kind] = '';
  delete state.ui.draft[kind];
  persist();
  renderSheet();
  if (kind === 'sheet' && changed) {
    state.places = [];
    state.expanded = null;
    writeJSON(DATA_KEY, null);
    refresh();
  }
}

function deleteLink(kind) {
  if (!state.ui.confirm[kind]) {
    state.ui.confirm[kind] = true;
    renderSheet();
    return;
  }
  state.cfg[kind] = '';
  state.ui.confirm[kind] = false;
  state.ui.draft[kind] = '';
  persist();
  renderSheet();
  if (kind === 'sheet') {
    state.places = [];
    state.status = 'loading';
    writeJSON(DATA_KEY, null);
    refresh();
  }
}

// ---------- Data loading ----------

function renderData() {
  renderFilters('food');
  renderFilters('map');
  renderFilters('dunno');
  renderFood();
  renderMap();
}

let loadSeq = 0;
function placesLoaded(places, source) {
  state.places = places;
  state.source = source;
  state.status = 'ready';
  state.error = '';
  state.fetchedAt = Date.now();
  applyEdits(places);
  applyCachedCoords(places);
  applyDistances();
}

let geoRender = 0;
// Looks up coordinates for spots that only have an address (map tab or distance features).
function renderGeoProgress() {
  const el = $('#map-progress');
  const { active, done, total } = geoProgress;
  el.hidden = !active;
  if (active) el.textContent = `Placing pins · ${done} of ${total}`;
}

function fillCoords() {
  geocodeMissing(state.places, () => {
    renderGeoProgress();
    clearTimeout(geoRender);
    geoRender = setTimeout(() => {
      applyDistances();
      if (state.tab === 'map') renderMap();
      if (state.tab === 'food' && state.sort === 'nearest') renderFood();
    }, 600);
  });
  renderGeoProgress();
}

async function refresh() {
  const seq = ++loadSeq;
  if (!state.cfg.sheet) {
    // No sheet yet: show the list that ships with the app.
    try {
      const places = await loadBundled();
      if (seq !== loadSeq) return;
      placesLoaded(places, 'bundle');
      fillCoords();
    } catch {
      if (seq !== loadSeq) return;
      placesLoaded([], 'none');
    }
    renderData();
    return;
  }
  const sheetAtStart = state.cfg.sheet;
  state.status = 'loading';
  if (!hasData()) renderData();
  try {
    const places = await loadPlaces(sheetAtStart);
    if (seq !== loadSeq) return;
    placesLoaded(places, 'sheet');
    fillCoords();
    writeJSON(DATA_KEY, { sheet: sheetAtStart, places, at: state.fetchedAt });
  } catch (err) {
    if (seq !== loadSeq) return;
    state.status = 'error';
    state.error = errorText(err);
  }
  renderData();
}

function restoreCache() {
  const cache = readJSON(DATA_KEY);
  if (cache && cache.sheet === state.cfg.sheet && Array.isArray(cache.places)) {
    // Recompute "days ago" from the stored timestamp so cached data stays accurate.
    const now = Date.now();
    state.places = cache.places.map((p) => ({
      ...p,
      addedDaysAgo: p.addedAt ? Math.max(0, Math.floor((now - p.addedAt) / 86400000)) : p.addedDaysAgo,
    }));
    state.status = 'ready';
    state.source = 'sheet';
    applyEdits(state.places);
    applyCachedCoords(state.places);
  }
}

// ---------- Events ----------

function onClick(e) {
  const t = e.target;
  const q = (sel) => t.closest(sel);
  let el;

  if (q('#backdrop')) return closeDropdown();

  if ((el = q('[data-dd]'))) {
    const id = el.dataset.dd;
    const scope = id.split(':')[0];
    const prevScope = state.open && state.open.split(':')[0];
    state.open = state.open === id ? null : id;
    $('#backdrop').hidden = !state.open;
    if (prevScope && prevScope !== scope) renderFilters(prevScope);
    renderFilters(scope);
    return;
  }
  if ((el = q('[data-opt]'))) {
    const [scope, key] = el.dataset.opt.split(':');
    const def = filterDefs(scope).find((d) => d.key === key);
    const val = def.opts[+el.dataset.i];
    const arr = filtersFor(scope)[key];
    const at = arr.indexOf(val);
    if (at >= 0) arr.splice(at, 1); else arr.push(val);
    return onFiltersChanged(scope);
  }
  if ((el = q('[data-clear]'))) {
    const [scope, key] = el.dataset.clear.split(':');
    filtersFor(scope)[key] = [];
    return onFiltersChanged(scope);
  }
  if (q('[data-clear-all]')) {
    state.f = emptyFood();
    state.q = '';
    $('#food-search').value = '';
    $('#map-search').value = '';
    return onFiltersChanged('food');
  }

  if ((el = q('[data-tab]')) && el.classList.contains('tab')) return setTab(el.dataset.tab);
  if ((el = q('[data-toggle]')) && !q('a, button')) return toggleCard(el.dataset.toggle);
  if (q('[data-stats]')) {
    state.statsOpen = !state.statsOpen;
    const s = $('#food-list .stats');
    s.classList.toggle('open', state.statsOpen);
    s.querySelector('.stats-head').setAttribute('aria-expanded', String(state.statsOpen));
    return;
  }
  if (q('[data-retry]')) return refresh();

  if ((el = q('[data-edit-place]'))) return openEdit(el.dataset.editPlace);

  if (q('#stage')) {
    if (q('[data-stop]')) return;
    return spin();
  }

  if (q('#btn-theme')) {
    state.dark = !state.dark;
    persist();
    return renderTheme();
  }
  if (q('#btn-data')) return openSheet('data');
  if (q('#btn-setup')) return openSheet('setup');
  if ((el = q('[data-open-sheet]'))) return openSheet(el.dataset.openSheet);

  // Sheets
  if (t.matches('[data-scrim]') || q('[data-close-sheet]')) return closeSheet();
  if ((el = q('[data-save]'))) return saveLink(el.dataset.save);
  if (state.sheet === 'edit') {
    const d = state.editing;
    if ((el = q('[data-rate-step]'))) {
      const v = (d.rating ?? 4) + (d.rating == null ? 0 : +el.dataset.rateStep);
      d.rating = Math.round(Math.max(0, Math.min(5, v)) * 10) / 10;
      return updateRateUI();
    }
    if (q('[data-rate-clear]')) { d.rating = null; return renderSheet(); }
    if ((el = q('[data-edit-price]'))) {
      d.price = d.price === el.dataset.editPrice ? '' : el.dataset.editPrice;
      document.querySelectorAll('[data-edit-price]').forEach((b) => b.classList.toggle('on', b.dataset.editPrice === d.price));
      return;
    }
    if ((el = q('[data-edit-tag]'))) {
      const tag = el.dataset.editTag;
      d.tags = d.tags.includes(tag) ? d.tags.filter((x) => x !== tag) : [...d.tags, tag];
      el.classList.toggle('on', d.tags.includes(tag));
      return;
    }
    if (q('[data-edit-save]')) return saveEditing();
  }
  if ((el = q('[data-cancel]'))) {
    state.ui.editing[el.dataset.cancel] = false;
    state.ui.err[el.dataset.cancel] = '';
    delete state.ui.draft[el.dataset.cancel];
    return renderSheet();
  }
  if ((el = q('[data-edit]'))) {
    state.ui.editing[el.dataset.edit] = true;
    state.ui.confirm[el.dataset.edit] = false;
    renderSheet();
    const input = $(`[data-field="${el.dataset.edit}"]`);
    input?.focus();
    input?.select();
    return;
  }
  if ((el = q('[data-delete]'))) return deleteLink(el.dataset.delete);
  if ((el = q('[data-copy]'))) {
    const which = el.dataset.copy;
    if (which === 'backup' && !state.cfg.folder) return;
    if (which === 'ratings' && !Object.keys(edits).length) return;
    const text = which === 'backup' ? backupScript(folderId(state.cfg.folder))
      : which === 'ratings' ? ratingsCsv() : endpointScript();
    copyText(text).then((ok) => {
      if (!ok) return toast('Copy failed. Try again.');
      state.ui.copied = which;
      renderSheet();
      setTimeout(() => {
        if (state.ui.copied === which) { state.ui.copied = ''; renderSheet(); }
      }, 1800);
    });
    return;
  }

  // Any tap elsewhere resets a pending delete confirmation.
  if (state.sheet && (state.ui.confirm.sheet || state.ui.confirm.folder)) {
    state.ui.confirm = { sheet: false, folder: false };
    renderSheet();
  }
}

function onInput(e) {
  const t = e.target;
  if (t.id === 'food-search' || t.id === 'map-search') {
    state.q = t.value;
    const other = t.id === 'food-search' ? '#map-search' : '#food-search';
    $(other).value = t.value;
    renderFilters('food');
    renderFood();
    renderMap();
    return;
  }
  if (t.matches('[data-rate-range]')) {
    state.editing.rating = Math.round(+t.value * 10) / 10;
    return updateRateUI();
  }
  if (t.matches('[data-edit-note]')) {
    state.editing.note = t.value;
    return;
  }
  if (t.dataset.field) {
    const kind = t.dataset.field;
    state.ui.draft[kind] = t.value;
    const val = t.value.trim();
    const ok = LINKS[kind].valid(val);
    const btn = $(`[data-save="${kind}"]`);
    btn.className = `btn btn-grow ${ok ? 'btn-accent' : 'btn-soft disabled'}`;
    const err = $(`[data-err="${kind}"]`);
    const showErr = e.inputType === 'insertFromPaste' && val && !ok;
    state.ui.err[kind] = showErr ? LINKS[kind].err : '';
    err.hidden = !showErr;
    err.textContent = state.ui.err[kind];
  }
}

function onKey(e) {
  if (e.key === 'Escape') {
    if (state.open) return closeDropdown();
    if (state.sheet) return closeSheet();
  }
  const t = e.target;
  if ((e.key === 'Enter' || e.key === ' ') && (t.id === 'stage' || t.dataset.toggle)) {
    e.preventDefault();
    if (t.id === 'stage') spin(); else toggleCard(t.dataset.toggle);
  }
  if (e.key === 'Enter' && t.dataset.field) saveLink(t.dataset.field);
  if (e.key === 'Enter' && t.classList.contains('search')) t.blur();
}

// ---------- Boot ----------

function boot() {
  $('#btn-data').innerHTML = I.cloud;
  $('.sort-icon').innerHTML = I.sort;
  const sortSel = $('#sort');
  sortSel.value = state.sort;
  sortSel.addEventListener('change', () => {
    state.sort = sortSel.value;
    persist();
    if (state.sort === 'nearest') { ensureLocation(); fillCoords(); }
    renderFood();
  });

  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.fetchedAt > 60000) refresh();
  });
  window.addEventListener('resize', () => map && map.invalidateSize());

  renderTheme();
  renderTabs();
  restoreCache();
  renderData();
  renderStage();
  refresh();

  // Pick up location silently if the user already allowed it.
  navigator.permissions?.query({ name: 'geolocation' }).then((p) => {
    if (p.state === 'granted' || state.sort === 'nearest') ensureLocation({ quiet: true });
  }).catch(() => {});

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
    // When a new version takes over, reload once so you see it right away.
    if (navigator.serviceWorker.controller) {
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        location.reload();
      });
    }
  }
}

boot();
