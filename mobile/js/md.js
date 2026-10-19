// Мини-Markdown: инлайн (**жирный**, *курсив*, ссылки), абзацы, списки,
// разбор вставки на блоки и конвертация HTML из буфера обмена в Markdown.

const isL = (c) => !!c && /[\p{L}\p{N}]/u.test(c);

export function parseInline(s) {
  const runs = [];
  let b = false, i = false, buf = '';
  const push = () => { if (buf) { runs.push({ t: buf, b, i }); buf = ''; } };
  for (let k = 0; k < s.length; k++) {
    const c = s[k], n = s[k + 1], p = s[k - 1];
    if (c === '\\' && n) { buf += n; k++; continue; }
    if ((c === '*' && n === '*') || (c === '_' && n === '_' && !(isL(p) && isL(s[k + 2])))) {
      if (b || (s[k + 2] && s[k + 2] !== ' ')) { push(); b = !b; k++; continue; }
    }
    if (c === '*' || (c === '_' && !(isL(p) && isL(n)))) {
      if (i || (n && n !== ' ')) { push(); i = !i; continue; }
    }
    if (c === '`') continue;
    if (c === '[') {
      const m = s.slice(k).match(/^\[([^\]]*)\]\([^)]*\)/);
      if (m) { buf += m[1]; k += m[0].length - 1; continue; }
    }
    buf += c;
  }
  push();
  return runs;
}

const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;

// Текст блока -> абзацы [{kind:'p'|'ul'|'ol', num, blank, runs:[{t,b,i}|{br}]}]
// Одиночный перенос строки — жёсткий перенос, пустая строка — новый абзац.
// blank — сколько пустых строк стояло перед абзацем: каждая даёт пропуск высотой в строку.
export function parseText(md) {
  const paras = [];
  let cur = null, blank = 0;
  const add = (p) => { p.blank = blank; blank = 0; paras.push(p); return p; };
  for (const raw of (md || '').replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (!line.trim()) { blank++; cur = null; continue; }
    if (HR.test(line)) { cur = null; continue; }
    if ((m = line.match(/^\s*[-*+•]\s+(.*)$/))) { add({ kind: 'ul', runs: parseInline(m[1]) }); cur = null; continue; }
    if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) { add({ kind: 'ol', num: m[1], runs: parseInline(m[2]) }); cur = null; continue; }
    let runs;
    if ((m = line.match(/^#{1,6}\s+(.*)$/))) runs = parseInline(m[1]).map((r) => ({ ...r, b: true }));
    else if ((m = line.match(/^>\s?(.*)$/))) runs = parseInline(m[1]).map((r) => ({ ...r, i: true }));
    else runs = parseInline(line);
    if (cur) cur.runs.push({ br: true }, ...runs);
    else cur = add({ kind: 'p', runs });
  }
  return paras;
}

// Сколько видимых знаков (без разметки)
export function countChars(md) {
  return parseText(md).reduce((n, p) => n + p.runs.reduce((a, r) => a + (r.br ? 1 : r.t.length), 0), 0);
}

// Вставка целого текста -> список будущих блоков
export function parseBlocks(md) {
  const out = [];
  let buf = [];
  const flush = () => { const t = buf.join('\n').trim(); if (t) out.push({ type: 'text', text: t }); buf = []; };
  const lines = md.replace(/\r/g, '').split('\n');
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flush(); out.push({ type: 'heading', level: m[1].length, text: m[2].trim() }); continue; }
    if (HR.test(line)) { flush(); out.push({ type: 'divider' }); continue; }
    if ((m = line.match(/^\s*!\[([^\]]*)\]\(([^)]*)\)\s*$/))) { flush(); out.push({ type: 'image', alt: m[1], url: m[2] }); continue; }
    if (/^>\s?/.test(line)) {
      flush();
      const q = [];
      while (k < lines.length && /^>\s?/.test(lines[k])) q.push(lines[k++].replace(/^>\s?/, ''));
      k--;
      let by = '';
      if (q.length > 1 && /^\s*(—|--|-)\s+/.test(q[q.length - 1])) by = q.pop().replace(/^\s*(—|--|-)\s+/, '');
      out.push({ type: 'quote', text: q.join('\n').trim(), by });
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}

export const looksLikeMd = (s) => /^(#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s)|\*\*[^*]+\*\*|!\[[^\]]*\]\(/m.test(s);

// HTML из буфера (Google Docs, веб-страницы) -> Markdown
export function htmlToMd(html) {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const walk = (n) => {
    if (n.nodeType === 3) return n.textContent.replace(/\s+/g, ' ');
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toLowerCase();
    if (['style', 'script', 'meta', 'title', 'head'].includes(tag)) return '';
    const inner = [...n.childNodes].map(walk).join('');
    const st = n.style || {};
    const bold = ['b', 'strong'].includes(tag) ? !/^(normal|[1-5]00)$/.test(st.fontWeight || '') : /^(bold|[6-9]00)$/.test(st.fontWeight || '');
    const ital = ['i', 'em'].includes(tag) || st.fontStyle === 'italic';
    const wrap = (s, m) => (s.trim() ? s.replace(/^(\s*)(.*?)(\s*)$/s, `$1${m}$2${m}$3`) : s);
    switch (tag) {
      case 'h1': return `\n\n# ${inner.trim()}\n\n`;
      case 'h2': return `\n\n## ${inner.trim()}\n\n`;
      case 'h3': case 'h4': case 'h5': case 'h6': return `\n\n### ${inner.trim()}\n\n`;
      case 'p': case 'div': return `\n\n${inner.trim()}\n\n`;
      case 'br': return '\n';
      case 'li': {
        const ol = n.parentElement?.tagName.toLowerCase() === 'ol';
        const idx = [...n.parentElement.children].indexOf(n) + 1;
        return `\n${ol ? idx + '.' : '-'} ${inner.trim()}`;
      }
      case 'ul': case 'ol': return `\n${inner}\n\n`;
      case 'blockquote': return '\n\n' + inner.trim().split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
      case 'hr': return '\n\n---\n\n';
      case 'img': return `\n\n![${n.alt || ''}](${n.getAttribute('src') || ''})\n\n`;
    }
    let s = inner;
    if (bold) s = wrap(s, '**');
    if (ital) s = wrap(s, '*');
    return s;
  };
  return walk(dom.body).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
