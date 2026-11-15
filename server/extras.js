// 一間房裡的兩樣「大家一起看得到」的東西：海上的魚群熱點、風暴後的漂流寶箱。
// 什麼時候出現、在哪裡、誰撿走了，都由伺服器決定，再跟著天氣一起送給同房的每個人（見 room.js 的 worldState）
import { bedAt, offAt } from './world.js';
import { HOTSPOT, CHESTS, CHEST_SPOTS_W } from '../src/extrasPlan.js';
import { CHUM_SPEC } from '../src/boatdata.js';

const rand = ([a, b]) => a + Math.random() * (b - a);
const ROUGH = new Set(['storm', 'thunder', 'typhoon', 'waves', 'whirl']);   // 這些海況結束後會漂來寶箱

export class Extras {
  constructor() {
    this.hot = null;                    // { x, z, r, until, count, maxCount }
    this.chums = [];                    // 誘魚桶人工魚群：[{ id, x, z, r, until, count, maxCount, ownerId }]
    this.nextHot = rand(HOTSPOT.every) * 0.4;
    this.chests = [];                   // [{ id, k 第幾個地點, until }]
    this.was = 'calm';
    this.uid = 1;
    this.clock = 0;
  }

  // 每 0.1 秒：t 是房間的時鐘、phase 是現在的海況。有變化（要馬上告訴大家）回傳 true
  step(t, dt, phase) {
    this.clock = t;
    let changed = false;
    if (this.hot && (t > this.hot.until || this.hot.count <= 0)) {
      this.hot = null;
      this.nextHot = rand(HOTSPOT.every);
      changed = true;
    }
    if (!this.hot && (this.nextHot -= dt) <= 0) {
      this.hot = this.pickHot(t);
      if (this.hot) changed = true; else this.nextHot = 20;
    }
    const cn = this.chums.length;
    this.chums = this.chums.filter((c) => t < c.until && c.count > 0);
    if (this.chums.length !== cn) changed = true;
    const n = this.chests.length;
    this.chests = this.chests.filter((c) => t < c.until);
    if (this.chests.length !== n) changed = true;
    if (phase === 'calm' && ROUGH.has(this.was)) { this.spawnChests(t); changed = true; }
    this.was = phase;
    return changed;
  }

  pickHot(t) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, d = 150 + Math.random() * (HOTSPOT.reach - 150), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (-bedAt(x, z) >= HOTSPOT.minDepth && offAt(x, z) >= HOTSPOT.minOff) {
        const q = Math.round(rand(HOTSPOT.quota));
        return { x: Math.round(x), z: Math.round(z), r: HOTSPOT.r, until: t + rand(HOTSPOT.life), count: q, maxCount: q };
      }
    }
    return null;
  }

  spawnHotspotNow() {
    if (!this.hot) this.hot = this.pickHot(this.clock);
    return !!this.hot;
  }

  spawnChum(x, z, ownerId) {
    const c = {
      id: this.uid++, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10,
      r: CHUM_SPEC.radius, until: this.clock + CHUM_SPEC.life,
      count: CHUM_SPEC.quota, maxCount: CHUM_SPEC.quota, ownerId,
    };
    this.chums.push(c);
    return c;
  }

  inHot(x, z) {
    if (this.hot && Math.hypot(x - this.hot.x, z - this.hot.z) < this.hot.r) return true;
    return this.chums.some((c) => Math.hypot(x - c.x, z - c.z) < c.r);
  }

  consumeHot(x, z) {
    let changed = false;
    if (this.hot && Math.hypot(x - this.hot.x, z - this.hot.z) < this.hot.r) {
      this.hot.count = Math.max(0, this.hot.count - 1);
      if (this.hot.count <= 0) { this.hot = null; this.nextHot = rand(HOTSPOT.every); }
      changed = true;
    }
    for (let i = this.chums.length - 1; i >= 0; i--) {
      const c = this.chums[i];
      if (Math.hypot(x - c.x, z - c.z) < c.r) {
        c.count = Math.max(0, c.count - 1);
        if (c.count <= 0) this.chums.splice(i, 1);
        changed = true;
        break;
      }
    }
    return changed;
  }

  spawnChests(t) {
    const free = CHEST_SPOTS_W.map((s, k) => k).filter((k) => !this.chests.some((c) => c.k === k));
    for (let i = 0; i < CHESTS.count && free.length; i++) {
      const k = free.splice(Math.floor(Math.random() * free.length), 1)[0];
      this.chests.push({ id: this.uid++, k, until: t + CHESTS.life });
    }
  }
  // 撿寶箱：回傳 { cash, fuel }；箱子不在了回傳 null
  open(id) {
    const i = this.chests.findIndex((c) => c.id === id);
    if (i < 0) return null;
    this.chests.splice(i, 1);
    return Math.random() < CHESTS.fuel ? { cash: 0, fuel: true } : { cash: Math.round(rand(CHESTS.cash) / 10) * 10, fuel: false };
  }
  spotOf(id) { const c = this.chests.find((q) => q.id === id); return c ? CHEST_SPOTS_W[c.k] : null; }

  // 跟著天氣一起送出去的樣子（時間都換成「還剩幾秒」，每個人的時鐘不一定對得上）
  state() {
    return {
      hot: this.hot ? { x: this.hot.x, z: this.hot.z, r: this.hot.r, left: Math.max(0, this.hot.until - this.clock), count: this.hot.count, maxCount: this.hot.maxCount } : null,
      chums: this.chums.map((c) => ({ id: c.id, x: c.x, z: c.z, r: c.r, left: Math.max(0, c.until - this.clock), count: c.count, maxCount: c.maxCount })),
      chests: this.chests.map((c) => [c.id, c.k]),
    };
  }
}
