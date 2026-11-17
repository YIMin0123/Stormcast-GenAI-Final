// 海上修船屋的模型（修船屋座標，配置見 seaYardPlan.js）：
// 立在海裡的固定樁平台（兩條長臂夾著停船凹槽、底部一塊大平台）、鐵皮木構斜頂的工坊、黃黑龍門吊、屋頂大招牌和常亮的引航燈。
// 交給全場共用的那個低面材質畫；走路、擋船的判斷在 seaYardShape.js
import * as THREE from 'three';
import { FaceBuilder, withSurf, SURF } from './kit.js';
import { jitter } from './palette.js';
import { beam } from './river3d.js';
import * as Y from './seaYardPlan.js';
import { placeGoods, ladder3d, tire3d, signBoard, bulbs } from './siteKit.js';
import { GOOD_COLORS as Q } from './goods3d.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// shelves：這個據點的商品與工位（layout.js 的 SITE_SHELF_W 裡 site = 'yard' 的那幾筆）
// 回傳 { rocks 擋路的（沒有）, bollards 繫纜樁 [{ x, z, y }], tags 價格牌, unlit 不吃光的材質, lamps 晚上的燈 [[x, y, z]], light(glow) 每幀調燈 }
export function buildSeaYard({ P, r, mat, group, phone = false, shelves = [] }) {
  const fb = new FaceBuilder(), out = { rocks: [], bollards: [], lamps: [] };
  const D = Y.DECK_Y, H = Y.HOUSE;
  const box = (x0, x1, y0, y1, z0, z1, top, side = top, amt = 0.04) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const ct = jitter(top, r, amt), cs = jitter(side, r, amt), cd = cs.clone().multiplyScalar(0.9);
    fb.addGeometry(g, (m, n) => (n.y > 0.5 ? ct : Math.abs(n.x) > 0.5 ? cd : cs));
  };
  const cyl = (x, z, rt, rb, ya, yb, col, seg = 8) => {
    const g = new THREE.CylinderGeometry(rt, rb, yb - ya, seg);
    g.translate(x, (ya + yb) / 2, z);
    const c = jitter(col, r, 0.04), cap = c.clone().multiplyScalar(0.88);
    fb.addGeometry(g, (m, n) => (Math.abs(n.y) > 0.5 ? cap : c));
  };
  const plank = () => jitter(r() < 0.25 ? P.woodLight : r() < 0.2 ? P.woodGrey : P.wood, r, 0.06);

  // ---- 平台：一片一片的木板（長臂橫著鋪、大平台直著鋪），邊上一圈深色的收邊，底下是橫樑和插進海裡的樁 ----
  const step = phone ? 1.0 : 0.5;
  for (const d of Y.DECKS) {
    const alongZ = d.id !== 'main';
    if (alongZ) for (let z = d.z0; z < d.z1 - 0.01; z += step) { const w = 0.03 * (r() - 0.5); beam(fb, V3(d.x0 + w, D - 0.05, z + step / 2), V3(d.x1 + w, D - 0.05, z + step / 2), step * 0.93, 0.1, plank()); }
    else for (let x = d.x0; x < d.x1 - 0.01; x += step * 1.1) { const zm = -8 + (r() - 0.5) * 2; beam(fb, V3(x + step * 0.55, D - 0.05, d.z0), V3(x + step * 0.55, D - 0.05, zm), step * 1.03, 0.1, plank()); beam(fb, V3(x + step * 0.55, D - 0.05, zm), V3(x + step * 0.55, D - 0.05, d.z1), step * 1.03, 0.1, plank()); }
    // 收邊、橫樑
    const edge = jitter(P.woodDark, r, 0.05);
    for (const z of [d.z0 + 0.1, d.z1 - 0.1]) beam(fb, V3(d.x0, D - 0.22, z), V3(d.x1, D - 0.22, z), 0.2, 0.3, edge);
    for (const x of [d.x0 + 0.1, d.x1 - 0.1]) beam(fb, V3(x, D - 0.22, d.z0), V3(x, D - 0.22, d.z1), 0.2, 0.3, edge);
    // 樁：沿著長邊每 4 公尺一根，有幾根高出平台
    const pile = (x, z) => { const tall = r() < 0.35; beam(fb, V3(x, -7, z), V3(x + (r() - 0.5) * 0.12, D + (tall ? 0.8 : -0.1), z + (r() - 0.5) * 0.12), 0.34, 0.34, jitter(P.woodWet, r, 0.06)); };
    if (alongZ) for (let z = d.z0 + 2; z <= d.z1; z += 4) { pile(d.x0 + 0.2, z); pile(d.x1 - 0.2, z); }
    else { for (let x = d.x0 + 0.3; x <= d.x1; x += 4.28) { pile(x, d.z0 + 0.2); if (Math.abs(x) > 4.6) pile(x, d.z1 - 0.2); } for (const x of [d.x0 + 0.2, d.x1 - 0.2]) pile(x, -8); }
  }
  // 樁之間貼著水面的橫撐（看得出是固定在海底的平台，不是浮的）
  for (const x of [-8.3, -4.7, 4.7, 8.3]) beam(fb, V3(x, 0.55, -1.5), V3(x, 0.55, 17.8), 0.16, 0.22, jitter(P.woodWet, r, 0.05));
  for (const z of [-13.8, -2.2]) beam(fb, V3(-10.8, 0.55, z), V3(10.8, 0.55, z), 0.16, 0.22, jitter(P.woodWet, r, 0.05));

  // ---- 工坊：木柱、鐵皮牆（後牆和兩側）、朝凹槽那面整面敞開、兩片斜的鐵皮屋頂 ----
  const tin = withSurf(P.roofTin, SURF.tin), wy = D + H.h;
  for (const x of [H.x0 + 0.15, -3.5, 3.5, H.x1 - 0.15]) for (const z of [H.z0 + 0.15, H.z1 - 0.15]) box(x - 0.15, x + 0.15, D, wy, z - 0.15, z + 0.15, P.woodDark);
  // 後牆：下半木板、上半鐵皮（一片一片的浪板）
  box(H.x0, H.x1, D, D + 1.1, H.z0, H.z0 + 0.12, P.wood, P.wood, 0.05);
  for (let x = H.x0; x < H.x1 - 0.01; x += 1.3) box(x, Math.min(H.x1, x + 1.3) - 0.03, D + 1.1, wy, H.z0 + 0.02, H.z0 + 0.1, tin, tin, 0.07);
  for (const sx of [H.x0, H.x1 - 0.12]) {
    box(sx, sx + 0.12, D, D + 1.1, H.z0, H.z1, P.wood, P.wood, 0.05);
    for (let z = H.z0; z < H.z1 - 0.01; z += 1.25) { const win = z > H.z0 + 3 && z < H.z0 + 6; box(sx + 0.02, sx + 0.1, D + 1.1, win ? D + 1.5 : wy, z, z + 1.22, tin, tin, 0.07); if (win) { box(sx + 0.02, sx + 0.1, D + 2.5, wy, z, z + 1.22, tin, tin, 0.07); box(sx + 0.04, sx + 0.08, D + 1.5, D + 2.5, z, z + 1.22, P.window, P.window, 0.02); } }
  }
  box(H.x0, H.x1, wy - 0.3, wy, H.z1 - 0.2, H.z1, P.woodDark);   // 正面的大橫樑
  box(H.x0, H.x1, wy - 0.3, wy, H.z0, H.z0 + 0.2, P.woodDark);
  // 屋頂：屋脊沿著 x，一片一片的浪板（有幾片鏽了）
  {
    const zm = (H.z0 + H.z1) / 2, o = 0.6, y0 = wy - 0.05, y1 = wy + H.rise;
    const rust = withSurf(new THREE.Color('#8a5a3c'), SURF.tin);
    for (let x = H.x0 - o; x < H.x1 + o - 0.01; x += 1.3) {
      const x1 = Math.min(H.x1 + o, x + 1.3), c1 = jitter(r() < 0.14 ? rust : tin, r, 0.07), c2 = jitter(r() < 0.14 ? rust : tin, r, 0.07).multiplyScalar(0.88);
      const a = V3(x, y0, H.z0 - o), b = V3(x1, y0, H.z0 - o), c = V3(x1, y1, zm), d = V3(x, y1, zm), e = V3(x, y0, H.z1 + o), f = V3(x1, y0, H.z1 + o);
      fb.tri(a, d, c, c2); fb.tri(a, c, b, c2); fb.tri(e, f, c, c1); fb.tri(e, c, d, c1);
      const under = c2.clone().multiplyScalar(0.6);
      fb.tri(a, c, d, under); fb.tri(a, b, c, under); fb.tri(e, c, f, under); fb.tri(e, d, c, under);
    }
    box(H.x0 - o, H.x1 + o, y1 - 0.06, y1 + 0.1, zm - 0.14, zm + 0.14, P.woodDark);   // 屋脊
    for (const x of [H.x0, H.x1]) {   // 兩頭的山牆（三角形的那一塊）
      const c = jitter(tin, r, 0.06), a = V3(x, wy, H.z0), b = V3(x, wy, H.z1), t = V3(x, y1 - 0.1, zm);
      fb.tri(a, b, t, c); fb.tri(a, t, b, c);
    }
    for (const x of [-7, 0, 7]) { beam(fb, V3(x, wy - 0.15, H.z0), V3(x, wy - 0.15, H.z1), 0.16, 0.22, jitter(P.woodDark, r, 0.05)); beam(fb, V3(x, wy, zm), V3(x, y1 - 0.1, zm), 0.14, 0.14, jitter(P.woodDark, r, 0.05)); }   // 屋架
    // 屋樑下吊的三盞工作燈
    for (const x of [-7, 0, 7]) { beam(fb, V3(x, wy - 0.26, zm + 2), V3(x, wy - 0.75, zm + 2), 0.03, 0.03, Q.dark); out.lamps.push([x, wy - 0.85, zm + 2]); }
    // 招牌：站在正面的屋簷上；引航燈：屋脊上一根桿子
    const S = Y.SIGN, sy = wy + 0.35 + S.h / 2;
    for (const sx of [-1, 1]) beam(fb, V3(S.x + sx * S.w * 0.42, wy - 0.1, S.z - 0.12), V3(S.x + sx * S.w * 0.42, sy + S.h / 2, S.z - 0.12), 0.12, 0.12, jitter(P.woodDark, r, 0.05));
    box(S.x - S.w / 2 - 0.08, S.x + S.w / 2 + 0.08, sy - S.h / 2 - 0.08, sy + S.h / 2 + 0.08, S.z - 0.08, S.z - 0.01, P.woodDark);
    const sign = signBoard(S.text, S.w, S.h, S.x, sy, S.z + 0.005);
    group.add(sign.mesh);
    out.unlit = [sign.mat];
    const B = Y.BEACON, by = y1 + B.h;
    cyl(B.x, B.z, 0.06, 0.09, y1, by - 0.2, P.lampPole, 6);
    cyl(B.x, B.z, 0.3, 0.3, by - 0.26, by - 0.2, P.lampPole, 8); cyl(B.x, B.z, 0.1, 0.32, by + 0.3, by + 0.5, P.lampPole, 8);
    // 引航燈：自己發亮、不吃霧（遠遠就要看得到）
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 8), new THREE.MeshBasicMaterial({ color: 0xffa640, fog: false, toneMapped: false }));
    beacon.position.set(B.x, by + 0.05, B.z);
    group.add(beacon);
    out.beacon = [B.x, by + 0.05, B.z];
    out.beaconMesh = beacon;
  }

  // ---- 屋裡：一整排展示台、後牆的工作台 ----
  {
    const b = Y.BENCH;
    box(b.x0, b.x1, D + b.h - 0.1, D + b.h, b.z0, b.z1, P.woodLight, P.wood);
    box(b.x0 + 0.1, b.x1 - 0.1, D + 0.1, D + b.h - 0.1, b.z0 + 0.08, b.z1 - 0.08, P.wood, P.woodDark, 0.05);
    box(b.x0 + 0.05, b.x1 - 0.05, D, D + 0.1, b.z0 + 0.04, b.z1 - 0.04, P.woodDark);
    const k = Y.BACK_BENCH;
    box(k.x0, k.x1, D + k.h - 0.08, D + k.h, k.z0, k.z1, P.wood, P.woodDark);
    for (let x = k.x0 + 0.2; x < k.x1; x += 2.4) box(x - 0.08, x + 0.08, D, D + k.h - 0.08, k.z0 + 0.1, k.z1 - 0.1, P.woodDark);
    box(k.x0 + 0.1, k.x1 - 0.1, D + 0.3, D + 0.36, k.z0 + 0.06, k.z1 - 0.06, P.wood, P.woodDark);
    if (!phone) {
      // 工作台上的東西：工具箱、虎鉗、一台拆下來的舷外機、油漆桶；後牆的層板
      box(-8.6, -7.8, D + k.h, D + k.h + 0.32, -12.8, -12.35, Q.red, Q.redDark); box(-7.5, -6.9, D + k.h, D + k.h + 0.22, -12.75, -12.35, Q.steel, Q.dark);
      box(-3.2, -2.9, D + k.h, D + k.h + 0.28, -12.7, -12.4, Q.dark, Q.dark); box(-3.35, -2.75, D + k.h + 0.2, D + k.h + 0.3, -12.72, -12.62, Q.steel, Q.steel);
      box(1.2, 2.3, D + k.h, D + k.h + 0.45, -12.8, -12.3, Q.dark, Q.dark); box(1.4, 2.1, D + k.h + 0.45, D + k.h + 0.7, -12.75, -12.35, Q.white, Q.red);
      for (let i = 0; i < 4; i++) cyl(5.2 + i * 0.42, -12.55, 0.15, 0.15, D + k.h, D + k.h + 0.3, [Q.blue, Q.yellow, Q.white, Q.green][i], 7);
      box(-9.4, 9.4, D + 2.0, D + 2.06, H.z0 + 0.12, H.z0 + 0.5, P.wood, P.woodDark);
      for (let i = 0; i < 9; i++) { const x = -8.8 + i * 2.1 + r() * 0.5, h = 0.25 + r() * 0.3; box(x, x + 0.5 + r() * 0.5, D + 2.06, D + 2.06 + h, H.z0 + 0.15, H.z0 + 0.45, [P.crate, Q.steel, Q.blue, Q.red, P.woodLight][i % 5], undefined, 0.07); }
      // 牆上掛的螺旋槳和救生圈
      { const g = new THREE.TorusGeometry(0.42, 0.11, 6, 12); g.translate(-9.6, D + 2.6, H.z0 + 0.2); const c1 = jitter(Q.orange, r, 0.03), c2 = jitter(Q.white, r, 0.02); fb.addGeometry(g, (m) => (Math.abs(m.x + 9.6) < 0.2 || Math.abs(m.y - D - 2.6) < 0.2 ? c2 : c1)); }
      for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + 0.5; beam(fb, V3(8.9, D + 2.7, H.z0 + 0.2), V3(8.9 + Math.cos(a) * 0.55, D + 2.7 + Math.sin(a) * 0.55, H.z0 + 0.24), 0.26, 0.04, jitter(Q.brass, r, 0.04)); }
      // 屋角：木箱、木桶、一捲纜繩
      for (const [x, z, s] of [[-9.6, -10.6, 0.9], [-9.5, -9.5, 0.7], [9.7, -10.9, 0.85], [9.6, -5.0, 0.7]]) box(x - s / 2, x + s / 2, D, D + s * 0.85, z - s / 2, z + s / 2, P.crate, P.crate, 0.07);
      cyl(9.7, -9.6, 0.34, 0.3, D, D + 0.85, P.wood, 9); cyl(-9.7, -5.2, 0.34, 0.3, D, D + 0.85, Q.blue, 9);
      { const g = new THREE.TorusGeometry(0.4, 0.13, 5, 12); g.rotateX(Math.PI / 2); g.translate(9.7, D + 0.13, -6.4); const c = jitter(Q.rope, r, 0.05); fb.addGeometry(g, () => c); }
    }
  }
  // 油桶攤：一座矮木台，油桶擺上面
  { const f = Y.GOODS.find((g) => g.id === 'fuel'); box(f.x - 0.6, f.x + 0.6, D, f.y, f.z - 0.32, f.z + 0.32, P.woodLight, P.wood); }

  // ---- 黃黑相間的小龍門吊：立柱、往凹槽伸出去的吊臂、斜撐、鍊條和吊鉤 ----
  {
    const K = Y.CRANE, top = D + K.h, dl = Math.hypot(6.2, 2.6), dx = 6.2 / dl, dz = 2.6 / dl;
    box(K.x - 0.5, K.x + 0.5, D, D + 0.25, K.z - 0.5, K.z + 0.5, Q.dark);
    const n = 6;
    for (let i = 0; i < n; i++) box(K.x - 0.17, K.x + 0.17, D + 0.25 + (K.h - 0.25) * i / n, D + 0.25 + (K.h - 0.25) * (i + 1) / n, K.z - 0.17, K.z + 0.17, i % 2 ? Q.black : Q.yellow, i % 2 ? Q.black : Q.yellow, 0.02);
    const m = 8;
    for (let i = 0; i < m; i++) beam(fb, V3(K.x + dx * (K.reach * i / m - 0.8), top, K.z + dz * (K.reach * i / m - 0.8)), V3(K.x + dx * (K.reach * (i + 1) / m - 0.8), top, K.z + dz * (K.reach * (i + 1) / m - 0.8)), 0.22, 0.3, jitter(i % 2 ? Q.black : Q.yellow, r, 0.02));
    beam(fb, V3(K.x, top - 1.6, K.z), V3(K.x + dx * 2.2, top - 0.12, K.z + dz * 2.2), 0.12, 0.12, jitter(Q.yellow, r, 0.03));
    beam(fb, V3(K.x, top + 0.9, K.z), V3(K.x + dx * (K.reach - 1.2), top + 0.15, K.z + dz * (K.reach - 1.2)), 0.05, 0.05, Q.dark);   // 拉索
    box(K.x - 0.12, K.x + 0.12, top, top + 0.95, K.z - 0.12, K.z + 0.12, Q.yellow);
    const hx = K.x + dx * (K.reach - 1.4), hz = K.z + dz * (K.reach - 1.4);
    box(hx - 0.2, hx + 0.2, top - 0.35, top - 0.15, hz - 0.2, hz + 0.2, Q.dark);                         // 天車
    beam(fb, V3(hx, top - 0.35, hz), V3(hx, top - 2.1, hz), 0.05, 0.05, Q.steel);                         // 鍊條
    box(hx - 0.13, hx + 0.13, top - 2.4, top - 2.1, hz - 0.1, hz + 0.1, Q.yellow);
    beam(fb, V3(hx, top - 2.4, hz), V3(hx, top - 2.75, hz), 0.06, 0.06, Q.steel); beam(fb, V3(hx, top - 2.75, hz), V3(hx + 0.2, top - 2.62, hz), 0.06, 0.06, Q.steel);   // 吊鉤
  }

  // ---- 繫纜樁、爬梯、防撞輪胎 ----
  for (const b of Y.BOLLARDS) {
    cyl(b.x, b.z, 0.2, 0.24, D, D + 0.42, P.metal, 7); cyl(b.x, b.z, 0.3, 0.3, D + 0.42, D + 0.52, P.metal, 7);
    out.bollards.push({ x: b.x, z: b.z, y: D + 0.42 });
  }
  for (const l of Y.LADDERS) ladder3d(fb, l, D, P, r);
  for (const t of Y.TIRES) tire3d(fb, t, D, r);

  // ---- 商品和價格牌 ----
  const goods = placeGoods(fb, group, shelves, { P, floorOf: () => D });
  out.tags = goods.tags;
  out.unlit.push(...goods.unlit);

  const mesh = new THREE.Mesh(fb.build(), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  // 工作燈的燈泡：天黑了才亮
  const lamp = bulbs(out.lamps, 0.14);
  group.add(lamp.mesh);
  out.light = (glow) => { lamp.mat.color.copy(lamp.mat.userData.base).multiplyScalar(0.45 + 1.4 * glow); };
  return out;
}
