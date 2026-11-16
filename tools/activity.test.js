import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Activity, parseDevice, clientIp, pidOf, dayOf, KEEP_DAYS } from '../server/activity.js';
import { statsPage } from '../server/statsPage.js';
import { newKit } from '../src/boatdata.js';

const T0 = Date.parse('2026-11-16T04:00:00Z');   // 台灣 12:00
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'stormcast-act-'));
  const clock = { t: T0 };
  const act = new Activity(dir, { now: () => clock.t });
  const player = (token, name) => ({ token, name, kit: newKit(), dex: {}, room: { name: '1 號港' }, ws: {} });
  const pc = { ip: '1.2.3.4', dev: parseDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36') };
  const phone = { ip: '5.6.7.8', dev: parseDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1') };
  return { dir, clock, act, player, pc, phone, done: () => rmSync(dir, { recursive: true, force: true }) };
};

test('裝置：手機、電腦、作業系統與瀏覽器', () => {
  assert.deepEqual(parseDevice('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537'), { type: 'pc', os: 'Windows', browser: 'Chrome' });
  assert.deepEqual(parseDevice('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537'), { type: 'mobile', os: 'Android', browser: 'Chrome' });
  assert.equal(parseDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17 like Mac OS X) Safari/604').os, 'iOS');
  assert.equal(parseDevice('', '?1').type, 'mobile');
  assert.equal(parseDevice(undefined).type, 'pc');
});

test('IP：只有連線來自本機（Caddy）才採用 X-Forwarded-For，外面直連送來的不信', () => {
  const req = (remote, xff) => ({ socket: { remoteAddress: remote }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(clientIp(req('127.0.0.1', '203.0.113.9')), '203.0.113.9');
  assert.equal(clientIp(req('::ffff:127.0.0.1', '203.0.113.9, 10.0.0.1')), '203.0.113.9');
  assert.equal(clientIp(req('127.0.0.1', 'not-an-ip')), '127.0.0.1');
  assert.equal(clientIp(req('198.51.100.7', '203.0.113.9')), '198.51.100.7');
});

test('一場的紀錄：進房、換名、賺花、買東西、離開摘要；紀錄裡不放認人代碼', () => {
  const f = fixture();
  try {
    const p = f.player('a'.repeat(32), '小明');
    f.act.begin(p, f.pc, '1 號港');
    f.act.sample(p, 1);                          // 第一次取樣只是起算
    p.kit.money += 500; f.act.sample(p, 1);      // 賺 500
    p.kit.money -= 200; p.kit.rodLv = 2; p.kit.boats.fisher = { engineLv: 0 }; f.act.sample(p, 1);   // 花 200
    p.dex.tuna = { n: 3 }; p.dex._honors = { titles: [] };
    f.clock.t += 125 * 1000;
    f.act.end(p, 'leave');
    const lines = readFileSync(join(f.dir, 'activity', '2026-11-16.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const end = lines.find((e) => e.t === 'end');
    assert.equal(end.sec, 125);
    assert.equal(end.catches, 3);
    assert.equal(end.earned, 500);
    assert.equal(end.spent, 200);
    assert.deepEqual(end.bought.sort(), ['釣竿 Lv2', '漁船'].sort());
    assert.equal(end.why, 'leave');
    assert.ok(lines.find((e) => e.t === 'join').new);
    assert.ok(!readFileSync(join(f.dir, 'activity', '2026-11-16.jsonl'), 'utf8').includes('a'.repeat(32)), '不能把代碼寫進去');
    assert.equal(p.act, null);
    f.act.end(p, 'expire');                      // 再結束一次什麼都不做
    assert.equal(readFileSync(join(f.dir, 'activity', '2026-11-16.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"end"')).length, 1);
  } finally { f.done(); }
});

test('換名：同一個代碼換了名字會記，也會留下名字沿革與 IP', () => {
  const f = fixture();
  try {
    const p = f.player('b'.repeat(32), '甲');
    f.act.begin(p, f.pc, '1 號港'); f.act.end(p, 'leave');
    f.clock.t += 3600 * 1000;
    const q = f.player('b'.repeat(32), '乙');
    f.act.begin(q, f.phone, '2 號港'); f.act.end(q, 'leave');
    const rec = f.act.people[pidOf('b'.repeat(32))];
    assert.deepEqual(rec.names.map((n) => n.name), ['甲', '乙']);
    assert.deepEqual(rec.ips, ['5.6.7.8', '1.2.3.4']);
    assert.equal(rec.sessions, 2);
    assert.equal(rec.dev, 'mobile');
    const lines = readFileSync(join(f.dir, 'activity', '2026-11-16.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.filter((e) => e.t === 'rename').map((e) => [e.from, e.to]), [['甲', '乙']]);
  } finally { f.done(); }
});

test('定時刷新把錢清掉那一次不算花', () => {
  const f = fixture();
  try {
    const p = f.player('c'.repeat(32), '丙');
    p.kit.money = 900;
    f.act.begin(p, f.pc, '1 號港'); f.act.sample(p, 1);
    p.kit.money = 0; f.act.sample(p, 2);         // 期數換了：重新起算
    p.kit.money = 80; f.act.sample(p, 2);
    f.act.end(p, 'leave');
    const end = readFileSync(join(f.dir, 'activity', '2026-11-16.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.t === 'end');
    assert.equal(end.spent, 0);
    assert.equal(end.earned, 80);
  } finally { f.done(); }
});

test('報表：每日人數、電腦／手機、新玩家、同時最高、同 IP、現在線上、異常結束', () => {
  const f = fixture();
  try {
    const a = f.player('d'.repeat(32), '甲'), b = f.player('e'.repeat(32), '乙');
    f.act.begin(a, f.pc, '1 號港'); f.act.begin(b, { ...f.phone, ip: '1.2.3.4' }, '1 號港');
    f.act.tick(2);
    f.clock.t += 10 * 60 * 1000;
    f.act.end(a, 'leave');
    f.act.tick(1);
    const r = f.act.report();
    const d = r.days[0];
    assert.equal(d.date, '2026-11-16');
    assert.deepEqual([d.players, d.pc, d.mobile, d.fresh, d.sessions, d.peak], [2, 1, 1, 2, 2, 2]);
    assert.equal(d.hourly[12], 2);
    assert.equal(r.online.length, 1);
    assert.equal(r.online[0].name, '乙');
    const pa = r.people.find((x) => x.pid === pidOf('d'.repeat(32)));
    assert.deepEqual(pa.same, [pidOf('e'.repeat(32))], '同一個 IP 的人要互相看得到');
    // 沒正常結束就重開機：下次開機時把還開著的那一場標成異常結束
    const act2 = new Activity(f.dir, { now: () => f.clock.t + 1000 });
    const again = act2.report();
    assert.ok(again.events['2026-11-16'].some((e) => e.t === 'end' && e.why === 'crash' && e.name === '乙'));
    assert.ok(statsPage(r).startsWith('<!doctype html>'), '頁面可以產生');
  } finally { f.done(); }
});

test('保留 30 天：太舊的紀錄檔和很久沒出現的人會刪掉', () => {
  const f = fixture();
  try {
    const old = dayOf(T0 - (KEEP_DAYS + 3) * 86400 * 1000), keep = dayOf(T0 - (KEEP_DAYS - 3) * 86400 * 1000);
    writeFileSync(join(f.dir, 'activity', old + '.jsonl'), '{"t":"boot","at":1}\n');
    writeFileSync(join(f.dir, 'activity', keep + '.jsonl'), '{"t":"boot","at":1}\n');
    f.act.people.zzz = { first: 1, last: T0 - (KEEP_DAYS + 1) * 86400 * 1000, names: [{ name: '舊人', at: 1 }], ips: [], sessions: 1, sec: 0, catches: 0, earned: 0, spent: 0 };
    f.act.tick(0);
    const files = readdirSync(join(f.dir, 'activity'));
    assert.ok(!files.includes(old + '.jsonl'));
    assert.ok(files.includes(keep + '.jsonl'));
    assert.ok(!('zzz' in f.act.people));
  } finally { f.done(); }
});

test('管理網頁：名字裡的 < 不會變成標籤，壞掉的紀錄行會被跳過', () => {
  const f = fixture();
  try {
    const p = f.player('f'.repeat(32), '</script><img src=x onerror=alert(1)>');
    f.act.begin(p, f.pc, '1 號港'); f.act.end(p, 'leave');
    writeFileSync(join(f.dir, 'activity', '2026-11-16.jsonl'), readFileSync(join(f.dir, 'activity', '2026-11-16.jsonl'), 'utf8') + 'not json\n{"t":1}\n');
    const html = statsPage(f.act.report());
    assert.ok(!html.includes('</script><img'), '資料裡的 < 要轉義');
    assert.ok(html.includes('\\u003c/script>'));
    assert.ok(existsSync(join(f.dir, 'activity', 'people.json')) || (f.act.save(), true));
  } finally { f.done(); }
});

test('測試伺服器（off）不記任何紀錄，報表是空的並標示 off', () => {
  const dir = mkdtempSync(join(tmpdir(), 'act-off-'));
  const a = new Activity(dir, { off: true });
  const p = { token: 'tok', name: '測試', kit: { money: 0 }, dex: {}, room: { name: '1' } };
  a.begin(p, { ip: '1.2.3.4', dev: { type: 'pc', os: 'Windows', browser: 'Chrome' } }, '1');
  a.sample(p, 1); a.end(p, 'leave'); a.tick(3); a.save();
  assert.equal(existsSync(join(dir, 'activity')), false);
  const r = a.report();
  assert.equal(r.off, true);
  assert.equal(r.days.length + r.people.length + r.online.length, 0);
});
