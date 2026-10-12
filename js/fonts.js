// Шрифты: один и тот же TTF используется для экрана (FontFace), измерения строк
// и встраивания в PDF — поэтому переносы на экране и в печати совпадают.

let list = [];
const byId = {};
const bytes = new Map();   // 'id:style' -> ArrayBuffer
const metric = new Map();  // 'id:style' -> PDFFont (для измерения)
const loading = new Map();
const wcache = new Map();
let mdoc;
// ревизия файлов шрифтов: шрифты кэшируются на неделю — при замене файлов меняем её
const FONT_REV = '?r=2';

export async function initFonts() {
  list = await (await fetch('fonts/fonts.json')).json();
  list.forEach((f) => (byId[f.id] = f));
  mdoc = await PDFLib.PDFDocument.create();
  mdoc.registerFontkit(window.fontkit);
}

export const fontList = () => list;
export const hasFont = (id) => !!byId[id];

export function ensureFont(id) {
  if (!byId[id]) return Promise.resolve();
  if (loading.has(id)) return loading.get(id);
  const p = Promise.all(Object.entries(byId[id].files).map(async ([st, file]) => {
    const buf = await (await fetch('fonts/' + file + FONT_REV)).arrayBuffer();
    const key = id + ':' + st;
    bytes.set(key, buf);
    const f = cssFont(key);
    const face = new FontFace(f.family, buf.slice(0), { weight: String(f.weight), style: f.style });
    await face.load();
    document.fonts.add(face);
    metric.set(key, await mdoc.embedFont(buf.slice(0), { subset: false }));
  }));
  loading.set(id, p);
  return p;
}

// Лучший доступный начертание: нет курсива — берём прямое, нет жирного — обычное
export function fontKey(id, b, i) {
  const f = byId[id] || list[0];
  const want = b && i ? 'bi' : b ? 'b' : i ? 'i' : 'r';
  const order = { bi: ['bi', 'b', 'i', 'r'], b: ['b', 'r'], i: ['i', 'r'], r: ['r'] }[want];
  return f.id + ':' + (order.find((s) => f.files[s]) || 'r');
}

export function cssFont(key) {
  const [id, st] = key.split(':');
  return { family: 'zf-' + id, weight: st.includes('b') ? 700 : 400, style: st.includes('i') ? 'italic' : 'normal' };
}

export const fontBytes = (key) => bytes.get(key);

// Текст в кривые (для типографии): контуры глифов строкой SVG-пути в мм, начало — точка
// базовой линии, ось Y вниз. Глифы и их ширины — те же, что у drawText в pdf-lib и у W():
// font.layout с теми же лигатурами, шаг — advanceWidth. null — шрифт ещё не загружен.
const gcache = new Map();
export function glyphPath(key, text, size) {
  const f = metric.get(key)?.embedder?.font;
  if (!f) return null;
  const k = size / f.unitsPerEm;
  let x = 0, d = '';
  for (const g of f.layout(text).glyphs) {
    let p = gcache.get(key + '|' + g.id);
    if (p === undefined) { p = g.path; gcache.set(key + '|' + g.id, p); }
    if (p.commands.length) d += p.scale(k, -k).translate(x, 0).toSVG();
    x += g.advanceWidth * k;
  }
  return d;
}

// Ширина строки в мм при кегле size (мм)
export function W(key, text, size) {
  const ck = key + '\u0001' + text;
  let w = wcache.get(ck);
  if (w === undefined) {
    const f = metric.get(key);
    if (!f) return text.length * size * 0.55;
    w = f.widthOfTextAtSize(text, 1000) / 1000;
    wcache.set(ck, w);
  }
  return w * size;
}

// Верх «чернил» буквы в долях кегля: реальная высота глифа. Поля xHeight/capHeight в OS/2
// у части шрифтов неточные (у Pixelify Sans заглавные 0.70 вместо 0.63), поэтому они — запасной вариант
function inkTop(f, cp) {
  try {
    const g = f.glyphForCodePoint(cp);
    return g?.id ? g.bbox.maxY / f.unitsPerEm : 0;
  } catch { return 0; }
}
const okH = (v, lo) => v > lo && v <= 1.05; // пиксельные шрифты бывают с заглавными в полный кегль

// Высота строчных (x-height) в долях кегля — по букве «x», запасной вариант — поле шрифта
const xcache = new Map();
export function xHeight(key) {
  if (xcache.has(key)) return xcache.get(key);
  const f = metric.get(key)?.embedder?.font;
  if (!f) return 0.5;
  let v = inkTop(f, 0x78);
  if (!okH(v, 0.2)) v = f.xHeight / f.unitsPerEm;
  if (!okH(v, 0.2)) v = 0.5;
  xcache.set(key, v);
  return v;
}

// Высота заглавных (cap height) в долях кегля — по букве «H», запасной вариант — поле шрифта
const ccache = new Map();
export function capHeight(key) {
  if (ccache.has(key)) return ccache.get(key);
  const f = metric.get(key)?.embedder?.font;
  if (!f) return 0.7;
  let v = inkTop(f, 0x48);
  if (!okH(v, 0.3)) v = f.capHeight / f.unitsPerEm;
  if (!okH(v, 0.3)) v = 0.7;
  ccache.set(key, v);
  return v;
}

const SAMPLE = 'Съешь же ещё этих мягких французских булок, да выпей чаю. Зин — это свобода печати.';
export const avgCharW = (key, size) => W(key, SAMPLE, size) / SAMPLE.length;
