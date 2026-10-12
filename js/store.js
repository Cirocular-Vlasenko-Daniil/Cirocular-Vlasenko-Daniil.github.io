// IndexedDB: документ и картинки хранятся раздельно, чтобы не переписывать мегабайты на каждое нажатие

let dbp;
const db = () => (dbp ||= new Promise((res, rej) => {
  const r = indexedDB.open('list-zine', 1); // старое рабочее имя проекта — не меняем, иначе пропадут черновики
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));

async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('kv', mode);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
}

export const get = (k) => tx('readonly', (s) => s.get(k)).catch(() => undefined);
export const set = (k, v) => tx('readwrite', (s) => s.put(v, k)).catch((e) => console.warn('save failed', e));
