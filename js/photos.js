// Your own photos for each spot, kept on this device in IndexedDB (localStorage is too
// small for ~150 pictures). Values are a resized JPEG data URL or an https image link.

const DB = 'fatty-photos';
const STORE = 'photos';
let dbPromise = null;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

// Loads every saved photo into a Map(key → src).
export async function loadPhotos() {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const map = new Map();
      const req = db.transaction(STORE).objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(map);
        map.set(c.key, c.value);
        c.continue();
      };
      req.onerror = () => resolve(map);
    });
  } catch {
    return new Map(); // private browsing or storage blocked: photos just won't persist
  }
}

export const savePhoto = (key, src) => tx('readwrite', (s) => s.put(src, key));
export const deletePhoto = (key) => tx('readwrite', (s) => s.delete(key));

// Shrinks a picked image to at most `max` px on its long side and returns a JPEG data URL.
export function resizeImage(file, max = 640) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image Fatty can read.')); };
    img.src = url;
  });
}
