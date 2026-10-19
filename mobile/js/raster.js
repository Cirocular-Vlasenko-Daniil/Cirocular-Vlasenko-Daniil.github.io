// Выгрузка для веба: каждая страница — PNG, всё вместе — ZIP-архив.
// Рисует тот же display list, что SVG-редактор и PDF, только на canvas: текст — теми же
// шрифтами (они уже подключены через FontFace), картинки — с теми же фильтрами и наложениями.

import { pageDL } from './layout.js?v=a0df7e09';
import { cssFont } from './fonts.js?v=a0df7e09';
import { imageCanvas, silhouette, ensureLoaded } from './images.js?v=a0df7e09';
import { pageCount, surface } from './model.js?v=a0df7e09';
import { zip } from './zip.js?v=a0df7e09';

function draw(x, items, k) {
  for (const it of items) {
    x.save();
    switch (it.t) {
      case 'text': {
        const f = cssFont(it.key);
        x.font = `${f.style} ${f.weight} ${it.size}px "${f.family}"`;
        x.fillStyle = it.fill;
        x.fillText(it.s, it.x, it.y);
        break;
      }
      case 'rect':
        x.globalAlpha = it.o ?? 1;
        x.fillStyle = it.fill;
        x.fillRect(it.x, it.y, it.w, it.h);
        break;
      case 'line':
        x.strokeStyle = it.stroke; x.lineWidth = it.w;
        if (it.dash) x.setLineDash(it.dash);
        x.beginPath(); x.moveTo(it.x1, it.y1); x.lineTo(it.x2, it.y2); x.stroke();
        break;
      case 'path':
        x.translate(it.x, it.y);
        x.fillStyle = it.fill;
        x.fill(new Path2D(it.d));
        break;
      case 'image': {
        const c = imageCanvas(it, k);
        if (!c) break;
        if (it.clip) { x.beginPath(); x.rect(it.clip.x, it.clip.y, it.clip.w, it.clip.h); x.clip(); }
        x.imageSmoothingEnabled = it.filter !== 'dither'; // растр — чёткими точками
        x.imageSmoothingQuality = 'high';
        if (it.blend === 'multiply') x.globalCompositeOperation = 'multiply';
        x.drawImage(c, it.x, it.y, it.w, it.h);
        if (it.invMul) { // инверсия после умножения — белый силуэт в режиме «разница»
          x.globalCompositeOperation = 'difference';
          x.drawImage(silhouette(c), it.x, it.y, it.w, it.h);
        }
        break;
      }
      case 'group':
        if (it.m) { x.transform(...it.m); draw(x, it.items, k); break; } // повёрнутый блок
        x.beginPath(); x.rect(it.clip.x, it.clip.y, it.clip.w, it.clip.h); x.clip();
        draw(x, it.items, k);
        break;
    }
    x.restore();
  }
}

// Страница (или постер) -> canvas шириной width px; длинная сторона — не больше 4000 px
export function pageCanvas(doc, si, pi, width) {
  const { L, items } = pageDL(doc, si, pi);
  let k = width / L.sf.w;
  k = Math.min(k, 4000 / Math.max(L.sf.w, L.sf.h));
  const c = document.createElement('canvas');
  c.width = Math.round(L.sf.w * k); c.height = Math.round(L.sf.h * k);
  const x = c.getContext('2d');
  x.scale(c.width / L.sf.w, c.height / L.sf.h);
  x.fillStyle = doc.paper || '#ffffff';
  x.fillRect(0, 0, L.sf.w, L.sf.h);
  draw(x, items, k);
  return c;
}

const png = (c) => new Promise((res) => c.toBlob((b) => b.arrayBuffer().then((a) => res(new Uint8Array(a))), 'image/png'));

// Архив: страницы зина по порядку чтения (01…08), постер — отдельным файлом.
// sides — [A, B]: какие стороны листа включать; onStep(i, n) — прогресс
export async function pagesZip(doc, assetIds, { width = 1080, sides = [true, true], onStep } = {}) {
  await ensureLoaded(assetIds);
  await document.fonts.ready;
  const jobs = [];
  const both = doc.sides[1].type !== 'none' && sides[0] && sides[1];
  for (let si = 0; si < 2; si++) {
    const t = doc.sides[si].type;
    if (t === 'none' || !sides[si]) continue;
    const pre = both ? (si ? 'B-' : 'A-') : '';
    if (t === 'poster') jobs.push({ si, pi: 0, name: `${pre}poster.png` });
    else for (let pi = 0; pi < pageCount(doc, si); pi++) jobs.push({ si, pi, name: `${pre}${String(pi + 1).padStart(2, '0')}.png` });
  }
  const files = [];
  for (const [i, j] of jobs.entries()) {
    onStep?.(i + 1, jobs.length);
    files.push({ name: j.name, data: await png(pageCanvas(doc, j.si, j.pi, width)) });
    await new Promise((r) => setTimeout(r)); // дать интерфейсу обновить прогресс
  }
  return zip(files);
}

// Размер страницы в пикселях при ширине width — для подписи в диалоге
export function pagePx(doc, width) {
  const sf = surface(doc, 0);
  return [width, Math.round((sf.h / sf.w) * width)];
}
