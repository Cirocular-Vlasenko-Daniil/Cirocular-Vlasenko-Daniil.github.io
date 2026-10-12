// QR: матрица модулей, маска служебных зон и сетка с картинкой-растром.
// Режимы картинки:
//   pixel  — пиксель-арт в центре: 1 пиксель = 1 модуль, порог по средней яркости;
//   center — мелкий растр (ячейка = треть модуля) в центре;
//   full   — halftone QR: модуль делится на 3×3, центр хранит данные, 8 соседних — растр картинки.
// В центральных режимах закрытые модули восстанавливает коррекция ошибок H (до 30% данных).

import { ditherGrid, pixelGrid } from './images.js?v=a9c1ab4d';

const cache = new Map();
// minVer — не меньше этой версии: больше модулей — детальнее пиксель-арт в коде
export function qrMatrix(text, ec = 'M', minVer = 0) {
  const key = [ec, minVer, text].join('\u0001');
  if (cache.has(key)) return cache.get(key);
  const data = unescape(encodeURIComponent(text));
  let q = window.qrcode(0, ec);
  q.addData(data);
  q.make();
  if (minVer && (q.getModuleCount() - 17) / 4 < minVer) {
    q = window.qrcode(minVer, ec);
    q.addData(data);
    q.make();
  }
  const n = q.getModuleCount();
  const m = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
  cache.set(key, m);
  return m;
}

// Центры выравнивающих узоров по версиям (ISO/IEC 18004, таблица E.1), версии 1–40
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46],
  [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
  [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]];

// Служебные модули: поисковые узоры с разделителями и форматом, синхронизация, выравнивание, версия.
// Их не трогаем — по ним сканер находит и читает код.
function funcMask(n) {
  const v = (n - 17) / 4;
  const f = Array.from({ length: n }, () => new Uint8Array(n));
  const rect = (r0, c0, h, w) => {
    for (let r = Math.max(0, r0); r < Math.min(n, r0 + h); r++)
      for (let c = Math.max(0, c0); c < Math.min(n, c0 + w); c++) f[r][c] = 1;
  };
  rect(0, 0, 9, 9); rect(0, n - 8, 9, 8); rect(n - 8, 0, 8, 9);
  rect(6, 0, 1, n); rect(0, 6, n, 1);
  const a = ALIGN[v] || [];
  const last = a[a.length - 1];
  for (const r of a) for (const c of a) {
    if ((r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6)) continue;
    rect(r - 2, c - 2, 5, 5);
  }
  if (v >= 7) { rect(0, n - 11, 6, 3); rect(n - 11, 0, 3, 6); }
  return f;
}

// Сетка тёмных ячеек: {S — ячеек на модуль, G — размер стороны, n — модулей, dark: Uint8Array(G*G)}.
// img — {asset, mode, invert, size (доля ширины для центра), zoom, minVer};
// пока картинка грузится — рисуем код без неё.
export function qrGrid(text, img) {
  const mode = img?.asset ? img.mode || 'pixel' : null;
  const m = qrMatrix(text, mode ? 'H' : 'M', mode ? img.minVer || 0 : 0);
  const n = m.length;
  const zoom = img?.zoom || 1;
  if (!mode) {
    const dark = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark[r * n + c] = m[r][c];
    return { S: 1, G: n, n, dark };
  }
  const fm = funcMask(n);
  const S = mode === 'pixel' ? 1 : 3, G = n * S;
  const dark = new Uint8Array(G * G);
  const put = (r, c, sr, sc, v) => { dark[(r * S + sr) * G + c * S + sc] = v; };
  const fillModule = (r, c) => { for (let sr = 0; sr < S; sr++) for (let sc = 0; sc < S; sc++) put(r, c, sr, sc, m[r][c]); };

  if (mode === 'full') {
    const px = ditherGrid(img.asset, G, G, img.invert, zoom);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (fm[r][c] || !px) { fillModule(r, c); continue; }
      for (let sr = 0; sr < S; sr++) for (let sc = 0; sc < S; sc++) {
        const i = (r * S + sr) * G + c * S + sc;
        dark[i] = sr === 1 && sc === 1 ? m[r][c] : px[i];
      }
    }
    return { S, G, n, dark };
  }

  // центр: квадрат k×k модулей, по краю — пустая рамка
  let k = Math.max(5, Math.round(n * Math.min(0.35, Math.max(0.15, img.size || 0.3))));
  if ((n - k) % 2) k++;
  const r0 = (n - k) / 2;
  const inner = k * S - 2 * S; // рамка — один модуль
  const px = mode === 'pixel'
    ? pixelGrid(img.asset, inner, inner, img.invert, zoom)
    : ditherGrid(img.asset, inner, inner, img.invert, zoom);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const inside = r >= r0 && r < r0 + k && c >= r0 && c < r0 + k;
    if (!inside || fm[r][c] || !px) { fillModule(r, c); continue; }
    for (let sr = 0; sr < S; sr++) for (let sc = 0; sc < S; sc++) {
      const y = (r - r0) * S + sr - S, x = (c - r0) * S + sc - S;
      const on = y >= 0 && x >= 0 && y < inner && x < inner ? px[y * inner + x] : 0;
      put(r, c, sr, sc, on);
    }
  }
  return { S, G, n, dark };
}

// Тёмные ячейки -> один SVG-контур (строками), cell — размер ячейки в мм
export function gridPath({ G, dark }, cell) {
  const f = (v) => +v.toFixed(3);
  let d = '';
  for (let r = 0; r < G; r++) {
    let c = 0;
    while (c < G) {
      if (!dark[r * G + c]) { c++; continue; }
      const s0 = c;
      while (c < G && dark[r * G + c]) c++;
      d += `M${f(s0 * cell)} ${f(r * cell)}h${f((c - s0) * cell)}v${f(cell)}h${f(-(c - s0) * cell)}z`;
    }
  }
  return d;
}
