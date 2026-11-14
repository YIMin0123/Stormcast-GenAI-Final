// Stormcast 的多人伺服器。
//   - 常駐 3 間房（1、2、3 號港，數量見 config.js 的 SERVER），沒人也不關，遊戲內時間各差 8 小時；
//     都滿了（每間 30 人）才臨時多開一間，臨時房沒人就關掉。玩家不能自己開房
//   - 大廳：連進來先填名字，拿到房間列表（房名、人數、天氣），點一間就進去
//   - 合併：臨時房連續 10 分鐘少於 5 人，整間併進一間放得下的常駐房（先通知、倒數；有海上事件就等它結束）；常駐房之間不合併
//   - 進度（錢、船、裝備、還沒賣的魚）跟著裝置的認人代碼存在檔案裡（profiles.js），換房、隔天再來、伺服器重開都還在；
//     斷線 30 秒內回來連位置都接得回去
//   - 定時刷新：從 SERVER.refresh.first 起每 SERVER.refresh.everyHours 小時，進度和排行榜全部清空
// 房間裡的事（天氣、釣魚、買賣、聊天、看板）在 room.js。
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room, newPlayer, profileOf, applyProfile, MAX_PLAYERS, TICK } from './room.js';
import { Daily } from './daily.js';
import { Profiles, epochAt } from './profiles.js';
import { SERVER } from '../src/config.js';
import { refreshRule } from '../src/announce.js';
import { cleanName, isRude } from './words.js';

const PORT = +(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';   // 正式機在 Caddy 後面，只聽本機
const DATA = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), 'data');
const ORIGINS = (process.env.ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);   // 只收這些網站連進來（沒設定就都收）
const MERGE_AFTER = +(process.env.MERGE_AFTER_SEC || 600) * 1000;   // 兩間房都少於 MERGE_BELOW 人多久之後合併
const MERGE_COUNT = +(process.env.MERGE_COUNT_SEC || 30);           // 合併前倒數幾秒
const MERGE_BELOW = 5;
const SAVE_EVERY = 10;   // 進度幾秒存一次（有變才寫檔）

const hub = {
  rooms: new Map(),       // 房號 → Room
  sessions: new Map(),    // 認人用的代碼 → 玩家（斷線重連時靠它找回來）
  lobby: new Set(),       // 還在大廳裡的連線
  daily: new Daily(DATA),
  profiles: new Profiles(DATA),
  nextId: 1,
  merge: null,            // 正在進行的合併：{ from, to, phase: 'wait' | 'count', left }
  eachRoom(fn) { for (const r of this.rooms.values()) fn(r); },
  // 把這個人現在的進度記下來（存檔在 save 時才寫）
  keep(p) { if (p.owner && p.token) this.profiles.put(p.token, profileOf(p)); },
  refresh,
};
// 伺服器關著的時候刷新過了：今日紀錄也一起清
if (hub.profiles.stale) { hub.daily.clear(); hub.profiles.save(); console.log('[refresh] 關機期間刷新過了，進度和今日紀錄已清空'); }

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const lobbyList = () => ({
  t: 'lobby',
  rooms: [...hub.rooms.values()].sort((a, b) => a.id - b.id).map((r) => ({ id: r.id, name: r.name, n: r.count, max: MAX_PLAYERS, weather: r.weather })),
});

// 常駐房一直開著；隨時保留至少一間沒滿的房：常駐房都滿了才開臨時房，沒人的臨時房關掉（都滿了的話留一間空的）
function tidyRooms() {
  for (let k = 1; k <= SERVER.fixedRooms; k++) if (!hub.rooms.has(k)) hub.rooms.set(k, new Room(k, hub));
  const rooms = [...hub.rooms.values()].sort((a, b) => a.id - b.id);
  let spare = rooms.some((r) => (r.fixed || r.players.size) && r.count < MAX_PLAYERS);   // 常駐房、或有人的臨時房還沒滿
  for (const r of rooms) {
    if (r.fixed || r.players.size || (hub.merge && (hub.merge.from === r || hub.merge.to === r)) || r.devKeep > Date.now()) continue;
    if (spare) hub.rooms.delete(r.id); else spare = true;
  }
  if (!spare) {
    let n = SERVER.fixedRooms + 1;
    while (hub.rooms.has(n)) n++;
    hub.rooms.set(n, new Room(n, hub));
    console.log(`[room] 開了 ${n} 號港（共 ${hub.rooms.size} 間）`);
  }
}
tidyRooms();

// ---- 合併 -------------------------------------------------------------------
function cancelMerge(why) {
  const m = hub.merge;
  if (!m) return;
  hub.merge = null;
  for (const r of [m.from, m.to]) { r.hold = false; r.lowSince = 0; if (why) r.all({ t: 'merge', phase: 'cancel', text: why }); }
}
function doMerge() {
  const { from, to } = hub.merge;
  hub.merge = null;
  from.hold = to.hold = false;
  to.lowSince = 0;
  for (const p of [...from.players.values()]) if (p.left) from.remove(p);   // 已經離開、只剩船還沒收的：不搬
  const moving = [...from.players.values()];
  for (const p of moving) {
    from.players.delete(p.id);
    from.berths.delete(p.berth);
    p.fishing = null;
  }
  // 本房紀錄跟著人走
  to.board.push(...from.board);
  to.board.sort((a, b) => b.value - a.value);
  to.board.length = Math.min(to.board.length, 60);
  from.board = [];
  const moved = new Map();
  for (const p of moving) moved.set(p, to.enter(p, { fresh: false, quiet: true }));
  for (const p of moving) {
    if (p.ws) to.send(p, { t: 'merged', from: from.name, repark: moved.get(p), ...to.snapshot(p) });
  }
  const here = moving.filter((p) => p.ws);
  for (const p of to.players.values()) if (p.ws && !moving.includes(p)) to.send(p, { t: 'sys', text: `${from.name}的玩家合併進來了`, kind: 'merge' });
  to.all(to.boards());
  hub.rooms.delete(from.id);
  console.log(`[merge] ${from.name} → ${to.name}（搬了 ${here.length} 人）`);
  tidyRooms();
}
// 每秒看一次：要不要開始合併、進行中的合併走到哪了。只有臨時房會被併進常駐房
function mergeStep(now) {
  for (const r of hub.rooms.values()) {
    const n = r.active;
    if (!r.fixed && n > 0 && n < MERGE_BELOW) { if (!r.lowSince) r.lowSince = now; } else r.lowSince = 0;
  }
  const m = hub.merge;
  if (!m) {
    const ready = [...hub.rooms.values()].filter((r) => r.lowSince && now - r.lowSince >= MERGE_AFTER);
    if (!ready.length) return;
    ready.sort((a, b) => a.active - b.active || b.id - a.id);
    const from = ready[0];
    // 併到放得下的常駐房裡人最多的那間（比較熱鬧）
    const to = [...hub.rooms.values()].filter((r) => r.fixed && r.count + from.count <= MAX_PLAYERS).sort((a, b) => b.active - a.active || a.id - b.id)[0];
    if (!to) return;
    hub.merge = { from, to, phase: '', left: MERGE_COUNT };
    from.hold = to.hold = true;   // 不再發生新的海上事件
    return;
  }
  const { from, to } = m;
  if (!hub.rooms.has(from.id) || !hub.rooms.has(to.id) || !from.active) return cancelMerge('');
  if (from.active >= MERGE_BELOW || from.count + to.count > MAX_PLAYERS) return cancelMerge('人數變多了，合併取消');
  if (!from.calm || !to.calm) {
    // 有一邊正在發生海上事件：等它結束
    if (m.phase !== 'wait') {
      m.phase = 'wait';
      from.all({ t: 'merge', phase: 'wait', text: `這間房人比較少，海況平靜後將合併到${to.name}` });
      to.all({ t: 'merge', phase: 'wait', text: `海況平靜後，${from.name}的玩家將合併進來` });
    }
    return;
  }
  if (m.phase !== 'count') {
    m.phase = 'count'; m.left = MERGE_COUNT;
    from.all({ t: 'merge', phase: 'count', move: true, sec: m.left, text: `這間房人比較少，${m.left} 秒後合併到${to.name}（位置、船和錢都會保留）` });
    to.all({ t: 'merge', phase: 'count', sec: m.left, text: `${m.left} 秒後，${from.name}的玩家將合併進來` });
    return;
  }
  m.left--;
  if (m.left === 10) from.all({ t: 'merge', phase: 'count', move: true, sec: 10, text: `10 秒後合併到${to.name}` });
  if (m.left <= 0) doMerge();
}

// ---- 連線 -------------------------------------------------------------------
const http = createServer((req, res) => {
  let n = 0;
  hub.eachRoom((r) => { n += r.active; });
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`Stormcast 伺服器運作中：${hub.rooms.size} 間房、線上 ${n} 人\n`);
});
const wss = new WebSocketServer({
  server: http, maxPayload: 16 * 1024,
  verifyClient: ({ origin }) => !ORIGINS.length || ORIGINS.includes(origin),
});

wss.on('connection', (ws) => {
  let me = null;        // 進房之後才有
  let name = '', token = '', look = 'girl';   // look：選的角色（只收得到 girl／boy）
  let burstAt = 0, burst = 0;

  // 這個代碼的人還在某間房裡（斷線 30 秒內、或在別的視窗）：接回那間房、那一局
  const resume = () => {
    const old = token && hub.sessions.get(token);
    if (!old || !old.room || old.left) return false;
    if (old.ws) { send(old.ws, { t: 'kicked', msg: '你在另一個視窗進入了遊戲' }); const w = old.ws; old.ws = null; w.close(); old.room.all({ t: 'leave', id: old.id }); }
    me = old;
    me.ws = ws; me.gone = 0; me.name = name; me.look = look;   // 重新整理後可能換了角色
    hub.lobby.delete(ws);
    const r = me.room;
    r.send(me, { t: 'joined', resume: r.resumeData(me), ...r.snapshot(me) });
    r.all({ t: 'join', id: me.id, name: me.name, look: me.look, here: true, boat: r.boatInfo(me), quiet: true }, me);
    // 斷線時遇到定時刷新：畫面上的船、魚還是舊的，整包重置再送一次
    if (me.resetMsg) { r.send(me, { t: 'reset', text: me.resetMsg, kit: me.kit, berth: r.berthInfo(me), boards: r.boards() }); me.resetMsg = null; }
    console.log(`[back] ${name} 回到 ${r.name}`);
    return true;
  };

  ws.on('message', (raw) => {
    // 一秒超過 80 則訊息：不正常，丟掉多的
    const now = Date.now();
    if (now - burstAt > 1000) { burstAt = now; burst = 0; }
    if (++burst > 80) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (me) {
      if (m.t === 'leave') { const r = me.room; r.quit(me); me = null; ws.close(); tidyRooms(); return; }
      if (me.room) me.room.on(me, m);
      return;
    }

    if (m.t === 'hello') {
      name = cleanName(m.name);
      look = m.look === 'boy' ? 'boy' : 'girl';
      if (!name) return send(ws, { t: 'denied', msg: '請先填好名字' });
      if (isRude(name)) { name = ''; return send(ws, { t: 'denied', msg: '這個名字不能用，換一個吧' }); }
      token = typeof m.token === 'string' && /^[0-9a-f]{32}$/.test(m.token) ? m.token : '';
      // 斷線 30 秒內回來：直接接回原本那間房、原本的位置
      if (resume()) return;
      hub.lobby.add(ws);
      return send(ws, { ...lobbyList(), name });
    }

    if (m.t === 'devRoom' && process.env.STORMCAST_DEV) {   // 測試用：多開一間房（平常要等房間滿了才會開）
      let k = 1;
      while (hub.rooms.has(k)) k++;
      const r = new Room(k, hub);
      r.devKeep = Date.now() + 15000;
      hub.rooms.set(k, r);
      return send(ws, lobbyList());
    }

    if (m.t === 'join') {
      if (!name) return send(ws, { t: 'denied', msg: '請先填好名字' });
      const r = hub.rooms.get(m.room);
      if (!r) return send(ws, { t: 'full', msg: '這間房已經關了，挑別間吧', ...lobbyList() });
      if (r.count >= MAX_PLAYERS) return send(ws, { t: 'full', msg: '這間房滿了，挑別間吧', ...lobbyList() });
      if (hub.merge && hub.merge.from === r) return send(ws, { t: 'full', msg: '這間房正要合併到別間，挑別間吧', ...lobbyList() });
      if (resume()) return;   // 同一台裝置在別的視窗已經在房裡了：接過來
      if (!token) token = randomBytes(16).toString('hex');   // 第一次來：發一個認人的代碼，進度跟著它存
      me = newPlayer(hub.nextId++, ws, token, name, look);
      const prof = hub.profiles.get(token);
      if (prof) applyProfile(me, prof);
      hub.sessions.set(token, me);
      hub.lobby.delete(ws);
      r.enter(me);
      // 有存著的進度：家當、倉庫裡的船、還沒賣的魚還給他，人從港口出發、船停在分到的格子
      const back = prof && { pos: null, boat: { ...me.boat, s: [...me.boat.s] }, stored: me.stored, fish: [...me.fish].map(([uid, f]) => ({ uid, ...f })) };
      r.send(me, { t: 'joined', resume: back || null, ...r.snapshot(me) });
      hub.keep(me);
      console.log(`[join] ${name} 進了 ${r.name}（${r.count}/${MAX_PLAYERS}）${prof ? '，帶著存著的進度' : ''}`);
      tidyRooms();
    }
  });

  ws.on('close', () => {
    hub.lobby.delete(ws);
    if (!me || me.ws !== ws) return;   // 還在大廳、已經按了離開、或被另一個視窗頂掉
    console.log(`[drop] ${me.name} 斷線（${me.room.name}）`);
    me.room.drop(me);
  });
  ws.on('error', () => {});
});

// ---- 時鐘 -------------------------------------------------------------------
let n = 0;
setInterval(() => {
  const now = Date.now();
  n++;
  for (const r of hub.rooms.values()) r.step(now);
  if (n % 10 === 0) { mergeStep(now); tidyRooms(); }
  if (n % 20 === 0 && hub.lobby.size) { const raw = JSON.stringify(lobbyList()); for (const ws of hub.lobby) if (ws.readyState === 1) ws.send(raw); }
  if (n % 10 === 0 && epochAt(now) > hub.profiles.epoch) refresh(false);
  if (n % (SAVE_EVERY * 10) === 0) {
    hub.eachRoom((r) => { for (const p of r.players.values()) hub.keep(p); });
    hub.profiles.save();
  }
  if (n % 600 === 0) {
    if (hub.daily.roll()) hub.eachRoom((r) => r.all(r.boards()));   // 午夜：今日紀錄清空
    hub.daily.save();
  }
}, TICK * 1000);

// ---- 定時刷新 -----------------------------------------------------------------
// 定時（SERVER.refresh）：所有人的錢、船、裝備、還沒賣的魚和兩塊排行榜都清空；在線上的人直接變回新玩家、送回港口
function refresh(test) {
  if (!test) hub.profiles.epoch = epochAt();
  hub.profiles.clear(hub.profiles.epoch);
  hub.daily.clear();
  const text = `${test ? '（測試）' : ''}刷新時間到了（${refreshRule()}）：錢、船、裝備、還沒賣的魚和排行榜都清空，大家從港口重新開始`;
  let k = 0;
  hub.eachRoom((r) => {
    r.board = [];
    for (const p of r.players.values()) if (!p.left) { r.reset(p, text); hub.keep(p); k++; }
    r.all(r.boards());
  });
  hub.profiles.save();
  console.log(`[refresh] ${test ? '（測試）' : ''}刷新：重置了 ${k} 人（第 ${hub.profiles.epoch} 期）`);
}

const stop = () => { hub.eachRoom((r) => { for (const p of r.players.values()) hub.keep(p); }); hub.profiles.save(); hub.daily.save(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
http.listen(PORT, HOST, () => console.log(`Stormcast 伺服器：ws://${HOST}:${PORT}　今日紀錄、進度存在 ${DATA}`));
