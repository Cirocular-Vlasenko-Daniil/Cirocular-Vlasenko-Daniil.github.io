// Переводы интерфейса. Ключ — русская строка из кода: для ru возвращается как есть,
// для en ищется в словаре EN. Подстановки: t('Колонка {n}', { n: 2 }).
// Выбор языка общий для стартовой страницы и редактора (localStorage, с запасным вариантом).

import { EN } from './i18n-en.js?v=a376db71';

const KEY = 'zine-lang';
let lang = (() => {
  try { const v = localStorage.getItem(KEY); if (v === 'ru' || v === 'en') return v; } catch {}
  // по языку браузера: русский — если браузер на русском, иначе английский
  return /^ru\b/i.test(navigator.language || '') ? 'ru' : 'en';
})();

export const getLang = () => lang;

export function setLang(v) {
  lang = v === 'en' ? 'en' : 'ru';
  try { localStorage.setItem(KEY, lang); } catch {}
  document.documentElement.lang = lang;
  applyStatic();
}

export function t(s, vars) {
  let out = lang === 'en' ? EN[s] ?? s : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return out;
}

// Статичная разметка: у элементов с data-i18n переводится текст, с data-i18n-title — подсказка.
// Исходный русский текст запоминается при первом проходе.
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.dataset.i18nSrc ??= el.innerHTML.trim();
    el.innerHTML = t(el.dataset.i18nSrc);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.dataset.i18nTitleSrc ??= el.title;
    el.title = t(el.dataset.i18nTitleSrc);
  });
  root.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
}

// Переключатель RU / EN: onChange вызывается после смены языка (перерисовать динамику)
export function bindLangSwitch(el, onChange) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b || b.dataset.lang === lang) return;
    setLang(b.dataset.lang);
    onChange?.();
  });
  document.documentElement.lang = lang;
  applyStatic();
}
