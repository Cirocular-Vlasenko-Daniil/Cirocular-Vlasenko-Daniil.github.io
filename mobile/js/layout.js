// Движок вёрстки: документ -> список примитивов (display list) в мм.
// Примитивы: text {x,y(базовая линия),s,key,size,fill} · rect · line · image · ph (заглушка, только редактор)

import { PT, BLOCKS, pageSf, getPage, pairOf, spreadBgOf, spreadGridOf } from './model.js?v=a0df7e09';
import { t } from './i18n.js?v=a0df7e09';
import { W, fontKey, avgCharW, xHeight, capHeight } from './fonts.js?v=a0df7e09';
import { parseText, countChars } from './md.js?v=a0df7e09';
import { fitRect, assets } from './images.js?v=a0df7e09';
import { qrGrid, gridPath } from './qr.js?v=a0df7e09';

const INK = '#000000';
const GRAY = '#6b6b6b';

// Типографская шкала (pt при s=1, полоса A7 с листа A4) -> мм
export function typeScale(s) {
  const t = (size, lead) => ({ size: size * s * PT, lead: lead * s * PT });
  return {
    body: t(8, 11),
    small: t(6.5, 8.5),
    large: t(10.5, 14),
    quote: t(12, 14.5),
    quoteS: t(10, 12.5),  // кегли цитаты: мелкий / основной / крупный
    quoteL: t(16, 18.5),
    h: { S: t(11, 13), M: t(15, 17), L: t(22, 24), XL: t(32, 32.5) },
  };
}

// ---------- текст ----------

function words(runs, keyOf) {
  const out = [];
  let cur = null;
  const flush = () => { if (cur?.length) out.push(cur); cur = null; };
  for (const r of runs) {
    if (r.br) { flush(); out.push('br'); continue; }
    const key = keyOf(r.b, r.i);
    for (const part of r.t.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { flush(); continue; }
      (cur ||= []).push({ key, t: part });
    }
  }
  flush();
  return out;
}

function wrap(runs, width, o) {
  const lines = [];
  let line = { segs: [], w: 0 };
  const push = () => { lines.push(line); line = { segs: [], w: 0 }; };
  const add = (key, t, sp) => {
    const x = line.w + (sp ? W(key, ' ', o.size) : 0);
    line.segs.push({ key, t, x, sp });
    line.w = x + W(key, t, o.size);
  };
  for (const wd of words(runs, o.keyOf)) {
    if (wd === 'br') { line.hard = true; push(); continue; }
    const ww = wd.reduce((a, s) => a + W(s.key, s.t, o.size), 0);
    const sp = line.segs.length ? W(wd[0].key, ' ', o.size) : 0;
    if (line.segs.length && line.w + sp + ww > width + 1e-3) push();
    if (!line.segs.length && ww > width) {
      // слово длиннее строки — режем по буквам
      for (const s of wd) {
        let buf = '';
        for (const ch of s.t) {
          if (line.w + W(s.key, buf + ch, o.size) > width && (buf || line.segs.length)) {
            if (buf) add(s.key, buf, false);
            push();
            buf = ch;
          } else buf += ch;
        }
        if (buf) add(s.key, buf, false);
      }
      continue;
    }
    wd.forEach((s, k) => add(s.key, s.t, k === 0 && line.segs.length > 0));
  }
  if (line.segs.length || !lines.length) push();
  lines[lines.length - 1].last = true;
  // склеиваем соседние сегменты одного начертания в один прогон;
  // для выключки по ширине и по формату слова оставляем отдельными — между ними распределяется пробел
  const keepWords = o.align === 'justify' || o.align === 'force';
  for (const ln of lines) {
    const m = [];
    for (const s of ln.segs) {
      const p = m[m.length - 1];
      if (p && p.key === s.key && !(keepWords && s.sp)) p.t += (s.sp ? ' ' : '') + s.t;
      else m.push({ ...s });
    }
    ln.segs = m;
  }
  return lines;
}

// paras -> примитивы. o: {w,h,size,lead,keyOf,cols,gap,paraGap,indent,align,fill}
export function layoutText(paras, o) {
  const cols = o.cols || 1, gap = o.gap || 0;
  const colW = (o.w - gap * (cols - 1)) / cols;
  const all = [];
  paras.forEach((p, pi) => {
    const ind = p.kind === 'p' ? 0 : o.indent || 0;
    const lines = wrap(p.runs, colW - ind, o);
    const listCont = pi > 0 && p.kind !== 'p' && paras[pi - 1].kind !== 'p';
    lines.forEach((ln, li) => {
      ln.ind = ind;
      // пропуск перед абзацем: по строке на каждую пустую строку (Enter), иначе — обычный отступ абзаца
      ln.gap = li !== 0 ? 0 : p.blank ? p.blank * o.lead : pi > 0 && !listCont ? o.paraGap || 0 : 0;
      ln.lead0 = li === 0 && pi === 0 && p.blank > 0; // пустые строки в самом начале текста
      if (li === 0 && p.kind !== 'p') ln.marker = p.kind === 'ol' ? p.num + '.' : 'sq';
      all.push(ln);
    });
  });
  const items = [];
  let col = 0, y = 0, maxY = 0, overflow = false, lastW = 0;
  // Оптическое прижатие: верх строчных первой строки — на верхней границе (заглавные выходят выше),
  // базовая линия последней — на нижней (выносные уходят ниже). y — верх строчных текущей строки.
  // o.caps — текст только из заглавных: верх заглавных на границе блока, буквы не выходят за неё
  const xh = (o.caps ? capHeight : xHeight)(o.keyOf(false, false)) * o.size;
  for (const ln of all) {
    let g = y > 0 || ln.lead0 ? ln.gap : 0;
    if (y + g + xh > o.h + 0.05) {
      col++; y = 0; g = 0;
      if (col >= cols) { overflow = true; break; }
    }
    y += g;
    const cx = col * (colW + gap);
    const free = colW - ln.ind - ln.w;
    const x0 = cx + ln.ind + (o.align === 'center' ? free / 2 : o.align === 'right' ? free : 0);
    const base = y + xh;
    if (ln.marker === 'sq') {
      const q = o.size * 0.26;
      items.push({ t: 'rect', x: cx + o.size * 0.08, y: base - xh / 2 - q / 2, w: q, h: q, fill: o.fill });
    } else if (ln.marker) {
      items.push({ t: 'text', x: cx, y: base, s: ln.marker, key: o.keyOf(false, false), size: o.size, fill: o.fill });
    }
    // justify (по ширине): добор распределяем по межсловным пробелам; последнюю строку абзаца
    // и строку перед жёстким переносом не трогаем, как и строки с дырами больше кегля (переносов нет).
    // force (по формату): растягиваем каждую строку; строку из одного слова — разрядкой по буквам.
    const force = o.align === 'force';
    const gaps = ln.segs.filter((s) => s.sp).length;
    let extra = 0;
    if (o.align === 'justify' && !ln.last && !ln.hard && gaps && free / gaps <= o.size) extra = free / gaps;
    if (force && gaps) extra = free / gaps;
    const chars = force && !gaps && free > 0.01 ? ln.segs.reduce((n, s) => n + [...s.t].length, 0) : 0;
    if (chars > 1) {
      const per = free / (chars - 1);
      let k = 0;
      for (const s of ln.segs) {
        const cs = [...s.t];
        cs.forEach((ch, i) => {
          const x = x0 + s.x + W(s.key, cs.slice(0, i).join(''), o.size) + per * k++;
          items.push({ t: 'text', x, y: base, s: ch, key: s.key, size: o.size, fill: o.fill });
        });
      }
    } else {
      let add = 0;
      for (const s of ln.segs) {
        if (s.sp) add += extra;
        items.push({ t: 'text', x: x0 + s.x + add, y: base, s: s.t, key: s.key, size: o.size, fill: o.fill });
      }
    }
    maxY = Math.max(maxY, base); // высота текста — до базовой линии последней строки
    y += o.lead;
    lastW = ln.w + ln.ind;
  }
  return { items, overflow, height: maxY, lines: all.length, lastW };
}

// Рекомендуемое число знаков для прямоугольника
export function capacity(key, st, w, h, cols = 1, gap = 0) {
  const colW = (w - gap * (cols - 1)) / cols;
  const cpl = Math.floor(colW / avgCharW(key, st.size));
  const xh = xHeight(key) * st.size;
  const lines = h + 0.05 < xh ? 0 : Math.floor((h + 0.05 - xh) / st.lead) + 1;
  const n = cpl * lines * cols;
  return n > 60 ? Math.floor(n * 0.92 / 10) * 10 : Math.floor(n * 0.92); // запас на переносы
}

// ---------- блоки ----------


const shift = (it, dx, dy) =>
  it.t === 'line' ? { ...it, x1: it.x1 + dx, x2: it.x2 + dx, y1: it.y1 + dy, y2: it.y2 + dy }
    : it.m ? { ...it, m: [it.m[0], it.m[1], it.m[2], it.m[3], it.m[4] + dx, it.m[5] + dy] } // группа с трансформацией
    : { ...it, x: it.x + dx, y: it.y + dy };

// Вертикальное положение текста (b.valign: top/middle/bottom) и плашка выколотки (b.knock):
// 'fit' — плашка по высоте текста, прижата к верху/центру/низу блока; 'fill' — плашка на весь блок.
// items — текст от верха внутренней области; used — его высота; phs — заглушки, их не двигаем.
function frame(C, b, items, phs, used, w, h, pad) {
  const k = { top: 0, middle: 0.5, bottom: 1 }[b.valign] || 0;
  const out = [];
  let dy;
  if (b.knock === 'fit' && used > 0) {
    const ph = used + 2 * pad, y0 = (h - ph) * k;
    out.push({ t: 'rect', x: 0, y: y0, w, h: ph, fill: C });
    dy = y0 + pad;
  } else {
    if (b.knock === 'fill') out.push({ t: 'rect', x: 0, y: 0, w, h, fill: C });
    dy = pad + Math.max(0, h - 2 * pad - used) * k;
  }
  items.forEach((it) => out.push(shift(it, 0, dy)));
  return out.concat(phs);
}

// Ч/Б с инверсией и умножением: инверсия — после умножения. Картинка ложится умножением
// без инверсии, а сверху её белый силуэт в режиме «разница» инвертирует получившийся результат
// (тёмное лого на фото становится белым). invMul рисуют рендеры SVG и PDF.
// Край картинки в этом режиме жёсткий (прозрачность 0 или 1): два полупрозрачных слоя
// на сглаженном крае дали бы тёмную обводку; при 300 dpi жёсткий край не виден.
const invAfterMul = (it) =>
  it.filter === 'gray' && it.invert && it.blend === 'multiply' ? { ...it, invert: false, invMul: true } : it;

export const colorOf = (ctx, key) => (key === 'accent' ? ctx.accent : ctx.ink) || INK;
// служебный текст (колонтитулы, подписи, автор цитаты): серый, основная краска или акцент
// системная краска: колонтитулы, подписи, автор цитаты
export const metaOf = (ctx) => ctx?.meta || GRAY;

export const colText = (b, c) => (c === 0 ? b.text : b['text' + (c + 1)]) || '';

// Возвращает {items, overflow, chars, cap, img, cols}
export function buildBlock(b, box, ctx) {
  const { T, fonts, g, editor } = ctx;
  // краска блока: основная или акцентная (b.color); выколотка остаётся цвета бумаги
  const C = colorOf(ctx, b.color);
  const hk = (bb, ii) => fontKey(fonts.heading, true, ii);
  const hr = (bb, ii) => fontKey(fonts.heading, bb, ii);
  const bk = (bb, ii) => fontKey(fonts.body, bb, ii);
  const { w, h } = box;
  const ph = (label) => (editor ? [{ t: 'ph', x: 0, y: 0, w, h, label }] : []);

  switch (b.type) {
    case 'vheading':
    case 'vtext': {
      // вертикальный блок: вёрстка обычного заголовка/текста в поле, повёрнутом на бок (ширина — высота
      // блока), затем поворот на 90° против часовой: (x, y) -> (y, H − x). Читается снизу вверх,
      // строки — слева направо; выключка, выколотка, прижатие, счётчик знаков — как у горизонтальных
      const flat = { ...b, type: b.type === 'vheading' ? 'heading' : 'text', cols: 1 };
      const r = buildBlock(flat, { ...box, w: h, h: w }, ctx);
      return { ...r, items: [{ t: 'group', m: [0, -1, 1, 0, 0, h], items: r.items }] };
    }
    case 'heading': {
      const st = T.h[b.size] || T.h.L;
      const pad = b.knock ? g * 0.45 : 0;
      const caps = /\p{L}/u.test(b.text) && !/\p{Ll}/u.test(b.text); // заголовок капсом — прижимаем по заглавным
      const r = layoutText(parseText(b.text), { w: w - 2 * pad, h: h - 2 * pad, size: st.size, lead: st.lead, keyOf: hk, align: b.align, caps, fill: b.knock ? ctx.knockFill : C });
      return { items: frame(C, b, r.items.map((it) => shift(it, pad, 0)), [], r.height, w, h, pad), overflow: r.overflow, chars: countChars(b.text), cap: capacity(hk(), st, w - 2 * pad, h - 2 * pad) };
    }
    case 'text': {
      // каждая колонка — своя зона со своим текстом (text, text2, text3), без перетекания
      const st = b.size === 'small' ? T.small : b.size === 'large' ? T.large : T.body;
      const cols = Math.min(3, b.cols || 1);
      const pad = b.knock ? g * 0.45 : 0; // внутренний отступ плашки выколотки
      const iw = w - 2 * pad, ih = h - 2 * pad;
      const colW = (iw - g * (cols - 1)) / cols;
      const o = { w: colW, h: ih, size: st.size, lead: st.lead, keyOf: bk, paraGap: st.lead * 0.5, indent: st.size * 1.7, align: b.align, fill: b.knock ? ctx.knockFill : C };
      const cap = capacity(bk(), st, colW, ih);
      const items = [], phs = [], colInfo = [];
      let used = 0;
      for (let c = 0; c < cols; c++) {
        const src = colText(b, c);
        const x0 = pad + c * (colW + g);
        if (src.trim()) {
          const r = layoutText(parseText(src), o);
          r.items.forEach((it) => items.push(shift(it, x0, 0)));
          used = Math.max(used, r.height);
          colInfo.push({ chars: countChars(src), cap, overflow: r.overflow });
        } else {
          if (editor) phs.push({ t: 'ph', x: x0, y: pad, w: colW, h: ih, label: cols > 1 ? t('Колонка {n}', { n: c + 1 }) : t('Текст') });
          colInfo.push({ chars: 0, cap, overflow: false });
        }
      }
      return {
        items: frame(C, b, items, phs, used, w, h, pad), cols: colInfo,
        overflow: colInfo.some((c) => c.overflow),
        chars: colInfo.reduce((a, c) => a + c.chars, 0), cap: cap * cols,
      };
    }
    case 'quote': {
      const st = b.size === 'small' ? T.quoteS : b.size === 'large' ? T.quoteL : T.quote, sm = T.small;
      const pad = b.knock ? g * 0.45 : 0; // внутренний отступ плашки выколотки
      const ink = b.knock ? ctx.knockFill : C;
      const bar = Math.max(0.5, g * 0.22), off = g * 0.9;
      const tw = w - 2 * pad - off, ih = h - 2 * pad;
      const byH = b.by ? sm.lead : 0;
      const r = b.text.trim()
        ? layoutText(parseText(b.text), { w: tw, h: ih - byH, size: st.size, lead: st.lead, keyOf: hr, align: b.align, fill: ink })
        : { items: [], overflow: false, height: 0 };
      // при выключке вправо черта переезжает к правому краю — к тексту
      const right = b.align === 'right';
      const tx = right ? pad : pad + off, barX = right ? w - pad - bar : pad;
      const items = r.items.map((it) => shift(it, tx, 0));
      if (b.by) {
        const by = layoutText(parseText('— ' + b.by), { w: tw, h: sm.lead, size: sm.size, lead: sm.lead, keyOf: bk, align: b.align, fill: b.knock ? ink : metaOf(ctx) });
        // базовая линия автора — на строку ниже последней строки цитаты
        const dy = r.height + sm.lead - xHeight(bk()) * sm.size;
        by.items.forEach((it) => items.push(shift(it, tx, dy)));
      }
      const used = Math.min(ih, r.height + byH);
      // черта — от верха заглавных первой строки до базовой линии последней
      // (текст прижат по строчным, поэтому черта поднимается на разницу высот заглавных и строчных)
      const up = (capHeight(hr()) - xHeight(hr())) * st.size;
      if (used > 0) items.unshift({ t: 'rect', x: barX, y: -up, w: bar, h: used + up, fill: ink });
      const phs = b.text.trim() ? [] : ph(t('Цитата'));
      return { items: frame(C, b, items, phs, used, w, h, pad), overflow: r.overflow, chars: countChars(b.text), cap: capacity(hr(), st, tw, ih - byH) };
    }
    case 'image':
    case 'imagecap': {
      let ih = h, items = [], chars, cap, overflow = false;
      if (b.type === 'imagecap') {
        const sm = T.small, maxL = 3;
        const probe = layoutText(parseText(b.caption || ' '), { w, h: 999, size: sm.size, lead: sm.lead, keyOf: bk, fill: C });
        const lines = Math.min(maxL, Math.max(1, probe.lines));
        const capH = lines * sm.lead;
        ih = h - capH - g * 0.35;
        const cr = layoutText(parseText(b.caption || ''), { w, h: capH, size: sm.size, lead: sm.lead, keyOf: bk, align: b.align, fill: metaOf(ctx) });
        items = cr.items.map((it) => ({ ...it, y: it.y + ih + g * 0.35 }));
        overflow = cr.overflow || ih < 4;
        chars = countChars(b.caption || '');
        cap = capacity(bk(), sm, w, maxL * sm.lead);
      }
      const im = { t: 'image', x: 0, y: 0, w, h: Math.max(1, ih), asset: b.asset, zoom: b.zoom, px: b.px, py: b.py, filter: b.filter, grain: b.grain, invert: !!b.invert, color: C, rot: b.rot || 0, blend: b.filter !== 'dither' ? b.blend : undefined };
      if (b.asset && assets[b.asset]) items.unshift(invAfterMul(im));
      else if (editor) items.unshift({ t: 'ph', x: 0, y: 0, w, h: Math.max(1, ih), label: t('Перетащи картинку'), img: true });
      return { items, overflow, chars, cap, img: im };
    }
    case 'divider': {
      const y = h / 2, u = Math.max(0.6, g * 0.3);
      const items = [];
      if (b.style === 'line') items.push({ t: 'line', x1: 0, y1: y, x2: w, y2: y, w: 0.25, stroke: C });
      else if (b.style === 'dash') items.push({ t: 'line', x1: 0, y1: y, x2: w, y2: y, w: 0.25, stroke: C, dash: [u, u] });
      else if (b.style === 'three') for (let k = -1; k <= 1; k++) items.push({ t: 'rect', x: w / 2 + k * u * 3 - u / 2, y: y - u / 2, w: u, h: u, fill: C });
      else { const n = Math.floor(w / (u * 2)); const x0 = (w - (n * 2 - 1) * u) / 2; for (let k = 0; k < n; k++) items.push({ t: 'rect', x: x0 + k * u * 2, y: y - u / 2, w: u, h: u, fill: C }); }
      return { items, overflow: false };
    }
    case 'qr': {
      const st = T.small, gap = g * 0.8, gv = g * 0.4;
      // положение кода: qrx — left/center/right, qry — top/middle/bottom
      // (старые файлы: qrpos 'end' — код справа, а в стопке — снизу)
      const legacyEnd = b.qrpos === 'end';
      // подпись сбоку, если там есть место (от 12 мм) и код не по центру, иначе — стопкой с кодом
      const sideR = Math.min(h, w > h * 1.8 ? w * 0.45 : w);
      const qrx0 = b.qrx || (legacyEnd ? 'right' : 'left');
      const below = w - sideR - gap < 12 || qrx0 === 'center';
      const qrx = b.qrx || (legacyEnd && !below ? 'right' : 'left');
      const qry = b.qry || (legacyEnd && below ? 'bottom' : 'top');
      const capLine = b.caption ? st.lead + g * 0.4 : 0;
      const side = below ? Math.max(4, Math.min(w, h - capLine)) : sideR;
      const kx = { left: 0, center: 0.5, right: 1 }[qrx] ?? 0;
      const ky = { top: 0, middle: 0.5, bottom: 1 }[qry] ?? 0;
      // подпись: сбоку — в оставшейся полосе; стопкой — под кодом (код сверху/по центру) или над ним (код снизу)
      const box = below
        ? { x: 0, w, h: h - side - gv }
        : { x: qrx === 'right' ? 0 : side + gap, y: 0, w: w - side - gap, h };
      const cap = box.w >= 8 && box.h >= st.lead * 0.9 && (b.caption || '').trim();
      const r = cap ? layoutText(parseText(b.caption), { w: box.w, h: box.h, size: st.size, lead: st.lead, keyOf: bk, align: b.align, fill: metaOf(ctx) }) : null;
      let qx, qy, cy;
      if (below) {
        qx = (w - side) * kx;
        const capH = r ? gv + r.height : 0; // высота подписи — до базовой линии последней строки
        if (qry === 'bottom') { qy = h - side; cy = qy - capH; }
        else { qy = qry === 'middle' ? Math.max(0, (h - side - capH) / 2) : 0; cy = qy + side + gv; }
      } else {
        qx = qrx === 'right' ? w - side : 0;
        qy = (h - side) * ky;
        // подпись прижата так же, как код: верх строчных — к верху, базовая линия — к низу
        cy = r ? Math.max(0, (h - r.height) * ky) : 0;
      }
      const items = [];
      if (b.url && b.url.length > 8) {
        const qi = b.qrimg && assets[b.qrimg]
          ? { asset: b.qrimg, mode: b.qrmode || 'pixel', invert: !!b.qrimginvert, size: b.qrsize || 0.3, zoom: b.qrzoom || 1, minVer: b.qrver || 0 }
          : null;
        const grid = qrGrid(b.url, qi);
        // инверсия: код цветом бумаги на плашке, вокруг — тихая зона 1.5 модуля
        const q = b.invert ? 1.5 : 0, u = side / (grid.n + 2 * q), o = q * u;
        const ink = b.invert ? ctx.knockFill : C;
        if (b.invert) items.push({ t: 'rect', x: qx, y: qy, w: side, h: side, fill: C });
        // весь код — один контур: у отдельных прямоугольников на стыках видны щели сглаживания
        items.push({ t: 'path', x: qx + o, y: qy + o, d: gridPath(grid, u / grid.S), fill: ink });
      } else if (editor) items.push({ t: 'ph', x: qx, y: qy, w: side, h: side, label: 'QR' });
      const chars = countChars(b.caption || '');
      if (!r) return { items, overflow: !!(b.caption || '').trim(), chars, cap: 0, stack: below };
      r.items.forEach((it) => items.push(shift(it, box.x, cy)));
      return { items, overflow: r.overflow, chars, cap: capacity(bk(), st, box.w, box.h), stack: below };
    }
  }
  return { items: [], overflow: false };
}

// ---------- страница ----------

// Прилипшие края (r.ex) перешагивают промежуток до соседней ячейки. gapX(k) — промежуток перед
// колонкой k, gy — между рядами. У края сетки промежутка нет — там прилипание не действует.
function withEx(q, r, sf, gapX, gy) {
  const e = r.ex;
  if (!e) return q;
  if (e.t && r.y > 0) { q.y -= gy; q.h += gy; }
  if (e.b && r.y + r.h < sf.rows) q.h += gy;
  if (e.l && r.x > 0) { const d = gapX(r.x); q.x -= d; q.w += d; }
  if (e.r && r.x + r.w < sf.cols) q.w += gapX(r.x + r.w);
  return q;
}

// Раскладка для редактирования: у полос с общей сеткой — сетка всего разворота
export function pageLayout(doc, si, pi) {
  const p = spreadGridOf(doc, si, pi);
  return p ? spreadLayout(doc, si, p) : singleLayout(doc, si, pi);
}

// Общая сетка разворота: колонки обеих полос подряд (2·cols). Колонки стоят там же, где на
// отдельной полосе, между половинами — поля обеих полос у корешка. Блоки — с левой полосы.
function spreadLayout(doc, si, pair) {
  const base = singleLayout(doc, si, pair[0]);
  const { content, colW, rowH, g, page } = base;
  const W = base.sf.w, c = base.sf.cols;
  const X = (k) => (k >= c ? W : 0) + content.x + (k % c) * (colW + g);
  const sf = { ...base.sf, w: W * 2, cols: c * 2, pageW: W, pageCols: c, maxBlocks: base.sf.maxBlocks * 2 };
  const rect = (r) => withEx({ x: X(r.x), y: content.y + r.y * (rowH + g), w: X(r.x + r.w - 1) + colW - X(r.x), h: r.h * rowH + (r.h - 1) * g }, r, sf,
    // промежутки по горизонтали в общей сетке разные: у корешка — поля обеих полос
    (k) => X(k) - (X(k - 1) + colW), g);
  const boxes = page.blocks.map((b) => ({ b, ...rect(b) }));
  const cells = page.blocks.reduce((a, b) => a + b.w * b.h, 0);
  const bottomOf = (bl) => bl.reduce((a, b) => Math.max(a, b.y + b.h), 0);
  const bottom = bottomOf(page.blocks);
  // половина разворота как отдельная полоса — для раскладки вставленного текста
  const half = (pi) => {
    const x0 = pi === pair[1] ? c : 0;
    const bt = bottomOf(page.blocks.filter((b) => b.x < x0 + c && b.x + b.w > x0));
    return { x0, cols: c, bottom: bt, free: sf.rows - bt, w: content.w };
  };
  return {
    ...base, sf, rect, boxes, pair, colX: X, half,
    content: { ...content, w: W * 2 - 2 * content.x },
    count: page.blocks.length, freeCells: sf.rows * sf.cols - cells, bottom, free: sf.rows - bottom,
  };
}

function singleLayout(doc, si, pi) {
  const sf = pageSf(doc, si, pi);
  const T = typeScale(sf.s * sf.k); // кегль полосы — под её сетку
  const Tb = typeScale(sf.s);        // колонтитулы — одинаковые на всех полосах
  const g = T.body.lead;
  const m = sf.margin;
  const inner = { x: m, y: m, w: sf.w - 2 * m, h: sf.h - 2 * m };
  const zine = sf.kind === 'zine';
  const hH = Tb.small.lead * 2;
  const top = zine && doc.hf.header.on ? hH : 0;
  const bot = zine && doc.hf.footer.on ? hH : 0;
  // обложки без колонтитулов: сетка того же размера, но по центру — место под колонтитулы делим поровну
  const bare = zine && doc.hf.skipCovers && (pi === 0 || pi === 7);
  const content = { x: inner.x, y: inner.y + (bare ? (top + bot) / 2 : top), w: inner.w, h: inner.h - top - bot };
  const rowH = (content.h - (sf.rows - 1) * g) / sf.rows;
  const colW = (content.w - (sf.cols - 1) * g) / sf.cols;
  const page = getPage(doc, si, pi);
  const rect = (r) => withEx({
    x: content.x + r.x * (colW + g), y: content.y + r.y * (rowH + g),
    w: r.w * colW + (r.w - 1) * g, h: r.h * rowH + (r.h - 1) * g,
  }, r, sf, () => g, g);
  const boxes = page.blocks.map((b) => ({ b, ...rect(b) }));
  const cells = page.blocks.reduce((a, b) => a + b.w * b.h, 0);
  const bottom = page.blocks.reduce((a, b) => Math.max(a, b.y + b.h), 0);
  return {
    sf, T, Tb, g, inner, content, rowH, colW, rect, boxes, page,
    count: page.blocks.length, freeCells: sf.rows * sf.cols - cells,
    bottom, free: sf.rows - bottom, // свободные ряды под последним блоком (для раскладки вставки)
    half: () => ({ x0: 0, cols: sf.cols, bottom, free: sf.rows - bottom, w: content.w }),
  };
}

// Ячейка сетки под точкой (мм от угла полосы)
export function cellAt(L, xm, ym) {
  // общая сетка разворота: колонки неравномерные (у корешка шире промежуток) — берём ближайшую
  let c = Math.floor((xm - L.content.x + L.g / 2) / (L.colW + L.g));
  if (L.colX) {
    let best = Infinity;
    for (let k = 0; k < L.sf.cols; k++) {
      const d = Math.abs(L.colX(k) + L.colW / 2 - xm);
      if (d < best) { best = d; c = k; }
    }
  }
  const r = Math.floor((ym - L.content.y + L.g / 2) / (L.rowH + L.g));
  return { cx: Math.max(0, Math.min(L.sf.cols - 1, c)), cy: Math.max(0, Math.min(L.sf.rows - 1, r)) };
}

function colontitles(doc, L, pi) {
  const n = pi + 1;
  if (doc.hf.skipCovers && (n === 1 || n === 8)) return [];
  const { Tb, inner } = L, st = Tb.small;
  const key = fontKey(doc.fonts.body, false, false);
  const fill = (tpl) => (tpl || '')
    .replace(/\{nn\}/g, String(n).padStart(2, '0')).replace(/\{n\}/g, n)
    .replace(/\{N\}/g, 8).replace(/\{title\}/g, doc.title || '');
  const items = [];
  const row = (cfg, base, ruleY) => {
    // зеркально: на левых полосах разворота (чётные номера) левая и правая части меняются местами,
    // чтобы номера стояли у внешних краёв
    const flip = doc.hf.mirror && n % 2 === 0;
    const parts = [['left', flip ? 1 : 0], ['center', 0.5], ['right', flip ? 0 : 1]];
    let any = false;
    for (const [k, a] of parts) {
      const s = fill(cfg[k]);
      if (!s) continue;
      any = true;
      const tw = W(key, s, st.size);
      items.push({ t: 'text', x: inner.x + (inner.w - tw) * a, y: base, s, key, size: st.size, fill: metaOf(L.ctx) });
    }
    if (any && doc.hf.rule) items.push({ t: 'line', x1: inner.x, y1: ruleY, x2: inner.x + inner.w, y2: ruleY, w: 0.15, stroke: metaOf(L.ctx) });
  };
  const capH = st.size * 0.35;
  if (doc.hf.header.on) row(doc.hf.header, inner.y + st.lead / 2 + capH, inner.y + st.lead * 1.25);
  if (doc.hf.footer.on) row(doc.hf.footer, inner.y + inner.h - st.lead / 2 + capH, inner.y + inner.h - st.lead * 1.25);
  return items;
}

// Вылеты (типография): bleed = {t, r, b, l} в мм — на сколько фон полосы уходит за её края,
// которые на листе оказываются у обреза. Кадр картинки задан рамкой полосы (frame), рисуется шире.
function bleedItem(it, bl) {
  const { t = 0, r = 0, b = 0, l = 0 } = bl;
  const c = it.clip;
  return {
    ...it, x: it.x - l, y: it.y - t, w: it.w + l + r, h: it.h + t + b, frame: { x: l, y: t, w: it.w, h: it.h },
    clip: c && { x: c.x - l, y: c.y - t, w: c.w + l + r, h: c.h + t + b },
  };
}

export function pageDL(doc, si, pi, { editor = false, print = false, bleed = null } = {}) {
  const L = singleLayout(doc, si, pi); // геометрия самой полосы: фон, колонтитулы
  const pair = spreadGridOf(doc, si, pi);
  const E = pair ? spreadLayout(doc, si, pair) : L; // откуда берутся блоки
  const dx = pair && pi === pair[1] ? -L.sf.w : 0;  // правая полоса — вторая половина разворота
  // выколотый текст — цвета бумаги; при печати на цветной бумаге — белый, т. е. без краски
  const knockFill = print && !doc.paperPrint ? '#ffffff' : doc.paper || '#ffffff';
  const ctx = { T: E.T, g: E.g, fonts: doc.fonts, editor, knockFill, ink: doc.colors.ink, accent: doc.colors.accent, meta: doc.colors.meta };
  L.ctx = ctx;
  const items = [];
  const info = {};
  // фон полосы: картинка на всю полосу до обреза + осветление цветом бумаги
  // общий фон разворота: картинка шириной в две полосы, каждая полоса показывает свою половину
  // (обложки «вместе» — тоже разворот: задняя слева, передняя справа)
  const sbg = spreadBgOf(doc, si, pi);
  const shared = sbg?.asset && assets[sbg.asset];
  const bg = shared ? sbg : L.page.bg;
  if (bg?.asset && assets[bg.asset]) {
    const span = shared ? { x: pi === pairOf(doc, si, pi)[0] ? 0 : -L.sf.w, w: L.sf.w * 2, clip: { x: 0, y: 0, w: L.sf.w, h: L.sf.h } } : { x: 0, w: L.sf.w };
    let im = invAfterMul({ t: 'image', ...span, y: 0, h: L.sf.h, asset: bg.asset, zoom: bg.zoom, px: bg.px, py: bg.py, filter: bg.filter, grain: bg.grain, blur: bg.blur || 0, invert: !!bg.invert, color: colorOf(ctx, bg.color), rot: bg.rot || 0, blend: bg.filter !== 'dither' ? bg.blend : undefined });
    // фон во весь кадр уходит в вылеты; уменьшенная картинка (масштаб < 100%) до края не доходит — ей не нужно
    const bl = print && bleed && (bg.zoom ?? 1) >= 1 ? bleed : null;
    if (bl) im = bleedItem(im, bl);
    items.push(im);
    // осветление: в редакторе — полупрозрачный слой цвета бумаги; в PDF запекается в саму картинку
    // (у отдельного слоя просмотрщики сглаживают край по-разному, и на краю полосы видна тёмная нить).
    // При «умножении» и при печати на цветной бумаге осветляем к белому — это «без краски»
    if (bg.fade > 0) {
      // при инверсии после умножения осветление идёт поверх результата — отдельным слоем и в PDF
      if (print && !items[items.length - 1].invMul) Object.assign(items[items.length - 1], { fade: bg.fade, fadeTo: (bg.filter !== 'dither' && bg.blend === 'multiply') || !doc.paperPrint ? '#ffffff' : doc.paper || '#ffffff' });
      else items.push(bl ? { t: 'rect', x: -(bl.l || 0), y: -(bl.t || 0), w: L.sf.w + (bl.l || 0) + (bl.r || 0), h: L.sf.h + (bl.t || 0) + (bl.b || 0), fill: doc.paper || '#ffffff', o: bg.fade }
        : { t: 'rect', x: 0, y: 0, w: L.sf.w, h: L.sf.h, fill: doc.paper || '#ffffff', o: bg.fade });
    }
  }
  const W = L.sf.w;
  for (const bx of E.boxes) {
    const r = buildBlock(bx.b, bx, ctx);
    info[bx.b.id] = { chars: r.chars, cap: r.cap, overflow: r.overflow, img: r.img, cols: r.cols, stack: r.stack, box: bx };
    const x0 = bx.x + dx;
    if (x0 >= W || x0 + bx.w <= 0) continue; // блок целиком на другой полосе разворота
    const its = r.items.map((it) => shift(it, x0, bx.y));
    // блок через корешок: каждая полоса рисует свою часть, обрезая по своему краю
    if (x0 < 0 || x0 + bx.w > W) items.push({ t: 'group', clip: { x: 0, y: 0, w: W, h: L.sf.h }, items: its });
    else items.push(...its);
  }
  if (L.sf.kind === 'zine') items.push(...colontitles(doc, L, pi));
  return { L, E, items, info };
}
