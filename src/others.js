// 同房的其他玩家：用跟自己一樣的人偶畫出來，頭上掛著名字；每個人還有一艘放在世界裡的船。
// 人的位置每 0.1 秒從伺服器來一次，中間平滑地補過去；動作（走、跑、游、跳、拿東西、坐著、表情和動作輪盤）照傳來的狀態演。
// 站在船上的人傳的是「在誰的船上、甲板上的哪裡」，這裡照那艘船現在的位置擺，船怎麼動人就跟著動。
import * as THREE from 'three';
import { Player } from './player.js';
import { ACTION_BY_ID } from './emotes.js';
import { SPECIES, makeFishMesh, makeCanMesh, makeChumMesh } from './fish.js';
import { makeTabletMesh, holdTablet, poseTablet, setTabletScreen } from './tabletMesh.js';
import { disposeTabletMesh } from './tabletLive.js';
import { restyle } from './figure.js';

// 頭上的名牌：一張小圖，永遠面向鏡頭、遠近都一樣大。左邊是本週稱號的小膠囊（週榜冠軍是金色的），中間名字，右邊等級；
// 同隊隊友：名牌加一圈綠框、名字和等級是綠字（其他跟一般人一樣）
function nameTag(name, { title = '', gold = false, lv = 0, mate = false } = {}) {
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  const font = '30px "Huninn", "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
  const small = 'bold 22px "Huninn", "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
  const label = name, lvText = lv > 0 ? `Lv.${lv}` : '';
  ctx.font = small;
  const tw = title ? Math.ceil(ctx.measureText(title).width) + 20 : 0, lw = lvText ? Math.ceil(ctx.measureText(lvText).width) + 8 : 0;
  ctx.font = font;
  const nw = Math.ceil(ctx.measureText(label).width);
  const w = 14 + (tw ? tw + 8 : 0) + nw + (lw ? lw + 6 : 0) + 14, h = 44;
  cv.width = w; cv.height = h;
  ctx.fillStyle = 'rgba(191, 232, 248, 0.9)';
  ctx.beginPath(); ctx.roundRect(1.5, 1.5, w - 3, h - 3, (h - 3) / 2); ctx.fill();
  if (mate) { ctx.strokeStyle = '#27a05a'; ctx.lineWidth = 3; ctx.stroke(); }
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  let x = 14;
  if (title) {
    ctx.fillStyle = gold ? '#3a2a08' : '#1d6f9f';
    ctx.beginPath(); ctx.roundRect(x - 4, 7, tw, h - 14, (h - 14) / 2); ctx.fill();
    if (gold) { ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.font = small; ctx.fillStyle = gold ? '#ffd24a' : '#ffffff';
    ctx.fillText(title, x + 6, h / 2 + 1);
    x += tw + 8;
  }
  ctx.font = font; ctx.fillStyle = mate ? '#16843f' : '#1d6f9f';
  ctx.fillText(label, x, h / 2 + 1);
  x += nw + 6;
  if (lvText) { ctx.font = small; ctx.fillStyle = mate ? '#2a8a52' : '#4a8fb5'; ctx.fillText(lvText, x, h / 2 + 2); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, sizeAttenuation: false }));
  s.scale.set(0.04 * w / h, 0.04, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 10;
  return s;
}

const ROD_LEN = 2.7, GRIP = 0.14, ROD_ANGLE = 0.7, LINE_N = 16;
const _tip = new THREE.Vector3();
const ease = (dt, k) => 1 - Math.exp(-dt * k);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dispose = (root) => root.traverse((m) => { if (m.isMesh || m.isSprite) { m.geometry?.dispose(); for (const mat of [].concat(m.material)) { mat.map?.dispose(); mat.dispose(); } } });

// env：
//   scene
//   decorate(mesh)：把新的人偶加上陰影、描邊（跟自己的人偶一樣）
//   makeBoat(type, pose)：造一艘船放進世界（加進可以走上去的船的名單），回傳它；dropBoat(boat)：把它拿掉
//   boatOf(id)：這個玩家放在世界裡的那艘船（自己的也算）
export class Others {
  constructor(env) {
    this.env = env;
    this.map = new Map();   // id → { id, name, fig, tag, rod, boat, st, lastAct }
    this.mates = new Set(); // 同隊隊友的 id
  }

  // 房裡的一個人。here：他現在連著線（沒有的話只有船，人不在）；boat：{ type, s, sunk }
  // look：他選的角色（'girl'／'boy'）
  add({ id, name, title = '', gold = false, lv = 0, look = 'girl', here = true, pos = null, boat = null, hold = null, tab = null, line = null }) {
    let o = this.map.get(id);
    if (!o) { o = { id, name, title, gold: !!gold, lv: lv || 0, mate: this.mates.has(id), look, fig: null, tag: null, rod: null, boat: null, st: null, lastAct: '', hold: null, held: null, tabState: null, tabDirty: false, tabAt: 0, ln: null, bob: null, line: null, rodA: ROD_ANGLE }; this.map.set(id, o); }
    o.name = name;
    if (o.look !== look) {   // 換了角色（重新整理後回來）：人偶重做、船上的舵手也換
      o.look = look;
      if (o.fig) this._unfigure(o);
      if (o.boat) restyle(o.boat.parts.helmsman, look);
    }
    if (here && !o.fig) { o.title = title; o.gold = !!gold; o.lv = lv || 0; this._figure(o); }
    else this.setBadge(id, { title, gold, lv });
    if (!here) this._unfigure(o);
    if (boat) this.setBoat(id, boat);
    if (pos) this.setPos(id, pos);
    o.tabState = tab ?? null; o.tabDirty = !!tab;
    this.setHold(id, hold);
    this.setLine(id, line);
    return o;
  }

  // 名牌上的東西變了（稱號、是不是週榜冠軍、等級、是不是隊友）：有變才重畫
  setBadge(id, { title, gold, lv, mate } = {}) {
    const o = this.map.get(id);
    if (!o) return;
    const next = { title: title ?? o.title, gold: gold ?? o.gold, lv: lv ?? o.lv, mate: mate ?? o.mate };
    if (next.title === o.title && !!next.gold === !!o.gold && next.lv === o.lv && !!next.mate === !!o.mate) return;
    o.title = next.title || ''; o.gold = !!next.gold; o.lv = next.lv || 0; o.mate = !!next.mate;
    if (!o.fig) return;
    const pos = o.tag.position.clone(), vis = o.tag.visible;
    o.tag.removeFromParent(); dispose(o.tag);
    o.tag = nameTag(o.name, o);
    o.tag.position.copy(pos); o.tag.visible = vis;
    this.env.scene.add(o.tag);
  }
  setTitle(id, title = '', gold = false) { this.setBadge(id, { title, gold }); }
  // 誰是我的隊友（id 的集合）：名牌換成綠框綠字
  setMates(ids) {
    this.mates = new Set(ids);
    for (const o of this.map.values()) this.setBadge(o.id, { mate: this.mates.has(o.id) });
  }

  _figure(o) {
    const fig = o.fig = new Player(0, 0, 0, o.look);
    this.env.decorate(fig.mesh);
    // 釣竿：拿著的時候才顯示（只畫竿子，不畫線和浮標）
    const rod = o.rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, ROD_LEN, 6).translate(0, ROD_LEN / 2, 0), new THREE.MeshLambertMaterial({ color: 0x3b2a1a }));
    rod.visible = false;
    rod.castShadow = true;
    fig.mesh.add(rod);
    fig.mesh.visible = false;   // 收到第一筆位置才出現
    o.tag = nameTag(o.name, o);
    o.tag.visible = false;
    // 釣線和浮標：他在釣魚的時候才顯示
    o.bob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff4a33 }));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_N * 3), 3));
    o.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }));
    o.line.frustumCulled = false;
    o.bob.visible = o.line.visible = false;
    this.env.scene.add(fig.mesh, o.tag, o.bob, o.line);
    o.st = null;
  }

  _unfigure(o) {
    if (!o.fig) return;
    if (o.held?.userData.tablet) { disposeTabletMesh(o.held); o.held.removeFromParent(); }   // 只清該人專屬高解析貼圖，不動共用靜態快取
    o.fig.mesh.removeFromParent(); o.tag.removeFromParent(); o.bob.removeFromParent(); o.line.removeFromParent();
    dispose(o.fig.mesh); dispose(o.tag); dispose(o.bob);
    o.line.geometry.dispose(); o.line.material.dispose();
    o.fig = o.tag = o.rod = o.st = o.bob = o.line = o.held = o.hold = o.ln = null;
  }

  setTabState(id, d) {
    const o = this.map.get(id);
    if (!o) return;
    o.tabState = d ?? null;
    o.tabDirty = true;
  }

  // 他手上拿著什麼：[魚種或 'can'（油桶）、'chum'（誘魚桶）、'tablet', 身長]；空手是 null。跟自己拿著的時候一樣橫著捧在胸前（平板：低頭在看）
  setHold(id, s) {
    const o = this.map.get(id);
    if (!o || !o.fig) return;
    o.hold = s && (s[0] === 'can' || s[0] === 'chum' || s[0] === 'tablet' || SPECIES[s[0]]) ? s : null;
    if (o.hold && o.hold[0] === 'tablet') {   // 平板：沿用現有網格只換畫面，不重造也不用重新抬手
      const scr = Math.round(o.hold[1]) || 0;
      if (o.held?.userData.tablet) { setTabletScreen(o.held, scr); o.tabDirty = true; return; }
      if (o.held) { o.held.removeFromParent(); dispose(o.held); }
      o.held = makeTabletMesh(scr);
      o.tabDirty = true;
      holdTablet(o.fig.mesh, o.held);
      return;
    }
    o.tabState = null; o.tabDirty = false;
    if (o.held) {
      if (o.held.userData.tablet) disposeTabletMesh(o.held);
      o.held.removeFromParent();
      if (!o.held.userData.tablet) dispose(o.held);
      o.held = null;
    }
    if (!o.hold) return;
    o.held = o.hold[0] === 'can' ? makeCanMesh() : o.hold[0] === 'chum' ? makeChumMesh() : makeFishMesh(SPECIES[o.hold[0]], o.hold[1]);
    o.held.position.set(0.5, 1.08, 0);
    o.held.rotation.set(0, Math.PI / 2, 0);
    o.fig.mesh.add(o.held);
  }

  // 他的釣線另一頭的浮標在哪：[x, y, z, 狀態（1 還在飛、2 等魚咬、3 正在拉）]；沒在釣是 null
  setLine(id, s) {
    const o = this.map.get(id);
    if (!o || !o.fig) return;
    if (s && !o.ln) o.bob.position.set(s[0], s[1], s[2]);   // 剛拋出去：浮標直接出現在那裡
    o.ln = s;
  }

  // 人走了（斷線或離開）：人偶拿掉，船先留著
  leave(id, reclaimMs) {
    const o = this.map.get(id);
    if (!o) return;
    if (o.boat && Number.isFinite(reclaimMs)) o.boat.reclaimAt = performance.now() + reclaimMs;
    this._unfigure(o);
  }

  // 他的船換了一艘（或第一次出現）。舊的那艘交給 dropBoat 拿掉（站在上面的人和東西由它處理）
  setBoat(id, info) {
    const o = this.map.get(id);
    if (!o) return;
    if (o.boat && (o.boat.spec.id !== info.type || o.boat.sinking)) { this.env.dropBoat(o.boat); o.boat = null; }
    if (info.sunk) return;
    if (!o.boat) {
      o.boat = this.env.makeBoat(info.type, { x: info.s[0], z: info.s[1], heading: info.s[2] });
      o.boat.remote = true;
      o.boat.owner = { id, name: o.name };
      restyle(o.boat.parts.helmsman, o.look);   // 只有船主能開：舵手長得跟船主一樣
    }
    if (!o.boat.local) o.boat.setNet(info.s, true);   // local：這艘現在是我在幫忙開（副駕），位置我這邊算
    o.boat.setPaint?.(info.paint || 'default');
    o.boat.setMods(info.mods);          // 別人也看得到他裝的聲納、集魚燈
    o.boat.engineLv = info.lv || 0;     // 引擎等級：幫隊友開船時極速要照他的引擎算
    o.boat.reclaimAt = Number.isFinite(info.reclaimMs) ? performance.now() + info.reclaimMs : null;
  }

  // 離線的船已被收走。
  boatGone(id) {
    const o = this.map.get(id);
    if (!o) return;
    if (o.boat) this.env.dropBoat(o.boat);
    o.boat = null;
    if (!o.fig) this.map.delete(id);
  }

  boat(id) { return this.map.get(id)?.boat ?? null; }

  // 照伺服器給的名單對一遍（合併、重連時用）：不在名單上的拿掉，新的加進來，原本就在的沿用（站在別人船上的人才不會掉下去）
  sync(list) {
    const keep = new Set(list.map((p) => p.id));
    for (const [id, o] of [...this.map]) {
      if (keep.has(id)) continue;
      this._unfigure(o);
      if (o.boat) this.env.dropBoat(o.boat);
      this.map.delete(id);
    }
    for (const p of list) this.add(p);
  }

  // 伺服器傳來的位置：[x, y, z, yaw, 狀態, 跳多高, 視線左右, 視線上下, 站在誰的船上, 船上座標 x, z, 動作, 表情]
  setPos(id, s) {
    const o = this.map.get(id);
    if (!o || !o.fig || !s) return;
    const first = !o.st;
    o.st = s;
    const f = o.fig;
    if (first || Math.hypot(s[0] - f.x, s[2] - f.z) > 25) { f.x = s[0]; f.z = s[2]; f.y = s[1]; f.yaw = s[3]; o.snap = true; }
  }

  setBoatState(id, s) { const b = this.map.get(id)?.boat; if (b && !b.sinking && !b.local) b.setNet(s); }

  update(dt) {
    for (const o of this.map.values()) {
      if (o.boat && !o.boat.local) o.boat.updateRemote(dt);   // 我在幫忙開的那艘由 main.js 算
    }
    for (const o of this.map.values()) {
      const s = o.st, f = o.fig;
      if (!s || !f) continue;
      const flags = s[4], helm = !!(flags & 32), k = o.snap ? 1 : ease(dt, 12);
      o.snap = false;
      // 站在船上：照那艘船現在的位置擺（y 傳來的是離甲板多高）
      const deck = s[8] ? this.env.boatOf(s[8]) : null;
      let tx = s[0], ty = s[1], tz = s[2];
      if (s[8] && deck && !deck.sinking) {
        const w = deck.toWorld(s[9], s[10]);
        tx = w.x; tz = w.z; ty = deck.deckY(w.x, w.z) + s[1];
        f.x = tx; f.z = tz; f.y += (ty - f.y) * Math.max(k, 0.5);
      } else {
        if (s[8]) ty = f.y;   // 他說站在船上，可是那艘船這裡沒有（剛被收走）：高度先不動
        f.x += (tx - f.x) * k; f.y += (ty - f.y) * k; f.z += (tz - f.z) * k;
      }
      f.yaw += wrap(s[3] - f.yaw) * k;
      // 掌舵的人由船上的舵手模型代表，人偶不畫
      f.mesh.visible = !helm;
      // 動作輪盤：他那邊換了動作就跟著播（播一次的動作這裡自己播完）
      if (s[11] !== o.lastAct) {
        o.lastAct = s[11];
        f.act = Object.hasOwn(ACTION_BY_ID, s[11]) ? ACTION_BY_ID[s[11]] : null;
        f.actT = 0;
      }
      f.mood = s[12] || null; f.moodLeft = f.mood ? 5 : 0;
      f.look(s[6], s[7]);
      f.off.set(0, 0, 0);
      f.puppet(dt, { moving: !!(flags & 1), run: !!(flags & 2), swim: !!(flags & 4), carry: !!(flags & 8), rod: !!(flags & 16), seated: !!(flags & 64), h: s[5], tab: o.hold?.[0] === 'tablet' });
      if (o.held && o.held.userData.tablet) { poseTablet(o.held); this.env.updateTablet?.(o, o.held); }   // 平板跟著手抬起並視距節流更新即時畫面
      // 釣竿握在右手；線放出去之後竿子的角度跟著變（拋出去時往前倒、拉魚時往後扳）
      const rod = o.rod, ln = o.ln;
      rod.visible = !!(flags & 16) && !helm;
      const fishing = rod.visible && !!ln;
      o.bob.visible = o.line.visible = fishing;
      if (rod.visible) {
        o.rodA += ((ln ? (ln[3] === 1 ? 1.0 : ln[3] === 3 ? 0.45 : 0.85) : ROD_ANGLE) - o.rodA) * ease(dt, 8);
        f.mesh.updateMatrixWorld(true);
        f.mesh.userData.arms[1].userData.grip.getWorldPosition(rod.position);
        f.mesh.worldToLocal(rod.position);
        rod.rotation.z = -o.rodA;
        rod.position.x -= Math.sin(o.rodA) * GRIP; rod.position.y -= Math.cos(o.rodA) * GRIP;
      }
      if (fishing) {
        // 浮標平滑地跟到他傳來的位置；線從竿尖垂到浮標（中間往下墜一點）
        const b = o.bob.position, kb = ease(dt, 14), a = o.line.geometry.attributes.position, sag = ln[3] === 1 ? 0.1 : ln[3] === 3 ? 0.3 : 0.2;
        b.x += (ln[0] - b.x) * kb; b.y += (ln[1] - b.y) * kb; b.z += (ln[2] - b.z) * kb;
        rod.updateMatrixWorld(true);
        _tip.set(0, ROD_LEN, 0).applyMatrix4(rod.matrixWorld);
        for (let i = 0; i < LINE_N; i++) {
          const s = i / (LINE_N - 1);
          a.setXYZ(i, _tip.x + (b.x - _tip.x) * s, _tip.y + (b.y - _tip.y) * s - sag * 4 * s * (1 - s), _tip.z + (b.z - _tip.z) * s);
        }
        a.needsUpdate = true;
      }
      // 名牌：在頭頂上；掌舵時掛在舵位上方
      o.tag.visible = true;
      if (helm && deck) {
        const w = deck.toWorld(deck.spec.helmX, 0);
        o.tag.position.set(w.x, deck.deckY(w.x, w.z) + (deck.spec.cabin ? deck.spec.cabin.top + 0.5 : 2.0), w.z);
      } else o.tag.position.set(f.pos.x, f.pos.y + 1.92 - (flags & 4 ? 0.7 : 0), f.pos.z);
    }
  }

  // 地圖用：[{ name, x, z, yaw, boat: { x, z, heading, type } | null, here }]
  list() {
    return [...this.map.values()].map((o) => {
      const boat = o.boat && !o.boat.sinking ? o.boat : null;
      // 掌舵的人：人物的座標不會跟著船動（人偶也不畫），位置要用他的船；不然名字會留在他上船的地方，船早就開走了
      //   幫隊友掌舵的人握的是隊友的船（o.st[8] 是那艘船的船主），不是他自己的
      const at = o.st && (o.st[4] & 32) ? (o.st[8] && o.st[8] !== o.id ? this.env?.boatOf?.(o.st[8]) : boat) : null;
      const helm = !!(at && !at.sinking);
      return {
        id: o.id, name: o.name, title: o.title || '', gold: !!o.gold, lv: o.lv || 0, mate: !!o.mate, helm, here: !!(o.fig && o.st), x: helm ? at.x : o.fig?.x ?? 0, z: helm ? at.z : o.fig?.z ?? 0, yaw: helm ? at.heading : o.fig?.yaw ?? 0,
        boat,
      };
    });
  }

  get count() { let n = 0; for (const o of this.map.values()) if (o.fig) n++; return n; }
}
