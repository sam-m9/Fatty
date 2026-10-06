// Google Places (New) photos. Your API key stays on this device (localStorage).
// Saved photo values look like "gphoto:places/…/photos/…"; the image URL is built
// with the key when shown, so nothing private ends up in the app's code or data.

const KEY_STORE = 'fatty.v1.gkey';
const AUSTIN = { latitude: 30.2672, longitude: -97.7431 };

export function getKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}
export function setKey(k) {
  try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch { /* blocked */ }
}
export const looksLikeKey = (k) => /^AIza[\w-]{30,}$/.test(k.trim());

export function gphotoUrl(value, key, width = 480) {
  const name = value.slice('gphoto:'.length);
  if (!/^places\/[\w-]+\/photos\/[\w-]+$/.test(name) || !key) return '';
  return `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${width}&key=${encodeURIComponent(key)}`;
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
  return photo ? `gphoto:${photo}` : '';
}
