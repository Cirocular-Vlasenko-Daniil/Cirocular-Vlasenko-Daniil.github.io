// Статистика: GoatCounter — без cookie и без личных данных, баннер согласия не нужен.
// Включение: зарегистрировать сайт на goatcounter.com и вписать сюда его код
// (для https://tenminutezine.goatcounter.com — 'tenminutezine'). Пустая строка — статистика выключена.
const GOATCOUNTER_CODE = 'daniilvlasenko';

// на локальном сервере и при открытии файлом не считаем
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.(localhost|test))$/.test(location.hostname) || location.protocol === 'file:';

// версия на itch.io: редактор во фрейме на html.itch.zone. GoatCounter по умолчанию не считает
// фреймы (allow_frame); путь задаём сами — адрес фрейма у itch технический и меняется с каждой загрузкой
const ITCH = /(^|\.)itch\.zone$/.test(location.hostname);

let ready = null;

export function initAnalytics() {
  if (!GOATCOUNTER_CODE || LOCAL || ready) return;
  ready = new Promise((res) => {
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://gc.zgo.at/count.js';
    s.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
    if (ITCH) s.dataset.goatcounterSettings = JSON.stringify({ allow_frame: true, path: '/itch/editor', title: 'itch.io' });
    s.onload = res;
    s.onerror = res; // блокировщик рекламы — сайт работает как обычно
    document.head.appendChild(s);
  });
}

// Событие без привязки к человеку: только название, например 'pdf-home-A4'
export function track(name) {
  if (!ready) return;
  const path = ITCH ? 'itch-' + name : name; // скачивания с itch — отдельной строкой
  ready.then(() => window.goatcounter?.count?.({ path, title: path, event: true }));
}
