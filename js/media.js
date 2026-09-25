// Foto's en handtekeningen: opgeslagen in IndexedDB (localStorage is te klein voor afbeeldingen).
import { uid } from './store.js';

const DB = 'klantkaart-media';
const STORE = 'files';
const memory = new Map(); // noodopslag als IndexedDB niet beschikbaar is (privévenster)
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function putBlob(blob, id = uid()) {
  const res = await tx('readwrite', (s) => (s ? s.put(blob, id) : memory.set(id, blob)));
  void res;
  return id;
}

export async function getBlob(id) {
  if (!id) return null;
  if (memory.has(id)) return memory.get(id);
  return (await tx('readonly', (s) => (s ? s.get(id) : null))) || null;
}

export async function deleteBlob(id) {
  memory.delete(id);
  await tx('readwrite', (s) => s?.delete(id));
}

export const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

export async function dataURLToBlob(url) {
  return (await fetch(url)).blob();
}

// Verkleint een foto tot max. 1600 px en JPEG 75%: ca. 200–400 kB per foto.
export async function compressImage(file, max = 1600, quality = 0.75) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  let w;
  let hgt;
  let draw;
  if (bitmap) {
    ({ width: w, height: hgt } = bitmap);
    draw = (ctx, cw, ch) => ctx.drawImage(bitmap, 0, 0, cw, ch);
  } else {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = URL.createObjectURL(file);
    });
    w = img.naturalWidth;
    hgt = img.naturalHeight;
    draw = (ctx, cw, ch) => ctx.drawImage(img, 0, 0, cw, ch);
  }
  const scale = Math.min(1, max / Math.max(w, hgt));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(hgt * scale);
  const ctx = canvas.getContext('2d');
  draw(ctx, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// Handtekeningveld op een <canvas>: vinger, pen of muis.
export function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let empty = true;
  let drawing = false;
  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * ratio);
    canvas.height = Math.max(1, rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    empty = true;
  };
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    ctx.beginPath();
    ctx.moveTo(...pos(e));
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    ctx.lineTo(...pos(e));
    ctx.stroke();
    empty = false;
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  requestAnimationFrame(resize);
  return {
    isEmpty: () => empty,
    clear: resize,
    toBlob: () => new Promise((resolve) => canvas.toBlob(resolve, 'image/png')),
  };
}

// Alle media als data-URL's voor de back-up, en weer terugzetten.
export async function exportMedia(ids) {
  const out = {};
  for (const id of ids) {
    const b = await getBlob(id);
    if (b) out[id] = await blobToDataURL(b);
  }
  return out;
}
export async function importMedia(map = {}) {
  for (const [id, url] of Object.entries(map)) await putBlob(await dataURLToBlob(url), id);
}
