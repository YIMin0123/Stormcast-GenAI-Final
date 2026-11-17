// 魚：魚種資料、依海域決定釣到什麼，以及「實體的魚」——
// 釣上來拿在手上，可以放下、再拿起；放在甲板或碼頭上會跳，船歪了會滑出船外，船猛地一晃會被拋起來（可能飛出船外）。浪不會把魚捲走。
import * as THREE from 'three';

import { SPECIES, typicalLength, fishValue } from './fishdata.js';
import { THROW } from './config.js';
import { makeFishModel, flexFish } from './fishModel.js';
// 魚種資料、「釣到什麼、多大、值多少」的規則在 fishdata.js（伺服器也用同一份）
export { SPECIES, SPECIALTY, pickSpecies, rollFish, fishValue, fishLabel } from './fishdata.js';

// 雜物的模型：長邊朝 +X、Y 朝上，先照身長 1 蓋好，最後整個乘上 len
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

// 魚（和章魚、小卷）的模型在 fishModel.js；雜物的模型在上面
export function makeFishMesh(sp, len) {
  return sp.kind === 'junk' ? makeJunkMesh(sp, len) : makeFishModel(sp, len);
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
//   placed(it)：自己的魚放在外面了（地上、甲板上、籃子裡），大家都看得到、誰都撿得走；taken(it)：又收回來了（拿回手上、放進魚箱）
//   boatOf(id)：某個玩家的船（別人的魚放在誰的船上）
// 別人的魚（remote）也放在 items、basket 裡：畫出來、可以撿，但不會自己跳、不會滑——它們在主人那邊動，動完了位置再傳過來
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

  // 讀檔用：把一桶油放在甲板上
  stowCan(boat, lx, lz, liters) {
    const keep = this.held;
    this.held = null;
    this._toBoat(this.spawnCan(liters), boat, lx, lz);
    this.held = keep;
    this.env.player.carry = !!keep;
  }

  // 全部清掉（進到一間新的房間時）：地上、甲板上、籃子裡、手上的都不留（魚箱另外由 fishBox.js 照伺服器重畫）
  clearAll() {
    for (const it of [...this.items, ...this.basket]) it.mesh.removeFromParent();
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

  // 船沉了：甲板上的東西都沒了（魚箱會浮起來，由伺服器處理）；人也在船上的話，手上的也沒了
  wreck(boat, aboard) {
    const gone = [];
    for (const it of this.items.filter((o) => o.boat === boat)) {
      it.mesh.removeFromParent();
      this.items.splice(this.items.indexOf(it), 1);
      gone.push(it);
    }
    if (aboard && this.held) { gone.push(this.held); this.discardHeld(); }
    this._gone(gone);
  }

  _gone(list) {
    const uids = list.filter((it) => it.uid && !it.remote).map((it) => it.uid);
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

  // 自己的魚放在外面了：告訴大家（別人的、油桶、還沒編號的不用）
  _pub(it) {
    if (!it.uid || it.can || it.remote) return;
    it.pub = true;
    if (this.env.placed) this.env.placed(it);
  }
  // 收回來了（拿回手上、放進魚箱）：從外面拿掉
  _unpub(it) {
    if (!it.pub) return;
    it.pub = false;
    if (this.env.taken) this.env.taken(it);
  }

  _hold(it) {
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
    const k = this.basket.indexOf(it);
    if (k >= 0) this.basket.splice(k, 1);
    this._unpub(it);
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
    this._pub(it);
  }

  _toGround(it, x, z, y = this.env.ground(x, z)) {
    this._release(it);
    it.state = 'ground'; it.boat = null; it.x = x; it.z = z; it.y = y;
    this.env.scene.add(it.mesh);
    if (!this.items.includes(it)) this.items.push(it);
    this._pose(it, 0);
    this._pub(it);
  }

  // ---- 別人放在外面的魚（伺服器傳來的）----
  // d：{ uid, id, kg, len, value, o 主人, k 放在哪 g 地上／d 甲板／b 籃子, x, y, z, yaw, b 誰的船 }
  addRemote(d) {
    this.removeRemote(d.uid);
    const sp = SPECIES[d.id];
    if (!sp) return;
    const it = {
      uid: d.uid, id: d.id, sp, kg: d.kg, value: d.value, len: d.len, thick: d.len * sp.w, remote: true, owner: d.o,
      mesh: makeFishMesh(sp, d.len), state: 'ground', boat: null,
      x: d.x, z: d.z, y: d.y, lx: 0, lz: 0, yaw: d.yaw, vx: 0, vz: 0, lively: 0, flopT: 1e9, hop: null, wash: 0, t: 0,
    };
    if (d.k === 'b') {
      it.state = 'basket';
      this.env.scene.add(it.mesh);
      it.mesh.position.set(d.x, d.y, d.z);
      it.mesh.rotation.set(Math.PI / 2, 0, d.yaw);
      this.basket.push(it);
      return it;
    }
    if (d.k === 'd') {
      const b = this.env.boatOf && this.env.boatOf(d.b);
      if (!b) return null;   // 那艘船這裡還沒有（剛進來）：先不畫
      it.state = 'boat'; it.boat = b; it.lx = d.x; it.lz = d.z;
      b.mesh.add(it.mesh);
    } else this.env.scene.add(it.mesh);
    this.items.push(it);
    this._pose(it, 0);
    return it;
  }

  // 別人的魚被撿走、賣掉、消失了
  removeRemote(uid) {
    for (const list of [this.items, this.basket]) {
      const i = list.findIndex((o) => o.remote && o.uid === uid);
      if (i >= 0) { list[i].mesh.removeFromParent(); list.splice(i, 1); }
    }
  }

  // 伺服器通知一條魚已離開玩家的持有清單。
  removeOwn(uid) {
    if (uid && this.held?.uid === uid) {
      const it = this.held;
      this.discardHeld();
      return it;
    }
    for (const list of [this.items, this.basket]) {
      const i = list.findIndex((o) => !o.remote && o.uid === uid);
      if (i >= 0) { const it = list[i]; it.mesh.removeFromParent(); list.splice(i, 1); it.pub = false; return it; }
    }
    return null;
  }

  // 斷線可能漏收釣獲、送魚或售出的結果，先用伺服器的清單對齊持有權。
  reconcileOwn(privateFish, loose, myId, boat) {
    const owned = new Set(privateFish.map((f) => f.uid));
    for (const d of loose) if (d.o === myId) owned.add(d.uid);
    for (const it of [...this.items, ...this.basket, this.held]) {
      if (it?.uid && !it.remote && !owned.has(it.uid)) this.removeOwn(it.uid);
    }
    this.applyLoose(loose, myId);
    const have = new Set([...this.items, ...this.basket, this.held].filter((it) => it && !it.remote).map((it) => it.uid));
    for (const f of privateFish) {
      if (!have.has(f.uid)) this.stowDeck(boat, 0, 0, f.id, f.kg, f.len, f.uid, f.value);
    }
  }

  // 進房、斷線接回來：照伺服器清單重畫鬆散漁獲。
  applyLoose(list, myId) {
    for (const it of [...this.items, ...this.basket]) if (it.remote) this.removeRemote(it.uid);
    const have = new Set([...this.items, ...this.basket].filter((it) => !it.remote && it.uid).map((it) => it.uid));
    const there = new Set(list.map((d) => d.uid));
    // 自己放在外面、伺服器那邊已經沒有的（斷線時被撿走、消失了）：這裡也拿掉
    for (const uid of have) if (!there.has(uid) && [...this.items, ...this.basket].find((o) => o.uid === uid && o.pub)) this.removeOwn(uid);
    for (const d of list) {
      if (d.o !== myId) { this.addRemote(d); continue; }
      if (have.has(d.uid)) continue;
      if (this.held?.uid === d.uid) this.discardHeld();
      // 自己的、這邊沒有（關掉分頁又回來）：照伺服器記的位置放回去
      const keep = this.held;
      this.held = null;
      const it = this.spawnHeld(d.id, d.kg, d.len, d.uid, d.value);
      it.lively = 0;
      const b = d.k === 'd' && this.env.boatOf ? this.env.boatOf(d.b) || this.env.boatOf(myId) : null;   // 那艘船不在了：放到自己船上
      if (d.k === 'b') this.toBasket(it);
      else if (b) this._toBoat(it, b, d.x, d.z);
      else this._toGround(it, d.x, d.z, d.y);
      this.held = keep;
      this.env.player.carry = !!keep;
    }
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

  _boatDeckY(b, x, z) { return b.walkDeckY?.(x, z) ?? b.deckY(x, z); }

  // 船身局部移動能不能從 (x0, z0) 到 (lx, lz)：避開艙壁障礙，也不能平貼著滑上高 0.28 的艙蓋
  _boatCanMove(boat, x0, z0, lx, lz, hopH = 0) {
    if (boat.blockedLocal(lx, lz)) return false;
    return hopH >= 0.28 || !!boat.onHatch?.(x0, z0) || !boat.onHatch?.(lx, lz);
  }

  // 放下手上的魚：放在面前，面前不能放就放在腳邊
  drop() {
    const it = this.held, p = this.env.player;
    if (!it) return;
    const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);
    for (const d of [0.7, 0.35, 0]) {
      const x = p.x + fx * d, z = p.z + fz * d, s = this._spot(x, z);
      if (!s || s === 'water') continue;
      // 不要從碼頭「放」到下面的沙灘或船上（落差太大）
      const y = s.boat ? this._boatDeckY(s.boat, x, z) : this.env.ground(x, z);
      if (Math.abs(y - p.y) > 0.9) continue;
      return this._put(it, s);
    }
    if (p.boat) this._toBoat(it, p.boat, p.lx, p.lz); else this._toGround(it, p.x, p.z);
  }

  worldPos(it, out) {
    if (it.state === 'basket') return out.copy(it.mesh.position);
    if (it.state === 'boat') {
      const w = it.boat.toWorld(it.lx, it.lz);
      return out.set(w.x, this._boatDeckY(it.boat, w.x, w.z), w.z);
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

  // 把手上的魚放進商店的籃子（it：丟過來掉進籃子的那條）
  toBasket(it = this.held) {
    const k = this.env.basket;
    if (!it) return null;
    this._release(it);
    this._unlist(it);
    it.state = 'basket'; it.boat = null;
    this.env.scene.add(it.mesh);
    it.mesh.position.set(k.x + rand(-0.2, 0.2), k.y + 0.36 + 0.07 * Math.min(this.basket.length, 8), k.z + rand(-0.2, 0.2));
    it.mesh.rotation.set(Math.PI / 2, 0, rand(0, Math.PI * 2));
    this.basket.push(it);
    this._pub(it);   // 籃子是大家共用的：放進去大家都看得到
    return it;
  }

  // 籃子裡大家的魚（自己的、別人的）加起來：看板、磅秤用
  get basketTotal() { return this.basket.reduce((s, it) => s + it.value, 0); }
  get basketKg() { return this.basket.reduce((s, it) => s + it.kg, 0); }   // 磅秤的指針用

  // 賣掉籃子裡自己的魚（uids：伺服器說賣掉了哪幾條；沒給就是自己的全部），回傳金額。別人的由伺服器另外通知拿掉
  sell(uids = null) {
    let total = 0;
    this.basket = this.basket.filter((it) => {
      if (it.remote || (uids && !uids.includes(it.uid))) return true;
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

  // 被海鷗叼走：魚從外面（地上、甲板）拿掉、算「魚沒了」（伺服器那邊也會刪掉）。回傳牠的模型給海鷗叼著
  steal(it) {
    this._unlist(it);
    it.pub = false;
    it.mesh.removeFromParent();
    it.mesh.position.set(0, 0, 0); it.mesh.rotation.set(0, 0, 0); it.mesh.scale.set(1, 1, 1);
    this.env.toast(`${it.sp.name}被海鷗叼走了！`);
    this._gone([it]);
    return it.mesh;
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
    if (s.boat) return this._boatDeckY(s.boat, x, z);
    return y !== undefined && this.env.flyGround ? this.env.flyGround(x, z, y) : this.env.ground(x, z);
  }

  // (x, z) 在不在籃子、魚箱的範圍裡（那一塊對人來說是牆）：
  // 回傳 { rim 口的高度, into 從口掉下去會落進哪裡（'basket' 或魚箱的 bid；油桶、魚箱滿了、魚太長、打在邊上是 null） }
  _over(it, x, z) {
    const k = this.env.basket;
    if (k) {
      const d = Math.hypot(x - k.x, z - k.z);
      if (d < 0.75) return { rim: k.y + 0.53, into: !it.can && d < 0.4 ? 'basket' : null };
    }
    // 放在地上、甲板上的魚箱（誰的都可以：丟進別人的箱子就是送給他）
    return this.env.boxOver ? this.env.boxOver(x, z, it) : null;
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
          if (c.into === 'basket') this.toBasket(it);
          else { this._unlist(it); it.mesh.removeFromParent(); this.env.intoBox(it, c.into); }   // 掉進魚箱：交給伺服器放進去（放不進去會再擺回箱子旁邊）
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
      if (boat.deckContains(lx, lz)) ok = this._boatCanMove(boat, it.lx, it.lz, lx, lz, h);
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
    if (it.state === 'boat') it.mesh.position.set(it.lx, (it.boat.deckLocalY?.(it.lx, it.lz) ?? it.boat.spec.deck) + y, it.lz);
    else it.mesh.position.set(it.x, it.y + y, it.z);
    if (it.can) it.mesh.rotation.set(0, it.yaw, 0);   // 油桶是立著放的
    else it.mesh.rotation.set(Math.PI / 2, 0, it.yaw + wiggle);
  }

  update(dt) {
    if (this.held) {
      const it = this.held;
      it.t += dt; it.lively -= dt;
      if (!it.can) {   // 在手上扭動：身體一陣一陣地甩（剛釣上來最兇，慢慢沒力）
        it.mesh.rotation.z = it.lively > 0 ? Math.sin(it.t * 9) * 0.05 : 0;
        flexFish(it.mesh, it.lively > 0 ? Math.min(1, it.lively / 25) * (Math.sin(it.t * 1.3) > 0.2 ? 1 : 0.3) : 0, dt);
      }
    }

    for (const it of [...this.items]) {
      if (it.remote || (it.boat && it.boat.stored)) continue;   // 別人的魚（在主人那邊動）、收在倉庫裡的船上的東西：原封不動
      it.t += dt; it.lively -= dt;
      flexFish(it.mesh, it.lively > 0 ? (it.hop || it.fly ? 1.3 : 0.25) : 0, dt);   // 活魚躺著時輕輕擺尾、跳起來用力甩
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
          if (h.end) this._put(it, h.end); else if (h.dx || h.dz) this._pub(it);   // 跳到別的地方：位置告訴大家
        }
        continue;
      }

      // ---- 活魚每隔幾秒跳一下 ----
      if (it.lively > 0 && (it.flopT -= dt) <= 0) {
        it.flopT = rand(3, 7);
        const a = rand(0, Math.PI * 2), d = rand(0.2, 0.5), h = rand(0.2, 0.45);
        const dx = Math.cos(a) * d, dz = Math.sin(a) * d;
        let end = null, ok = true;
        if (onBoat) {
          const lx = it.lx + dx, lz = it.lz + dz;
          if (boat.deckContains(lx, lz)) ok = this._boatCanMove(boat, it.lx, it.lz, lx, lz, h);
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
        it.hop = ok ? { t: 0, dur: 0.35, h, dx, dz, end, x0, z0 }
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
          } else if (!this._boatCanMove(boat, it.lx, it.lz, lx, lz, 0)) it.vx = it.vz = 0;
          else { it.lx = lx; it.lz = lz; }
        }
        // ---- 船身猛地一晃（開快撞上浪、被浪頭砸到）：沒收進魚箱的魚被拋起來，可能飛出船外 ----
        // 浪本身不會把魚捲走；晃得越兇，拋得越常、越遠
        const jolt = boat.jolt || 0;
        if (!it.can && jolt > 1 && Math.random() < dt * 0.6 * (jolt - 1)) {   // 油桶重，拋不起來
          const a = rand(0, Math.PI * 2), d = rand(0.3, 0.7) * Math.min(jolt, 3.5), h = rand(0.5, 0.9);
          const dx = Math.cos(a) * d, dz = Math.sin(a) * d, lx = it.lx + dx, lz = it.lz + dz;
          let end = null, ok = true;
          if (boat.deckContains(lx, lz)) ok = this._boatCanMove(boat, it.lx, it.lz, lx, lz, h);
          else {
            const w = boat.toWorld(lx, lz), s = this._spot(w.x, w.z);
            end = s && s !== 'water' ? s : 'lost';
          }
          it.vx = it.vz = 0;
          it.hop = ok ? { t: 0, dur: 0.5, h, dx, dz, end, msg: '被甩出船外了', x0: it.lx, z0: it.lz }
            : { t: 0, dur: 0.35, h: rand(0.3, 0.5), dx: 0, dz: 0, end: null, x0: it.lx, z0: it.lz };
          continue;
        }
        this._pose(it, 0);
      }
    }
  }
}
