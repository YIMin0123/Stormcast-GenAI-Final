// 玩家活動紀錄：誰什麼時候進來、玩多久、換過什麼名字、用電腦還是手機、釣了多少、賺花多少、買了什麼。
// 給管理者（我們）看，跟遊戲內的紀錄榜（daily.js）和玩家看的公告無關。
//   - 事件：每天一個 JSONL（DATA/activity/YYYY-MM-DD.jsonl，台灣時間），一行一件事，只會附加
//       boot 伺服器啟動 / join 進房 / back 斷線接回 / drop 斷線 / end 場次結束（含摘要）/ rename 換名 / pop 線上人數
//   - 人：DATA/activity/people.json，每個裝置代碼一筆（名字沿革、IP、裝置、場次累計）
//   - 保留 KEEP_DAYS 天，超過的檔案與很久沒出現的人自動刪掉
//   - 認人代碼本身能用來接回別人的進度，所以紀錄裡只放它的雜湊（pid），不放原值
// 遊玩摘要不在 room.js 到處埋點：進房和離開各拍一張快照比較，金錢用每次存檔（hub.keep）取樣累計。
// 看的地方：管理網頁 /admin/stats（server/statsPage.js，只限伺服器本機），用 deploy/stats.sh 開。
import { appendFileSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { BOAT_TYPES, BOAT_MODS, BOAT_PAINTS, HONOR_TITLES } from '../src/boatdata.js';

export const KEEP_DAYS = 30;
const POP_BEAT = 10 * 60 * 1000;   // 有人在線時，沒變化也每 10 分鐘記一次人數
const MAX_NAMES = 30, MAX_IPS = 10;

const TW = 8 * 3600 * 1000;   // 台灣 UTC+8，沒有日光節約時間
export const dayOf = (ms) => new Date(ms + TW).toISOString().slice(0, 10);
export const hourOf = (ms) => new Date(ms + TW).getUTCHours();
export const pidOf = (token) => createHash('sha256').update('stormcast:' + token).digest('hex').slice(0, 10);

// 從連線的 User-Agent 看是電腦還是手機。iPad 開「電腦版網站」時 UA 跟 Mac 一樣，分不出來，會算成電腦
export function parseDevice(ua = '', chMobile = '') {
  ua = String(ua).slice(0, 300);
  const type = chMobile === '?1' || /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua) ? 'mobile' : 'pc';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '其他';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '其他';
  return { type, os, browser };
}

// 玩家真正的 IP：正式機在 Caddy 後面，連線永遠來自本機，真的 IP 在 X-Forwarded-For（Caddy 會自己填、不信外面送來的）。
// 只有連線來自本機時才採用那個標頭，不然任何人都能偽造
export function clientIp(req) {
  const remote = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (['127.0.0.1', '::1'].includes(remote)) {
    const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim().replace(/^::ffff:/, '');
    if (isIP(xf)) return xf;
  }
  return remote.slice(0, 45);
}

const catchTotal = (dex) => Object.entries(dex || {}).reduce((s, [k, v]) => (k[0] === '_' ? s : s + (Number(v?.n) || 0)), 0);

// 他現在擁有的東西：key → { label, lv }，拿進房和離開時的兩張比，多出來或升級的就是「買了」
function owned(p) {
  const k = p.kit || {}, m = new Map();
  for (const [b, v] of Object.entries(k.boats || {})) {
    m.set('boat:' + b, { label: BOAT_TYPES[b]?.name || b, lv: 0 });
    m.set('engine:' + b, { label: `${BOAT_TYPES[b]?.name || b}引擎`, lv: Number(v?.engineLv) || 0 });
  }
  m.set('rod', { label: '釣竿', lv: Number(k.rodLv) || 0 });
  for (const id of Object.keys(k.mods || {})) if (k.mods[id]) m.set('mod:' + id, { label: BOAT_MODS[id]?.name || id, lv: 0 });
  for (const id of k.paints || []) if (id !== 'default') m.set('paint:' + id, { label: '塗裝' + (BOAT_PAINTS.find((x) => x.id === id)?.name || id), lv: 0 });
  if (k.wrench) m.set('wrench', { label: '扳手', lv: 0 });
  for (const id of p.dex?._honors?.titles || []) m.set('title:' + id, { label: '頭銜' + (HONOR_TITLES.find((x) => x.id === id)?.name || id), lv: 0 });
  return m;
}
function gained(before, after) {
  const out = [];
  for (const [key, e] of after) {
    const old = before.get(key);
    if (!old) { if (e.lv || !key.startsWith('engine:')) out.push(e.lv ? `${e.label} Lv${e.lv}` : e.label); }   // 新買的船本來就帶 0 級引擎，不另外算
    else if (e.lv > old.lv) out.push(`${e.label} Lv${e.lv}`);
  }
  return out.slice(0, 20);
}

export class Activity {
  // off：測試用伺服器（server/dev.js）不記紀錄，只有正式機的玩家才進統計
  constructor(dir, { now = () => Date.now(), off = false } = {}) {
    this.off = off;
    this.dir = join(dir, 'activity');
    this.now = now;
    this.live = new Map();
    this.lastPop = { n: -1, at: 0 };
    this.people = {};
    this.dirty = false;
    if (off) return;
    mkdirSync(this.dir, { recursive: true });
    this.file = join(this.dir, 'people.json');
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8'));
      if (d && typeof d.people === 'object' && d.people) this.people = d.people;
    } catch { /* 沒有檔案、或檔案壞了：從空的開始 */ }
    this.log({ t: 'boot' });
  }

  log(ev) {
    if (this.off) return;
    ev.at = this.now();
    try { appendFileSync(join(this.dir, dayOf(ev.at) + '.jsonl'), JSON.stringify(ev) + '\n'); } catch (err) { console.error('[activity] 寫紀錄失敗', err.message); }
  }

  // 登記名字、IP、裝置；名字跟上次不一樣就記一筆換名
  _touch(pid, p, meta, newSession) {
    const at = this.now();
    let rec = this.people[pid];
    const isNew = !rec;
    if (!rec) rec = this.people[pid] = { first: at, last: at, names: [], ips: [], dev: meta.dev.type, os: meta.dev.os, browser: meta.dev.browser, sessions: 0, sec: 0, catches: 0, earned: 0, spent: 0 };
    const lastName = rec.names.length ? rec.names[rec.names.length - 1].name : '';
    if (lastName !== p.name) {
      if (lastName) this.log({ t: 'rename', pid, from: lastName, to: p.name });
      rec.names.push({ name: p.name, at });
      if (rec.names.length > MAX_NAMES) rec.names.splice(0, rec.names.length - MAX_NAMES);
    }
    if (meta.ip) { rec.ips = [meta.ip, ...rec.ips.filter((x) => x !== meta.ip)].slice(0, MAX_IPS); }
    rec.dev = meta.dev.type; rec.os = meta.dev.os; rec.browser = meta.dev.browser;
    rec.last = at;
    if (newSession) rec.sessions++;
    this.dirty = true;
    return isNew;
  }

  // 一個人進房（從大廳選了房間）
  begin(p, meta, roomName) {
    if (this.off || !p.token || p.act) return;
    const pid = pidOf(p.token), isNew = this._touch(pid, p, meta, true);
    const at = this.now();
    p.act = { pid, at, ip: meta.ip, dev: meta.dev.type, money: p.kit?.money || 0, earned: 0, spent: 0, epoch: undefined, catches0: catchTotal(p.dex), owned0: owned(p) };
    this.live.set(pid, p);
    this.log({ t: 'join', pid, name: p.name, room: roomName, ip: meta.ip, dev: meta.dev.type, os: meta.dev.os, br: meta.dev.browser, new: isNew });
  }

  // 斷線後在寬限內接回來（同一場，不算新場次）
  back(p, meta, roomName) {
    if (this.off || !p.act) return;
    this._touch(p.act.pid, p, meta, false);
    p.act.ip = meta.ip; p.act.dev = meta.dev.type;
    this.log({ t: 'back', pid: p.act.pid, name: p.name, room: roomName, ip: meta.ip, dev: meta.dev.type });
  }

  drop(p) { if (p.act) this.log({ t: 'drop', pid: p.act.pid, name: p.name }); }

  // 每次存檔（約 10 秒）取樣：錢變多算賺、變少算花。定時刷新清零的那一次不算（epoch 換了就重新起算）
  sample(p, epoch) {
    const a = p.act;
    if (!a) return;
    const money = p.kit?.money || 0;
    if (a.epoch !== epoch) { a.epoch = epoch; a.money = money; return; }
    if (money > a.money) a.earned += money - a.money; else a.spent += a.money - money;
    a.money = money;
  }

  // 這一場結束了：why = leave 按了離開 / expire 斷線太久被收走 / restart 伺服器重開
  end(p, why) {
    const a = p.act;
    if (!a) return;
    p.act = null;
    this.live.delete(a.pid);
    const sec = Math.max(0, Math.round((this.now() - a.at) / 1000)), catches = Math.max(0, catchTotal(p.dex) - a.catches0);
    const bought = gained(a.owned0, owned(p));
    const rec = this.people[a.pid];
    if (rec) { rec.sec += sec; rec.catches += catches; rec.earned += a.earned; rec.spent += a.spent; rec.last = this.now(); this.dirty = true; }
    this.log({ t: 'end', pid: a.pid, name: p.name, room: p.room?.name || '', why, sec, catches, earned: a.earned, spent: a.spent, bought });
  }

  // 伺服器要關了：還沒結束的場次都結束掉，免得時間、摘要丟了
  stopAll() { for (const p of [...this.live.values()]) this.end(p, 'restart'); this.save(); }

  // 每分鐘一次：記線上人數（有變就記，有人在線時至少每 10 分鐘一次），並整理過期的資料
  tick(online) {
    if (this.off) return;
    const now = this.now();
    if (online !== this.lastPop.n || (online > 0 && now - this.lastPop.at >= POP_BEAT)) {
      this.log({ t: 'pop', n: online });
      this.lastPop = { n: online, at: now };
    }
    this.prune();
  }

  prune() {
    const cut = dayOf(this.now() - KEEP_DAYS * 86400 * 1000);   // 這天以前（不含）的刪掉
    try {
      for (const f of readdirSync(this.dir)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < cut) unlinkSync(join(this.dir, f));
    } catch { /* 刪不掉下次再說 */ }
    const old = this.now() - KEEP_DAYS * 86400 * 1000;
    for (const [pid, r] of Object.entries(this.people)) if (r.last < old && !this.live.has(pid)) { delete this.people[pid]; this.dirty = true; }
  }

  save() {
    if (this.off || !this.dirty) return;
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify({ people: this.people }));
      renameSync(this.file + '.tmp', this.file);
      this.dirty = false;
    } catch (err) { console.error('[activity] 存檔失敗', err.message); }
  }

  // 給管理網頁：把最近 KEEP_DAYS 天的紀錄整理成每日統計、每日時間表、玩家清單、現在在線的人
  report() {
    if (this.off) return { generatedAt: this.now(), keepDays: KEEP_DAYS, days: [], events: {}, people: [], online: [], off: true };
    const now = this.now(), cut = dayOf(now - KEEP_DAYS * 86400 * 1000);
    let files = [];
    try { files = readdirSync(this.dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) >= cut).sort(); } catch { /* 沒有就空的 */ }
    const days = new Map(), events = {};
    const day = (d) => days.get(d) || days.set(d, { date: d, pids: new Set(), pc: new Set(), mobile: new Set(), fresh: new Set(), sessions: 0, sec: 0, catches: 0, earned: 0, spent: 0, peak: 0, hourly: Array(24).fill(0) }).get(d);
    const open = new Map();   // pid → { at, name, room }：join 了還沒 end 的，碰到下一次開機就當作異常結束
    let lastAt = 0;
    const push = (d, ev) => (events[d] ||= []).push(ev);
    for (const f of files) {
      let text = '';
      try { text = readFileSync(join(this.dir, f), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        if (!e || typeof e.t !== 'string' || !Number.isFinite(e.at)) continue;
        const d = dayOf(e.at), D = day(d);
        if (e.t === 'boot') {
          for (const [pid, o] of open) { const sec = Math.max(0, Math.round((lastAt - o.at) / 1000)); push(dayOf(lastAt), { t: 'end', at: lastAt, pid, name: o.name, room: o.room, why: 'crash', sec, catches: 0, earned: 0, spent: 0, bought: [] }); }
          open.clear();
        }
        lastAt = e.at;
        if (e.t === 'join') { D.pids.add(e.pid); (e.dev === 'mobile' ? D.mobile : D.pc).add(e.pid); if (e.new) D.fresh.add(e.pid); D.sessions++; open.set(e.pid, { at: e.at, name: e.name, room: e.room }); }
        else if (e.t === 'back') { D.pids.add(e.pid); (e.dev === 'mobile' ? D.mobile : D.pc).add(e.pid); }
        else if (e.t === 'end') { D.sec += e.sec || 0; D.catches += e.catches || 0; D.earned += e.earned || 0; D.spent += e.spent || 0; open.delete(e.pid); }
        else if (e.t === 'pop') { D.peak = Math.max(D.peak, e.n); const h = hourOf(e.at); D.hourly[h] = Math.max(D.hourly[h], e.n); }
        push(d, e);
      }
    }
    const list = [...days.values()].map((D) => ({
      date: D.date, players: D.pids.size, pc: D.pc.size, mobile: D.mobile.size, fresh: D.fresh.size, sessions: D.sessions,
      avgMin: D.sessions ? Math.round(D.sec / D.sessions / 6) / 10 : 0, catches: D.catches, earned: D.earned, spent: D.spent, peak: D.peak, hourly: D.hourly,
    })).sort((a, b) => (a.date < b.date ? 1 : -1));
    // 同 IP 的其他代碼：換名字或清掉瀏覽器資料重進的人，常常會落在同一個 IP
    const byIp = new Map();
    for (const [pid, r] of Object.entries(this.people)) for (const ip of r.ips || []) (byIp.get(ip) || byIp.set(ip, []).get(ip)).push(pid);
    const people = Object.entries(this.people).map(([pid, r]) => ({
      pid, ...r, same: [...new Set((r.ips || []).flatMap((ip) => byIp.get(ip) || []))].filter((x) => x !== pid),
    })).sort((a, b) => b.last - a.last);
    const online = [...this.live.values()].map((p) => ({ pid: p.act.pid, name: p.name, room: p.room?.name || '', dev: p.act.dev, ip: p.act.ip, since: p.act.at, connected: !!p.ws }));
    return { generatedAt: now, keepDays: KEEP_DAYS, days: list, events, people, online };
  }
}
