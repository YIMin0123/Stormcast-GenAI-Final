// 魚：魚種資料、依海域決定釣到什麼，以及「實體的魚」——
// 釣上來拿在手上，可以放下、再拿起；放在甲板或碼頭上會跳，船歪了會滑出船外，船猛地一晃會被拋起來（可能飛出船外）。浪不會把魚捲走。
import * as THREE from 'three';

// kg：重量範圍；price：每公斤價錢；strength：上鉤後掙扎的力道；h / w：身高與厚度（相對於身長）；lenK：身長係數
export const SPECIES = {
  sardine: { name: '沙丁魚', kg: [0.15, 0.4], price: 30, strength: 0.3, color: 0x4f7fb0, h: 0.22, w: 0.11 },
  mackerel: { name: '鯖魚', kg: [0.4, 1.2], price: 30, strength: 0.5, color: 0x1f6f78, h: 0.22, w: 0.12 },
  bream: { name: '黑鯛', kg: [0.6, 1.5], price: 40, strength: 0.6, color: 0x4a4f58, h: 0.42, w: 0.12 },
  flounder: { name: '比目魚', kg: [1.0, 2.5], price: 45, strength: 0.6, color: 0x8a6a3c, h: 0.55, w: 0.06 },
  grouper: { name: '石斑', kg: [1.5, 4.0], price: 50, strength: 0.9, color: 0x9a5a2e, h: 0.36, w: 0.17 },
  eel: { name: '海鰻', kg: [1.3, 3.2], price: 45, strength: 0.8, color: 0x5c5a2a, h: 0.09, w: 0.07, lenK: 0.78 },
  mullet: { name: '烏魚', kg: [1.0, 2.6], price: 35, strength: 0.7, color: 0x7d8790, h: 0.24, w: 0.14 },
  snapper: { name: '紅鯛', kg: [1.1, 2.8], price: 55, strength: 0.8, color: 0xd2493a, h: 0.40, w: 0.13 },
  bonito: { name: '鰹魚', kg: [2.0, 5.0], price: 38, strength: 1.0, color: 0x2a4f8f, h: 0.28, w: 0.17 },
  tuna: { name: '鮪魚', kg: [8, 25], price: 18, strength: 1.2, color: 0x1c2f5e, h: 0.30, w: 0.20 },
  // 只在晚上出現的魚
  squid: { name: '小卷', kg: [0.1, 0.4], price: 75, strength: 0.3, color: 0xd99a94, h: 0.26, w: 0.2 },
  hairtail: { name: '白帶魚', kg: [0.5, 1.8], price: 62, strength: 0.7, color: 0xc4ccd6, h: 0.07, w: 0.03, lenK: 0.95 },
  swordfish: { name: '旗魚', kg: [15, 40], price: 22, strength: 1.12, color: 0x27386e, h: 0.22, w: 0.15, lenK: 0.5 },
};

// 每座島附近的特產
export const SPECIALTY = { home: 'bream', west: 'flounder', twin: 'grouper', rocks: 'eel', sand: 'mullet', east: 'snapper' };

// 依水深、最近的島、離岸多遠決定釣到什麼：岸邊是小魚，島的周圍有特產，離陸地越遠魚越大越貴
// off：離最近的陸地幾公尺。四個海域——淺灘、近海（一百多公尺內）、離岸（兩百多公尺）、外海、遠洋（四百公尺以上）；
// 海域的交界不是一刀切，前後幾十公尺兩邊的魚都釣得到
// 晚上多了夜裡才出來的魚：岸邊的小卷、島周圍的白帶魚、外海的旗魚
export function pickSpecies(depth, islandId, off, night = false) {
  const local = SPECIALTY[islandId] ?? 'mackerel';
  const d = off + (Math.random() - 0.5) * 70;
  const table = night
    ? (depth < 7 ? [['squid', 55], ['sardine', 30], [local, 15]]
      : d < 120 ? [['hairtail', 40], [local, 30], ['mackerel', 20], ['squid', 10]]
        : d < 250 ? [['hairtail', 35], ['mackerel', 30], ['bonito', 25], ['swordfish', 10]]
          : d < 400 ? [['bonito', 35], ['swordfish', 30], ['tuna', 20], ['hairtail', 15]]
            : [['swordfish', 45], ['tuna', 35], ['bonito', 20]])
    : depth < 7 ? [['sardine', 70], [local, 30]]
      : d < 120 ? [[local, 45], ['mackerel', 40], ['sardine', 15]]
        : d < 250 ? [['mackerel', 50], ['bonito', 35], [local, 15]]
          : d < 400 ? [['bonito', 45], ['tuna', 25], ['mackerel', 30]]
            : [['tuna', 50], ['bonito', 40], ['mackerel', 10]];
  let r = Math.random() * table.reduce((s, t) => s + t[1], 0);
  for (const [id, w] of table) { r -= w; if (r <= 0) return id; }
  return table[0][0];
}

const typicalLength = (id, kg) => (SPECIES[id].lenK ?? 0.42) * Math.cbrt(kg);

// 擲出一條魚的重量與身長：小的多、大的少；同樣重量的魚有的修長、有的短胖
// big：0–1，離岸越遠、浪越大的日子，魚的個頭越大（大的變多）；
// giant：0–1，遠洋才有的超大個體——重量的上限最多再高六成（比圖鑑上最大的還大）
export function rollFish(id, big = 0, giant = 0) {
  const [a, b] = SPECIES[id].kg, r = Math.random();
  const top = b * (1 + 0.6 * giant);
  const kg = +(a + (top - a) * Math.pow(r, 2 - 1.2 * big)).toFixed(2);
  const len = +(typicalLength(id, kg) * (0.92 + Math.random() * 0.16)).toFixed(2);
  return { kg, len };
}

// 價錢看重量和身長：同一種魚，越重單價越高（最小的打八折、最大的一點四倍），比同重量的魚修長再加價
export function fishValue(id, kg, len) {
  const sp = SPECIES[id], [a, b] = sp.kg;
  const q = Math.min(1, Math.max(0, (kg - a) / (b - a)));
  const shape = Math.pow(len / typicalLength(id, kg), 1.5);
  return Math.max(1, Math.round(sp.price * kg * (0.8 + 0.6 * q) * shape));
}

// 畫面上顯示用：「鯖魚　38 公分　0.82 公斤」
export const fishLabel = (it) => `${it.sp.name}　${Math.round(it.len * 100)} 公分　${it.kg.toFixed(2)} 公斤`;

// 魚的模型：+X 是頭，Y 是背。背上是魚種的顏色、肚子是白的
function makeFishMesh(sp, len) {
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
export class FishWorld {
  constructor(env) {
    this.env = env;
    this.items = [];    // 放在甲板或地上的魚
    this.basket = [];   // 籃子裡等著賣的魚
    this.held = null;   // 拿在手上的那一條
  }

  // 剛釣上來：直接拿在手上
  spawnHeld(id, kg, len = typicalLength(id, kg)) {
    const sp = SPECIES[id];
    const it = {
      id, sp, kg, value: fishValue(id, kg, len), len, thick: len * sp.w,
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
  stowFish(boat, id, kg, len) {
    const keep = this.held;
    this.held = null;
    this.spawnHeld(id, kg, len).lively = 0;
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
    for (const it of this.items.filter((o) => o.boat === boat)) {
      it.mesh.removeFromParent();
      this.items.splice(this.items.indexOf(it), 1);
    }
    for (const it of boat.boxFish) it.mesh.removeFromParent();
    boat.boxFish.length = 0;
    if (aboard) this.discardHeld();
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

  // 賣掉籃子裡所有的魚，回傳金額
  sell() {
    const total = this.basketTotal;
    for (const it of this.basket) it.mesh.removeFromParent();
    this.basket.length = 0;
    return total;
  }

  _lose(it, text) {
    const v = this.worldPos(it, new THREE.Vector3());
    this.env.splash(v.x, Math.max(v.y - 0.6, 0.1), v.z);
    it.mesh.removeFromParent();
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
    this.env.toast(`${it.sp.name}${text}`);
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
