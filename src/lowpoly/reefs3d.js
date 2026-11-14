// 海上礁石群的模型：海蝕巨石拱門、淺水環礁與沉船、中途燈標岩嶼（各自的座標，見 reefPlan.js）。
// 樣品間和遊戲共用；交給 kit.js 的同一個材質畫（燈標的燈泡例外：自己發亮、會閃）。
import * as THREE from 'three';
import { FaceBuilder, mirrored, fbm } from './kit.js';
import { jitter } from './palette.js';
import { rockGeo, islandTerrain } from './shapes.js';
import { boatGeo } from './harbor3d.js';
import { atollBed, beaconBed } from './reefShape.js';
import { ARCH, ATOLL, BEACON } from './reefPlan.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;

// 岩塊的樣板（3 種形狀 × 原版／鏡像）和往清單裡加一顆的函式
function rockKit(P, r) {
  const geos = [];
  for (let k = 0; k < 3; k++) { const g = rockGeo(k, P, 100 + k * 13); geos.push(g, mirrored(g)); }
  const lists = geos.map(() => []);
  const add = (kind, pos, scl, flip = r() < 0.35) => lists[kind * 2 + (r() < 0.5 ? 1 : 0)].push({ pos, scl, rot: r() * Math.PI * 2, flip, tint: 0.86 + r() * 0.2 });
  return { geos, lists, add };
}

// ---- 海蝕巨石拱門 ----
// 一根粗細不一的岩管沿著拱形走：兩隻腳插進海裡、中間拱起來。每一圈的頂點各自凹凸，面是大塊的切面；
// 朝上的面長草、側面照高度一層層換岩石的顏色（跟島上的岩層同一種畫法）
// 回傳 { rocks 擋路的 [{ x, z, r, top }] }
export function buildArch({ P, r, place, mat, group }) {
  const A = ARCH, SEG = 20, RING = 9, Y0 = -7, yTop = A.top - A.thick[1];
  const rings = [];
  for (let s = 0; s <= SEG; s++) {
    const u = s / SEG, ang = Math.PI * u, lift = Math.sin(ang) ** 0.72;
    const c = V3(-A.legX * Math.cos(ang) * (1 + 0.05 * Math.sin(ang * 3 + 1)), Y0 + (yTop - Y0) * lift, (fbm(u * 4 + 2, 7) - 0.5) * 5 * lift);
    // 切線（往下一圈的方向）：用中央差分；z 那個方向當厚度（順著航道比較厚）
    const e = 0.02, a1 = Math.PI * Math.min(1, u + e), a0 = Math.PI * Math.max(0, u - e);
    const T = V3(-A.legX * (Math.cos(a1) - Math.cos(a0)), (yTop - Y0) * (Math.sin(a1) ** 0.72 - Math.sin(a0) ** 0.72), 0).normalize();
    const N1 = V3(0, 0, 1), N2 = new THREE.Vector3().crossVectors(T, N1).normalize();
    const rad = lerp(A.thick[0] * (1 + 0.25 * (1 - lift)), A.thick[1], Math.sin(ang) ** 1.3);
    const ring = [];
    for (let k = 0; k < RING; k++) {
      const a = (k / RING) * Math.PI * 2 + s * 0.23, q = rad * (0.78 + r() * 0.44);
      ring.push(c.clone().addScaledVector(N2, Math.cos(a) * q).addScaledVector(N1, Math.sin(a) * q * A.deep));
    }
    rings.push({ c, ring });
  }
  const fb = new FaceBuilder();
  const strata = [P.rock2, P.rockWarm.clone().multiplyScalar(0.92), P.rock.clone().multiplyScalar(0.88), P.cliff.clone().lerp(P.rock2, 0.6).multiplyScalar(0.85)];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  const face = (a, b, c, mid) => {
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    m.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    if (n.dot(e1.subVectors(m, mid)) < 0) { const t = b; b = c; c = t; n.negate(); }   // 一律朝外
    let col;
    if (n.y > 0.7 && m.y > 5) col = r() < 0.35 ? P.moss : r() < 0.6 ? P.grassDark : P.grass2;
    else {
      col = strata[((Math.floor(m.y / 2.4 + (fbm(m.x * 0.08 + 13, m.z * 0.08) - 0.5) * 2.2) % 4) + 4) % 4];
      if (n.y < -0.2) col = col.clone().multiplyScalar(0.8);    // 拱的底面照不到光，暗一點
      if (m.y < 0.6) col = col.clone().multiplyScalar(0.8);     // 水線附近濕的
    }
    fb.tri(a, b, c, jitter(col, r, 0.06));
  };
  for (let s = 0; s < SEG; s++) {
    const A0 = rings[s], A1 = rings[s + 1], mid = A0.c.clone().add(A1.c).multiplyScalar(0.5);
    for (let k = 0; k < RING; k++) {
      const k2 = (k + 1) % RING, a = A0.ring[k], b = A0.ring[k2], c = A1.ring[k], d = A1.ring[k2];
      if ((s + k) % 2) { face(a, b, c, mid); face(b, d, c, mid); } else { face(a, b, d, mid); face(a, d, c, mid); }
    }
  }
  const mesh = new THREE.Mesh(fb.build(), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  // 腳邊堆幾顆大岩塊（一半泡在水裡）
  const K = rockKit(P, r), out = { rocks: [] };
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2, d = A.legR * (0.9 + r() * 0.75), s = 1.6 + r() * 2.4;
      const x = sx * A.legX + Math.cos(a) * d * (Math.cos(a) * sx > 0 ? 1 : 0.55), z = Math.sin(a) * d * 1.3;   // 水道那一側少放、放近一點
      const scl = V3(s * (0.8 + r() * 0.5), s * (0.6 + r() * 0.7), s * (0.8 + r() * 0.5));
      K.add(r() < 0.5 ? 2 : 0, V3(x, -scl.y * (0.2 + r() * 0.35), z), scl);
      out.rocks.push({ x, z, r: s * 0.75, top: 99 });
    }
  }
  K.geos.forEach((g, i) => place(g, K.lists[i], true, true));
  return out;
}

// ---- 淺水環礁與沉船暗礁陣 ----
export function buildAtoll({ P, r, place, mat, group, phone = false }) {
  const A = ATOLL, size = 2 * (A.rx + 46);
  // 礁盤：淺淺的海底一整片，水很淺所以看得到（顏色淺，遠遠就知道這裡水淺）
  const ground = islandTerrain(P, size, phone ? 3.4 : 2.4, 23, atollBed, 0, 0, { band: 1.5, minY: -9, tile: size });
  for (const geo of ground.geos) { const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; group.add(m); }
  const K = rockKit(P, r), out = { rocks: [] };
  // 尖礁：每一根是一顆拉高的岩柱，腳邊再靠兩三顆小的
  for (const s of A.spikes) {
    K.add(1, V3(s.x, s.h - (s.h + 3) * 0.62, s.z), V3(s.r * 0.95, (s.h + 3) * 0.62, s.r * 0.95), false);
    out.rocks.push({ x: s.x, z: s.z, r: s.r * 0.8, top: 99 });
    for (let i = 0; i < 3; i++) {
      const a = r() * Math.PI * 2, d = s.r * (0.8 + r() * 0.6), q = 0.8 + r() * 1.2;
      K.add(r() < 0.5 ? 0 : 2, V3(s.x + Math.cos(a) * d, -0.5 - r() * 0.4, s.z + Math.sin(a) * d), V3(q, q * (0.6 + r() * 0.5), q));
    }
  }
  // 礁盤上零星的小石頭（剛好露出水面一點）
  for (let i = 0; i < (phone ? 14 : 30); i++) {
    const a = r() * Math.PI * 2, e = Math.sqrt(r()) * 0.8, x = Math.cos(a) * A.rx * e, z = Math.sin(a) * A.rz * e, q = 0.5 + r() * 0.8;
    K.add(2, V3(x, atollBed(x, z) + q * 0.15, z), V3(q * 1.3, q * 0.7, q * 1.3));
  }
  K.geos.forEach((g, i) => place(g, K.lists[i], true, true));
  // 半截沉船：歪著卡在礁盤上，船尾泡在水裡；顏色壓暗（泡了很久）
  const W = A.wreck, hull = P.hullRed.clone().lerp(P.rockWarm, 0.55).multiplyScalar(0.7);
  const boat = new THREE.Mesh(boatGeo(W.type, P, hull, 77), mat);
  boat.position.set(W.x, -0.75, W.z);
  boat.rotation.set(0.42, W.yaw, -0.16, 'YXZ');   // 往一邊倒、船尾往下沉
  boat.castShadow = boat.receiveShadow = true;
  group.add(boat);
  const c = Math.cos(W.yaw), sn = Math.sin(W.yaw);
  for (const t of [-4, 0, 4]) out.rocks.push({ x: W.x + c * t, z: W.z - sn * t, r: 2.6, top: 99 });
  return out;
}

// ---- 中途燈標岩嶼 ----
// 回傳 { rocks, bulb 會閃的燈（遊戲每幀照時間開關它）, lamp 燈的位置 [x, y, z] }
export function buildBeacon({ P, r, place, mat, group, phone = false }) {
  const B = BEACON, size = 2 * (B.r + 30);
  const ground = islandTerrain(P, size, phone ? 2.2 : 1.5, 29, beaconBed, 0, 0, { band: 1.5, minY: -9, tile: size });
  for (const geo of ground.geos) { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; group.add(m); }
  const K = rockKit(P, r), out = { rocks: [] };
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2, d = B.r * (0.55 + r() * 0.6), x = Math.cos(a) * d, z = Math.sin(a) * d / 1.2, s = 1.0 + r() * 2.0;
    const scl = V3(s * (0.8 + r() * 0.5), s * (0.6 + r() * 0.6), s * (0.8 + r() * 0.5));
    K.add(r() < 0.5 ? 2 : 0, V3(x, ground.at(x, z) - scl.y * (0.2 + r() * 0.3), z), scl);
    if (s > 2) out.rocks.push({ x, z, r: s * 0.7, top: 99 });
  }
  K.geos.forEach((g, i) => place(g, K.lists[i], true, true));
  // 燈樁：水泥墩、紅白相間的鐵桿、頂上一盞燈
  const fb = new FaceBuilder(), y0 = ground.at(0, 0) - 0.3, H = B.post.h;
  const cyl = (rt, rb, ya, yb, col, seg = 7) => {
    const g = new THREE.CylinderGeometry(rt, rb, yb - ya, seg);
    g.translate(0, (ya + yb) / 2, 0);
    fb.addGeometry(g, (mid, nrm) => (Math.abs(nrm.y) > 0.5 ? col.clone().multiplyScalar(0.86) : jitter(col, r, 0.04)));
  };
  cyl(0.85, 1.05, y0, y0 + 0.9, P.concrete);
  const bands = 5;
  for (let i = 0; i < bands; i++) cyl(0.2, 0.22, y0 + 0.9 + (H - 1.5) * (i / bands), y0 + 0.9 + (H - 1.5) * ((i + 1) / bands), i % 2 ? P.white : P.flagRed, 6);
  cyl(0.5, 0.42, y0 + H - 0.6, y0 + H - 0.45, P.metal, 8);   // 燈座
  cyl(0.34, 0.34, y0 + H - 0.05, y0 + H + 0.1, P.metal, 8);  // 燈罩頂
  const post = new THREE.Mesh(fb.build(), mat);
  post.castShadow = post.receiveShadow = true;
  group.add(post);
  out.rocks.push({ x: 0, z: 0, r: 1.05, top: y0 + 0.9 });
  out.rocks.push({ x: 0, z: 0, r: 0.22, top: y0 + H + 0.1 });
  // 燈：自己發亮的一顆，不吃霧（遠遠就要看得到，這是它的用途）
  const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.4, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false }));
  bulb.position.set(0, y0 + H - 0.25, 0);
  group.add(bulb);
  out.bulb = bulb;
  out.lamp = [0, y0 + H - 0.25, 0];
  return out;
}
