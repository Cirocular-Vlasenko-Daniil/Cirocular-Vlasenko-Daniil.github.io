// Картинки: хранение, кадрирование (cover + зум + сдвиг), фильтры Ч/Б и растр.
// Растр считается на сетке «зерна» в мм — поэтому на экране и в печати он одинаковый.

export const assets = {}; // id -> {src (dataURL), w, h, url (blob: для экрана)}
const els = new Map();
let onReady = () => {};
export const setOnReady = (fn) => (onReady = fn);

function dataURLtoBlob(src) {
  const [head, b64] = src.split(',');
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: head.match(/:(.*?);/)[1] });
}

export function registerAsset(id, a) {
  assets[id] = { src: a.src, w: a.w, h: a.h, url: URL.createObjectURL(dataURLtoBlob(a.src)) };
}

export function getImg(id) {
  const a = assets[id];
  if (!a) return null;
  let im = els.get(id);
  if (!im) {
    im = new Image();
    im.onload = () => onReady();
    im.src = a.url;
    els.set(id, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}

const loadImg = (id) => new Promise((res, rej) => {
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = rej;
  im.src = assets[id].url;
});

// Поворот на 90/180/270°: картинка поворачивается целиком, дальше кадрирование как обычно.
// Повёрнутые копии кэшируются (canvas + dataURL для экрана).
const norm = (r) => ((+r || 0) % 360 + 360) % 360;
const swapped = (rot) => norm(rot) % 180 !== 0;
function rotateEl(im, rot) {
  const r = norm(rot);
  if (!r) return im;
  const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
  const c = document.createElement('canvas');
  [c.width, c.height] = r % 180 ? [h, w] : [w, h];
  const x = c.getContext('2d');
  x.translate(c.width / 2, c.height / 2);
  x.rotate((r * Math.PI) / 180);
  x.drawImage(im, -w / 2, -h / 2);
  return c;
}
const rcache = new Map();
// Источник картинки с учётом поворота: {el, w, h, url}; null — ещё грузится
export function srcOf(id, rot) {
  const a = assets[id];
  if (!a) return null;
  const r = norm(rot);
  if (!r) { const im = getImg(id); return im ? { el: im, w: a.w, h: a.h, url: a.url } : null; }
  const key = id + '|' + r;
  if (rcache.has(key)) return rcache.get(key);
  const im = getImg(id);
  if (!im) return null;
  const el = rotateEl(im, r);
  const out = { el, w: el.width, h: el.height, url: hasAlpha(id) ? el.toDataURL('image/png') : el.toDataURL('image/jpeg', 0.92) };
  if (rcache.size > 20) rcache.delete(rcache.keys().next().value);
  rcache.set(key, out);
  return out;
}
// Размеры картинки с учётом поворота (для кадрирования и dpi)
export function dimsOf(id, rot) {
  const a = assets[id];
  return swapped(rot) ? { w: a.h, h: a.w } : { w: a.w, h: a.h };
}

const uid = () => 'a' + Math.random().toString(36).slice(2, 10);

// Файл/Blob -> ассет. Длинная сторона до 3000 px: хватает на 300 dpi для полосы A6.
export async function importImage(file) {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * sc);
  c.height = Math.round(bmp.height * sc);
  const x = c.getContext('2d');
  x.drawImage(bmp, 0, 0, c.width, c.height);
  // прозрачность (PNG-логотипы, вырезанные объекты) сохраняем — такие картинки храним в PNG;
  // остальные — на белом в JPEG, он в разы легче
  const px = x.getImageData(0, 0, c.width, c.height).data;
  let alpha = false;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { alpha = true; break; }
  if (!alpha) {
    x.globalCompositeOperation = 'destination-over';
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
  }
  const id = uid();
  registerAsset(id, { src: alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height });
  return id;
}

// Картинка с прозрачностью: такие ассеты хранятся в PNG, остальные — в JPEG
export const hasAlpha = (id) => !!assets[id]?.src.startsWith('data:image/png');

// Есть ли в кадре прозрачные места: своя прозрачность картинки или масштаб меньше рамки
// (лого целиком — по краям пусто). Тогда кадр кодируем в PNG, иначе JPEG закрасил бы их чёрным
function transparent(it) {
  if (hasAlpha(it.asset)) return true;
  const a = assets[it.asset];
  if (!a) return false;
  const d = dimsOf(it.asset, it.rot), r = frameRect(it, d.w, d.h);
  return r.x > 1e-3 || r.y > 1e-3 || r.x + r.w < it.w - 1e-3 || r.y + r.h < it.h - 1e-3;
}

// Масштаб, при котором картинка видна целиком (вписана), относительно «на всю рамку» (=1)
export function containZoom(id, rot, w, h) {
  const d = dimsOf(id, rot);
  return Math.min(w / d.w, h / d.h) / Math.max(w / d.w, h / d.h);
}

// Где лежит картинка с учётом вылетов: кадр задаёт рамка полосы (it.frame), а рисуется рамка шире.
// Если картинка не дотягивает до края вылета — чуть увеличиваем её от центра полосы (~3%)
export function frameRect(it, iw, ih) {
  const f = it.frame;
  if (!f) return fitRect(it, iw, ih);
  const r = fitRect({ ...it, w: f.w, h: f.h }, iw, ih);
  const x = r.x + f.x, y = r.y + f.y, cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  const need = (a, b) => (b > 1e-6 ? a / b : 1);
  const s = Math.max(1, need(cx, cx - x), need(it.w - cx, x + r.w - cx), need(cy, cy - y), need(it.h - cy, y + r.h - cy));
  return { x: cx + (x - cx) * s, y: cy + (y - cy) * s, w: r.w * s, h: r.h * s };
}

// Где лежит картинка внутри рамки w×h (мм)
export function fitRect(it, iw, ih) {
  const sc = Math.max(it.w / iw, it.h / ih) * (it.zoom || 1);
  const dw = iw * sc, dh = ih * sc;
  return { x: (it.w - dw) * it.px, y: (it.h - dh) * it.py, w: dw, h: dh };
}

function drawCrop(im, it, cw, ch) {
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const x = c.getContext('2d'); // фон прозрачный: прозрачность картинки и поля вокруг уменьшенной сохраняются
  x.imageSmoothingQuality = 'high';
  const r = frameRect(it, im.naturalWidth || im.width, im.naturalHeight || im.height);
  // масштаб — по каждой оси свой: размеры холста округлены отдельно, и при общем масштабе
  // (по ширине) картинка недотягивала до низа или правого края на долю пикселя —
  // крайний ряд выходил полупрозрачным и давал светлую полосу (заметно на тёмных фонах)
  const kx = cw / it.w, ky = ch / it.h;
  x.drawImage(im, r.x * kx, r.y * ky, r.w * kx, r.h * ky);
  return it.blur > 0 ? blurCanvas(c, it.blur * (kx + ky) / 2) : c;
}

// Размытие через уменьшение и обратное растяжение со сглаживанием: одинаково во всех
// браузерах (ctx.filter есть не везде) и без тёмной каймы по краям, как у гауссова фильтра
function blurCanvas(c, r) {
  if (r < 0.6) return c;
  const f = Math.min(80, r / 1.2);
  const passes = [Math.sqrt(f), f]; // два шага мягче одного
  let src = c;
  for (const q of passes) {
    const s = document.createElement('canvas');
    s.width = Math.max(1, Math.round(c.width / q));
    s.height = Math.max(1, Math.round(c.height / q));
    const sx = s.getContext('2d');
    sx.imageSmoothingQuality = 'high';
    sx.drawImage(src, 0, 0, s.width, s.height);
    src = s;
  }
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// Жёсткий край: прозрачность только 0 или 1 (для инверсии после умножения)
function hardAlpha(c) {
  const x = c.getContext('2d');
  const d = x.getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] >= 128 ? 255 : 0;
  x.putImageData(d, 0, 0);
  return c;
}

// Яркость пикселя, как если бы он лежал на белой бумаге (прозрачное — белое)
const lumW = (p, i) => {
  const a = p[i + 3] / 255;
  return (0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]) * a + 255 * (1 - a);
};

// Ч/Б; invert — негатив (прозрачность не трогаем)
function toGray(c, invert = false) {
  const x = c.getContext('2d');
  const d = x.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const l = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
    p[i] = p[i + 1] = p[i + 2] = invert ? 255 - l : l;
  }
  x.putImageData(d, 0, 0);
  return c;
}

// Аткинсон: светлые участки остаются чистыми, хорошо переживает ксерокс и лазер
// invert — краска на светлых участках, бумага на тёмных
// color — краска точек (#rrggbb), остальное прозрачное
function atkinson(c, invert = false, color = '#000000') {
  const cv = parseInt(color.slice(1), 16), R = (cv >> 16) & 255, G = (cv >> 8) & 255, B = cv & 255;
  const x = c.getContext('2d');
  const W = c.width, H = c.height;
  const d = x.getImageData(0, 0, W, H);
  const p = d.data;
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const l = lumW(p, i * 4);
    g[i] = Math.min(255, Math.max(0, (l - 128) * 1.15 + 128)); // лёгкий контраст
  }
  const N = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const i = y * W + xx;
    const v = g[i] < 128 ? 0 : 255;
    const e = (g[i] - v) / 8;
    g[i] = v;
    for (const [dx, dy] of N) {
      const X = xx + dx, Y = y + dy;
      if (X >= 0 && X < W && Y < H) g[Y * W + X] += e;
    }
  }
  // белое делаем прозрачным: для 1-битной картинки это то же, что наложение «умножение» —
  // сквозь растр видна бумага и всё, что под картинкой
  // прозрачные места исходника остаются пустыми и при инверсии
  for (let i = 0; i < W * H; i++) {
    const ink = (g[i] < 128) !== invert && p[i * 4 + 3] >= 128;
    p[i * 4] = R; p[i * 4 + 1] = G; p[i * 4 + 2] = B; p[i * 4 + 3] = ink ? 255 : 0;
  }
  x.putImageData(d, 0, 0);
  return c;
}

const ditherCells = (it) => [Math.max(8, Math.round(it.w / it.grain)), Math.max(8, Math.round(it.h / it.grain))];

const dcache = new Map();
export function ditherURL(it) {
  const key = ['d', it.asset, it.w.toFixed(2), it.h.toFixed(2), it.zoom, it.px.toFixed(3), it.py.toFixed(3), it.grain, it.blur || 0, it.invert ? 1 : 0, it.color || '', norm(it.rot)].join('|');
  if (dcache.has(key)) return dcache.get(key);
  const im = srcOf(it.asset, it.rot)?.el;
  if (!im) return null;
  const [cw, ch] = ditherCells(it);
  const src = atkinson(drawCrop(im, it, cw, ch), it.invert, it.color);
  // Увеличиваем «по соседним пикселям» сами: Safari игнорирует image-rendering: pixelated
  // у <image> внутри SVG и сглаживает маленькую картинку. При 8–12 px на точку растра
  // сглаживание браузера приходится на доли пикселя и не видно.
  const f = Math.max(1, Math.min(12, Math.floor(2000 / Math.max(cw, ch))));
  let out = src;
  if (f > 1) {
    out = document.createElement('canvas');
    out.width = cw * f; out.height = ch * f;
    const x = out.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.drawImage(src, 0, 0, out.width, out.height);
  }
  const url = out.toDataURL('image/png');
  if (dcache.size > 80) dcache.delete(dcache.keys().next().value);
  dcache.set(key, url);
  return url;
}

// Превью размытой картинки (цвет/Ч-Б) — тем же кодом, что и для печати, ~6 px/мм
export function blurURL(it) {
  const key = ['b', it.asset, it.w.toFixed(2), it.h.toFixed(2), it.zoom, it.px.toFixed(3), it.py.toFixed(3), it.blur, it.filter, norm(it.rot), it.invert ? 1 : 0, it.invMul ? 1 : 0].join('|');
  if (dcache.has(key)) return dcache.get(key);
  const im = srcOf(it.asset, it.rot)?.el;
  if (!im) return null;
  const k = Math.min(6, 1400 / Math.max(it.w, it.h));
  const c = drawCrop(im, it, Math.round(it.w * k), Math.round(it.h * k));
  if (it.filter === 'gray') toGray(c, it.invert);
  if (it.invMul) hardAlpha(c);
  const url = transparent(it) ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
  if (dcache.size > 80) dcache.delete(dcache.keys().next().value);
  dcache.set(key, url);
  return url;
}

// Растр картинки как сетка 0/1 (1 — краска) размером W×H; картинка вписывается «cover» по центру.
// null — если картинка ещё грузится (перерисуемся по onReady).
const gcache = new Map();
export function ditherGrid(id, W, H, invert = false, zoom = 1) {
  const key = ['d', id, W, H, invert ? 1 : 0, zoom].join('|');
  if (gcache.has(key)) return gcache.get(key);
  const im = getImg(id);
  if (!im) return null;
  const it = { w: W, h: H, zoom, px: 0.5, py: 0.5 };
  const c = atkinson(drawCrop(im, it, W, H), invert);
  const a = c.getContext('2d').getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = a[i * 4 + 3] > 127 ? 1 : 0;
  if (gcache.size > 40) gcache.delete(gcache.keys().next().value);
  gcache.set(key, out);
  return out;
}

// Пиксель-арт: порог по средней яркости, без дизеринга — на сетке в пару десятков
// пикселей так получается рисунок, а не шум
export function pixelGrid(id, W, H, invert = false, zoom = 1) {
  const key = ['p', id, W, H, invert ? 1 : 0, zoom].join('|');
  if (gcache.has(key)) return gcache.get(key);
  const im = getImg(id);
  if (!im) return null;
  const c = drawCrop(im, { w: W, h: H, zoom, px: 0.5, py: 0.5 }, W, H);
  const p = c.getContext('2d').getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H);
  let sum = 0;
  for (let i = 0; i < W * H; i++) { lum[i] = lumW(p, i * 4); sum += lum[i]; }
  const t = sum / (W * H);
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = (lum[i] < t) !== invert && p[i * 4 + 3] >= 128 ? 1 : 0;
  if (gcache.size > 40) gcache.delete(gcache.keys().next().value);
  gcache.set(key, out);
  return out;
}

// Для PDF: дождаться загрузки картинок, которые вёрстка читает синхронно (QR с картинкой)
export function ensureLoaded(ids) {
  return Promise.all(ids.filter((id) => assets[id]).map((id) => {
    const im = getImg(id);
    if (im) return null;
    return new Promise((res) => { const el = els.get(id); el.addEventListener('load', res, { once: true }); el.addEventListener('error', res, { once: true }); });
  }));
}

const toBytes = (c, type, q) =>
  new Promise((res) => c.toBlob((b) => b.arrayBuffer().then(res), type, q));

// Картинка для PDF: 300 dpi; растр — увеличенный без сглаживания
export async function printImage(it, dpi = 300) {
  const im = rotateEl(await loadImg(it.asset), it.rot);
  if (it.filter === 'dither') {
    const src = atkinson(drawCrop(im, it, ...ditherCells(it)), it.invert, it.color);
    const f = Math.max(1, Math.ceil((it.w / 25.4) * dpi / src.width));
    const c = document.createElement('canvas');
    c.width = src.width * f; c.height = src.height * f;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.drawImage(src, 0, 0, c.width, c.height);
    if (it.fade > 0) { // осветление растра — прозрачность точек: сквозь них видна бумага
      x.globalCompositeOperation = 'destination-in';
      x.fillStyle = `rgba(0,0,0,${1 - it.fade})`;
      x.fillRect(0, 0, c.width, c.height);
    }
    return { kind: 'png', bytes: await toBytes(c, 'image/png') };
  }
  const c = drawCrop(im, it, Math.round((it.w / 25.4) * dpi), Math.round((it.h / 25.4) * dpi));
  if (it.filter === 'gray') toGray(c, it.invert);
  if (it.invMul) hardAlpha(c);
  if (it.fade > 0) {
    const x = c.getContext('2d');
    x.globalCompositeOperation = 'source-atop'; // осветляем только саму картинку, не прозрачные места
    x.globalAlpha = it.fade;
    x.fillStyle = it.fadeTo || '#ffffff';
    x.fillRect(0, 0, c.width, c.height);
  }
  if (transparent(it)) return { kind: 'png', bytes: await toBytes(c, 'image/png') };
  return { kind: 'jpg', bytes: await toBytes(c, 'image/jpeg', 0.92) };
}

// Кадр картинки для растровой выгрузки (PNG для веба), k — пикселей на мм. Растр — в своей
// сетке зерна (рисовать без сглаживания); null — картинка ещё грузится
export function imageCanvas(it, k) {
  const im = srcOf(it.asset, it.rot)?.el;
  if (!im) return null;
  if (it.filter === 'dither') return atkinson(drawCrop(im, it, ...ditherCells(it)), it.invert, it.color);
  const c = drawCrop(im, it, Math.max(1, Math.round(it.w * k)), Math.max(1, Math.round(it.h * k)));
  if (it.filter === 'gray') toGray(c, it.invert);
  if (it.invMul) hardAlpha(c);
  return c;
}

// Белый силуэт уже готового кадра (для инверсии после умножения)
export function silhouette(c) {
  const s = document.createElement('canvas');
  s.width = c.width; s.height = c.height;
  const x = s.getContext('2d');
  x.drawImage(c, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#fff';
  x.fillRect(0, 0, s.width, s.height);
  return s;
}

// Белый силуэт картинки (её прозрачность, всё остальное — белое) для инверсии после умножения в PDF
export async function printSilhouette(it, dpi = 300) {
  const im = rotateEl(await loadImg(it.asset), it.rot);
  const c = hardAlpha(drawCrop(im, it, Math.round((it.w / 25.4) * dpi), Math.round((it.h / 25.4) * dpi)));
  const x = c.getContext('2d');
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  return toBytes(c, 'image/png');
}

// Эффективное разрешение в печати (для предупреждения «мелкая картинка»)
export function effectiveDpi(it) {
  const a = assets[it.asset];
  if (!a) return Infinity;
  const d = dimsOf(it.asset, it.rot);
  const r = fitRect(it, d.w, d.h);
  return d.w / (r.w / 25.4);
}

// Демо-картинка для примера: холмы, солнце, облака
export function makeSampleAsset() {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 900;
  const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, 600);
  sky.addColorStop(0, '#3d4a5c'); sky.addColorStop(1, '#e9e2d0');
  x.fillStyle = sky; x.fillRect(0, 0, 1200, 900);
  const sun = x.createRadialGradient(820, 330, 10, 820, 330, 220);
  sun.addColorStop(0, '#fffbe8'); sun.addColorStop(0.45, '#fff2c0'); sun.addColorStop(1, 'rgba(255,240,200,0)');
  x.fillStyle = sun; x.fillRect(500, 0, 700, 700);
  const hill = (y0, amp, f, ph, col) => {
    x.beginPath(); x.moveTo(0, 900);
    for (let i = 0; i <= 1200; i += 10) x.lineTo(i, y0 + Math.sin(i * f + ph) * amp + Math.sin(i * f * 2.7 + ph) * amp * 0.3);
    x.lineTo(1200, 900); x.closePath(); x.fillStyle = col; x.fill();
  };
  hill(560, 50, 0.006, 1, '#8e9a8a');
  hill(650, 70, 0.004, 3, '#5b6b5c');
  hill(760, 40, 0.009, 0.5, '#2f3b31');
  const id = uid();
  registerAsset(id, { src: c.toDataURL('image/jpeg', 0.9), w: 1200, h: 900 });
  return id;
}
