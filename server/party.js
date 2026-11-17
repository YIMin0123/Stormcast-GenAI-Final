// 船隊（組隊）、海上救難拖船、副駕掌舵：房間裡「要對方同意」和「兩個人、兩艘船配成一對」的事都在這裡。
//   船隊：最多 PARTY.max 人；邀請要對方按同意。只存在房間裡——按離開、斷線太久被收走、被併到別間房就退隊。
//   拖船：一艘拖一艘（不能連環拖），要對方同意；兩邊隨時能斷，船沉了、換船、離線、離太遠也會斷。
//         拉船的物理在被拖那一方的瀏覽器算（船本來就是船主那邊算的），伺服器只管誰拖誰。
//   副駕：同隊的人站在隊友船上、船主沒在掌舵時可以幫忙開（那艘船改由副駕的瀏覽器算，位置用 'b' 帶 forId 送來）；
//         船主自己去握方向盤就馬上收回來。
import { BOAT_TYPES } from '../src/boatdata.js';
import { PARTY, TOW } from '../src/config.js';

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
let nextAsk = 1;

// ---- 船隊 ----
export const partyOf = (room, p) => (p.party ? [...room.players.values()].filter((o) => o.party === p.party) : []);
// 同隊、現在在線上的其他人
export const mates = (room, p) => partyOf(room, p).filter((o) => o !== p && o.ws);
// 整間房誰在哪一隊：{ 玩家 id: 隊伍編號 }
export const partyMap = (room) => Object.fromEntries([...room.players.values()].filter((p) => p.party).map((p) => [p.id, p.party]));
const tellParty = (room) => room.all({ t: 'party', of: partyMap(room) });

// p 退隊（why：講給隊友聽的原因）。隊裡只剩一個人就解散
export function leaveParty(room, p, why = '離開了船隊') {
  if (!p.party) return;
  const id = p.party;
  p.party = 0;
  p.props = [];           // 放在外面的桶子不再給（已經不是隊友的）人看；畫面那邊退隊時自己會收掉
  releaseHelm(room, p);   // 正在幫隊友開船：放手
  for (const o of room.players.values()) if (o.boat && o.boat.pilot && !room.sameParty(o, room.players.get(o.boat.pilot) || {})) endPilot(room, o);   // 他的船正被（已經不是隊友的）人開著：收回來
  const rest = [...room.players.values()].filter((o) => o.party === id);
  for (const o of rest) room.send(o, { t: 'sys', text: `${p.name} ${why}`, kind: 'info' });
  if (rest.length === 1) { rest[0].party = 0; room.send(rest[0], { t: 'sys', text: '船隊解散了', kind: 'info' }); }
  tellParty(room);
}

// ---- 副駕 ----
// 船主的船不再由別人開（船主自己接手、副駕放手、退隊、離線…）
function endPilot(room, owner) {
  if (!owner.boat || !owner.boat.pilot) return;
  const co = room.players.get(owner.boat.pilot);
  owner.boat.pilot = 0;
  if (co) room.send(co, { t: 'pilotEnd', forId: owner.id });
  room.send(owner, { t: 'pilot', id: 0 });
}
// p 放開他正在幫忙開的船（沒有就沒事）
export function releaseHelm(room, p) {
  for (const o of room.players.values()) if (o.boat && o.boat.pilot === p.id) endPilot(room, o);
}

// ---- 拖船 ----
export const towOf = (room, id) => room.tows.find((t) => t.tug === id || t.tow === id) || null;
// 斷開跟 p 的船有關的拖纜。why：講給兩邊聽的原因
export function towCut(room, p, why = '') {
  const t = towOf(room, p.id);
  if (!t) return false;
  room.tows = room.tows.filter((o) => o !== t);
  room.all({ t: 'towCut', tugId: t.tug, towId: t.tow, by: p.id, why });
  return true;
}
// 每秒檢查一次：船沉了、不見了、離太遠的拖纜繃斷
export function stepTows(room) {
  for (const t of [...room.tows]) {
    const a = room.players.get(t.tug), b = room.players.get(t.tow);
    const gone = !a || !b || !a.boat || !b.boat || a.boat.sunk || b.boat.sunk || !b.ws;
    const far = !gone && dist(a.boat.s[0], a.boat.s[1], b.boat.s[0], b.boat.s[1]) > TOW.snap + (BOAT_TYPES[a.boat.type].len + BOAT_TYPES[b.boat.type].len) / 2;
    if (!gone && !far) continue;
    room.tows = room.tows.filter((o) => o !== t);
    room.all({ t: 'towCut', tugId: t.tug, towId: t.tow, by: 0, why: gone ? '' : '離得太遠，拖纜繃斷了' });
  }
}
// 兩艘船夠不夠近（拖船的船尾到被拖船的船頭）
function towNear(tug, tow) {
  const A = BOAT_TYPES[tug.boat.type], B = BOAT_TYPES[tow.boat.type], a = tug.boat.s, b = tow.boat.s;
  const sx = a[0] - Math.cos(a[2]) * A.len / 2, sz = a[1] - Math.sin(a[2]) * A.len / 2;
  const bx = b[0] + Math.cos(b[2]) * B.len / 2, bz = b[1] + Math.sin(b[2]) * B.len / 2;
  return Math.min(dist(sx, sz, bx, bz), dist(sx, sz, b[0], b[1])) < TOW.reach + 6;   // 多放 6 公尺：兩邊看到的位置差一點點
}

// 問的東西過期了（對方一直沒回答）：當作拒絕
export function expireAsks(room, now) {
  for (const a of [...room.asks.values()]) {
    if (now - a.at < a.sec * 1000 + 1500) continue;
    room.asks.delete(a.aid);
    const f = room.players.get(a.from), t = room.players.get(a.to);
    if (t) room.send(t, { t: 'askGone', aid: a.aid });
    if (f) room.send(f, { t: 'sys', text: `${t ? t.name : '對方'} 沒有回應`, kind: 'info' });
  }
}
// 一個人離線、離開：他問的、問他的都收掉；拖纜、副駕也放開
export function dropLinks(room, p) {
  for (const a of [...room.asks.values()]) {
    if (a.from !== p.id && a.to !== p.id) continue;
    room.asks.delete(a.aid);
    const o = room.players.get(a.from === p.id ? a.to : a.from);
    if (o && a.to === o.id) room.send(o, { t: 'askGone', aid: a.aid });
  }
  towCut(room, p, `${p.name} 離線了，拖纜解開`);
  releaseHelm(room, p);
  if (p.boat && p.boat.pilot) endPilot(room, p);
  if (p.props && p.props.length) { p.props = []; tellProps(room, p); }
}

// ---- 隊友看得到彼此放在甲板、地上的油桶和誘魚桶（沒組隊的人看不到） ----
// p.props：[[種類 0 油桶／1 誘魚桶, 在誰的船上（0 = 地上）, a, b, c]]；在船上 a、c 是船身座標，在地上 a、b、c 是世界座標 x、y、z
// p 剛接回來（或剛進隊）：把在線隊友的桶子補送給他
export function tellMateProps(room, p) {
  for (const o of mates(room, p)) if (o.props && o.props.length) tellProps(room, o, [p]);
}
export function tellProps(room, p, to = mates(room, p)) {
  for (const o of to) room.send(o, { t: 'props', id: p.id, list: p.props || [] });
}
function validProps(room, list) {
  if (!Array.isArray(list) || list.length > PARTY.propsMax) return false;
  return list.every((e) => Array.isArray(e) && e.length === 5 && (e[0] === 0 || e[0] === 1) && Number.isInteger(e[1]) && e[1] >= 0
    && [e[2], e[3], e[4]].every((v) => Number.isFinite(v) && Math.abs(v) < 1e5)
    && (e[1] === 0 || (!!room.players.get(e[1])?.boat && !room.players.get(e[1]).boat.sunk && Math.abs(e[2]) < 20 && Math.abs(e[4]) < 8)));
}

function askNew(room, kind, from, to, sec, data = {}) {
  for (const a of [...room.asks.values()]) if (a.from === from.id && a.kind === kind) { room.asks.delete(a.aid); const o = room.players.get(a.to); if (o) room.send(o, { t: 'askGone', aid: a.aid }); }   // 同一種事一次只問一個人
  const a = { aid: nextAsk++, kind, from: from.id, to: to.id, at: Date.now(), sec, ...data };
  room.asks.set(a.aid, a);
  return a;
}

// 處理這些訊息；不是這裡的事就回傳 false
export function onPartyMsg(room, p, m, now) {
  const no = (msg) => { room.send(p, { t: 'no', msg }); return true; };
  switch (m.t) {
    case 'partyInvite': {
      const t = room.players.get(m.to);
      if (!t || t === p || !t.ws) return no('找不到這位玩家');
      if (room.sameParty(p, t)) return no(`${t.name} 已經在你的船隊裡`);
      if (t.party) return no(`${t.name} 已經在別的船隊`);
      if (partyOf(room, p).length >= PARTY.max) return no(`船隊最多 ${PARTY.max} 人`);
      const a = askNew(room, 'party', p, t, PARTY.askSec);
      room.send(t, { t: 'ask', aid: a.aid, kind: 'party', fromId: p.id, from: p.name, sec: PARTY.askSec });
      room.send(p, { t: 'sys', text: `已邀請 ${t.name} 加入船隊，等對方回答`, kind: 'info' });
      return true;
    }
    case 'partyLeave': leaveParty(room, p); return true;
    case 'towAsk': {
      // me：true = 請對方拖我的船；不然是我要拖對方的船
      const t = room.players.get(m.to);
      if (!t || t === p || !t.ws) return no('找不到那艘船的船主');
      const tug = m.me ? t : p, tow = m.me ? p : t;
      if (!tug.boat || !tow.boat || tug.boat.sunk || tow.boat.sunk) return no('船已經沉了');
      if (towOf(room, tug.id) || towOf(room, tow.id)) return no('已有拖纜連接中，請先解開');
      if (!towNear(tug, tow)) return no(`兩艘船要靠近到 ${TOW.reach} 公尺以內`);
      const a = askNew(room, 'tow', p, t, TOW.askSec, { tug: tug.id, tow: tow.id });
      room.send(t, { t: 'ask', aid: a.aid, kind: 'tow', fromId: p.id, from: p.name, me: !!m.me, boat: BOAT_TYPES[p.boat ? p.boat.type : tug.boat.type].name, sec: TOW.askSec });
      room.send(p, { t: 'sys', text: `已向 ${t.name} 提出拖船請求，等對方回答`, kind: 'info' });
      return true;
    }
    case 'towCut': {
      const mine = towOf(room, p.id);
      if (mine) { towCut(room, p, `${p.name} 解開了拖纜`); return true; }
      // 幫同隊隊友掌舵的人也能解他那艘船的拖纜
      const o = [...room.players.values()].find((q) => q.boat && q.boat.pilot === p.id);
      if (o) towCut(room, o, `${p.name} 解開了拖纜`);
      return true;
    }
    case 'askAns': {
      const a = room.asks.get(m.aid);
      if (!a || a.to !== p.id) return true;
      room.asks.delete(a.aid);
      const f = room.players.get(a.from);
      if (!f || !f.ws) return true;
      if (m.yes !== true) { room.send(f, { t: 'sys', text: a.kind === 'party' ? `${p.name} 婉拒了船隊邀請` : `${p.name} 拒絕了拖船請求`, kind: 'info' }); return true; }
      if (a.kind === 'party') {
        if (p.party) return no('你已經在別的船隊，先退隊');
        if (partyOf(room, f).length >= PARTY.max) return no('對方的船隊已經滿了');
        if (!f.party) f.party = room.nextParty++;
        p.party = f.party;
        tellParty(room);
        for (const o of partyOf(room, p)) room.send(o, { t: 'sys', text: o === p ? `你加入了 ${f.name} 的船隊` : `${p.name} 加入了船隊`, kind: 'join' });
        for (const o of partyOf(room, p)) if (o !== p && o.props && o.props.length) tellProps(room, o, [p]);   // 原本隊員放在外面的桶子：讓新來的也看得到
        return true;
      }
      if (a.kind === 'tow') {
        const tug = room.players.get(a.tug), tow = room.players.get(a.tow);
        if (!tug || !tow || !tug.boat || !tow.boat || tug.boat.sunk || tow.boat.sunk) return no('船已經不在了');
        if (towOf(room, tug.id) || towOf(room, tow.id)) return no('已有拖纜連接中，請先解開');
        if (!towNear(tug, tow)) return no('兩艘船離太遠了，拖纜搆不到');
        tow.boat.moor = -1;   // 被拖的船原本綁在岸上的纜繩自動解開
        room.tows.push({ tug: tug.id, tow: tow.id });
        room.all({ t: 'tow', tugId: tug.id, towId: tow.id });
        return true;
      }
      return true;
    }
    case 'props': {   // 我放在甲板、地上的油桶和誘魚桶在哪：只轉給同隊隊友看
      if (!validProps(room, m.list)) return true;
      const next = p.party ? m.list : [];
      if (JSON.stringify(next) === JSON.stringify(p.props || [])) return true;   // 跟上一份一樣：不用再吵隊友（他們每收一次就要重擺一次模型）
      if (now - (p.propsAt || 0) < PARTY.propsCd * 1000) return true;            // 太密：這一則不收（畫面端每隔幾秒會整份重送，不會一直錯下去）
      p.propsAt = now;
      p.props = next;
      tellProps(room, p);
      return true;
    }
    case 'boatCtl': {
      // 幫同隊隊友動他的船：開關船燈、集魚燈（人要在那艘船上），綁、解岸上的纜繩（人要在岸上、船旁邊）。
      // 船是船主（或正在幫他開的副駕）那邊算的，所以只是轉過去請那邊照做
      const owner = m.forId === p.id ? p : room.players.get(m.forId);
      if (!owner || !owner.boat || owner.boat.sunk || !['lamp', 'fishLamp', 'moor', 'unmoor'].includes(m.what)) return true;
      const light = m.what === 'lamp' || m.what === 'fishLamp';
      // 自己的船：只有正被隊友開著的時候才需要轉（船在副駕那邊算），而且只有燈
      if (owner === p ? !(light && owner.boat.pilot) : !room.sameParty(p, owner)) return owner === p ? true : no('只有同隊隊友可以動這艘船');
      if (now - (p.ctlAt || 0) < 250) return true;
      if (light) {
        if (!p.pos || p.pos[8] !== owner.id) return no('要站在那艘船上');
      } else {
        if (owner.ws && owner.pos && (owner.pos[4] & 32)) return no(`${owner.name} 正在掌舵`);
        if (!p.pos || p.pos[8]) return no('要下船站在繫纜樁旁邊');
        if (dist(p.pos[0], p.pos[2], owner.boat.s[0], owner.boat.s[1]) > BOAT_TYPES[owner.boat.type].len / 2 + 14) return no('離那艘船太遠了');
        if (m.what === 'moor' && (!Number.isInteger(m.i) || m.i < 0 || m.i > 999)) return true;
        if (owner.boat.pilot) return no('有隊友正在開這艘船');
      }
      const sim = owner.boat.pilot ? room.players.get(owner.boat.pilot) : owner;
      if (!sim || !sim.ws) return no(`${owner.name} 不在線上`);
      if (sim === p) return true;   // 自己就是正在開這艘船的人：自己那邊直接動就好
      p.ctlAt = now;
      room.send(sim, { t: 'boatCtl', forId: owner.id, what: m.what, i: m.what === 'moor' ? m.i : -1, by: p.name });
      return true;
    }
    case 'helm': {
      // 副駕：on true 接手隊友（forId）的船、false 放手；船主自己握方向盤（forId 是自己或沒給）就把副駕請下來
      const owner = m.forId && m.forId !== p.id ? room.players.get(m.forId) : p;
      if (!owner || !owner.boat || owner.boat.sunk) return true;
      if (owner === p) { if (m.on !== false) endPilot(room, p); return true; }
      if (m.on === false) { if (owner.boat.pilot === p.id) endPilot(room, owner); return true; }
      if (!room.sameParty(p, owner)) return no('只有同隊隊友可以幫忙開船');
      if (!p.pos || p.pos[8] !== owner.id) return no('要站在那艘船上');
      if (!owner.ws) return no(`${owner.name} 不在線上，不能開他的船`);
      if (owner.pos && (owner.pos[4] & 32)) return no(`${owner.name} 正在掌舵`);
      if (owner.boat.pilot && owner.boat.pilot !== p.id) return no('已經有隊友在掌舵了');
      for (const o of room.players.values()) if (o !== owner && o.boat && o.boat.pilot === p.id) endPilot(room, o);   // 一個人一次只開一艘：原本幫別人開的那艘先交回去
      owner.boat.pilot = p.id;
      room.send(p, { t: 'helmOk', forId: owner.id, s: owner.boat.s });
      room.send(owner, { t: 'pilot', id: p.id, name: p.name });
      return true;
    }
  }
  return false;
}
