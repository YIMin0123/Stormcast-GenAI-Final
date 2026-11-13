// 魚：魚種資料、依海域決定釣到什麼，以及「實體的魚」——
// 釣上來拿在手上，可以放下、再拿起；放在甲板或碼頭上會跳，船歪了會滑出船外，船猛地一晃會被拋起來（可能飛出船外）。浪不會把魚捲走。
import * as THREE from 'three';

import { SPECIES, typicalLength, fishValue } from './fishdata.js';
// 魚種資料、「釣到什麼、多大、值多少」的規則在 fishdata.js（伺服器也用同一份）
export { SPECIES, SPECIALTY, pickSpecies, rollFish, fishValue, fishLabel } from './fishdata.js';

// 魚的模型：+X 是頭，Y 是背。背上是魚種的顏色、肚子是白的
export function makeFishMesh(sp, len) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.5, 12, 8);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const back = new THREE.Color(sp.color), belly = new THREE.Color(0xe9eef0), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / 0.5, y = pos.getY(i) / 0.5;
    const k = x < 0 ? 1 - 0.62 * x * x : 1 - 0.25 * x * x;   // 尾巴那一頭收得比較細
    pos.setY(i, pos.getY(i) * k); pos.setZ(i, pos.getZ(i) * k);
    c.copy(belly).lerp(back, THREE.MathUtils.smoothstep(y, -0.3, 0.3));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  body.scale.set(len * 0.82, len * sp.h, len * sp.w);
  g.add(body);

  const finMat = new THREE.MeshLambertMaterial({ color: back.clone().multiplyScalar(0.75), side: THREE.DoubleSide });
  const tri = (pts) => {
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.flat().map((v) => v * len)), 3));
    b.computeVertexNormals();
    g.add(new THREE.Mesh(b, finMat));
  };
  const hh = sp.h * 0.5;
  tri([[-0.34, 0, 0], [-0.52, hh * 1.15, 0], [-0.46, 0, 0]]);        // 尾鰭上半
  tri([[-0.34, 0, 0], [-0.46, 0, 0], [-0.52, -hh * 1.15, 0]]);       // 尾鰭下半
  tri([[0.12, hh * 0.9, 0], [-0.16, hh * 0.85, 0], [-0.12, hh * 1.45, 0]]); // 背鰭
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const side of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.012, len * 0.022), 6, 5), eyeMat);
    e.position.set(len * 0.29, len * sp.h * 0.08, side * len * sp.w * 0.36);
    g.add(e);
  }
  return g;
}

const rand = (a, b) => a + Math.random() * (b - a);

// 油桶的模型（商品架上的樣品也用這個）：紅色方桶，上面有提把和蓋子
export function makeCanMesh() {
  const g = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: 0xb8322a }), dark = new THREE.MeshLambertMaterial({ color: 0x2b2d2f });
  const part = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); };
  part(0.30, 0.36, 0.18, red, 0, 0, 0);
  part(0.16, 0.03, 0.04, dark, -0.02, 0.215, 0);   // 提把
  part(0.03, 0.05, 0.04, dark, -0.09, 0.19, 0); part(0.03, 0.05, 0.04, dark, 0.05, 0.19, 0);
  part(0.06, 0.06, 0.06, dark, 0.11, 0.2, 0);      // 蓋子
  return g;
}

// 管理所有拿得起來的東西：釣上來的魚，還有油桶。env：
//   player、boats（所有的船）、scene
//   ground(x, z)：地面或棧板高度（很大的值 = 牆）
//   waveAt(x, z)：該處的浪高
//   splash(x, y, z)：濺水花；toast(text)：畫面提示
//   basket：{ x, z, y }　商店的籃子
//   onLost(uids)：這幾條魚沒了（掉回海裡、跟著船沉了），多人模式要告訴伺服器
export class FishWorld {
  constructor(env) {
    this.env = env;
    this.items = [];    // 放在甲板或地上的魚
    this.basket = [];   // 籃子裡等著賣的魚
    this.held = null;   // 拿在手上的那一條
  }

  // 剛釣上來：直接拿在手上。uid：伺服器給這條魚的編號（賣的時候靠它認）
  spawnHeld(id, kg, len = typicalLength(id, kg), uid = 0, value = fishValue(id, kg)) {
    const sp = SPECIES[id];
    const it = {
      uid, id, sp, kg, value, len, thick: len * sp.w,
      mesh: makeFishMesh(sp, len), state: 'held', boat: null,
      x: 0, z: 0, y: 0, lx: 0, lz: 0, yaw: 0, vx: 0, vz: 0,
      lively: 80,                 // 還會活蹦亂跳多久（秒）
      flopT: rand(2, 5), hop: null, wash: 0, t: Math.random() * 10,
    };
    this._hold(it);
    return it;
  }

  // 買了一桶油：直接提在手上。油桶和魚一樣可以放下、再拿起，但不會跳
  spawnCan(liters) {
    const it = {
      can: true, liters, id: 'can', sp: { name: '油桶' }, kg: 0, value: 0, len: 0.3, thick: 0.4,
      mesh: makeCanMesh(), state: 'held', boat: null,
      x: 0, z: 0, y: 0, lx: 0, lz: 0, yaw: 0, vx: 0, vz: 0,
      lively: 0, flopT: 1e9, hop: null, wash: 0, t: 0,
    };
    this._hold(it);
    return it;
  }

  // 讀檔用：直接把一條魚放進船的魚箱、把一桶油放在甲板上
  stowFish(boat, id, kg, len, uid = 0, value = undefined) {
    const keep = this.held;
    this.held = null;
    this.spawnHeld(id, kg, len, uid, value).lively = 0;
    this.toBox(boat);
    this.held = keep;
    this.env.player.carry = !!keep;
  }

  stowCan(boat, lx, lz, liters) {
    const keep = this.held;
    this.held = null;
    this._toBoat(this.spawnCan(liters), boat, lx, lz);
    this.held = keep;
    this.env.player.carry = !!keep;
  }

  // 全部清掉（進到一間新的房間時）：地上、甲板上、魚箱裡、籃子裡、手上的都不留
  clearAll() {
    for (const it of [...this.items, ...this.basket]) it.mesh.removeFromParent();
    for (const b of this.env.boats) { for (const it of b.boxFish) it.mesh.removeFromParent(); b.boxFish.length = 0; }
    this.items.length = 0;
    this.basket.length = 0;
    this.discardHeld();
  }

  // 手上的東西用掉了（油倒完了）
  discardHeld() {
    const it = this.held;
    if (!it) return;
    it.mesh.removeFromParent();
    this.held = null;
    this.env.player.carry = false;
  }

  // 船沉了：甲板上和魚箱裡的東西都沒了；人也在船上的話，手上的也沒了
  wreck(boat, aboard) {
    const gone = [];
    for (const it of this.items.filter((o) => o.boat === boat)) {
      it.mesh.removeFromParent();
      this.items.splice(this.items.indexOf(it), 1);
      gone.push(it);
    }
    for (const it of boat.boxFish) { it.mesh.removeFromParent(); gone.push(it); }
    boat.boxFish.length = 0;
    if (aboard && this.held) { gone.push(this.held); this.discardHeld(); }
    this._gone(gone);
  }

  _gone(list) {
    const uids = list.filter((it) => it.uid).map((it) => it.uid);
    if (uids.length && this.env.onLost) this.env.onLost(uids);
  }

  // 把一條魚放在船的甲板上（斷線重連時把魚還回來用）
  stowDeck(boat, lx, lz, id, kg, len, uid, value) {
    const keep = this.held;
    this.held = null;
    const it = this.spawnHeld(id, kg, len, uid, value);
    it.lively = 0;
    this._toBoat(it, boat, lx, lz);
    this.held = keep;
    this.env.player.carry = !!keep;
  }

  _hold(it) {
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
    it.state = 'held'; it.hop = null; it.boat = null;
    this.env.player.mesh.add(it.mesh);
    it.mesh.position.set(0.5, 1.08, 0);
    it.mesh.rotation.set(0, Math.PI / 2, 0);   // 橫著捧在胸前
    this.held = it;
    this.env.player.carry = true;
  }

  pick(it) { if (!this.held) this._hold(it); }

  _release(it) {
    if (this.held === it) { this.held = null; this.env.player.carry = false; }
    it.yaw = rand(0, Math.PI * 2); it.vx = it.vz = 0; it.hop = null; it.wash = 0;
    it.flopT = rand(1.5, 4);
  }

  _toBoat(it, boat, lx, lz) {
    this._release(it);
    it.state = 'boat'; it.boat = boat; it.lx = lx; it.lz = lz;
    boat.mesh.add(it.mesh);
    if (!this.items.includes(it)) this.items.push(it);
    this._pose(it, 0);
  }

  _toGround(it, x, z) {
    this._release(it);
    it.state = 'ground'; it.boat = null; it.x = x; it.z = z; it.y = this.env.ground(x, z);
    this.env.scene.add(it.mesh);
    if (!this.items.includes(it)) this.items.push(it);
    this._pose(it, 0);
  }

  // 某個位置能不能放魚：回傳 { boat, lx, lz } / { x, z } / null（牆）/ 'water'
  _spot(x, z) {
    for (const b of this.env.boats) {
      if (b.sinking) continue;
      const l = b.toLocal(x, z);
      if (b.deckContains(l.x, l.z)) return b.blockedLocal(l.x, l.z) ? null : { boat: b, lx: l.x, lz: l.z };
    }
    const g = this.env.ground(x, z);
    if (g > 90) return null;
    if (g < -0.2) return 'water';
    return { x, z };
  }

  _put(it, s) { if (s.boat) this._toBoat(it, s.boat, s.lx, s.lz); else this._toGround(it, s.x, s.z); }

  // 放下手上的魚：放在面前，面前不能放就放在腳邊
  drop() {
    const it = this.held, p = this.env.player;
    if (!it) return;
    const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);
    for (const d of [0.7, 0.35, 0]) {
      const x = p.x + fx * d, z = p.z + fz * d, s = this._spot(x, z);
      if (!s || s === 'water') continue;
      // 不要從碼頭「放」到下面的沙灘或船上（落差太大）
      const y = s.boat ? s.boat.deckY(x, z) : this.env.ground(x, z);
      if (Math.abs(y - p.y) > 0.9) continue;
      return this._put(it, s);
    }
    if (p.boat) this._toBoat(it, p.boat, p.lx, p.lz); else this._toGround(it, p.x, p.z);
  }

  worldPos(it, out) {
    if (it.state === 'boat') {
      const w = it.boat.toWorld(it.lx, it.lz);
      return out.set(w.x, it.boat.deckY(w.x, w.z), w.z);
    }
    return out.set(it.x, it.y, it.z);
  }

  // 離 pos 最近、伸手拿得到的魚
  nearest(pos, r) {
    let best = null, bd = r;
    const v = new THREE.Vector3();
    for (const it of this.items) {
      this.worldPos(it, v);
      if (Math.abs(v.y - pos.y) > 1.3) continue;
      const d = Math.hypot(v.x - pos.x, v.z - pos.z);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  // 把手上的魚放進船上的魚箱：在箱子裡不會跳、不會滑、不會被浪捲走
  toBox(boat) {
    const it = this.held, B = boat.spec.box;
    if (!it || boat.boxFish.length >= boat.boxCap) return false;
    this._release(it);
    it.state = 'box'; it.boat = boat;
    boat.mesh.add(it.mesh);
    it.mesh.position.set(B.x + rand(-0.25, 0.25) * B.w, boat.spec.deck + 0.1 + 0.05 * boat.boxFish.length, B.z + rand(-0.25, 0.25) * B.d);
    it.mesh.rotation.set(Math.PI / 2, 0, rand(0, Math.PI * 2));
    boat.boxFish.push(it);
    return true;
  }

  // 從魚箱拿一條出來
  fromBox(boat) {
    if (this.held || !boat.boxFish.length) return;
    this._hold(boat.boxFish.pop());
  }

  // 把手上的魚放進商店的籃子
  toBasket() {
    const it = this.held, k = this.env.basket;
    if (!it) return null;
    this._release(it);
    it.state = 'basket'; it.boat = null;
    this.env.scene.add(it.mesh);
    it.mesh.position.set(k.x + rand(-0.2, 0.2), k.y + 0.36 + 0.07 * this.basket.length, k.z + rand(-0.2, 0.2));
    it.mesh.rotation.set(Math.PI / 2, 0, rand(0, Math.PI * 2));
    this.basket.push(it);
    return it;
  }

  get basketTotal() { return this.basket.reduce((s, it) => s + it.value, 0); }
  get basketKg() { return this.basket.reduce((s, it) => s + it.kg, 0); }   // 磅秤的指針用

  // 賣掉籃子裡的魚（uids：伺服器說賣掉了哪幾條；沒給就是全部），回傳金額
  sell(uids = null) {
    let total = 0;
    this.basket = this.basket.filter((it) => {
      if (uids && !uids.includes(it.uid)) return true;
      total += it.value;
      it.mesh.removeFromParent();
      return false;
    });
    return total;
  }

  _lose(it, text) {
    const v = this.worldPos(it, new THREE.Vector3());
    this.env.splash(v.x, Math.max(v.y - 0.6, 0.1), v.z);
    it.mesh.removeFromParent();
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
    this.env.toast(`${it.sp.name}${text}`);
    this._gone([it]);
  }

  // 側躺在甲板或地上；hop = 跳起來的高度
  _pose(it, hop, wiggle = 0) {
    const y = it.thick / 2 + 0.02 + hop;
    if (it.state === 'boat') it.mesh.position.set(it.lx, it.boat.spec.deck + y, it.lz);
    else it.mesh.position.set(it.x, it.y + y, it.z);
    if (it.can) it.mesh.rotation.set(0, it.yaw, 0);   // 油桶是立著放的
    else it.mesh.rotation.set(Math.PI / 2, 0, it.yaw + wiggle);
  }

  update(dt) {
    if (this.held) {
      const it = this.held;
      it.t += dt; it.lively -= dt;
      if (!it.can) it.mesh.rotation.z = it.lively > 0 ? Math.sin(it.t * 9) * 0.12 : 0;   // 在手上扭動
    }

    for (const it of [...this.items]) {
      if (it.boat && it.boat.stored) continue;   // 收在倉庫裡的船：上面的東西原封不動
      it.t += dt; it.lively -= dt;
      const boat = it.boat, onBoat = it.state === 'boat';

      // ---- 正在跳 ----
      if (it.hop) {
        const h = it.hop;
        h.t += dt;
        const s = Math.min(h.t / h.dur, 1);
        if (onBoat) { it.lx = h.x0 + h.dx * s; it.lz = h.z0 + h.dz * s; } else { it.x = h.x0 + h.dx * s; it.z = h.z0 + h.dz * s; }
        this._pose(it, h.h * 4 * s * (1 - s), Math.sin(it.t * 40) * 0.35);
        if (s >= 1) {
          it.hop = null;
          if (h.end === 'lost') { this._lose(it, h.msg || '跳回海裡了'); continue; }
          if (h.end) this._put(it, h.end);
        }
        continue;
      }

      // ---- 活魚每隔幾秒跳一下 ----
      if (it.lively > 0 && (it.flopT -= dt) <= 0) {
        it.flopT = rand(3, 7);
        const a = rand(0, Math.PI * 2), d = rand(0.2, 0.5);
        const dx = Math.cos(a) * d, dz = Math.sin(a) * d;
        let end = null, ok = true;
        if (onBoat) {
          const lx = it.lx + dx, lz = it.lz + dz;
          if (boat.deckContains(lx, lz)) ok = !boat.blockedLocal(lx, lz);
          else if (Math.random() < 0.35) {
            // 跳過船舷：旁邊剛好是碼頭或別艘船就落在上面，否則掉進海裡
            const w = boat.toWorld(lx, lz), s = this._spot(w.x, w.z);
            end = s && s !== 'water' ? s : 'lost';
          } else ok = false;   // 撞到船舷彈回來
        } else {
          const s = this._spot(it.x + dx, it.z + dz);
          if (!s) ok = false; else end = s === 'water' ? 'lost' : s;
        }
        const x0 = onBoat ? it.lx : it.x, z0 = onBoat ? it.lz : it.z;
        it.hop = ok ? { t: 0, dur: 0.35, h: rand(0.2, 0.45), dx, dz, end, x0, z0 }
          : { t: 0, dur: 0.3, h: rand(0.12, 0.25), dx: 0, dz: 0, end: null, x0, z0 };
        continue;
      }

      if (onBoat) {
        // ---- 船一傾斜，魚就往低的那邊滑 ----
        const n = boat.normal, tilt = Math.hypot(n.x, n.z);
        if (tilt > 0.16 || Math.hypot(it.vx, it.vz) > 0.05) {
          const fx = Math.cos(boat.heading), fz = Math.sin(boat.heading);
          const ax = n.x * 9.8, az = n.z * 9.8;
          it.vx += (ax * fx + az * fz) * dt; it.vz += (-ax * fz + az * fx) * dt;
          const k = Math.exp(-2.5 * dt);
          it.vx *= k; it.vz *= k;
          const lx = it.lx + it.vx * dt, lz = it.lz + it.vz * dt;
          if (!boat.deckContains(lx, lz)) {
            if (tilt > 0.32 || Math.hypot(it.vx, it.vz) > 1.4) { this._lose(it, '滑出船外了'); continue; }
            it.vx = it.vz = 0;
          } else if (boat.blockedLocal(lx, lz)) it.vx = it.vz = 0;
          else { it.lx = lx; it.lz = lz; }
        }
        // ---- 船身猛地一晃（開快撞上浪、被浪頭砸到）：沒收進魚箱的魚被拋起來，可能飛出船外 ----
        // 浪本身不會把魚捲走；晃得越兇，拋得越常、越遠
        const jolt = boat.jolt || 0;
        if (!it.can && jolt > 1 && Math.random() < dt * 0.6 * (jolt - 1)) {   // 油桶重，拋不起來
          const a = rand(0, Math.PI * 2), d = rand(0.3, 0.7) * Math.min(jolt, 3.5);
          const dx = Math.cos(a) * d, dz = Math.sin(a) * d, lx = it.lx + dx, lz = it.lz + dz;
          let end = null, ok = true;
          if (boat.deckContains(lx, lz)) ok = !boat.blockedLocal(lx, lz);
          else {
            const w = boat.toWorld(lx, lz), s = this._spot(w.x, w.z);
            end = s && s !== 'water' ? s : 'lost';
          }
          it.vx = it.vz = 0;
          it.hop = ok ? { t: 0, dur: 0.5, h: rand(0.5, 0.9), dx, dz, end, msg: '被甩出船外了', x0: it.lx, z0: it.lz }
            : { t: 0, dur: 0.35, h: rand(0.3, 0.5), dx: 0, dz: 0, end: null, x0: it.lx, z0: it.lz };
          continue;
        }
        this._pose(it, 0);
      }
    }
  }
}
