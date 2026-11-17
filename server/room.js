// 一間房：一片大家共用的海。這裡保管——
//   時間、天氣、海上事件（用遊戲本身的 weather.js 跑）
//   每個人的位置、船（轉送給同房的其他人）
//   每個人的家當：錢、釣竿、買了哪些船（瀏覽器說了不算，買賣、修船都在這裡算）
//   釣魚：魚種、大小、烈度及收線結果在這裡決定，瀏覽器回報收線按鍵
//   本房紀錄（看板）與聊天
import { Sea, Climate, HOUR } from '../src/weather.js';
import { BERTHS, HOME_BERTHS, berthPose, berthFits, SELL_W, SELL_REACH, ALL_SHELF_W, SITES, SPAWN_W, SWITCHES_W, LIGHT_ZONES, HAVEN_SELL_W, passengerLanding } from '../src/layout.js';
import { PORT } from '../src/lowpoly/havenPlan.js';
import { HOTSPOT, CHESTS } from '../src/extrasPlan.js';
import { Extras } from './extras.js';
import { BOAT_TYPES, BOAT_ORDER, BOAT_MODS, BOAT_PAINTS, HONOR_TITLES, CHUM_SPEC, BLESSINGS, newKit, shopItem, baitCount, repairCost } from '../src/boatdata.js';
import { SPECIES, BAITS, isJunk, rollCatch, biteDelay, castRange, money } from '../src/fishdata.js';
import { REEL_PROTOCOL, newFishFight, stepFishFight } from '../src/fishFight.js';
import { dangerAt, isWater, fishingSpot } from './world.js';
import { mask } from './words.js';
import { SERVER, SHARE, WORLD, FISHBOX, GUILD, LEVEL, PARTY, FEEDBACK } from '../src/config.js';
import { callBoat, moveBlocked, reberthNear, storedInfo, aboard, berthFree, siteOf } from './boatCall.js';
import { recordDex } from './dex.js';
import { gainExp, lvOf, isGold, guildOf, syncTitles } from './guild.js';
import { onPartyMsg, leaveParty, dropLinks, towCut, stepTows, expireAsks, partyMap, partyInfo, lfgList, mates } from './party.js';
import { sendRaw } from './wire.js';
import { placeOfSpot } from '../src/places.js';
import { onBoxMsg, boxList, homeBoxes, savedBoxesOf, loadBoxes, savedHatchOf, loadHatch, clearHatch, hatchOf, syncHatch, dropBoxes, stowBoxes, resetBoxes, sellBox, buyBox, floatBoxes, inBoxes, expireOffers, returnPassengerBoxes, moveDeckBoxes } from './fishBoxes.js';

export const MAX_PLAYERS = 30;
export const TICK = 0.1;                 // 世界每 0.1 秒算一次
const graceSec = Number(process.env.GRACE_SEC);
export const GRACE = (Number.isFinite(graceSec) && graceSec > 0 ? graceSec : SERVER.reconnectSec) * 1000;
const WORLD_EVERY = 5;                   // 每 5 次（0.5 秒）把天氣送一次
const REEL_START_MS = 4000;
const FIGHT_LIMIT_MS = 120000;
let nextFightId = 1;
const CLIMATE_KEYS = ['hour', 'day', 'wind', 'windGoal', 'cloud', 'cloudGoal', 'rain', 'rainAmt', 'rainFrom', 'rainTo', 'fog', 'fogAmt', 'veer', 'veerGoal'];
export const DEV = process.env.STORMCAST_DEV === '1';  // 開發用：允許測試指令（引發海上事件、快轉、加錢）
const PAINT_IDS = new Set(BOAT_PAINTS.map((p) => p.id));
const TITLE_NAMES = new Set(HONOR_TITLES.map((t) => t.name));

// 淨化玩家平板摘要（只供旁人畫 3D 平板顯示，不參與遊戲結算；所有鍵值皆白名單驗證）
function cleanTabState(d) {
  if (d === null) return null;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return undefined;
  const num = (v, lo, hi, def = 0) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
  const int = (v, lo, hi, def = 0) => Math.round(num(v, lo, hi, def));
  const cleanId = (v, dict) => typeof v === 'string' && Object.hasOwn(dict, v) ? v : '';
  const dexHave = Array.isArray(d.dexHave)
    ? [...new Set(d.dexHave.filter((id) => typeof id === 'string' && Object.hasOwn(SPECIES, id)))].slice(0, 60) : [];
  const dexSelStat = Array.isArray(d.dexSelStat) && d.dexSelStat.length === 3 && d.dexSelStat.every(Number.isFinite)
    ? [int(d.dexSelStat[0], 1, 99999, 1), Math.round(num(d.dexSelStat[1], 0, 30, 0) * 100) / 100, Math.round(num(d.dexSelStat[2], 0, 9999, 0) * 100) / 100] : null;
  const rawMods = d.mods && typeof d.mods === 'object' ? d.mods : {};
  const mods = {};
  for (const k of ['sonar', 'hull', 'lamp']) mods[k] = k in BOAT_MODS && !!rawMods[k];   // hull（抽水龍骨）已經拿掉，欄位留著、永遠是 false
  const titles = Array.isArray(d.titles)
    ? [...new Set(d.titles.filter((x) => typeof x === 'string' && TITLE_NAMES.has(x)))].slice(0, HONOR_TITLES.length) : [];
  const boxes = Array.isArray(d.boxes) ? d.boxes.slice(0, FISHBOX.max)
    .filter((b) => Array.isArray(b) && b.length === 3 && b.every(Number.isFinite))
    .map((b) => [int(b[0], 0, 500, 0), Math.round(num(b[1], 0, 9999, 0) * 10) / 10, int(b[2], 0, 1e9, 0)]) : [];
  const stored = Array.isArray(d.stored) ? d.stored.slice(0, BOAT_ORDER.length)
    .filter((b) => Array.isArray(b) && b.length === 4 && typeof b[0] === 'string' && Object.hasOwn(BOAT_TYPES, b[0]) && b.slice(1).every(Number.isFinite))
    .map((b) => [b[0], Math.round(num(b[1], 0, 1, 1) * 100) / 100, Math.round(num(b[2], 0, 1, 1) * 100) / 100, int(b[3], 0, 5, 0)]) : [];
  const baits = Array.isArray(d.baits) ? d.baits.slice(0, 12)
    .filter((b) => Array.isArray(b) && b.length === 2 && typeof b[0] === 'string' && Object.hasOwn(BAITS, b[0]) && Number.isFinite(b[1]))
    .map((b) => [b[0], int(b[1], 0, 999, 0)]) : [];
  return {
    scr: int(d.scr, 0, 8, 0), sc: int(d.sc, 0, 4000, 0), mf: int(d.mf, 0, 15, 15),
    dexSel: cleanId(d.dexSel, SPECIES), dexHave, dexSelStat,
    rodLv: int(d.rodLv, 0, 5, 0), rodBrk: !!d.rodBrk,
    bait: cleanId(d.bait, BAITS), baits, chum: int(d.chum, 0, CHUM_SPEC.max, 0), lv: int(d.lv, 1, LEVEL.max, 1),
    mods, paint: typeof d.paint === 'string' && PAINT_IDS.has(d.paint) ? d.paint : 'default',
    title: typeof d.title === 'string' && TITLE_NAMES.has(d.title) ? d.title : '', titles,
    boxes, stored,
    gfxLv: int(d.gfxLv, 0, 2, 1), gfxPage: !!d.gfxPage, sound: d.sound === undefined ? true : !!d.sound, vol: Math.round(num(d.vol, 0, 1, 1) * 20) / 20,
  };
}

const DEV_EVENTS = new Set(['storm', 'thunder', 'spout', 'whirl', 'tsunami', 'typhoon']);
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
    tab: null,                                  // 手上平板目前顯示的精簡狀態（給旁人畫完整平板畫面用）
    line: null,                                 // 釣線另一頭的浮標在哪（給別人看的）：[x, y, z, 狀態]
    fishing: null,                              // 拋竿位置、咬鉤與搏魚狀態
    chatAt: [], msgAt: 0, msgN: 0,
    gone: 0, left: false, suspect: 0,
    actAt: 0,                                   // 客戶端最後一次回報「有在操作」的時間（0 = 沒回報過的舊版客戶端，不判閒置）；見 index.js 的 idleKick
    owner: true,                               // 進度由這個物件存回檔案（按了離開、被收走之後就不是了，免得蓋掉新進度）
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
  return { kit, stored, fish, boxes: savedBoxesOf(p), hatch: p.boat && p.boat.sunk ? [] : savedHatchOf(p) };   // 圖鑑另外存（dex.js 的 Dexbooks），刷新不清；船沉了魚艙的魚跟著沒了
}
const titleOf = (p) => p.wearTitle || '';   // 現在戴的稱號（每週漁會捐款榜算出來的，見 guild.js）
// 名牌、聊天要顯示的：稱號、是不是金色的特殊稱號、等級
const badge = (p) => ({ title: titleOf(p), gold: isGold(titleOf(p)), lv: lvOf(p) });

// 把存著的進度放回一個剛建好的玩家（魚重新編號：伺服器重開過，舊的編號可能跟別人撞）
export function applyProfile(p, prof) {
  if (prof.kit && prof.kit.boats && BOAT_TYPES[prof.kit.active] && prof.kit.boats[prof.kit.active]) {
    const def = newKit();
    const mods = Object.fromEntries(Object.keys(BOAT_MODS).map((k) => [k, !!prof.kit.mods?.[k]]));   // 只留現在還有的改裝（舊存檔的抽水龍骨丟掉）
    delete prof.kit.wrench;   // 扳手拿掉了：舊存檔裡的不留
    p.kit = {
      ...def, ...prof.kit, mods,
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
  loadHatch(p, prof.hatch, () => nextUid++);
  for (const f of Array.isArray(prof.fish) ? prof.fish.slice(0, 200) : []) {
    if (f && SPECIES[f.id]) p.fish.set(nextUid++, { id: f.id, kg: f.kg, len: f.len, value: f.value, by: f.by && typeof f.by.name === 'string' ? f.by : null, gift: f.gift && typeof f.gift.name === 'string' ? f.gift : null });
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
    this.blessingUntil = 0;       // 全服黃金魚潮到期時間（ms）
    this.pendingBless = { tide: 0, storm: 0 };   // 祭壇倒數到期時間（ms）
    this._stormPos = null;
    this.lights = Object.fromEntries(LIGHT_ZONES.map((z) => [z, true]));
    // 放在外面的魚（大家看得到、誰先撿到算誰的）：uid → { uid, owner 誰的（0 = 主人已經走了）, f 魚, k 放在哪 g 地上／d 甲板／b 籃子, x, y, z, yaw, b 哪個人的船, at 什麼時候放的 }
    this.loose = new Map();
    this.boxes = new Map();      // 魚箱：bid → 箱子（見 fishBoxes.js）
    this.asks = new Map();       // 船隊邀請、拖船請求，等對方回答（party.js）：aid → { kind, from, to, at, sec }
    this.tows = [];              // 拖船配對：[{ tug 拖船船主 id, tow 被拖船船主 id }]
    this.nextParty = 1;          // 下一個船隊的編號
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

  worldState(now = Date.now()) {
    const sea = this.sea;
    return {
      t: 'world', time: this.t, lights: { ...this.lights }, extras: this.extras.state(),
      blessingLeft: Math.max(0, Math.round((this.blessingUntil - now) / 1000)),
      tideWait: this.pendingBless.tide ? Math.max(1, Math.ceil((this.pendingBless.tide - now) / 1000)) : 0,
      stormWait: this.pendingBless.storm ? Math.max(1, Math.ceil((this.pendingBless.storm - now) / 1000)) : 0,
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
  // prefer：想要的那一格（空著、停得下就給；修船屋和大港的泊位只會從這裡指定）；不然在母港找第一個空格
  allocBerth(p, prefer = -1) {
    const type = p.kit.active;
    let i = prefer >= 0 && BERTHS[prefer] && !this.berths.has(prefer) && berthFits(BERTHS[prefer], type) ? prefer : -1;
    if (i < 0) i = BERTHS.findIndex((b, k) => b.site === 'home' && !this.berths.has(k));
    if (i < 0) i = HOME_BERTHS - 1;   // 全滿了（不該發生：格子比人多）：疊在母港最後一格
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
    return p.boat && { type: p.boat.type, s: p.boat.s, sunk: p.boat.sunk, reclaimMs: this.reclaimMs(p), paint: p.kit.paint || 'default',
      lv: p.kit.boats[p.boat.type]?.engineLv || 0, mods: p.kit.mods };   // lv 引擎等級（隊友幫忙開船時要用）、mods 改裝（別人看得到聲納、集魚燈）
  }
  reclaimMs(p) { return p.gone ? Math.max(0, p.gone + GRACE - Date.now()) : null; }
  roster(except) {
    return [...this.players.values()].filter((p) => p !== except).map((p) => ({ id: p.id, name: p.name, ...badge(p), look: p.look, here: !!p.ws, pos: p.ws ? p.pos : null, boat: this.boatInfo(p), hold: p.ws ? p.hold : null, tab: p.ws ? p.tab : null, line: p.ws ? p.line : null }));
  }
  // 看板：本房紀錄、今日紀錄、這一週的漁會捐贈榜（全服共用）
  boards() {
    // 圖鑑榜：這間房裡誰釣過的魚種最多（同數量比等級）
    const dex = [...this.players.values()].map((p) => ({ name: p.name, n: Object.keys(p.dex || {}).filter((k) => !k.startsWith('_')).length, lv: lvOf(p) }))
      .filter((e) => e.n > 0).sort((a, b) => b.n - a.n || b.lv - a.lv).slice(0, 10);
    return { t: 'boards', room: this.board.slice(0, 10).map(pub), daily: this.hub.daily.top(), donate: this.hub.guild ? this.hub.guild.top() : [], dex };
  }

  // ---- 進房、離開 ----
  // p 進到這間房。fresh：全新的玩家（給停船格和一艘小舢舨）；否則是合併或斷線重連，家當和船都照舊
  enter(p, { fresh = true, quiet = false, resume = false } = {}) {
    p.room = this;
    this.players.set(p.id, p);
    let moved = null;
    if (!resume) { p.party = 0; p.lfg = false; p.props = []; if (p.boat) p.boat.pilot = 0; }   // 船隊只存在原本那間房：新進來、被併過來的人都不在隊裡，船也不再由（已經不是隊友的）人開
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
    if (this.hub.guild) { this.hub.guild.rename(p.token, p.name); const g = this.hub.guild.info(p.token); p.wearTitle = g.wear; p.titles = g.titles; }
    this.tellJoin(p, quiet);
    if (!quiet) this.sys(`${p.name} 加入了房間`, 'join', p);
    return moved;
  }
  // 告訴同房其他人「這個人出現了」（進房、併房、斷線接回來都用這一則：名字、稱號、等級、船）
  tellJoin(p, quiet = false) {
    this.all({ t: 'join', id: p.id, name: p.name, ...badge(p), look: p.look, here: !!p.ws, boat: this.boatInfo(p), quiet }, p);
  }

  // 給剛進來的人看的整包資料
  snapshot(p, extra = {}) {
    return {
      id: p.id, token: p.token, name: p.name, room: { id: this.id, name: this.name, max: MAX_PLAYERS },
      world: this.worldState(), kit: p.kit, berth: this.berthInfo(p), players: this.roster(p), boards: this.boards(), dev: DEV, loose: this.looseList(), boxes: boxList(this), stored: this.storedOf(p), dex: p.dex, reconnectSec: GRACE / 1000,
      me: badge(p), guild: guildOf(this.hub, p), party: partyMap(this), parties: partyInfo(this), lfg: lfgList(this), tows: this.tows.map((t) => [t.tug, t.tow]), pilot: p.boat?.pilot || 0, ...extra,
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
    p.hold = p.tab = p.line = null;
    dropBoxes(this, p);   // 抱著的箱子先放在腳邊
    for (const o of [...this.offers.values()]) if (o.from === p.id || o.to === p.id) this.offers.delete(o.oid);
    dropLinks(this, p);   // 問到一半的邀請、拖纜、副駕都放開（船隊留著，寬限內接回來還在隊裡）
    this.all({ t: 'leave', id: p.id, reclaimMs: this.reclaimMs(p) });
  }
  // 自己按了離開：進度存回檔案（下次進房從港口出發）、不能再接回這一局；船留到時間到才收
  quit(p) {
    this.drop(p);
    leaveParty(this, p);
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
    leaveParty(this, p, '離線太久，退出了船隊');
    towCut(this, p);
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

    let worldDirty = this.extras.step(this.t, dt, this.sea.phase);
    if (this.sea.endedVortices.length) {
      for (const ev of this.sea.endedVortices.splice(0)) {
        this.extras.spawnChests(this.t, 2);
        const spotOk = this.extras.spawnHotspotAt(ev.x, ev.z, { life: 150, quota: 14 });
        const head = ev.kind === 'whirl' ? '🌀 大漩渦平息了！' : '🌪 水龍捲消散了！';
        this.sys(`${head}${spotOk ? '深海湧流在消散處匯聚成肥沃魚群，' : ''}岸邊也沖上了漂流寶箱！`);
        worldDirty = true;
      }
    }
    if (this.stepBlessings(now)) worldDirty = true;
    if (worldDirty) this.all(this.worldState(now));
    if (this.tick % 10 === 0) { this.expireLoose(now); expireOffers(this, now); expireAsks(this, now); stepTows(this); }   // 熱點冒出來、寶箱漂來：馬上告訴大家

    // 魚咬了（含假咬試探 nibble）或正在搏魚。
    for (const p of this.players.values()) {
      const f = p.fishing;
      if (!p.ws || !f) continue;
      if (f.state === 'fight') {
        this.advanceFishing(p, f, now);
        if (p.fishing === f && f.n) this.send(p, { t: 'reelState', ...this.reelState(f) });
        continue;
      }
      if (f.state !== 'wait') continue;
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
    if (onPartyMsg(this, p, m, now)) return;   // 船隊、拖船、副駕（party.js）
    switch (m.t) {
      case 'act': p.actAt = now; return;   // 客戶端有人在操作：重新計閒置時間
      case 'p': {
        const s = m.s;
        if (!Array.isArray(s) || s.length !== 13 || !nums(s.slice(0, 11), 11)) return;
        if (Math.max(Math.abs(s[0]), Math.abs(s[2])) > playerLimit || Math.abs(s[1]) > 300 || s[5] < 0 || s[5] > 300
          || !Number.isInteger(s[4]) || s[4] < 0 || s[4] > 127) return;
        if ((s[4] & 32) && s[8] !== p.id && this.players.get(s[8])?.boat?.pilot !== p.id) return;   // 掌舵中：只能是自己的船，或正在幫隊友開的那艘
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
        const f = p.fishing;
        if (f && dist(s[0], s[2], f.x, f.z) > 75) {
          if (f.state === 'fight') this.finishFishing(p, f, 'escape', now);
          else p.fishing = null;
        }
        return;
      }
      case 'b': {
        // 副駕（同隊隊友幫忙開船）：那艘船由副駕的瀏覽器算、帶著 forId 送來；這段時間船主自己送來的位置不收
        const owner = m.forId && m.forId !== p.id ? this.players.get(m.forId) : p;
        if (!owner || !owner.boat || owner.boat.sunk || !nums(m.s, 12)) return;
        if (owner !== p ? owner.boat.pilot !== p.id : owner.boat.pilot) return;
        const s = m.s, S = BOAT_TYPES[owner.boat.type];
        if (!inWorld(s[0], s[1]) || Math.abs(s[3]) > 300 || Math.hypot(s[4], s[5]) > 1
          || Math.abs(s[6]) > 100 || Math.abs(s[7]) > 1 || Math.abs(s[8]) > 1
          || !Number.isInteger(s[9]) || s[9] < 0 || s[9] > 31 || s[10] < 0 || s[10] > S.tank || s[11] < 0 || s[11] > 1) return;   // s[9]：1 船燈、2 有人掌舵、4 擱淺、8 船首集魚燈、16 綁著岸上的纜繩
        owner.boat.s = s; owner.boatDirty = true;
        return;
      }
      case 'h': {   // 手上拿著什麼（魚、油桶、誘魚桶；空手是 ''）：只是轉給別人看
        const ok = (m.id === '' || m.id === 'can' || m.id === 'chum' || m.id === 'tablet' || validId(m.id, SPECIES)) && Number.isFinite(m.len) && m.len >= 0 && m.len < 30;
        if (!ok) return;
        p.hold = m.id ? [m.id, m.len] : null;
        if (m.id !== 'tablet') p.tab = null;
        return this.all({ t: 'h', id: p.id, s: p.hold }, p);
      }
      case 'ts': {   // 玩家平板顯示狀態摘要（僅供旁人 3D 平板顯示，不影響遊戲邏輯）
        const clean = cleanTabState(m.d);
        if (clean === undefined) return;
        if (clean) clean.money = Math.max(0, Math.round(p.kit?.money || 0));   // 餘額由伺服器權威值填入，不收客戶端傳來的金額
        p.tab = clean;
        return this.all({ t: 'ts', id: p.id, d: p.tab }, p);
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
        // 副駕開著隊友的船沉了：由副駕回報（forId），船主那邊也要收到
        const owner = m.forId && m.forId !== p.id ? this.players.get(m.forId) : p;
        if (!owner || (owner !== p && (owner.boat?.pilot !== p.id || !p.pos || p.pos[8] !== owner.id))) return;   // 幫隊友開的船：人要真的在那艘船上才算數
        if (!owner.boat || owner.boat.sunk || !['capsize', 'flood', 'spout', 'whirl', 'curl'].includes(m.why) || !Number.isFinite(m.side)) return;
        owner.boat.sunk = true;
        owner.boat.pilot = 0;
        towCut(this, owner, '船沉了，拖纜鬆脫');
        this.removeDeckFish(owner.id);
        floatBoxes(this, owner);   // 甲板上的魚箱浮起來
        this.all({ t: 'sunk', id: owner.id, why: m.why, side: m.side > 0 ? 1 : -1 }, p);
        return;
      }
      case 'boatLost': {   // 沉完了：這艘船沒了。一艘都不剩的話送一艘小舢舨
        if (!p.boat || !p.boat.sunk) return;
        delete kit.boats[kit.active];
        clearHatch(this, p);   // 魚艙裡的魚跟著船沉了
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
        if (!this.berthFreeFor(p, type)) return this.send(p, { t: 'no', msg: '這裡的泊位停不下那艘船（滿了或太小）' });
        if ([...this.loose.values()].some((e) => e.k === 'd' && e.b === p.id)
          || [...this.boxes.values()].some((b) => b.k === 'd' && b.b === p.id && !b.hatch)) {
          return this.send(p, { t: 'no', msg: '請先把甲板上的漁獲和魚箱搬下船，再換船' });
        }
        if (hatchOf(p)?.fish.length) {
          return this.send(p, { t: 'no', msg: '請先把魚艙裡的魚拿出來，再換船' });
        }
        p.stored[kit.active] = { fuel: p.boat.s[10], cracks: p.boat.cracks };   // 收進倉庫的那艘：油量、破洞記著，下次換出來照舊
        kit.active = type;
        this.towCut(p, '換了船，拖纜解開');
        return this.newBoat(p, {}, true);
      }
      case 'call': towCut(this, p, '叫了船，拖纜解開'); return callBoat(this, p, now);   // 平板的船 app：把船叫到離人最近的空船位

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
        if (f?.state === 'fight') return;
        if (!f || f.state !== 'bite' || now > f.biteUntil) { p.fishing = null; return this.send(p, { t: 'fishNo' }); }
        if (m.v !== REEL_PROTOCOL) { p.fishing = null; return this.send(p, { t: 'fishNo', msg: '釣魚系統已更新，請重新整理網頁' }); }
        Object.assign(f, {
          state: 'fight', id: nextFightId++, started: now, lastAt: now, n: 0, held: false,
          fight: newFishFight(f.fish.strength, kit.rodLv),
        });
        return this.send(p, { t: 'fight', fish: f.fish, v: REEL_PROTOCOL, ...this.reelState(f) });
      }
      case 'reel': {
        const f = p.fishing;
        if (f?.state !== 'fight' || m.id !== f.id || m.n !== f.n + 1 || typeof m.held !== 'boolean') return;
        this.advanceFishing(p, f, now);
        if (p.fishing !== f) return;
        f.lastAt = Math.max(f.lastAt, now);
        f.n = m.n;
        f.held = m.held;
        return;
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
      case 'lose': p.fishing = null; return;   // 玩家主動收竿
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
        const sold = [], fishes = [];
        for (const u of new Set(m.uids.slice(0, 250))) {
          const f = p.fish.get(u);
          if (!f || this.loose.has(u) || inBoxes(p).has(u)) continue;   // 放在外面的魚要先撿起來
          sold.push(u); fishes.push(f); p.fish.delete(u);
        }
        // 錢照每條魚的主人付（隊友幫忙拿來賣的付給隊友）；紀錄每人只拿這次最值錢那條去比（payFish 裡算）
        const pay = this.payFish(p, fishes, PORT.bonus);
        this.send(p, { t: 'sold', total: pay.total, fresh: pay.fresh, uids: sold, others: pay.others, kit, at: 'haven' });
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
      case 'grab': {   // 拿起別人放在外面的魚：只有魚的主人自己、或主人的隊友能拿（幫忙搬），拿了魚還是主人的（fishOwner）
        const e = this.loose.get(m.uid);
        if (!e || e.owner === p.id) return this.send(p, { t: 'grabNo', uid: m.uid });
        {
          const own = this.fishOwner(e.f, this.players.get(e.owner));
          if (own && own !== p && !this.sameParty(p, own)) return this.send(p, { t: 'grabNo', uid: m.uid, msg: `這是 ${own.name} 的魚，只有他和他的隊友能拿` });
        }
        const [ex, ez] = this.looseAt(e);
        if (!this.near(p, ex, ez, e.k === 'd' ? SHARE.deckReach : SHARE.reach)) return this.send(p, { t: 'grabNo', uid: m.uid, msg: '太遠了，拿不到' });
        if (p.fish.size >= 200) return this.send(p, { t: 'grabNo', uid: m.uid, msg: '身上的魚太多了' });
        const o = this.players.get(e.owner);
        if (o) o.fish.delete(m.uid);
        this.loose.delete(m.uid);
        p.fish.set(m.uid, e.f);
        const own = this.fishOwner(e.f, p);
        this.send(p, { t: 'grabbed', fish: { uid: m.uid, id: e.f.id, kg: e.f.kg, len: e.f.len, value: e.f.value }, from: o ? o.name : '', of: own === p ? '' : own.name });
        if (o) this.send(o, { t: 'taken', uid: m.uid, by: p.name });
        this.all({ t: 'loose', del: [m.uid] }, p);
        return;
      }
      case 'repairBoat': {   // 修船屋／大港船塢的修船台：付錢一次修滿（自己的船，或同隊隊友的船 forId）
        const owner = m.forId ? this.players.get(m.forId) : p;
        if (!owner || !owner.boat || owner.boat.sunk) return this.send(p, { t: 'no', msg: '找不到要修的船' });
        if (owner !== p && !this.sameParty(p, owner)) return this.send(p, { t: 'no', msg: '只能幫同隊隊友的船付修理費' });
        const st = ALL_SHELF_W.find((s) => s.id === 'repair' && this.near(p, s.stand.x, s.stand.z, 4));
        if (!st || (p.pos && p.pos[8])) return this.send(p, { t: 'no', msg: '要站在修船台前面' });
        const site = SITES[st.site], b = owner.boat;
        if (dist(b.s[0], b.s[1], site.x, site.z) > site.repairR) return this.send(p, { t: 'no', msg: `先把船開進${site.name}的船塢` });
        const cost = repairCost(b.type, b.s[11], b.cracks.length);
        if (!cost) return this.send(p, { t: 'no', msg: '船體狀況完好，無須維修' });
        if (kit.money < cost) return this.send(p, { t: 'no', msg: `錢不夠，修理費要 $${cost}` });
        kit.money -= cost;
        b.cracks = []; b.s[11] = 1; owner.boatDirty = true;
        this.send(p, { t: 'kit', kit });
        return this.all({ t: 'repaired', id: owner.id, by: p.name, byId: p.id, cost });
      }
      case 'donate': {   // 漁會捐款箱（母港魚市場、大港榜亭各一座）：捐多少自己填，累積在這一週的捐贈榜
        const g = this.hub.guild;
        if (!g) return;
        if (!ALL_SHELF_W.some((s) => s.id === 'title' && this.near(p, s.stand.x, s.stand.z, 5))) return this.send(p, { t: 'no', msg: '要站在漁會捐款箱前面才能捐' });
        const amount = Math.floor(m.amount);
        if (!Number.isFinite(amount) || amount < GUILD.min) return this.send(p, { t: 'no', msg: `一次最少捐 $${GUILD.min}` });
        if (amount > GUILD.max) return this.send(p, { t: 'no', msg: `一次最多捐 $${GUILD.max.toLocaleString('en-US')}` });
        if (kit.money < amount) return this.send(p, { t: 'no', msg: '錢不夠' });
        kit.money -= amount;
        const was = g.info(p.token), got = g.donate(p.token, p.name, amount, now);
        this.send(p, { t: 'kit', kit });
        this.send(p, { t: 'donated', amount, guild: guildOf(this.hub, p), fresh: got.titles.filter((t) => !was.titles.includes(t)) });
        gainExp(this, p, amount * LEVEL.donate);
        syncTitles(this.hub);
        if (this.hub.eachRoom) this.hub.eachRoom((r) => r.all(r.boards())); else this.all(this.boards());
        if (amount >= 5000) this.sys(`🙏 ${p.name} 向漁會捐了 ${money(amount)}（本週累積 ${money(got.amount)}・第 ${got.rank} 名）`, 'record');
        return;
      }
      case 'wear': {   // 換一個稱號戴（'' = 不戴）：只能戴這一週解鎖的
        const g = this.hub.guild;
        if (!g || typeof m.title !== 'string') return this.send(p, { t: 'no', msg: '還沒有這個稱號' });
        if (g.info(p.token).wear === m.title) return this.send(p, { t: 'guild', guild: guildOf(this.hub, p) });   // 本來就是戴這個（或本來就沒戴）：什麼都沒變，不用吵到全服
        if (m.title !== '' && !g.info(p.token).titles.includes(m.title)) return this.send(p, { t: 'no', msg: '還沒有這個稱號' });
        if (now - (p.wearAt || 0) < GUILD.wearCd * 1000) return this.send(p, { t: 'no', msg: '稱號換得太快了，等一下再換' });
        if (!g.wear(p.token, m.title)) return this.send(p, { t: 'no', msg: '還沒有這個稱號' });
        p.wearAt = now;
        syncTitles(this.hub);
        this.send(p, { t: 'guild', guild: guildOf(this.hub, p) });
        if (this.hub.eachRoom) this.hub.eachRoom((r) => r.all(r.boards())); else this.all(this.boards());
        return;
      }
      case 'guild': return this.send(p, { t: 'guild', guild: guildOf(this.hub, p) });   // 打開平板的榜單：要一份最新的
      case 'feedback': {   // 漁會意見信箱（港口的郵筒）：存起來給管理網頁看
        if (!ALL_SHELF_W.some((s) => s.id === 'mailbox' && this.near(p, s.stand.x, s.stand.z, FEEDBACK.reach + 3))) return this.send(p, { t: 'no', msg: '要站在意見信箱前面才能投遞' });
        const r = this.hub.activity ? this.hub.activity.feedback(p, m.kind, m.text) : { ok: false, msg: '信箱暫時收不了信' };
        return this.send(p, r.ok ? { t: 'feedbackOk' } : { t: 'no', msg: r.msg });
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
        const h = this.extras.hot;
        if ((h && dist(x, z, h.x, h.z) < h.r + CHUM_SPEC.radius) || this.extras.chums.some((c) => dist(x, z, c.x, c.z) < c.r + CHUM_SPEC.radius)) {
          return this.send(p, { t: 'no', msg: '此水域已有魚群，誘魚桶不會疊加' });
        }
        kit.chum -= 1;
        this.extras.spawnChum(x, z, p.id);
        this.send(p, { t: 'kit', kit });
        this.send(p, { t: 'chumOk' });
        this.all(this.worldState());
        return;
      }
      case 'buy': {
        if (m.id === 'bless_tide') {
          if (now < this.blessingUntil) return this.send(p, { t: 'no', msg: '黃金魚潮正在生效中' });
          if (this.pendingBless.tide > 0) return this.send(p, { t: 'no', msg: '黃金魚潮正在倒數中' });
          const price = BLESSINGS.tide.price;
          if (kit.money < price) return this.send(p, { t: 'no', msg: '錢不夠' });
          kit.money -= price;
          this.pendingBless.tide = now + BLESSINGS.tide.delay * 1000;
          this.send(p, { t: 'bought', id: m.id, price, delay: BLESSINGS.tide.delay, kit });
          this.all(this.worldState(now));
          return this.all({ t: 'sys', text: `✨ ${p.name} 發動了「${BLESSINGS.tide.name}」！將在 ${Math.round(BLESSINGS.tide.delay / 60)} 分鐘後全服降臨！`, kind: 'record' });
        }
        if (m.id === 'bless_storm') {
          if (this.pendingBless.storm > 0) return this.send(p, { t: 'no', msg: '風暴海神祭正在倒數中' });
          if (this.sea.phase !== 'calm') return this.send(p, { t: 'no', msg: '現在海象已經不平靜了' });
          const price = BLESSINGS.storm.price;
          if (kit.money < price) return this.send(p, { t: 'no', msg: '錢不夠' });
          kit.money -= price;
          this.pendingBless.storm = now + BLESSINGS.storm.delay * 1000;
          this._stormPos = p.pos ? { x: p.pos[0], z: p.pos[2] } : null;
          this.send(p, { t: 'bought', id: m.id, price, delay: BLESSINGS.storm.delay, kit });
          this.all(this.worldState(now));
          return this.all({ t: 'sys', text: `⛈ ${p.name} 發動了「${BLESSINGS.storm.name}」！巨浪風暴將於 ${Math.round(BLESSINGS.storm.delay / 60)} 分鐘後降臨！`, kind: 'record' });
        }
        if (typeof m.id !== 'string') return;
        const baseId = m.id.startsWith('paint:') ? 'paint' : m.id;
        // 三個據點的商品（母港漁具行、海上修船屋、大港灣島）：要站在賣這樣東西的攤位前面
        const stalls = ALL_SHELF_W.filter((s) => s.id === baseId);
        if (!stalls.length || baseId === 'repair' || baseId === 'title' || baseId === 'mailbox' || baseId === 'altar') return;   // 修船、捐款、意見信箱、祭壇不是買東西（各有自己的訊息）
        const o = shopItem(m.id, kit);
        const it = stalls.find((s) => this.near(p, s.stand.x, s.stand.z, 4));
        if (!(o.swap && baseId === 'paint')) {   // 換回買過的塗裝不用站在攤位前（平板上隨時能換）
          if (!it || (p.pos && p.pos[8])) return this.send(p, { t: 'no', msg: m.id !== baseId ? '要在海上修船屋或大港船塢的塗裝櫃前面才能買' : '要站在攤位前面才能買' });
        }
        if (baseId === 'box') return buyBox(this, p, m);   // 魚箱：拿在手上的道具（fishBoxes.js）
        if (o.price === null) return this.send(p, { t: 'no', msg: o.why === 'boat' ? '要先有近海漁船或遠洋大漁船才能裝' : '這樣東西現在買不了' });
        if (kit.money < o.price) return this.send(p, { t: 'no', msg: '錢不夠' });
        if (o.boat) {
          // 買新船：直接在這個據點原地換船——舊船（連它的引擎等級）收進倉庫，新船停到這裡最近的空泊位，甲板上的魚和魚箱搬到新船的前甲板
          if (!p.boat || p.boat.sunk) return this.send(p, { t: 'no', msg: '船已經沉了' });
          const q = aboard(this, p);
          if (q) return this.send(p, { t: 'no', msg: q === p ? '先下船才能買新船' : `${q.name} 還在你的船上` });
          if (!siteOf(p) || !this.berthFreeFor(p, o.boat)) return this.send(p, { t: 'no', msg: '這裡的泊位停不下這艘船（滿了或太小），等一下再買' });
          kit.money -= o.price;
          o.apply(kit);
          p.stored[kit.active] = { fuel: p.boat.s[10], cracks: p.boat.cracks };
          kit.active = o.boat;
          this.towCut(p, '換了新船，拖纜解開');
          this.carryDeck(p, o.boat);
          this.send(p, { t: 'bought', id: m.id, price: o.price, boat: o.boat, kit });
          return this.newBoat(p, { bought: o.boat }, true);
        }
        kit.money -= o.price;
        o.apply(kit);
        if ((baseId === 'paint' || baseId === 'engine' || baseId.startsWith('mod_')) && p.boat) this.all({ t: 'boat', id: p.id, boat: this.boatInfo(p) }, p);   // 別人看得到的：塗裝、改裝、引擎等級
        this.send(p, { t: 'bought', id: m.id, price: o.price, repair: !!o.repair, cheap: !!o.cheap, swap: !!o.swap, paint: o.paint?.name, kit });
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
        if (m.ch === 'party') {   // 隊伍頻道：只送給同隊的人
          if (!p.party) return this.send(p, { t: 'sys', text: '你還沒加入船隊，這句沒送出去', kind: 'warn' });
          const msg = { t: 'chat', ch: 'party', id: p.id, name: p.name, ...badge(p), text: mask(text) };
          for (const o of this.players.values()) if (o.party === p.party) this.send(o, msg);
          return;
        }
        return this.all({ t: 'chat', id: p.id, name: p.name, ...badge(p), text: mask(text) });
      }

      // ---- 測試指令（只有開發模式的伺服器才收） ----
      case 'dev': {
        if (!DEV) return;
        const resetSea = () => { this.sea._calm(); this.sea.vortices.length = 0; this.sea.endedVortices.length = 0; this.sea.tsu.on = false; };
        if (m.cmd === 'event') {
          if (p.pos) { this.env.near.x = p.pos[0]; this.env.near.z = p.pos[2]; }
          let ok = false;
          if (typeof m.kind === 'string' && DEV_EVENTS.has(m.kind)) {
            if (this.sea.phase !== 'calm') resetSea();
            ok = this.sea.trigger(m.kind, this.env);
            if (ok) this.sea.after = 0;
          }
          this.send(p, { t: 'sys', text: ok ? `（測試）引發了 ${m.kind}` : '（測試）現在引發不了', kind: 'warn' });
        } else if (m.cmd === 'calm') resetSea(); else if (m.cmd === 'skip') { const h = Number.isFinite(m.hours) ? Math.min(Math.max(m.hours, 0), 24) : 3; this.skew += h; for (let k = h; k > 0; k--) this.climate.update(Math.min(k, 1) * HOUR); } else if (m.cmd === 'refresh') return this.hub.refresh(true);
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
  // 兩個人是不是同一隊（船隊，見 party.js）
  sameParty(a, b) { return !!a.party && a.party === b.party; }
  // p 所在的據點有沒有 type 這種船停得下的空泊位
  berthFreeFor(p, type) { return berthFree(this, p, type); }
  // 買新船原地換船：甲板上的散魚、魚箱搬到新船的前甲板安全區（船身座標 x 1.2～2.5，不會卡進駕駛艙）
  carryDeck(p, type) {
    const S = BOAT_TYPES[type], add = [];
    const spot = () => [1.2 + Math.random() * 1.3, (Math.random() - 0.5) * Math.min(1.6, S.beam * 0.4)];
    for (const e of this.loose.values()) {
      if (e.k !== 'd' || e.b !== p.id) continue;
      [e.x, e.z] = spot(); e.y = S.deck + 0.05;
      add.push(this.loosePub(e));
    }
    if (add.length) this.all({ t: 'loose', add });
    moveDeckBoxes(this, p, spot);
  }

  stepBlessings(now) {
    let changed = false;
    if (this.pendingBless.tide && now >= this.pendingBless.tide) {
      this.pendingBless.tide = 0;
      this.blessingUntil = now + BLESSINGS.tide.duration * 1000;
      this.extras.spawnHotspotNow(BLESSINGS.tide.duration, true);
      this.all({ t: 'sys', text: `✨ 「${BLESSINGS.tide.name}」降臨！全服 ${Math.round(BLESSINGS.tide.duration / 60)} 分鐘稀有與少見魚出現率 ×2，海上已湧現不限尾數黃金魚群！`, kind: 'record' });
      changed = true;
    }
    if (this.pendingBless.storm && now >= this.pendingBless.storm && this.sea.phase === 'calm') {
      this.pendingBless.storm = 0;
      if (this._stormPos) { this.env.near.x = this._stormPos.x; this.env.near.z = this._stormPos.z; }
      this._stormPos = null;
      if (this.sea.trigger('storm', this.env)) {
        this.all({ t: 'sys', text: `⛈ 「${BLESSINGS.storm.name}」降臨！海上即將掀起巨浪風暴！`, kind: 'record' });
      }
      changed = true;
    }
    return changed;
  }
  // 落水點附近（25 公尺內）有沒有開著船首集魚燈的船：回傳夜裡趨光魚多幾倍（沒有 = 0）。誰的船都算，燈照到的海面大家都能釣
  lampActive(p, x, z) {
    if (!this.climate.night) return 0;
    let k = 0;
    for (const o of this.players.values()) {
      const b = o.boat;
      if (!b || b.sunk || !(b.s[9] & 8) || !o.kit.mods?.lamp || dist(b.s[0], b.s[1], x, z) > 25) continue;
      k = Math.max(k, BOAT_TYPES[b.type].lampMul || 0);
    }
    return k > 1 ? k : 0;
  }
  // 一筆賣魚的錢付給 p：base 魚本身的價錢、port 那個收購站多給幾成（大港 +15%）。
  // 自己或同隊在線隊友現在開的是有急凍魚艙的船（遠洋大漁船）：再多 freshBonus 成；同房的隊友每人另外拿 PARTY.share 成分紅（不扣賣的人的）
  payout(p, base, port = 0) {
    const crew = [p, ...mates(this, p)];
    const fresh = Math.max(0, ...crew.map((o) => (o.boat && !o.boat.sunk ? BOAT_TYPES[o.boat.type].freshBonus || 0 : 0)));
    const total = Math.round(base * (1 + port + fresh));
    p.kit.money += total;
    if (total > 0) gainExp(this, p, total * LEVEL.sell);
    const share = Math.round(total * PARTY.share);
    if (share > 0) for (const o of crew) {
      if (o === p) continue;
      o.kit.money += share;
      this.send(o, { t: 'partyBonus', from: p.name, amount: share, kit: o.kit });
    }
    return { total, fresh };
  }
  // 斷開跟 p 的船有關的拖纜（換船、買船、叫船時）
  towCut(p, why) { return towCut(this, p, why); }

  reelState(f) {
    const { force, zone, target, width, speed, dash, progress, strain } = f.fight;
    return { id: f.id, n: f.n, held: f.held, force, zone, target, width, speed: speed * dash, progress, strain };
  }

  advanceFishing(p, f, now) {
    if (!p.pos || p.kit.rodBroken || dist(p.pos[0], p.pos[2], f.x, f.z) >= 75
      || now - f.started >= (f.n ? FIGHT_LIMIT_MS : REEL_START_MS)) return this.finishFishing(p, f, 'escape', now);
    if (!f.n) return;   // 從第一組按鍵狀態開始模擬，留出上鉤通知往返的時間。
    // 用伺服器經過的時間，切小步處理快速的張力變化。主迴圈短暫卡住時限制補算。
    let seconds = Math.min(0.25, (now - f.lastAt) / 1000);
    f.lastAt = Math.max(f.lastAt, now);
    while (seconds > 0 && !f.fight.result) {
      const dt = Math.min(seconds, 0.02);
      stepFishFight(f.fight, f.held, dt);
      seconds -= dt;
    }
    if (f.fight.result) this.finishFishing(p, f, f.fight.result, now);
  }

  finishFishing(p, f, result, now) {
    p.fishing = null;
    if (result === 'caught' && p.fish.size >= 200) result = 'full';
    if (result === 'snap') {
      p.kit.rodBroken = true;
      this.send(p, { t: 'kit', kit: p.kit });
    }
    if (result !== 'caught') return this.send(p, { t: 'fightEnd', id: f.id, result });

    const { id, kg, len, value } = f.fish, uid = nextUid++;
    p.fish.set(uid, { id, kg, len, value, by: { pid: p.id, key: p.token, name: p.name } });
    if (this.extras.consumeHot(f.x, f.z, { skipChum: now < this.blessingUntil })) this.all(this.worldState());
    const dex = recordDex(p, f.fish, f.at);
    this.send(p, { t: 'caught', fightId: f.id, fish: { uid, id, kg, len, value }, dex });
    gainExp(this, p, (isJunk(id) ? LEVEL.junk : Math.min(LEVEL.catchMax, LEVEL.catch + value * LEVEL.catchValue)) + (dex.isNew ? LEVEL.dexNew : 0));
  }

  // 掛上餌：先決定這次會是哪條魚、幾秒後咬（含試探假咬 nibble）
  bait(p, now) {
    const f = p.fishing, c = this.climate;
    // 魚群熱點裡：咬得快、個頭大；洞穴的深潭下雨時咬得特別快
    const spot = fishingSpot(f.x, f.z, c, this.sea);
    const inNatHot = this.extras.inNaturalHot(f.x, f.z), inChum = !inNatHot && this.extras.inChum(f.x, f.z);
    const blessing = now < this.blessingUntil, lamp = this.lampActive(p, f.x, f.z);   // lamp：集魚燈的倍率（0 = 沒有）
    const vortex = this.sea.vortexBonusAt(f.x, f.z);
    // 誘魚桶不與黃金魚潮或既有魚群疊加：黃金魚潮期間僅自然／黃金熱點享雙重加成，誘魚桶圈僅維持全服魚潮效果
    const hot = inNatHot || (!blessing && inChum);
    f.fish = rollCatch({ ...spot, hot, bait: f.baitUsed, blessing, lamp, vortex });
    f.at = placeOfSpot(spot);   // 圖鑑記「在哪釣到」
    const delay = biteDelay({ rain: Math.max(this.sea.rain, c.rain), hot, caveRain: spot.zone === 'cave' && spot.rain > 0.2, fish: f.fish });
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
    dropLinks(this, p);
    p.kit = newKit();
    const del = [];
    for (const e of this.loose.values()) if (e.owner === p.id) { this.loose.delete(e.uid); del.push(e.uid); }
    if (del.length) this.all({ t: 'loose', del });
    resetBoxes(this, p);
    p.fish.clear();
    p.stored = {};
    // 圖鑑不清：另外存在 dexbook.json，刷新後還在
    p.hold = p.tab = p.line = null;
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
    syncHatch(this, p);   // 魚艙換到新船上（畫面端照 h 擺、照船算容量）
  }

  // ---- 放在外面的魚 ----
  loosePub(e) { return { uid: e.uid, id: e.f.id, kg: e.f.kg, len: e.f.len, value: e.f.value, o: e.owner, w: this.fishOwner(e.f, this.players.get(e.owner))?.id ?? e.owner, k: e.k, x: e.x, y: e.y, z: e.z, yaw: e.yaw, b: e.b }; }   // o：誰放的；w：魚是誰的
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
  // 一條魚是誰的：釣到的人（f.by）；送過人的魚（f.gift）是最後收下的人的。誰拿著、誰放進籃子、誰按賣出都不算
  //（隊友只能幫忙拿，見 grab）。那個人不在這間房了（離線、換房）才算現在拿著的人（holder）的
  fishOwner(f, holder) {
    const who = f.gift || f.by;
    if (who) for (const o of this.players.values()) if (o.token === who.key && !o.left) return o;
    return holder;
  }
  // 一批魚（大港大秤、整箱賣）賣掉的錢照魚的主人分開付：p 自己的照 payout 付給 p 並回傳；
  // 隊友幫忙拿去賣的那幾條付給主人（各自照 payout 算加成與分紅），送 paidFor 告訴他
  payFish(p, list, port = 0) {
    const by = new Map();
    for (const f of list) {
      const o = this.fishOwner(f, p) || p;
      const r = by.get(o) ?? by.set(o, { total: 0, n: 0, best: null }).get(o);
      r.total += f.value; r.n++;
      if (!isJunk(f.id) && (!r.best || f.value > r.best.value)) r.best = f;   // 雜物賣得到錢，但不算紀錄
    }
    let mine = { total: 0, fresh: 0 }, others = 0;
    for (const [o, r] of by) {
      const got = this.payout(o, r.total, port);
      if (o === p) mine = got;
      else { others += r.n; this.send(o, { t: 'paidFor', from: p.name, n: r.n, total: got.total, kit: o.kit }); }
      if (r.best) this.record(this.creditOf(o, r.best), r.best, o.name);
    }
    return { ...mine, others };
  }
  // 母島的籃子：按下按鈕，籃子裡的魚全部賣掉，每條的錢付給牠的主人（fishOwner；按的人只是幫忙按）
  sellBasket(p) {
    if (!this.near(p, SELL_W.button.x, SELL_W.button.z, SELL_REACH)) return this.send(p, { t: 'no', msg: '要站在籃子旁邊才能賣' });
    const list = [...this.loose.values()].filter((e) => e.k === 'b');
    if (!list.length) return this.send(p, { t: 'no', msg: '籃子是空的' });
    const res = new Map();   // 玩家 → { total 拿到的錢, uids 他放在籃子裡被賣掉的魚, best 算紀錄的那條, n 他拿到錢的條數 }
    const of = (o) => res.get(o) ?? res.set(o, { total: 0, uids: [], best: null, n: 0 }).get(o);
    for (const e of list) {
      this.loose.delete(e.uid);
      const holder = this.players.get(e.owner);
      if (holder) { holder.fish.delete(e.uid); of(holder).uids.push(e.uid); }
      const to = this.fishOwner(e.f, holder);
      if (!to) continue;   // 釣到的人和放的人都不在了：魚賣掉，錢沒人收
      const r = of(to);
      r.total += e.f.value; r.n++;
      if (!isJunk(e.f.id) && (!r.best || e.f.value > r.best.value)) r.best = e.f;   // 雜物賣得到錢，但不算紀錄
    }
    this.all({ t: 'loose', del: list.map((e) => e.uid) });
    for (const [o, r] of res) {
      const got = r.total > 0 ? this.payout(o, r.total, 0) : { total: 0, fresh: 0 };
      this.send(o, { t: 'sold', total: got.total, fresh: got.fresh, uids: r.uids, n: r.n, kit: o.kit, by: o === p ? undefined : p.name });
      if (r.best) this.record(this.creditOf(o, r.best), r.best, o.name);
    }
    if (!res.has(p)) this.send(p, { t: 'sold', total: 0, uids: [], kit: p.kit, helped: true });
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
