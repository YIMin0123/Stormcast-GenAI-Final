// 一間房：一片大家共用的海。這裡保管——
//   時間、天氣、海上事件（用遊戲本身的 weather.js 跑）
//   每個人的位置、船（轉送給同房的其他人）
//   每個人的家當：錢、釣竿、扳手、買了哪些船（瀏覽器說了不算，買賣都在這裡算）
//   釣魚：上鉤什麼魚、多大、值多少由這裡擲；收線太快、離落水點太遠、站在陸地卻說拋進深海，一律不認
//   本房紀錄（看板）與聊天
import { Sea, Climate, HOUR } from '../src/weather.js';
import { BERTHS, berthPose, berthKinds, inHarbor, SELL_W, SELL_REACH, SHELF_W, BOARD_STAND_W, SPAWN_W, SWITCHES_W, LIGHT_ZONES, HAVEN_SELL_W, HAVEN_PUMP_W } from '../src/layout.js';
import { PORT } from '../src/lowpoly/havenPlan.js';
import { HOTSPOT, CHESTS, SUMMIT, SUMMIT_W } from '../src/extrasPlan.js';
import { Extras } from './extras.js';
import { BOAT_TYPES, BOAT_ORDER, newKit, shopItem } from '../src/boatdata.js';
import { SPECIES, rollCatch, minFightTime, biteDelay, castRange, money } from '../src/fishdata.js';
import { dangerAt, isWater, fishingSpot } from './world.js';
import { mask } from './words.js';
import { SERVER } from '../src/config.js';

export const MAX_PLAYERS = 30;
export const TICK = 0.1;                 // 世界每 0.1 秒算一次
export const GRACE = +(process.env.GRACE_SEC || 30) * 1000;   // 斷線後多久內回來可以接回原進度；離開的人的船也是這麼久之後消失
const WORLD_EVERY = 5;                   // 每 5 次（0.5 秒）把天氣送一次
const CLIMATE_KEYS = ['hour', 'day', 'wind', 'windGoal', 'cloud', 'cloudGoal', 'rain', 'rainAmt', 'rainFrom', 'rainTo', 'fog', 'fogAmt', 'veer', 'veerGoal'];
const DEV = !!process.env.STORMCAST_DEV;  // 開發用：允許測試指令（引發海上事件、快轉、加錢）
const EVENT_NAME = { storm: '風暴', thunder: '雷暴雨', omen: '巨浪', waves: '巨浪', whirl: '漩渦', brew: '颱風', typhoon: '颱風' };
const inf = (k, v) => (v === Infinity ? 1e9 : v);   // JSON 存不了 Infinity
const nums = (a, n) => Array.isArray(a) && a.length <= n && a.every((v) => typeof v === 'number' && Number.isFinite(v));
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

let nextUid = 1;

// 一個新玩家（剛進房、什麼都沒有）
export function newPlayer(id, ws, token, name, look = 'girl') {
  return {
    id, ws, token, name, look, room: null,   // look：選的角色（girl／boy）
    kit: newKit(),
    pos: null, posAt: 0, posDirty: false,      // 位置：[x, y, z, yaw, 狀態, 跳多高, 視線左右, 視線上下, 站在誰的船上, 船上座標 x, z, 動作, 表情]
    boat: null, boatDirty: false,               // 放在世界裡的那艘船：{ type, s: [x, z, 航向, 高度, 傾斜 x, z, 船速, 舵, 油門, 狀態, 油量, 耐久], cracks, moor, sunk }
    berth: -1,                                  // 分到第幾個停船格
    fish: new Map(),                            // 釣到還沒賣的魚：uid → { id, kg, len, value }
    stored: {},                                 // 收在倉庫的船離開世界時的樣子：船種 → { fuel, cracks }
    hold: null,                                 // 手上拿著什麼（給別人看的）：[魚種或 'can', 身長]
    line: null,                                 // 釣線另一頭的浮標在哪（給別人看的）：[x, y, z, 狀態]
    fishing: null,                              // 正在釣：{ x, z, state, fish, biteAt, biteUntil, fightAt }
    chatAt: [], msgAt: 0, msgN: 0,
    gone: 0, left: false, suspect: 0,
    owner: true,                                // 進度由這個物件存回檔案（按了離開、被收走之後就不是了，免得蓋掉新進度）
    resetMsg: null,                             // 斷線時遇到定時刷新：接回來時要補講的話
  };
}

// 要存進檔案的進度：錢、船、裝備、還沒賣的魚。船的油量、破洞照收進倉庫的方式記著，下次進房停在格子裡照舊
export function profileOf(p) {
  const kit = JSON.parse(JSON.stringify(p.kit)), stored = { ...p.stored };
  let fish = [...p.fish.values()];
  if (p.boat && p.boat.sunk) {
    // 船沉了還沒收完就走了：跟沉完一樣，這艘船和魚都沒了；一艘都不剩的話送一艘小舢舨
    delete kit.boats[kit.active];
    if (!Object.keys(kit.boats).length) kit.boats.skiff = { engineLv: 0, boxLv: 0 };
    kit.active = BOAT_ORDER.find((t) => kit.boats[t]);
    fish = [];
  } else if (p.boat) stored[p.boat.type] = { fuel: p.boat.s[10], cracks: p.boat.cracks };
  return { kit, stored, fish };
}
// 把存著的進度放回一個剛建好的玩家（魚重新編號：伺服器重開過，舊的編號可能跟別人撞）
export function applyProfile(p, prof) {
  if (prof.kit && prof.kit.boats && BOAT_TYPES[prof.kit.active] && prof.kit.boats[prof.kit.active]) p.kit = { ...newKit(), ...prof.kit };
  p.stored = prof.stored && typeof prof.stored === 'object' ? prof.stored : {};
  for (const f of Array.isArray(prof.fish) ? prof.fish.slice(0, 200) : []) {
    if (f && SPECIES[f.id]) p.fish.set(nextUid++, { id: f.id, kg: f.kg, len: f.len, value: f.value });
  }
}

export class Room {
  constructor(num, hub) {
    this.id = num;
    this.name = `${num} 號港`;
    this.hub = hub;
    this.players = new Map();
    this.berths = new Map();     // 第幾格 → 玩家 id
    this.climate = new Climate();
    this.sea = new Sea();
    this.t = Math.random() * 2048;   // 這間房的時鐘（秒）：海浪的起伏照它算，同房的人看到的浪才會一樣
    this.tick = 0;
    this.board = [];             // 本房紀錄
    this.lowSince = 0;           // 人數從什麼時候開始一直少於 5 人（0 = 不是）
    this.hold = false;           // 準備合併中：不再發生新的海上事件
    this.focus = 0;
    this.env = { near: { x: 0, z: 0 }, dangerAt };
    this.extras = new Extras();   // 魚群熱點、漂流寶箱、山頂的烽火
    this.lights = Object.fromEntries(LIGHT_ZONES.map((z) => [z, true]));   // 室內燈（店裡、魚市場）：一開始是開著的，之後誰按開關都算數
    // 遊戲內時間跟著現實時間走，每間房差 SERVER.hourStep 小時（沒人的房也照走，大廳看到的早晚才對）
    this.offset = ((num - 1) * SERVER.hourStep) % 24;
    this.skew = 0;               // 測試指令快轉過幾小時
    this.climate.hour = this.clockHour(Date.now());
  }
  get fixed() { return this.id <= SERVER.fixedRooms; }   // 常駐房：沒人也不關、不會被併掉

  clockHour(now) { return ((now / 1000 / HOUR + this.offset + this.skew) % 24 + 24) % 24; }
  // 把天氣的時鐘推到現在該在的時間（新的一天的天氣也在這裡擲）
  syncClock(now) {
    let d = ((this.clockHour(now) - this.climate.hour) % 24 + 24) % 24;
    if (d > 12) return;   // 跑得比該在的時間快一點點：等它追上
    while (d > 0) { const s = Math.min(d, 1); this.climate.update(s * HOUR); d -= s; }
  }

  // 佔了位置的人數（斷線還在等他回來的也算；已經離開、只剩船還沒收的不算）
  get count() { let n = 0; for (const p of this.players.values()) if (!p.left) n++; return n; }
  // 現在連著線的人數
  get active() { let n = 0; for (const p of this.players.values()) if (p.ws) n++; return n; }
  get calm() { return this.sea.phase === 'calm' && !this.sea.vortices.length; }

  send(p, msg) { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg, inf)); }
  all(msg, except) {
    const raw = JSON.stringify(msg, inf);
    for (const p of this.players.values()) if (p !== except && p.ws && p.ws.readyState === 1) p.ws.send(raw);
  }
  sys(text, kind = 'info', except) { this.all({ t: 'sys', text, kind }, except); }

  worldState() {
    const sea = this.sea;
    return {
      t: 'world', time: this.t, lights: { ...this.lights }, extras: this.extras.state(),
      climate: Object.fromEntries(CLIMATE_KEYS.map((k) => [k, this.climate[k]])),
      sea: { ...sea, remote: undefined, goal: { ...sea.goal }, tsu: { ...sea.tsu }, vortices: sea.vortices.map((v) => ({ ...v })) },
    };
  }

  // 大廳列表上顯示的天氣
  get weather() {
    const c = this.climate, ev = EVENT_NAME[this.sea.phase];
    const sky = ev || (c.rain > 0.1 ? '下雨' : c.fog > 0.3 ? '起霧' : c.cloud > 0.3 ? '陰天' : '晴朗');
    return `${c.night ? '夜晚' : c.hour < 12 ? '上午' : '下午'}・${sky}`;
  }

  // ---- 停船格 ----
  allocBerth(p, prefer = -1) {
    const type = p.kit.active;
    let i = prefer >= 0 && !this.berths.has(prefer) && berthKinds(type).includes(BERTHS[prefer].kind) ? prefer : -1;
    for (const kind of berthKinds(type)) {
      if (i >= 0) break;
      i = BERTHS.findIndex((b, k) => b.kind === kind && !this.berths.has(k));
    }
    if (i < 0) i = BERTHS.length - 1;   // 全滿了（不該發生：格子比人多）：疊在最後一格
    this.berths.set(i, p.id);
    p.berth = i;
    return i;
  }
  freeBerth(p) { if (this.berths.get(p.berth) === p.id) this.berths.delete(p.berth); p.berth = -1; }
  berthInfo(p) { return { label: BERTHS[p.berth].label, ...berthPose(BERTHS[p.berth], p.kit.active) }; }
  // 一艘剛放到停船格的船
  parkBoat(p) {
    const type = p.kit.active, pose = berthPose(BERTHS[p.berth], type), S = BOAT_TYPES[type];
    const was = p.stored[type];   // 從倉庫換出來的：油量、破洞照收進去時的樣子
    delete p.stored[type];
    const lost = was ? was.cracks.reduce((sum, c) => sum + c[2], 0) : 0;
    p.boat = { type, s: [pose.x, pose.z, pose.heading, 0, 0, 0, 0, 0, 0, 1, was ? was.fuel : S.tank, Math.max(0, 1 - lost / S.hp)], cracks: was ? was.cracks : [], moor: -1, sunk: false };
    p.boatDirty = true;
  }
  boatInfo(p) { return p.boat && { type: p.boat.type, boxLv: p.kit.boats[p.boat.type]?.boxLv ?? 0, s: p.boat.s, sunk: p.boat.sunk }; }
  roster(except) {
    return [...this.players.values()].filter((p) => p !== except).map((p) => ({ id: p.id, name: p.name, look: p.look, here: !!p.ws, pos: p.ws ? p.pos : null, boat: this.boatInfo(p), hold: p.ws ? p.hold : null, line: p.ws ? p.line : null }));
  }
  boards() { return { t: 'boards', room: this.board.slice(0, 10).map(pub), daily: this.hub.daily.top() }; }

  // ---- 進房、離開 ----
  // p 進到這間房。fresh：全新的玩家（給停船格和一艘小舢舨）；否則是合併或斷線重連，家當和船都照舊
  enter(p, { fresh = true, quiet = false, resume = false } = {}) {
    p.room = this;
    this.players.set(p.id, p);
    let moved = null;
    if (fresh) { this.allocBerth(p); this.parkBoat(p); } else if (!resume) {
      // 合併過來的：原本那一格在這間房沒人用就照舊；被佔了就換一格，船本來停在格子裡的話跟著移過去（開在外面的不動）
      const old = p.berth, type = p.kit.active, was = old >= 0 ? berthPose(BERTHS[old], type) : null;
      p.berth = -1;
      this.allocBerth(p, old);
      if (p.berth !== old && was && p.boat && !p.boat.sunk && dist(p.boat.s[0], p.boat.s[1], was.x, was.z) < 4) {
        const pose = berthPose(BERTHS[p.berth], type);
        p.boat.s[0] = pose.x; p.boat.s[1] = pose.z; p.boat.s[2] = pose.heading; p.boat.s[6] = 0;
        p.boat.moor = -1;
        moved = pose;
      }
    }
    this.all({ t: 'join', id: p.id, name: p.name, look: p.look, here: !!p.ws, boat: this.boatInfo(p), quiet }, p);
    if (!quiet) this.sys(`${p.name} 加入了房間`, 'join', p);
    return moved;
  }

  // 給剛進來的人看的整包資料
  snapshot(p, extra = {}) {
    return {
      id: p.id, token: p.token, name: p.name, room: { id: this.id, name: this.name, max: MAX_PLAYERS },
      world: this.worldState(), kit: p.kit, berth: this.berthInfo(p), players: this.roster(p), boards: this.boards(), dev: DEV, ...extra,
    };
  }
  // 斷線重連時還給他的進度
  resumeData(p) {
    return { pos: p.pos, boat: p.boat && { ...p.boat }, stored: p.stored, fish: [...p.fish].map(([uid, f]) => ({ uid, ...f })) };
  }

  // 連線斷了：人先從畫面上消失，位置和家當留著等他回來
  drop(p) {
    p.ws = null;
    p.gone = Date.now();
    p.fishing = null;
    p.hold = p.line = null;
    this.all({ t: 'leave', id: p.id });
  }
  // 自己按了離開：進度存回檔案（下次進房從港口出發）、不能再接回這一局；船留到時間到才收
  quit(p) {
    this.drop(p);
    p.left = true;
    this.unboard(p);
    this.hub.keep(p);
    p.owner = false;
    this.hub.sessions.delete(p.token);
  }
  unboard(p) {
    const n = this.board.length;
    this.board = this.board.filter((e) => e.pid !== p.id);
    if (this.board.length !== n) this.all(this.boards());
  }
  // 時間到了沒回來：收船、騰出停船格、從榜上拿掉
  remove(p) {
    this.hub.keep(p);   // 斷線太久沒回來：進度存回檔案，下次進房還在
    p.owner = false;
    this.players.delete(p.id);
    this.freeBerth(p);
    this.unboard(p);
    this.all({ t: 'boatGone', id: p.id });
    if (this.hub.sessions.get(p.token) === p) this.hub.sessions.delete(p.token);
    p.room = null;
  }

  // ---- 每 0.1 秒 ----
  step(now) {
    for (const p of [...this.players.values()]) if (p.gone && now - p.gone > GRACE) this.remove(p);
    this.syncClock(now);
    if (!this.active) { this.stepAt = 0; return; }   // 沒人連著：海暫停（時間照走）
    // 照實際過了多久來推進（計時器不會剛好每 0.1 秒叫一次，用固定的 0.1 秒去加，房間的時鐘會越走越慢，大家的浪就對不起來）
    const dt = this.stepAt ? Math.min(Math.max((now - this.stepAt) / 1000, 0), 0.5) : TICK;
    this.stepAt = now;
    this.tick++;
    this.t += dt;
    // 海上事件生在某個玩家附近（看得到、有時間躲）：每分鐘換一個人
    if (this.tick % 600 === 1 || !this.players.get(this.focus)?.ws) {
      const here = [...this.players.values()].filter((p) => p.ws && p.pos);
      this.focus = here.length ? here[Math.floor(Math.random() * here.length)].id : 0;
    }
    const fp = this.players.get(this.focus)?.pos;
    if (fp) { this.env.near.x = fp[0]; this.env.near.z = fp[2]; }
    this.sea.remote = this.hold;
    this.sea.update(dt, this.env);

    if (this.extras.step(this.t, dt, this.sea.phase)) this.all(this.worldState());   // 熱點冒出來、寶箱漂來、烽火燒完：馬上告訴大家

    // 魚咬了
    for (const p of this.players.values()) {
      const f = p.fishing;
      if (f && f.state === 'wait' && now >= f.biteAt) { f.state = 'bite'; f.biteUntil = now + 1300 + 1200; this.send(p, { t: 'bite' }); }
    }

    if (this.tick % WORLD_EVERY === 0) this.all(this.worldState());
    // 有動的人和船才送
    const ps = [], bs = [];
    for (const p of this.players.values()) {
      if (p.posDirty && p.pos) { ps.push([p.id, ...p.pos]); p.posDirty = false; }
      if (p.boatDirty && p.boat) { bs.push([p.id, ...p.boat.s]); p.boatDirty = false; }
    }
    if (ps.length || bs.length) this.all({ t: 'k', p: ps, b: bs });
  }

  // ---- 玩家傳來的訊息 ----
  on(p, m) {
    const now = Date.now(), kit = p.kit;
    switch (m.t) {
      case 'p': {
        const s = m.s;
        if (!nums(s?.slice?.(0, 11), 11) || s.length !== 13) return;
        if (typeof s[11] !== 'string' || typeof s[12] !== 'string' || s[11].length > 16 || s[12].length > 16) return;
        // 一下子移動太遠（不是被救回港口）：之後一小段時間不讓他拋竿
        if (p.pos && p.posAt) {
          const d = dist(s[0], s[2], p.pos[0], p.pos[2]), dt = Math.max(0.05, (now - p.posAt) / 1000);
          if (d / dt > 30 && d > 15 && dist(s[0], s[2], SPAWN_W.x, SPAWN_W.z) > 4) p.suspect = now + 8000;
        }
        p.pos = s; p.posAt = now; p.posDirty = true;
        if (p.fishing && dist(s[0], s[2], p.fishing.x, p.fishing.z) > 75) p.fishing = null;
        return;
      }
      case 'b': {
        if (!p.boat || p.boat.sunk || !nums(m.s, 12) || m.s.length !== 12) return;
        p.boat.s = m.s; p.boatDirty = true;
        return;
      }
      case 'h': {   // 手上拿著什麼（魚、油桶；空手是 ''）：只是轉給別人看
        const ok = typeof m.id === 'string' && (m.id === '' || m.id === 'can' || SPECIES[m.id]) && typeof m.len === 'number' && m.len >= 0 && m.len < 30;
        if (!ok) return;
        p.hold = m.id ? [m.id, m.len] : null;
        return this.all({ t: 'h', id: p.id, s: p.hold }, p);
      }
      case 'fl': {   // 釣線另一頭的浮標（沒在釣是 null）：只是轉給別人看
        if (m.s !== null && !(nums(m.s, 4) && m.s.length === 4)) return;
        if (m.s === null && !p.line) return;
        p.line = m.s;
        return this.all({ t: 'fl', id: p.id, s: p.line }, p);
      }
      case 'bd': {   // 船上的破洞、纜繩（只為了斷線重連時還給他）
        if (!p.boat || !Array.isArray(m.cracks) || m.cracks.length > 8 || !m.cracks.every((c) => nums(c, 3))) return;
        p.boat.cracks = m.cracks;
        p.boat.moor = Number.isInteger(m.moor) ? m.moor : -1;
        return;
      }
      case 'sink': {
        if (!p.boat || p.boat.sunk) return;
        p.boat.sunk = true;
        this.all({ t: 'sunk', id: p.id, why: String(m.why).slice(0, 12), side: m.side > 0 ? 1 : -1 }, p);
        return;
      }
      case 'boatLost': {   // 沉完了：這艘船沒了。一艘都不剩的話送一艘小舢舨
        if (!p.boat || !p.boat.sunk) return;
        delete kit.boats[kit.active];
        const gift = !Object.keys(kit.boats).length;
        if (gift) kit.boats.skiff = { engineLv: 0, boxLv: 0 };
        kit.active = BOAT_ORDER.find((t) => kit.boats[t]);
        return this.newBoat(p, { gift, wreck: true });
      }
      case 'swap': {   // 在停船位置牌前換一艘船出來
        const type = m.type;
        if (!kit.boats[type] || type === kit.active || !p.boat || p.boat.sunk) return;
        if (!this.near(p, BOARD_STAND_W.x, BOARD_STAND_W.z, 4.5)) return this.send(p, { t: 'no', msg: '要到停船位置牌前面才能換船' });
        if (!inHarbor(p.boat.s[0], p.boat.s[1])) return this.send(p, { t: 'no', msg: '船不在港裡，要先開回來才能換' });
        p.stored[kit.active] = { fuel: p.boat.s[10], cracks: p.boat.cracks };   // 收進倉庫的那艘：油量、破洞記著，下次換出來照舊
        kit.active = type;
        return this.newBoat(p, {});
      }

      // ---- 釣魚 ----
      case 'cast': {
        p.fishing = null;
        if (!nums([m.x, m.z], 2) || !p.pos || kit.rodBroken || now < p.suspect) return this.send(p, { t: 'fishNo' });
        if (dist(m.x, m.z, p.pos[0], p.pos[2]) > castRange(kit.rodLv) + 8 || !isWater(m.x, m.z)) return this.send(p, { t: 'fishNo' });
        p.fishing = { x: m.x, z: m.z, state: 'wait' };
        return this.bait(p, now);
      }
      case 'hook': {
        const f = p.fishing;
        if (!f || f.state !== 'bite' || now > f.biteUntil) { p.fishing = null; return this.send(p, { t: 'fishNo' }); }
        f.state = 'fight'; f.fightAt = now;
        return this.send(p, { t: 'fight', fish: f.fish });
      }
      case 'miss': {   // 沒按到：魚跑了，等下一條
        const f = p.fishing;
        if (f && f.state === 'bite') { f.state = 'wait'; this.bait(p, now); }
        return;
      }
      case 'land': {
        const f = p.fishing;
        p.fishing = null;
        const ok = f && f.state === 'fight' && now - f.fightAt >= 850 * minFightTime(f.fish.strength)
          && p.pos && dist(p.pos[0], p.pos[2], f.x, f.z) < 75 && p.fish.size < 200;
        if (!ok) return this.send(p, { t: 'fishNo', msg: '魚掙脫跑掉了' });
        const { id, kg, len, value } = f.fish, uid = nextUid++;
        p.fish.set(uid, { id, kg, len, value });
        return this.send(p, { t: 'caught', fish: { uid, id, kg, len, value } });   // 紀錄等賣掉才算（見 sell）
      }
      case 'lose': {   // 魚跑了、自己收線、爆桿
        const f = p.fishing;
        p.fishing = null;
        if (m.why === 'snap' && f && f.state === 'fight' && !kit.rodBroken) { kit.rodBroken = true; this.send(p, { t: 'kit', kit }); }
        return;
      }
      case 'fishGone': {   // 魚掉回海裡、跟著船沉了
        if (Array.isArray(m.uids)) for (const u of m.uids.slice(0, 250)) p.fish.delete(u);
        return;
      }

      // ---- 買賣 ----
      case 'sell': {
        // 大港的吊鉤大秤（m.at === 'haven'）：收購價多 15%；母島照舊
        const haven = m.at === 'haven', spot = haven ? HAVEN_SELL_W : SELL_W.button;
        if (!Array.isArray(m.uids) || !this.near(p, spot.x, spot.z, haven ? PORT.sell.reach + 2 : SELL_REACH)) return this.send(p, { t: 'no', msg: haven ? '要站在大秤旁邊才能賣' : '要站在籃子旁邊才能賣' });
        let total = 0, best = null;
        const sold = [];
        for (const u of new Set(m.uids.slice(0, 250))) {
          const f = p.fish.get(u);
          if (!f) continue;
          total += f.value; sold.push(u); p.fish.delete(u);
          if (!best || f.value > best.value) best = f;
        }
        if (haven) total = Math.round(total * (1 + PORT.bonus));
        kit.money += total;
        this.send(p, { t: 'sold', total, uids: sold, kit, at: haven ? 'haven' : undefined });
        // 真的賣出去才算紀錄；兩塊榜都是每人只留最好的一條，所以這次賣的裡面只拿最值錢那條去比
        if (best) this.record(p, best);
        return;
      }
      case 'pump': {   // 大港碼頭的加油柱：照公升數收錢，油加進停在旁邊的船（油量是瀏覽器那邊記的）
        if (!p.boat || !this.near(p, HAVEN_PUMP_W.x, HAVEN_PUMP_W.z, PORT.pump.reach + 2.5)) return this.send(p, { t: 'no', msg: '要站在加油柱旁邊才能加油' });
        const liters = Math.floor(Math.min(Number(m.liters) || 0, BOAT_TYPES[p.boat.type].tank)), price = Math.ceil(liters * PORT.pump.price);
        if (liters < 1 || kit.money < price) return this.send(p, { t: 'no', msg: '錢不夠' });
        kit.money -= price;
        return this.send(p, { t: 'pumped', liters, price, kit });
      }
      case 'chest': {   // 撿漂流寶箱：先到先得
        const spot = this.extras.spotOf(m.id);
        if (!spot || !this.near(p, spot.x, spot.z, CHESTS.reach + 3)) return;
        const prize = this.extras.open(m.id);
        if (!prize) return;
        kit.money += prize.cash;
        this.send(p, { t: 'chestGot', cash: prize.cash, fuel: prize.fuel, kit });
        this.all(this.worldState());
        return this.sys(`${p.name} 撿到一個漂流寶箱`);
      }
      case 'fire': {    // 點燃山頂的烽火：整間房都看得到
        if (this.extras.fire || !this.near(p, SUMMIT_W.fire.x, SUMMIT_W.fire.z, SUMMIT.reach + 3)) return;
        this.extras.fire = this.t + SUMMIT.fireTime;
        this.all(this.worldState());
        return this.sys(`${p.name} 點燃了山頂的烽火`);
      }
      case 'bell': {    // 敲山頂的古鐘：整間房都聽得到
        if (this.t - this.extras.bellAt < SUMMIT.bellGap || !this.near(p, SUMMIT_W.bell.x, SUMMIT_W.bell.z, SUMMIT.reach + 3)) return;
        this.extras.bellAt = this.t;
        return this.all({ t: 'bell', name: p.name });
      }
      case 'buy': {
        const it = SHELF_W.find((s) => s.id === m.id);
        if (!it) return;
        if (!this.near(p, it.stand.x, it.stand.z, 4) || (p.pos && p.pos[8])) return this.send(p, { t: 'no', msg: '要站在攤位前面才能買' });
        const o = shopItem(it.id, kit);
        if (o.price === null) return this.send(p, { t: 'no', msg: '這樣東西現在買不了' });
        if (kit.money < o.price) return this.send(p, { t: 'no', msg: '錢不夠' });
        kit.money -= o.price;
        o.apply(kit);
        this.send(p, { t: 'bought', id: it.id, price: o.price, repair: !!o.repair, cheap: !!o.cheap, kit });
        if (it.id === 'box') this.all({ t: 'boat', id: p.id, boat: this.boatInfo(p), keep: true }, p);   // 別人也看得到魚箱變大
        return;
      }

      // ---- 聊天 ----
      case 'light': {   // 按了室內燈的開關：整間房的人都看到
        const sw = SWITCHES_W.find((s) => s.zone === m.zone);
        if (!sw || typeof m.on !== 'boolean') return;
        if (!this.near(p, sw.stand.x, sw.stand.z, 3)) { this.send(p, { t: 'lights', lights: this.lights }); return this.send(p, { t: 'no', msg: '要站在開關旁邊才能按' }); }   // 他那邊已經先換了：改回來
        this.lights[sw.zone] = m.on;
        return this.all({ t: 'lights', lights: this.lights });
      }
      case 'chat': {
        const text = String(m.text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80);
        if (!text) return;
        p.chatAt = p.chatAt.filter((t) => now - t < 8000);
        if (p.chatAt.length >= 5) return this.send(p, { t: 'sys', text: '說話太快了，休息一下再說', kind: 'warn' });
        p.chatAt.push(now);
        return this.all({ t: 'chat', id: p.id, name: p.name, text: mask(text) });
      }

      // ---- 測試指令（只有開發模式的伺服器才收） ----
      case 'dev': {
        if (!DEV) return;
        if (m.cmd === 'event') {
          if (p.pos) { this.env.near.x = p.pos[0]; this.env.near.z = p.pos[2]; }
          const ok = this.sea.trigger(m.kind, this.env);
          this.send(p, { t: 'sys', text: ok ? `（測試）引發了 ${m.kind}` : '（測試）現在引發不了', kind: 'warn' });
        } else if (m.cmd === 'calm') { this.sea._calm(); this.sea.vortices.length = 0; this.sea.tsu.on = false; } else if (m.cmd === 'skip') { const h = Math.min(Math.max(+m.hours || 3, 0), 24); this.skew += h; for (let k = h; k > 0; k--) this.climate.update(Math.min(k, 1) * HOUR); } else if (m.cmd === 'refresh') return this.hub.refresh(true);
        else if (m.cmd === 'money') { kit.money += Math.round(+m.n || 0); this.send(p, { t: 'kit', kit }); } else if (m.cmd === 'fish') {
          // 直接塞一條魚（測排行榜用）
          const id = SPECIES[m.id] ? m.id : 'tuna', kg = +m.kg || 12, len = +(0.42 * Math.cbrt(kg)).toFixed(2), value = Math.round(100 * SPECIES[id].mult * kg), uid = nextUid++;
          p.fish.set(uid, { id, kg, len, value });
          this.send(p, { t: 'caught', fish: { uid, id, kg, len, value } });   // 賣掉才上榜
        }
        this.all(this.worldState());
        return;
      }
    }
  }

  // 人是不是站在 (x, z) 附近
  near(p, x, z, r) { return !!p.pos && dist(p.pos[0], p.pos[2], x, z) < r; }

  // 掛上餌：先決定這次會是哪條魚、幾秒後咬
  bait(p, now) {
    const f = p.fishing, c = this.climate;
    // 魚群熱點裡：咬得快、個頭大；洞穴的深潭下雨時咬得特別快
    const spot = fishingSpot(f.x, f.z, c, this.sea), hot = this.extras.inHot(f.x, f.z);
    f.fish = rollCatch({ ...spot, hot });
    f.biteAt = now + 1000 * biteDelay(p.kit.rodLv, Math.max(this.sea.rain, c.rain)) * (hot ? HOTSPOT.biteK : 1) * (spot.zone === 'cave' && spot.rain > 0.2 ? 0.5 : 1);
  }

  // 定時刷新：家當回到新玩家的樣子（錢、船、裝備、魚都清掉），人送回港口
  reset(p, text) {
    p.fishing = null;
    p.kit = newKit();
    p.fish.clear();
    p.stored = {};
    p.hold = p.line = null;
    this.freeBerth(p);
    this.allocBerth(p);
    this.parkBoat(p);
    if (!p.ws) p.resetMsg = text;   // 斷線中：接回來時再告訴他
    this.send(p, { t: 'reset', text, kit: p.kit, berth: this.berthInfo(p), boards: this.boards() });
    this.all({ t: 'boat', id: p.id, boat: this.boatInfo(p) }, p);
    this.all({ t: 'h', id: p.id, s: null }, p);
    this.all({ t: 'fl', id: p.id, s: null }, p);
  }

  // 換了一艘船放到世界裡（換船、沉了之後、送的小舢舨）：重新分配停船格
  newBoat(p, extra) {
    this.freeBerth(p);
    this.allocBerth(p);
    this.parkBoat(p);
    this.send(p, { t: 'swapped', kit: p.kit, berth: this.berthInfo(p), ...extra });
    this.all({ t: 'boat', id: p.id, boat: this.boatInfo(p) }, p);
  }

  // 賣出一條魚：看有沒有上榜
  record(p, f) {
    const e = { pid: p.id, key: p.token, name: p.name, id: f.id, len: f.len, kg: f.kg, value: f.value };
    // 本房紀錄每人只留最好的一條：沒有比自己榜上那條值錢就不算
    const mine = this.board.find((o) => o.pid === p.id);
    let rank = 99;
    if (!mine || f.value > mine.value) {
      this.board = this.board.filter((o) => o !== mine);
      this.board.push(e);
      this.board.sort((a, b) => b.value - a.value);
      rank = this.board.indexOf(e);
    }
    const dr = this.hub.daily.offer(e);
    const what = `${p.name} 賣出 ${SPECIES[f.id].name} ${Math.round(f.len * 100)} 公分・${money(f.value)}`;
    if (rank < 10) this.sys(`${what}，登上本房紀錄第 ${rank + 1} 名！${dr >= 0 && dr < 10 ? `也登上今日紀錄第 ${dr + 1} 名！` : ''}`, 'record');
    else if (dr >= 0 && dr < 10) this.sys(`${what}，登上今日紀錄第 ${dr + 1} 名！`, 'record');
    if (dr >= 0 && dr < 10) this.hub.eachRoom((r) => r.all(r.boards()));
    else if (rank < 10) this.all(this.boards());
  }
}

const pub = (e) => ({ name: e.name, id: e.id, len: e.len, kg: e.kg, value: e.value });
export { pub };
