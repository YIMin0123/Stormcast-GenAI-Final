// Stormcast 的多人伺服器。
//   - 常駐 3 間房（1、2、3 號港，數量見 config.js 的 SERVER），沒人也不關，遊戲內時間各差 8 小時；
//     都滿了（每間 30 人）才臨時多開一間，臨時房沒人就關掉。玩家不能自己開房
//   - 大廳：連進來先填名字，拿到房間列表（房名、人數、天氣），點一間就進去
//   - 合併：臨時房連續 10 分鐘少於 5 人，整間併進一間放得下的常駐房（先通知、倒數；有海上事件就等它結束）；常駐房之間不合併
//   - 進度（錢、船、裝備、還沒賣的魚）跟著裝置的認人代碼存在檔案裡（profiles.js），換房、隔天再來、伺服器重開都還在；
//     斷線在寬限內回來連位置都接得回去
//   - 定時刷新：從 SERVER.refresh.first 起每 SERVER.refresh.everyHours 小時，進度和排行榜全部清空
// 房間裡的事（天氣、釣魚、買賣、聊天、看板）在 room.js。
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room, newPlayer, profileOf, applyProfile, MAX_PLAYERS, TICK, DEV, GRACE } from './room.js';
import { boxPub } from './fishBoxes.js';
import { sendRaw } from './wire.js';
import { Admission, admissionKey } from './admission.js';
import { Daily } from './daily.js';
import { Profiles, epochAt } from './profiles.js';
import { Dexbooks, loadDex } from './dex.js';
import { Guild, syncTitles } from './guild.js';
import { tellMateProps } from './party.js';
import { Activity, parseDevice, clientIp } from './activity.js';
import { prodReport } from './prodStats.js';
import { statsPage } from './statsPage.js';
import { SERVER } from '../src/config.js';
import { refreshRule } from '../src/announce.js';
import { cleanName, isRude } from './words.js';

const PORT = +(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';   // 正式機在 Caddy 後面，只聽本機
const DATA = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), 'data');
const ORIGINS = (process.env.ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);   // 只收這些網站連進來（沒設定就都收）
const MERGE_AFTER = +(process.env.MERGE_AFTER_SEC || 600) * 1000;   // 兩間房都少於 MERGE_BELOW 人多久之後合併
const IDLE_MS = +(process.env.IDLE_SEC || SERVER.idleKickSec) * 1000;   // 連著線卻沒操作多久就請回大廳（0 = 不踢）
const MERGE_COUNT =+(process.env.MERGE_COUNT_SEC || 60);           // 合併前倒數幾秒（客戶端用跑馬燈顯示即時倒數）
const MERGE_BELOW = 5;
const SAVE_EVERY = 10;   // 進度幾秒存一次（有變才寫檔）
const MAX_TOTAL = Math.max(1, +(process.env.MAX_TOTAL_PLAYERS || SERVER.maxPlayers));   // 全服人數上限（SERVER.maxPlayers；環境變數只給測試用）
const HELLO_TIMEOUT = 10000;
const admission = DEV ? null : new Admission();

const hub = {
  rooms: new Map(),       // 房號 → Room
  sessions: new Map(),    // 認人用的代碼 → 玩家（斷線重連時靠它找回來）
  lobby: new Set(),       // 還在大廳裡的連線
  daily: new Daily(DATA),
  profiles: new Profiles(DATA),
  dexbook: new Dexbooks(DATA),   // 圖鑑：跟家當分開存，刷新不清
  guild: new Guild(DATA),        // 漁會：每週捐款榜與稱號（guild.json），刷新不清、每週一重置
  activity: new Activity(DATA, { off: DEV }),  // 玩家活動紀錄（進出、換名、裝置、摘要），給管理網頁看，見 activity.js
  nextId: 1,
  merge: null,            // 正在進行的合併：{ from, to, phase: 'wait' | 'count', left }
  eachRoom(fn) { for (const r of this.rooms.values()) fn(r); },
  // 把這個人現在的進度記下來（存檔在 save 時才寫）
  keep(p) { if (p.owner && p.token) { this.profiles.put(p.token, profileOf(p)); this.dexbook.put(p.token, p.dex); this.activity.sample(p, this.profiles.epoch); } },
  refresh,
};
// 伺服器關著的時候刷新過了：今日紀錄也一起清
if (hub.profiles.stale) { hub.daily.clear(); hub.profiles.save(); console.log('[refresh] 關機期間刷新過了，進度和今日紀錄已清空'); }

const send = (ws, msg) => sendRaw(ws, JSON.stringify(msg));
const totalPlayers = () => { let n = 0; for (const r of hub.rooms.values()) n += r.count; return n; };   // 所有房間的人數（含斷線寬限中的）
const lobbyList = () => ({
  t: 'lobby',
  rooms: [...hub.rooms.values()].sort((a, b) => a.id - b.id).map((r) => ({ id: r.id, name: r.name, n: r.count, max: MAX_PLAYERS, weather: r.weather })),
});

// 常駐房一直開著；隨時保留至少一間沒滿的房：常駐房都滿了才開臨時房，沒人的臨時房關掉（都滿了的話留一間空的）
// 「沒滿」= 人數低於 SERVER.openNextAt（20）：一間房到 20 人就先開下一間備用，原本那間還能擠到 MAX_PLAYERS（30）
function tidyRooms() {
  for (let k = 1; k <= SERVER.fixedRooms; k++) if (!hub.rooms.has(k)) hub.rooms.set(k, new Room(k, hub));
  const rooms = [...hub.rooms.values()].sort((a, b) => a.id - b.id);
  let spare = rooms.some((r) => (r.fixed || r.players.size) && r.count < SERVER.openNextAt);   // 常駐房、或有人的臨時房還沒滿（到 openNextAt 人就算滿）
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
  // 放在外面的魚也跟著搬過去（同一張地圖，位置照舊）；原本就在那間房的人要知道多了這些
  const carried = [...from.loose.values()];
  for (const e of carried) to.loose.set(e.uid, e);
  from.loose.clear();
  if (carried.length) to.all({ t: 'loose', add: carried.map((e) => to.loosePub(e)) });
  // 魚箱也搬過去（主人跟著搬過去，箱子裡的魚還是他的）；送到一半的東西作廢
  const boxes = [...from.boxes.values()];
  for (const bx of boxes) to.boxes.set(bx.bid, bx);
  from.boxes.clear(); from.offers.clear();
  // 問到一半的船隊邀請、拖船請求作廢；拖纜不跟著搬（船隊、副駕在 enter 裡收掉，新房間的整包資料會讓畫面跟著清乾淨）
  for (const a of from.asks.values()) { const t = moving.find((p) => p.id === a.to); if (t && t.ws) to.send(t, { t: 'askGone', aid: a.aid }); }
  from.asks.clear(); from.tows = [];
  const moved = new Map();
  for (const p of moving) moved.set(p, to.enter(p, { fresh: false, quiet: true }));
  if (boxes.length) to.all({ t: 'box', add: boxes.map((bx) => boxPub(to, bx)) });
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
    const ready = [...hub.rooms.values()].filter((r) => r.lowSince && now - r.lowSince >= MERGE_AFTER
      && ![...r.players.values()].some((p) => p.left));
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
  // 保留已離開船主的船直到寬限期結束，避免合併提早收船。
  if ([...from.players.values()].some((p) => p.left)) return cancelMerge('等離線的船回收後再合併');
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
    from.all({ t: 'merge', phase: 'count', move: true, sec: m.left, text: `這間房人比較少，將合併到${to.name}（位置、船和錢都會保留）` });
    to.all({ t: 'merge', phase: 'count', sec: m.left, text: `${from.name}的玩家將合併進來` });
    return;
  }
  m.left--;
  if (m.left <= 0) doMerge();
}

// ---- 連線 -------------------------------------------------------------------
// ---- 管理：全服跑馬燈公告、倒數強制重開（用 deploy/announce.sh 在伺服器本機呼叫）----
// 只收本機 CLI 的 POST。拒絕 Caddy 轉發、跨站表單及瀏覽器發出的請求。
let notice = null, noticeTimer = null;   // notice：{ text, restartAt（毫秒時間戳，0 = 不重開） }
const noticeMsg = () => JSON.stringify({ t: 'notice', text: notice ? notice.text : '', left: notice && notice.restartAt ? Math.max(0, Math.ceil((notice.restartAt - Date.now()) / 1000)) : -1 });
function setNotice(text, restartSec) {
  clearTimeout(noticeTimer);
  notice = text || restartSec > 0 ? { text, restartAt: restartSec > 0 ? Date.now() + restartSec * 1000 : 0 } : null;
  if (notice && notice.restartAt) noticeTimer = setTimeout(() => { console.log('[admin] 倒數結束，存檔後重開'); stop(); }, restartSec * 1000);   // 存檔後結束；systemd 會馬上重開，玩家斷線後自動接回
  const raw = noticeMsg();
  for (const ws of wss.clients) sendRaw(ws, raw);
}
function admin(req, res, url) {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
  const reply = (code, text) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(`${text}\n`); };
  if (!local) return reply(403, 'forbidden');
  const hostOk = ['127.0.0.1', 'localhost', '[::1]'].includes(req.headers.host?.replace(/:\d+$/, ''));
  // 玩家活動統計：只讀的 GET，用瀏覽器直接開（在本機，或用 deploy/stats.sh 從伺服器抓回來）。
  // 同樣只收本機、Host 要是本機（擋 DNS 重綁），並拒絕別的網站帶著跨站請求來讀
  if (req.method === 'GET' && (url.pathname === '/admin/stats' || url.pathname === '/admin/stats.json')) {
    const site = req.headers['sec-fetch-site'];
    if (!hostOk || req.headers.origin || (site && !['none', 'same-origin'].includes(site))) return reply(403, 'forbidden');
    const json = url.pathname.endsWith('.json');
    const send = (report) => {
      res.writeHead(200, {
        'content-type': json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
      });
      res.end(json ? JSON.stringify(report) : statsPage(report));
    };
    // 測試伺服器不記自己的玩家，這頁改向正式機要資料（prodStats.js）；正式機自己回自己的
    if (DEV) prodReport().then(send, (err) => reply(502, `向正式機要統計失敗：${err.message}
（要這台電腦的 gcloud 已登入；或改用 bash deploy/stats.sh）`));
    else send(hub.activity.report());
    return;
  }
  if (req.headers.origin || req.headers['sec-fetch-site']
    || !['127.0.0.1', 'localhost', '[::1]'].includes(req.headers.host?.replace(/:\d+$/, ''))) return reply(403, 'forbidden');
  if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return reply(405, 'method not allowed'); }
  if (url.pathname === '/admin/notice') {
    const text = (url.searchParams.get('text') || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
    const restart = Math.min(Math.max(Math.floor(+url.searchParams.get('restart') || 0), 0), 3600);
    if (!text && !restart) return reply(400, '要有 text 或 restart（秒）');
    setNotice(text, restart);
    return reply(200, `已發出：「${text}」${restart ? `，${restart} 秒後重開` : ''}（線上 ${wss.clients.size} 人）`);
  }
  if (url.pathname === '/admin/clear') { setNotice('', 0); return reply(200, '已取消公告和重開倒數'); }
  return reply(404, 'not found');
}
const http = createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); res.end(); return; }
  if (url.pathname.startsWith('/admin/')) return admin(req, res, url);
  let n = 0;
  hub.eachRoom((r) => { n += r.active; });
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`Stormcast 伺服器運作中：${hub.rooms.size} 間房、線上 ${n} 人\n`);
});
const wss = new WebSocketServer({
  server: http, maxPayload: 16 * 1024,
  path: DEV ? undefined : '/',
  verifyClient: ({ origin, req }, done) => {
    if (ORIGINS.length && !ORIGINS.includes(origin)) return done(false, 401);
    const code = admission?.upgrade(admissionKey(clientIp(req))) || 0;
    done(code === 0, code);
  },
});

wss.on('connection', (ws, req) => {
  ws.on('error', () => {});
  const meta = { ip: clientIp(req), dev: parseDevice(req.headers['user-agent'], req.headers['sec-ch-ua-mobile']) };   // 活動紀錄用
  const key = admission && admissionKey(meta.ip);
  if (admission) ws.once('close', admission.opened(key));
  const helloTimer = setTimeout(() => ws.terminate(), HELLO_TIMEOUT).unref();
  ws.once('close', () => clearTimeout(helloTimer));
  sendRaw(ws, noticeMsg());   // 新連線：現在有公告就帶上
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  let me = null;        // 進房之後才有
  let name = '', token = '', look = 'girl';   // look：選的角色（只收得到 girl／boy）
  let burstAt = 0, burst = 0;

  // 這個代碼的人還在某間房裡：接回那間房、那一局
  const resume = (now) => {
    const old = token && hub.sessions.get(token);
    if (!old || !old.room || old.left) return false;
    if (old.gone && now - old.gone >= GRACE) { old.room.remove(old); return false; }
    if (old.ws) { send(old.ws, { t: 'kicked', msg: '你在另一個視窗進入了遊戲' }); const w = old.ws; old.ws = null; w.close(); old.room.all({ t: 'leave', id: old.id }); }
    me = old;
    me.ws = ws; me.gone = 0; me.name = name; me.look = look;   // 重新整理後可能換了角色
    if (me.actAt) me.actAt = now;                              // 斷線接回來：閒置時間重算
    hub.lobby.delete(ws);
    const r = me.room;
    r.send(me, { t: 'joined', resume: r.resumeData(me), ...r.snapshot(me) });
    hub.guild.rename(me.token, me.name);   // 接回來時可能改了名字：捐贈榜上的名字跟著換
    r.tellJoin(me, true);                   // 稱號、等級要一起帶，不然別人看他的名牌會變空的
    tellMateProps(r, me);                   // 隊友放在外面的桶子（畫面那邊重連時整個清掉了）
    // 斷線時遇到定時刷新：畫面上的船、魚還是舊的，整包重置再送一次
    if (me.resetMsg) { r.send(me, { t: 'reset', text: me.resetMsg, kit: me.kit, berth: r.berthInfo(me), boards: r.boards() }); me.resetMsg = null; }
    hub.activity.back(me, meta, r.name);
    console.log(`[back] ${name} 回到 ${r.name}`);
    return true;
  };

  ws.on('message', (raw) => {
    // 一秒超過 80 則訊息就中止連線。
    if (ws.readyState !== 1) return;
    const now = Date.now();
    if (now - burstAt > 1000) { burstAt = now; burst = 0; }
    if (++burst > 80) { ws.terminate(); return; }
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (me && me.ws !== ws) return;
    if (m.t === 'ping') {
      if (Number.isFinite(m.k)) send(ws, { t: 'pong', k: m.k });
      return;
    }

    if (me) {
      if (m.t === 'leave') { const r = me.room, p = me; r.quit(me); hub.activity.end(p, 'leave'); me = null; ws.close(); tidyRooms(); return; }
      if (me.room) {
        try { me.room.on(me, m); } catch (err) {
          console.error('[message] handler failed', err);
          ws.close(1011, 'message handling failed');
        }
      }
      return;
    }

    if (m.t === 'hello') {
      name = cleanName(m.name);
      look = m.look === 'boy' ? 'boy' : 'girl';
      if (!name) return send(ws, { t: 'denied', msg: '請先填好名字' });
      if (isRude(name)) { name = ''; return send(ws, { t: 'denied', msg: '這個名字不能用，換一個吧' }); }
      clearTimeout(helloTimer);
      token = typeof m.token === 'string' && /^[0-9a-f]{32}$/.test(m.token) ? m.token : '';
      if (resume(now)) return;
      hub.lobby.add(ws);
      return send(ws, { ...lobbyList(), name });
    }

    if (m.t === 'devRoom' && DEV && hub.rooms.size < 16) {   // 測試用：多開一間房
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
      if (!r) return send(ws, { ...lobbyList(), t: 'full', msg: '這間房已經關了，挑別間吧' });
      if (r.count >= MAX_PLAYERS) return send(ws, { ...lobbyList(), t: 'full', msg: '這間房滿了，挑別間吧' });
      if (hub.merge && hub.merge.from === r) return send(ws, { ...lobbyList(), t: 'full', msg: '這間房正要合併到別間，挑別間吧' });
      if (resume(now)) return;   // 同一台裝置在別的視窗已經在房裡了：接過來
      if (totalPlayers() >= MAX_TOTAL) return send(ws, { t: 'denied', msg: '伺服器人數已滿，請稍後再試' });   // 全服上限：新玩家擋在大廳，已在房裡的人不受影響
      if (!hub.profiles.raw.has(token) && !hub.dexbook.raw.has(token)) {
        if (admission && !admission.guest(key)) return send(ws, { t: 'denied', msg: '目前新增訪客較多，請稍後再試' });
        token = randomBytes(16).toString('hex');
      }
      me = newPlayer(hub.nextId++, ws, token, name, look);
      const prof = hub.profiles.get(token);
      if (prof) applyProfile(me, prof);
      me.dex = loadDex(hub.dexbook.get(token));
      hub.sessions.set(token, me);
      hub.lobby.delete(ws);
      hub.activity.begin(me, meta, r.name);
      r.enter(me);
      // 有存著的進度：家當、倉庫裡的船、還沒賣的魚還給他，人從港口出發、船停在分到的格子
      const back = prof && r.resumeData(me);
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
    hub.activity.drop(me);
    me.room.drop(me);
  });
});

// ---- 閒置 -------------------------------------------------------------------
// 連著線、客戶端也回報過操作，但 IDLE_MS 沒再收到：照「按了離開」處理（進度存檔、船位收走），畫面跳出說明
function idleKick(p) {
  const r = p.room, ws = p.ws;
  console.log(`[idle] ${p.name} 閒置超過 ${Math.round(IDLE_MS / 1000)} 秒，請回大廳（${r.name}）`);
  send(ws, { t: 'kicked', msg: `你已經超過 ${Math.round(IDLE_MS / 60000)} 分鐘沒有操作，先請你離開房間（錢、船、裝備和魚都存著，重新進房就好）` });
  r.quit(p);
  hub.activity.end(p, 'idle');
  ws.close();
  tidyRooms();
}

// ---- 時鐘 -------------------------------------------------------------------
let n = 0;
setInterval(() => {
  const now = Date.now();
  n++;
  for (const r of hub.rooms.values()) r.step(now);
  if (n % 10 === 0) {
    mergeStep(now); tidyRooms();
    if (IDLE_MS > 0) hub.eachRoom((r) => { for (const p of [...r.players.values()]) if (p.ws && p.actAt && !p.left && now - p.actAt > IDLE_MS) idleKick(p); });
  }
  if (n % 20 === 0 && hub.lobby.size) { const raw = JSON.stringify(lobbyList()); for (const ws of hub.lobby) sendRaw(ws, raw); }
  if (n % 300 === 0) for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;
    if (!ws.alive) ws.terminate();
    else { ws.alive = false; ws.ping(); }
  }
  if (n % 10 === 0 && epochAt(now) > hub.profiles.epoch) refresh(false);
  if (n % (SAVE_EVERY * 10) === 0) {
    hub.eachRoom((r) => { for (const p of r.players.values()) hub.keep(p); });
    hub.profiles.save();
    hub.dexbook.save();
    hub.guild.save();
    hub.activity.save();
  }
  // 每週一次（GUILD 設的那一天那個鐘點）：漁會捐贈榜清空，稱號跟著收回
  if (n % 100 === 0 && hub.guild.roll(now)) {
    syncTitles(hub);
    hub.eachRoom((r) => { r.all(r.boards()); r.sys('📜 新的一週開始了：漁會捐贈榜重新計算，上週的稱號已收回', 'record'); for (const p of r.players.values()) r.on(p, { t: 'guild' }); });
    hub.guild.save();
  }
  if (n % 600 === 0) {
    if (hub.daily.roll()) hub.eachRoom((r) => r.all(r.boards()));   // 午夜：今日紀錄清空
    hub.daily.save();
    let online = 0;
    hub.eachRoom((r) => { online += r.active; });
    hub.activity.tick(online);   // 記線上人數、刪掉超過保留天數的紀錄
  }
}, TICK * 1000);

// ---- 定時刷新 -----------------------------------------------------------------
// 定時（SERVER.refresh）：所有人的錢、船、裝備、還沒賣的魚和兩塊排行榜都清空；在線上的人直接變回新玩家、送回港口
function refresh(test) {
  if (!test) hub.profiles.epoch = epochAt();
  hub.profiles.clear(hub.profiles.epoch);
  hub.daily.clear();
  const text = `${test ? '（測試）' : ''}刷新時間到了（${refreshRule()}）：錢、船、裝備、還沒賣的魚和排行榜都清空（圖鑑會留著），大家從港口重新開始`;
  let k = 0;
  hub.eachRoom((r) => {
    r.board = [];
    for (const p of r.players.values()) if (!p.left) { r.reset(p, text); hub.keep(p); k++; }
    r.all(r.boards());
  });
  hub.profiles.save();
  hub.dexbook.save();
  console.log(`[refresh] ${test ? '（測試）' : ''}刷新：重置了 ${k} 人（第 ${hub.profiles.epoch} 期）`);
}

const stop = () => { hub.eachRoom((r) => { for (const p of r.players.values()) hub.keep(p); }); hub.profiles.save(); hub.dexbook.save(); hub.guild.save(); hub.daily.save(); hub.activity.stopAll(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
http.listen(PORT, HOST, () => console.log(`Stormcast 伺服器：ws://${HOST}:${PORT}　今日紀錄、進度存在 ${DATA}`));
