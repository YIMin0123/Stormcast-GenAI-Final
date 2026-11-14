// 一間房裡的三樣「大家一起看得到」的東西：海上的魚群熱點、風暴後的漂流寶箱、山頂的烽火。
// 什麼時候出現、在哪裡、誰撿走了，都由伺服器決定，再跟著天氣一起送給同房的每個人（見 room.js 的 worldState）
import { bedAt, offAt } from './world.js';
import { HOTSPOT, CHESTS, CHEST_SPOTS_W } from '../src/extrasPlan.js';

const rand = ([a, b]) => a + Math.random() * (b - a);
const ROUGH = new Set(['storm', 'thunder', 'typhoon', 'waves', 'whirl']);   // 這些海況結束後會漂來寶箱

export class Extras {
  constructor() {
    this.hot = null;                    // { x, z, r, until 房間時鐘的幾秒 }
    this.nextHot = rand(HOTSPOT.every) * 0.4;
    this.chests = [];                   // [{ id, k 第幾個地點, until }]
    this.fire = 0;                      // 烽火燒到房間時鐘的幾秒（0 = 沒點）
    this.bellAt = -1e9;
    this.was = 'calm';
    this.uid = 1;
    this.clock = 0;
  }

  // 每 0.1 秒：t 是房間的時鐘、phase 是現在的海況。有變化（要馬上告訴大家）回傳 true
  step(t, dt, phase) {
    this.clock = t;
    let changed = false;
    if (this.hot && t > this.hot.until) { this.hot = null; this.nextHot = rand(HOTSPOT.every); changed = true; }
    if (!this.hot && (this.nextHot -= dt) <= 0) {
      this.hot = this.pickHot(t);
      if (this.hot) changed = true; else this.nextHot = 20;
    }
    const n = this.chests.length;
    this.chests = this.chests.filter((c) => t < c.until);
    if (this.chests.length !== n) changed = true;
    if (phase === 'calm' && ROUGH.has(this.was)) { this.spawnChests(t); changed = true; }
    this.was = phase;
    if (this.fire && t > this.fire) { this.fire = 0; changed = true; }
    return changed;
  }

  pickHot(t) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, d = 150 + Math.random() * (HOTSPOT.reach - 150), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (-bedAt(x, z) >= HOTSPOT.minDepth && offAt(x, z) >= HOTSPOT.minOff) return { x: Math.round(x), z: Math.round(z), r: HOTSPOT.r, until: t + rand(HOTSPOT.life) };
    }
    return null;
  }
  inHot(x, z) { return !!this.hot && Math.hypot(x - this.hot.x, z - this.hot.z) < this.hot.r; }

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
      hot: this.hot ? { x: this.hot.x, z: this.hot.z, r: this.hot.r, left: Math.max(0, this.hot.until - this.clock) } : null,
      chests: this.chests.map((c) => [c.id, c.k]),
      fire: this.fire ? Math.max(0, this.fire - this.clock) : 0,
    };
  }
}
