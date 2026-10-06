// Google Places (New) photos. Your API key stays on this device (localStorage) and is
// only used to look photos up; the saved direct image links don't contain it.

const KEY_STORE = 'fatty.v1.gkey';
const AUSTIN = { latitude: 30.2672, longitude: -97.7431 };

export function getKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}
export function setKey(k) {
  try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch { /* blocked */ }
}
export const looksLikeKey = (k) => /^AIza[\w-]{30,}$/.test(k.trim());

// Hard monthly limit on Google requests made by this app, kept below Google's smallest
// free monthly allowance (1,000 calls) so normal use stays free. Filling ~150 spots
// takes about 300 (one search + one photo link each).
export const MONTHLY_CAP = 400;
const USAGE_STORE = 'fatty.v1.gusage';
const thisMonth = () => new Date().toISOString().slice(0, 7);

export function usage() {
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_STORE) || '{}');
    return u.month === thisMonth() ? u.n : 0;
  } catch { return 0; }
}
function count() {
  const n = usage() + 1;
  try { localStorage.setItem(USAGE_STORE, JSON.stringify({ month: thisMonth(), n })); } catch { /* blocked */ }
}
function guard() {
  if (usage() >= MONTHLY_CAP) {
    throw new Error(`Fatty's limit of ${MONTHLY_CAP} Google requests this month is reached. It resets on the 1st.`);
  }
}

// Saved values: "gphoto:<photo name>#<direct image link>". The direct link loads without
// the key and isn't billed per view; it is refreshed (one request) if it ever expires.
export function gphotoUrl(value) {
  const uri = value.split('#').slice(1).join('#');
  return /^https:\/\//.test(uri) ? uri : '';
}

async function mediaUri(name, key) {
  if (!/^places\/[\w-]+\/photos\/[\w-]+$/.test(name)) return '';
  guard();
  count();
  const res = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=480&skipHttpRedirect=true&key=${encodeURIComponent(key)}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(apiError(res.status, body));
  return body?.photoUri || '';
}

// Gets a fresh direct link for a saved Google photo (when the old one expired).
export async function refreshPhoto(value, key) {
  const name = value.slice('gphoto:'.length).split('#')[0];
  const uri = await mediaUri(name, key);
  return uri ? `gphoto:${name}#${uri}` : '';
}

function apiError(status, body) {
  const msg = body?.error?.message || '';
  if (status === 403 && /referer|referrer/i.test(msg)) return 'Google blocked the request: add this site to the key’s website restrictions.';
  if (status === 403 && /billing/i.test(msg)) return 'Google needs a billing account on the project before it returns photos.';
  if (status === 403 && /not been used|disabled|enable/i.test(msg)) return 'Turn on "Places API (New)" for your Google Cloud project.';
  if (status === 400 && /key/i.test(msg)) return 'Google says the API key is not valid.';
  if (status === 429) return 'Google’s quota is used up for now. Try again later.';
  return msg || `Google returned an error (${status}).`;
}

// Finds the top Google photo for a spot. Returns "gphoto:…" or '' when Google has none.
export async function findPhoto(p, key) {
  guard();
  count();
  const where = p.address || [p.area, 'Austin, TX'].filter(Boolean).join(', ');
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.photos',
    },
    body: JSON.stringify({
      textQuery: `${p.name}, ${where}`,
      pageSize: 1,
      locationBias: { circle: { center: AUSTIN, radius: 50000 } },
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(apiError(res.status, body));
  const photo = body?.places?.[0]?.photos?.[0]?.name;
  if (!photo) return '';
  const uri = await mediaUri(photo, key);
  return uri ? `gphoto:${photo}#${uri}` : '';
}
