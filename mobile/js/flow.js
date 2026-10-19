// Вставка целого Markdown-текста: раскладывает его по полосам,
// подбирая высоту каждого блока и перенося остаток текста на следующую полосу.

import { BLOCKS, mkBlock, pageCount } from './model.js?v=a376db71';
import { pageLayout, buildBlock } from './layout.js?v=a376db71';
import { parseBlocks } from './md.js?v=a376db71';

const HSIZE = { 1: 'L', 2: 'M', 3: 'S' };

function toBlock(p, poster) {
  switch (p.type) {
    case 'heading': return mkBlock('heading', {}, { text: p.text, size: poster && p.level === 1 ? 'XL' : HSIZE[p.level] || 'S' });
    case 'text': return mkBlock('text', {}, { text: p.text });
    case 'quote': return mkBlock('quote', {}, { text: p.text, by: p.by });
    case 'divider': return mkBlock('divider');
    case 'image': return mkBlock(p.alt ? 'imagecap' : 'image', { h: 3 }, { caption: p.alt || '' });
  }
}

// L.H — полоса (или половина общей сетки разворота), куда кладём блоки
function fits(doc, L, b, rows) {
  const h = rows * L.rowH + (rows - 1) * L.g;
  return !buildBlock(b, { w: L.H.w, h }, { T: L.T, g: L.g, fonts: doc.fonts }).overflow;
}

// Минимальная высота блока, при которой всё влезает (или null)
function minRows(doc, L, b) {
  const def = BLOCKS[b.type];
  const max = Math.min(def.maxH, L.H.free);
  if (b.type === 'image' || b.type === 'imagecap') return max >= def.minH ? Math.min(max, b.h) : null;
  for (let r = def.minH; r <= max; r++) if (fits(doc, L, b, r)) return r;
  return null;
}

// Самый длинный кусок текста (по словам), влезающий в rows рядов
function splitText(doc, L, b, rows) {
  const parts = b.text.split(/(\s+)/);
  let lo = 0, hi = parts.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(doc, L, { ...b, text: parts.slice(0, mid).join('').trim() }, rows)) lo = mid; else hi = mid - 1;
  }
  return [parts.slice(0, lo).join('').trim(), parts.slice(lo).join('').trim()];
}

export function flowMarkdown(doc, si, startPage, md) {
  const poster = doc.sides[si].type === 'poster';
  const queue = parseBlocks(md).map((p) => toBlock(p, poster)).filter(Boolean);
  const total = pageCount(doc, si);
  let pi = startPage, placed = 0, lastPage = pi;

  while (queue.length && pi < total) {
    const b = queue[0];
    const L = pageLayout(doc, si, pi);
    const H = (L.H = L.half(pi));
    const room = L.count < L.sf.maxBlocks;
    let r = room ? minRows(doc, L, b) : null;
    // заголовок не оставляем висеть внизу полосы
    if (r && b.type === 'heading' && queue.length > 1 && H.free - r < 1) r = null;
    if (r) {
      L.page.blocks.push({ ...b, x: H.x0, y: H.bottom, w: H.cols, h: r });
      queue.shift(); placed++; lastPage = pi;
      continue;
    }
    if (room && b.type === 'text' && H.free >= 1) {
      const [head, tail] = splitText(doc, L, b, H.free);
      if (head) {
        L.page.blocks.push({ ...b, x: H.x0, y: H.bottom, w: H.cols, h: H.free, text: head });
        placed++; lastPage = pi;
        queue[0] = mkBlock('text', {}, { text: tail });
        if (!tail) queue.shift();
      }
    }
    pi++;
  }
  const left = queue.reduce((n, b) => n + (b.text || '').length, 0);
  return { placed, lastPage, leftBlocks: queue.length, leftChars: left };
}
