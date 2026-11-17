// 伺服器壓力測試：用假玩家一階一階灌進本機的測試伺服器（node server/dev.js），量節拍延遲、流量、CPU、記憶體。
//   node tools/loadtest.js --pid <伺服器 pid> [--url ws://localhost:8787] [--steps 30,60,100,150,200,300] [--hold 60] [--workers 6]
// 只准連本機的測試伺服器（DEV 模式沒有連線限額；正式機有，也不該拿來灌）。
// 假玩家做的事：走路（每 0.1 秒送一次位置，跟瀏覽器一樣）、偶爾講話、每 2 秒送一個 ping 量來回時間。
// 沒做的事：拋竿、釣魚、買賣、魚箱、開船——所以真玩家的負擔會比這個重一些。
// 自動煞車：整台電腦 CPU 超過 85%（假玩家與伺服器都在同一台）、伺服器吃滿一顆 CPU、伺服器記憶體超過 2GB、整台機器剩餘記憶體低於 700MB、
// 或來回時間 p95 超過 250 毫秒，就停止往上加並收掉所有假玩家。
import { fork, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { writeFileSync, readFileSync } from 'node:fs';
import WebSocket from '../server/node_modules/ws/wrapper.mjs';
import { SPAWN_W } from '../src/layout.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ROLE = process.env.LT_ROLE || 'main';
const URL = arg('url', 'ws://localhost:8787');
const OPEN_AT = 20;

// ---------------------------------------------------------------- 工人：每個程序管一批假玩家
if (ROLE === 'worker') {
  const wid = +process.env.LT_ID;
  const bots = new Map();   // idx → bot
  const st = { bytes: 0, msgs: 0, rtt: [], denied: 0, closed: 0, errors: 0 };
  let target = 0, nextIdx = 0, stopping = false;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function spawn() {
    const idx = wid * 100000 + nextIdx++;
    const b = { idx, ws: null, joined: false, x: SPAWN_W.x + rnd(-3, 3), z: SPAWN_W.z + rnd(-3, 3), yaw: rnd(0, 6.28), k: 0, sent: new Map(), timers: [] };
    bots.set(idx, b);
    const ws = new WebSocket(URL, { origin: undefined });
    b.ws = ws;
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'Bot' + String(idx).padStart(4, '0'), look: Math.random() < 0.5 ? 'girl' : 'boy', token: '' })));
    ws.on('message', (raw) => {
      const s = raw.toString();
      st.bytes += s.length; st.msgs++;
      if (s.startsWith('{"t":"pong"')) { const m = JSON.parse(s); const t0 = b.sent.get(m.k); if (t0) { st.rtt.push(Date.now() - t0); b.sent.delete(m.k); } return; }
      if (s.startsWith('{"t":"lobby"') && !b.joined && !b.joining) {
        const m = JSON.parse(s);
        const room = m.rooms.find((r) => r.n < OPEN_AT && r.n < r.max) || m.rooms.find((r) => r.n < r.max) || m.rooms[m.rooms.length - 1];
        b.joining = true;
        ws.send(JSON.stringify({ t: 'join', room: room.id }));
      } else if (s.startsWith('{"t":"joined"')) {
        b.joined = true; start(b);
      } else if (s.startsWith('{"t":"full"') || s.startsWith('{"t":"denied"')) {
        st.denied++; b.joining = false;
        setTimeout(() => { if (!stopping && ws.readyState === 1) ws.send(JSON.stringify({ t: 'hello', name: 'Bot' + String(idx).padStart(4, '0'), look: 'girl', token: '' })); }, 1000);
      }
    });
    ws.on('close', () => { st.closed++; for (const t of b.timers) clearInterval(t); bots.delete(idx); });
    ws.on('error', () => { st.errors++; });
  }

  function start(b) {
    let moving = true, run = false, turnAt = 0;
    // 位置：每 0.1 秒一次，在出生點附近隨機走動
    b.timers.push(setInterval(() => {
      if (b.ws.readyState !== 1) return;
      if (Date.now() > turnAt) { b.yaw = rnd(0, 6.28); moving = Math.random() < 0.8; run = Math.random() < 0.3; turnAt = Date.now() + rnd(1500, 5000); }
      if (moving) {
        const v = run ? 5 : 2.2;
        b.x += Math.cos(b.yaw) * v * 0.1; b.z += Math.sin(b.yaw) * v * 0.1;
        if (Math.hypot(b.x - SPAWN_W.x, b.z - SPAWN_W.z) > 8) b.yaw = Math.atan2(SPAWN_W.z - b.z, SPAWN_W.x - b.x);
      }
      const s = [Math.round(b.x * 100) / 100, 1, Math.round(b.z * 100) / 100, Math.round(b.yaw * 1000) / 1000, moving ? (run ? 3 : 1) : 0, 0, 0, 0, 0, 0, 0, '', ''];
      b.ws.send(JSON.stringify({ t: 'p', s }));
    }, 100));
    b.timers.push(setInterval(() => {
      if (b.ws.readyState !== 1) return;
      const k = ++b.k; b.sent.set(k, Date.now()); if (b.sent.size > 5) b.sent.delete(b.sent.keys().next().value);
      b.ws.send(JSON.stringify({ t: 'ping', k }));
    }, 2000));
    b.timers.push(setInterval(() => { if (b.ws.readyState === 1) b.ws.send(JSON.stringify({ t: 'chat', text: '壓測 ' + b.idx })); }, rnd(25000, 45000)));
  }

  // 調整到目標人數：每秒最多加 10 個（像真人陸續進來），要減就一次關掉
  setInterval(() => {
    if (stopping) return;
    const n = bots.size;
    if (n < target) for (let i = 0; i < Math.min(10, target - n); i++) spawn();
    else if (n > target) { let c = n - target; for (const b of bots.values()) { if (c-- <= 0) break; b.ws.close(); } }
  }, 1000);
  setInterval(() => {
    const joined = [...bots.values()].filter((b) => b.joined).length;
    process.send({ stat: { joined, total: bots.size, bytes: st.bytes, msgs: st.msgs, rtt: st.rtt.splice(0), denied: st.denied, closed: st.closed, errors: st.errors } });
    st.bytes = 0; st.msgs = 0;
  }, 1000);
  process.on('message', (m) => {
    if (m.target !== undefined) target = m.target;
    if (m.stop) { stopping = true; for (const b of bots.values()) b.ws.close(); setTimeout(() => process.exit(0), 1500); }
  });
} else {
  // ---------------------------------------------------------------- 主控：分階段加人、量數字、判斷煞車
  const pid = +arg('pid', 0);
  const steps = arg('steps', '30,60,100,150,200,300').split(',').map(Number);
  const HOLD = +arg('hold', 60), W = +arg('workers', 6), OUT = arg('out', 'loadtest-result.json');
  if (!pid) { console.error('要給 --pid（測試伺服器的程序編號）'); process.exit(1); }
  if (!/^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(URL)) { console.error('只准連本機的測試伺服器'); process.exit(1); }

  const workers = [];
  const agg = { joined: 0, total: 0, rtt: [], bytes: 0, msgs: 0, denied: 0, closed: 0, errors: 0 };
  const per = new Array(W).fill(null);
  for (let i = 0; i < W; i++) {
    const w = fork(fileURLToPath(import.meta.url), process.argv.slice(2), { env: { ...process.env, LT_ROLE: 'worker', LT_ID: String(i) } });
    w.on('message', (m) => {
      if (!m.stat) return;
      per[i] = m.stat;
      agg.rtt.push(...m.stat.rtt); agg.bytes += m.stat.bytes; agg.msgs += m.stat.msgs;
    });
    workers.push(w);
  }
  const setTarget = (n) => workers.forEach((w, i) => w.send({ target: Math.floor(n / W) + (i < n % W ? 1 : 0) }));
  const sum = (k) => per.reduce((a, s) => a + (s ? s[k] : 0), 0);

  // 取樣：伺服器程序的 CPU 秒數與記憶體、整台電腦的 CPU
  const psSample = () => {
    try {
      if (process.platform === 'linux') {   // 正式機（Linux）：讀 /proc
        const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');   // 括號後第 12、13 欄是 utime、stime（每秒 100 刻）
        const rss = +readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1] * 4096;
        return { cpu: (+f[11] + +f[12]) / 100, rss, at: Date.now() };
      }
      const o = execFileSync('powershell', ['-NoProfile', '-Command', `$p=Get-Process -Id ${pid}; "$($p.CPU) $($p.WorkingSet64)"`], { encoding: 'utf8', timeout: 8000 }).trim().split(' ');
      return { cpu: +o[0], rss: +o[1], at: Date.now() };
    } catch { return null; }
  };
  // 整台機器還剩多少記憶體（只有 Linux 讀得到；正式機上要確保不把瓦爾海姆和系統擠死）
  const memAvailMB = () => { try { return Math.round(+readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/)[1] / 1024); } catch { return null; } };
  const sysTimes = () => { let idle = 0, total = 0; for (const c of cpus()) { for (const v of Object.values(c.times)) total += v; idle += c.times.idle; } return { idle, total }; };
  const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const status = async () => { try { const r = await fetch(URL.replace('ws', 'http') + '/status'); return await r.text(); } catch { return ''; } };

  const results = [];
  let brake = '';
  console.log(`開始：階段 ${steps.join(' → ')} 人，每階 ${HOLD} 秒，${W} 個假玩家程序，伺服器 pid ${pid}`);
  for (const N of steps) {
    setTarget(N);
    console.log(`\n>>> 現在要加到 ${N} 人（${new Date().toLocaleTimeString()}）`);
    // 等人到齊（最多 N/8 + 30 秒），再維持 HOLD 秒量測
    const t0 = Date.now();
    while (sum('joined') < N * 0.98 && Date.now() - t0 < (N / 8 + 30) * 1000) await sleep(1000);
    console.log(`    到了 ${sum('joined')}/${N} 人，開始量 ${HOLD} 秒`);
    agg.rtt = []; agg.bytes = 0; agg.msgs = 0;
    const s0 = psSample(), y0 = sysTimes(), tStart = Date.now();
    let hot = 0, maxSys = 0;
    for (let i = 0; i < HOLD && !brake; i++) {
      await sleep(1000);
      if (i % 5 === 4) {
        const y = sysTimes(), busy = 1 - (y.idle - y0.idle) / (y.total - y0.total);
        maxSys = Math.max(maxSys, busy);
      }
    }
    const s1 = psSample(), y1 = sysTimes(), secs = (Date.now() - tStart) / 1000;
    const sysBusy = 1 - (y1.idle - y0.idle) / (y1.total - y0.total);
    const rec = {
      bots: N, joined: sum('joined'), rooms: (await status()).match(/(\d+) 間房/)?.[1] || '?',
      serverCores: s0 && s1 ? +(((s1.cpu - s0.cpu) / secs)).toFixed(2) : null, serverRssMB: s1 ? Math.round(s1.rss / 1048576) : null,
      systemCpuPct: Math.round(sysBusy * 100), memAvailMB: memAvailMB(), rttP50: pct(agg.rtt, 0.5), rttP95: pct(agg.rtt, 0.95), rttP99: pct(agg.rtt, 0.99), rttMax: Math.max(0, ...agg.rtt),
      outKBps: Math.round(agg.bytes / secs / 1024), msgsPerSec: Math.round(agg.msgs / secs), denied: sum('denied'), closed: sum('closed'), errors: sum('errors'),
    };
    results.push(rec);
    console.log('    結果', JSON.stringify(rec));
    writeFileSync(OUT, JSON.stringify(results, null, 2));
    if (rec.systemCpuPct > 85) brake = `整台電腦 CPU ${rec.systemCpuPct}%：假玩家與伺服器搶同一台電腦，再加下去量到的不是伺服器的極限`;
    else if (rec.serverCores !== null && rec.serverCores > 0.9) brake = `伺服器程序吃滿一顆 CPU（${rec.serverCores} 核）：單執行緒到頂了`;
    else if (rec.memAvailMB !== null && rec.memAvailMB < 700) brake = `整台機器剩餘記憶體只剩 ${rec.memAvailMB} MB：再加會擠到其他服務`;
    else if (rec.serverRssMB > 2048) brake = `伺服器記憶體 ${rec.serverRssMB} MB 超過 2 GB`;
    else if (rec.rttP95 > 250) brake = `來回時間 p95 ${rec.rttP95} 毫秒超過 250`;
    else if (rec.joined < N * 0.95) brake = `只進得去 ${rec.joined}/${N} 人`;
    if (brake) break;
  }
  console.log(brake ? `\n*** 煞車：${brake}` : '\n*** 全部階段跑完，沒有撞到停止條件');
  workers.forEach((w) => w.send({ stop: true }));
  await sleep(2500);
  console.log('已收掉所有假玩家。結果存在', OUT);
  process.exit(0);
}
