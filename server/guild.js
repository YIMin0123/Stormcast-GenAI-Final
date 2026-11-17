// 漁會：每週捐款榜（功德榜）與稱號、玩家的等級經驗。
// 捐款榜全服共用（不分房）、每週重置一次（哪一天幾點見 config.js 的 GUILD），存在 guild.json；全服定時刷新不清它。
// 榜上用「玩家代碼」認人（uid = pidOf(token)：登入代碼雜湊後的 10 碼，跟管理網頁同一個），改名不掉榜、也不會把登入代碼寫進榜裡。
// 等級經驗是永久的，跟圖鑑存在一起（p.dex._lv，見 dex.js）
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { GUILD, LEVEL, levelOf } from '../src/config.js';
import { titlesFor, HONOR_TITLES } from '../src/boatdata.js';
import { pidOf } from './activity.js';

const DAY = 86400000;
const GOLD = new Set(HONOR_TITLES.filter((t) => t.gold).map((t) => t.name));
export const isGold = (title) => GOLD.has(title);

// 這一刻屬於第幾週（每週 GUILD.weekDay 的 GUILD.hour 點換週，照 GUILD.tzHours 的時區算）
export function weekKey(now = Date.now()) {
  const days = Math.floor((now + (GUILD.tzHours - GUILD.hour) * 3600000) / DAY);   // 1970-01-01 是週四
  return Math.floor((days + 4 - GUILD.weekDay) / 7);
}
// 這一週什麼時候結束（毫秒）
export function weekEndsAt(now = Date.now()) {
  return ((weekKey(now) + 1) * 7 - 4 + GUILD.weekDay) * DAY - (GUILD.tzHours - GUILD.hour) * 3600000;
}

export class Guild {
  // dir：存檔的資料夾（不給就只放在記憶體，測試用）
  constructor(dir = null, now = Date.now()) {
    this.file = dir ? join(dir, 'guild.json') : null;
    this.week = weekKey(now);
    this.list = new Map();   // uid → { name, amount, at 最後一次捐的時間, wear 想戴的稱號 }
    this.dirty = false;
    if (!this.file) return;
    mkdirSync(dir, { recursive: true });
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8'));
      if (d && d.week === this.week && d.list && typeof d.list === 'object') {
        for (const [uid, e] of Object.entries(d.list)) {
          if (!e || !(e.amount > 0)) continue;
          this.list.set(uid, { name: String(e.name || '').slice(0, 24), amount: Math.floor(e.amount), at: +e.at || 0, wear: typeof e.wear === 'string' ? e.wear : '' });
        }
      }
    } catch { /* 沒有檔案、壞了、或是上一週的：從空的開始 */ }
  }
  // 換週了就清空。回傳有沒有清
  roll(now = Date.now()) {
    const w = weekKey(now);
    if (w === this.week) return false;
    this.week = w;
    this.list.clear();
    this.dirty = true;
    return true;
  }
  // 照捐款排好的名單（多的在前；一樣多的，先捐到的在前）
  ranked() { return [...this.list].sort((a, b) => b[1].amount - a[1].amount || a[1].at - b[1].at); }
  // 這個人這一週：捐了多少、第幾名（0 = 還沒捐）、有哪些稱號可以戴、現在戴哪個
  info(token) {
    const uid = pidOf(token), e = this.list.get(uid);
    if (!e) return { amount: 0, rank: 0, titles: [], wear: '' };
    const rank = this.ranked().findIndex(([k]) => k === uid) + 1, titles = titlesFor(e.amount, rank);
    return { amount: e.amount, rank, titles, wear: titles.includes(e.wear) ? e.wear : '' };
  }
  // 捐款。回傳捐完之後的 info
  donate(token, name, amount, now = Date.now()) {
    this.roll(now);
    const uid = pidOf(token), had = this.info(token);
    const e = this.list.get(uid) || { name, amount: 0, at: now, wear: '' };
    e.name = name; e.amount += amount; e.at = now;
    this.list.set(uid, e);
    this.dirty = true;
    const got = this.info(token);
    // 還沒戴稱號、這次新解鎖了：自動戴上最好的那個（特殊稱號優先，不然戴門檻最高的）
    if (!got.wear) {
      const fresh = got.titles.filter((t) => !had.titles.includes(t));
      if (fresh.length) { e.wear = fresh.find((t) => GOLD.has(t)) || fresh[fresh.length - 1]; got.wear = e.wear; }
    }
    return got;
  }
  // 換一個稱號戴（'' = 不戴）。只能戴現在有的；回傳成不成
  wear(token, title) {
    const e = this.list.get(pidOf(token));
    if (title === '') { if (e && e.wear) { e.wear = ''; this.dirty = true; } return true; }
    if (!e || !this.info(token).titles.includes(title)) return false;
    e.wear = title; this.dirty = true;
    return true;
  }
  // 改名了：榜上的名字跟著換
  rename(token, name) { const e = this.list.get(pidOf(token)); if (e && e.name !== name) { e.name = name; this.dirty = true; } }
  // 給看板、平板看的前幾名：[{ name, amount, title, gold }]（不含玩家代碼）
  top(n = GUILD.top) {
    return this.ranked().slice(0, n).map(([, e], i) => {
      const titles = titlesFor(e.amount, i + 1), title = titles.includes(e.wear) ? e.wear : '';
      return { name: e.name, amount: e.amount, title, gold: GOLD.has(title) };
    });
  }
  save() {
    if (!this.file || !this.dirty) return;
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify({ week: this.week, list: Object.fromEntries(this.list) }));
      renameSync(this.file + '.tmp', this.file);
      this.dirty = false;
    } catch (err) { console.error('[guild] 存檔失敗', err.message); }
  }
}

// ---- 等級 ----
export const expOf = (p) => Math.max(0, Math.floor(p.dex?._lv?.exp || 0));
export const lvOf = (p) => levelOf(expOf(p)).lv;
// 給 p 加經驗（有同隊隊友在線上、同房：多 LEVEL.party 成）。回傳 { add 實際加了多少, lv, up 有沒有升級 }
export function gainExp(room, p, base) {
  if (!(base > 0) || !Number.isFinite(base)) return null;
  const mate = p.party && [...room.players.values()].some((o) => o !== p && o.ws && o.party === p.party);
  const add = Math.max(1, Math.round(base * (mate ? 1 + LEVEL.party : 1))), was = lvOf(p);
  (p.dex._lv ||= { exp: 0 }).exp = expOf(p) + add;
  const lv = lvOf(p), up = lv > was;
  room.send(p, { t: 'exp', exp: expOf(p), add, lv, up, mate: !!mate });
  if (up) { room.all({ t: 'lv', id: p.id, lv }, p); room.sys(`🎉 ${p.name} 升到 Lv.${lv}！`, 'join', p); }
  return { add, lv, up };
}

// ---- 稱號 ----
// 捐款榜有變（有人捐款、換稱號、換週）：把每個在線上的人「現在戴的稱號」重算一次，有變的告訴同房的人
export function syncTitles(hub) {
  if (!hub.guild || !hub.eachRoom) return;
  hub.eachRoom((room) => {
    for (const p of room.players.values()) {
      const g = hub.guild.info(p.token), wear = g.wear;
      p.titles = g.titles;   // 活動紀錄的「這一場得到什麼」會看
      if (wear === (p.wearTitle || '')) continue;
      p.wearTitle = wear;
      room.all({ t: 'title', id: p.id, title: wear, gold: isGold(wear) });
    }
  });
}
// 這個人的漁會資料（給他自己的平板看）
export function guildOf(hub, p) {
  const g = hub.guild ? hub.guild.info(p.token) : { amount: 0, rank: 0, titles: [], wear: '' };
  return { ...g, endsAt: weekEndsAt(), min: GUILD.min };
}
