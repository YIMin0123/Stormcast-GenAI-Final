// 海上和岸邊的生物：海鷗（盤旋、停在欄杆和船上、偷小魚）、海豚（跟船、跳浪）、海龜、魚群、沙灘上的螃蟹、遠處的鯨魚、繞著船的鯊魚背鰭。
// 全是畫面：每個人的畫面各自生各自的、不經過伺服器；只有「偷魚」會真的拿走一條魚（走原本魚沒了的流程）。
// 模型在 wildModels.js，數字在 wildPlan.js。風暴快來的時候海鷗飛回島上停著、魚群和海豚消失（見 world().omen／storm）。
import * as THREE from 'three';
import { WILD } from './wildPlan.js';
import { makeGull, setGullWings, makeDolphin, makeWhale, makeTurtle, makeCrab, makeSchoolFish, makeSharkFin, wildMat, DOLPHIN, WHALE } from './wildModels.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const rr = (r) => rand(r[0], r[1]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const GULL_S = 1.25, LEG_H = 0.135 * GULL_S;   // 海鷗放大多少、腳到身體中心多高

// E 要給的東西（見 main.js 的 makeWildlife 呼叫）：
//   scene, shade(物件), splash(x, y, z, 幾滴), mist(x, y, z, vx, vy, vz, 活幾秒, 多大)
//   camera（相機）、waterY(x, z)、bedAt(x, z)（海床高度，水下是負的）、offAt(x, z)（離陸地多遠）
//   tier()：0–3 畫質檔、world()：{ day 0–1, weatherK 0–1, omen 風暴快來了, storm 風暴中 }
//   player()：{ x, y, z }、boats()、myBoat()、harbor / haven：{ x, z } 海鷗的家、perches()：岸上能停的點 [{ x, y, z }]
//   toWorld(x, z)：港座標轉世界座標、crabGround(x, z)：這裡能不能放螃蟹（能就回地面高度，不能就 null）
//   stealables()：放在外面、可能被偷的魚；itemPos(魚, 向量)：魚在世界的位置；steal(魚)：把魚拿走（回傳牠的模型）
export function makeWildlife(E) {
  const group = new THREE.Group();
  group.name = 'wildlife';
  E.scene.add(group);
  const cam = E.camera.position, fwd = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
  let time = 0, W = { day: 1, weatherK: 1, omen: false, storm: false }, TIER = 2;
  const dist2 = (x, z) => Math.hypot(x - cam.x, z - cam.z);
  const nearestIsland = (x, z) => (Math.hypot(x - E.harbor.x, z - E.harbor.z) < Math.hypot(x - E.haven.x, z - E.haven.z) ? E.harbor : E.haven);
  // ---- 水花：泡沫斑塊組成的水波環和中心的泡沫（貼著浪面、越擴越淡）＋ 衝起來的水滴 ----
  const mkTex = (draw) => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); try { x.filter = 'blur(1.4px)'; } catch { /* 沒有就算了 */ }
    draw(x); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const ringTex = mkTex((x) => {   // 斷斷續續的白色泡沫圈，粗細、濃淡不一
    x.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const a = i / 90 * TAU + rand(-0.03, 0.03), r = 44 + rand(-3, 5) + Math.sin(a * 3 + 1) * 2.5;
      x.strokeStyle = `rgba(255,255,255,${(0.28 + Math.random() * 0.72).toFixed(2)})`; x.lineWidth = rand(3, 9);
      x.beginPath(); x.arc(64, 64, r, a, a + rand(0.06, 0.17)); x.stroke();
    }
    x.strokeStyle = 'rgba(230,248,255,0.25)'; x.lineWidth = 12; x.beginPath(); x.arc(64, 64, 52, 0, TAU); x.stroke();   // 外面一圈淡淡的水紋
  });
  const foamTex = mkTex((x) => {   // 中間一團泡沫：很多重疊的小圓，越靠邊越稀
    for (let i = 0; i < 70; i++) {
      const a = rand(0, TAU), d = Math.sqrt(Math.random()) * 38, r = rand(4, 12), px = 64 + Math.cos(a) * d, py = 64 + Math.sin(a) * d;
      const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(255,255,255,${(0.5 + Math.random() * 0.5).toFixed(2)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill();
    }
  });
  const ringMats = { ring: new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, fog: true }), foam: new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false, fog: true }) };
  const GRID = 8;
  const rings = [], ringPool = { ring: [], foam: [] };   // 每個：{ m, base（格點相對位置）, x, z, t, life, s0, s1, peak }
  const FX_MAX = 22;
  function ring(x, z, s1, life, s0 = 0.25, peak = 0.85, delay = 0, type = 'ring') {
    if (dist2(x, z) > 240) return;
    let r = ringPool[type].pop();
    if (!r) {
      if (rings.length >= (TIER >= 2 ? FX_MAX : 10)) return;
      const geo = new THREE.PlaneGeometry(1, 1, GRID, GRID).rotateX(-Math.PI / 2);   // 格子密一點，才貼得住起伏的浪面
      const m = new THREE.Mesh(geo, ringMats[type].clone()); m.renderOrder = 5; m.frustumCulled = false;
      group.add(m); r = { m, type, base: geo.attributes.position.array.slice() };
    }
    Object.assign(r, { x, z, t: -delay, life, s0, s1, peak, rot: rand(0, TAU) }); r.m.visible = false; rings.push(r);
  }
  function ringsTick(dt) {
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.t += dt;
      if (r.t < 0) continue;
      const u = r.t / r.life;
      if (u >= 1) { r.m.visible = false; rings.splice(i, 1); ringPool[r.type].push(r); continue; }
      const e = 1 - (1 - u) * (1 - u), s = r.s0 + (r.s1 - r.s0) * e, pos = r.m.geometry.attributes.position, b = r.base, C = Math.cos(r.rot), S = Math.sin(r.rot);
      r.m.position.set(r.x, 0, r.z); r.m.scale.setScalar(s); r.m.rotation.y = 0;
      for (let k = 0; k < pos.count; k++) {   // 每個格點跟著那裡的浪高
        const lx = b[k * 3] * s, lz = b[k * 3 + 2] * s;
        pos.setY(k, (E.waterY(r.x + lx * C - lz * S, r.z + lx * S + lz * C) + 0.09) / s);
      }
      pos.needsUpdate = true;
      r.m.rotation.y = -r.rot;
      r.m.material.opacity = r.peak * Math.pow(1 - u, 1.3) * Math.min(1, u * 16);
      r.m.visible = true;
    }
  }
  // 一次水花：k 是大小（0.3 小魚、0.5 海龜／海豚入水、1 海豚跳、2–3 鯨魚）
  function fx(x, z, k = 0.5, y = null) {
    if (dist2(x, z) > 260) return;
    const sf = y ?? E.waterY(x, z);
    E.splash(x, sf, z, Math.round(3 + 8 * k));
    ring(x, z, 1.3 + 2.4 * k, 1.1 + 0.6 * k, 0.5, 0.95, 0, 'foam');
    ring(x, z, 2.4 + 4.4 * k, 1.1 + 0.6 * k, 0.3, 0.9);
    if (k >= 0.45) ring(x, z, 3.4 + 6 * k, 1.7 + 0.8 * k, 0.2, 0.6, 0.14);
    if (k >= 0.9) ring(x, z, 4.6 + 8 * k, 2.3 + 0.9 * k, 0.2, 0.42, 0.34);
    const n = Math.round(8 + 18 * k);
    for (let i = 0; i < n; i++) {   // 水冠：一圈往外斜著噴的水珠，有大有小
      const a = rand(0, TAU), v = rand(0.6, 2.0 + k * 1.8), big = Math.random() < 0.25;
      E.mist(x + Math.cos(a) * 0.35, sf + 0.05, z + Math.sin(a) * 0.35, Math.cos(a) * v, rand(2.2, 4.8 + 3 * k), Math.sin(a) * v, rand(0.8, 1.4), rand(0.16, 0.32) * (0.8 + k * 0.8) * (big ? 1.7 : 1));
    }
  }
  const setShade = (g, cast) => { g.traverse((o) => { if (o.isMesh) o.userData.noCast = !cast; }); E.shade(g); };

  // ==========================================================================
  // 海鷗
  // ==========================================================================
  const GS = WILD.gull, ST = WILD.steal;
  const gulls = [], perchBusy = new Map();   // 停點的鍵 → 停在上面的海鷗
  const steal = { cd: rand(18, 40), gull: null, seen: new Map() };
  let wid = 1;
  const boatId = (b) => (b.__wid ??= wid++);

  function addGull() {
    const i = gulls.length, g = makeGull();
    g.scale.setScalar(GULL_S);
    setShade(g, TIER >= 2);
    group.add(g);
    const r = (i * 0.618034) % 1;
    const o = {
      g, i, st: 'orbit', x: 0, y: 0, z: 0, hd: rand(0, TAU), sp: rand(...GS.speed), vy: 0, turn: 0, dir: Math.random() < 0.5 ? 1 : -1,
      home: r < GS.harborShare ? 'harbor' : r < GS.harborShare + (1 - GS.harborShare) * 0.45 ? 'haven' : 'boat', kind: '', R: 30, h: 14,
      phase: rand(0, TAU), flapK: 1, gliding: false, glideT: rand(0, 3), fold: 0, legs: false, perch: null, perchT: 0, nextPerch: rand(...GS.perchEvery),
      noPerch: 0, hunt: null, fish: null, hideT: 0, riseT: 0, pitch: 0, roll: 0,
      voice: rand(0.86, 1.16), nextCry: rand(2, GS.cryEvery[1]), cryT: 0,   // 每隻海鷗的音高、下次叫的時間
    };
    const a = anchorFor(o);
    placeOnRing(o, a);
    gulls.push(o);
    return o;
  }
  function anchorFor(o) {
    let base = o.home === 'harbor' ? E.harbor : o.home === 'haven' ? E.haven : null, kind = o.home;
    if (!base) {
      const B = E.myBoat();
      if (!B || B.sinking) { base = E.harbor; kind = 'harbor'; }
      else if (Math.hypot(B.x - E.harbor.x, B.z - E.harbor.z) < 150) { base = E.harbor; kind = 'harbor'; }
      else if (Math.hypot(B.x - E.haven.x, B.z - E.haven.z) < 170) { base = E.haven; kind = 'haven'; }
      else { base = B; kind = 'boat'; }
    }
    if (W.omen && kind === 'boat') { base = nearestIsland(base.x, base.z); kind = base === E.harbor ? 'harbor' : 'haven'; }   // 風暴快來了：飛回島上
    const P = kind === 'boat' ? GS.boat : kind === 'haven' ? GS.haven : GS.harbor;
    if (o.kind !== kind) { o.kind = kind; o.R = rr(P.r); o.h = rr(P.alt); }
    return { x: base.x, z: base.z, kind, h: W.omen ? Math.min(o.h, 9) : o.h, R: W.omen ? Math.min(o.R, 24) : o.R };
  }
  function placeOnRing(o, a) {
    const ang = rand(0, TAU);
    o.x = a.x + Math.cos(ang) * a.R; o.z = a.z + Math.sin(ang) * a.R; o.y = a.h; o.hd = ang + o.dir * Math.PI / 2;
  }

  // ---- 停的地方：岸上固定的點（繫纜樁、燈、旗桿……）和船尾的欄杆 ----
  function perchPos(p, out) {
    if (p.boat) { out.set(p.lx, p.yl, p.lz); p.boat.mesh.localToWorld(out); return out; }
    return out.set(p.x, p.y, p.z);
  }
  function perchOk(p) {
    if (!p.boat) return true;
    const b = p.boat;
    return !b.sinking && !b.stored && Math.abs(b.speed) < 2.2;
  }
  function freePerches(o) {
    const list = [], P = E.player();
    for (const [i, p] of E.perches().entries()) { const key = 's' + i; if (!perchBusy.has(key)) list.push({ key, x: p.x, y: p.y, z: p.z }); }
    for (const b of E.boats()) {
      if (b.sinking || b.stored || Math.abs(b.speed) > 1.2 || Math.hypot(b.x - P.x, b.z - P.z) < 9) continue;
      const lx = -b.spec.len * 0.4;
      for (const s of [1, -1]) {
        const key = 'b' + boatId(b) + (s > 0 ? 'L' : 'R');
        if (perchBusy.has(key)) continue;
        list.push({ key, boat: b, lx, lz: s * b.deckHalfWidth(lx) * 0.94, yl: b.spec.deck + b.railHeightAt(lx) + 0.04 });
      }
    }
    return list.filter((p) => { perchPos(p, _w); return Math.hypot(_w.x - o.x, _w.z - o.z) < 220; });
  }
  // 這隻海鷗叫一聲：從牠現在的位置傳過來（遠了就不播；夜裡、躲起來、看不見的也不叫）。v：叫得多大聲 0–1
  function cry(o, v = 1) {
    if (!o.g.visible || W.day < 0.12 || W.storm) return;
    const d = Math.hypot(o.x - cam.x, o.y - cam.y, o.z - cam.z), k = 1 - d / GS.cryFar;
    if (k <= 0) return;
    E.cry(o.x, o.y, o.z, v * Math.pow(k, 1.5), o.voice);
  }
  function takeOff(o, why) {
    if (why === 'flee') cry(o, 1); else if (Math.random() < 0.5) cry(o, 0.55);   // 被嚇走叫得最大聲
    if (o.perch) { perchBusy.delete(o.perch.key); o.perch = null; }
    o.st = 'rise'; o.riseT = rand(1.1, 1.6); o.legs = true; o.hd = o.hd + rand(-0.8, 0.8);
    if (why === 'flee') o.noPerch = GS.noPerchAfterFlee;
  }

  // 朝一個點飛過去：轉向有上限（轉得越急身體越傾斜）、高度慢慢爬升或下降
  function steer(o, tx, ty, tz, speed, dt, turn = 2.2, climb = 2.8) {
    const dh = wrap(Math.atan2(tz - o.z, tx - o.x) - o.hd), st = clamp(dh, -turn * dt, turn * dt);
    o.hd += st; o.turn += (st / Math.max(dt, 1e-3) - o.turn) * Math.min(1, dt * 4);
    o.sp += (speed - o.sp) * Math.min(1, dt * 1.6);
    o.x += Math.cos(o.hd) * o.sp * dt; o.z += Math.sin(o.hd) * o.sp * dt;
    const dy = clamp(ty - o.y, -climb * dt, climb * dt);
    o.y += dy; o.vy += (dy / Math.max(dt, 1e-3) - o.vy) * Math.min(1, dt * 4);
  }
  function startPerch(o, p) { if (Math.random() < 0.6) cry(o, 0.45); o.st = 'land'; o.perch = p; perchBusy.set(p.key, o); o.legs = false; }

  function updateGull(o, dt) {
    const P = E.player();
    // 風暴中：沒停著的海鷗往島上飛、飛到就躲起來；天氣好了再出來
    if (W.storm && (o.st === 'orbit' || o.st === 'rise')) {
      const isl = nearestIsland(o.x, o.z), d = Math.hypot(isl.x - o.x, isl.z - o.z);
      if (d < 50 && o.y < 14) { o.st = 'hide'; o.hideT = 12; o.g.visible = false; return; }
      steer(o, isl.x, 7, isl.z, 9, dt, 2.5, 3);
      pose(o, dt);
      return;
    }
    const roost = W.day < 0.12;   // 夜裡海鷗回巢睡了（不畫）
    if (roost && (o.st === 'orbit' || o.st === 'rise') && !o.hunt) { o.st = 'hide'; o.hideT = 0; o.g.visible = false; return; }
    if (o.st === 'hide') {
      if (W.storm || roost) return;
      if ((o.hideT -= dt) > 0) return;
      const a = anchorFor(o); placeOnRing(o, a); o.st = 'orbit';
    }
    if (o.noPerch > 0) o.noPerch -= dt;
    // 空中盤旋、停著的時候，隔一陣子叫一聲（兩聲連著叫的機會也有）
    if ((o.st === 'orbit' || o.st === 'perch') && (o.nextCry -= dt) <= 0) {
      cry(o, o.st === 'perch' ? 0.4 : 0.6);
      o.nextCry = Math.random() < 0.25 ? rand(0.5, 1.0) : rr(GS.cryEvery);
    }

    switch (o.st) {
      case 'orbit': {
        const a = anchorFor(o), rx = o.x - a.x, rz = o.z - a.z, ang = Math.atan2(rz, rx), tAng = ang + o.dir * 0.5;
        steer(o, a.x + Math.cos(tAng) * a.R, a.h + Math.sin(time * 0.4 + o.phase) * 1.6, a.z + Math.sin(tAng) * a.R, clamp(o.sp, GS.speed[0], GS.speed[1]), dt);
        o.nextPerch -= dt;
        if (o.nextPerch <= 0) {
          o.nextPerch = rr(GS.perchEvery);
          if (o.noPerch <= 0 && Math.random() < GS.perchChance && W.day > 0.15 - (W.omen ? 1 : 0) && !steal.gull) {
            const list = freePerches(o);
            if (list.length) startPerch(o, list[Math.floor(Math.random() * list.length)]);
          }
        }
        break;
      }
      case 'land': {
        const p = o.perch;
        if (!perchOk(p)) { takeOff(o); break; }
        perchPos(p, _v);
        const dx = _v.x - o.x, dz = _v.z - o.z, d = Math.hypot(dx, dz), ty = _v.y + LEG_H;
        if (d < 1.6 && Math.abs(o.y - ty) < 0.7) {
          o.x += (_v.x - o.x) * Math.min(1, dt * 3.2); o.z += (_v.z - o.z) * Math.min(1, dt * 3.2); o.y += (ty - o.y) * Math.min(1, dt * 3.2);
          o.sp *= 0.9; o.vy = 0; o.legs = true;
          if (d < 0.12 && Math.abs(o.y - ty) < 0.05) { o.st = 'perch'; o.perchT = rr(GS.perchTime); o.sp = 0; o.pitch = 0; if (!p.boat) o.hd = rand(0, TAU); }
        } else {
          steer(o, _v.x, ty + clamp(d * 0.42, 0, 8), _v.z, clamp(d * 0.9, 1.1, 8), dt, 3.2, 4);
          o.legs = d < 7;
        }
        break;
      }
      case 'perch': {
        const p = o.perch;
        if (!perchOk(p)) { takeOff(o); break; }
        perchPos(p, _v);
        o.x = _v.x; o.y = _v.y + LEG_H; o.z = _v.z;
        if (p.boat) o.hd = p.boat.heading + (p.lz > 0 ? 0.5 : -0.5);   // 看著船外
        o.perchT -= dt;
        if (Math.hypot(P.x - o.x, P.z - o.z) < GS.flee && Math.abs(P.y - o.y) < 6) { takeOff(o, 'flee'); break; }
        if (o.perchT <= 0) takeOff(o);
        break;
      }
      case 'rise': {
        o.riseT -= dt;
        steer(o, o.x + Math.cos(o.hd) * 20, o.y + 6, o.z + Math.sin(o.hd) * 20, 6, dt, 1.2, 4.2);
        o.legs = o.riseT > 0.4;
        if (o.riseT <= 0) { o.st = 'orbit'; o.legs = false; }
        break;
      }
      case 'hunt': case 'peck': huntGull(o, dt, P); break;
      default: break;
    }
    pose(o, dt);
  }

  // 套到模型上：位置、朝向、傾斜、翅膀（拍翅、滑翔、收翅）
  function pose(o, dt) {
    const g = o.g, perched = o.st === 'perch' || o.st === 'peck';
    const wantFold = perched ? 1 : 0;
    o.fold += (wantFold - o.fold) * Math.min(1, dt * 6);
    // 拍翅：爬升、起降時猛拍；平飛時拍一陣、滑一陣
    if ((o.glideT -= dt) <= 0) { o.gliding = !o.gliding; o.glideT = o.gliding ? rand(1.8, 4.8) : rand(1.5, 3.4); }
    const busy = o.st === 'rise' || o.st === 'land' || o.vy > 0.7 || o.st === 'carry';
    const wantK = busy ? 1 : o.gliding ? 0.08 : 0.85;
    o.flapK += (wantK - o.flapK) * Math.min(1, dt * 3);
    o.phase += dt * (9 + 5 * o.flapK);
    const lift = 0.16 + Math.sin(time * 0.7 + o.i) * 0.03;
    const flap = lift * (1 - o.flapK) + o.flapK * (0.28 + 0.62 * Math.sin(o.phase));
    const lag = o.flapK * 0.55 * Math.sin(o.phase - 0.95) - 0.1 * (1 - o.flapK);
    setGullWings(g, flap, lag, o.fold);
    g.userData.legs.visible = o.legs || perched;
    o.roll += (clamp(-o.turn * 0.32, -0.7, 0.7) - o.roll) * Math.min(1, dt * 5);
    const pitchWant = perched ? (o.st === 'peck' ? Math.sin(time * 9) * 0.28 + 0.1 : 0) : clamp(o.vy * 0.07, -0.5, 0.55);
    o.pitch += (pitchWant - o.pitch) * Math.min(1, dt * 7);
    g.position.set(o.x, o.y, o.z);
    g.rotation.set(perched ? 0 : o.roll, -o.hd, o.pitch, 'YXZ');
    g.visible = dist2(o.x, o.z) < GS.far;
  }

  // ---- 偷魚 ----
  function huntGull(o, dt, P) {
    const h = o.hunt;
    if (!h) { o.st = 'orbit'; steal.gull = null; return; }
    if (h.phase === 'carry') {
      if ((o.cryT -= dt) <= 0) { cry(o, 1); o.cryT = rand(1.4, 2.6); }   // 叼著魚逃走，一路叫
      const away = Math.atan2(o.z - P.z, o.x - P.x);
      o.hd += clamp(wrap(away - o.hd), -1.4 * dt, 1.4 * dt);
      steer(o, o.x + Math.cos(o.hd) * 30, 17, o.z + Math.sin(o.hd) * 30, 9.5, dt, 1.4, 3.6);
      o.legs = false; o.flapK = 1;
      if ((h.t -= dt) <= 0) {
        if (o.fish) { o.g.remove(o.fish); o.fish.traverse((m) => { if (m.isMesh) m.geometry.dispose(); }); o.fish = null; }
        o.hunt = null; o.st = 'orbit'; steal.gull = null; steal.cd = rr(ST.every);
      }
      return;
    }
    // 去的路上：魚還在不在、人是不是靠過來了
    if (!E.stealables().includes(h.it)) return abortHunt(o);
    E.itemPos(h.it, _v);
    if (Math.hypot(P.x - _v.x, P.z - _v.z) < ST.safe * 0.75) return abortHunt(o, true);
    const dx = _v.x - o.x, dz = _v.z - o.z, d = Math.hypot(dx, dz), ty = _v.y + LEG_H * 0.7;
    if (h.phase === 'in') {
      if (d < 1.4) {
        o.x += (_v.x - o.x) * Math.min(1, dt * 3.5); o.z += (_v.z - o.z) * Math.min(1, dt * 3.5); o.y += (ty - o.y) * Math.min(1, dt * 3.5); o.sp *= 0.9; o.legs = true;
        if (d < 0.18 && Math.abs(o.y - ty) < 0.06) { h.phase = 'peck'; o.st = 'peck'; h.t = rr(ST.peck); o.fold = 0.2; }
      } else { steer(o, _v.x, ty + clamp(d * 0.4, 0, 12), _v.z, clamp(d * 0.9, 1.3, 9.5), dt, 3.0, 4.5); o.legs = d < 8; }
      pose(o, dt);
      return;
    }
    if (h.phase === 'peck') {
      o.x += (_v.x - o.x) * Math.min(1, dt * 6); o.z += (_v.z - o.z) * Math.min(1, dt * 6); o.y += (ty - o.y) * Math.min(1, dt * 6);
      o.hd += wrap(Math.atan2(_v.z - o.z, _v.x - o.x) - o.hd) * Math.min(1, dt * 4);
      if ((h.t -= dt) <= 0) {
        // 叼起來：魚從甲板（地上）拿掉，模型掛在嘴上
        const len = h.it.len, mesh = E.steal(h.it);
        o.fish = mesh;
        o.g.add(mesh);
        mesh.position.set(0.3, -0.04 - len * 0.12, 0); mesh.rotation.set(0, 0, 0.35); mesh.scale.setScalar(1 / GULL_S);   // 魚橫著叼在嘴下、尾巴垂下去
        h.phase = 'carry'; h.t = ST.carry; o.st = 'hunt'; o.legs = true; o.fold = 0; o.flapK = 1; o.vy = 2;
      }
    }
  }
  function abortHunt(o, shoo) {
    o.hunt = null;
    steal.gull = null; steal.cd = rr(ST.every) * (shoo ? 1.2 : 0.5);
    takeOff(o, shoo ? 'flee' : undefined);
  }
  function startHunt(it, force) {
    E.itemPos(it, _v);
    let best = null, bd = 1e9;
    for (let i = 0; i < gulls.length; i++) { const o = gulls[i]; if (o.hunt || o.fish || (o.st === 'hide' && !force)) continue; const d = Math.hypot(o.x - _v.x, o.z - _v.z); if (d < bd) { bd = d; best = o; } }
    if (!best) best = addGull();
    const o = best;
    if (o.perch) { perchBusy.delete(o.perch.key); o.perch = null; }
    if (bd > 120 || o.st === 'hide') {   // 離得太遠、或還躲著：從魚的上風處一段距離外飛進來
      const a = rand(0, TAU);
      o.x = _v.x + Math.cos(a) * 75; o.z = _v.z + Math.sin(a) * 75; o.y = 20; o.hd = a + Math.PI; o.sp = 8;
    }
    o.g.visible = true;
    o.st = 'hunt'; o.hunt = { it, phase: 'in', t: 0 }; steal.gull = o; o.cryT = rand(0.5, 1.2);
    cry(o, 0.9);
  }
  function stealTick(dt) {
    if (steal.gull) return;
    steal.cd -= dt;
    if (steal.cd > 0) return;
    steal.cd = 4;
    if (W.day < 0.3 || W.weatherK < 0.6 || W.omen) return;
    const P = E.player(), list = E.stealables(), now = time, ok = [];
    const present = new Set();
    for (const it of list) {
      present.add(it);
      if (!steal.seen.has(it)) steal.seen.set(it, now);
      if (it.kg > ST.maxKg || now - steal.seen.get(it) < ST.grace) continue;
      E.itemPos(it, _v);
      if (Math.hypot(P.x - _v.x, P.z - _v.z) < ST.safe) continue;
      ok.push(it);
    }
    for (const k of steal.seen.keys()) if (!present.has(k)) steal.seen.delete(k);
    if (!ok.length) return;
    startHunt(ok[Math.floor(Math.random() * ok.length)], false);
    steal.cd = 1;
  }

  // ==========================================================================
  // 海豚：跟著跑動的船（在船頭的浪裡游、跳），或自己在遠處一群群游
  // ==========================================================================
  const DD = WILD.dolphin;
  let pod = null, podCd = rand(20, 50), podCheck = DD.check;
  const dolphinPool = [];
  const getDolphin = () => {
    let d = dolphinPool.find((x) => !x.used);
    if (!d) { const g = makeDolphin(); setShade(g, TIER >= 2); group.add(g); d = { g, used: false }; dolphinPool.push(d); }
    d.used = true; d.g.visible = true;
    return d;
  };
  function newPod(mode, boat, cx, cz, hd, speed) {
    const n = DD.pod[TIER];
    pod = { mode, boat, x: cx, z: cz, hd, sp: speed, t: 0, life: rr(DD.life), slow: 0, leave: false, ds: [], leaveT: 0 };
    for (let i = 0; i < n; i++) {
      const d = getDolphin();
      Object.assign(d, {
        fwd: rand(-2.5, 3.5) + (mode === 'ride' ? 1.5 : 0), lat: (i % 2 ? -1 : 1) * (1.4 + Math.floor(i / 2) * 1.7 + rand(0, 0.9)), x: cx, z: cz, y: -9, hd, ph: rand(0, TAU), st: 'swim', jt: 0, jdur: 1, H: 1.5,
        next: rand(0.5, DD.jumpGap[1]) + i * 0.6, sc: rand(0.92, 1.18), pitch: 0, roll: 0,
      });
      d.g.scale.setScalar(d.sc);
      pod.ds.push(d);
    }
    return pod;
  }
  function podTick(dt) {
    const B = E.myBoat();
    if (!pod) {
      podCd -= dt; podCheck -= dt;
      if (podCd > 0 || podCheck > 0) return;
      podCheck = DD.check;
      if (W.day < 0.3 || W.weatherK < 0.75 || W.omen) return;
      if (B && !B.sinking && Math.abs(B.speed) > DD.rideSpeed && -E.bedAt(B.x, B.z) > DD.minDepth && E.offAt(B.x, B.z) > 40 && Math.random() < DD.rideChance) {
        const hd = B.heading;
        newPod('ride', B, B.x + Math.cos(hd) * 40, B.z + Math.sin(hd) * 40, hd, Math.abs(B.speed));
        return;
      }
      if (Math.random() < DD.wanderChance && E.offAt(cam.x, cam.z) > 80) {
        E.camera.getWorldDirection(fwd);
        const a = Math.atan2(fwd.z, fwd.x) + rand(-0.9, 0.9), r = rr(DD.wanderDist), x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
        if (-E.bedAt(x, z) > DD.wanderDepth) newPod('wander', null, x, z, a + rand(1.0, 2.2) * (Math.random() < 0.5 ? 1 : -1), rand(3, 4.5));
      }
      return;
    }
    pod.t += dt;
    // 這群什麼時候走
    let leave = pod.leave;
    if (pod.mode === 'ride') {
      const b = pod.boat;
      if (!b || b.sinking || Math.abs(b.speed) < 1.6 || -E.bedAt(b.x, b.z) < DD.minDepth * 0.6) pod.slow += dt; else pod.slow = 0;
      if (pod.slow > 4) leave = true;
      if (b) { pod.hd = b.heading; pod.sp = Math.abs(b.speed); pod.x = b.x + Math.cos(b.heading) * b.spec.len * 0.3; pod.z = b.z + Math.sin(b.heading) * b.spec.len * 0.3; }
    } else {
      pod.hd += Math.sin(pod.t * 0.15) * 0.05 * dt * 10 * 0.1;
      pod.x += Math.cos(pod.hd) * pod.sp * dt; pod.z += Math.sin(pod.hd) * pod.sp * dt;
      if (-E.bedAt(pod.x + Math.cos(pod.hd) * 12, pod.z + Math.sin(pod.hd) * 12) < DD.wanderDepth * 0.5) pod.hd += 0.5 * dt;   // 前面變淺了：轉彎
      if (pod.t > pod.life || dist2(pod.x, pod.z) > 420) leave = true;
    }
    if (W.omen || W.weatherK < 0.6 || W.day < 0.2) leave = true;
    if (leave && !pod.leave) { pod.leave = true; pod.leaveT = 0; }
    if (pod.leave) pod.leaveT += dt;

    const sx = -Math.sin(pod.hd), sz = Math.cos(pod.hd);   // 往左右的方向
    for (const d of pod.ds) {
      const tx = pod.x + Math.cos(pod.hd) * d.fwd + sx * d.lat, tz = pod.z + Math.sin(pod.hd) * d.fwd + sz * d.lat;
      d.x += (tx - d.x) * Math.min(1, dt * 2.4); d.z += (tz - d.z) * Math.min(1, dt * 2.4);
      d.hd += wrap(pod.hd - d.hd) * Math.min(1, dt * 3);
      d.ph += dt * 2.3;
      const surf = E.waterY(d.x, d.z), v = Math.max(pod.sp, 2.5) + 1.2;
      let y;
      if (pod.leave) {   // 走了：往下沉、往前游
        y = Math.min(d.y, surf - 0.3) - dt * 1.2;
        d.x += Math.cos(d.hd) * 3 * dt; d.z += Math.sin(d.hd) * 3 * dt; d.pitch += (-0.25 - d.pitch) * Math.min(1, dt * 2);
        if (d.st === 'jump') d.st = 'swim';
      } else if (d.st === 'swim') {
        const breath = Math.max(0, Math.sin(d.ph));
        y = surf - 0.62 + 0.55 * Math.pow(breath, 0.8);
        d.pitch += (Math.cos(d.ph) * 0.2 - d.pitch) * Math.min(1, dt * 4);
        if ((d.next -= dt) <= 0) { d.st = 'jump'; d.jt = 0; d.jdur = rr(DD.jumpTime); d.H = rr(DD.jumpHeight); fx(d.x, d.z, 0.8, surf); y = surf - 0.5; }
      } else {
        const u = d.jt / d.jdur;
        y = surf - 0.5 + (d.H + 0.5) * 4 * u * (1 - u);
        const dydt = (d.H + 0.5) * 4 * (1 - 2 * u) / d.jdur;
        d.pitch += (Math.atan2(dydt, v) - d.pitch) * Math.min(1, dt * 12);
        d.roll = Math.sin(u * TAU) * 0.35;
        d.jt += dt;
        if (u >= 1) { d.st = 'swim'; d.next = rr(DD.jumpGap); fx(d.x, d.z, 1.0, surf); d.roll = 0; }
      }
      d.y = y;
      // 背鰭、背露出水面／沒入水面的那一下濺起水花；背露在外面游的時候後面拖著一串水沫
      const up = y > surf - 0.3;
      if (up !== !!d.up) { d.up = up; if (d.st !== 'jump') fx(d.x, d.z, up ? 0.55 : 0.45, surf); }
      if (up && d.st !== 'jump' && ((d.wk = (d.wk || 0) - dt) <= 0) && dist2(d.x, d.z) < 200) {
        d.wk = 0.09;
        E.mist(d.x - Math.cos(d.hd) * 1.1, surf + 0.05, d.z - Math.sin(d.hd) * 1.1, rand(-0.5, 0.5), rand(1.2, 2.6), rand(-0.5, 0.5), rand(0.4, 0.8), rand(0.14, 0.3));
        if ((d.wr = (d.wr || 0) + 1) % 4 === 0) ring(d.x - Math.cos(d.hd) * 1.3, d.z - Math.sin(d.hd) * 1.3, 2.2, 1.3, 0.4, 0.55);   // 游過去留下的一道水痕
      }
      const g = d.g, fl = 0.28 + (d.st === 'jump' ? 0.12 : 0);
      g.userData.rear.rotation.z = Math.sin(time * 9 + d.ph) * fl * 0.7;
      g.userData.fluke.rotation.z = Math.sin(time * 9 + d.ph - 0.9) * fl;
      g.position.set(d.x, y, d.z);
      g.rotation.set(d.roll, -d.hd, d.pitch, 'YXZ');
      g.visible = y > surf - 1.0 && dist2(d.x, d.z) < 520;
    }
    if (pod.leave && pod.leaveT > 6) { for (const d of pod.ds) { d.used = false; d.g.visible = false; } pod = null; podCd = rr(DD.cooldown); }
  }

  // ==========================================================================
  // 鯨魚：遠遠地冒出來，噴幾次水，慢慢潛下去（有時整隻躍出海面）
  // ==========================================================================
  const WH = WILD.whale;
  const whale = { g: null, on: false, t: 0, x: 0, z: 0, hd: 0, breach: false, nextBlow: 0, blows: 0, cd: rr(...[WH.first]), roll: 0 };
  function startWhale(force) {
    E.camera.getWorldDirection(fwd);
    for (let k = 0; k < 14; k++) {
      const a = Math.atan2(fwd.z, fwd.x) + rand(-0.8, 0.8), r = rr(WH.dist), x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
      if (-E.bedAt(x, z) < WH.depth || E.offAt(x, z) < WH.off) continue;
      if (!whale.g) { whale.g = makeWhale(); setShade(whale.g, false); group.add(whale.g); }
      Object.assign(whale, { on: true, t: 0, x, z, hd: a + (Math.random() < 0.5 ? 1 : -1) * rand(1.1, 2.0), breach: Math.random() < WH.breach, nextBlow: 3.2, blows: 0, roll: 0 });
      return true;
    }
    return !!force && false;
  }
  function whaleTick(dt) {
    if (!whale.on) {
      whale.cd -= dt;
      if (whale.cd <= 0) {
        whale.cd = 6;
        if (W.day > 0.3 && W.weatherK > 0.8 && !W.omen && startWhale(false)) whale.cd = rr(WH.every);
      }
      return;
    }
    whale.t += dt;
    const t = whale.t, g = whale.g, surf = E.waterY(whale.x, whale.z), sp = 2.4;
    whale.x += Math.cos(whale.hd) * sp * dt; whale.z += Math.sin(whale.hd) * sp * dt;
    let y, pitch = 0, tail = 0, roll = 0;
    const L = WH.life;
    if (whale.breach) {
      // 先在水下游近，3 秒時衝出水面（拋物線），翻身落回去，再浮一下、噴水、潛下去
      const bt = 3, bd = 2.6;
      if (t < bt) { y = surf - 4 + 3.4 * sm(0, bt, t); pitch = 0.3 * sm(1, bt, t); }
      else if (t < bt + bd) { const u = (t - bt) / bd; y = surf - 0.6 + 7.2 * 4 * u * (1 - u); pitch = 0.95 - 1.9 * u; roll = u * 2.4; whale.roll = roll; }
      else if (t < bt + bd + 7) { const u = (t - bt - bd) / 7; y = surf - 0.5 + 0.2 * Math.sin(u * 5) - 0.5 * sm(0.85, 1, u) * 3; pitch = 0.04; roll = 0; }
      else { y = surf - 8; }
      if (!whale.splashed && t >= bt && t < bt + 0.3) { whale.splashed = true; fx(whale.x, whale.z, 2.2, surf); }
      if (!whale.splashed2 && t >= bt + bd) { whale.splashed2 = true; fx(whale.x, whale.z, 3.0, surf); for (let i = 0; i < 40; i++) { const a = rand(0, TAU), r = rand(1, 6); E.mist(whale.x + Math.cos(a) * 2, surf, whale.z + Math.sin(a) * 2, Math.cos(a) * r, rand(4, 11), Math.sin(a) * r, rand(0.8, 1.6), rand(0.5, 1.3)); } }
    } else {
      // 浮上來 → 游一段（噴三次水）→ 抬起尾鰭潛下去
      if (t < 3.2) { y = surf - 2.5 + 2.0 * sm(0, 3.2, t); pitch = 0.1 * (1 - sm(0, 3.2, t)); }
      else if (t < L - 6) { y = surf - 0.55 + 0.16 * Math.sin(t * 0.55); pitch = 0.02 + 0.03 * Math.sin(t * 0.55); tail = Math.sin(t * 0.8) * 0.06; }
      else if (t < L) { const u = (t - (L - 6)) / 6; y = surf - 0.55 - 6 * u * u; pitch = -0.7 * sm(0, 0.8, u); tail = 0.3 + 0.7 * sm(0.3, 0.9, u); }
      else y = surf - 12;
    }
    // 背浮出水面、尾鰭沒入水裡的時候都有水花；浮在水面時身旁一圈水沫
    const upW = y > surf - 0.9;
    if (upW !== !!whale.up) { whale.up = upW; if (!whale.breach) fx(whale.x + Math.cos(whale.hd) * 1.5, whale.z + Math.sin(whale.hd) * 1.5, upW ? 1.8 : 1.4, surf); }
    if (upW && ((whale.wk = (whale.wk || 0) - dt) <= 0)) { whale.wk = 0.16; const a = rand(0, TAU); E.mist(whale.x + Math.cos(a) * 3.5 + Math.cos(whale.hd) * rand(-4, 4), surf + 0.05, whale.z + Math.sin(a) * 3.5 + Math.sin(whale.hd) * rand(-4, 4), Math.cos(a) * 0.8, rand(1.5, 3), Math.sin(a) * 0.8, rand(0.6, 1.1), rand(0.3, 0.6)); }
    // 噴水：從頭頂後面一點的噴氣孔往上噴一柱水霧
    if (!whale.breach && t > whale.nextBlow && whale.blows < 3 && t < L - 7) {
      whale.blowT = 0.55; whale.blows++; whale.nextBlow += rand(4.5, 6.5);
    }
    if (whale.blowT > 0) {
      whale.blowT -= dt;
      const bx = whale.x + Math.cos(whale.hd) * 3.8, bz = whale.z + Math.sin(whale.hd) * 3.8;
      for (let i = 0; i < 4; i++) { const a = rand(0, TAU); E.mist(bx, y + 1.25, bz, Math.cos(a) * 1.2, rand(10, 15), Math.sin(a) * 1.2, rand(0.9, 1.6), rand(0.5, 1.1)); }
    }
    g.userData.rear.rotation.z = Math.sin(t * 0.9) * 0.05 + tail * 0.35;
    g.userData.fluke.rotation.z = Math.sin(t * 0.9 - 0.9) * 0.06 + tail;
    g.position.set(whale.x, y, whale.z);
    g.rotation.set(roll, -whale.hd, pitch, 'YXZ');
    g.visible = y > surf - 5 && dist2(whale.x, whale.z) < 700;
    if (t > (whale.breach ? 15 : L + 2)) { whale.on = false; g.visible = false; whale.splashed = whale.splashed2 = false; }
  }

  // ==========================================================================
  // 鯊魚背鰭：繞著你的船游一陣（風暴快來時最常出現）
  // ==========================================================================
  const FN = WILD.fin;
  const fin = { g: null, on: false, t: 0, life: 40, ang: 0, r: 24, w: 0.25, cd: rr(30, 80), check: FN.check, wob: 0 };
  function startFin() {
    const B = E.myBoat();
    if (!B || B.sinking) return false;
    if (!fin.g) { fin.g = makeSharkFin(); setShade(fin.g, false); group.add(fin.g); }
    Object.assign(fin, { on: true, t: 0, life: rr(FN.life), ang: rand(0, TAU), r: rr(FN.r), w: rand(0.16, 0.26) * (Math.random() < 0.5 ? 1 : -1), foam: 0 });
    return true;
  }
  function finTick(dt) {
    const B = E.myBoat();
    if (!fin.on) {
      fin.cd -= dt; fin.check -= dt;
      if (fin.cd > 0 || fin.check > 0) return;
      fin.check = FN.check;
      if (!B || B.sinking || W.day < 0.0 || W.storm || E.offAt(B.x, B.z) < FN.off || -E.bedAt(B.x, B.z) < 25) return;
      if (Math.random() < (W.omen ? FN.omenChance : FN.chance) * (0.4 + 0.6 * W.day)) { startFin(); }
      return;
    }
    fin.t += dt;
    if (!B || B.sinking || fin.t > fin.life || W.storm) { fin.on = false; fin.g.visible = false; fin.cd = rr(FN.cooldown); return; }
    fin.ang += fin.w * dt;
    const r = fin.r * (fin.t < 6 ? 1 + (6 - fin.t) * 0.25 : 1) * (fin.t > fin.life - 6 ? 1 + (fin.t - (fin.life - 6)) * 0.4 : 1);
    const x = B.x + Math.cos(fin.ang) * r, z = B.z + Math.sin(fin.ang) * r, hd = fin.ang + Math.sign(fin.w) * Math.PI / 2;
    const surf = E.waterY(x, z);
    const dive = sm(fin.life - 3, fin.life, fin.t) + 1 - sm(0, 2.2, fin.t);   // 剛來和要走的時候是沉的
    fin.g.position.set(x, surf - 0.12 - dive * 1.1, z);
    fin.g.rotation.set(Math.sin(time * 1.7) * 0.05, -hd, 0, 'YXZ');
    fin.g.visible = dive < 1;
    if (dive < 0.8 && (fin.foam += dt) > 0.14) { fin.foam = 0; E.splash(x - Math.cos(hd) * 0.6, surf, z - Math.sin(hd) * 0.6, 1); if ((fin.wr = (fin.wr || 0) + 1) % 3 === 0) ring(x - Math.cos(hd) * 1.2, z - Math.sin(hd) * 1.2, 2.4, 1.5, 0.3, 0.6); }
  }

  // ==========================================================================
  // 海龜：在淺水慢慢游，浮出來呼吸一陣、再沉下去
  // ==========================================================================
  const TT = WILD.turtle, turtles = [];
  function sampleWater(rmin, rmax, dmin, dmax, bias = true) {
    E.camera.getWorldDirection(fwd);
    for (let k = 0; k < 16; k++) {
      const a = bias ? Math.atan2(fwd.z, fwd.x) + rand(-1.4, 1.4) : rand(0, TAU), r = rand(rmin, rmax), x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r, d = -E.bedAt(x, z);
      if (d >= dmin && d <= dmax) return [x, z];
    }
    return null;
  }
  function addTurtle() {
    const g = makeTurtle(); setShade(g, TIER >= 2); group.add(g); g.visible = false;
    const o = { g, on: false, x: 0, z: 0, y: -3, hd: 0, ph: rand(0, TAU), up: true, st: 0, relocate: 0, dive: 1 };
    turtles.push(o);
  }
  function turtleTick(o, dt, idx) {
    const active = idx < TT.count[TIER] && W.weatherK > 0.45 && !W.storm;
    if (!active) { o.g.visible = false; o.on = false; return; }
    if (!o.on || dist2(o.x, o.z) > TT.far || (o.relocate -= dt) <= 0) {
      const p = sampleWater(TT.near[0], TT.near[1], TT.depth[0] + 0.3, TT.depth[1]);
      o.relocate = rand(60, 140);
      if (!p) { o.g.visible = false; return; }
      o.shown = undefined; o.x = p[0]; o.z = p[1]; o.hd = rand(0, TAU); o.on = true; o.up = true; o.st = rr(TT.up) * Math.random(); o.dive = 1;
    }
    o.st -= dt;
    if (o.st <= 0) { o.up = !o.up; o.st = o.up ? rr(TT.up) : rr(TT.down); }
    o.dive += ((o.up ? 0 : 1) - o.dive) * Math.min(1, dt * 0.6);
    // 前面太淺（或太深）就轉彎
    const ax = o.x + Math.cos(o.hd) * 3.5, az = o.z + Math.sin(o.hd) * 3.5, d = -E.bedAt(ax, az);
    if (d < TT.depth[0] || d > TT.depth[1] + 4) o.hd += 0.9 * dt; else o.hd += Math.sin(time * 0.2 + o.ph) * 0.12 * dt;
    const sp = TT.speed * (0.5 + 0.5 * (1 - o.dive));
    o.x += Math.cos(o.hd) * sp * dt; o.z += Math.sin(o.hd) * sp * dt;
    o.ph += dt * 1.8;
    const surf = E.waterY(o.x, o.z), y = surf - 0.04 - o.dive * 1.5 + Math.sin(time * 1.1 + o.ph) * 0.03;
    const shown = o.dive < 0.55;   // 殼浮出水面／沉下去的時候，水面一圈水花
    if (o.shown === undefined) o.shown = shown;
    else if (shown !== o.shown) { o.shown = shown; if (dist2(o.x, o.z) < 160) fx(o.x, o.z, 0.4, surf); }
    if (shown && ((o.wk = (o.wk || 0) - dt) <= 0) && dist2(o.x, o.z) < 120) {
      o.wk = 0.25; E.mist(o.x - Math.cos(o.hd) * 0.5, surf + 0.03, o.z - Math.sin(o.hd) * 0.5, rand(-0.3, 0.3), rand(0.6, 1.3), rand(-0.3, 0.3), rand(0.3, 0.6), rand(0.1, 0.2));
    }
    const fl = o.g.userData.flippers, stroke = Math.sin(o.ph);
    for (const f of fl) { f.g.rotation.x = f.s * (f.front ? stroke * 0.5 - 0.1 : stroke * 0.25); f.g.rotation.y = f.front ? f.s * stroke * -0.25 : 0; }
    o.g.position.set(o.x, y, o.z);
    o.g.rotation.set(Math.sin(time * 0.9 + o.ph) * 0.03, -o.hd, -0.12 * o.dive + Math.sin(time * 1.3) * 0.02, 'YXZ');
    o.g.visible = o.dive < 0.9 && dist2(o.x, o.z) < TT.far;
  }

  // ==========================================================================
  // 小魚群：淺水裡一群銀亮的小魚繞著游，船或人靠近就散開往下鑽
  // ==========================================================================
  const SC = WILD.school, schools = [];
  function addSchool() {
    const max = SC.fish[3], im = new THREE.InstancedMesh(makeSchoolFish(), wildMat, max);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    const col = new THREE.Color().setHSL(rand(0.5, 0.58), 0.45, 0.78);
    const f = [];
    for (let i = 0; i < max; i++) { im.setColorAt(i, col.clone().offsetHSL(rand(-0.03, 0.03), 0, rand(-0.08, 0.08))); f.push({ r: rand(0.25, 1) * SC.radius, w: rand(0.5, 1.3) * (Math.random() < 0.85 ? 1 : -1), ph: rand(0, TAU), yy: rand(-0.35, 0.1), wob: rand(0, TAU), sz: rand(0.8, 1.25) }); }
    setShade(im, false);
    im.visible = false;
    group.add(im);
    schools.push({ im, f, on: false, x: 0, z: 0, hd: 0, scare: 0, relocate: 0 });
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _sc = new THREE.Vector3();
  function schoolTick(s, dt, idx) {
    const n = SC.fish[TIER], active = idx < SC.count[TIER] && W.weatherK > 0.5 && !W.storm && W.day > 0.15;
    if (!active) { s.im.visible = false; s.on = false; return; }
    if (!s.on || dist2(s.x, s.z) > SC.far || (s.relocate -= dt) <= 0) {
      const p = sampleWater(SC.near[0], SC.near[1], SC.depth[0], SC.depth[1]);
      s.relocate = rand(50, 120);
      if (!p) { s.im.visible = false; return; }
      s.x = p[0]; s.z = p[1]; s.hd = rand(0, TAU); s.on = true; s.scare = 0;
    }
    // 嚇到：自己的船或人靠太近
    const P = E.player();
    let danger = 0;
    for (const b of E.boats()) { if (b.stored || b.sinking) continue; const d = Math.hypot(b.x - s.x, b.z - s.z); if (d < SC.scare + b.spec.len * 0.3) danger = Math.max(danger, Math.abs(b.speed) > 0.7 ? 1 : 0.5); }
    if (Math.hypot(P.x - s.x, P.z - s.z) < 6) danger = Math.max(danger, 0.6);
    const was = s.scare;
    s.scare += (danger - s.scare) * Math.min(1, dt * (danger > s.scare ? 4 : 0.4));
    if (was < 0.5 && s.scare >= 0.5 && dist2(s.x, s.z) < 150) {   // 嚇到的那一下：魚群四散，水面一片小水花
      const sf = E.waterY(s.x, s.z);
      for (let i = 0; i < 5; i++) { const a = rand(0, TAU), r = rand(0.5, SC.radius); fx(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, 0.22, sf); }
    }
    const ax = s.x + Math.cos(s.hd) * 5, az = s.z + Math.sin(s.hd) * 5, d = -E.bedAt(ax, az);
    if (d < SC.depth[0] || d > SC.depth[1] + 3) s.hd += 0.8 * dt; else s.hd += Math.sin(time * 0.25 + idx) * 0.1 * dt;
    s.x += Math.cos(s.hd) * (0.7 + 1.6 * s.scare) * dt; s.z += Math.sin(s.hd) * (0.7 + 1.6 * s.scare) * dt;
    const surf = E.waterY(s.x, s.z), spread = 1 + s.scare * 1.5, deep = s.scare * 1.1;
    s.im.count = n;
    for (let i = 0; i < n; i++) {
      const f = s.f[i], a = time * f.w * (1 + s.scare) + f.ph, rx = f.r * spread, rz = f.r * 0.7 * spread;
      const px = s.x + Math.cos(a) * rx * Math.cos(s.hd) - Math.sin(a) * rz * Math.sin(s.hd), pz = s.z + Math.cos(a) * rx * Math.sin(s.hd) + Math.sin(a) * rz * Math.cos(s.hd);
      // 游的方向 = 橢圓軌跡的切線（本地座標再轉 s.hd）
      const lx = -Math.sin(a) * rx * f.w, lz = Math.cos(a) * rz * f.w;
      const vx = lx * Math.cos(s.hd) - lz * Math.sin(s.hd), vz = lx * Math.sin(s.hd) + lz * Math.cos(s.hd);
      _p.set(px, surf - 0.16 + f.yy * 0.6 - deep + Math.sin(time * 2 + f.wob) * 0.05, pz);
      _e.set(0, -Math.atan2(vz, vx), 0);
      _q.setFromEuler(_e);
      _sc.setScalar(f.sz);
      _m.compose(_p, _q, _sc);
      s.im.setMatrixAt(i, _m);
    }
    s.im.instanceMatrix.needsUpdate = true;
    s.im.visible = dist2(s.x, s.z) < SC.far && s.scare < 0.97;
  }

  // ==========================================================================
  // 螃蟹：在沙地上橫著爬；人靠近就跑、鑽進沙裡，過一會兒從別的地方冒出來
  // ==========================================================================
  const CRB = WILD.crab, crabs = [];
  const areas = CRB.areas.map((a) => ({ ...a }));
  function randomCrabSpot(avoid) {
    for (let k = 0; k < 18; k++) {
      const a = areas[Math.floor(Math.random() * areas.length)], [x, z] = E.toWorld(rand(a.x0, a.x1), rand(a.z0, a.z1)), y = E.crabGround(x, z);
      if (y === null) continue;
      if (avoid && Math.hypot(avoid.x - x, avoid.z - z) < 6) continue;
      return { x, z, y };
    }
    return null;
  }
  function addCrab() {
    const g = makeCrab(); setShade(g, TIER >= 2); group.add(g); g.visible = false;
    crabs.push({ g, st: 'hidden', x: 0, z: 0, y: 0, face: 0, dir: 0, sp: 0, t: rand(0, 4), k: 0, ph: rand(0, TAU), wait: rand(0, 6) });
  }
  function crabTick(o, dt, idx) {
    const P = E.player(), active = idx < CRB.count[TIER] && W.day > 0.12 && W.weatherK > 0.5;
    if (!active && o.st !== 'hidden' && o.st !== 'burrow') { o.st = 'burrow'; o.t = 0; }
    if (!active && o.st === 'hidden') { o.g.visible = false; return; }
    const dp = Math.hypot(P.x - o.x, P.z - o.z);
    switch (o.st) {
      case 'hidden': {
        o.g.visible = false;
        if ((o.wait -= dt) <= 0 && active) {
          const s = randomCrabSpot(P);
          if (s) { o.x = s.x; o.z = s.z; o.y = s.y; o.face = rand(0, TAU); o.st = 'emerge'; o.t = 0; o.k = 0; }
          else o.wait = 3;
        }
        return;
      }
      case 'emerge': o.t += dt; o.k = sm(0, 0.4, o.t); if (o.t > 0.4) { o.st = 'idle'; o.t = rand(1, 3.5); } break;
      case 'burrow': o.t += dt; o.k = 1 - sm(0, 0.35, o.t); if (o.t > 0.35) { o.st = 'hidden'; o.wait = rr(CRB.hide); o.g.visible = false; return; } break;
      case 'idle':
        o.t -= dt;
        if (dp < CRB.flee) { o.st = 'flee'; o.t = rand(1.2, 2.4); o.dir = Math.atan2(o.z - P.z, o.x - P.x) + rand(-0.5, 0.5); o.face = o.dir + Math.PI / 2; o.sp = 2.3; break; }
        if (o.t <= 0) { o.st = 'walk'; o.t = rand(0.3, 1.0); o.dir = rand(0, TAU); o.face = o.dir + Math.PI / 2; o.sp = 0.5; }
        break;
      case 'walk':
        o.t -= dt;
        if (dp < CRB.flee) { o.st = 'flee'; o.t = rand(1.2, 2.4); o.dir = Math.atan2(o.z - P.z, o.x - P.x) + rand(-0.5, 0.5); o.face = o.dir + Math.PI / 2; o.sp = 2.3; break; }
        if (o.t <= 0) { o.st = 'idle'; o.t = rand(1.5, 4); o.sp = 0; }
        break;
      case 'flee':
        o.t -= dt;
        if (o.t <= 0 || dp > CRB.flee * 2.4) { o.st = 'burrow'; o.t = 0; o.sp = 0; }
        break;
      default: break;
    }
    if (o.sp > 0 && (o.st === 'walk' || o.st === 'flee')) {
      const nx = o.x + Math.cos(o.dir) * o.sp * dt, nz = o.z + Math.sin(o.dir) * o.sp * dt, y = E.crabGround(nx, nz);
      if (y === null) { o.dir += Math.PI * (0.6 + Math.random() * 0.8); o.face = o.dir + Math.PI / 2; }   // 前面是牆、棧板、水：換個方向
      else { o.x = nx; o.z = nz; o.y = y; }
    }
    o.ph += dt * (o.sp > 0 ? 24 : 0);
    const u = o.g.userData, sw = Math.sin(o.ph) * 0.2;
    u.legL.rotation.x = sw; u.legR.rotation.x = -sw;
    u.clawL.rotation.z = (o.st === 'flee' ? 0.5 : 0.15 + Math.sin(time * 2.2 + idx) * 0.18); u.clawR.rotation.z = -(o.st === 'flee' ? 0.5 : 0.15 + Math.sin(time * 2.6 + idx * 2) * 0.18);
    u.clawL.rotation.y = Math.sin(time * 3 + idx) * 0.15; u.clawR.rotation.y = -Math.sin(time * 3.3 + idx) * 0.15;
    o.g.position.set(o.x, o.y - (1 - o.k) * 0.06, o.z);
    o.g.rotation.set(0, -o.face, 0);
    o.g.scale.setScalar(Math.max(o.k, 0.01));
    o.g.visible = dist2(o.x, o.z) < CRB.far;
  }

  // ==========================================================================
  // 每幀
  // ==========================================================================
  function update(dt, t) {
    time = t;
    dt = Math.min(dt, 0.1);
    TIER = E.tier();
    W = E.world();
    // 一種一種補到該有的數量（畫質調高了就多生幾隻；調低了的由 active 判斷收起來）
    while (gulls.length < GS.count[TIER]) addGull();
    while (turtles.length < TT.count[TIER]) addTurtle();
    while (schools.length < SC.count[TIER]) addSchool();
    while (crabs.length < CRB.count[TIER]) addCrab();
    for (let i = 0; i < gulls.length; i++) {
      const o = gulls[i];
      if (i >= GS.count[TIER] && !o.hunt) { if (o.perch) { perchBusy.delete(o.perch.key); o.perch = null; } o.g.visible = false; o.st = 'hide'; o.hideT = 1e9; continue; }
      if (o.st === 'hide' && o.hideT > 1e8) o.hideT = 0;
      updateGull(o, dt);
    }
    stealTick(dt);
    podTick(dt);
    whaleTick(dt);
    finTick(dt);
    for (let i = 0; i < turtles.length; i++) turtleTick(turtles[i], dt, i);
    for (let i = 0; i < schools.length; i++) schoolTick(schools[i], dt, i);
    for (let i = 0; i < crabs.length; i++) crabTick(crabs[i], dt, i);
    ringsTick(dt);
  }

  // 離 (x, y, z) 最近、看得到的海鷗位置（音效用）；沒有就 null
  function nearestGull(x, z, out) {
    let best = null, bd = 1e9;
    for (const o of gulls) { if (!o.g.visible) continue; const d = Math.hypot(o.x - x, o.z - z); if (d < bd) { bd = d; best = o; } }
    if (!best) return null;
    return out.set(best.x, best.y, best.z);
  }
  // 測試用：立刻讓某種生物出現（?test 分頁、__sim.wild.force('dolphin'…)）
  function force(kind, arg = {}) {
    W = E.world();
    if (kind === 'dolphin') { const B = E.myBoat(); const hd = B.heading; if (pod) { for (const d of pod.ds) { d.used = false; d.g.visible = false; } pod = null; } newPod('ride', B, B.x + Math.cos(hd) * 30, B.z + Math.sin(hd) * 30, hd, Math.max(Math.abs(B.speed), 5)); return !!pod; }
    if (kind === 'fx') { fx(arg.x, arg.z, arg.k ?? 1); return true; }
    if (kind === 'pod') { if (pod) { for (const d of pod.ds) { d.used = false; d.g.visible = false; } pod = null; } newPod('wander', null, arg.x, arg.z, arg.hd ?? 0, 3.5); pod.life = 1e9; return true; }
    if (kind === 'whale') { whale.on = false; whale.breach = false; const ok = startWhale(true); return ok; }
    if (kind === 'breach') { whale.on = false; const ok = startWhale(true); whale.breach = true; return ok; }
    if (kind === 'fin') { fin.on = false; return startFin(); }
    if (kind === 'steal') {
      const list = E.stealables().filter((it) => it.kg <= ST.maxKg);
      if (!list.length) return false;
      if (steal.gull) abortHunt(steal.gull);
      for (const it of list) steal.seen.set(it, -99);
      startHunt(list[0], true);
      return true;
    }
    return false;
  }
  const info = () => ({ gulls: gulls.map((o) => o.st), pod: pod && { mode: pod.mode, n: pod.ds.length, t: pod.t }, whale: whale.on, fin: fin.on, turtles: turtles.filter((o) => o.on).length, crabs: crabs.map((c) => c.st), steal: !!steal.gull });
  return { update, nearestGull, force, info, group };
}
