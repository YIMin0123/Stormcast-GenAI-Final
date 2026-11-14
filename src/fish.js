// 魚：魚種資料、依海域決定釣到什麼，以及「實體的魚」——
// 釣上來拿在手上，可以放下、再拿起；放在甲板或碼頭上會跳，船歪了會滑出船外，船猛地一晃會被拋起來（可能飛出船外）。浪不會把魚捲走。
import * as THREE from 'three';

import { SPECIES, typicalLength, fishValue } from './fishdata.js';
import { THROW } from './config.js';
// 魚種資料、「釣到什麼、多大、值多少」的規則在 fishdata.js（伺服器也用同一份）
export { SPECIES, SPECIALTY, pickSpecies, rollFish, fishValue, fishLabel } from './fishdata.js';

// 雜物與章魚的模型：長邊朝 +X、Y 朝上，先照身長 1 蓋好，最後整個乘上 len
const JUNK_MODELS = {
  slipper(g, col, M) {
    M(0xf2efe6, 1, 0.07, 0.38, 0, 0.035, 0);                      // 鞋底
    M(col, 0.34, 0.07, 0.38, 0.18, 0.1, 0);                       // 腳背的帶子
    M(col, 0.1, 0.05, 0.1, 0.34, 0.08, 0);
  },
  tin(g, col, M, C) {
    C(0xbfc4ca, 0.2, 0.2, 0.5, 0, 0.2, 0);
    C(0xc23a2e, 0.205, 0.205, 0.16, 0, 0.2, 0);                   // 標籤
    C(0x8d9399, 0.19, 0.19, 0.03, 0.26, 0.2, 0);
  },
  bottle(g, col, M, C) {
    C(col, 0.13, 0.13, 0.5, -0.06, 0.13, 0, 0.55);
    C(col, 0.07, 0.07, 0.18, 0.28, 0.13, 0, 0.55);
    C(0x2b77c9, 0.06, 0.06, 0.06, 0.4, 0.13, 0);                  // 瓶蓋
  },
  msgbottle(g, col, M, C) {
    C(col, 0.14, 0.14, 0.52, -0.05, 0.14, 0, 0.5);
    C(col, 0.075, 0.075, 0.18, 0.3, 0.14, 0, 0.5);
    C(0xf1e3b8, 0.06, 0.06, 0.34, -0.02, 0.14, 0);                // 裡面的紙捲
    C(0x9a6b3a, 0.06, 0.06, 0.07, 0.42, 0.14, 0);                 // 軟木塞
  },
  net(g, col, M) {
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI, y = 0.04 + Math.random() * 0.08;
      const m = M(col, 0.9, 0.02, 0.02, (Math.random() - 0.5) * 0.3, y, (Math.random() - 0.5) * 0.3);
      m.rotation.y = a; m.rotation.z = (Math.random() - 0.5) * 0.5;
    }
    for (let i = 0; i < 3; i++) M(0xe0553a, 0.07, 0.07, 0.07, (Math.random() - 0.5) * 0.7, 0.07, (Math.random() - 0.5) * 0.5);   // 浮標
  },
  tire(g, col) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.14, 8, 18), new THREE.MeshLambertMaterial({ color: col }));
    t.rotation.x = Math.PI / 2; t.position.y = 0.14; g.add(t);
  },
  key(g, col, M) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.04, 6, 12), new THREE.MeshLambertMaterial({ color: col }));
    r.rotation.x = Math.PI / 2; r.position.set(-0.4, 0.04, 0); g.add(r);
    M(col, 0.7, 0.05, 0.06, 0.05, 0.04, 0);
    M(col, 0.06, 0.05, 0.14, 0.32, 0.04, 0.06); M(col, 0.06, 0.05, 0.1, 0.42, 0.04, 0.05);
  },
  duck(g, col) {
    const mat = new THREE.MeshLambertMaterial({ color: col });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), mat); body.scale.set(1.2, 0.85, 0.9); body.position.y = 0.28; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat); head.position.set(0.3, 0.6, 0); g.add(head);
    const beak = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.14), new THREE.MeshLambertMaterial({ color: 0xf08a2a })); beak.position.set(0.5, 0.58, 0); g.add(beak);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), new THREE.MeshBasicMaterial({ color: 0x111111 })); e.position.set(0.42, 0.66, s * 0.1); g.add(e); }
  },
  float(g, col) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.7 }));
    s.position.y = 0.4; g.add(s);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.1, 8), new THREE.MeshLambertMaterial({ color: 0x4a5a3a })); cap.position.y = 0.82; g.add(cap);
  },
  coins(g, col) {
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), new THREE.MeshLambertMaterial({ color: 0x6b4a2a })); bag.scale.y = 0.9; bag.position.y = 0.32; g.add(bag);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.14, 8), new THREE.MeshLambertMaterial({ color: 0x4a321c })); neck.position.y = 0.66; g.add(neck);
    const gold = new THREE.MeshLambertMaterial({ color: col });
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 10), gold);
      c.position.set(0.3 + (i % 3) * 0.12 - 0.2, 0.03 + Math.floor(i / 3) * 0.04, 0.4 + (i % 2) * 0.1); g.add(c);
    }
  },
  octopus(g, col) {
    const mat = new THREE.MeshLambertMaterial({ color: col });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat); head.scale.set(0.95, 1.2, 0.95); head.position.set(-0.28, 0.34, 0); g.add(head);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), new THREE.MeshBasicMaterial({ color: 0x111111 })); e.position.set(-0.12, 0.28, s * 0.14); g.add(e); }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.07, 0.62, 6), mat);
      leg.position.set(0.05 + Math.cos(a) * 0.3, 0.06, Math.sin(a) * 0.3);
      leg.rotation.set(Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25);
      g.add(leg);
    }
  },
};
function makeJunkMesh(sp, len) {
  const g = new THREE.Group(), col = sp.color;
  const mats = new Map();
  const mat = (c, o) => { const k = `${c}|${o ?? 1}`; if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color: c, transparent: o < 1, opacity: o ?? 1 })); return mats.get(k); };
  const M = (c, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(c)); m.position.set(x, y, z); g.add(m); return m; };
  // 橫躺的圓柱（軸朝 +X）
  const C = (c, rt, rb, h, x, y, z, o) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 12), mat(c, o)); m.rotation.z = Math.PI / 2; m.position.set(x, y, z); g.add(m); return m; };
  JUNK_MODELS[sp.model](g, col, M, C);
  g.scale.setScalar(len);
  return g;
}

// 魚的模型：+X 是頭，Y 是背。背上是魚種的顏色、肚子是白的
export function makeFishMesh(sp, len) {
  if (sp.model) return makeJunkMesh(sp, len);
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
  const hh = sp.h * 0.5, fin = sp.fin ?? 1;   // fin：背鰭放大幾倍（鯊魚）
  tri([[-0.34, 0, 0], [-0.52, hh * 1.15, 0], [-0.46, 0, 0]]);        // 尾鰭上半
  tri([[-0.34, 0, 0], [-0.46, 0, 0], [-0.52, -hh * 1.15, 0]]);       // 尾鰭下半
  tri([[0.12, hh * 0.9, 0], [-0.16, hh * 0.85, 0], [-0.12, hh * (0.85 + 0.6 * fin), 0]]); // 背鰭
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
      lively: sp.kind === 'junk' ? 0 : 80,   // 還會活蹦亂跳多久（秒）；雜物不會動
      flopT: sp.kind === 'junk' ? 1e9 : rand(2, 5), hop: null, wash: 0, t: Math.random() * 10,
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

  _toGround(it, x, z, y = this.env.ground(x, z)) {
    this._release(it);
    it.state = 'ground'; it.boat = null; it.x = x; it.z = z; it.y = y;
    this.env.scene.add(it.mesh);
    if (!this.items.includes(it)) this.items.push(it);
    this._pose(it, 0);
  }

  // 某個位置能不能放魚：回傳 { boat, lx, lz } / { x, z } / null（牆）/ 'water'
  // y：丟出去還在飛的東西的高度（木箱頂、石頭上落不落得上去要看它飛多高，見 env.flyGround）
  _spot(x, z, y) {
    for (const b of this.env.boats) {
      if (b.sinking) continue;
      const l = b.toLocal(x, z);
      if (b.deckContains(l.x, l.z)) return b.blockedLocal(l.x, l.z) ? null : { boat: b, lx: l.x, lz: l.z };
    }
    const g = y !== undefined && this.env.flyGround ? this.env.flyGround(x, z, y) : this.env.ground(x, z);
    if (g > 90) return null;
    if (g < -0.2) return 'water';
    return { x, z };
  }

  _put(it, s, y) { if (s.boat) this._toBoat(it, s.boat, s.lx, s.lz); else this._toGround(it, s.x, s.z, y); }

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

  // 把手上的魚放進船上的魚箱：在箱子裡不會跳、不會滑、不會被浪捲走（it：丟過來掉進箱子的那條）
  toBox(boat, it = this.held) {
    const B = boat.spec.box;
    if (!it || boat.boxFish.length >= boat.boxCap) return false;
    this._release(it);
    this._unlist(it);
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

  // 把手上的魚放進商店的籃子（it：丟過來掉進籃子的那條）
  toBasket(it = this.held) {
    const k = this.env.basket;
    if (!it) return null;
    this._release(it);
    this._unlist(it);
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

  _unlist(it) {
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
  }

  _lose(it, text) {
    const v = this.worldPos(it, new THREE.Vector3());
    this.env.splash(v.x, Math.max(v.y - 0.6, 0.1), v.z);
    it.mesh.removeFromParent();
    this._unlist(it);
    this.env.toast(`${it.sp.name}${text}`);
    this._gone([it]);
  }

  // ---- 丟出去 ----
  // 手上的東西從 o（世界座標，手的位置）以速度 v 丟出去：之後照拋物線飛，落地的處理見 _fly
  throwHeld(o, v) {
    const it = this.held, p = this.env.player;
    if (!it) return null;
    this._release(it);
    it.mesh.removeFromParent();
    this.env.scene.add(it.mesh);
    it.state = 'fly'; it.boat = null;
    it.x = o.x; it.z = o.z; it.y = o.y - it.thick / 2;   // y 是東西的底
    if (!this._spot(it.x, it.z, it.y)) { it.x = p.x; it.z = p.z; }   // 手伸進牆裡：從人站的地方出手
    it.fly = { vx: v.x, vy: v.y, vz: v.z, t: 0, spin: rand(7, 12) * (Math.random() < 0.5 ? -1 : 1), a: 0, okx: it.x, okz: it.z };
    this.items.push(it);
    this._flyPose(it);
    return it;
  }

  // 某個位置底下的地面高度：甲板、地面、海面（'water' 時是浪高）；牆是 null。y 同 _spot
  _floor(s, x, z, y) {
    if (!s) return null;
    if (s === 'water') return this.env.waveAt ? this.env.waveAt(x, z) : 0;
    if (s.boat) return s.boat.deckY(x, z);
    return y !== undefined && this.env.flyGround ? this.env.flyGround(x, z, y) : this.env.ground(x, z);
  }

  // (x, z) 在不在籃子、自己船上魚箱的範圍裡（那一塊對人來說是牆）：
  // 回傳 { rim 口的高度, into 從口掉下去會落進哪裡（'basket' 或那艘船；油桶、魚箱滿了、打在邊上是 null） }
  _over(it, x, z) {
    const k = this.env.basket;
    if (k) {
      const d = Math.hypot(x - k.x, z - k.z);
      if (d < 0.75) return { rim: k.y + 0.53, into: !it.can && d < 0.4 ? 'basket' : null };
    }
    const b = this.env.ownBoat && this.env.ownBoat();
    if (b && !b.sinking && b.boxCap > 0) {
      const B = b.spec.box, l = b.toLocal(x, z), ax = Math.abs(l.x - B.x), az = Math.abs(l.z - B.z);
      if (ax < B.w / 2 + 0.1 && az < B.d / 2 + 0.1) {
        const room = !it.can && b.boxFish.length < b.boxCap && ax < B.w / 2 && az < B.d / 2;
        return { rim: b.deckY(x, z) + B.h, into: room ? b : null };
      }
    }
    return null;
  }

  _flyPose(it) {
    const F = it.fly, m = it.mesh;
    m.position.set(it.x, it.y + it.thick / 2, it.z);
    const yaw = -Math.atan2(F.vz, F.vx);
    if (it.can) m.rotation.set(F.a * 0.4, yaw, F.a);       // 油桶慢慢翻
    else m.rotation.set(F.a, yaw, Math.atan2(F.vy, Math.hypot(F.vx, F.vz)));   // 魚：頭朝飛的方向、身體打轉
  }

  _fly(it, dt) {
    const F = it.fly, G = THROW.gravity, n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    F.t += dt; F.a += F.spin * dt * (it.can ? 0.4 : 1);
    for (let i = 0; i < n; i++) {
      F.vy -= G * h;
      const nx = it.x + F.vx * h, nz = it.z + F.vz * h, ny = it.y + F.vy * h;
      // 籃子、魚箱：比口高就照飛；從口掉下去就算放進去
      const c = this._over(it, nx, nz);
      if (c) {
        if (ny > c.rim) { it.x = nx; it.z = nz; it.y = ny; continue; }
        if (c.into && it.y >= c.rim - 0.1) {
          it.fly = null;
          if (c.into === 'basket') this.toBasket(it); else this.toBox(c.into, it);
          if (this.env.landed) this.env.landed(it, c.into === 'basket' ? 'basket' : 'box', new THREE.Vector3(nx, ny, nz));
          return;
        }
        // 掉不進去（油桶、魚箱滿了、打在邊上）：跟撞到牆一樣彈開
      }
      const s0 = this._spot(it.x, it.z, it.y), f0 = this._floor(s0, it.x, it.z, it.y);
      let s = this._spot(nx, nz, ny), f = this._floor(s, nx, nz, ny);
      // 撞到牆、船艙、或是比自己高的碼頭邊、船舷：水平方向彈回來，照樣往下掉
      if (f === null || (f > ny + 0.25 && (f0 === null || f > f0 + 0.25))) {
        F.vx *= -THROW.bounce; F.vz *= -THROW.bounce;
        it.y = ny;
        s = s0; f = f0;
        // 腳下也是牆（從籃子、魚箱上方掉下來卻掉不進去，或是船開過來把船艙移到底下）：推回上一個落得了地的地方
        if (f === null) { it.x = F.okx; it.z = F.okz; s = this._spot(it.x, it.z, it.y); f = this._floor(s, it.x, it.z, it.y); }
      } else { it.x = nx; it.z = nz; it.y = ny; }
      if (f === null) continue;
      F.okx = it.x; F.okz = it.z;
      if (it.y > f) continue;
      // ---- 落地 ----
      it.fly = null;
      if (s === 'water') { this._lose(it, '掉進海裡了'); if (this.env.landed) this.env.landed(it, 'water', new THREE.Vector3(it.x, f, it.z)); return; }
      const hv = Math.hypot(F.vx, F.vz), imp = -F.vy;
      this._put(it, s, f);
      if (this.env.landed) this.env.landed(it, s.boat ? 'deck' : 'ground', new THREE.Vector3(it.x, f, it.z));
      if (it.can || (hv < 0.5 && imp < 2)) return;   // 油桶重，不會跳；輕輕落下的魚也不跳
      // 魚落地彈一下：往飛的方向再跳一小段（彈出船外、碼頭外就掉進海裡）
      let dx = F.vx, dz = F.vz;
      if (s.boat) { const a = s.boat.toLocal(it.x, it.z), b = s.boat.toLocal(it.x + F.vx, it.z + F.vz); dx = b.x - a.x; dz = b.z - a.z; }
      const d = Math.min(hv * 0.07, 0.9) / Math.max(hv, 1e-3);
      this._bounce(it, dx * d, dz * d, Math.min(0.12 + imp * 0.03, 0.45), '彈進海裡了');
      return;
    }
    if (F.t > 8 || it.y < -20) { it.fly = null; this._lose(it, '掉進海裡了'); return; }   // 保險：怎麼都落不了地
    this._flyPose(it);
  }

  // 在甲板或地上跳一下：(dx, dz) 是跳多遠（在船上時是船身座標）；跳出去落在海裡就沒了
  _bounce(it, dx, dz, h, msg) {
    const boat = it.boat, onBoat = it.state === 'boat';
    let end = null, ok = true;
    if (onBoat) {
      const lx = it.lx + dx, lz = it.lz + dz;
      if (boat.deckContains(lx, lz)) ok = !boat.blockedLocal(lx, lz);
      else { const w = boat.toWorld(lx, lz), s = this._spot(w.x, w.z); end = s && s !== 'water' ? s : 'lost'; }
    } else {
      const s = this._spot(it.x + dx, it.z + dz);
      if (!s) ok = false; else end = s === 'water' ? 'lost' : s;
    }
    const x0 = onBoat ? it.lx : it.x, z0 = onBoat ? it.lz : it.z;
    it.hop = ok ? { t: 0, dur: 0.3 + h * 0.4, h, dx, dz, end, msg, x0, z0 }
      : { t: 0, dur: 0.25, h: h * 0.6, dx: 0, dz: 0, end: null, x0, z0 };
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
      if (it.fly) { this._fly(it, dt); continue; }   // 丟出去還在飛
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
