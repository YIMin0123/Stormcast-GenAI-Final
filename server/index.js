// Stormcast 的多人伺服器。
//   - 一台伺服器同時跑很多間房（每間最多 30 人），玩家不能自己開房：這裡隨時保留至少一間沒滿的房，沒人的房自動關掉
//   - 大廳：連進來先填名字，拿到房間列表（房名、人數、天氣），點一間就進去
//   - 合併：兩間房連續 10 分鐘都少於 5 人，人少的那間整間併進人多的那間（先通知、倒數；有海上事件就等它結束）
//   - 斷線 30 秒內回來可以接回原進度；除了今日紀錄，其他都只放在記憶體裡
// 房間裡的事（天氣、釣魚、買賣、聊天、看板）在 room.js。
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room, newPlayer, MAX_PLAYERS, TICK } from './room.js';
import { Daily } from './daily.js';
import { cleanName, isRude } from './words.js';

const PORT = +(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';   // 正式機在 Caddy 後面，只聽本機
const DATA = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), 'data');
const ORIGINS = (process.env.ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);   // 只收這些網站連進來（沒設定就都收）
const MERGE_AFTER = +(process.env.MERGE_AFTER_SEC || 600) * 1000;   // 兩間房都少於 MERGE_BELOW 人多久之後合併
const MERGE_COUNT = +(process.env.MERGE_COUNT_SEC || 30);           // 合併前倒數幾秒
const MERGE_BELOW = 5;

const hub = {
  rooms: new Map(),       // 房號 → Room
  sessions: new Map(),    // 認人用的代碼 → 玩家（斷線重連時靠它找回來）
  lobby: new Set(),       // 還在大廳裡的連線
  daily: new Daily(DATA),
  nextId: 1,
  merge: null,            // 正在進行的合併：{ from, to, phase: 'wait' | 'count', left }
  eachRoom(fn) { for (const r of this.rooms.values()) fn(r); },
};

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const lobbyList = () => ({
  t: 'lobby',
  rooms: [...hub.rooms.values()].sort((a, b) => a.id - b.id).map((r) => ({ id: r.id, name: r.name, n: r.count, max: MAX_PLAYERS, weather: r.weather })),
});

// 隨時保留至少一間沒滿的房；沒人的房關掉（留一間當備用）
function tidyRooms() {
  const rooms = [...hub.rooms.values()].sort((a, b) => a.id - b.id);
  let spare = rooms.some((r) => r.players.size && r.count < MAX_PLAYERS);   // 有人、還沒滿的房
  for (const r of rooms) {
    if (r.players.size || (hub.merge && (hub.merge.from === r || hub.merge.to === r)) || r.devKeep > Date.now()) continue;
    if (spare) hub.rooms.delete(r.id); else spare = true;   // 都滿了的話留一間空的
  }
  if (!spare) {
    let n = 1;
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
// 每秒看一次：要不要開始合併、進行中的合併走到哪了
function mergeStep(now) {
  for (const r of hub.rooms.values()) {
    const n = r.active;
    if (n > 0 && n < MERGE_BELOW) { if (!r.lowSince) r.lowSince = now; } else r.lowSince = 0;
  }
  const m = hub.merge;
  if (!m) {
    const ready = [...hub.rooms.values()].filter((r) => r.lowSince && now - r.lowSince >= MERGE_AFTER);
    if (ready.length < 2) return;
    ready.sort((a, b) => a.active - b.active || b.id - a.id);
    const from = ready[0], to = ready[ready.length - 1];
    if (from.count + to.count > MAX_PLAYERS) return;
    hub.merge = { from, to, phase: '', left: MERGE_COUNT };
    from.hold = to.hold = true;   // 不再發生新的海上事件
    return;
  }
  const { from, to } = m;
  if (!hub.rooms.has(from.id) || !hub.rooms.has(to.id) || !from.active || !to.active) return cancelMerge('');
  if (from.active >= MERGE_BELOW || to.active >= MERGE_BELOW || from.count + to.count > MAX_PLAYERS) return cancelMerge('人數變多了，合併取消');
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
  let name = '', token = '';
  let burstAt = 0, burst = 0;

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
      if (!name) return send(ws, { t: 'denied', msg: '請先填好名字' });
      if (isRude(name)) { name = ''; return send(ws, { t: 'denied', msg: '這個名字不能用，換一個吧' }); }
      token = typeof m.token === 'string' && /^[0-9a-f]{32}$/.test(m.token) ? m.token : '';
      // 斷線 30 秒內回來：直接接回原本那間房、原本的進度
      const old = token && hub.sessions.get(token);
      if (old && old.room && !old.left) {
        if (old.ws) { send(old.ws, { t: 'kicked', msg: '你在另一個視窗進入了遊戲' }); const w = old.ws; old.ws = null; w.close(); old.room.all({ t: 'leave', id: old.id }); }
        me = old;
        me.ws = ws; me.gone = 0; me.name = name;
        hub.lobby.delete(ws);
        const r = me.room;
        r.send(me, { t: 'joined', resume: r.resumeData(me), ...r.snapshot(me) });
        r.all({ t: 'join', id: me.id, name: me.name, here: true, boat: r.boatInfo(me), quiet: true }, me);
        console.log(`[back] ${name} 回到 ${r.name}`);
        return;
      }
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
      token = randomBytes(16).toString('hex');   // 每次進房都是新的開始，認人的代碼也換新的
      me = newPlayer(hub.nextId++, ws, token, name);
      hub.sessions.set(token, me);
      hub.lobby.delete(ws);
      r.enter(me);
      r.send(me, { t: 'joined', resume: null, ...r.snapshot(me) });
      console.log(`[join] ${name} 進了 ${r.name}（${r.count}/${MAX_PLAYERS}）`);
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
  if (n % 600 === 0) {
    if (hub.daily.roll()) hub.eachRoom((r) => r.all(r.boards()));   // 午夜：今日紀錄清空
    hub.daily.save();
  }
}, TICK * 1000);

const stop = () => { hub.daily.save(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
http.listen(PORT, HOST, () => console.log(`Stormcast 伺服器：ws://${HOST}:${PORT}　今日紀錄存在 ${DATA}`));
