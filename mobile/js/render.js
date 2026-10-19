// Display list -> SVG (редактор, превью листа, миниатюры)

import { cssFont } from './fonts.js?v=a376db71';
import { assets, fitRect, ditherURL, blurURL, srcOf } from './images.js?v=a376db71';

const n = (v) => +v.toFixed(3);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ph(it) {
  const cls = it.faint ? 'ph faint' : 'ph';
  let s = `<rect class="${cls}" x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}"/>`;
  if (it.label) {
    const fs = Math.min(2.6, it.h * 0.25, it.w * 0.09);
    s += `<text class="phl" x="${n(it.x + it.w / 2)}" y="${n(it.y + it.h / 2 + fs * 0.35)}" font-size="${n(fs)}" text-anchor="middle">${esc(it.label)}</text>`;
  }
  return s;
}

function image(it) {
  const a = assets[it.asset];
  if (!a) return '';
  const box = `x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}"`;
  if (it.filter === 'dither') {
    const url = ditherURL(it);
    return url
      ? `<image href="${url}" ${box} preserveAspectRatio="none" image-rendering="optimizeSpeed" style="image-rendering:pixelated"/>`
      : `<rect ${box} fill="#eee"/>`;
  }
  if (it.blur > 0) {
    const url = blurURL(it);
    return url ? `<image href="${url}" ${box} preserveAspectRatio="none"/>` : `<rect ${box} fill="#eee"/>`;
  }
  const src = srcOf(it.asset, it.rot); // с учётом поворота; null — картинка ещё грузится
  if (!src) return `<rect ${box} fill="#eee"/>`;
  const r = fitRect(it, src.w, src.h);
  // инверсия после умножения — с жёстким краем (см. invAfterMul в layout.js)
  const f = it.filter === 'gray' ? ` filter="url(#${it.invMul ? 'zf-gray-hard' : it.invert ? 'zf-gray-inv' : 'zf-gray'})"` : '';
  return `<svg ${box} viewBox="0 0 ${n(it.w)} ${n(it.h)}"><image href="${src.url}" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" preserveAspectRatio="none"${f}/></svg>`;
}

export function svgInner(items) {
  let out = '';
  for (const it of items) {
    switch (it.t) {
      case 'text': {
        const f = cssFont(it.key);
        out += `<text x="${n(it.x)}" y="${n(it.y)}" font-family="${f.family}" font-weight="${f.weight}" font-style="${f.style}" font-size="${n(it.size)}" fill="${it.fill}">${esc(it.s)}</text>`;
        break;
      }
      case 'rect':
        out += `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" fill="${it.fill}"${it.o != null ? ` fill-opacity="${it.o}"` : ''}/>`;
        break;
      case 'line':
        out += `<line x1="${n(it.x1)}" y1="${n(it.y1)}" x2="${n(it.x2)}" y2="${n(it.y2)}" stroke="${it.stroke}" stroke-width="${n(it.w)}"${it.dash ? ` stroke-dasharray="${it.dash.map(n).join(' ')}"` : ''}/>`;
        break;
      case 'path':
        out += `<path transform="translate(${n(it.x)} ${n(it.y)})" d="${it.d}" fill="${it.fill}"/>`;
        break;
      case 'image': {
        // clip — видимая часть (общий фон обложек шире полосы); вложенный svg обрезает по своим границам
        // blend — наложение «умножение»: белое становится прозрачным, картинка ложится на бумагу и фон
        const c = it.clip, bl = it.blend === 'multiply' ? ' style="mix-blend-mode:multiply"' : '';
        const wrap = (attrs, inner) => c
          ? `<svg x="${n(c.x)}" y="${n(c.y)}" width="${n(c.w)}" height="${n(c.h)}" viewBox="${n(c.x)} ${n(c.y)} ${n(c.w)} ${n(c.h)}"${attrs}>${inner}</svg>`
          : attrs ? `<g${attrs}>${inner}</g>` : inner;
        out += wrap(bl, image(it));
        // инверсия после умножения: белый силуэт картинки в режиме «разница» инвертирует всё под ним
        if (it.invMul) out += wrap(' style="mix-blend-mode:difference"', `<g filter="url(#zf-sil)">${image(it)}</g>`);
        break;
      }
      case 'ph': out += ph(it); break;
      case 'group': { // часть блока, обрезанная по краю полосы (общая сетка разворота)
        if (it.m) { out += `<g transform="matrix(${it.m.map(n).join(' ')})">${svgInner(it.items)}</g>`; break; } // повёрнутый блок
        const c = it.clip;
        out += `<svg x="${n(c.x)}" y="${n(c.y)}" width="${n(c.w)}" height="${n(c.h)}" viewBox="${n(c.x)} ${n(c.y)} ${n(c.w)} ${n(c.h)}">${svgInner(it.items)}</svg>`;
        break;
      }
    }
  }
  return out;
}

export function pageSVG(items, w, h, under = '', paper = '#fff') {
  // preserveAspectRatio="none": холст страницы — целые пиксели, рисунок растягивается ровно на него
  // (иначе последний неполный пиксель справа/снизу просвечивал подложкой — светлая полоса на тёмной бумаге)
  return `<svg class="pg" viewBox="0 0 ${n(w)} ${n(h)}" preserveAspectRatio="none" xml:space="preserve"><rect width="${n(w)}" height="${n(h)}" fill="${paper}"/>${svgInner(items)}${under}</svg>`;
}
