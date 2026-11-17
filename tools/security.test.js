import assert from 'node:assert/strict';
import test from 'node:test';
import { Room, newPlayer, applyProfile } from '../server/room.js';
import { cleanName } from '../server/words.js';
import { sendRaw } from '../server/wire.js';
import { FISHBOX } from '../src/config.js';
import { BERTHS, QUAY_CENTER_W, ALL_SHELF_W } from '../src/layout.js';

function fixture() {
  const hub = { keep() {}, sessions: new Map(), daily: { top: () => [] } };
  const room = new Room(1, hub);
  const make = (id) => {
    const p = newPlayer(id, null, 'a'.repeat(32), '測試');
    room.enter(p);
    return p;
  };
  const p = make(1), q = make(2);
  return { room, p, q };
}
const pos = (x, z, carrier = 0) => [x, 1.3, z, 0, 0, 0, 0, 0, carrier, 0, 0, '', ''];

test('畸形訊息、繼承屬性與損壞值不會引發例外或污染狀態', () => {
  const { room, p } = fixture();
  const start = pos(QUAY_CENTER_W.x, QUAY_CENTER_W.z);
  room.on(p, { t: 'p', s: start });
  assert.equal(p.pos, start);
  const bad = JSON.parse('{"toString":0,"valueOf":0}');
  assert.equal(cleanName(bad), '');
  for (const m of [
    { t: 'p', s: { slice: 0 } },
    { t: 'p', s: [...start.slice(0, 11), 'constructor', ''] },
    { t: 'p', s: pos(start[0], start[2], 999) },
    { t: 'h', id: 'constructor', len: 1 },
    { t: 'chat', text: bad },
    { t: 'sink', why: bad, side: 1 },
    { t: 'swap', type: 'constructor' },
    { t: 'baitSel', id: bad },
    { t: 'bd', cracks: [[0, 0]], moor: -1 },
    { t: 'bd', cracks: [[0, 0, -5]], moor: -1 },
  ]) room.on(p, m);
  assert.equal(p.pos, start);
  assert.equal(p.hold, null);
  assert.equal(p.boat.sunk, false);
  assert.equal(p.kit.active, 'skiff');
  assert.deepEqual(p.boat.cracks, []);
  // 修船台、捐款箱、意見信箱、船隊、拖船、副駕：站在工位前送畸形的值也不會出事
  for (const id of ['repair', 'title', 'mailbox']) {
    const st = ALL_SHELF_W.find((s) => s.id === id).stand;
    p.pos = pos(st.x, st.z);
    for (const m of [
      { t: 'repairBoat', forId: bad }, { t: 'repairBoat', forId: 'constructor' },
      { t: 'donate', amount: bad }, { t: 'donate', amount: -500 }, { t: 'donate', amount: 1e308 }, { t: 'donate', amount: NaN },
      { t: 'wear', title: bad }, { t: 'wear', title: '👑 漁會會長' },
      { t: 'feedback', kind: 'constructor', text: 'x' }, { t: 'feedback', kind: 'bug', text: bad },
      { t: 'partyInvite', to: bad }, { t: 'partyInvite', to: p.id }, { t: 'askAns', aid: bad, yes: true },
      { t: 'towAsk', to: bad, me: bad }, { t: 'towCut' }, { t: 'helm', forId: bad, on: bad }, { t: 'helm', forId: 2, on: true },
      { t: 'b', forId: 2, s: [...p.boat.s] }, { t: 'sink', forId: 2, why: 'flood', side: 1 },
    ]) room.on(p, m);
  }
  assert.equal(p.kit.money, 0);
  assert.equal(p.party || 0, 0);
  assert.equal(p.wearTitle || '', '');
  assert.equal(room.tows.length, 0);
  assert.equal(room.players.get(2).boat.sunk, false);
});

test('正常船況會同步，離群座標、負油量和不完整船損會被拒絕', () => {
  const { room, p } = fixture(), berth = BERTHS[p.berth];
  assert.ok(berth);
  const state = [...p.boat.s];
  state[10] -= 2;
  room.on(p, { t: 'b', s: state });
  room.on(p, { t: 'bd', cracks: [[0, 0, 1]], moor: -1 });
  const poisoned = [...state];
  poisoned[0] = 1e308;
  room.on(p, { t: 'b', s: poisoned });
  room.on(p, { t: 'bd', cracks: [[0]], moor: -1 });
  const negative = [...state];
  negative[10] = -1;
  room.on(p, { t: 'b', s: negative });
  assert.deepEqual(p.boat.s, state);
  assert.deepEqual(p.boat.cracks, [[0, 0, 1]]);
});

test('舊存檔中的不完整船損與越界油量不會帶回遊戲', () => {
  const { room, p } = fixture();
  applyProfile(p, { stored: { skiff: { fuel: -5, cracks: [[0, 0], [0, 0, 2]] } } });
  room.parkBoat(p);
  assert.equal(p.boat.s[10], 0);
  assert.deepEqual(p.boat.cracks, [[0, 0, 2]]);
  assert.ok(Number.isFinite(p.boat.s[11]));
});

test('送魚只接受有效的同意，逾時或分開後不能交付，重連不會收到原釣者的憑證', () => {
  const { room, p, q } = fixture();
  q.token = 'b'.repeat(32);
  p.ws = q.ws = { readyState: 1, send() {} };
  const x = QUAY_CENTER_W.x, z = QUAY_CENTER_W.z;
  p.pos = q.pos = pos(x, z);
  p.fish.set(1, { id: 'tuna', kg: 2, len: 0.8, value: 200, by: { pid: p.id, key: p.token, name: p.name } });
  const offer = () => {
    room.on(p, { t: 'give', to: q.id, uid: 1 });
    return [...room.offers.values()][0];
  };
  const accept = (oid, yes = true) => room.on(q, { t: 'giveAns', oid, yes });

  let o = offer();
  accept(o.oid, 'true');
  assert.ok(p.fish.has(1));
  q.pos = pos(x + 50, z);
  accept(o.oid);
  assert.ok(p.fish.has(1));
  q.pos = pos(x, z);
  o = offer();
  o.at -= FISHBOX.offerSec * 1000 + 1;
  accept(o.oid);
  assert.ok(p.fish.has(1));
  accept(offer().oid);
  assert.equal(p.fish.has(1), false);
  assert.equal(q.fish.get(1).by.key, p.token);
  assert.deepEqual(room.resumeData(q).fish, [{ uid: 1, id: 'tuna', kg: 2, len: 0.8, value: 200 }]);
});

test('慢速連線超過佇列上限就中止，健康連線可正常接收', () => {
  const sent = [];
  const ws = { readyState: 1, bufferedAmount: 0, send: (raw) => sent.push(raw), terminate() { this.readyState = 3; } };
  sendRaw(ws, 'first');
  ws.bufferedAmount = 2 * 1024 * 1024;
  sendRaw(ws, 'second');
  assert.deepEqual(sent, ['first']);
  assert.equal(ws.readyState, 3);
});

test('旁人平板顯示摘要（ts）會嚴格過濾原型污染、虛構物種／船種／頭銜及越界數值並隨名單轉發', () => {
  const { room, p, q } = fixture();
  p.kit.money = 12345;
  const sentToQ = [];
  p.ws = { readyState: 1, bufferedAmount: 0, send() {}, terminate() {} };
  q.ws = { readyState: 1, bufferedAmount: 0, send: (raw) => sentToQ.push(JSON.parse(raw)), terminate() {} };

  // 畸形與非物件輸入不應造成例外或存入狀態
  for (const d of [123, 'bad', [], () => {}]) room.on(p, { t: 'ts', d });
  assert.equal(p.tab, null);

  // 合法欄位與白名單外／XSS／原型鍵混在一起時只保留安全白名單內容
  room.on(p, {
    t: 'ts',
    d: JSON.parse('{"scr":99,"sc":-50,"mf":99,"money":999999999,"dexSel":"<script>","dexHave":["tuna","constructor","tuna","fakemon"],"dexSelStat":[3,1.2345,5.678],"rodLv":9,"rodBrk":1,"bait":"__proto__","baits":[["shrimp",5],["bad",9]],"chum":99,"mods":{"sonar":1,"evil":1},"paint":"evil","title":"<img onerror=alert(1)>","titles":["碼頭釣客","假頭銜"],"boxes":[[4,12.34,500],["x",1,2]],"stored":[["trawler",2,-1,9],["spaceship",1,1,1]],"gfxLv":5,"gfxPage":1,"sound":0,"vol":9,"__proto__":{"polluted":1}}'),
  });
  assert.ok(p.tab);
  assert.equal(p.tab.money, 12345);
  assert.equal(p.tab.scr, 8);
  assert.equal(p.tab.sc, 0);
  assert.equal(p.tab.mf, 15);
  assert.equal(p.tab.dexSel, '');
  assert.deepEqual(p.tab.dexHave, ['tuna']);
  assert.deepEqual(p.tab.dexSelStat, [3, 1.23, 5.68]);
  assert.equal(p.tab.rodLv, 5);
  assert.equal(p.tab.bait, '');
  assert.deepEqual(p.tab.baits, [['shrimp', 5]]);
  assert.equal(p.tab.chum, 6);
  assert.deepEqual(p.tab.mods, { sonar: true, hull: false, lamp: false });
  assert.equal(p.tab.paint, 'default');
  assert.equal(p.tab.title, '');
  assert.deepEqual(p.tab.titles, ['碼頭釣客']);
  assert.deepEqual(p.tab.boxes, [[4, 12.3, 500]]);
  assert.deepEqual(p.tab.stored, [['trawler', 1, 0, 5]]);
  assert.equal(p.tab.gfxLv, 2);
  assert.equal(p.tab.sound, false);
  assert.equal(p.tab.vol, 1);
  assert.equal(Object.hasOwn(p.tab, 'polluted'), false);
  assert.equal(sentToQ.at(-1).t, 'ts');
  assert.deepEqual(room.roster(q).find((r) => r.id === p.id).tab, p.tab);

  // 收起平板（改拿空手或魚）時同步清除伺服器暫存
  room.on(p, { t: 'h', id: '', len: 0 });
  assert.equal(p.tab, null);
});
