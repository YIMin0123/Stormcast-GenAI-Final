// 圖鑑：每個人釣過哪些魚（跟著存檔）。每種記：釣過幾條、最大的那條多長多重、在哪裡釣到
import { SPECIES } from '../src/fishdata.js';

// 釣到一條：更新圖鑑，回傳要告訴他的那一筆（isNew：第一次釣到這種）
export function recordDex(p, f, at) {
  const e = p.dex[f.id] || (p.dex[f.id] = { n: 0, len: 0, kg: 0, at: '' });
  e.n++;
  if (f.len > e.len) { e.len = f.len; e.kg = f.kg; e.at = at || e.at; }
  return { id: f.id, e, isNew: e.n === 1 };
}

// 存檔讀回來：只留認得的魚種、數字正常的
export function loadDex(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, e] of Object.entries(raw)) {
    if (!SPECIES[id] || !e || !(e.n > 0)) continue;
    out[id] = { n: Math.floor(e.n), len: +e.len || 0, kg: +e.kg || 0, at: typeof e.at === 'string' ? e.at.slice(0, 20) : '' };
  }
  return out;
}
