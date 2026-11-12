// 伺服器的冒煙測試：自己開一台伺服器，用幾個假玩家把主要流程走一遍。
//   node server/test/smoke.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8799, data = mkdtempSync(join(tmpdir(), 'stormcast-'));
const srv = spawn(process.execPath, [join(here, '..', 'index.js')], {
  env: { ...process.env, PORT, STORMCAST_DEV: '1', GRACE_SEC: '2', MERGE_AFTER_SEC: '2', MERGE_COUNT_SEC: '2', DATA_DIR: data },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let log = '';
srv.stdout.on('data', (d) => { log += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (cond, what) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${what}`); if (!cond) failed++; };

class Bot {
  constructor(name) { this.name = name; this.got = []; this.waiters = []; }
  async open(token = '') {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      this.got.push(m);
      this.waiters = this.waiters.filter((w) => !(w.test(m) && (w.done(m), true)));
    });
    await new Promise((r, j) => { this.ws.on('open', r); this.ws.on('error', j); });
    this.send({ t: 'hello', name: this.name, token });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  // 等一則符合條件的訊息（已經收到過的不算）
  wait(test, ms = 15000) {
    const f = typeof test === 'string' ? (m) => m.t === test : test;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`${this.name} 等不到 ${test}`)), ms);
      this.waiters.push({ test: f, done: (m) => { clearTimeout(timer); res(m); } });
    });
  }
  async join(room) { const w = this.wait('joined'); this.send({ t: 'join', room }); this.me = await w; return this.me; }
  pos(x, z, boat = 0) { this.send({ t: 'p', s: [x, 1.3, z, 0, 0, 0, 0, 0, boat, 0, 0, '', ''] }); }
  close() { this.ws.close(); }
}

try {
  await sleep(1500);
  // ---- 大廳、名字 ----
  const a = new Bot('小明');
  let w = a.wait('lobby');
  await a.open();
  const lobby = await w;
  ok(lobby.rooms.length === 1 && lobby.rooms[0].name === '1 號港' && lobby.rooms[0].n === 0, '大廳有一間空的 1 號港');
  const bad = new Bot('幹 你 娘');
  w = bad.wait('denied');
  await bad.open();
  ok((await w).msg.includes('不能用'), '髒話名字被拒絕');
  bad.close();

  // ---- 進房 ----
  const ja = await a.join(1);
  ok(ja.kit.money === 0 && ja.kit.active === 'skiff' && ja.berth.label === 'A-1' && ja.players.length === 0, '進房：錢 0、小舢舨、停船格 A-1');
  const b = new Bot('阿華');
  await b.open();
  const wj = a.wait('join'), ws1 = a.wait((m) => m.t === 'sys' && m.kind === 'join');
  const jb = await b.join(1);
  ok(jb.players.length === 1 && jb.players[0].name === '小明' && jb.players[0].boat.type === 'skiff' && jb.berth.label === 'A-2', '第二個人看得到第一個人和他的船，停在 A-2');
  ok((await wj).name === '阿華' && (await ws1).text === '阿華 加入了房間', '房裡的人收到加入通知');

  // ---- 位置同步 ----
  const wk = b.wait((m) => m.t === 'k' && m.p.some((e) => e[0] === ja.id));
  a.pos(-6, 114);
  const k = await wk;
  ok(k.p.find((e) => e[0] === ja.id)[1] === -6, '位置轉送給同房的人');
  ok((await b.wait('world', 3000)).climate.hour >= 8, '收到時間與天氣');

  // ---- 釣魚 ----
  w = a.wait('fishNo');
  a.send({ t: 'cast', x: -6, z: 500 });
  await w;
  ok(true, '拋到搆不到的地方：不認');
  w = a.wait('fishNo');
  a.send({ t: 'cast', x: -6, z: 110 });
  await w;
  ok(true, '拋到岸上：不認');
  w = a.wait('bite');
  a.send({ t: 'cast', x: -12, z: 128 });
  await w;
  w = a.wait('fight');
  a.send({ t: 'hook' });
  const fight = await w;
  ok(fight.fish.id && fight.fish.kg > 0 && fight.fish.strength > 0, `上鉤：${fight.fish.id} ${fight.fish.kg}kg`);
  w = a.wait('fishNo');
  a.send({ t: 'land' });
  await w;
  ok(true, '馬上說釣起來了：不認（收線時間太短）');
  w = a.wait('bite');
  a.send({ t: 'cast', x: -12, z: 128 });
  await w;
  w = a.wait('fight');
  a.send({ t: 'hook' });
  const f2 = (await w).fish;
  await sleep(1000 * 0.7 / (0.2 / (0.7 + 0.5 * f2.strength)) + 200);
  w = a.wait('caught');
  const wrec = b.wait((m) => m.t === 'sys' && m.kind === 'record'), wboard = b.wait('boards');
  a.send({ t: 'land' });
  const caught = (await w).fish;
  const MULT = { sardine: 0.3, mackerel: 0.3, bream: 0.4, squid: 0.75, hairtail: 0.62 };
  ok(caught.uid > 0 && caught.value === Math.max(1, Math.round(100 * caught.kg * MULT[caught.id])), `釣起來了：${caught.id} ${caught.kg}kg 值 $${caught.value}（每公斤 100 × 倍率 × 重量）`);
  const rec = await wrec;
  ok(rec.text.includes('登上本房紀錄第 1 名') && rec.text.includes('也登上今日紀錄第 1 名'), `上榜通知：${rec.text}`);
  const bd = await wboard;
  ok(bd.room.length === 1 && bd.daily.length === 1 && bd.room[0].name === '小明', '兩塊看板都有這條魚');

  // ---- 賣魚 ----
  a.pos(-6, 114);
  await sleep(150);
  w = a.wait('no');
  a.send({ t: 'sell', uids: [caught.uid] });
  await w;
  ok(true, '離籃子太遠：不能賣');
  a.pos(8, 113);
  await sleep(150);
  w = a.wait('sold');
  a.send({ t: 'sell', uids: [caught.uid, caught.uid, 999999] });
  const sold = await w;
  ok(sold.total === caught.value && sold.kit.money === caught.value, '賣出：只算自己真的有的魚，同一條不會算兩次');
  w = a.wait('sold');
  a.send({ t: 'sell', uids: [caught.uid] });
  ok((await w).total === 0, '賣過的魚不能再賣');

  // ---- 買東西、換船 ----
  a.pos(-3.35, 107.7);
  await sleep(150);
  w = a.wait('no');
  a.send({ t: 'buy', id: 'fisher' });
  ok((await w).msg === '錢不夠', '錢不夠買不了漁船');
  w = a.wait('kit');
  a.send({ t: 'dev', cmd: 'money', n: 5000 });
  await w;
  w = a.wait('bought');
  a.send({ t: 'buy', id: 'fisher' });
  const bought = await w;
  ok(bought.price === 700 && bought.kit.boats.fisher && bought.kit.active === 'skiff', '買了漁船（收在倉庫，世界裡還是小舢舨）');
  w = a.wait('no');
  a.send({ t: 'swap', type: 'fisher' });
  ok((await w).msg.includes('停船位置牌'), '不在停船位置牌前不能換船');
  a.pos(9.5, 113.2);
  await sleep(150);
  w = a.wait('swapped');
  const wboat = b.wait('boat');
  a.send({ t: 'swap', type: 'fisher' });
  const sw = await w;
  ok(sw.kit.active === 'fisher' && sw.berth.label === '堤-1', `換成漁船，停到 ${sw.berth.label}`);
  ok((await wboat).boat.type === 'fisher', '別人看到他換船了');
  a.pos(-8.3, 107.7);
  await sleep(150);
  w = a.wait('bought');
  a.send({ t: 'buy', id: 'rod' });
  ok((await w).kit.rodLv === 1, '釣竿升到第 1 級');

  // ---- 聊天 ----
  w = b.wait('chat');
  a.send({ t: 'chat', text: '大家好 fuck 你好' });
  const chat = await w;
  ok(chat.name === '小明' && !chat.text.includes('fuck') && chat.text.includes('大家好'), `聊天（髒話遮掉）：${chat.text}`);
  w = a.wait((m) => m.t === 'sys' && m.kind === 'warn');
  for (let i = 0; i < 6; i++) a.send({ t: 'chat', text: `洗版 ${i}` });
  await w;
  ok(true, '洗版被擋下來');

  // ---- 斷線重連 ----
  let wl = b.wait('leave');
  a.close();
  await wl;
  const a2 = new Bot('小明');
  w = a2.wait('joined');
  await a2.open(ja.token);
  const back = await w;
  ok(back.resume && back.kit.money === sold.total + 5000 - 700 - 120 && back.kit.active === 'fisher' && back.kit.rodLv === 1 && back.id === ja.id, '斷線後馬上回來：接回原本的錢、釣竿和船');
  wl = b.wait('boatGone', 6000);
  a2.close();
  await wl;
  const a3 = new Bot('小明');
  w = a3.wait('lobby');
  await a3.open(ja.token);
  await w;
  ok(true, '超過時間才回來：船被收走，回到大廳從頭開始');

  // ---- 合併 ----
  w = a3.wait('lobby');
  a3.send({ t: 'devRoom' });
  ok((await w).rooms.length === 2, '（測試）多開一間 2 號港');
  const j3 = await a3.join(2);
  ok(j3.room.name === '2 號港' && j3.kit.money === 0, '進 2 號港，進度是全新的');
  a3.pos(100, 300);
  const wm = a3.wait('merged', 20000), wsys = b.wait((m) => m.t === 'sys' && m.kind === 'merge', 20000), wcount = a3.wait((m) => m.t === 'merge' && m.phase === 'count', 20000);
  ok((await wcount).text.includes('合併到1 號港'), '兩間房人都很少：先通知、倒數');
  const merged = await wm;
  ok(merged.room.name === '1 號港' && merged.players.some((p) => p.name === '阿華') && merged.id === j3.id, '2 號港的人被搬進 1 號港，身分不變');
  ok((await wsys).text === '2 號港的玩家合併進來了', '1 號港的人看到一行通知');
  ok(merged.berth.label !== jb.berth.label, `停船格不會跟原本房裡的人撞在一起（${merged.berth.label} / ${jb.berth.label}）`);
  await sleep(1500);
  const lb = new Bot('路人');
  w = lb.wait('lobby');
  await lb.open();
  const l2 = await w;
  ok(l2.rooms.length === 1 && l2.rooms[0].n === 2, '合併後只剩一間房、2 個人');

  // ---- 離開 ----
  wl = b.wait('leave');
  a3.send({ t: 'leave' });
  await wl;
  ok(true, '按離開：別人看到他走了');
  for (const x of [b, lb]) x.close();
} catch (e) {
  console.error(' FAIL ', e.message);
  failed++;
} finally {
  srv.kill();
  await sleep(200);
  console.log(failed ? `\n${failed} 項沒過\n--- 伺服器輸出 ---\n${log}` : '\n全部通過');
  process.exit(failed ? 1 : 0);
}
