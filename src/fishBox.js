// 魚箱（瀏覽器這邊）：照伺服器傳來的狀態把每個箱子畫出來——抱在誰手上、放在地上、甲板上、浮在海上，裡面有哪些魚。
// 箱子怎麼動都由伺服器決定（見 server/fishBoxes.js），這裡只畫、只回答「哪個箱子在哪、裝得下嗎」。
// 自己的箱子離人太遠時，畫面上標出它在哪。
// 魚艙（d.h 是船主開的船種）：不畫木箱，魚擺在那艘船的艙口裡；艙蓋照 d.open 慢慢翻開／蓋上（boat.setHatchLid），蓋著時看不到裡面的魚
// env：scene、figureOf(id) 某個玩家的人物模型、boatOf(id) 某個玩家的船、waveAt(x, z) 浪高、myId() 自己的編號
import * as THREE from 'three';
import { FISHBOX } from './config.js';
import { SPECIES } from './fishdata.js';
import { makeFishMesh } from './fish.js';
import { BOX_WALL, boxFit, boxUsed, boxSpeed, pickBoxLocal, BOX_SPEC, hatchSpec } from './boxdata.js';

const WALL = BOX_WALL;   // 箱壁厚度
const wood = new THREE.MeshLambertMaterial({ color: 0xa9824e });
const woodDark = new THREE.MeshLambertMaterial({ color: 0x7c5a32 });
const plank = (w, h, d, mat, x, y, z) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
};
// 敞口的木箱（原點在箱底中央）
function crate() {
  const W = FISHBOX.w + WALL * 2, D = FISHBOX.d + WALL * 2, H = FISHBOX.h + WALL, g = new THREE.Group();
  g.add(plank(W, WALL, D, woodDark, 0, WALL / 2, 0),
    plank(W, H, WALL, wood, 0, H / 2, -D / 2 + WALL / 2), plank(W, H, WALL, wood, 0, H / 2, D / 2 - WALL / 2),
    plank(WALL, H, D, wood, -W / 2 + WALL / 2, H / 2, 0), plank(WALL, H, D, wood, W / 2 - WALL / 2, H / 2, 0),
    plank(W + 0.02, 0.05, 0.06, woodDark, 0, H * 0.62, -D / 2 - 0.01), plank(W + 0.02, 0.05, 0.06, woodDark, 0, H * 0.62, D / 2 + 0.01));   // 兩條提把
  return g;
}

export class BoxWorld {
  constructor(env) {
    this.env = env;
    this.map = new Map();   // bid → { d 伺服器傳來的樣子, mesh, inner 放魚的那一層, key 魚有沒有變 }
    this._marks = new Map();
  }

  // 整包換掉（進房、斷線接回來、合併房間）
  apply(list) {
    for (const bid of [...this.map.keys()]) this.del(bid);
    for (const d of list || []) this.set(d);
  }

  // 這個箱子的尺寸：魚艙照船主開的船（沒有艙口的船是 null：不畫、不能用）
  spec(d) { return d.h ? hatchSpec(d.h) : BOX_SPEC; }

  set(d) {
    let e = this.map.get(d.bid);
    if (!e) {
      const mesh = new THREE.Group(), inner = new THREE.Group();
      inner.position.y = WALL;
      if (d.h) {   // 魚艙：cover 蓋著時藏起來（裡面的魚堆高了會穿出蓋子）
        const cover = new THREE.Group();
        cover.add(inner);
        mesh.add(cover);
        e = { d, mesh, crate: null, cover, inner, fishBoxes: [], key: '', lid: 0, boat: null };
      } else {
        const crateMesh = crate();
        mesh.add(crateMesh, inner);
        e = { d, mesh, crate: crateMesh, inner, fishBoxes: [], key: '' };
      }
      this.map.set(d.bid, e);
    }
    e.d = d;
    const key = `${d.h || ''}|${d.fish.map((f) => f.uid).join(',')}`;
    if (key !== e.key) { e.key = key; this._fill(e); }
    this._place(e);
  }

  del(bid) {
    const e = this.map.get(bid);
    if (!e) return;
    e.mesh.removeFromParent();
    this.map.delete(bid);
    const mk = this._marks.get(bid);
    if (mk) { mk.remove(); this._marks.delete(bid); }
  }

  // 箱子裡的魚：一條一條平躺著往上疊（太長的斜著放），高度照已經佔掉的體積算
  _fill(e) {
    for (const c of [...e.inner.children]) c.removeFromParent();
    const list = e.d.fish, boxes = [], S = this.spec(e.d) || BOX_SPEC;
    list.forEach((f, i) => {
      const sp = SPECIES[f.id];
      if (!sp) return;
      const m = makeFishMesh(sp, f.len);
      m.userData.uid = f.uid;
      const k = boxUsed(list.slice(0, i), S), slant = f.len > S.w * 0.95 ? Math.atan2(S.d, S.w) : 0;
      const room = Math.max(0, S.w - f.len * Math.cos(slant)) / 2;
      const x = ((i * 0.37) % 1 - 0.5) * 2 * room, z = ((i * 0.61) % 1 - 0.5) * Math.max(0, S.d - f.len * Math.sin(slant) - 0.15);
      m.position.set(x, f.len * sp.w / 2 + k * S.h * 0.9, z);
      m.rotation.set(Math.PI / 2, 0, (i % 2 ? Math.PI : 0) + (i % 2 ? -slant : slant));
      m.updateMatrix();
      const b = new THREE.Box3().setFromObject(m);
      b.min.y += WALL; b.max.y += WALL;
      boxes.push({ fish: f, name: sp.name, min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
      e.inner.add(m);
    });
    e.fishBoxes = boxes;
  }

  // 擺到該在的地方：手上（掛在那個人身上）、甲板上（掛在那艘船上）、地上、海上（每幀照浪高再擺一次）
  _place(e) {
    const d = e.d, m = e.mesh;
    m.visible = true;
    if (d.h) {   // 魚艙：放在船主那艘船的艙口
      const b = this.env.boatOf(d.b);
      if (e.boat && e.boat !== b) e.boat.setHatchLid?.(0, false);
      e.boat = b && b.spec.hatch && this.spec(d) ? b : null;
      if (!e.boat) { m.visible = false; this.env.scene.add(m); return; }
      b.mesh.add(m);
      m.position.set(b.spec.hatch.x, b.spec.deck, 0);
      m.rotation.set(0, 0, 0);
      return;
    }
    if (d.k === 'hand') {
      const fig = this.env.figureOf(d.o);
      if (!fig) { m.visible = false; this.env.scene.add(m); return; }
      fig.add(m);
      m.position.set(0.62, 0.55, 0);
      m.rotation.set(0, Math.PI / 2, 0);   // 長邊橫在胸前
      return;
    }
    if (d.k === 'd') {
      const b = this.env.boatOf(d.b);
      if (!b) { m.visible = false; this.env.scene.add(m); return; }
      b.mesh.add(m);
      m.position.set(d.x, b.deckLocalY?.(d.x, d.z) ?? b.spec.deck, d.z);
      m.rotation.set(0, -d.yaw, 0);
      return;
    }
    this.env.scene.add(m);
    m.position.set(d.x, d.y, d.z);
    m.rotation.set(0, -d.yaw, 0);
  }

  // 每幀：浮在海上的跟著浪起伏；人物、船換了（剛進來、換船）就重新掛上去
  update(time) {
    const dt = Math.min(0.1, Math.max(0, time - (this._t ?? time)));
    this._t = time;
    for (const e of this.map.values()) {
      const d = e.d;
      if (d.h) {
        const b = this.env.boatOf(d.b);
        if (b !== e.boat || (b && e.mesh.parent !== b.mesh)) this._place(e);
        if (!e.boat) continue;
        e.lid += Math.max(-dt * 1.6, Math.min(dt * 1.6, (d.open ? 1 : 0) - e.lid));   // 大約 0.6 秒翻開
        const k = e.lid * e.lid * (3 - 2 * e.lid);
        e.boat.setHatchLid(k, d.open);
        e.cover.visible = e.lid > 0.02;
        continue;
      }
      if (d.k === 'w') {
        const y = this.env.waveAt(d.x, d.z);
        e.mesh.position.set(d.x, y - FISHBOX.h * 0.45 + 0.04 * Math.sin(time * 1.7 + d.bid), d.z);
        e.mesh.rotation.set(0.08 * Math.sin(time * 1.1 + d.bid), -d.yaw, 0.06 * Math.sin(time * 1.3 + d.bid * 2));
      } else if (d.k === 'hand' && e.mesh.parent !== this.env.figureOf(d.o)) this._place(e);
      else if (d.k === 'd' && e.mesh.parent !== this.env.boatOf(d.b)?.mesh) this._place(e);
    }
  }

  // ---- 查詢 ----
  get(bid) { return this.map.get(bid)?.d ?? null; }
  all() { return [...this.map.values()].map((e) => e.d); }
  mine(id) { return this.all().filter((d) => d.o === id && !d.h); }   // 魚箱（不含魚艙）
  hatch(id) { return this.all().find((d) => d.o === id && d.h) ?? null; }
  // 自己抱著的箱子
  held(id) { return this.all().find((d) => d.o === id && d.k === 'hand') ?? null; }
  kg(d) { return d.fish.reduce((s, f) => s + f.kg, 0); }
  value(d) { return d.fish.reduce((s, f) => s + f.value, 0); }
  used(d) { const S = this.spec(d); return S ? boxUsed(d.fish, S) : 1; }
  // 這條魚放得進去嗎：'' 可以；'long' 太長；'full' 滿了
  fit(d, id, len) { const S = this.spec(d); return S ? boxFit(d.fish, id, len, S) : 'full'; }
  // 抱著這個箱子走路的速度倍數
  speed(d) { return boxSpeed(this.kg(d)); }
  // 準心對準箱子／箱內的魚：回傳每個可及箱子的最佳命中（{ obb: true, kind: 'fbox'|'fpile'|'hatch', box, mesh, fishMesh, fish, name, t, off, r }）
  // 魚艙對準艙口是 hatch（開著時對準裡面的魚是 fpile）；onlyHatch：只找魚艙（抱著魚箱時）
  pick(origin, dir, reachOrigin, { fp = true, myId = null, tMin = 0, wantOut = false, putOnly = false, onlyHatch = false } = {}) {
    const out = [];
    for (const e of this.map.values()) {
      const d = e.d, S = this.spec(d), open = !d.h || d.open;
      if (d.k === 'hand' || !e.mesh.visible || !S || (onlyHatch && !d.h)) continue;
      e.mesh.updateMatrixWorld(true);
      _inv.copy(e.mesh.matrixWorld).invert();
      _rO.copy(origin).applyMatrix4(_inv);
      _rD.copy(dir).transformDirection(_inv);
      _pL.copy(reachOrigin).applyMatrix4(_inv);
      const hit = pickBoxLocal(
        { ox: _rO.x, oy: _rO.y, oz: _rO.z, dx: _rD.x, dy: _rD.y, dz: _rD.z, tMin },
        _pL,
        d.o === myId && open ? e.fishBoxes : [],
        { fp, wantOut: wantOut && open, putOnly },
        S,
      );
      if (hit) {
        if (d.h && hit.kind === 'fbox') hit.kind = 'hatch';
        const fishMesh = hit.kind === 'fpile' ? e.inner.children.find((m) => m.userData.uid === hit.fish?.uid) ?? null : null;
        out.push({ obb: true, ...hit, box: d, mesh: d.h ? e.boat.parts.hatchObj : e.crate, inner: e.inner, fishMesh });
      }
    }
    return out;
  }
  // 箱子的世界座標（箱底中央）
  worldPos(d, out = new THREE.Vector3()) {
    const e = this.map.get(d.bid);
    if (!e) return out.set(1e9, 0, 1e9);
    return e.mesh.getWorldPosition(out);
  }
  // 箱口的範圍：丟出去的魚從口掉下去就算放進去。回傳 { rim 口的高度, into 箱子 bid（滿了、太長、打在邊上是 null）}
  over(x, z, it) {
    for (const e of this.map.values()) {
      const d = e.d, S = this.spec(d);
      if (d.k === 'hand' || !e.mesh.visible || !S || (d.h && !d.open)) continue;
      const p = e.mesh.getWorldPosition(_v), dx = x - p.x, dz = z - p.z;
      const yaw = (d.yaw || 0) + (d.k === 'd' ? this.env.boatOf(d.b)?.heading ?? 0 : 0), c = Math.cos(yaw), s = Math.sin(yaw);
      const ax = Math.abs(dx * c + dz * s), az = Math.abs(-dx * s + dz * c);
      if (ax > S.w / 2 + 0.1 || az > S.d / 2 + 0.1) continue;
      const inside = ax < S.w / 2 && az < S.d / 2 && !it.can && !this.fit(d, it.id, it.len);
      return { rim: p.y + S.h + WALL, into: inside ? d.bid : null };
    }
    return null;
  }

  // ---- 自己的箱子離人太遠：畫面上標出來（看得到的方向標在那個位置，看不到就貼在畫面邊上）----
  marks(camera, me, myId, show = true) {
    const keep = new Set();
    if (show) {
      for (const d of this.mine(myId)) {
        if (d.k === 'hand') continue;
        const p = this.worldPos(d, _v), dist = Math.hypot(p.x - me.x, p.z - me.z);
        if (dist < FISHBOX.mark) continue;
        keep.add(d.bid);
        let el = this._marks.get(d.bid);
        if (!el) {
          el = document.createElement('div');
          el.style.cssText = 'position:fixed;z-index:6;pointer-events:none;transform:translate(-50%,-50%);padding:3px 9px;border-radius:12px;font:600 13px var(--font, sans-serif);white-space:nowrap;'
            + 'background:var(--paper, rgba(200,232,245,.85));color:var(--ink, #1d3a4a);border:2px solid var(--sun, #f5b83d);box-shadow:0 2px 6px rgba(0,0,0,.25)';
          document.body.appendChild(el);
          this._marks.set(d.bid, el);
        }
        _p.copy(p).setY(p.y + 0.6).project(camera);
        const behind = _p.z > 1;
        let sx = behind ? -_p.x : _p.x, sy = behind ? -_p.y : _p.y;
        const edge = Math.max(Math.abs(sx), Math.abs(sy));
        if (behind || edge > 0.92) { const k = 0.92 / Math.max(edge, 1e-3); sx *= k; sy *= k; }
        el.style.left = `${(sx * 0.5 + 0.5) * window.innerWidth}px`;
        el.style.top = `${(-sy * 0.5 + 0.5) * window.innerHeight}px`;
        el.textContent = `${d.k === 'w' ? '漂在海上的' : ''}魚箱 ${Math.round(dist)}m${d.fish.length ? `（${d.fish.length} 條）` : ''}`;
      }
    }
    for (const [bid, el] of this._marks) if (!keep.has(bid)) { el.remove(); this._marks.delete(bid); }
  }
}
const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _inv = new THREE.Matrix4(), _rO = new THREE.Vector3(), _rD = new THREE.Vector3(), _pL = new THREE.Vector3();
