// 一間房：一片大家共用的海。這裡保管——
//   時間、天氣、海上事件（用遊戲本身的 weather.js 跑）
//   每個人的位置、船（轉送給同房的其他人）
//   每個人的家當：錢、釣竿、扳手、買了哪些船（瀏覽器說了不算，買賣都在這裡算）
//   釣魚：上鉤什麼魚、多大、值多少由這裡擲；收線太快、離落水點太遠、站在陸地卻說拋進深海，一律不認
//   本房紀錄（看板）與聊天
import { Sea, Climate, HOUR } from '../src/weather.js';
import { BERTHS, berthPose, berthKinds, SELL_W, SELL_REACH, SHELF_W, SPAWN_W, SWITCHES_W, LIGHT_ZONES, HAVEN_SELL_W, HAVEN_PUMP_W, passengerLanding } from '../src/layout.js';
import { PORT } from '../src/lowpoly/havenPlan.js';
import { HOTSPOT, CHESTS } from '../src/extrasPlan.js';
import { Extras } from './extras.js';
import { BOAT_TYPES, BOAT_ORDER, CHUM_SPEC, BLESSINGS, newKit, shopItem, baitCount } from '../src/boatdata.js';
import { SPECIES, BAITS, isJunk, rollCatch, minFightTime, biteDelay, castRange, money } from '../src/fishdata.js';
import { dangerAt, isWater, fishingSpot } from './world.js';
import { mask } from './words.js';
import { SERVER, SHARE, WORLD } from '../src/config.js';
import { callBoat, moveBlocked, reberthNear, storedInfo } from './boatCall.js';
import { recordDex } from './dex.js';
import { sendRaw } from './wire.js';
import { placeOfSpot } from '../src/places.js';
import { onBoxMsg, boxList, homeBoxes, savedBoxesOf, loadBoxes, dropBoxes, stowBoxes, resetBoxes, sellBox, buyBox, floatBoxes, inBoxes, expireOffers, returnPassengerBoxes } from './fishBoxes.js';

export const MAX_PLAYERS = 30;
export const TICK = 0.1;                 // 世界每 0.1 秒算一次
const graceSec = Number(process.env.GRACE_SEC);
export const GRACE = (Number.isFinite(graceSec) && graceSec > 0 ? graceSec : SERVER.reconnectSec) * 1000;
const WORLD_EVERY = 5;                   // 每 5 次（0.5 秒）把天氣送一次
const CLIMATE_KEYS = ['hour', 'day', 'wind', 'windGoal', 'cloud', 'cloudGoal', 'rain', 'rainAmt', 'rainFrom', 'rainTo', 'fog', 'fogAmt', 'veer', 'veerGoal'];
export const DEV = process.env.STORMCAST_DEV === '1';  // 開發用：允許測試指令（引發海上事件、快轉、加錢）
const EVENT_NAME = { storm: '風暴', thunder: '雷暴雨', omen: '巨浪', waves: '巨浪', whirl: '漩渦', brew: '颱風', typhoon: '颱風' };
const inf = (k, v) => (v === Infinity ? 1e9 : v);   // JSON 存不了 Infinity
const nums = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const inWorld = (x, z) => Math.abs(x) <= WORLD.size / 2 && Math.abs(z) <= WORLD.size / 2;
// 人可游到地圖邊界外，但不能提交會破壞房間座標運算的離群值。
const playerLimit = WORLD.size / 2 + 256;
const validId = (id, table) => typeof id === 'string' && Object.hasOwn(table, id);
const validCrack = (c, spec) => nums(c, 3) && Math.abs(c[0]) <= spec.len / 2 + 0.01
  && Math.abs(c[1]) <= spec.beam / 2 + 0.01 && c[2] >= 0 && c[2] <= Math.ceil(spec.hp * 100 / 6) / 100;
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
    boxes: [], savedBoxes: null,                // 魚箱（見 fishBoxes.js）；savedBoxes：存檔讀回來、還沒放出來的箱子
    stored: {},                                 // 收在倉庫的船離開世界時的樣子：船種 → { fuel, cracks }
    dex: {},                                    // 圖鑑：魚種 → { n 釣過幾條, len, kg 最大那條, at 在哪釣到 }（見 dex.js）
    callAt: 0,                                  // 叫船的冷卻：這個時間以前不能再叫
    hold: null,                                 // 手上拿著什麼（給別人看的）：[魚種或 'can', 身長]
    line: null,                                 // 釣線另一頭的浮標在哪（給別人看的）：[x, y, z, 狀態]
    fishing: null,                              // 正在釣：{ x, z, state, fish, biteAt, biteUntil, fightAt }
    chatAt: [], msgAt: 0, msgN: 0,
    gone: 0, left: false, suspect: 0,
    owner: true,                                // 進度由這個物件存回檔案（按了離開、被收走之後就不是了，免得蓋掉新進度）
    resetMsg: null,                             // 斷線時遇到定時刷新：接回來時要補講的話
    passengerReturn: null,                      // 斷線期間搭的船被收回：重連時套用回港位置
  };
}

// 要存進檔案的進度：錢、船、裝備、還沒賣的魚。船的油量、破洞照收進倉庫的方式記著，下次進房停在格子裡照舊
export function profileOf(p) {
  const kit = JSON.parse(JSON.stringify(p.kit)), stored = { ...p.stored };
  const loose = p.room ? p.room.loose : null;   // 放在外面（地上、甲板上、籃子裡）的魚不跟著存：留在原地，誰撿到算誰的
  const boxed = inBoxes(p);   // 魚箱裡的魚跟著箱子存（boxes）
  let fish = [...p.fish].filter(([u]) => (!loose || !loose.has(u)) && !boxed.has(u)).map(([, f]) => f);
  if (p.boat && p.boat.sunk) {
    // 船沉了還沒收完就走了：跟沉完一樣，這艘船和魚都沒了；一艘都不剩的話送一艘小舢舨
    delete kit.boats[kit.active];
    if (!Object.keys(kit.boats).length) kit.boats.skiff = { engineLv: 0 };
    kit.active = BOAT_ORDER.find((t) => kit.boats[t]);
    fish = [];
  } else if (p.boat) stored[p.boat.type] = { fuel: p.boat.s[10], cracks: p.boat.cracks };
  return { kit, stored, fish, boxes: savedBoxesOf(p) };   // 圖鑑另外存（dex.js 的 Dexbooks），刷新不清
}
const titleOf = (p) => p.dex?._honors?.title || '';

// 把存著的進度放回一個剛建好的玩家（魚重新編號：伺服器重開過，舊的編號可能跟別人撞）
export function applyProfile(p, prof) {
  if (prof.kit && prof.kit.boats && BOAT_TYPES[prof.kit.active] && prof.kit.boats[prof.kit.active]) {
    const def = newKit();
    p.kit = {
      ...def, ...prof.kit,
      mods: { ...def.mods, ...(prof.kit.mods || {}) },
      paints: Array.isArray(prof.kit.paints) ? [...new Set(['default', ...prof.kit.paints])] : ['default'],
      paint: typeof prof.kit.paint === 'string' ? prof.kit.paint : 'default',
      chum: Number.isFinite(prof.kit.chum) ? Math.max(0, Math.min(CHUM_SPEC.max, Math.floor(prof.kit.chum))) : 0,
    };
  }
  for (const type of BOAT_ORDER) {
    const saved = prof.stored?.[type], spec = BOAT_TYPES[type];
    if (!saved || typeof saved !== 'object' || !Object.hasOwn(p.kit.boats, type)) continue;
    const fuel = Number.isFinite(saved.fuel) ? Math.max(0, Math.min(saved.fuel, spec.tank)) : spec.tank;
    const cracks = Array.isArray(saved.cracks) ? saved.cracks.filter((c) => validCrack(c, spec)).slice(0, 8) : [];
    p.stored[type] = { fuel, cracks };
  }
  loadBoxes(p, prof.boxes, () => nextUid++);
  for (const f of Array.isArray(prof.fish) ? prof.fish.slice(0, 200) : []) {
    if (f && SPECIES[f.id]) p.fish.set(nextUid++, { id: f.id, kg: f.kg, len: f.len, value: f.value, by: f.by && typeof f.by.name === 'string' ? f.by : null });
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
    this.extras = new Extras();   // 魚群熱點、漂流寶箱、誘魚桶
    this.fishSpots = [];          // 釣起位置：{ x, z, at }（驚嚇疲勞用）
    this.blessingUntil = 0;       // 全服祈福到期時間（ms）
    this.lights = Object.fromEntries(LIGHT_ZONES.map((z) => [z, true]));
    // 放在外面的魚（大家看得到、誰先撿到算誰的）：uid → { uid, owner 誰的（0 = 主人已經走了）, f 魚, k 放在哪 g 地上／d 甲板／b 籃子, x, y, z, yaw, b 哪個人的船, at 什麼時候放的 }
    this.loose = new Map();
    this.boxes = new Map();      // 魚箱：bid → 箱子（見 fishBoxes.js）
    this.offers = new Map();     // 送東西、等對方回答：oid → { from, to, uid 魚 / bid 箱子, at }   // 室內燈（店裡、魚市場）：一開始是開著的，之後誰按開關都算數
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

  // 離線玩家的船仍佔著泊位，保留到寬限期結束。
  get count() { return this.players.size; }
  // 現在連著線的人數
  get active() { let n = 0; for (const p of this.players.values()) if (p.ws) n++; return n; }
  get calm() { return this.sea.phase === 'calm' && !this.sea.vortices.length; }

  send(p, msg) { if (p.ws?.readyState === 1) sendRaw(p.ws, JSON.stringify(msg, inf)); }
  all(msg, except) {
    const raw = JSON.stringify(msg, inf);
    for (const p of this.players.values()) if (p !== except) sendRaw(p.ws, raw);
  }
  sys(text, kind = 'info', except) { this.all({ t: 'sys', text, kind }, except); }

  worldState() {
    const sea = this.sea, now = Date.now();
    this.fishSpots = this.fishSpots.filter((s) => now - s.at < 120000);
    return {
      t: 'world', time: this.t, lights: { ...this.lights }, extras: this.extras.state(),
      blessingLeft: Math.max(0, Math.round((this.blessingUntil - now) / 1000)),
      spots: this.fishSpots.map((s) => [Math.round(s.x), Math.round(s.z)]),
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
  // 倉庫裡的船的油量、耐久（給平板看）
  storedOf(p) { return storedInfo(p, (type, cracks) => Math.max(0, 1 - cracks.reduce((sum, c) => sum + c[2], 0) / BOAT_TYPES[type].hp)); }
  boatInfo(p) {
    return p.boat && { type: p.boat.type, s: p.boat.s, sunk: p.boat.sunk, reclaimMs: this.reclaimMs(p), paint: p.kit.paint || 'default' };
  }
  reclaimMs(p) { return p.gone ? Math.max(0, p.gone + GRACE - Date.now()) : null; }
  roster(except) {
    return [...this.players.values()].filter((p) => p !== except).map((p) => ({ id: p.id, name: p.name, title: titleOf(p), look: p.look, here: !!p.ws, pos: p.ws ? p.pos : null, boat: this.boatInfo(p), hold: p.ws ? p.hold : null, line: p.ws ? p.line : null }));
  }
  boards() { return { t: 'boards', room: this.board.slice(0, 10).map(pub), daily: this.hub.daily.top() }; }

  // ---- 進房、離開 ----
  // p 進到這間房。fresh：全新的玩家（給停船格和一艘小舢舨）；否則是合併或斷線重連，家當和船都照舊
  enter(p, { fresh = true, quiet = false, resume = false } = {}) {
    p.room = this;
    this.players.set(p.id, p);
    let moved = null;
    if (fresh) { this.allocBerth(p); this.parkBoat(p); homeBoxes(this, p); } else if (!resume) {
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
    this.all({ t: 'join', id: p.id, name: p.name, title: titleOf(p), look: p.look, here: !!p.ws, boat: this.boatInfo(p), quiet }, p);
    if (!quiet) this.sys(`${p.name} 加入了房間`, 'join', p);
    return moved;
  }

  // 給剛進來的人看的整包資料
  snapshot(p, extra = {}) {
    return {
      id: p.id, token: p.token, name: p.name, room: { id: this.id, name: this.name, max: MAX_PLAYERS },
      world: this.worldState(), kit: p.kit, berth: this.berthInfo(p), players: this.roster(p), boards: this.boards(), dev: DEV, loose: this.looseList(), boxes: boxList(this), stored: this.storedOf(p), dex: p.dex, reconnectSec: GRACE / 1000, ...extra,
    };
  }
  // 斷線重連時還給他的進度
  resumeData(p) {
    const boxed = inBoxes(p);
    const fish = [...p.fish].filter(([uid]) => !this.loose.has(uid) && !boxed.has(uid))
      .map(([uid, { id, kg, len, value }]) => ({ uid, id, kg, len, value }));
    return { pos: p.pos, boat: p.boat && { ...p.boat }, stored: p.stored, fish, passengerReturn: p.passengerReturn };
  }

  // 連線斷了：人先從畫面上消失，位置和家當留著等他回來
  drop(p) {
    p.ws = null;
    p.gone = Date.now();
    p.fishing = null;
    p.hold = p.line = null;
    dropBoxes(this, p);   // 抱著的箱子先放在腳邊
    for (const o of [...this.offers.values()]) if (o.from === p.id || o.to === p.id) this.offers.delete(o.oid);
    this.all({ t: 'leave', id: p.id, reclaimMs: this.reclaimMs(p) });
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
    this.hub.activity?.end(p, 'expire');   // 活動紀錄：這一場結束（按了離開的那場已在 index.js 結束，這裡就沒事）
    p.owner = false;
    if (p.boat && !p.boat.sunk) this.returnPassengers(p);
    this.removeDeckFish(p.id);
    for (const e of this.loose.values()) if (e.owner === p.id) e.owner = 0;
    stowBoxes(this, p);   // 箱子收起來跟著存檔；別人放在他船上的箱子浮到海上   // 他放在外面的魚留在原地（沒有主人了），照樣可以撿、時間到就消失
    this.players.delete(p.id);
    this.freeBerth(p);
    this.unboard(p);
    this.all({ t: 'boatGone', id: p.id });
    if (this.hub.sessions.get(p.token) === p) this.hub.sessions.delete(p.token);
    p.room = null;
  }

  returnPassengers(owner) {
    for (const p of this.players.values()) {
      if (p === owner || p.left || p.pos?.[8] !== owner.id) continue;
      const landing = passengerLanding(p.berth);
      p.pos = [landing.x, landing.y, landing.z, landing.yaw, 0, 0, landing.yaw, 0, 0, 0, 0, '', ''];
      p.posAt = Date.now();
      p.posDirty = true;
      p.fishing = p.line = null;
      this.all({ t: 'fl', id: p.id, s: null }, p);
      returnPassengerBoxes(this, p, owner.id, landing);
      p.passengerReturn = landing;
      this.send(p, { t: 'passengerReturn', ...landing });
    }
  }

  // ---- 每 0.1 秒 ----
  step(now) {
    for (const p of [...this.players.values()]) if (p.gone && now - p.gone >= GRACE) this.remove(p);
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

    if (this.extras.step(this.t, dt, this.sea.phase)) this.all(this.worldState());
    if (this.tick % 10 === 0) { this.expireLoose(now); expireOffers(this, now); }   // 熱點冒出來、寶箱漂來：馬上告訴大家

    // 魚咬了（含假咬試探 nibble）
    for (const p of this.players.values()) {
      const f = p.fishing;
      if (!f || f.state !== 'wait') continue;
      if (f.nibbles?.length && now >= f.nibbles[0]) { f.nibbles.shift(); this.send(p, { t: 'nibble' }); }
      if (now >= f.biteAt) { f.state = 'bite'; f.biteUntil = now + 1300 + 1200; this.send(p, { t: 'bite' }); }
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
    if (onBoxMsg(this, p, m, now)) return;   // 魚箱、送東西（fishBoxes.js）
    switch (m.t) {
      case 'p': {
        const s = m.s;
        if (!Array.isArray(s) || s.length !== 13 || !nums(s.slice(0, 11), 11)) return;
        if (Math.max(Math.abs(s[0]), Math.abs(s[2])) > playerLimit || Math.abs(s[1]) > 300 || s[5] < 0 || s[5] > 300
          || !Number.isInteger(s[4]) || s[4] < 0 || s[4] > 127) return;
        if ((s[4] & 32) && s[8] !== p.id) return;
        if (s[8]) {
          const carrier = this.players.get(s[8]);
          const spec = carrier?.boat && BOAT_TYPES[carrier.boat.type];
          if (!spec || carrier.boat.sunk || Math.abs(s[9]) > spec.len / 2 + 1 || Math.abs(s[10]) > spec.beam / 2 + 1
            || dist(s[0], s[2], carrier.boat.s[0], carrier.boat.s[1]) > spec.len / 2 + 10) return;
        }
        if (typeof s[11] !== 'string' || typeof s[12] !== 'string' || s[11].length > 16 || s[12].length > 16
          || Object.hasOwn(Object.prototype, s[11]) || Object.hasOwn(Object.prototype, s[12])) return;
        if (p.passengerReturn) {
          const { x, z } = p.passengerReturn;
          // 忽略短時間內尚在傳輸的舊座標。舊版客戶端未處理回港訊息也能繼續回報。
          if (now - p.posAt < 2000 && dist(s[0], s[2], x, z) > 10) return;
          p.passengerReturn = null;
        }
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
        if (!p.boat || p.boat.sunk || !nums(m.s, 12)) return;
        const s = m.s, S = BOAT_TYPES[p.boat.type];
        if (!inWorld(s[0], s[1]) || Math.abs(s[3]) > 300 || Math.hypot(s[4], s[5]) > 1
          || Math.abs(s[6]) > 100 || Math.abs(s[7]) > 1 || Math.abs(s[8]) > 1
          || !Number.isInteger(s[9]) || s[9] < 0 || s[9] > 7 || s[10] < 0 || s[10] > S.tank || s[11] < 0 || s[11] > 1) return;
        p.boat.s = s; p.boatDirty = true;
        return;
      }
      case 'h': {   // 手上拿著什麼（魚、油桶；空手是 ''）：只是轉給別人看
        const ok = (m.id === '' || m.id === 'can' || m.id === 'tablet' || validId(m.id, SPECIES)) && Number.isFinite(m.len) && m.len >= 0 && m.len < 30;
        if (!ok) return;
        p.hold = m.id ? [m.id, m.len] : null;
        return this.all({ t: 'h', id: p.id, s: p.hold }, p);
      }
      case 'fl': {   // 釣線另一頭的浮標（沒在釣是 null）：只是轉給別人看
        if (m.s !== null && (!nums(m.s, 4) || !inWorld(m.s[0], m.s[2]) || Math.abs(m.s[1]) > 300 || ![1, 2, 3].includes(m.s[3]))) return;
        if (m.s === null && !p.line) return;
        p.line = m.s;
        return this.all({ t: 'fl', id: p.id, s: p.line }, p);
      }
      case 'bd': {   // 船上的破洞、纜繩（只為了斷線重連時還給他）
        if (!p.boat || !Array.isArray(m.cracks) || m.cracks.length > 8) return;
        const S = BOAT_TYPES[p.boat.type];
        if (!m.cracks.every((c) => validCrack(c, S))) return;
        p.boat.cracks = m.cracks;
        p.boat.moor = Number.isInteger(m.moor) ? m.moor : -1;
        return;
      }
      case 'sink': {
        if (!p.boat || p.boat.sunk || !['capsize', 'flood', 'spout', 'whirl', 'curl'].includes(m.why) || !Number.isFinite(m.side)) return;
        p.boat.sunk = true;
        this.removeDeckFish(p.id);
        floatBoxes(this, p);   // 甲板上的魚箱浮起來
        this.all({ t: 'sunk', id: p.id, why: m.why, side: m.side > 0 ? 1 : -1 }, p);
        return;
      }
      case 'boatLost': {   // 沉完了：這艘船沒了。一艘都不剩的話送一艘小舢舨
        if (!p.boat || !p.boat.sunk) return;
        delete kit.boats[kit.active];
        const gift = !Object.keys(kit.boats).length;
        if (gift) kit.boats.skiff = { engineLv: 0 };
        kit.active = BOAT_ORDER.find((t) => kit.boats[t]);
        return this.newBoat(p, { gift, wreck: true });
      }
      case 'swap': {   // 平板的船 app：倉庫裡的換一艘出來，停到離人最近的空船位（人要在港口、船上沒人；見 boatCall.js）
        const type = m.type;
        if (!validId(type, BOAT_TYPES) || !Object.hasOwn(kit.boats, type) || type === kit.active || !p.boat || p.boat.sunk) return;
        const why = moveBlocked(this, p);
        if (why) return this.send(p, { t: 'no', msg: why });
        if ([...this.loose.values()].some((e) => e.k === 'd' && e.b === p.id)
          || [...this.boxes.values()].some((b) => b.k === 'd' && b.b === p.id)) {
          return this.send(p, { t: 'no', msg: '請先把甲板上的漁獲和魚箱搬下船，再換船' });
        }
        p.stored[kit.active] = { fuel: p.boat.s[10], cracks: p.boat.cracks };   // 收進倉庫的那艘：油量、破洞記著，下次換出來照舊
        kit.active = type;
        return this.newBoat(p, {}, true);
      }
      case 'call': return callBoat(this, p, now);   // 平板的船 app：把船叫到離人最近的空船位

      // ---- 釣魚 ----
      case 'cast': {
        p.fishing = null;
        if (!nums([m.x, m.z], 2) || !inWorld(m.x, m.z) || !p.pos || kit.rodBroken || now < p.suspect) return this.send(p, { t: 'fishNo' });
        if (dist(m.x, m.z, p.pos[0], p.pos[2]) > castRange(kit.rodLv) + 8 || !isWater(m.x, m.z)) return this.send(p, { t: 'fishNo' });
        // 掛了餌就用掉一個（餌用完了就是基本餌，不加成）
        const used = kit.bait && baitCount(kit, kit.bait) > 0 ? kit.bait : '';
        if (used) { kit.baits = { ...kit.baits, [used]: kit.baits[used] - 1 }; this.send(p, { t: 'kit', kit }); }
        p.fishing = { x: m.x, z: m.z, state: 'wait', baitUsed: used };
        return this.bait(p, now);
      }
      case 'baitSel': {   // 換餌（只能換成自己有的，或基本餌 ''）
        if (m.id !== '' && !(validId(m.id, BAITS) && baitCount(kit, m.id) > 0)) return;
        kit.bait = m.id;
        return this.send(p, { t: 'kit', kit });
      }
      case 'hook': {
        const f = p.fishing;
        if (!f || f.state !== 'bite' || now > f.biteUntil) { p.fishing = null; return this.send(p, { t: 'fishNo' }); }
        f.state = 'fight'; f.fightAt = now;
        return this.send(p, { t: 'fight', fish: f.fish });
      }
      case 'earlyPull': {   // 還沒真正咬鉤就提早拉竿：取消這竿（消耗掉的餌不退還）
        if (p.fishing && p.fishing.state === 'wait') p.fishing = null;
        return;
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
        p.fish.set(uid, { id, kg, len, value, by: { pid: p.id, key: p.token, name: p.name } });   // by：釣到的人（值錢的魚，紀錄算他的）
        this.fishSpots.push({ x: f.x, z: f.z, at: now });
        if (this.extras.consumeHot(f.x, f.z)) this.all(this.worldState());
        return this.send(p, { t: 'caught', fish: { uid, id, kg, len, value }, dex: recordDex(p, f.fish, f.at) });   // 紀錄等賣掉才算（見 sell）；圖鑑現在就記
      }
      case 'lose': {   // 魚跑了、自己收線、爆桿
        const f = p.fishing;
        p.fishing = null;
        if (m.why === 'snap' && f && f.state === 'fight' && !kit.rodBroken) { kit.rodBroken = true; this.send(p, { t: 'kit', kit }); }
        return;
      }
      case 'fishGone': {   // 魚掉回海裡、跟著船沉了
        if (!Array.isArray(m.uids)) return;
        const del = [];
        const boxed = inBoxes(p);
        for (const u of m.uids.slice(0, 250)) {
          if (!boxed.has(u) && p.fish.delete(u) && this.loose.delete(u)) del.push(u);
        }
        if (del.length) this.all({ t: 'loose', del }, p);
        return;
      }

      // ---- 買賣 ----
      case 'sell': {
        if (m.bid) return sellBox(this, p, m);   // 抱著魚箱整箱賣
        // 大港的吊鉤大秤（m.at === 'haven'）：收購價多 15%；母島照舊
        const haven = m.at === 'haven';
        if (!haven) return this.sellBasket(p);   // 母島：籃子是大家共用的，按一下全部賣掉，每條的錢付給牠的主人
        if (!Array.isArray(m.uids) || !this.near(p, HAVEN_SELL_W.x, HAVEN_SELL_W.z, PORT.sell.reach + 2)) return this.send(p, { t: 'no', msg: '要站在大秤旁邊才能賣' });
        let total = 0, best = null;
        const sold = [];
        for (const u of new Set(m.uids.slice(0, 250))) {
          const f = p.fish.get(u);
          if (!f || this.loose.has(u) || inBoxes(p).has(u)) continue;   // 放在外面的魚要先撿起來
          total += f.value; sold.push(u); p.fish.delete(u);
          if (!isJunk(f.id) && (!best || f.value > best.value)) best = f;   // 雜物賣得到錢，但不算紀錄
        }
        total = Math.round(total * (1 + PORT.bonus));
        kit.money += total;
        this.send(p, { t: 'sold', total, uids: sold, kit, at: 'haven' });
        // 真的賣出去才算紀錄；兩塊榜都是每人只留最好的一條，所以這次賣的裡面只拿最值錢那條去比
        if (best) this.record(this.creditOf(p, best), best, p.name);
        return;
      }

      // ---- 放在外面的魚 ----
      case 'put': {   // 自己的魚放下了（地上、甲板上、籃子裡）：大家都看得到
        const f = p.fish.get(m.uid);
        if (!p.pos || !f || inBoxes(p).has(m.uid) || !['g', 'd', 'b'].includes(m.k)
          || !nums([m.x, m.y, m.z, m.yaw], 4) || !inWorld(m.x, m.z) || Math.abs(m.y) > 300) return;
        let bx = m.x, bz = m.z, b = 0;
        if (m.k === 'd') {
          const o = this.players.get(m.b);
          if (!o || !o.boat || o.boat.sunk || Math.hypot(m.x, m.z) > 20) return;
          b = o.id; bx = o.boat.s[0]; bz = o.boat.s[1];
        } else if (m.k === 'b') {
          bx = SELL_W.basket.x; bz = SELL_W.basket.z;
          if (dist(m.x, m.z, bx, bz) > 2 || Math.abs(m.y - SELL_W.basket.y) > 3) return;
        }
        if (dist(p.pos[0], p.pos[2], bx, bz) > SHARE.place + (m.k === 'd' ? 20 : 0)) return;
        const was = this.loose.get(m.uid);
        const e = { uid: m.uid, owner: p.id, f, k: m.k, x: m.x, y: m.y, z: m.z, yaw: m.yaw, b, at: was && was.k === m.k ? was.at : now };
        this.loose.set(m.uid, e);
        return this.all({ t: 'loose', add: [this.loosePub(e)] }, p);
      }
      case 'take': {   // 自己的魚拿回手上、放進自己的魚箱：從外面收回來
        const e = this.loose.get(m.uid);
        if (!e || e.owner !== p.id) return;
        this.loose.delete(m.uid);
        return this.all({ t: 'loose', del: [m.uid] }, p);
      }
      case 'grab': {   // 撿別人的魚：先到先得，撿到就是你的
        const e = this.loose.get(m.uid);
        if (!e || e.owner === p.id) return this.send(p, { t: 'grabNo', uid: m.uid });
        const [ex, ez] = this.looseAt(e);
        if (!this.near(p, ex, ez, e.k === 'd' ? SHARE.deckReach : SHARE.reach)) return this.send(p, { t: 'grabNo', uid: m.uid, msg: '太遠了，拿不到' });
        if (p.fish.size >= 200) return this.send(p, { t: 'grabNo', uid: m.uid, msg: '身上的魚太多了' });
        const o = this.players.get(e.owner);
        if (o) o.fish.delete(m.uid);
        this.loose.delete(m.uid);
        p.fish.set(m.uid, e.f);
        this.send(p, { t: 'grabbed', fish: { uid: m.uid, id: e.f.id, kg: e.f.kg, len: e.f.len, value: e.f.value }, from: o ? o.name : '' });
        if (o) this.send(o, { t: 'taken', uid: m.uid, by: p.name });
        this.all({ t: 'loose', del: [m.uid] }, p);
        return;
      }
      case 'pump': {   // 大港碼頭的加油柱：照公升數收錢，油加進停在旁邊的船（油量是瀏覽器那邊記的）
        if (!this.near(p, HAVEN_PUMP_W.x, HAVEN_PUMP_W.z, PORT.pump.reach + 2.5)) return this.send(p, { t: 'no', msg: '要站在加油柱旁邊才能加油' });
        const b = p.boat;
        if (!b || b.sunk || dist(b.s[0], b.s[1], HAVEN_PUMP_W.x, HAVEN_PUMP_W.z) >= PORT.pump.range) {
          return this.send(p, { t: 'no', msg: '先把船停到加油柱旁邊' });
        }
        if (!Number.isFinite(m.liters)) return;
        const capacity = Math.floor(BOAT_TYPES[b.type].tank - b.s[10]);
        if (capacity < 1) return this.send(p, { t: 'no', msg: '油箱是滿的' });
        const liters = Math.floor(Math.min(m.liters, capacity)), price = Math.ceil(liters * PORT.pump.price);
        if (liters < 1 || kit.money < price) return this.send(p, { t: 'no', msg: '錢不夠' });
        kit.money -= price;
        b.s[10] += liters;
        p.boatDirty = true;
        return this.send(p, { t: 'pumped', liters, price, fuel: b.s[10], kit });
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
      case 'useChum': {
        if (!p.pos || (kit.chum || 0) <= 0) return this.send(p, { t: 'no', msg: '身上沒有誘魚桶' });
        const x = nums([m.x, m.z], 2) ? m.x : p.pos[0], z = nums([m.x, m.z], 2) ? m.z : p.pos[2];
        if (!inWorld(x, z) || dist(x, z, p.pos[0], p.pos[2]) > 28 || !isWater(x, z)) {
          return this.send(p, { t: 'no', msg: '請在水面上或船邊施放誘魚桶' });
        }
        kit.chum -= 1;
        this.clearFatigueNear(x, z, CHUM_SPEC.clearR);
        this.extras.spawnChum(x, z, p.id);
        this.send(p, { t: 'kit', kit });
        this.send(p, { t: 'chumOk' });
        this.all(this.worldState());
        return;
      }
      case 'buy': {
        if (m.id === 'bless_tide') {
          if (now < this.blessingUntil) return this.send(p, { t: 'no', msg: '黃金魚潮祈福正在生效中' });
          const price = BLESSINGS.tide.price;
          if (kit.money < price) return this.send(p, { t: 'no', msg: '錢不夠' });
          kit.money -= price;
          this.blessingUntil = now + BLESSINGS.tide.duration * 1000;
          this.fishSpots = [];
          this.extras.spawnHotspotNow();
          this.send(p, { t: 'bought', id: m.id, price, kit });
          this.all(this.worldState());
          return this.all({ t: 'sys', text: `✨ ${p.name} 發動了「${BLESSINGS.tide.name}」！全服 5 分鐘稀有與少見魚出現率 ×2！`, kind: 'record' });
        }
        if (m.id === 'bless_storm') {
          if (this.sea.phase !== 'calm') return this.send(p, { t: 'no', msg: '現在海象已經不平靜了' });
          const price = BLESSINGS.storm.price;
          if (kit.money < price) return this.send(p, { t: 'no', msg: '錢不夠' });
          this.env.near.x = p.pos ? p.pos[0] : 0; this.env.near.z = p.pos ? p.pos[2] : 0;
          if (!this.sea.trigger('storm', this.env)) return this.send(p, { t: 'no', msg: '現在無法召喚風暴' });
          kit.money -= price;
          this.send(p, { t: 'bought', id: m.id, price, kit });
          this.all(this.worldState());
          return this.all({ t: 'sys', text: `⛈ ${p.name} 發動了「${BLESSINGS.storm.name}」！海上即將掀起巨浪風暴！`, kind: 'record' });
        }
        const baseId = typeof m.id === 'string' && m.id.startsWith('paint:') ? 'paint' : typeof m.id === 'string' && m.id.startsWith('title:') ? 'title' : m.id;
        const it = SHELF_W.find((s) => s.id === baseId);
        if (!it) return;
        const o = shopItem(m.id, kit, p.dex?._honors);
        if (!(o.swap && (baseId === 'paint' || baseId === 'title'))) {
          if (!this.near(p, it.stand.x, it.stand.z, 4) || (p.pos && p.pos[8])) {
            return this.send(p, { t: 'no', msg: m.id !== baseId ? '請前往魚市場對應攤位購買' : '要站在攤位前面才能買' });
          }
        }
        if (it.id === 'box') return buyBox(this, p, m);   // 魚箱：拿在手上的道具（fishBoxes.js）
        if (o.price === null) return this.send(p, { t: 'no', msg: '這樣東西現在買不了' });
        if (kit.money < o.price) return this.send(p, { t: 'no', msg: '錢不夠' });
        kit.money -= o.price;
        o.apply(kit);
        if (o.applyHonors) {
          p.dex._honors ??= { titles: [], title: '' };
          o.applyHonors(p.dex._honors);
          this.hub.dexbook.put(p.token, p.dex);
          this.send(p, { t: 'honors', honors: p.dex._honors });
          this.all({ t: 'title', id: p.id, title: titleOf(p) });
        }
        if (baseId === 'paint' && p.boat) this.all({ t: 'boat', id: p.id, boat: this.boatInfo(p) }, p);
        this.send(p, { t: 'bought', id: m.id, price: o.price, repair: !!o.repair, cheap: !!o.cheap, swap: !!o.swap, paint: o.paint?.name, title: o.title?.name, kit });
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
        if (typeof m.text !== 'string') return;
        const text = m.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80);
        if (!text) return;
        p.chatAt = p.chatAt.filter((t) => now - t < 8000);
        if (p.chatAt.length >= 5) return this.send(p, { t: 'sys', text: '說話太快了，休息一下再說', kind: 'warn' });
        p.chatAt.push(now);
        return this.all({ t: 'chat', id: p.id, name: p.name, title: titleOf(p), text: mask(text) });
      }

      // ---- 測試指令（只有開發模式的伺服器才收） ----
      case 'dev': {
        if (!DEV) return;
        if (m.cmd === 'event') {
          if (p.pos) { this.env.near.x = p.pos[0]; this.env.near.z = p.pos[2]; }
          const ok = this.sea.trigger(m.kind, this.env);
          this.send(p, { t: 'sys', text: ok ? `（測試）引發了 ${m.kind}` : '（測試）現在引發不了', kind: 'warn' });
        } else if (m.cmd === 'calm') { this.sea._calm(); this.sea.vortices.length = 0; this.sea.tsu.on = false; } else if (m.cmd === 'skip') { const h = Number.isFinite(m.hours) ? Math.min(Math.max(m.hours, 0), 24) : 3; this.skew += h; for (let k = h; k > 0; k--) this.climate.update(Math.min(k, 1) * HOUR); } else if (m.cmd === 'refresh') return this.hub.refresh(true);
        else if (m.cmd === 'money' && Number.isFinite(m.n)) { kit.money = Math.max(0, kit.money + Math.round(Math.max(-1e9, Math.min(1e9, m.n)))); this.send(p, { t: 'kit', kit }); } else if (m.cmd === 'fish' && p.fish.size < 200) {
          // 直接塞一條魚（測排行榜用）
          const id = validId(m.id, SPECIES) ? m.id : 'tuna', kg = Number.isFinite(m.kg) && m.kg > 0 ? Math.min(1e4, m.kg) : 12, len = +(0.42 * Math.cbrt(kg)).toFixed(2), value = Math.round(100 * SPECIES[id].mult * kg), uid = nextUid++;
          p.fish.set(uid, { id, kg, len, value, by: { pid: p.id, key: p.token, name: p.name } });   // by：釣到的人（值錢的魚，紀錄算他的）
          this.send(p, { t: 'caught', fish: { uid, id, kg, len, value }, dex: recordDex(p, { id, kg, len }, '（測試）') });   // 賣掉才上榜
        }
        this.all(this.worldState());
        return;
      }
    }
  }

  // 人是不是站在 (x, z) 附近
  near(p, x, z, r) { return !!p.pos && dist(p.pos[0], p.pos[2], x, z) < r; }

  // 120 秒內同一範圍 22m 連釣第 3 條起疊加驚嚇層數（上限 5 層）
  getFatigueStacks(x, z, now) {
    this.fishSpots = this.fishSpots.filter((s) => now - s.at < 120000);
    let n = 0;
    for (const s of this.fishSpots) if (dist(s.x, s.z, x, z) < 22) n++;
    return Math.min(5, Math.max(0, n - 2));
  }
  clearFatigueNear(x, z, r) {
    this.fishSpots = this.fishSpots.filter((s) => dist(s.x, s.z, x, z) >= r);
  }
  lampActive(p, x, z) {
    return !!(this.climate.night && p.kit.mods?.lamp && p.boat && !p.boat.sunk && dist(p.boat.s[0], p.boat.s[1], x, z) <= 25);
  }

  // 掛上餌：先決定這次會是哪條魚、幾秒後咬（含試探假咬 nibble）
  bait(p, now) {
    const f = p.fishing, c = this.climate;
    // 魚群熱點裡：咬得快、個頭大；洞穴的深潭下雨時咬得特別快
    const spot = fishingSpot(f.x, f.z, c, this.sea), hot = this.extras.inHot(f.x, f.z);
    const fatigue = this.getFatigueStacks(f.x, f.z, now);
    const blessing = now < this.blessingUntil, lamp = this.lampActive(p, f.x, f.z);
    f.fish = rollCatch({ ...spot, hot, bait: f.baitUsed, fatigue, blessing, lamp });
    f.at = placeOfSpot(spot);   // 圖鑑記「在哪釣到」
    const delay = biteDelay({ rain: Math.max(this.sea.rain, c.rain), hot, caveRain: spot.zone === 'cave' && spot.rain > 0.2, fish: f.fish, fatigue });
    f.biteAt = now + 1000 * delay;
    const sp = SPECIES[f.fish.id];
    const pNibble = sp && (sp.rarity === 'rare' || f.fish.kg > sp.kg[1]) ? 0.75 : 0.50;
    f.nibbles = [];
    if (delay >= 3.8 && Math.random() < pNibble) {
      const n = Math.random() < 0.35 && delay >= 6.0 ? 2 : 1;
      if (n === 2) f.nibbles.push(now + 1000 * (delay * (0.35 + Math.random() * 0.15)), now + 1000 * (delay * (0.65 + Math.random() * 0.15)));
      else f.nibbles.push(now + 1000 * (delay * (0.45 + Math.random() * 0.25)));
    }
  }

  // 定時刷新：家當回到新玩家的樣子（錢、船、裝備、魚都清掉），人送回港口
  reset(p, text) {
    p.fishing = null;
    p.passengerReturn = null;
    p.kit = newKit();
    const del = [];
    for (const e of this.loose.values()) if (e.owner === p.id) { this.loose.delete(e.uid); del.push(e.uid); }
    if (del.length) this.all({ t: 'loose', del });
    resetBoxes(this, p);
    p.fish.clear();
    p.stored = {};
    // 圖鑑不清：另外存在 dexbook.json，刷新後還在
    p.hold = p.line = null;
    this.freeBerth(p);
    this.allocBerth(p);
    this.parkBoat(p);
    this.all({ t: 'boat', id: p.id, boat: this.boatInfo(p) }, p);
    if (!p.ws) p.resetMsg = text;   // 斷線中：接回來時再告訴他
    this.send(p, { t: 'reset', text, kit: p.kit, berth: this.berthInfo(p), boards: this.boards(), stored: {}, dex: p.dex });
    this.all({ t: 'boat', id: p.id, boat: this.boatInfo(p) }, p);
    this.all({ t: 'h', id: p.id, s: null }, p);
    this.all({ t: 'fl', id: p.id, s: null }, p);
  }

  // 換了一艘船放到世界裡（換船、沉了之後、送的小舢舨）：重新分配停船格。near：停到離人最近的空格（平板換船）
  newBoat(p, extra, near = false) {
    if (near) reberthNear(this, p, p.kit.active);
    else { this.freeBerth(p); this.allocBerth(p); }
    this.parkBoat(p);
    this.send(p, { t: 'swapped', kit: p.kit, berth: this.berthInfo(p), stored: this.storedOf(p), ...extra });
    this.all({ t: 'boat', id: p.id, boat: this.boatInfo(p) }, p);
  }

  // ---- 放在外面的魚 ----
  loosePub(e) { return { uid: e.uid, id: e.f.id, kg: e.f.kg, len: e.f.len, value: e.f.value, o: e.owner, k: e.k, x: e.x, y: e.y, z: e.z, yaw: e.yaw, b: e.b }; }
  looseList() { return [...this.loose.values()].map((e) => this.loosePub(e)); }
  removeDeckFish(boatOwner) {
    const del = [], byOwner = new Map();
    for (const e of this.loose.values()) {
      if (e.k !== 'd' || e.b !== boatOwner) continue;
      this.loose.delete(e.uid);
      del.push(e.uid);
      const owner = this.players.get(e.owner);
      if (!owner?.fish.delete(e.uid)) continue;
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner).push(e.uid);
    }
    if (del.length) this.all({ t: 'loose', del });
    for (const [owner, uids] of byOwner) this.send(owner, { t: 'expired', uids, msg: '船不在了，甲板上的漁獲已落海' });
  }
  // 那條魚在世界的哪裡（甲板上的：那艘船的位置，撿的時候放寬距離）
  looseAt(e) {
    if (e.k === 'd') { const o = this.players.get(e.b); return o && o.boat ? [o.boat.s[0], o.boat.s[1]] : [1e9, 1e9]; }
    return [e.x, e.z];
  }
  // 地上、籃子裡放太久沒人要的魚：消失（甲板上的不算）
  expireLoose(now) {
    const del = [], byOwner = new Map();
    for (const e of this.loose.values()) {
      if (e.k === 'd' || now - e.at < SHARE.life * 1000) continue;
      this.loose.delete(e.uid); del.push(e.uid);
      const o = this.players.get(e.owner);
      if (o) { o.fish.delete(e.uid); byOwner.set(o, [...(byOwner.get(o) ?? []), e.uid]); }
    }
    for (const [o, uids] of byOwner) this.send(o, { t: 'expired', uids });
    if (del.length) this.all({ t: 'loose', del });
  }
  // 母島的籃子：按下按鈕，籃子裡的魚全部賣掉，每條的錢付給牠現在的主人（按的人只是幫忙按）
  sellBasket(p) {
    if (!this.near(p, SELL_W.button.x, SELL_W.button.z, SELL_REACH)) return this.send(p, { t: 'no', msg: '要站在籃子旁邊才能賣' });
    const list = [...this.loose.values()].filter((e) => e.k === 'b');
    if (!list.length) return this.send(p, { t: 'no', msg: '籃子是空的' });
    const pay = new Map();   // 主人 → { total, uids, best }
    for (const e of list) {
      this.loose.delete(e.uid);
      const o = this.players.get(e.owner);
      if (!o) continue;   // 主人已經走了：魚賣掉，錢沒人收
      o.fish.delete(e.uid);
      const r = pay.get(o) ?? { total: 0, uids: [], best: null };
      r.total += e.f.value; r.uids.push(e.uid);
      if (!isJunk(e.f.id) && (!r.best || e.f.value > r.best.value)) r.best = e.f;   // 雜物賣得到錢，但不算紀錄
      pay.set(o, r);
    }
    this.all({ t: 'loose', del: list.map((e) => e.uid) });
    for (const [o, r] of pay) {
      o.kit.money += r.total;
      this.send(o, { t: 'sold', total: r.total, uids: r.uids, kit: o.kit, by: o === p ? undefined : p.name });
      if (r.best) this.record(this.creditOf(o, r.best), r.best, o.name);
    }
    if (!pay.has(p)) this.send(p, { t: 'sold', total: 0, uids: [], kit: p.kit, helped: true });
  }
  // 這條魚的紀錄算誰的：值錢的算釣到的人，其他算賣的人
  creditOf(seller, f) {
    if (f.value >= SHARE.credit && f.by) return f.by;
    return { pid: seller.id, key: seller.token, name: seller.name };
  }

  // 賣出一條魚：看有沒有上榜（who：紀錄算誰的 { pid, key, name }）
  record(who, f, seller = who.name) {
    const e = { pid: who.pid, key: who.key, name: who.name, id: f.id, len: f.len, kg: f.kg, value: f.value };
    // 本房紀錄每人只留最好的一條：沒有比自己榜上那條值錢就不算
    const mine = this.board.find((o) => o.pid === who.pid);
    let rank = 99;
    if (!mine || f.value > mine.value) {
      this.board = this.board.filter((o) => o !== mine);
      this.board.push(e);
      this.board.sort((a, b) => b.value - a.value);
      rank = this.board.indexOf(e);
    }
    const dr = this.hub.daily.offer(e);
    const by = seller === who.name ? `${who.name} 賣出` : `${seller} 賣出 ${who.name} 釣到的`;   // 撿別人的大魚去賣：紀錄算釣到的人，話也講清楚
    const what = `${by} ${SPECIES[f.id].name} ${Math.round(f.len * 100)} 公分・${money(f.value)}`;
    if (rank < 10) this.sys(`${what}，登上本房紀錄第 ${rank + 1} 名！${dr >= 0 && dr < 10 ? `也登上今日紀錄第 ${dr + 1} 名！` : ''}`, 'record');
    else if (dr >= 0 && dr < 10) this.sys(`${what}，登上今日紀錄第 ${dr + 1} 名！`, 'record');
    if (dr >= 0 && dr < 10) this.hub.eachRoom((r) => r.all(r.boards()));
    else if (rank < 10) this.all(this.boards());
  }
}

const pub = (e) => ({ name: e.name, id: e.id, len: e.len, kg: e.kg, value: e.value });
export { pub };
