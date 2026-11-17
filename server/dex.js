// 圖鑑：每個人釣過哪些魚。每種記：釣過幾條、最大的那條多長多重、在哪裡釣到。
// 跟家當分開存（dexbook.json）：定時全服刷新清掉錢、船、魚，圖鑑留著
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { SPECIES } from '../src/fishdata.js';

// 釣到一條：更新圖鑑，回傳要告訴他的那一筆（isNew：第一次釣到這種）
export function recordDex(p, f, at) {
  const e = (Object.hasOwn(p.dex, f.id) && p.dex[f.id]) || (p.dex[f.id] = { n: 0, len: 0, kg: 0, at: '' });
  e.n++;
  if (f.len > e.len) { e.len = f.len; e.kg = f.kg; e.at = at || e.at; }
  return { id: f.id, e, isNew: e.n === 1 };
}

// 圖鑑的檔案：認人代碼 → 圖鑑。不分期、刷新不清（存法照 profiles.js）
export class Dexbooks {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'dexbook.json');
    this.raw = new Map();   // 代碼 → JSON 字串（比字串就知道有沒有變）
    this.dirty = false;
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8'));
      if (d && d.list && typeof d.list === 'object') for (const [k, v] of Object.entries(d.list)) this.raw.set(k, JSON.stringify(v));
    } catch { /* 沒有檔案、或檔案壞了：從空的開始 */ }
  }
  get(token) {
    const s = token && this.raw.get(token);
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  }
  put(token, dex) {
    if (!token || !dex || !Object.keys(dex).length) return;
    const s = JSON.stringify(dex);
    if (this.raw.get(token) === s) return;
    this.raw.set(token, s);
    this.dirty = true;
  }
  save() {
    if (!this.dirty) return;
    try {
      const list = [...this.raw].map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',');
      writeFileSync(this.file + '.tmp', `{"list":{${list}}}`);
      renameSync(this.file + '.tmp', this.file);
      this.dirty = false;
    } catch (err) { console.error('[dexbook] 存檔失敗', err.message); }
  }
}

// 存檔讀回來：只留認得的魚種、數字正常的；另外留著等級經驗 _lv（{ exp }）
export function loadDex(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, e] of Object.entries(raw)) {
    if (id === '_lv') { if (e && e.exp > 0) out._lv = { exp: Math.floor(Math.min(e.exp, 1e9)) }; continue; }   // 等級經驗（永久）
    if (id[0] === '_') continue;   // 舊版的跨季榮譽稱號（_honors）已經拿掉：稱號改成每週漁會捐款榜（guild.js）
    if (!SPECIES[id] || !e || !(e.n > 0)) continue;
    out[id] = { n: Math.floor(e.n), len: +e.len || 0, kg: +e.kg || 0, at: typeof e.at === 'string' ? e.at.slice(0, 20) : '' };
  }
  return out;
}
