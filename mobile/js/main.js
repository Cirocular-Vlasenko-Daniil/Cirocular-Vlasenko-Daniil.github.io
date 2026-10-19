import * as M from './model.js?v=a0df7e09';
import { t as tr, getLang, bindLangSwitch } from './i18n.js?v=a0df7e09';
import { initAnalytics, track } from './analytics.js?v=a0df7e09';
import { initFonts, ensureFont, fontList, hasFont, previewFont } from './fonts.js?v=a0df7e09';
import { pageDL, pageLayout, cellAt } from './layout.js?v=a0df7e09';
import { randomPalette } from './palette.js?v=a0df7e09';
import { pageSVG, svgInner } from './render.js?v=a0df7e09';
import { assets, importImage, registerAsset, setOnReady, makeSampleAsset, effectiveDpi, dimsOf, containZoom } from './images.js?v=a0df7e09';
import { pagesZip } from './raster.js?v=a0df7e09';
import { buildPDF } from './pdf.js?v=a0df7e09';
import { htmlToMd, looksLikeMd } from './md.js?v=a0df7e09';
import { flowMarkdown } from './flow.js?v=a0df7e09';
import * as store from './store.js?v=a0df7e09';

const $ = (s) => document.querySelector(s);
const S = { doc: null, side: 0, page: 0, sel: null, view: 'pages', info: {} };
const canvas = $('#canvas'), nav = $('#nav'), insp = $('#inspector');

// ---------- пиксельные иконки ----------
const ICONS = {
  heading: ['########', '########', '...##...', '...##...', '...##...', '...##...', '...##...', '........'],
  text: ['########', '........', '########', '........', '########', '........', '#####...', '........'],
  quote: ['##......', '##.#####', '##......', '##.#####', '##......', '##.###..', '##......', '........'],
  image: ['########', '#......#', '#.##...#', '#.##...#', '#....#.#', '#...####', '########', '........'],
  imagecap: ['########', '#.#....#', '#...#..#', '#..#####', '########', '........', '#####...', '........'],
  divider: ['........', '........', '........', '#.#.#.#.', '........', '........', '........', '........'],
  qr: ['###..###', '#.#.##.#', '###..###', '..#.#...', '#.##..#.', '###.#.#.', '#.#..##.', '###.#..#'],
  left: ['########', '........', '#####...', '........', '#######.', '........', '####....', '........'],
  center: ['########', '........', '.######.', '........', '########', '........', '..####..', '........'],
  right: ['########', '........', '...#####', '........', '.#######', '........', '....####', '........'],
  justify: ['########', '........', '########', '........', '########', '........', '#####...', '........'],
  force: ['########', '........', '########', '........', '########', '........', '########', '........'],
  // вертикальные — те же значки, повёрнутые на 90° против часовой (заполняются ниже)
  spacer: ['##....##', '#......#', '........', '........', '........', '........', '#......#', '##....##'],
};
const rotCCW = (g) => g.map((_, y) => g.map((r) => r[7 - y]).join(''));
ICONS.vheading = rotCCW(ICONS.heading);
ICONS.vtext = rotCCW(ICONS.text);
const pix = (g) => `<svg class="ic" viewBox="0 0 8 8" shape-rendering="crispEdges">${g
  .map((r, y) => [...r].map((c, x) => (c === '#' ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : '')).join('')).join('')}</svg>`;
const icon = (t) => pix(ICONS[t]);

// Значки разделов свойств (плитки карусели на телефоне и планшете); ключ — название раздела
const SEC_ICONS = {
  'Текст': ICONS.text,
  'Вид': ICONS.center,
  'Цвет': ['...#....', '...##...', '..####..', '.######.', '.######.', '########', '.######.', '..####..'],
  'Размер': ['###..###', '#......#', '#......#', '........', '........', '#......#', '#......#', '###..###'],
  'Картинка': ICONS.image,
  'Обработка': ['#.#.#.#.', '.#.#.#..', '#.#.#...', '.#.#....', '#.#.#...', '.#.#.#..', '#.#.#.#.', '........'],
  'Кадр': ['.#......', '.#......', '######..', '.#...#..', '.#...#..', '..######', '.....#..', '.....#..'],
  'Подпись': ICONS.imagecap,
  'Стиль': ICONS.divider,
  'Ссылка': ICONS.qr,
  'Положение': ['########', '#......#', '#.##...#', '#.##...#', '#......#', '#......#', '#......#', '########'],
  'Страница': ['#####...', '#...##..', '#...###.', '#......#', '#......#', '#......#', '#......#', '########'],
  'Фон': ['########', '##.#.#.#', '#.#.#.##', '##.#.#.#', '#.#.#.##', '##.#.#.#', '#.#.#.##', '########'],
  'Лист': ['########', '#..#...#', '#..#...#', '########', '#..#...#', '#..#...#', '########', '........'],
  'Краски': ['###.###.', '###.###.', '###.###.', '........', '###.###.', '###.###.', '###.###.', '........'],
  'Шрифты': ['...##...', '..#..#..', '.#....#.', '.#....#.', '.######.', '.#....#.', '.#....#.', '........'],
  'Колонтитулы': ['########', '#.####.#', '#......#', '#......#', '#......#', '#......#', '#.####.#', '########'],
};
const secIcon = (k) => pix(SEC_ICONS[k] || ICONS.spacer);

// A/B: вид полосы разделов — 'icons' (плитки со значками, по умолчанию) или 'text' (прежние названия).
// Выбор держится в браузере: ?tabs=text / ?tabs=icons в адресе переключает
const TABS = (() => {
  try {
    const q = new URLSearchParams(location.search).get('tabs');
    if (q === 'text' || q === 'icons') localStorage.setItem('zine-tabs', q);
    return localStorage.getItem('zine-tabs') === 'text' ? 'text' : 'icons';
  } catch (e) { return 'icons'; }
})();
document.body.classList.add('tabs-' + TABS);

// ---------- утилиты ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let toastT;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.className = err ? 'err' : ''), 2600);
}
const side = () => S.doc.sides[S.side];
const spreadOf = (p) => M.spreads(S.doc, S.side).findIndex((s) => s.includes(p));
// фон текущей страницы: у обложек в режиме «вместе» — общий на обе
const bgHost = () => M.bgHost(S.doc, S.side, S.page);
const curBg = () => { const h = bgHost(); return h.obj[h.key]; };
const sel = () => (S.sel ? M.findBlock(S.doc, S.sel) : null);
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

// ---------- история и сохранение ----------
const H = { stack: [], i: -1 };
let saveT, commitT;
function commit() {
  clearTimeout(commitT);
  const snap = JSON.stringify(S.doc);
  if (snap === H.stack[H.i]) return;
  H.stack = H.stack.slice(0, H.i + 1);
  H.stack.push(snap);
  if (H.stack.length > 150) H.stack.shift();
  H.i = H.stack.length - 1;
  $('#saved').textContent = '…';
  clearTimeout(saveT);
  saveT = setTimeout(() => store.set('doc', S.doc).then(() => ($('#saved').textContent = tr('сохранено'))), 500);
  updateUndo();
}
const commitSoon = () => { clearTimeout(commitT); commitT = setTimeout(commit, 450); };
function restore(i) {
  H.i = i;
  S.doc = JSON.parse(H.stack[i]);
  if (S.sel && !M.findBlock(S.doc, S.sel)) S.sel = null;
  fixPos();
  store.set('doc', S.doc);
  renderAll();
}
const undo = () => { commit(); if (H.i > 0) restore(H.i - 1); };
const redo = () => { if (H.i < H.stack.length - 1) restore(H.i + 1); };
function updateUndo() {
  $('#undo').disabled = H.i <= 0;
  $('#redo').disabled = H.i >= H.stack.length - 1;
  const mu = document.querySelector('#mbar [data-proxy="undo"]'), mr = document.querySelector('#mbar [data-proxy="redo"]');
  if (mu) { mu.disabled = $('#undo').disabled; mr.disabled = $('#redo').disabled; }
}
function fixPos() {
  if (side().type === 'none' && S.side === 1) return;
  const n = M.pageCount(S.doc, S.side);
  if (S.page >= n) S.page = 0;
}

// ---------- рендер ----------
let raf;
function renderView() {
  if (!S.doc) return; // ещё грузимся
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => { renderStage(); renderNav(); updateMeter(); });
}
function renderAll() {
  renderTop();
  renderPalette();
  renderStage();
  renderNav();
  renderInspector();
}

function renderTop() {
  const d = S.doc;
  if (document.activeElement !== $('#title')) $('#title').value = d.title;
  const typ = { zine: tr('зин'), poster: tr('постер'), none: tr('пусто') };
  $('#sideTabs').innerHTML = [0, 1].map((i) =>
    `<button data-side="${i}" class="${S.side === i ? 'on' : ''}">${i ? 'B' : 'A'}${isMobile() ? '' : ' · ' + typ[d.sides[i].type]}</button>`).join('');
  document.querySelectorAll('#viewTabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  updateUndo();
}

function renderPalette() {
  // на виде «Лист» блоки не правятся — вместо плиток подсказка
  document.body.classList.toggle('sheet-view', S.view === 'sheet');
  document.body.classList.toggle('no-blocks', S.view === 'sheet' || side().type === 'none');
  if (S.view === 'sheet') {
    $('#palette').innerHTML = `<div class="note">${tr('Блоки добавляются на вкладке «Страницы»')}</div>`;
    return;
  }
  $('#palette').innerHTML = Object.entries(M.BLOCKS).map(([t, b]) =>
    `<div class="tile" data-type="${t}">${icon(t)}<b>${tr(b.name)}</b></div>`).join('');
}

function badgeText(b, inf) {
  if (!inf) return '';
  if (inf.overflow) return tr('не влезает');
  if ((b.type === 'image' || b.type === 'imagecap') && b.asset && b.filter !== 'dither') {
    const dpi = effectiveDpi(inf.img);
    if (dpi < 200) return `⚠ ${Math.round(dpi)} dpi`;
  }
  if (inf.cap != null) return tr('{a} / ~{b} зн.', { a: inf.chars, b: inf.cap });
  return '';
}

function pageHTML(si, pi, k) {
  const pair = M.spreadGridOf(S.doc, si, pi);
  const dl = pageDL(S.doc, si, pair ? pair[0] : pi, { editor: true });
  Object.assign(S.info, dl.info);
  // общая сетка: один холст на весь разворот, блоки и ячейки — в координатах разворота
  const { sf, boxes, rect } = pair ? dl.E : dl.L;
  let svg;
  if (pair) {
    const R = pageDL(S.doc, si, pair[1], { editor: true }), W = sf.pageW;
    const half = (x, items) => `<svg x="${x}" y="0" width="${W}" height="${sf.h}" viewBox="0 0 ${W} ${sf.h}">${svgInner(items)}</svg>`;
    svg = (rows) => `<svg class="pg" viewBox="0 0 ${sf.w} ${sf.h}" preserveAspectRatio="none" xml:space="preserve"><rect width="${sf.w}" height="${sf.h}" fill="${S.doc.paper}"/>${half(0, dl.items)}${half(W, R.items)}
      <line class="spine" x1="${W}" y1="0" x2="${W}" y2="${sf.h}"/>${rows}</svg>`;
  } else svg = (rows) => pageSVG(dl.items, sf.w, sf.h, rows, S.doc.paper);
  const pc = (v) => (v * 100).toFixed(4) + '%';
  let rows = '';
  for (let y = 0; y < sf.rows; y++) for (let x = 0; x < sf.cols; x++) {
    const c = rect({ x, y, w: 1, h: 1 });
    rows += `<rect class="row" x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}"/>`;
  }
  const ov = boxes.map((bx) => {
    const b = bx.b, inf = dl.info[b.id];
    const pan = (b.type === 'image' || b.type === 'imagecap') && b.asset && S.sel === b.id;
    return `<div class="blk${S.sel === b.id ? ' sel' : ''}${inf.overflow ? ' over' : ''}${pan ? ' pan' : ''}" data-id="${b.id}"
      style="left:${pc(bx.x / sf.w)};top:${pc(bx.y / sf.h)};width:${pc(bx.w / sf.w)};height:${pc(bx.h / sf.h)}">
      <i class="grip">${tr(M.BLOCKS[b.type].name)}</i><i class="rs" data-c="br"></i><i class="rs tr" data-c="tr"></i><i class="rs bl" data-c="bl"></i><span class="badge">${badgeText(b, inf)}</span></div>`;
  }).join('');
  const hint = '';
  const act = (pair ? pair.includes(S.page) : S.page === pi) && S.side === si ? ' active' : '';
  const label = pair ? `${M.pageLabel(S.doc, si, pair[0])} + ${M.pageLabel(S.doc, si, pair[1])} · ${tr('общая сетка')}` : M.pageLabel(S.doc, si, pi);
  return `<div class="pagewrap"><div class="page${act}${pair ? ' wide' : ''}" data-side="${si}" data-page="${pair ? pair[0] : pi}"${pair ? ` data-pair="${pair.join(',')}"` : ''} style="width:${px(sf.w * k)}px;height:${px(sf.h * k)}px;background:${S.doc.paper}">
    ${svg(rows)}${ov}${hint}</div><div class="plabel">${label}</div></div>`;
}

// Размеры холстов — в целых пикселях: дробный край страницы смешивался с подложкой
const px = (v) => Math.round(v);

function fitScale(w, h, padX = isMobile() ? 24 : 64, padY = isMobile() ? 44 : 90) {
  const r = canvas.getBoundingClientRect();
  return Math.max(0.5, Math.min((r.width - padX) / w, (r.height - padY) / h));
}

function renderStage() {
  const sd = side();
  if (sd.type === 'none' || S.view === 'sheet') { S.zoom = null; applyZoom(); }
  if (sd.type === 'none') {
    canvas.innerHTML = `<div class="empty"><div>${tr('Оборот листа пустой.')}</div><div class="btns">
      <button data-act="setB" data-val="poster">${tr('Сделать постер')}</button><button data-act="setB" data-val="zine">${tr('Второй зин')}</button></div></div>`;
    return;
  }
  const sf = M.surface(S.doc, S.side);
  if (S.view === 'sheet') return renderSheet(sf);
  const gp = M.spreadGridOf(S.doc, S.side, S.page);
  // Узкая сцена (телефон, планшет стоя): разворот целиком вышел бы мелким — страница крупно, как одна,
  // а её пара рисуется рядом в том же масштабе, приглушённой, и видна краем; к ней — свайпом.
  // Общая сетка остаётся одним листом в масштабе страницы и прокручивается по горизонтали.
  const narrow = sd.type === 'zine' && (isMobile() || fitScale(sf.w * 2, sf.h) < fitScale(sf.w, sf.h) * 0.6);
  const pad = isMobile() ? 48 : 64; // поле по бокам — чтобы пару было видно краем
  const pair = narrow && !gp && M.pairOf(S.doc, S.side, S.page);
  const hs = narrow && !!gp;
  let pages, k, shift = 0;
  if (sd.type === 'poster') { pages = [0]; k = fitScale(sf.w, sf.h); }
  else if (gp) { pages = [gp[0]]; k = hs ? fitScale(sf.w, sf.h, pad) : fitScale(sf.w * 2, sf.h); }
  else if (narrow) {
    pages = pair || [S.page];
    k = fitScale(sf.w, sf.h, pad); // один масштаб для всех страниц — без скачков при перелистывании
    if (pair) shift = ((pair[0] === S.page ? 1 : -1) * px(sf.w * k)) / 2; // выбранная страница — по центру
  } else { pages = M.spreads(S.doc, S.side)[spreadOf(S.page)]; k = fitScale(sf.w * pages.length, sf.h); }
  const keep = canvas.classList.contains('hscroll') ? canvas.scrollLeft : null;
  canvas.classList.toggle('hscroll', hs);
  canvas.innerHTML = `<div class="spread${pages.length > 1 ? ' two' : ''}${pair ? ' peek' : ''}" style="--shift:${shift}px" data-shift="${shift}">${pages.map((p) => pageHTML(S.side, p, k)).join('')}</div>`;
  if (pair) canvas.querySelectorAll('.page[data-page]').forEach((p) => +p.dataset.page !== S.page && p.closest('.pagewrap').classList.add('ctx'));
  if (hs) {
    // тот же разворот и та же половина — прокрутка остаётся, где была; иначе — к выбранной половине
    const key = `${S.side}:${gp[0]}:${S.page}`;
    canvas.scrollLeft = keep != null && S.hsKey === key ? keep : halfLeft(S.page === gp[1]);
    S.hsKey = key;
  }
  if (S.slideIn) { canvas.firstElementChild.classList.add(S.slideIn > 0 ? 'in-next' : 'in-prev'); S.slideIn = 0; }
  if (S.zoom && S.zoom.key !== zoomKey()) S.zoom = null; // другая страница — снова целиком
  applyZoom();
  if (S.draft) drawDraft();
  if (touchMode() && S.sel) placeTbar();
}

// ---------- увеличение страницы: щипок двумя пальцами; на компьютере — Ctrl/⌘ + колесо ----------
// Растр в редакторе считается в настоящем размере точек, так что увеличенный — тот же, что в печати.
// S.zoom = {z, tx, ty, key}: лента страниц .spread сдвигается и масштабируется от левого верхнего угла;
// координаты — в прокручиваемом содержимом холста. Без увеличения S.zoom = null.
const ZMAX = 6;
const zoomKey = () => { const gp = M.spreadGridOf(S.doc, S.side, S.page); return `${S.side}:${gp ? gp[0] : S.page}:${S.view}`; };
const canvasPt = (x, y) => { const r = canvas.getBoundingClientRect(); return { x: x - r.left + canvas.scrollLeft, y: y - r.top + canvas.scrollTop }; };
function zoomBase() {
  const spr = canvas.querySelector('.spread');
  if (!spr) return null;
  const z = S.zoom;
  return { spr, L: { x: spr.offsetLeft, y: spr.offsetTop }, z: z?.z || 1, t: z ? { x: z.tx, y: z.ty } : { x: +spr.dataset.shift || 0, y: 0 } };
}
function applyZoom() {
  const spr = canvas.querySelector('.spread'), z = S.zoom, badge = $('#zbadge');
  badge.hidden = !z;
  if (z) badge.innerHTML = `<b>${z.z.toFixed(1)}×</b> 1:1`;
  if (!spr) return;
  spr.style.transformOrigin = z ? '0 0' : '';
  spr.style.transform = z ? `translate(${z.tx}px, ${z.ty}px) scale(${z.z})` : '';
}
// Масштаб z, сдвиг t; лента не уезжает с экрана больше чем наполовину
function setZoom(z, tx, ty) {
  const b = zoomBase();
  if (!b) return;
  const w = b.spr.offsetWidth * z, h = b.spr.offsetHeight * z, vw = canvas.clientWidth, vh = canvas.clientHeight;
  const vx = canvas.scrollLeft;
  tx = Math.min(vx + vw / 2 - b.L.x, Math.max(vx + vw / 2 - b.L.x - w, tx));
  ty = Math.min(vh / 2 - b.L.y, Math.max(vh / 2 - b.L.y - h, ty));
  S.zoom = { z, tx, ty, key: zoomKey() };
  applyZoom();
}
// Масштаб с неподвижной точкой: что было под m (координаты холста), остаётся под m2
function zoomAt(z, m, m2 = m) {
  const b = zoomBase();
  if (!b) return;
  z = Math.min(ZMAX, Math.max(1, z));
  const lx = (m.x - b.L.x - b.t.x) / b.z, ly = (m.y - b.L.y - b.t.y) / b.z;
  setZoom(z, m2.x - b.L.x - z * lx, m2.y - b.L.y - z * ly);
}
// Обратно к целой странице (плавно)
function resetZoom(smooth = true) {
  const spr = canvas.querySelector('.spread');
  S.zoom = null;
  $('#zbadge').hidden = true;
  if (!spr) return;
  if (!smooth) { applyZoom(); return; }
  spr.style.transition = 'transform .2s ease-out';
  spr.style.transform = `translate(${+spr.dataset.shift || 0}px, 0px) scale(1)`;
  setTimeout(() => { spr.style.transition = ''; applyZoom(); retbar(); }, 210);
}
const retbar = () => { canvas.querySelector('.tbar')?.remove(); if (touchMode() && S.sel) placeTbar(); };
$('#zbadge').addEventListener('click', () => resetZoom());

// Пальцы на холсте: второй начинает щипок (жест первого отменяется)
const touches = new Map();
let pinch = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size !== 2 || S.view !== 'pages' || !canvas.querySelector('.spread')) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  gestureGen++;
  clearDnD();
  document.body.classList.remove('dnd');
  document.body.classList.add('pinching');
  const [a, b] = [...touches.values()];
  pinch = { ids: [...touches.keys()], m: canvasPt((a.x + b.x) / 2, (a.y + b.y) / 2), d: Math.hypot(a.x - b.x, a.y - b.y), z: S.zoom?.z || 1, base: zoomBase() };
}, true);
window.addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!pinch) return;
  const [a, b] = pinch.ids.map((id) => touches.get(id));
  if (!a || !b) return;
  // от начального положения: масштаб — по расстоянию между пальцами, сдвиг — по их середине
  const save = S.zoom;
  S.zoom = pinch.base.z > 1 || save ? { z: pinch.base.z, tx: pinch.base.t.x, ty: pinch.base.t.y, key: zoomKey() } : null;
  zoomAt(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.d), pinch.m, canvasPt((a.x + b.x) / 2, (a.y + b.y) / 2));
});
const fingerUp = (e) => {
  touches.delete(e.pointerId);
  if (!pinch || !pinch.ids.includes(e.pointerId)) return;
  pinch = null;
  document.body.classList.remove('pinching');
  if (!S.zoom || S.zoom.z < 1.05) resetZoom();
  else retbar();
};
window.addEventListener('pointerup', fingerUp);
window.addEventListener('pointercancel', fingerUp);

// Увеличенная страница: палец по столу вокруг неё двигает её
function panZoom(e) {
  const sx = e.clientX, sy = e.clientY, z0 = S.zoom, g = gestureGen;
  const move = (ev) => { if (g === gestureGen && S.zoom) setZoom(z0.z, z0.tx + ev.clientX - sx, z0.ty + ev.clientY - sy); };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); retbar(); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

// Компьютер: Ctrl/⌘ + колесо (и щипок на тачпаде) — масштаб у курсора; колесо без них двигает увеличенную
canvas.addEventListener('wheel', (e) => {
  if (S.view !== 'pages' || !canvas.querySelector('.spread')) return;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const k = Math.abs(e.deltaY) > 40 ? 0.002 : 0.01; // колесо мыши — крупные шаги, тачпад — мелкие
    const z = (S.zoom?.z || 1) * Math.exp(-e.deltaY * k);
    if (z <= 1.01) return S.zoom && resetZoom(false);
    zoomAt(z, canvasPt(e.clientX, e.clientY));
    return;
  }
  if (S.zoom) { e.preventDefault(); setZoom(S.zoom.z, S.zoom.tx - e.deltaX, S.zoom.ty - e.deltaY); }
}, { passive: false });

// Общая сетка на узком экране: где начинается видимая область, чтобы половина листа стояла по центру
// x страницы в прокручиваемом содержимом холста (offsetLeft не годится: у ленты есть transform)
const contentX = (el) => el.getBoundingClientRect().left - canvas.getBoundingClientRect().left + canvas.scrollLeft;
function halfLeft(right) {
  const pg = canvas.querySelector('.page[data-page]');
  if (!pg) return 0;
  const w = pg.offsetWidth / 2;
  return contentX(pg) + (right ? w : 0) - (canvas.clientWidth - w) / 2;
}
// Какая половина листа выбрана (курсор снизу и панель страницы следуют за прокруткой)
function setHalf(p) {
  if (S.page === p) return;
  S.page = p;
  S.hsKey = `${S.side}:${M.spreadGridOf(S.doc, S.side, p)[0]}:${p}`; // прокрутка уже там — не дёргать при перерисовке
  renderNav();
  if (!S.sel) renderInspector();
}
let hsT;
canvas.addEventListener('scroll', () => {
  if (!canvas.classList.contains('hscroll')) return;
  clearTimeout(hsT);
  hsT = setTimeout(() => {
    const gp = M.spreadGridOf(S.doc, S.side, S.page), pg = canvas.querySelector('.page[data-page]');
    if (!gp || !pg) return;
    const mid = canvas.scrollLeft + canvas.clientWidth / 2;
    setHalf(gp[mid > contentX(pg) + pg.offsetWidth / 2 ? 1 : 0]);
  }, 120);
}, { passive: true });

// Рамка места на странице: превью при перетаскивании и при рисовании пальцем
function insEl(L, r, cls = '') {
  const bx = L.rect(r), sf = L.sf, e = document.createElement('div');
  e.className = 'ins ' + cls;
  Object.assign(e.style, {
    left: (bx.x / sf.w) * 100 + '%', top: (bx.y / sf.h) * 100 + '%', width: (bx.w / sf.w) * 100 + '%', height: (bx.h / sf.h) * 100 + '%',
  });
  e.innerHTML = `<b>${r.w}×${r.h}</b>`;
  return e;
}

// ---------- касание: листать страницы свайпом ----------
// Быстрый горизонтальный взмах (не рисование): по одной странице, а если на экране
// разворот — разворотами. Возвращает false, если дальше листать некуда.
const isFlick = (dx, dy, dt) => !S.zoom && dt < 250 && Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy);
// Номер жеста: второй палец (щипок) увеличивает его — начатое первым пальцем отменяется
let gestureGen = 0;
function flipTo(page, dir) {
  S.page = page; S.sel = null; S.slideIn = dir;
  renderAll();
}
function flipPage(dir) {
  if (side().type !== 'zine') return false;
  if (S.zoom) resetZoom(false);
  const sp = M.spreads(S.doc, S.side), gp = M.spreadGridOf(S.doc, S.side, S.page);
  // общая сетка на узком экране: сначала прокрутка к другой половине листа
  if (gp && canvas.classList.contains('hscroll')) {
    const half = gp.indexOf(S.page) + dir;
    if (half === 0 || half === 1) {
      canvas.scrollTo({ left: halfLeft(half === 1), behavior: 'smooth' });
      setHalf(gp[half]);
      return true;
    }
  } else if (gp || canvas.querySelector('.spread.two:not(.peek)')) { // на экране разворот целиком — листаем разворотами
    const s = spreadOf(S.page) + dir;
    if (s < 0 || s >= sp.length) return false;
    flipTo(sp[s][0], dir);
    return true;
  }
  const order = sp.flat(), i = order.indexOf(S.page) + dir;
  if (i < 0 || i >= order.length) return false;
  const next = order[i], spr = canvas.querySelector('.spread.peek');
  const ctx = spr?.querySelector(`.pagewrap.ctx .page[data-page="${next}"]`)?.closest('.pagewrap');
  if (ctx) {
    // пара уже нарисована рядом — лента сдвигается, и она встаёт в центр
    spr.style.transition = 'transform .22s ease-out';
    spr.style.setProperty('--shift', -spr.dataset.shift + 'px');
    ctx.classList.remove('ctx');
    spr.querySelector('.pagewrap:not(.ctx) .page:not([data-page="' + next + '"])')?.closest('.pagewrap').classList.add('ctx');
    setTimeout(() => flipTo(next, 0), 220);
    return true;
  }
  flipTo(next, dir);
  return true;
}

// Нарисованное пальцем место ждёт выбора блока в меню
function drawDraft() {
  const d = S.draft, host = hostPage(d.si, d.pi);
  const pg = canvas.querySelector(`.page[data-side="${d.si}"][data-page="${host}"]`);
  if (pg) pg.appendChild(insEl(pageLayout(S.doc, d.si, host), d.r, 'draw'));
}

// Лёгкая отдача пальцу (Android); до первого касания браузер вибрацию запрещает
const buzz = (ms) => { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(ms); };

// ---------- касание: панель действий над выделенным блоком ----------
const COLOR_TYPES = new Set(['heading', 'vheading', 'text', 'vtext', 'quote', 'divider', 'qr']);
function placeTbar() {
  const el = canvas.querySelector('.blk.sel'), f = sel();
  if (!el || !f) return;
  const b = f.block, img = b.type === 'image' || b.type === 'imagecap';
  const color = COLOR_TYPES.has(b.type) || (img && b.filter === 'dither');
  const bar = document.createElement('div');
  bar.className = 'tbar';
  bar.innerHTML = `<button data-tb="edit">${img && !b.asset ? tr('Картинка…') : tr('Изменить')}</button><button data-tb="size">${tr('Размер')}</button>${color ? `<button data-tb="color">${tr('Цвет')}</button>` : ''}<button data-act="dup" aria-label="${tr('Дублировать')}">⧉</button><button data-act="del" aria-label="${tr('Удалить')}">✕</button>`;
  canvas.appendChild(bar);
  const cr = canvas.getBoundingClientRect(), br = el.getBoundingClientRect(), w = bar.offsetWidth, h = bar.offsetHeight;
  // над ярлыком блока; не помещается — под блоком (ниже счётчика знаков); совсем никак — поверх блока
  let top = br.top - cr.top - h - 26;
  if (top < 4) top = br.bottom - cr.top + 20;
  if (top + h > cr.height - 4) top = Math.max(4, br.top - cr.top + 4);
  const sl = canvas.scrollLeft; // общая сетка на узком экране: холст прокручивается
  bar.style.left = sl + Math.max(4, Math.min(cr.width - w - 4, br.left - cr.left)) + 'px';
  bar.style.top = top + 'px';
}

// Открыть раздел панели свойств: на телефоне — нижний лист (правка текста — на весь экран)
function openPart(part, focus) {
  const field = focus && insp.querySelector('[data-part="body"] textarea, [data-part="body"] input[type=text], [data-part="body"] input:not([type])');
  if (isMobile()) openSheet('inspector', !!field);
  const el = field || insp.querySelector(`[data-part="${part}"]`);
  if (!el) return;
  const sl = el.closest('.car-slide');
  if (sl) goSlide([...sl.parentElement.children].indexOf(sl), false);
  el.scrollIntoView({ block: 'start', inline: 'nearest' });
  if (field) { field.focus({ preventScroll: true }); return; }
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

function tbAct(k) {
  const f = sel();
  if (!f) return;
  const b = f.block;
  if (k === 'edit' && (b.type === 'image' || b.type === 'imagecap') && !b.asset) return act('pickImg');
  if (k === 'edit') return openPart('body', true);
  openPart(k);
}

// ---------- касание: меню «какой блок поставить» (кнопка «+» или нарисованное место) ----------
// Нарисованное место под блок типа type: размер подгоняется под его пределы; тап по одной
// ячейке — размер по умолчанию, накрывая эту ячейку
function draftRect(type, si, pi, r) {
  if (r.w === 1 && r.h === 1) return spotFor(type, si, pi, { cx: r.x, cy: r.y });
  const L = pageLayout(S.doc, si, pi), d = M.BLOCKS[type];
  const w = Math.min(L.sf.cols, Math.max(d.minW, r.w)), h = Math.min(L.sf.rows, d.maxH, Math.max(d.minH, r.h));
  const rr = { x: Math.max(0, Math.min(r.x, L.sf.cols - w)), y: Math.max(0, Math.min(r.y, L.sf.rows - h)), w, h };
  return M.canRect(L.page, L.sf, rr) ? rr : M.placeAt(L.page, L.sf, type, w, h, r.x, r.y);
}

// Плитки меню рядами: заголовки, тексты, служебные — горизонтальный, вертикальный, картинка в каждом ряду
const MENU_ORDER = ['heading', 'vheading', 'image', 'text', 'vtext', 'imagecap', 'quote', 'divider', 'qr'];
function openMenu() {
  const d = S.draft, si = d ? d.si : S.side, pi = d ? d.pi : S.page;
  const why = lim(si, pi);
  const items = MENU_ORDER.map((t) => [t, M.BLOCKS[t]]).map(([t, b]) => {
    const ok = !why && !!(d ? draftRect(t, si, pi, d.r) : spotFor(t, si, pi));
    return `<button data-new="${t}"${ok ? '' : ' disabled'}>${icon(t)}<span>${tr(b.name)}</span></button>`;
  }).join('');
  $('#tmenu').innerHTML = `<div class="tm-head"><b>${d && d.r.w * d.r.h > 1 ? tr('Блок {w} × {h}', { w: d.r.w, h: d.r.h }) : tr('Новый блок')}</b><button data-tm-close aria-label="${tr('Закрыть')}">✕</button></div>
    <div class="tm-grid">${items}</div>${why ? `<div class="note">${why}</div>` : d ? '' : `<div class="note">${tr('Или проведи пальцем по пустым ячейкам — блок встанет туда')}</div>`}`;
  // нарисованное место в нижней половине — меню сверху, чтобы его не закрыть
  const box = canvas.querySelector('.ins.draw')?.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
  $('#tmenu').classList.toggle('up', !!box && box.top + box.height / 2 > cr.top + cr.height / 2);
  $('#tmenu').hidden = false;
  document.body.classList.add('menu-open');
}
function closeMenu() {
  $('#tmenu').hidden = true;
  document.body.classList.remove('menu-open');
  if (S.draft) { S.draft = null; renderView(); }
}
const menuOpen = () => !$('#tmenu').hidden;
$('#fab').addEventListener('click', () => (menuOpen() ? closeMenu() : openMenu()));
$('#tmenu').addEventListener('click', (e) => {
  if (e.target.closest('[data-tm-close]')) return closeMenu();
  const bt = e.target.closest('[data-new]');
  if (!bt || bt.disabled) return;
  const type = bt.dataset.new, d = S.draft;
  const si = d ? d.si : S.side, pi = d ? d.pi : S.page;
  const r = d ? draftRect(type, si, pi, d.r) : null;
  S.draft = null;
  $('#tmenu').hidden = true;
  document.body.classList.remove('menu-open');
  if (!addBlock(type, si, pi, null, {}, r)) return;
  // сразу к делу: картинке — выбор файла, тексту — поле ввода
  if (type === 'image' || type === 'imagecap') act('pickImg');
  else if (type !== 'divider') openPart('body', true);
});

// Палец по пустым ячейкам рисует место будущего блока; отпустил — меню выбора блока.
// Короткий тап, пока выделен блок, только снимает выделение.
function startDraw(e, pg, si, pi, hadSel) {
  const host = +pg.dataset.page;
  const L = pageLayout(S.doc, si, host), br = pg.getBoundingClientRect();
  const c0 = cellOf(L, br, e), sx = e.clientX, sy = e.clientY, t0 = performance.now(), g = gestureGen;
  let r = { x: c0.cx, y: c0.cy, w: 1, h: 1 }, moved = false, el = null;
  const show = () => { el?.remove(); el = insEl(L, r, M.canRect(L.page, L.sf, r) ? 'draw' : 'draw bad'); pg.appendChild(el); };
  const move = (ev) => {
    if (g !== gestureGen) { el?.remove(); el = null; return; }
    const c = cellOf(L, br, ev);
    const nr = { x: Math.min(c0.cx, c.cx), y: Math.min(c0.cy, c.cy), w: Math.abs(c.cx - c0.cx) + 1, h: Math.abs(c.cy - c0.cy) + 1 };
    if (nr.x === r.x && nr.y === r.y && nr.w === r.w && nr.h === r.h) return;
    r = nr; moved = true;
    buzz(4);
    show();
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    el?.remove();
    if (g !== gestureGen) return; // стал щипком
    if (ev.type === 'pointerup' && isFlick(ev.clientX - sx, ev.clientY - sy, performance.now() - t0) && flipPage(ev.clientX < sx ? 1 : -1)) return;
    S.sel = null; S.side = si; S.page = pi;
    const ok = M.canRect(L.page, L.sf, r);
    if (!moved && (hadSel || !ok)) return renderAll();
    if (!ok) { renderAll(); return toast(tr('Здесь уже есть блоки — проведи по пустым ячейкам'), true); }
    S.draft = { si, pi, r };
    renderAll();
    openMenu();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  if (!hadSel) show();
}

// Выделенная картинка: палец ведёт — двигает кадр; держит на месте — берёт блок, чтобы перенести
function holdOrPan(e, id, payload, label) {
  const sx = e.clientX, sy = e.clientY, g = gestureGen;
  const stop = () => {
    clearTimeout(t);
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
  };
  const mv = (ev) => {
    if (g !== gestureGen) return stop();
    if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) { stop(); startPan(e, id); }
  };
  const t = setTimeout(() => { stop(); if (g !== gestureGen) return; buzz(12); startDrag(e, payload, label, 0); }, 450);
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
}

function renderSheet(sf) {
  const sd = side();
  if (sd.type === 'poster') {
    const k = fitScale(sf.w, sf.h);
    const { items } = pageDL(S.doc, S.side, 0);
    canvas.innerHTML = `<div class="sheetwrap"><div class="sheet" style="width:${px(sf.w * k)}px;height:${px(sf.h * k)}px;background:${S.doc.paper}">${pageSVG(items, sf.w, sf.h, '', S.doc.paper)}
      <div class="slot" data-goto="0" style="inset:0"></div></div><div class="legend" style="max-width:${sf.w * k}px"><div class="note">${tr('Постер · {f} · так он уйдёт в печать', { f: S.doc.format })}</div></div></div>`;
    return;
  }
  const [SW, SH] = M.FORMATS[S.doc.format].sheet;
  const k = fitScale(SW, SH);
  let g = '', slots = '';
  for (const [pi, c, r, rot] of M.IMPOSITION) {
    const { items } = pageDL(S.doc, S.side, pi);
    const x = c * sf.w, y = r * sf.h;
    g += `<g transform="translate(${x} ${y})${rot ? ` rotate(180 ${sf.w / 2} ${sf.h / 2})` : ''}">${svgInner(items)}</g>`;
    slots += `<div class="slot${rot ? ' rot' : ''}" data-goto="${pi}" style="left:${(x / SW) * 100}%;top:${(y / SH) * 100}%;width:${(sf.w / SW) * 100}%;height:${(sf.h / SH) * 100}%"><span>${pi + 1}</span></div>`;
  }
  const guide = (x1, y1, x2, y2, dash, col) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="0.25" stroke-dasharray="${dash}"/>`;
  const lines = [1, 2, 3].map((i) => guide(sf.w * i, 0, sf.w * i, SH, '0.5 1', '#9a9a9a')).join('')
    + guide(0, SH / 2, sf.w, SH / 2, '0.5 1', '#9a9a9a') + guide(sf.w * 3, SH / 2, SW, SH / 2, '0.5 1', '#9a9a9a')
    + guide(sf.w, SH / 2, sf.w * 3, SH / 2, '2 1', '#2b2b2b');
  canvas.innerHTML = `<div class="sheetwrap"><div class="sheet" style="width:${px(SW * k)}px;height:${px(SH * k)}px;background:${S.doc.paper}">
    <svg viewBox="0 0 ${SW} ${SH}" preserveAspectRatio="none" xml:space="preserve"><rect width="${SW}" height="${SH}" fill="${S.doc.paper}"/>${g}${lines}</svg>${slots}</div>
    <div class="legend" style="max-width:${SW * k}px"><div class="keys"><span><i></i>${tr('разрез')}</span><span><i class="d"></i>${tr('сгибы')}</span></div><div class="note">${tr('Лист {f} · верхний ряд печатается вверх ногами — так и нужно', { f: S.doc.format })}</div></div></div>`;
}

function thumbHTML(si, pi, h) {
  const sf = M.surface(S.doc, si);
  const { items, info } = pageDL(S.doc, si, pi);
  const over = Object.values(info).some((i) => i.overflow);
  const w = px((sf.w / sf.h) * h);
  return `<div class="thumb${S.page === pi ? ' on' : ''}${over ? ' over' : ''}" data-page="${pi}" data-side="${si}" style="width:${w}px;height:${h}px;background:${S.doc.paper}">
    <svg viewBox="0 0 ${sf.w} ${sf.h}" width="${w}" height="${h}" preserveAspectRatio="none" xml:space="preserve"><rect width="${sf.w}" height="${sf.h}" fill="${S.doc.paper}"/>${svgInner(items)}</svg><b>${sf.kind === 'poster' ? 'P' : pi + 1}</b></div>`;
}

function renderNav() {
  const sd = side();
  if (sd.type === 'none') { nav.innerHTML = ''; return; }
  const h = 64;
  const hint = '';
  if (sd.type === 'poster') { nav.innerHTML = `<div class="nsp">${thumbHTML(S.side, 0, h)}</div>${hint}`; return; }
  nav.innerHTML = M.spreads(S.doc, S.side).map((sp) => `<div class="nsp">${sp.map((p) => thumbHTML(S.side, p, h)).join('')}</div>`).join('') + hint;
}

// ---------- инспектор ----------
const seg = (attr, opts, cur, extra = '') =>
  `<div class="seg sm full" ${extra}>${opts.map(([v, l, dis]) =>
    `<button ${attr}="${v}" class="${String(cur) === String(v) ? 'on' : ''}" ${dis ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;

function renderInspector() {
  document.body.classList.toggle('has-sel', !!S.sel);
  const f = sel();
  const key = f ? f.block.type : 'doc', top = S.carKey === key ? insp.querySelector('.car-slide.on')?.scrollTop : 0;
  insp.innerHTML = f ? blockPanel(f) : docPanel();
  insp.classList.remove('has-car');
  $('#shTitle').textContent = f ? tr(M.BLOCKS[f.block.type].name) : tr('Настройки');
  if (touchMode()) buildCarousel(key, top);
  updateMeter();
}

// ---------- касание: свойства каруселью ----------
// Панель собирается как обычно, потом раскладывается по разделам с метками data-slide:
// сверху полоса названий, под ней разделы листаются свайпом. Открытый раздел запоминается
// для каждого вида блока (и для страницы) и не сбрасывается при перерисовке панели.
S.carIdx = {};
const DOC_ORDER = ['Лист', 'Страница', 'Фон', 'Краски', 'Шрифты', 'Колонтитулы'];
function buildCarousel(key, top) {
  const slides = [];
  let cur = null;
  const slide = (name, ico) => { cur = { name, ico, el: document.createElement('div') }; cur.el.className = 'car-slide'; slides.push(cur); };
  for (const sec of [...insp.children]) {
    if (sec.classList.contains('bhead')) continue;
    let wrap = null, part = sec.dataset.part;
    for (const node of [...sec.childNodes]) {
      if (node.nodeType === 1 && node.dataset.slide) {
        if (!cur || cur.name !== node.dataset.slide) slide(node.dataset.slide, node.dataset.ico);
        node.remove(); wrap = null; continue;
      }
      if (node.nodeType === 3 && !node.textContent.trim()) continue;
      if (!cur) slide(tr('Свойства'));
      if (!wrap || wrap.parentElement !== cur.el) {
        wrap = document.createElement('div');
        wrap.className = 'sec';
        if (part) { wrap.dataset.part = part; part = null; }
        cur.el.appendChild(wrap);
      }
      wrap.appendChild(node);
    }
    if (sec.parentElement === insp) sec.remove();
  }
  if (slides.length < 2) { insp.append(...slides.flatMap((x) => [...x.el.children])); return; }
  // свойства зина — от общего к частному: сначала лист, потом страница и её фон, потом оформление
  if (key === 'doc') {
    const rank = (x) => { const i = DOC_ORDER.indexOf(x.ico); return i < 0 ? DOC_ORDER.length : i; };
    slides.sort((a, b) => rank(a) - rank(b));
  }
  // заголовок раздела совпадает с названием в полосе — убираем повтор
  for (const x of slides) for (const w of x.el.children) {
    const l = w.firstElementChild;
    if (l?.classList.contains('lbl') && l.textContent.trim().toLowerCase() === x.name.toLowerCase()) l.remove();
  }
  // счётчик знаков — туда, где пишут текст
  const meter = insp.querySelector('#meter') || slides.flatMap((x) => [...x.el.querySelectorAll('#meter')])[0];
  const body = slides.find((x) => x.el.querySelector('[data-part="body"]'));
  if (meter && body && body.el.querySelector('textarea, input')) body.el.querySelector('[data-part="body"]').prepend(meter);
  const idx = Math.min(S.carIdx[key] || 0, slides.length - 1);
  const car = document.createElement('div');
  car.className = 'car';
  car.innerHTML = `<div class="car-tabs">${slides.map((x, i) => `<button data-car="${i}" class="${i === idx ? 'on' : ''}">${secIcon(x.ico)}<span>${esc(x.name)}</span></button>`).join('')}</div><div class="car-track"></div>`;
  const track = car.lastElementChild;
  slides.forEach((x, i) => { x.el.classList.toggle('on', i === idx); track.appendChild(x.el); });
  insp.appendChild(car);
  insp.classList.add('has-car');
  S.carKey = key;
  syncCarousel();
  if (top) track.children[idx].scrollTop = top;
  track.addEventListener('scroll', () => {
    const w = track.clientWidth;
    if (!w) return;
    const i = Math.round(track.scrollLeft / w);
    if (i !== S.carIdx[S.carKey]) setCarOn(i);
  }, { passive: true });
}
function setCarOn(i) {
  S.carIdx[S.carKey] = i;
  insp.querySelectorAll('.car-tabs button').forEach((b, k) => {
    b.classList.toggle('on', k === i);
    if (k === i) b.parentElement.scrollTo({ left: b.offsetLeft - (b.parentElement.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' });
  });
  insp.querySelectorAll('.car-slide').forEach((s, k) => s.classList.toggle('on', k === i));
}
// Поставить карусель на запомненный раздел (после перерисовки или когда панель стала видимой)
function syncCarousel() {
  const track = insp.querySelector('.car-track');
  if (!track || !track.clientWidth) return;
  track.scrollTo({ left: (S.carIdx[S.carKey] || 0) * track.clientWidth, behavior: 'instant' });
}
function goSlide(i, smooth) {
  const track = insp.querySelector('.car-track');
  if (!track) return;
  setCarOn(i);
  track.scrollTo({ left: i * track.clientWidth, behavior: smooth ? 'smooth' : 'instant' });
}

// Можно ли дать блоку ширину w / высоту h (ширину — со сдвигом влево, если упирается в край)
function sizeRect(f, L, w, h) {
  const b = f.block;
  const r = { x: Math.min(b.x, L.sf.cols - w), y: b.y, w, h };
  return M.canRect(f.page, L.sf, r, b.id) ? r : null;
}

// Выключка: пиксельные иконки вместо подписей
// у вертикальных блоков значки повёрнуты, как сам текст («влево» — строки от низа)
const isVert = (b) => b.type === 'vheading' || b.type === 'vtext';
const alignUI = (b, opts, label = tr('Выключка')) =>
  `<div class="fld"><label>${label}</label>${seg('data-set-align', opts.map((v) => [v, icon(v)]), b.align || 'left', isVert(b) ? 'data-vert' : '')}</div>`;

// Прилипание краёв к соседним рядам/колонкам: край перешагивает промежуток сетки
function exUI(f, L) {
  const b = f.block;
  const opts = [['t', '↑', tr('Верхний край')], ['r', '→', tr('Правый край')], ['b', '↓', tr('Нижний край')], ['l', '←', tr('Левый край')]];
  return `<div class="fld"><label>${tr('Края до соседних рядов')}</label><div class="seg sm full">${opts.map(([e, ic, t]) => {
    const on = !!b.ex?.[e], ok = on || M.exValid(f.page, L.sf, b, e);
    return `<button data-ex="${e}" class="${on ? 'on' : ''}" title="${t}" ${ok ? '' : 'disabled'}>${ic}</button>`;
  }).join('')}</div></div>`;
}

// Наложение Ч/Б картинки: обычное или «умножение» (белое прозрачно, видно бумагу и фон под картинкой)
const blendUI = (attr, cur) =>
  `<div class="fld"><label>${tr('Наложение')}</label>${seg(attr, [['normal', tr('Обычное')], ['multiply', tr('Умножение')]], cur || 'normal')}</div>`;

// Масштаб картинки: 100% — на всю рамку; меньше — картинка уменьшается внутри рамки
// (длинное лого целиком), предел — половина вписанного размера. «Целиком» — вписать по центру.
function zoomUI(o, box, attr, act) {
  const cz = box ? containZoom(o.asset, o.rot, box.w, box.h) : 1;
  const min = Math.max(0.05, Math.floor(Math.min(1, cz) * 50) / 100);
  return `<div class="fld"><label>${tr('Масштаб')} · ${Math.round(o.zoom * 100)}%</label><input type="range" min="${min}" max="3" step="0.01" value="${o.zoom}" ${attr}></div>
    ${cz < 0.999 ? `<div class="btns"><button data-act="${act}">${tr('Картинка целиком')}</button></div>` : ''}`;
}
// Рамка фона текущей страницы (мм): у общего фона разворота — две полосы
function bgBox() {
  const sf = M.surface(S.doc, S.side);
  return { w: bgHost().spread ? sf.w * 2 : sf.w, h: sf.h };
}

// Текущее положение QR-кода; у старых блоков — из qrpos и фактической раскладки
function qrPos(b, f) {
  const stack = pageDL(S.doc, f.si, f.pi, { editor: true }).info[b.id]?.stack;
  const end = b.qrpos === 'end';
  return { qrx: b.qrx || (end && !stack ? 'right' : 'left'), qry: b.qry || (end && stack ? 'bottom' : 'top') };
}

// Выбор краски элемента: основная или акцент (цвета задаются в настройках документа)
function inkUI(b, attr = 'data-set-color', cur = b.color) {
  const c = S.doc.colors;
  return `<div class="fld" data-part="color"><label>${tr('Краска')}</label>${seg(attr, [
    ['ink', `<i class="chip" style="background:${c.ink}"></i>${tr('Основная')}`],
    ['accent', `<i class="chip" style="background:${c.accent}"></i>${tr('Акцент')}`]], cur || 'ink')}</div>`;
}

// Выколотка и вертикальное положение — общие для текста, заголовка и цитаты
function knockUI(b) {
  const k = b.knock || '';
  return `${inkUI(b)}<div class="fld"><label>${tr('Выколотка')}</label>${seg('data-set-knock', [['', tr('Нет')], ['fit', tr('По тексту')], ['fill', tr('Весь блок')]], k)}</div>
    <div class="fld"><label>${k === 'fit' ? tr('Плашка прижата') : tr('Текст прижат')}</label>${seg('data-set-valign', isVert(b)
      ? [['top', tr('Слева')], ['middle', tr('Центр')], ['bottom', tr('Справа')]] // повёрнутый: «верх» блока — его левый край
      : [['top', tr('Верх')], ['middle', tr('Центр')], ['bottom', tr('Низ')]], b.valign || 'top')}</div>`;
}

// Метка начала раздела карусели свойств (на телефоне и планшете); на компьютере не видна
const mark = (key) => `<i class="slide-mark" data-slide="${tr(key)}" data-ico="${key}" hidden></i>`;

function blockPanel(f) {
  const b = f.block, def = M.BLOCKS[b.type];
  const mT = mark('Текст'), mV = mark('Вид'), mC = mark('Цвет');
  const L = pageLayout(S.doc, f.si, f.pi);
  const wOpts = [], hOpts = [];
  for (let w = def.minW; w <= L.sf.cols; w++) wOpts.push([w, w, !sizeRect(f, L, w, b.h)]);
  for (let h = def.minH; h <= Math.min(def.maxH, L.sf.rows); h++) hOpts.push([h, h, !sizeRect(f, L, b.w, h)]);
  const P = (k) => `data-prop="${k}"`;
  let body = '';
  const img = () => `${mark('Картинка')}
    <div class="fld"><label>${tr('Изображение')}</label>
      ${b.asset && assets[b.asset] ? `<img class="thumbimg" src="${assets[b.asset].url}" alt="">` : ''}
      <div class="btns"><button data-act="pickImg">${b.asset ? tr('Заменить…') : tr('Загрузить…')}</button>${b.asset ? `<button data-act="rotImg" title="${tr('Повернуть на 90°')}">↻ 90°</button><button data-act="rmImg">${tr('Убрать')}</button>` : ''}</div></div>
    ${mark('Обработка')}<div class="fld"><label>${tr('Обработка')}</label>${seg('data-set-filter', [['color', tr('Цвет')], ['gray', tr('Ч/Б')], ['dither', tr('Растр')]], b.filter)}</div>
    ${b.filter !== 'dither' ? blendUI('data-set-blend', b.blend) : ''}
    ${b.filter === 'dither' ? inkUI(b) : ''}
    ${b.filter === 'dither' || b.filter === 'gray' ? `<div class="fld"><label>${tr('Инверсия')}</label>${seg('data-set-invert', [[0, tr('Обычный')], [1, tr('Инверсия')]], b.invert ? 1 : 0)}</div>` : ''}
    ${b.filter === 'dither' ? `<div class="fld"><label>${tr('Зерно растра')} · ${b.grain.toFixed(2)} ${tr('мм')}</label><input type="range" min="0.15" max="1.2" step="0.05" value="${b.grain}" ${P('grain')} data-num></div>` : ''}
    ${b.asset && assets[b.asset] ? mark('Кадр') + zoomUI(b, S.info[b.id]?.img, `${P('zoom')} data-num`, 'fitImg') : ''}`;
  switch (b.type) {
    case 'heading':
    case 'vheading':
      body = `${mT}<div class="fld"><label>${tr('Текст')}</label><textarea rows="3" ${P('text')}>${esc(b.text)}</textarea></div>
        ${mV}<div class="fld"><label>${tr('Размер')}</label>${seg('data-set-size', [['S', 'S'], ['M', 'M'], ['L', 'L'], ['XL', 'XL']], b.size)}</div>
        ${alignUI(b, ['left', 'center', 'right'])}
        ${mC}${knockUI(b)}`;
      break;
    case 'vtext':
      body = `${mT}<div class="fld"><label>${tr('Текст')} <span class="colmeter" data-colmeter="0"></span></label>
          <textarea rows="10" ${P('text')}>${esc(b.text || '')}</textarea></div>
        ${mV}${alignUI(b, ['left', 'center', 'right', 'justify', 'force'])}
        <div class="fld"><label>${tr('Кегль')}</label>${seg('data-set-size', [['small', tr('Мелкий')], ['body', tr('Основной')], ['large', tr('Крупный')]], b.size)}</div>
        ${mC}${knockUI(b)}`;
      break;
    case 'text':
    {
      // колонок не больше, чем влезает при ширине колонки от 16 мм
      const bw = S.info[b.id]?.box.w ?? L.content.w;
      const colOk = (c) => (bw - L.g * (c - 1)) / c >= 16;
      const cols = Math.min(3, b.cols || 1);
      const zones = Array.from({ length: cols }, (_, c) => {
        const k = c ? 'text' + (c + 1) : 'text';
        const lab = cols > 1 ? tr('Колонка {n}', { n: c + 1 }) : tr('Текст');
        return `<div class="fld"><label>${lab} <span class="colmeter" data-colmeter="${c}"></span></label>
          <textarea rows="${cols > 1 ? 6 : 12}" ${P(k)}>${esc(b[k] || '')}</textarea></div>`;
      }).join('');
      body = `${mT}<div class="fld"><label>${tr('Колонки')}</label>${seg('data-set-cols', [[1, tr('Одна'), false], [2, tr('Две'), !colOk(2)], [3, tr('Три'), !colOk(3)]], cols)}</div>
        ${zones}
        ${mV}${alignUI(b, ['left', 'center', 'right', 'justify', 'force'])}
        <div class="fld"><label>${tr('Кегль')}</label>${seg('data-set-size', [['small', tr('Мелкий')], ['body', tr('Основной')], ['large', tr('Крупный')]], b.size)}</div>
        ${mC}${knockUI(b)}`;
    }
      break;
    case 'quote':
      body = `${mT}<div class="fld"><label>${tr('Цитата')}</label><textarea rows="4" ${P('text')}>${esc(b.text)}</textarea></div>
        <div class="fld"><label>${tr('Автор')}</label><input ${P('by')} value="${esc(b.by)}"></div>
        ${mV}<div class="fld"><label>${tr('Кегль')}</label>${seg('data-set-size', [['small', tr('Мелкий')], ['body', tr('Основной')], ['large', tr('Крупный')]], b.size || 'body')}</div>
        ${alignUI(b, ['left', 'center', 'right'])}
        ${mC}${knockUI(b)}`;
      break;
    case 'image': body = img(); break;
    case 'imagecap':
      body = img() + `${mark('Подпись')}<div class="fld"><label>${tr('Подпись')}</label><textarea rows="3" ${P('caption')}>${esc(b.caption)}</textarea></div>
        ${alignUI(b, ['left', 'center', 'right', 'justify', 'force'], tr('Выключка подписи'))}`;
      break;
    case 'divider':
      body = `${mark('Стиль')}<div class="fld"><label>${tr('Стиль')}</label>${seg('data-set-style', [['squares', '▪▪▪▪'], ['three', '▪ ▪ ▪'], ['line', '———'], ['dash', '- - -']], b.style)}</div>
        ${mC}${inkUI(b)}`;
      break;
    case 'qr':
      body = `${mark('Ссылка')}<div class="fld"><label>${tr('Ссылка')}</label><input ${P('url')} value="${esc(b.url)}"></div>
        <div class="fld"><label>${tr('Подпись')}</label><textarea rows="3" ${P('caption')}>${esc(b.caption)}</textarea></div>
        ${alignUI(b, ['left', 'center', 'right', 'justify', 'force'], tr('Выключка подписи'))}
        ${(() => {
          // положение кода по двум осям; «по центру» по горизонтали ставит подпись под код
          const { qrx, qry } = qrPos(b, f);
          return `${mark('Положение')}<div class="fld"><label>${tr('Код по горизонтали')}</label>${seg('data-set-qrx', [['left', tr('Слева')], ['center', tr('Центр')], ['right', tr('Справа')]], qrx)}</div>
            <div class="fld"><label>${tr('Код по вертикали')}</label>${seg('data-set-qry', [['top', tr('Сверху')], ['middle', tr('Центр')], ['bottom', tr('Снизу')]], qry)}</div>`;
        })()}
        ${mC}${inkUI(b)}
        <div class="fld"><label>${tr('Цвет кода')}</label>${seg('data-set-invert', [[0, tr('Обычный')], [1, tr('Инверсия')]], b.invert ? 1 : 0)}</div>
        ${mark('Картинка')}<div class="fld"><label>${tr('Картинка в коде')}</label>
          ${b.qrimg && assets[b.qrimg] ? `<img class="thumbimg" src="${assets[b.qrimg].url}" alt="">` : ''}
          <div class="btns"><button data-act="pickQr">${b.qrimg ? tr('Заменить…') : tr('Загрузить…')}</button>${b.qrimg ? `<button data-act="rmQr">${tr('Убрать')}</button>` : ''}</div></div>
        ${b.qrimg ? (() => {
          const mode = b.qrmode || 'pixel', size = b.qrsize || 0.3, zoom = b.qrzoom || 1;
          return `<div class="fld"><label>${tr('Режим')}</label>${seg('data-set-qrmode', [['pixel', tr('Пиксели')], ['center', tr('Растр')], ['full', tr('Весь код')]], mode)}</div>
          ${mode !== 'full' ? `<div class="fld"><label>${tr('Размер области')} · ${Math.round(size * 100)}%</label><input type="range" min="0.15" max="0.35" step="0.01" value="${size}" data-prop="qrsize" data-num></div>` : ''}
          ${(() => {
            // область картинки в коде квадратная; меньше 100% — картинка уменьшается внутри неё (лого целиком)
            const cz = containZoom(b.qrimg, 0, 1, 1), min = Math.max(0.1, Math.floor(Math.min(1, cz) * 50) / 100);
            return `<div class="fld"><label>${tr('Масштаб картинки')} · ${Math.round(zoom * 100)}%</label><input type="range" min="${min}" max="3" step="0.01" value="${zoom}" data-prop="qrzoom" data-num></div>
              ${cz < 0.999 ? `<div class="btns"><button data-act="fitQr">${tr('Картинка целиком')}</button></div>` : ''}`;
          })()}
          <div class="fld"><label>${tr('Детализация')}</label>${seg('data-set-qrver', [[0, tr('Авто')], [5, '37'], [7, '45'], [10, '57']], b.qrver || 0)}</div>
          <div class="fld"><label>${tr('Инверсия картинки')}</label>${seg('data-set-qrimginvert', [[0, tr('Обычный')], [1, tr('Инверсия')]], b.qrimginvert ? 1 : 0)}</div>`;
        })() : ''}`;
      break;
  }
  const hasMeter = ['heading', 'text', 'quote', 'imagecap', 'qr', 'vheading', 'vtext'].includes(b.type);
  const size = `<div class="sec" data-part="size">${mark('Размер')}<div class="fld"><label>${tr('Ширина')}</label>${seg('data-size-w', wOpts, b.w)}</div>
      <div class="fld"><label>${tr('Высота')}</label>${seg('data-size-h', hOpts, b.h)}</div>
      ${exUI(f, L)}
      ${hasMeter ? '<div class="meter" id="meter"><div class="cells"></div><div class="mtxt"></div></div>' : ''}</div>`;
  const main = `<div class="sec" data-part="body">${body}</div>`;
  // на касании разделы листаются каруселью — первым идёт содержимое блока
  return `<div class="sec bhead"><div class="ihead">${icon(b.type)}<b>${tr(def.name)}</b><span class="grow"></span>
      <button data-act="dup" title="${tr('Дублировать (⌘D)')}">⧉</button><button data-act="del" title="${tr('Удалить (Del)')}">✕</button></div></div>
    ${touchMode() ? main + size : size + main}`;
}

// шрифты по группам — список длинный, так в нём легче ориентироваться
const FONT_CATS = [['sans', 'Гротески'], ['serif', 'Антиквы'], ['display', 'Акцидентные'], ['hand', 'Рукописные'], ['mono', 'Моноширинные']];

function fontPick(role, cur) {
  const fonts = fontList(), f = fonts.find((x) => x.id === cur) || fonts[0];
  const item = (x) => `<button data-fp-role="${role}" data-fp-id="${x.id}" class="${x.id === f.id ? 'on' : ''}">
      <span class="fp-name" data-fid="${x.id}" style="font-family:'zfp-${x.id}', 'UI'">${esc(x.name)}</span>
      <small>${x.role === 'heading' ? tr('для заголовков') : tr('для текста')}</small></button>`;
  const groups = FONT_CATS.map(([c, name]) => {
    const fs = fonts.filter((x) => (x.cat || 'sans') === c);
    return fs.length ? `<div class="fp-group">${tr(name)}</div>${fs.map(item).join('')}` : '';
  }).join('');
  previewFont(f.id).then(() => insp.querySelectorAll(`.fp-name[data-fid="${f.id}"]`).forEach((e) => e.classList.add('ok')));
  return `<div class="fontpick" data-fontpick="${role}">
    <button class="fp-cur"><span class="fp-name" data-fid="${f.id}" style="font-family:'zfp-${f.id}', 'UI'">${esc(f.name)}</span><i>▾</i></button>
    <div class="fp-list" hidden>${groups}</div></div>`;
}

function docPanel() {
  const d = S.doc, sd = side();
  let pageSec = '';
  if (sd.type !== 'none' && S.view !== 'sheet') { // на виде «Лист» — только настройки листа
    const L = pageLayout(d, S.side, S.page);
    const kind = L.sf.kind, cur = `${L.sf.pageCols || L.sf.cols}x${L.sf.rows}`; // у общей сетки — сетка одной полосы
    const def = M.GRID_DEF[kind].join('x');
    const grids = M.GRIDS[kind].map(([c, r]) => {
      const v = `${c}x${r}`;
      return `<option value="${v}" ${v === cur ? 'selected' : ''}>${c} × ${r}</option>`;
    }).join('');
    const joined = M.coversJoined(d, S.side), cover = kind === 'zine' && M.isCover(S.page);
    const host = bgHost(), pair = M.pairOf(d, S.side, S.page);
    const bg = curBg() || {};
    const hasBg = bg.asset && assets[bg.asset];
    // в режиме «вместе» у обложки может остаться свой фон — он виден, пока нет общего
    const ownBg = M.getPage(d, S.side, S.page).bg; // у общей сетки L.page — левая полоса, фон берём у текущей
    const own = joined && cover && !hasBg && ownBg?.asset && assets[ownBg.asset];
    const bgTitle = !host.spread ? tr('Фон страницы') : cover ? tr('Общий фон обложек') : tr('Фон разворота');
    pageSec = `<div class="sec">${mark('Страница')}<div class="ihead"><b>${M.pageLabel(d, S.side, S.page)}</b></div>
      <div class="btns"><button data-act="clearPage" ${L.boxes.length ? '' : 'disabled'}>${L.pair ? tr('Очистить разворот') : tr('Очистить страницу')}</button></div></div>
    <div class="sec"><div class="fld"><label>${tr('Сетка')}</label><select data-grid>${grids}</select></div>
      ${kind === 'zine' ? `<div class="btns"><button data-act="gridAll">${tr('Применить ко всем страницам')}</button></div>` : ''}
      ${M.pairOf(d, S.side, S.page) ? `<div class="fld"><label>${tr('Сетка разворота')}</label>${seg('data-spread-grid', [[0, tr('По страницам')], [1, tr('Общая')]], L.pair ? 1 : 0)}</div>
      ${L.pair ? `<div class="hint">${tr('Блоки можно тянуть через корешок — например, картинку на весь разворот. Текст на сгибе читается плохо, лучше оставлять его на одной странице.')}</div>` : ''}` : ''}</div>
    ${cover ? `<div class="sec"><div class="fld"><label>${tr('Обложки')}</label>${seg('data-join-covers', [[0, tr('Отдельно')], [1, tr('Вместе')]], joined ? 1 : 0)}</div>
      ${joined ? `<div class="hint">${tr('Задняя и передняя обложки рядом, как на листе. Фон можно сделать общим — он перейдёт через корешок.')}</div>` : ''}</div>` : ''}
    <div class="sec">${mark('Фон')}<div class="lbl">${bgTitle}</div>
      ${own ? `<div class="hint">${tr('Сейчас у этой обложки свой фон. Общий фон его заменит.')}</div><div class="btns"><button data-act="rmOwnBg">${tr('Убрать свой фон')}</button></div>` : ''}
      ${hasBg ? `<img class="thumbimg" src="${assets[bg.asset].url}" alt="">` : ''}
      <div class="btns"><button data-act="pickBg">${hasBg ? tr('Заменить…') : tr('Загрузить…')}</button>${hasBg ? `<button data-act="rotBg" title="${tr('Повернуть на 90°')}">↻ 90°</button><button data-act="rmBg">${tr('Убрать')}</button>` : ''}</div>
      ${pair && !host.spread ? `<div class="btns"><button data-act="pickSpreadBg">${tr('Картинка на весь разворот…')}</button></div>` : ''}
      ${hasBg ? `<div class="fld"><label>${tr('Обработка')}</label>${seg('data-bg-filter', [['color', tr('Цвет')], ['gray', tr('Ч/Б')], ['dither', tr('Растр')]], bg.filter)}</div>
      ${bg.filter !== 'dither' ? blendUI('data-bg-blend', bg.blend) : ''}
      ${bg.filter === 'dither' ? inkUI(bg, 'data-bg-color', bg.color) : ''}
      ${bg.filter === 'dither' || bg.filter === 'gray' ? `<div class="fld"><label>${tr('Инверсия')}</label>${seg('data-bg-invert', [[0, tr('Обычный')], [1, tr('Инверсия')]], bg.invert ? 1 : 0)}</div>` : ''}
      ${bg.filter === 'dither' ? `<div class="fld"><label>${tr('Зерно растра')} · ${bg.grain.toFixed(2)} ${tr('мм')}</label><input type="range" min="0.15" max="1.2" step="0.05" value="${bg.grain}" data-bgprop="grain"></div>` : ''}
      <div class="fld"><label>${tr('Блюр')} · ${(bg.blur || 0).toFixed(1)} ${tr('мм')}</label><input type="range" min="0" max="6" step="0.1" value="${bg.blur || 0}" data-bgprop="blur"></div>
      <div class="fld"><label>${tr('Осветление')} · ${Math.round(bg.fade * 100)}%</label><input type="range" min="0" max="0.9" step="0.05" value="${bg.fade}" data-bgprop="fade"></div>
      ${zoomUI(bg, bgBox(), 'data-bgprop="zoom"', 'fitBg')}
      <div class="fld"><label>${tr('Сдвиг ↔')}</label><input type="range" min="0" max="1" step="0.01" value="${bg.px}" data-bgprop="px"></div>
      <div class="fld"><label>${tr('Сдвиг ↕')}</label><input type="range" min="0" max="1" step="0.01" value="${bg.py}" data-bgprop="py"></div>`
      : ''}</div>`;
  }
  const anyPoster = d.sides.some((s) => s.type === 'poster');
  const hf = d.hf;
  const hfRow = (k) => `<div class="row2">${['left', 'center', 'right'].map((p) =>
    `<input data-hf="${k}.${p}" value="${esc(hf[k][p])}" placeholder="${{ left: tr('слева'), center: tr('центр'), right: tr('справа') }[p]}" title="${tr('{n} номер · {nn} 01 · {N} всего · {title} название')}" ${hf[k].on ? '' : 'disabled'}>`).join('')}</div>`;
  const titleSec = isMobile()
    ? `<div class="sec">${mark('Лист')}<div class="fld"><label>${tr('Название')}</label><input data-doc-title value="${esc(d.title)}"></div></div>` : '';
  return `${pageSec}${titleSec}
  <div class="sec">${mark('Лист')}<div class="lbl">${tr('Лист')}</div>
    <div class="fld"><label>${tr('Формат')}</label>${seg('data-doc-format', [['A4', 'A4'], ['A3', 'A3'], ['Letter', 'Letter']], d.format)}</div>
    <div class="fld"><label>${tr('Сторона A')}</label>${seg('data-side-a', [['zine', tr('Зин')], ['poster', tr('Постер')]], d.sides[0].type)}</div>
    <div class="fld"><label>${tr('Сторона B')}</label>${seg('data-side-b', [['none', tr('Пусто')], ['poster', tr('Постер')], ['zine', tr('Зин')]], d.sides[1].type)}</div>
    ${mark('Краски')}<div class="btns"><button data-act="randPalette" title="${tr('Бумага и три краски по правилам колористики')}">${tr('Случайная палитра')}</button></div>
    ${['ink', 'accent', 'meta'].map((k) => {
      const cur = d.colors[k].toLowerCase();
      const list = k === 'meta' ? M.META_INKS : M.INKS;
      const lab = { ink: tr('Основная краска'), accent: tr('Акцентная краска'), meta: tr('Системная краска') }[k];
      return `<div class="fld"><label>${lab}</label><div class="swatches">${list.map(([c, n]) =>
        `<button class="sw${cur === c ? ' on' : ''}" data-ink="${k}" data-val="${c}" title="${tr(n)}" style="background:${c}"></button>`).join('')}
        <label class="sw custom${list.some(([c]) => c === cur) ? '' : ' on'}" title="${tr('свой цвет')}" style="background:${cur}"><input type="color" value="${cur}" data-ink-custom="${k}"></label></div></div>`;
    }).join('')}
    <div class="fld"><label>${tr('Цвет бумаги')}</label><div class="swatches">${M.PAPERS.map(([c, n]) =>
      `<button class="sw${d.paper.toLowerCase() === c ? ' on' : ''}" data-paper="${c}" title="${tr(n)}" style="background:${c}"></button>`).join('')}
      <label class="sw custom${M.PAPERS.some(([c]) => c === d.paper.toLowerCase()) ? '' : ' on'}" title="${tr('свой цвет')}" style="background:${d.paper}"><input type="color" value="${d.paper}" data-paper-custom></label></div></div>
    <label class="chk"><input type="checkbox" data-paperprint ${d.paperPrint ? '' : 'checked'}> ${tr('Цветная бумага: фон не печатать')}</label>
    ${anyPoster ? `<div class="fld"><label>${tr('Ориентация постера')}</label>${seg('data-orient', [['portrait', tr('Книжная')], ['landscape', tr('Альбомная')]], (d.sides.find((s) => s.type === 'poster')).poster.orient)}</div>` : ''}
  </div>
  <div class="sec">${mark('Шрифты')}<div class="lbl">${tr('Шрифты')}</div>
    <div class="fld"><label>${tr('Заголовки')}</label>${fontPick('heading', d.fonts.heading)}</div>
    <div class="fld"><label>${tr('Текст')}</label>${fontPick('body', d.fonts.body)}</div>
  </div>
  <div class="sec">${mark('Колонтитулы')}<div class="lbl">${tr('Колонтитулы')}</div>
    <label class="chk"><input type="checkbox" data-hfon="header" ${hf.header.on ? 'checked' : ''}> ${tr('Верхний')}</label>${hfRow('header')}
    <label class="chk"><input type="checkbox" data-hfon="footer" ${hf.footer.on ? 'checked' : ''}> ${tr('Нижний')}</label>${hfRow('footer')}
    <label class="chk"><input type="checkbox" data-hfopt="skipCovers" ${hf.skipCovers ? 'checked' : ''}> ${tr('Не ставить на обложки')}</label>
    <label class="chk"><input type="checkbox" data-hfopt="mirror" ${hf.mirror ? 'checked' : ''}> ${tr('Зеркально на разворотах')}</label>
    <label class="chk"><input type="checkbox" data-hfopt="rule" ${hf.rule ? 'checked' : ''}> ${tr('Линейка')}</label>
  </div>`;
}

function updateMeter() {
  const m = $('#meter');
  const f = sel();
  if (!m || !f) return;
  const inf = S.info[f.block.id];
  if (!inf || inf.cap == null) return;
  const n = 24, fill = Math.min(n, Math.round((inf.chars / Math.max(1, inf.cap)) * n));
  m.classList.toggle('over', !!inf.overflow);
  m.querySelector('.cells').innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < fill ? 'f' : ''}"></i>`).join('');
  m.querySelector('.mtxt').textContent = inf.overflow
    ? tr('{a} / ~{b} зн. · не влезает', { a: inf.chars, b: inf.cap })
    : tr('{a} / ~{b} зн.', { a: inf.chars, b: inf.cap });
  // счётчики по колонкам текстового блока
  (inf.cols || []).forEach((c, i) => {
    const el = insp.querySelector(`[data-colmeter="${i}"]`);
    if (!el || inf.cols.length < 2) return;
    el.textContent = c.overflow ? tr('· {a} зн., не влезает', { a: c.chars }) : `· ${c.chars} / ~${c.cap}`;
    el.classList.toggle('bad', c.overflow);
  });
}

// ---------- операции ----------
// Полоса, на которой хранятся блоки: у общей сетки разворота — левая
const hostPage = (si, pi) => (M.spreadGridOf(S.doc, si, pi) || [pi])[0];
const lim = (si, pi, exceptId) => {
  const L = pageLayout(S.doc, si, pi);
  const n = L.page.blocks.filter((b) => b.id !== exceptId).length;
  return n >= L.sf.maxBlocks ? tr(L.pair ? 'На развороте максимум {n} блоков' : 'На странице максимум {n} блоков', { n: L.sf.maxBlocks }) : null;
};

// Куда встанет блок: накрывая ячейку cell или в первое свободное место; ужимается до минимума
function spotFor(type, si, pi, cell, pw, ph, exceptId) {
  const L = pageLayout(S.doc, si, pi);
  const d = M.BLOCKS[type];
  // в общей сетке «на всю ширину» по умолчанию — ширина одной полосы
  const w = pw ?? (L.pair ? Math.min(d.w, L.sf.pageCols) : d.w), h = ph ?? d.h;
  return cell
    ? M.placeAt(L.page, L.sf, type, w, h, cell.cx, cell.cy, exceptId)
    : M.placeFree(L.page, L.sf, type, w, h, exceptId);
}


function addBlock(type, si, pi, cell, props = {}, r = null) {
  const why = lim(si, pi);
  if (why) { toast(why, true); return null; }
  r ||= spotFor(type, si, pi, cell);
  if (!r) { toast(tr('Нет свободного места под этот блок'), true); return null; }
  const b = M.mkBlock(type, r, props);
  const page = M.getPage(S.doc, si, hostPage(si, pi));
  page.blocks.push(b);
  M.sortBlocks(page);
  S.sel = b.id; S.side = si; S.page = pi;
  commit(); renderAll();
  return b;
}

// Сдвинуть раздвинутые блоки на новые ряды (план из M.pushPlan)
function applyPush(si, pi, plan) {
  const page = M.getPage(S.doc, si, hostPage(si, pi)), sf = pageLayout(S.doc, si, pi).sf;
  for (const b of page.blocks) if (plan[b.id] !== undefined) b.y = plan[b.id];
  for (const b of page.blocks) if (plan[b.id] !== undefined) M.fixEx(page, sf, b);
}

function moveBlock(id, si, pi, r) {
  const f = M.findBlock(S.doc, id);
  f.page.blocks.splice(f.idx, 1);
  Object.assign(f.block, r);
  const page = M.getPage(S.doc, si, hostPage(si, pi));
  page.blocks.push(f.block);
  M.fixEx(page, pageLayout(S.doc, si, pi).sf, f.block); // прилипание — только если на новом месте возможно
  M.sortBlocks(page);
  S.page = pi; S.side = si;
  commit(); renderAll();
}

// Стрелки: сдвиг выделенного блока на одну ячейку, если там свободно
function nudge(dx, dy) {
  const f = sel();
  const L = pageLayout(S.doc, f.si, f.pi);
  const b = f.block, r = { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
  if (!M.canRect(f.page, L.sf, r, b.id)) return;
  Object.assign(b, r);
  M.fixEx(f.page, L.sf, b);
  M.sortBlocks(f.page);
  commit(); renderAll();
}

// Разобрать общую сетку разворота на две полосы. Сначала пробуем на копии: если блоку через
// корешок негде встать, ничего не меняем и просим освободить место.
function splitGrid(pair) {
  const probe = structuredClone(S.doc);
  if (M.splitSpreadGrid(probe, S.side, pair).length) {
    toast(tr('Блоку через корешок не хватает места на странице — освободи место или уменьши его'), true);
    return false;
  }
  M.splitSpreadGrid(S.doc, S.side, pair);
  return true;
}

// Меняет сетку полосы с пересчётом блоков; false — если блоки не влезают
function applyGrid(pi, cols, rows) {
  const pair = M.spreadGridOf(S.doc, S.side, pi);
  if (pair) {
    // общая сетка: меняем сетку обеих полос, блоки пересчитываем на сетке разворота
    const [l, r] = pair, page = M.getPage(S.doc, S.side, l);
    const from = M.pageSf(S.doc, S.side, l);
    if (from.cols === cols && from.rows === rows) return true;
    const blocks = M.remapGrid(page, { cols: from.cols * 2, rows: from.rows }, { cols: cols * 2, rows });
    if (!blocks) return false;
    page.blocks = blocks;
    page.grid = [cols, rows];
    M.getPage(S.doc, S.side, r).grid = [cols, rows];
    return true;
  }
  const page = M.getPage(S.doc, S.side, pi);
  const from = M.pageSf(S.doc, S.side, pi);
  if (from.cols === cols && from.rows === rows) return true;
  const blocks = M.remapGrid(page, from, { cols, rows });
  if (!blocks) return false;
  page.blocks = blocks;
  page.grid = [cols, rows];
  return true;
}

function setSize(w, h) {
  const f = sel();
  if (!f) return;
  const L = pageLayout(S.doc, f.si, f.pi);
  const r = sizeRect(f, L, w, h);
  if (!r) return;
  Object.assign(f.block, r);
  M.fixEx(f.page, L.sf, f.block);
  M.sortBlocks(f.page);
  commit(); renderAll();
}

function act(a, el) {
  const f = sel();
  switch (a) {
    case 'del': if (f) { f.page.blocks.splice(f.idx, 1); S.sel = null; commit(); renderAll(); } break;
    case 'dup': if (f) {
      const why = lim(f.si, f.pi);
      if (why) return toast(why, true);
      const r = spotFor(f.block.type, f.si, f.pi, null, f.block.w, f.block.h);
      if (!r) return toast(tr('Нет свободного места для копии'), true);
      const b = { ...structuredClone(f.block), id: M.uid(), ...r };
      delete b.ex; // копия встаёт в другое место — прилипание не переносим
      f.page.blocks.push(b); M.sortBlocks(f.page); S.sel = b.id; commit(); renderAll();
    } break;
    case 'pickImg': S.pickBg = false; S.pickQr = false; $('#fileImg').click(); break;
    case 'pickBg': S.pickBg = true; S.pickQr = false; $('#fileImg').click(); break;
    case 'pickSpreadBg': S.pickBg = 'spread'; S.pickQr = false; $('#fileImg').click(); break;
    case 'fitImg': if (f) {
      const box = S.info[f.block.id]?.img;
      if (box) Object.assign(f.block, { zoom: +containZoom(f.block.asset, f.block.rot, box.w, box.h).toFixed(4), px: 0.5, py: 0.5 });
      commit(); renderAll();
    } break;
    case 'fitQr': if (f?.block.qrimg) { f.block.qrzoom = +containZoom(f.block.qrimg, 0, 1, 1).toFixed(4); commit(); renderAll(); } break;
    case 'fitBg': { const bg = curBg(), box = bgBox(); if (bg) { Object.assign(bg, { zoom: +containZoom(bg.asset, bg.rot, box.w, box.h).toFixed(4), px: 0.5, py: 0.5 }); commit(); renderAll(); } } break;
    case 'rotImg': if (f) { f.block.rot = ((f.block.rot || 0) + 90) % 360; commit(); renderAll(); } break;
    case 'rotBg': { const bg = curBg(); if (bg) { bg.rot = ((bg.rot || 0) + 90) % 360; commit(); renderAll(); } } break;
    case 'pickQr': S.pickQr = true; S.pickBg = false; $('#fileImg').click(); break;
    case 'rmQr': if (f) { delete f.block.qrimg; commit(); renderAll(); } break;
    case 'rmBg': { const h = bgHost(); delete h.obj[h.key]; } commit(); renderAll(); break;
    case 'rmOwnBg': delete M.getPage(S.doc, S.side, S.page).bg; commit(); renderAll(); break;
    case 'gridAll': {
      const { cols, rows } = M.pageSf(S.doc, S.side, S.page);
      const failed = [];
      for (let pi = 0; pi < M.pageCount(S.doc, S.side); pi++) {
        const gp = M.spreadGridOf(S.doc, S.side, pi);
        if (gp && pi === gp[1]) continue; // правую полосу общей сетки меняет левая
        if (!applyGrid(pi, cols, rows)) failed.push(gp ? `${gp[0] + 1}–${gp[1] + 1}` : pi + 1);
      }
      commit(); renderAll();
      toast(failed.length ? tr('Не поменялись страницы {p}: блоки не помещаются', { p: failed.join(', ') }) : tr('Сетка {c} × {r} на всех страницах', { c: cols, r: rows }), !!failed.length);
    } break;
    case 'randPalette': {
      // схема гармонии не повторяется два раза подряд; отменяется обычным ⌘Z
      const p = randomPalette(S.lastScheme);
      S.lastScheme = p.name;
      Object.assign(S.doc.colors, { ink: p.ink, accent: p.accent, meta: p.meta });
      S.doc.paper = p.paper;
      commit(); renderAll();
      toast(tr('Палитра: {n}', { n: tr(p.name) }));
    } break;
    case 'rmImg': if (f) { f.block.asset = null; commit(); renderAll(); } break;
    case 'clearPage': M.getPage(S.doc, S.side, (M.spreadGridOf(S.doc, S.side, S.page) || [S.page])[0]).blocks = []; S.sel = null; commit(); renderAll(); break;
    case 'setB': S.doc.sides[1].type = el.dataset.val; commit(); renderAll(); break;
    case 'new': if (confirm(tr('Начать новый пустой зин? Текущий будет заменён.'))) { S.doc = M.blankDoc(); S.sel = null; S.side = 0; S.page = 0; commit(); renderAll(); } break;
    case 'sample': if (confirm(tr('Загрузить пример? Текущий зин будет заменён.'))) loadSample(); break;
    case 'open': $('#fileZine').click(); break;
    case 'save': saveZine(); break;
  }
}

function setProp(k, v, soft) {
  const f = sel();
  if (!f) return;
  // положение QR: фиксируем обе оси, старое поле qrpos больше не нужно
  if (k === 'qrx' || k === 'qry') { Object.assign(f.block, qrPos(f.block, f)); delete f.block.qrpos; }
  f.block[k] = v;
  renderView();
  soft ? commitSoon() : (commit(), renderInspector());
}

// ---------- drag & drop ----------
let ghost, ins;
function clearDnD() {
  ghost?.remove(); ghost = null;
  ins?.remove(); ins = null;
  document.querySelectorAll('.page .shift').forEach((e) => e.remove());
  document.querySelectorAll('.dropbad,.thumb.drop').forEach((e) => e.classList.remove('dropbad', 'drop'));
}

// br — DOMRect страницы, измеренный заранее: при перерисовке элемент страницы пересоздаётся,
// и у старого getBoundingClientRect() возвращает нули (из-за этого ресайз умел только расти)
const cellOf = (L, br, ev) => {
  return cellAt(L, ((ev.clientX - br.left) / br.width) * L.sf.w, ((ev.clientY - br.top) / br.height) * L.sf.h);
};

// payload: {kind:'new', type} | {kind:'move', id, gx, gy} — gx/gy: за какую ячейку блока схватили
function dropTarget(ev, payload) {
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  const pg = el?.closest('.page[data-page]'), th = el?.closest('.thumb[data-page]');
  const t = pg || th;
  if (!t) return null;
  const si = +t.dataset.side, pi = +t.dataset.page;
  const L = pageLayout(S.doc, si, pi);
  const mv = payload.kind === 'move' ? M.findBlock(S.doc, payload.id).block : null;
  const type = mv ? mv.type : payload.type;
  const why = lim(si, pi, mv?.id);
  if (why) return { el: t, pg, th, si, pi, ok: false, why };
  const pw = mv ? mv.w : M.BLOCKS[type].w, ph = mv ? mv.h : M.BLOCKS[type].h;
  let r, push = null;
  if (pg) {
    const { cx, cy } = cellOf(L, pg.getBoundingClientRect(), ev);
    if (mv) {
      const ex = {
        x: Math.max(0, Math.min(L.sf.cols - mv.w, cx - payload.gx)),
        y: Math.max(0, Math.min(L.sf.rows - mv.h, cy - payload.gy)), w: mv.w, h: mv.h,
      };
      // ровно туда, куда тянут; не влезает — раздвигаем соседей; совсем никак — ближайшее свободное место
      if (M.canRect(L.page, L.sf, ex, mv.id)) r = ex;
      else if ((push = M.pushPlan(L.page, L.sf, ex, mv.id))) r = ex;
      else r = M.placeAt(L.page, L.sf, type, pw, ph, cx, cy, mv.id);
    } else {
      r = M.placeAt(L.page, L.sf, type, pw, ph, cx, cy);
      if (!r) { // новый блок в занятое место — тоже раздвигаем (ширина по умолчанию — одна полоса)
        const d = M.BLOCKS[type], w = Math.min(d.w, L.sf.pageCols || L.sf.cols), h = Math.min(d.h, L.sf.rows);
        const ex = { x: Math.max(0, Math.min(L.sf.cols - w, cx)), y: Math.max(0, Math.min(L.sf.rows - h, cy)), w, h };
        if ((push = M.pushPlan(L.page, L.sf, ex))) r = ex;
      }
    }
  } else r = M.placeFree(L.page, L.sf, type, pw, ph, mv?.id);
  return { el: t, pg, th, si, pi, r, push, L, ok: !!r, why: r ? null : tr('Здесь нет места под этот блок') };
}

function showDrop(t) {
  document.querySelectorAll('.dropbad,.thumb.drop').forEach((e) => e.classList.remove('dropbad', 'drop'));
  document.querySelectorAll('.page .shift').forEach((e) => e.remove());
  ins?.remove(); ins = null;
  ghost?.classList.toggle('bad', !!t && !t.ok);
  if (!t) return;
  if (t.th) { t.th.classList.add(t.ok ? 'drop' : 'dropbad'); return; }
  if (!t.ok) { t.pg.classList.add('dropbad'); return; }
  const bx = t.L.rect(t.r), sf = t.L.sf;
  ins = document.createElement('div');
  ins.className = 'ins';
  Object.assign(ins.style, {
    left: (bx.x / sf.w) * 100 + '%', top: (bx.y / sf.h) * 100 + '%',
    width: (bx.w / sf.w) * 100 + '%', height: (bx.h / sf.h) * 100 + '%',
  });
  ins.innerHTML = `<b>${t.r.w}×${t.r.h}</b>`;
  // куда уедут раздвинутые блоки — пунктирные рамки на их новых местах
  for (const [id, y] of Object.entries(t.push || {})) {
    const b = t.L.page.blocks.find((o) => o.id === id);
    const p = t.L.rect({ ...b, y });
    const e = document.createElement('i');
    e.className = 'shift';
    Object.assign(e.style, { left: (p.x / sf.w) * 100 + '%', top: (p.y / sf.h) * 100 + '%', width: (p.w / sf.w) * 100 + '%', height: (p.h / sf.h) * 100 + '%' });
    t.pg.appendChild(e);
  }
  t.pg.appendChild(ins);
}

function startDrag(e, payload, label, threshold = 5) {
  const sx = e.clientX, sy = e.clientY, g = gestureGen;
  let started = false, last = null;
  const move = (ev) => {
    if (g !== gestureGen) return;
    if (!started) {
      if (threshold && Math.hypot(ev.clientX - sx, ev.clientY - sy) < threshold) return;
      started = true;
      document.body.classList.add('dnd');
      ghost = document.createElement('div');
      ghost.className = 'ghost';
      ghost.textContent = label;
      document.body.appendChild(ghost);
    }
    ghost.style.left = ev.clientX + 'px';
    ghost.style.top = ev.clientY + 'px';
    const prev = last?.r && JSON.stringify(last.r);
    last = dropTarget(ev, payload);
    if (last?.r && prev && JSON.stringify(last.r) !== prev) buzz(4);
    showDrop(last);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.classList.remove('dnd');
    clearDnD();
    if (g !== gestureGen) return; // стал щипком
    if (!started) return payload.click?.();
    if (!last) return;
    if (!last.ok) return toast(last.why, true);
    if (last.push) applyPush(last.si, last.pi, last.push);
    if (payload.kind === 'new') addBlock(payload.type, last.si, last.pi, null, {}, last.r);
    else moveBlock(payload.id, last.si, last.pi, last.r);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  if (threshold === 0) move(e);
}

$('#palette').addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.tile');
  if (!t || e.button !== 0) return;
  e.preventDefault();
  const type = t.dataset.type;
  startDrag(e, {
    kind: 'new', type,
    click: () => {
      if (side().type === 'none') return;
      // на телефоне сразу к свойствам нового блока — писать текст
      if (addBlock(type, S.side, S.page) && isMobile()) openSheet('inspector');
    },
  }, tr(M.BLOCKS[type].name));
});

// Уголок: размер по ячейкам; упирается в края и соседей
// Курсор по одной оси -> {n — сколько ячеек от from, ex — край прилип к началу следующей ячейки}.
// Магнит: курсор в промежутке после ячейки или в первой трети следующей — край встаёт на её начало
function snapAxis(pos, starts, cell, from) {
  let i = starts.length - 1;
  while (i > 0 && pos < starts[i]) i--;
  const within = pos - starts[i];
  if (i > from && within < cell * 0.3) return { n: i - from, ex: true };
  if (within > cell && i < starts.length - 1) return { n: i - from + 1, ex: true };
  return { n: i - from + 1, ex: false };
}

// Верхний/левый край: курсор в последних 30% ячейки или в промежутке после неё — край прилипает
// к её концу (блок начинается со следующей ячейки). last — последняя ячейка блока (край не заходит за неё)
function snapStart(pos, starts, cell, last) {
  let i = starts.length - 1;
  while (i > 0 && pos < starts[i]) i--;
  if (pos - starts[i] > cell * 0.7 && i < last) return { s: i + 1, ex: true };
  return { s: Math.min(i, last), ex: false };
}

// corner — за какой угол тянут: br (правый нижний), tr (правый верхний), bl (левый нижний)
function startResize(e, id, corner = 'br') {
  const f = M.findBlock(S.doc, id), b = f.block, g = gestureGen;
  const L = pageLayout(S.doc, f.si, f.pi);
  const br = e.target.closest('.page').getBoundingClientRect();
  const d = M.BLOCKS[b.type];
  document.body.classList.add('dnd');
  // начала колонок и рядов в мм (в общей сетке разворота колонки неравномерные)
  const colX = (k) => (L.colX ? L.colX(k) : L.content.x + k * (L.colW + L.g));
  const cols = Array.from({ length: L.sf.cols }, (_, k) => colX(k));
  const rows = Array.from({ length: L.sf.rows }, (_, k) => L.content.y + k * (L.rowH + L.g));
  const left = corner === 'bl', top = corner === 'tr';
  const x1 = b.x + b.w - 1, y1 = b.y + b.h - 1; // неподвижные правый/нижний ряды для левого/верхнего края
  const move = (ev) => {
    if (g !== gestureGen) return;
    const xm = ((ev.clientX - br.left) / br.width) * L.sf.w, ym = ((ev.clientY - br.top) / br.height) * L.sf.h;
    // по горизонтали: левый нижний угол тянет левый край, остальные — правый
    let hx;
    if (left) {
      const s0 = snapStart(xm, cols, L.colW, x1);
      let x = s0.s;
      if (x1 - x + 1 < d.minW) x = Math.max(0, x1 - d.minW + 1);
      hx = { x, w: x1 - x + 1, ex: { l: s0.ex && x === s0.s } };
    } else {
      const sx = snapAxis(xm, cols, L.colW, b.x), w = Math.max(d.minW, sx.n);
      hx = { x: b.x, w, ex: { r: sx.ex && w === sx.n } };
    }
    // по вертикали: правый верхний угол тянет верхний край, остальные — нижний
    let hy;
    if (top) {
      const s0 = snapStart(ym, rows, L.rowH, y1);
      let y = s0.s;
      if (y1 - y + 1 < d.minH) y = Math.max(0, y1 - d.minH + 1);
      if (y1 - y + 1 > d.maxH) y = y1 - d.maxH + 1;
      hy = { y, h: y1 - y + 1, ex: { t: s0.ex && y === s0.s } };
    } else {
      const sy = snapAxis(ym, rows, L.rowH, b.y), h = Math.max(d.minH, Math.min(d.maxH, sy.n));
      hy = { y: b.y, h, ex: { b: sy.ex && h === sy.n } };
    }
    const keepX = { x: b.x, w: b.w, ex: {} }, keepY = { y: b.y, h: b.h, ex: {} };
    // желаемый размер, иначе меняем только одну ось
    for (const [ax, ay] of [[hx, hy], [hx, keepY], [keepX, hy]]) {
      const r = { x: ax.x, y: ay.y, w: ax.w, h: ay.h };
      if (!M.canRect(f.page, L.sf, r, id)) continue;
      const before = JSON.stringify([b.x, b.y, b.w, b.h, b.ex]);
      Object.assign(b, r);
      b.ex = { ...(b.ex || {}), ...ax.ex, ...ay.ex };
      M.fixEx(f.page, L.sf, b);
      if (JSON.stringify([b.x, b.y, b.w, b.h, b.ex]) !== before) renderView();
      break;
    }
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.classList.remove('dnd');
    if (g !== gestureGen) return restore(H.i); // стал щипком — размер как был
    commit(); renderInspector();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function startPan(e, id) {
  const f = M.findBlock(S.doc, id), b = f.block;
  const inf = S.info[id];
  const a = dimsOf(b.asset, b.rot); // размеры с учётом поворота
  const pg = e.target.closest('.page').getBoundingClientRect();
  const L = pageLayout(S.doc, f.si, f.pi);
  const mm = L.sf.w / pg.width;
  const it = inf.img;
  const sc = Math.max(it.w / a.w, it.h / a.h) * b.zoom;
  const rx = it.w - a.w * sc, ry = it.h - a.h * sc;
  const sx = e.clientX, sy = e.clientY, px0 = b.px, py0 = b.py, g = gestureGen;
  let moved = false;
  const move = (ev) => {
    if (g !== gestureGen) return;
    moved = true;
    // картинка больше рамки (rx < 0) — двигаем кадр; меньше (rx > 0) — двигаем картинку внутри рамки
    if (Math.abs(rx) > 0.01) b.px = Math.max(0, Math.min(1, px0 + ((ev.clientX - sx) * mm) / rx));
    if (Math.abs(ry) > 0.01) b.py = Math.max(0, Math.min(1, py0 + ((ev.clientY - sy) * mm) / ry));
    renderView();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (moved) g !== gestureGen ? restore(H.i) : commit();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

canvas.addEventListener('pointerdown', (e) => {
  // кнопки на холсте (пустой оборот) обрабатывает click — не перерисовываем их из-под курсора
  if (e.button !== 0 || e.target.closest('button, .tbar')) return;
  if (menuOpen()) { closeMenu(); return; } // тап мимо меню — передумал
  const slot = e.target.closest('.slot');
  if (slot) { S.page = +slot.dataset.goto; S.view = 'pages'; S.sel = null; renderAll(); return; }
  const cw = touchMode() && e.target.closest('.pagewrap.ctx');
  if (cw) { // приглушённая пара: тап — перейти к ней, взмах — листать
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, t0 = performance.now(), g = gestureGen;
    const toward = cw.previousElementSibling ? 1 : -1; // пара справа — вперёд
    const up = (ev) => {
      window.removeEventListener('pointerup', up);
      if (g !== gestureGen) return;
      const dx = ev.clientX - sx;
      flipPage(isFlick(dx, ev.clientY - sy, performance.now() - t0) ? (dx < 0 ? 1 : -1) : toward);
    };
    window.addEventListener('pointerup', up);
    return;
  }
  const pg = e.target.closest('.page[data-page]');
  if (!pg) {
    // на касании «стол» — всё вокруг страницы, включая подпись под ней: там тоже листают взмахом
    const desk = touchMode() || e.target === canvas || e.target.closest('.spread') === null;
    if (desk && S.zoom && S.view === 'pages') return panZoom(e); // увеличено — стол двигает страницу
    if (desk && touchMode() && S.view === 'pages') { // по столу: взмах листает, тап снимает выделение
      const sx = e.clientX, sy = e.clientY, t0 = performance.now(), g = gestureGen;
      const up = (ev) => {
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (ev.type === 'pointercancel' || g !== gestureGen) return; // браузер забрал жест под прокрутку листа или это щипок
        if (isFlick(ev.clientX - sx, ev.clientY - sy, performance.now() - t0) && flipPage(ev.clientX < sx ? 1 : -1)) return;
        S.sel = null; renderAll();
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      return;
    }
    if (desk) { S.sel = null; renderAll(); }
    return;
  }
  const blk = e.target.closest('.blk');
  const si = +pg.dataset.side, pi = +pg.dataset.page;
  // общая сетка: активной становится та полоса разворота, по которой щёлкнули
  let p = pi;
  if (pg.dataset.pair) { const r = pg.getBoundingClientRect(); p = +pg.dataset.pair.split(',')[(e.clientX - r.left) / r.width < 0.5 ? 0 : 1]; }
  if (!blk) {
    if (touchMode()) { e.preventDefault(); return startDraw(e, pg, si, p, !!S.sel); }
    S.sel = null; S.side = si; S.page = p; renderAll(); return;
  }
  const id = blk.dataset.id;
  e.preventDefault();
  if (e.target.classList.contains('rs')) return startResize(e, id, e.target.dataset.c);
  const f = M.findBlock(S.doc, id);
  const isImg = (f.block.type === 'image' || f.block.type === 'imagecap') && f.block.asset;
  // запоминаем, за какую ячейку схватили, чтобы блок не прыгал углом к курсору
  const { cx, cy } = cellOf(pageLayout(S.doc, si, pi), pg.getBoundingClientRect(), e);
  const b = f.block, label = tr(M.BLOCKS[b.type].name);
  const payload = { kind: 'move', id, gx: Math.max(0, Math.min(b.w - 1, cx - b.x)), gy: Math.max(0, Math.min(b.h - 1, cy - b.y)) };
  if (S.sel === id && isImg && !e.target.classList.contains('grip')) return touchMode() ? holdOrPan(e, id, payload, label) : startPan(e, id);
  if (S.sel !== id) { S.sel = id; S.page = p; S.side = si; renderAll(); }
  startDrag(e, payload, label, touchMode() ? 10 : 5);
});

canvas.addEventListener('dblclick', (e) => {
  if (!e.target.closest('.blk')) return;
  if (isMobile()) openSheet('inspector');
  insp.querySelector('textarea, input:not([type=range])')?.focus();
});

// ---------- телефон: нижние листы «Блоки» и «Свойства» ----------
const mq = matchMedia('(max-width: 760px)');
function isMobile() { return mq.matches; }
let sheet = null; // 'palette' | 'inspector' | null
function openSheet(name, full = false) {
  if (name && menuOpen()) closeMenu(); // открыли свойства — выбор нового блока больше не нужен
  sheet = name;
  document.body.classList.toggle('m-palette', name === 'palette');
  document.body.classList.toggle('m-inspector', name === 'inspector');
  document.body.classList.toggle('m-full', name === 'inspector' && full);
  syncCarousel();
  document.querySelectorAll('#mbar [data-sheet]').forEach((b) => b.classList.toggle('on', b.dataset.sheet === name));
  renderView(); // сцена поменяла высоту — пересчитать масштаб страницы
}
$('#mbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sheet]');
  if (b) openSheet(sheet === b.dataset.sheet ? null : b.dataset.sheet);
  const p = e.target.closest('[data-proxy]');
  if (p) $('#' + p.dataset.proxy).click();
});
mq.addEventListener('change', () => { if (!isMobile()) openSheet(null); if (S.doc) renderAll(); });
$('.shead').addEventListener('click', (e) => { if (e.target.closest('[data-sheet-close]')) { document.activeElement?.blur(); openSheet(null); } });

// касание: телефон, планшет (до 1100 px) и любой экран, где указатель — палец
const tq = matchMedia('(max-width: 1100px), (pointer: coarse)');
function touchMode() { return tq.matches; }
const applyTouch = () => document.body.classList.toggle('touch', tq.matches);
applyTouch();
tq.addEventListener('change', () => { applyTouch(); if (!tq.matches) closeMenu(); if (S.doc) renderAll(); });

nav.addEventListener('click', (e) => {
  const t = e.target.closest('.thumb');
  if (!t) return;
  S.page = +t.dataset.page;
  S.sel = null;
  if (S.view === 'sheet') S.view = 'pages';
  renderAll();
});

// ---------- файлы: картинки ----------
async function placeImageFile(file, target) {
  const id = await importImage(file);
  store.set('asset:' + id, { src: assets[id].src, w: assets[id].w, h: assets[id].h });
  if (target?.blockId) {
    const f = M.findBlock(S.doc, target.blockId);
    Object.assign(f.block, { asset: id, zoom: 1, px: 0.5, py: 0.5 });
    S.sel = f.block.id;
    commit(); renderAll();
    return;
  }
  const si = target?.si ?? S.side, pi = target?.pi ?? S.page;
  addBlock('image', si, pi, null, { asset: id }, target?.r);
}

canvas.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
canvas.addEventListener('drop', async (e) => {
  const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
  if (!file) return;
  e.preventDefault();
  const blk = e.target.closest('.blk');
  if (blk) {
    const f = M.findBlock(S.doc, blk.dataset.id);
    if (f.block.type === 'image' || f.block.type === 'imagecap') return placeImageFile(file, { blockId: f.block.id });
  }
  const t = dropTarget(e, { kind: 'new', type: 'image' });
  if (t && !t.ok) return toast(t.why, true);
  placeImageFile(file, t);
});

$('#fileImg').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (S.pickQr) {
    S.pickQr = false;
    const f = sel();
    if (!f || f.block.type !== 'qr') return;
    const id = await importImage(file);
    store.set('asset:' + id, { src: assets[id].src, w: assets[id].w, h: assets[id].h });
    f.block.qrimg = id;
    commit(); renderAll();
    return;
  }
  if (S.pickBg) {
    const want = S.pickBg;
    S.pickBg = false;
    const id = await importImage(file);
    store.set('asset:' + id, { src: assets[id].src, w: assets[id].w, h: assets[id].h });
    const h = M.bgHost(S.doc, S.side, S.page, want);
    h.obj[h.key] = { asset: id, zoom: 1, px: 0.5, py: 0.5, filter: 'gray', grain: 0.4, fade: 0.6 };
    commit(); renderAll();
    return;
  }
  const f = sel();
  placeImageFile(file, f && (f.block.type === 'image' || f.block.type === 'imagecap') ? { blockId: f.block.id } : null);
});

// ---------- вставка ----------
document.addEventListener('paste', (e) => {
  if (isTyping(document.activeElement)) return;
  const dt = e.clipboardData;
  const file = [...dt.files].find((f) => f.type.startsWith('image/'));
  if (file) {
    e.preventDefault();
    const f = sel();
    placeImageFile(file, f && (f.block.type === 'image' || f.block.type === 'imagecap') ? { blockId: f.block.id } : null);
    return;
  }
  const plain = dt.getData('text/plain'), html = dt.getData('text/html');
  const md = plain && looksLikeMd(plain) ? plain : html ? htmlToMd(html) : plain;
  if (!md?.trim() || side().type === 'none') return;
  e.preventDefault();
  const r = flowMarkdown(S.doc, S.side, S.page, md);
  if (!r.placed) return toast(tr('Нет места: освободи страницу или выбери другую'), true);
  S.page = r.lastPage; S.sel = null;
  commit(); renderAll();
  toast(r.leftBlocks ? tr('Разложено блоков: {n}. Не влезло ~{c} зн.', { n: r.placed, c: r.leftChars }) : tr('Разложено блоков: {n}', { n: r.placed }), !!r.leftBlocks);
});

// ---------- инспектор: события ----------
insp.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.prop) {
    const v = t.dataset.num !== undefined ? +t.value : t.value;
    setProp(t.dataset.prop, v, true);
    if (t.type === 'range') {
      const lab = t.previousElementSibling;
      if (t.dataset.prop === 'zoom') lab.textContent = `${tr('Масштаб')} · ${Math.round(v * 100)}%`;
      if (t.dataset.prop === 'grain') lab.textContent = `${tr('Зерно растра')} · ${v.toFixed(2)} ${tr('мм')}`;
      if (t.dataset.prop === 'qrsize') lab.textContent = `${tr('Размер области')} · ${Math.round(v * 100)}%`;
      if (t.dataset.prop === 'qrzoom') lab.textContent = `${tr('Масштаб картинки')} · ${Math.round(v * 100)}%`;
    }
  } else if (t.dataset.bgprop) {
    const bg = curBg();
    bg[t.dataset.bgprop] = +t.value;
    const lab = t.previousElementSibling;
    if (t.dataset.bgprop === 'fade') lab.textContent = `${tr('Осветление')} · ${Math.round(t.value * 100)}%`;
    if (t.dataset.bgprop === 'zoom') lab.textContent = `${tr('Масштаб')} · ${Math.round(t.value * 100)}%`;
    if (t.dataset.bgprop === 'blur') lab.textContent = `${tr('Блюр')} · ${(+t.value).toFixed(1)} ${tr('мм')}`;
    if (t.dataset.bgprop === 'grain') lab.textContent = `${tr('Зерно растра')} · ${(+t.value).toFixed(2)} ${tr('мм')}`;
    renderView(); commitSoon();
  } else if (t.dataset.inkCustom) {
    S.doc.colors[t.dataset.inkCustom] = t.value;
    t.parentElement.style.background = t.value;
    renderView(); commitSoon();
  } else if (t.dataset.paperCustom !== undefined) {
    S.doc.paper = t.value;
    t.parentElement.style.background = t.value;
    renderView(); commitSoon();
  } else if (t.dataset.docTitle !== undefined) {
    S.doc.title = t.value; renderView(); commitSoon();
  } else if (t.dataset.hf) {
    const [k, p] = t.dataset.hf.split('.');
    S.doc.hf[k][p] = t.value;
    renderView(); commitSoon();
  }
});

// ---------- горячие клавиши форматирования (в текстовых полях) ----------
// Вставка через execCommand сохраняет родную отмену ⌘Z внутри поля
function replaceSel(ta, text, selFrom, selTo) {
  ta.focus();
  if (!document.execCommand('insertText', false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (selFrom != null) ta.setSelectionRange(selFrom, selTo);
}

// **жирный** / *курсив*: обернуть выделение или снять обёртку, если она уже есть
function toggleWrap(ta, mark) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const n = mark.length;
  const sel = v.slice(s, e);
  // обёртка снаружи выделения: **[текст]**
  if (v.slice(s - n, s) === mark && v.slice(e, e + n) === mark
      && !(n === 1 && v.slice(s - 2, s) === '**' && v.slice(e, e + 2) === '**' && v.slice(s - 3, s) !== '***')) {
    ta.setSelectionRange(s - n, e + n);
    return replaceSel(ta, sel, s - n, e - n);
  }
  // обёртка внутри выделения: [**текст**]
  if (sel.length >= n * 2 && sel.startsWith(mark) && sel.endsWith(mark)) {
    return replaceSel(ta, sel.slice(n, -n), s, e - n * 2);
  }
  replaceSel(ta, mark + sel + mark, s + n, e + n);
}

// Список: «- » или «1. » в начале каждой выделенной строки; повторное нажатие — убирает
function toggleList(ta, ordered) {
  const v = ta.value;
  const a = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let b = v.indexOf('\n', ta.selectionEnd);
  if (b < 0) b = v.length;
  const lines = v.slice(a, b).split('\n');
  const re = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+•]\s+/;
  const on = lines.every((l) => !l.trim() || re.test(l));
  let k = 0;
  const out = lines.map((l) => {
    if (!l.trim()) return l;
    const bare = l.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '');
    return on ? bare : (ordered ? `${++k}. ` : '- ') + bare;
  }).join('\n');
  ta.setSelectionRange(a, b);
  replaceSel(ta, out, a, a + out.length);
}

insp.addEventListener('keydown', (e) => {
  const ta = e.target;
  if (ta.tagName !== 'TEXTAREA' || !(e.metaKey || e.ctrlKey)) return;
  const k = e.code;
  if (k === 'KeyB' && !e.shiftKey) { e.preventDefault(); toggleWrap(ta, '**'); }
  else if (k === 'KeyI' && !e.shiftKey) { e.preventDefault(); toggleWrap(ta, '*'); }
  else if (k === 'Digit8' && e.shiftKey) { e.preventDefault(); toggleList(ta, false); }
  else if (k === 'Digit7' && e.shiftKey) { e.preventDefault(); toggleList(ta, true); }
});

insp.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.font) {
    await ensureFont(t.value);
    S.doc.fonts[t.dataset.font] = t.value;
    commit(); renderAll();
  } else if (t.dataset.grid !== undefined) {
    const [cols, rows] = t.value.split('x').map(Number);
    if (!applyGrid(S.page, cols, rows)) { toast(tr('Блоки не помещаются в такую сетку — освободи место'), true); renderInspector(); return; }
    commit(); renderAll();
  } else if (t.dataset.paperprint !== undefined) {
    S.doc.paperPrint = !t.checked; commit(); renderAll();
  } else if (t.dataset.paperCustom !== undefined || t.dataset.inkCustom) {
    // панель не перерисовываем: пока открыто системное окно выбора цвета, «change» может приходить
    // на каждый клик в нём — перерисовка удалила бы поле, и окно закрылось бы
    commit(); renderView();
    const row = t.closest('.swatches');
    row.querySelectorAll('.sw').forEach((el) => el.classList.toggle('on', el === t.parentElement));
  } else if (t.dataset.hfon) {
    S.doc.hf[t.dataset.hfon].on = t.checked; commit(); renderAll();
  } else if (t.dataset.hfopt) {
    S.doc.hf[t.dataset.hfopt] = t.checked; commit(); renderAll();
  }
});

insp.addEventListener('click', async (e) => {
  const ct = e.target.closest('[data-car]');
  if (ct) return goSlide(+ct.dataset.car, true);
  // выбор шрифта: открыть список (образцы шрифтов подгружаются) / выбрать
  const fp = e.target.closest('.fp-cur');
  if (fp) {
    const list = fp.parentElement.querySelector('.fp-list');
    const open = list.hidden;
    insp.querySelectorAll('.fp-list').forEach((l) => (l.hidden = true));
    list.hidden = !open;
    if (open) for (const el of list.querySelectorAll('.fp-name')) previewFont(el.dataset.fid).then(() => el.classList.add('ok'));
    return;
  }
  const fi = e.target.closest('[data-fp-id]');
  if (fi) {
    await ensureFont(fi.dataset.fpId);
    S.doc.fonts[fi.dataset.fpRole] = fi.dataset.fpId;
    commit(); renderAll(); return;
  }
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  const num = (v) => (/^\d+(\.\d+)?$/.test(v) ? +v : v);
  const f = sel();
  if (d.sizeW && f) return setSize(+d.sizeW, f.block.h);
  if (d.sizeH && f) return setSize(f.block.w, +d.sizeH);
  if (d.ex && f) { // прилипание края: вкл/выкл
    const b = f.block;
    b.ex = { ...(b.ex || {}), [d.ex]: !b.ex?.[d.ex] };
    M.fixEx(f.page, pageLayout(S.doc, f.si, f.pi).sf, b);
    commit(); renderAll(); return;
  }
  const key = Object.keys(d).find((k) => k.startsWith('set'));
  if (key) return setProp(key.slice(3).toLowerCase(), num(d[key]));
  if (d.act) return act(d.act, b);
  if (d.ink) { S.doc.colors[d.ink] = d.val; commit(); renderAll(); return; }
  if (d.bgColor) { curBg().color = d.bgColor; commit(); renderAll(); return; }
  if (d.bgInvert !== undefined) { curBg().invert = d.bgInvert === '1'; commit(); renderAll(); return; }
  if (d.bgFilter) { curBg().filter = d.bgFilter; commit(); renderAll(); return; }
  if (d.bgBlend) { curBg().blend = d.bgBlend; commit(); renderAll(); return; }
  if (d.joinCovers !== undefined) {
    const on = d.joinCovers === '1';
    // обложки врозь — сначала разбираем их общую сетку
    if (!on && M.spreadGridOf(S.doc, S.side, 7) && !splitGrid([7, 0])) return;
    side().joinCovers = on;
    commit(); renderAll(); return;
  }
  if (d.spreadGrid !== undefined) {
    const pair = M.pairOf(S.doc, S.side, S.page);
    if (!pair) return;
    if (d.spreadGrid === '1') {
      if (!M.joinSpreadGrid(S.doc, S.side, pair)) return toast(tr('Блоки правой страницы не помещаются в сетку левой — освободи место'), true);
    } else if (!splitGrid(pair)) return;
    commit(); renderAll(); return;
  }
  if (d.paper) { S.doc.paper = d.paper; commit(); renderAll(); return; }
  if (d.docFormat) { S.doc.format = d.docFormat; }
  else if (d.sideA) { S.doc.sides[0].type = d.sideA; }
  else if (d.sideB) { S.doc.sides[1].type = d.sideB; if (d.sideB === 'none' && S.side === 1) S.side = 0; }
  else if (d.orient) { S.doc.sides.forEach((s) => (s.poster.orient = d.orient)); }
  else return;
  fixPos(); commit(); renderAll();
});

// список шрифтов закрывается кликом мимо него
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.fontpick')) document.querySelectorAll('.fp-list').forEach((l) => (l.hidden = true));
});

// ---------- верхняя панель ----------
$('#title').addEventListener('input', (e) => { S.doc.title = e.target.value; renderView(); commitSoon(); });
$('#sideTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  S.side = +b.dataset.side; S.page = 0; S.sel = null; renderAll();
});
$('#viewTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  S.view = b.dataset.view;
  if (S.view === 'sheet') S.sel = null; // на листе не редактируем — панель блока не нужна
  renderAll();
});
$('#filebar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (b) act(b.dataset.act, b);
});
// язык: перерисовываем всё, что строится из кода (статичную разметку переводит i18n)
bindLangSwitch($('#langSwitch'), () => { if (S.doc) renderAll(); });
// отмена / повтор: линия с открытым наконечником-уголком, как у «↓» в кнопке PDF
const arrowIcon = (flip) => `<svg class="hist" viewBox="0 0 16 16" aria-hidden="true"${flip ? ' style="transform:scaleX(-1)"' : ''}>
  <path d="M6 1.5 2.5 5 6 8.5M2.5 5H12.5V13H6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="miter" stroke-linecap="butt"/></svg>`;
$('#undo').innerHTML = arrowIcon(false);
$('#redo').innerHTML = arrowIcon(true);
$('#mbar [data-proxy="undo"]').innerHTML = arrowIcon(false); // те же стрелки в нижней панели телефона
$('#mbar [data-proxy="redo"]').innerHTML = arrowIcon(true);
$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#exportBtn').onclick = () => openExport();

// ---------- касание: меню «Файл» вместо кнопки PDF ----------
// Печать — первым и заметным пунктом; дальше новый зин, пример, открыть и сохранить .zine
function openFileMenu(btn) {
  const m = $('#fmenu');
  m.innerHTML = `<button data-fm="export" class="fm-main">${tr('Печать и PDF…')}<small>${tr('дом, типография, PNG для веба')}</small></button>
    <button data-fm="new">${tr('Новый зин')}</button><button data-fm="sample">${tr('Пример')}</button>
    <button data-fm="open">${tr('Открыть .zine…')}</button><button data-fm="save">${tr('Сохранить .zine')}</button>`;
  m.hidden = false;
  btn.classList.add('on');
  // у кнопки внизу экрана — над ней, у кнопки в шапке — под ней
  const r = btn.getBoundingClientRect();
  m.style.right = Math.max(8, innerWidth - r.right) + 'px';
  if (r.top > innerHeight / 2) Object.assign(m.style, { top: 'auto', bottom: innerHeight - r.top + 6 + 'px' });
  else Object.assign(m.style, { bottom: 'auto', top: r.bottom + 6 + 'px' });
}
function closeFileMenu() {
  $('#fmenu').hidden = true;
  document.querySelectorAll('[data-fmenu].on').forEach((b) => b.classList.remove('on'));
}
document.addEventListener('click', (e) => {
  const fb = e.target.closest('[data-fmenu]');
  if (fb) {
    if (!$('#fmenu').hidden) return closeFileMenu();
    if (menuOpen()) closeMenu();
    return openFileMenu(fb);
  }
  const it = e.target.closest('[data-fm]');
  if (it) { closeFileMenu(); return it.dataset.fm === 'export' ? openExport() : act(it.dataset.fm); }
  if (!$('#fmenu').hidden && !e.target.closest('#fmenu')) closeFileMenu();
});
canvas.addEventListener('click', (e) => {
  const tb = e.target.closest('[data-tb]');
  if (tb) return tbAct(tb.dataset.tb);
  const b = e.target.closest('button[data-act]');
  if (b) act(b.dataset.act, b);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#fmenu').hidden) { closeFileMenu(); return; }
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z' && !isTyping(document.activeElement)) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y' && !isTyping(document.activeElement)) { e.preventDefault(); redo(); return; }
  if (isTyping(document.activeElement) || !$('#modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
  const f = sel();
  if ((e.key === 'Delete' || e.key === 'Backspace') && f) { e.preventDefault(); act('del'); }
  else if (e.key === 'Escape' && menuOpen()) closeMenu();
  else if (e.key === 'Escape') { S.sel = null; renderAll(); }
  else if (mod && e.key.toLowerCase() === 'd' && f) { e.preventDefault(); act('dup'); }
  else if (e.key.startsWith('Arrow') && f) {
    e.preventDefault();
    nudge({ ArrowLeft: -1, ArrowRight: 1 }[e.key] || 0, { ArrowUp: -1, ArrowDown: 1 }[e.key] || 0);
  }
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && side().type === 'zine') {
    const s = spreadOf(S.page) + (e.key === 'ArrowLeft' ? -1 : 1);
    const sp = M.spreads(S.doc, S.side);
    if (s >= 0 && s < sp.length) { S.page = sp[s][0]; S.sel = null; renderAll(); }
  }
});

window.addEventListener('resize', () => { renderView(); syncCarousel(); });

// ---------- экспорт ----------
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }

function overflowList() {
  const out = [];
  for (let si = 0; si < 2; si++) {
    for (let pi = 0; pi < M.pageCount(S.doc, si); pi++) {
      const { info } = pageDL(S.doc, si, pi);
      if (Object.values(info).some((i) => i.overflow)) out.push(`${si ? 'B' : 'A'}: ${M.pageLabel(S.doc, si, pi)}`);
    }
  }
  return out;
}

function openExport() {
  const d = S.doc;
  const over = overflowList();
  const bSide = d.sides[1].type !== 'none';
  $('#modal').innerHTML = `<div class="dlg"><h2>${tr('Печать · PDF')} <button data-x>✕</button></h2><div class="body">
    <label class="opt"><input type="radio" name="mode" value="home" checked><b>${tr('Домашний принтер')}</b></label>
    <label class="opt"><input type="radio" name="mode" value="press"><b>${tr('Типография')}</b></label>
    <label class="opt"><input type="radio" name="mode" value="web"><b>${tr('Для веба — PNG по страницам')}</b></label>
    <div class="fld" id="optWeb" hidden><label>${tr('Ширина страницы')}</label>${seg('data-webw', [[1080, '1080 px'], [1600, '1600 px'], [2160, '2160 px']], 1080)}
      <div class="note">${tr('Каждая страница — отдельный PNG, всё вместе — ZIP-архив')}</div></div>
    <label class="chk" id="optGuides"><input type="checkbox" name="guides" checked> ${tr('Линия разреза')}</label>
    <label class="chk" id="optMarks"><input type="checkbox" name="marks" checked> ${tr('Метки реза')}</label>
    ${bSide ? `<div class="fld"><label>${tr('Стороны')}</label><div class="btns">
      <label class="chk"><input type="checkbox" name="sa" checked> A · ${d.sides[0].type === 'zine' ? tr('зин') : tr('постер')}</label>
      <label class="chk"><input type="checkbox" name="sb" checked> B · ${d.sides[1].type === 'zine' ? tr('зин') : tr('постер')}</label></div></div>` : ''}
    ${over.length ? `<div class="warn">${tr('Текст не влезает')}: ${over.join(', ')}</div>` : ''}
  </div><div class="foot"><span class="note" id="expStatus"></span><button class="primary" data-go>${tr('Скачать PDF')}</button></div></div>`;
  $('#modal').hidden = false;
  // режим «для веба»: линии разреза и метки не нужны, нужна ширина картинок
  const sync = () => {
    const web = $('#modal [name=mode]:checked').value === 'web';
    $('#optWeb').hidden = !web;
    $('#optGuides').hidden = $('#optMarks').hidden = web;
    $('#modal [data-go]').textContent = web ? tr('Скачать PNG (.zip)') : tr('Скачать PDF');
  };
  $('#modal').onchange = sync;
  $('#modal').onclick = async (e) => {
    if (e.target.id === 'modal' || e.target.closest('[data-x]')) return closeModal();
    const wb = e.target.closest('[data-webw]');
    if (wb) { $('#modal').querySelectorAll('[data-webw]').forEach((b) => b.classList.toggle('on', b === wb)); return; }
    if (!e.target.closest('[data-go]')) return;
    const fd = (n) => $(`#modal [name=${n}]`);
    const o = {
      mode: $('#modal [name=mode]:checked').value,
      guides: fd('guides').checked, marks: fd('marks').checked,
      sides: [fd('sa') ? fd('sa').checked : true, fd('sb') ? fd('sb').checked : false],
    };
    const st = $('#expStatus');
    const fname = (S.doc.title || 'zine').replace(/[\\/:*?"<>|]+/g, '_');
    if (o.mode === 'web') {
      const width = +$('#modal [data-webw].on').dataset.webw;
      try {
        const blob = await pagesZip(S.doc, usedAssets(S.doc), {
          width, sides: o.sides, onStep: (i, n) => (st.textContent = tr('Страница {i} из {n}…', { i, n })),
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${fname}-png-${width}.zip`;
        a.click();
        st.textContent = tr('Готово.');
        track(`png-${width}`);
        setTimeout(closeModal, 600);
      } catch (err) {
        console.error(err);
        st.textContent = tr('Ошибка: ') + err.message;
      }
      return;
    }
    st.textContent = tr('Собираю PDF…');
    try {
      const bytes = await buildPDF(S.doc, o);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      a.download = `${(S.doc.title || 'zine').replace(/[\\/:*?"<>|]+/g, '_')}-${S.doc.format}${o.mode === 'press' ? '-print' : ''}.pdf`;
      a.click();
      st.textContent = tr('Готово.');
      track(`pdf-${o.mode}-${S.doc.format}`); // сколько и каких PDF скачивают
      setTimeout(closeModal, 600);
    } catch (err) {
      console.error(err);
      st.textContent = tr('Ошибка: ') + err.message;
    }
  };
}

// ---------- файл .zine ----------
function usedAssets(doc) {
  const ids = new Set();
  JSON.stringify(doc, (k, v) => { if ((k === 'asset' || k === 'qrimg') && v) ids.add(v); return v; });
  return [...ids];
}
function saveZine() {
  const out = { format: 'list-zine', v: 1, doc: S.doc, assets: {} };
  for (const id of usedAssets(S.doc)) if (assets[id]) out.assets[id] = { src: assets[id].src, w: assets[id].w, h: assets[id].h };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
  a.download = (S.doc.title || 'zine') + '.zine';
  a.click();
}
$('#fileZine').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    for (const [id, a] of Object.entries(data.assets || {})) { registerAsset(id, a); store.set('asset:' + id, a); }
    await loadDoc(M.normalize(data.doc));
    commit();
    toast(tr('Открыто: ') + S.doc.title);
  } catch (err) { toast(tr('Не удалось открыть файл'), true); }
});

// ---------- загрузка ----------
async function loadDoc(doc) {
  for (const k of ['heading', 'body']) if (!hasFont(doc.fonts[k])) doc.fonts[k] = M.blankDoc().fonts[k];
  await Promise.all([ensureFont(doc.fonts.heading), ensureFont(doc.fonts.body)]);
  S.doc = doc; S.sel = null; S.side = 0; S.page = 0;
  renderAll();
}

// Пример — готовый зин из samples/<язык>.zine; если файл недоступен, собираем встроенный
async function loadSample() {
  try {
    const r = await fetch(`samples/${getLang()}.zine`);
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    for (const [id, a] of Object.entries(data.assets || {})) { registerAsset(id, a); store.set('asset:' + id, a); }
    await loadDoc(M.normalize(data.doc));
  } catch (err) {
    console.warn('sample file failed, using built-in', err);
    const id = makeSampleAsset();
    store.set('asset:' + id, { src: assets[id].src, w: assets[id].w, h: assets[id].h });
    await loadDoc(M.sampleDoc(id));
  }
  commit();
}

setOnReady(() => renderView());

initAnalytics();

(async function boot() {
  await initFonts();
  const saved = await store.get('doc');
  if (saved) {
    const doc = M.normalize(saved);
    await Promise.all(usedAssets(doc).map(async (id) => { const a = await store.get('asset:' + id); if (a) registerAsset(id, a); }));
    await loadDoc(doc);
    commit();
    $('#saved').textContent = tr('сохранено');
  } else {
    await loadSample();
  }
  // на сенсорном экране один раз подсказываем главный жест
  try {
    if (touchMode() && !localStorage.getItem('zine-hint-draw')) {
      localStorage.setItem('zine-hint-draw', '1');
      setTimeout(() => toast(tr('Проведи пальцем по пустым ячейкам, чтобы добавить блок')), 800);
    }
  } catch (e) { /* без хранилища — без подсказки */ }
})();
