// 平板上的「船」app：叫船（把現在這艘移到離人最近的空船位）、換船（倉庫裡的換出來，也停到最近的空船位）。
// 兩件事都只能在據點（潮汐灣港口、海上修船屋、大港灣島；範圍見 layout.js 的 SITES）做，而且船上不能有人；船停在人所在那個據點的泊位
import { BERTHS, berthPose, berthFits, siteAt } from '../src/layout.js';
import { TABLET } from '../src/config.js';

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// 人在哪個據點（都不在回傳 null）
export const siteOf = (p) => (p.pos ? siteAt(p.pos[0], p.pos[2]) : null);
export const atHarbor = (p) => !!siteOf(p);

// 有誰站在 p 的船上（包括他自己）：位置的第 9 格是「站在誰的船上」
export function aboard(room, p) {
  for (const q of room.players.values()) if (q.ws && q.pos && q.pos[8] === p.id) return q;
  return null;
}

// 離 (x, z) 最近、這種船停得進去的空格（自己原本那格也算空的）。site：只找這個據點的格子（沒給就全部）
export function nearestBerth(room, p, type, x, z, site = null) {
  let best = -1, bd = Infinity;
  BERTHS.forEach((b, i) => {
    if ((site && b.site !== site) || !berthFits(b, type)) return;
    const who = room.berths.get(i);
    if (who !== undefined && who !== p.id) return;
    const pose = berthPose(b, type), d = dist(pose.x, pose.z, x, z);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

// 現在能不能動這艘船（叫過來、收進倉庫）：不行就回傳原因
export function moveBlocked(room, p) {
  if (!p.boat || p.boat.sunk) return '船已經沉了';
  if (!atHarbor(p)) return '要人在港口（潮汐灣、海上修船屋、大港灣島）才能叫船、換船';
  const q = aboard(room, p);
  if (q) return q === p ? '先下船才能叫船、換船' : `${q.name} 還在你的船上`;
  return '';
}

// p 所在的據點還有沒有這種船停得下的空格
export const berthFree = (room, p, type) => { const s = siteOf(p); return !!s && nearestBerth(room, p, type, p.pos[0], p.pos[2], s.id) >= 0; };

// 把 p 的停船格換成他所在據點裡離他最近的空格（不在據點、或那邊滿了就照原本的方式在母港分）
export function reberthNear(room, p, type) {
  const s = siteOf(p), i = s ? nearestBerth(room, p, type, p.pos[0], p.pos[2], s.id) : -1;
  room.freeBerth(p);
  room.allocBerth(p, i);
}

// 叫船：現在這艘直接移到離人最近的空船位（船主那邊收到 called 之後把船放過去，再照常回報位置）
export function callBoat(room, p, now) {
  const why = moveBlocked(room, p);
  if (why) return room.send(p, { t: 'no', msg: why });
  if (now < (p.callAt || 0)) return room.send(p, { t: 'no', msg: '剛叫過船，等一下再叫' });
  if (!berthFree(room, p, p.boat.type)) return room.send(p, { t: 'no', msg: '這裡的泊位停不下你的船（滿了或太小）' });
  p.callAt = now + TABLET.callCd * 1000;
  reberthNear(room, p, p.boat.type);
  const pose = berthPose(BERTHS[p.berth], p.boat.type), s = p.boat.s;
  s[0] = pose.x; s[1] = pose.z; s[2] = pose.heading; s[6] = s[7] = s[8] = 0;
  p.boat.moor = -1;
  p.boatDirty = true;
  room.send(p, { t: 'called', berth: room.berthInfo(p) });
}

// 倉庫裡的船：每艘的油量、耐久（給平板的船 app 看）
export function storedInfo(p, hpOf) {
  const out = {};
  for (const [type, st] of Object.entries(p.stored || {})) out[type] = { fuel: st.fuel, hp: hpOf(type, st.cracks || []) };
  return out;
}
