// Случайная палитра по правилам колористики: бумага, основная краска, акцент, системная краска.
// Цвета строятся в OKLCH (равномерная по восприятию модель): оттенки — по схеме гармонии,
// светлота и насыщенность — по ролям, а контраст с бумагой проверяется по WCAG,
// чтобы текст читался. Неудачные сочетания (грязный акцент, слипшиеся краски) отбрасываются.

import { PAPERS } from './model.js?v=a0df7e09';

const RAD = Math.PI / 180;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const wrap = (h) => ((h % 360) + 360) % 360;
const hueDist = (a, b) => { const d = Math.abs(wrap(a) - wrap(b)); return Math.min(d, 360 - d); };

// OKLCH -> линейный sRGB (Björn Ottosson)
function toLinear(L, C, h) {
  const a = C * Math.cos(h * RAD), b = C * Math.sin(h * RAD);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
const inGamut = (c) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

// Цвет в OKLCH; если не помещается в sRGB — снижаем насыщенность, сохраняя светлоту и оттенок
function oklch(L, C, h) {
  let lin = toLinear(L, C, h);
  while (!inGamut(lin) && C > 0) { C = Math.max(0, C - 0.004); lin = toLinear(L, C, h); }
  return { L, C, h, lin: lin.map((v) => Math.min(1, Math.max(0, v))) };
}

const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const hex = (c) => '#' + c.lin.map((v) => Math.round(enc(v) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (h) => {
  const v = parseInt(h.slice(1), 16);
  const dec = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return { lin: [dec((v >> 16) & 255), dec((v >> 8) & 255), dec(v & 255)] };
};
const lum = (c) => 0.2126 * c.lin[0] + 0.7152 * c.lin[1] + 0.0722 * c.lin[2];
export const contrast = (a, b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// Пороги: основной текст — 7:1 (мелкий кегль зина), системная краска — 4.5:1 (подписи),
// акцент — 3:1 (заголовки и плашки с выколоткой цвета бумаги)
const MIN = { ink: 7, meta: 4.5, accent: 3 };

// Темнее, пока не хватит контраста с бумагой (или пока не упрёмся в предел светлоты)
function darken(L, C, h, paper, need, floor) {
  let c = oklch(L, C, h);
  while (contrast(c, paper) < need && L > floor) { L -= 0.015; c = oklch(L, C, h); }
  return c;
}

// Схемы гармонии: оттенок основной краски -> оттенок акцента
const SCHEMES = [
  ['Комплементарная', (h) => h + 180],
  ['Сплит-комплементарная', (h) => h + pick([150, 210])],
  ['Триада', (h) => h + pick([120, 240])],
  ['Аналоговая', (h) => h + pick([-45, 45])],
  ['Тёплое и холодное', null], // холодная основная + тёплый акцент (или наоборот)
];

function paperFor(inkH, accH) {
  const kind = pick(['white', 'white', 'cream', 'tint-ink', 'tint-acc', 'kraft']);
  switch (kind) {
    case 'white': return oklch(rnd(0.985, 0.995), rnd(0, 0.006), rnd(0, 360));
    case 'cream': return oklch(rnd(0.955, 0.975), rnd(0.018, 0.035), rnd(78, 95));
    case 'tint-ink': return oklch(rnd(0.955, 0.98), rnd(0.012, 0.03), inkH);
    case 'tint-acc': return oklch(rnd(0.955, 0.98), rnd(0.015, 0.035), accH);
    default: return oklch(rnd(0.87, 0.91), rnd(0.035, 0.06), rnd(65, 85)); // крафт
  }
}

function generated(prev) {
  const [name, rule] = pick(SCHEMES.filter(([n]) => n !== prev));
  let inkH, accH;
  if (rule) { inkH = rnd(0, 360); accH = wrap(rule(inkH)); }
  else { inkH = rnd(200, 290); accH = rnd(15, 75); if (Math.random() < 0.3) [inkH, accH] = [rnd(20, 60), rnd(190, 250)]; }
  const paper = paperFor(inkH, accH);
  // основная — тёмная, но с заметным оттенком: иначе любая палитра выглядит «чёрный + цвет»
  const ink = darken(rnd(0.3, 0.44), rnd(0.09, 0.17), inkH, paper, MIN.ink, 0.12);
  const accent = darken(rnd(0.6, 0.72), rnd(0.17, 0.26), accH, paper, MIN.accent, 0.42);
  // системная — приглушённая основная: светлее её, но читается как подпись
  const meta = darken(rnd(0.55, 0.62), rnd(0.012, 0.04), inkH, paper, MIN.meta, ink.L + 0.1);
  return { name, paper, ink, accent, meta };
}

// Ризо-пара: реальные краски ризографа на бумаге из набора — как в настоящей типографии зинов
const RISO_INK = ['#000000', '#0078bf', '#00838a', '#765ba7', '#914e72', '#00a95c'];
const RISO_ACC = ['#ff48b0', '#f15060', '#ff6c2f', '#0078bf', '#00a95c', '#765ba7', '#00838a'];
function riso() {
  const ink = pick(RISO_INK), accent = pick(RISO_ACC.filter((c) => c !== ink));
  const paper = pick(PAPERS)[0];
  const meta = pick(['#6b6b6b', '#6b6b6b', ink]);
  return {
    name: 'Ризо-пара', riso: true,
    paper: fromHex(paper), ink: fromHex(ink), accent: fromHex(accent), meta: fromHex(meta),
    hexes: { paper, ink, accent, meta },
  };
}

// Интересная ли палитра: всё читается, акцент живой и не сливается с основной
function good(p) {
  if (contrast(p.ink, p.paper) < (p.riso ? 4.5 : MIN.ink)) return false;
  if (contrast(p.accent, p.paper) < (p.riso ? 2.6 : MIN.accent)) return false;
  if (contrast(p.meta, p.paper) < (p.riso ? 4.5 : MIN.meta)) return false;
  if (p.riso) return true;
  if (p.accent.C < 0.11) return false;                          // грязный, сероватый акцент
  // жёлтый на светлой бумаге не читается, а затемнённый до контраста — оливковый
  if (p.accent.h > 80 && p.accent.h < 130 && p.accent.L < 0.7) return false;
  if (p.ink.C < 0.06) return false;                              // основная ушла в серо-чёрную
  if (hueDist(p.ink.h, p.accent.h) < 30 && p.ink.C > 0.03) return false; // краски слиплись
  if (contrast(p.accent, p.ink) < 1.6) return false;             // акцент не отличается от текста по светлоте
  return true;
}

// Новая палитра {paper, ink, accent, meta, name} — hex-строки. prev — имя прошлой схемы, чтобы не повторяться.
export function randomPalette(prev) {
  for (let i = 0; i < 300; i++) {
    const p = Math.random() < 0.3 && prev !== 'Ризо-пара' ? riso() : generated(prev);
    if (!good(p)) continue;
    const h = p.hexes || { paper: hex(p.paper), ink: hex(p.ink), accent: hex(p.accent), meta: hex(p.meta) };
    return { ...h, name: p.name };
  }
  return { paper: '#f4efe3', ink: '#0078bf', accent: '#ff48b0', meta: '#6b6b6b', name: 'Ризо-пара' };
}
