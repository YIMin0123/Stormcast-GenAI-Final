// 大港灣島的碼頭與山城的模型（大港座標，配置見 havenPlan.js 的 PORT）：
// 進港的長棧橋和丁字碼頭、下水的石坡道、繫纜樁、依山的小屋、吊鉤大秤收購站、碼頭加油柱、海岬上的大燈塔。
// 交給全場共用的那個低面材質畫；走路、擋船的判斷在 havenShape.js（portWall、portPier、havenDeck）
import * as THREE from 'three';
import { FaceBuilder } from './kit.js';
import { jitter } from './palette.js';
import { beam } from './river3d.js';
import { portBollards } from './havenShape.js';
import { PORT, BAY } from './havenPlan.js';
import { SUMMIT } from '../extrasPlan.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// groundAt(x, z)：畫出來的地面多高；bedAt(x, z)：海底多深（樁要插到底）
// 回傳 { bollards 繫纜樁 [{ x, z, y }], rocks 擋路的 [{ x, z, r, top }], bulb 燈塔的燈 }
export function buildPort({ P, r, mat, group, groundAt, bedAt }) {
  const fb = new FaceBuilder(), out = { bollards: [], rocks: [] };
  // 放在某個位置、轉了某個角度的方塊（a 橫向、b 縱向，都是那個東西自己的座標）
  const rbox = (M, a0, a1, y0, y1, b0, b1, top, side = top, amt = 0.04) => {
    const g = new THREE.BoxGeometry(a1 - a0, y1 - y0, b1 - b0);
    g.translate((a0 + a1) / 2, (y0 + y1) / 2, (b0 + b1) / 2);
    g.applyMatrix4(M);
    const ct = jitter(top, r, amt), cs = jitter(side, r, amt);
    fb.addGeometry(g, (m, n) => (n.y > 0.5 ? ct : cs));
  };
  const cyl = (x, z, rt, rb, ya, yb, col, seg = 8) => {
    const g = new THREE.CylinderGeometry(rt, rb, yb - ya, seg);
    g.translate(x, (ya + yb) / 2, z);
    const c = jitter(col, r, 0.04), cap = c.clone().multiplyScalar(0.88);
    fb.addGeometry(g, (m, n) => (Math.abs(n.y) > 0.5 ? cap : c));
  };
  // 一片朝外的面（三角形或四邊形）：centre 是那個東西的中心，面一律背對它
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3(), mm = new THREE.Vector3();
  const face = (pts, centre, col) => {
    nn.crossVectors(e1.subVectors(pts[1], pts[0]), e2.subVectors(pts[2], pts[0]));
    mm.copy(pts[0]).add(pts[1]).add(pts[2]).multiplyScalar(1 / 3).sub(centre);
    const p = nn.dot(mm) < 0 ? [...pts].reverse() : pts;
    fb.tri(p[0].clone(), p[1].clone(), p[2].clone(), col);
    if (p.length > 3) fb.tri(p[0].clone(), p[2].clone(), p[3].clone(), col);
  };

  // ---- 棧板：一片一片橫著鋪（坡道跟著斜下去）；木棧橋底下有樑和插到海底的樁 ----
  for (const d of PORT.decks) {
    const at = (a, b, y) => V3(d.x + d.ux * a - d.uz * b, y, d.z + d.uz * a + d.ux * b), yAt = (a) => d.y0 + (d.y1 - d.y0) * (a / d.len);
    const step = d.stone ? 1.0 : 0.5;
    for (let a = 0; a < d.len - 0.01; a += step) {
      const m = a + step / 2, w = d.half * (1 + (r() - 0.5) * 0.04), y = yAt(m) - (d.stone ? 0.25 : 0.05);
      const col = d.stone ? jitter(r() < 0.3 ? P.concrete : P.stone, r, 0.05) : jitter(r() < 0.25 ? P.woodLight : r() < 0.2 ? P.woodGrey : P.wood, r, 0.06);
      beam(fb, at(m, -w, y), at(m, w, y), step * (d.stone ? 0.98 : 0.92), d.stone ? 0.5 : 0.1, col);
    }
    if (d.stone) continue;
    for (const b of [-d.half * 0.7, d.half * 0.7]) beam(fb, at(0, b, yAt(0) - 0.24), at(d.len, b, yAt(d.len) - 0.24), 0.2, 0.28, jitter(P.woodDark, r, 0.05));
    for (let a = 1.5; a < d.len; a += 4) {
      for (const b of [-d.half + 0.15, d.half - 0.15]) {
        const p = at(a, b, 0), tall = r() < 0.3;
        if (bedAt(p.x, p.z) > -0.5) continue;   // 還在岸上的那一段不用樁
        beam(fb, V3(p.x, bedAt(p.x, p.z) - 0.6, p.z), V3(p.x, yAt(a) + (tall ? 0.75 : -0.1), p.z), 0.3, 0.3, jitter(P.woodWet, r, 0.06));
      }
    }
  }
  // 繫纜樁
  for (const b of portBollards()) {
    cyl(b.x, b.z, 0.2, 0.24, PORT.deckY, PORT.deckY + 0.42, P.metal, 7);
    cyl(b.x, b.z, 0.3, 0.3, PORT.deckY + 0.42, PORT.deckY + 0.52, P.metal, 7);
    out.bollards.push({ x: b.x, z: b.z, y: PORT.deckY + 0.42 });
  }

  // ---- 依山的小屋：石砌的地基墊到最高的那個牆角，坡越陡地基越高 ----
  const roofs = [P.roofRed, P.roofSlate, P.roofTin];
  PORT.houses.forEach(([x, z, w, d, h, turn, kind], k) => {
    const rot = Math.atan2(BAY.x - x, BAY.z - z) + turn * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
    const toW = (a, b) => [x + a * c + b * s, z - a * s + b * c];
    const ys = [[-hw, -hd], [hw, -hd], [-hw, hd + 1.2], [hw, hd + 1.2], [0, 0]].map(([a, b]) => groundAt(...toW(a, b)));
    const y0 = Math.max(...ys) + 0.3, lo = Math.min(...ys) - 0.8 - y0;
    const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, y0, z), L = (a, y, b) => V3(a, y, b).applyMatrix4(M);
    const wall = kind ? P.plaster : P.wood, trim = kind ? P.woodDark : P.woodLight, rise = hd * 0.75, o = 0.45, roof = roofs[k % roofs.length];
    rbox(M, -hw - 0.2, hw + 0.2, lo, 0, -hd - 0.2, hd + 1.2, P.stone);                       // 地基＋門前的平台
    rbox(M, -hw, hw, 0, h, -hd, hd, wall, wall, 0.05);                                       // 牆
    rbox(M, -hw - 0.04, hw + 0.04, 0, 0.25, -hd - 0.04, hd + 0.04, trim);                    // 地檻
    rbox(M, -0.55, 0.55, 0, 2.0, hd, hd + 0.07, P.woodDark);                                 // 門
    for (const a of [-hw * 0.6, hw * 0.6]) rbox(M, a - 0.45, a + 0.45, 1.1, 2.0, hd, hd + 0.06, P.window, P.window, 0.02);   // 正面的窗
    for (const sd of [-1, 1]) rbox(M, sd * hw - 0.03, sd * hw + 0.03, 1.1, 2.0, -0.5, 0.5, P.window, P.window, 0.02);        // 兩側的窗
    // 屋頂：兩片斜面（屋脊順著屋子的寬）、兩頭的山牆
    const mid = L(0, h + rise * 0.4, 0), c1 = jitter(roof, r, 0.04), c2 = c1.clone().multiplyScalar(0.86);
    face([L(-hw - o, h - 0.1, -hd - o), L(hw + o, h - 0.1, -hd - o), L(hw + o, h + rise, 0), L(-hw - o, h + rise, 0)], mid, c2);
    face([L(-hw - o, h - 0.1, hd + o), L(hw + o, h - 0.1, hd + o), L(hw + o, h + rise, 0), L(-hw - o, h + rise, 0)], mid, c1);
    for (const sd of [-1, 1]) face([L(sd * hw, h, -hd), L(sd * hw, h, hd), L(sd * hw, h + rise * (hd / (hd + o)), 0)], mid, jitter(wall, r, 0.05));
    rbox(M, hw * 0.45, hw * 0.45 + 0.6, h + rise * 0.35, h + rise + 0.7, -0.3, 0.3, P.stone);   // 煙囪
  });

  // ---- 吊鉤大秤收購站：兩根柱子一根橫樑，樑上吊著大秤和鉤子；旁邊堆幾個木箱 ----
  {
    const S = PORT.sell, g0 = groundAt(S.x, S.z), top = g0 + 4.2;
    for (const a of [-1.8, 1.8]) beam(fb, V3(S.x + a, g0 - 0.3, S.z), V3(S.x + a, top, S.z), 0.3, 0.3, jitter(P.woodDark, r, 0.05));
    beam(fb, V3(S.x - 2.3, top, S.z), V3(S.x + 2.3, top, S.z), 0.3, 0.34, jitter(P.woodDark, r, 0.05));
    for (const a of [-1.8, 1.8]) beam(fb, V3(S.x + a * 0.55, top - 0.1, S.z), V3(S.x + a, top - 1.1, S.z), 0.16, 0.16, jitter(P.wood, r, 0.05));   // 斜撐
    beam(fb, V3(S.x, top - 0.15, S.z), V3(S.x, top - 0.9, S.z), 0.07, 0.07, P.metal);     // 吊鍊
    const dial = new THREE.CylinderGeometry(0.62, 0.62, 0.16, 12);                           // 秤面（朝灣口那一側）
    dial.rotateX(Math.PI / 2); dial.translate(S.x, top - 1.5, S.z);
    const dc = jitter(P.white, r, 0.02), rim = jitter(P.metal, r, 0.03);
    fb.addGeometry(dial, (m, n) => (Math.abs(n.z) > 0.5 ? dc : rim));
    beam(fb, V3(S.x, top - 1.52, S.z + 0.1), V3(S.x + 0.3, top - 1.2, S.z + 0.1), 0.05, 0.03, P.flagRed);   // 指針
    beam(fb, V3(S.x, top - 2.1, S.z), V3(S.x, top - 2.65, S.z), 0.06, 0.06, P.metal);     // 鉤子
    beam(fb, V3(S.x, top - 2.65, S.z), V3(S.x + 0.22, top - 2.5, S.z), 0.06, 0.06, P.metal);
    for (const [a, b, sz] of [[-2.9, -0.6, 0.9], [-2.7, 0.5, 0.7], [2.9, -0.3, 0.8]]) {
      const M = new THREE.Matrix4().makeRotationY(r() * 0.6).setPosition(S.x + a, groundAt(S.x + a, S.z + b), S.z + b);
      rbox(M, -sz / 2, sz / 2, 0, sz * 0.8, -sz / 2, sz / 2, P.crate, P.crate, 0.06);
    }
  }
  // ---- 碼頭加油柱：紅色的柱身、旁邊一個油桶 ----
  {
    const U = PORT.pump, y = PORT.deckY;
    const M = new THREE.Matrix4().setPosition(U.x, y, U.z);
    rbox(M, -0.28, 0.28, 0, 1.25, -0.2, 0.2, P.flagRed, P.flagRed, 0.03);
    rbox(M, -0.32, 0.32, 1.25, 1.36, -0.24, 0.24, P.metal);
    rbox(M, -0.2, 0.2, 0.75, 1.1, 0.2, 0.23, P.white, P.white, 0.02);
    beam(fb, V3(U.x + 0.3, y + 1.05, U.z), V3(U.x + 0.3, y + 0.35, U.z), 0.06, 0.06, P.lampPole);   // 油管
    cyl(U.x - 0.85, U.z + 0.1, 0.36, 0.36, y, y + 0.95, P.hullBlue, 9);
  }
  // ---- 大燈塔：站在迎浪那道海岬的最高處，紅白相間的八角塔身、瞭望台、燈室 ----
  {
    const T = PORT.lighthouse, y0 = groundAt(T.x, T.z) - 0.8, n = 5;
    cyl(T.x, T.z, T.r + 0.7, T.r + 1.0, y0 - 0.6, y0 + 1.0, P.stone, 8);
    for (let i = 0; i < n; i++) {
      const ra = T.r - (T.r - T.top) * (i / n), rb = T.r - (T.r - T.top) * ((i + 1) / n);
      cyl(T.x, T.z, rb, ra, y0 + 1.0 + (T.h - 1) * (i / n), y0 + 1.0 + (T.h - 1) * ((i + 1) / n), i % 2 ? P.flagRed : P.white, 8);
    }
    const yt = y0 + T.h;
    cyl(T.x, T.z, T.top + 0.75, T.top + 0.6, yt, yt + 0.28, P.metal, 8);       // 瞭望台
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; beam(fb, V3(T.x + Math.cos(a) * (T.top - 0.15), yt + 0.28, T.z + Math.sin(a) * (T.top - 0.15)), V3(T.x + Math.cos(a) * (T.top - 0.15), yt + 2.2, T.z + Math.sin(a) * (T.top - 0.15)), 0.1, 0.1, P.lampPole); }
    cyl(T.x, T.z, 0.05, T.top + 0.25, yt + 2.2, yt + 3.6, P.flagRed, 8);       // 尖頂
    out.rocks.push({ x: T.x, z: T.z, r: T.r + 0.8, top: 99 });
    // 燈：自己發亮、不吃霧（遠遠就要看得到）
    const bulb = new THREE.Mesh(new THREE.CylinderGeometry(T.top - 0.3, T.top - 0.3, 1.7, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false }));
    bulb.position.set(T.x, yt + 1.25, T.z);
    group.add(bulb);
    out.bulb = bulb;
  }
  const mesh = new THREE.Mesh(fb.build(), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return out;
}

// ---- 山頂：烽火台（石砌的圓台、鐵火盆、柴）和古鐘（木架吊著一口銅鐘）。火焰和煙是遊戲那邊另外畫的（見 havenFx.js）----
// 回傳擋路的東西 [{ x, z, r, top }]
export function buildSummit({ P, r, mat, group, groundAt }) {
  const fb = new FaceBuilder(), F = SUMMIT.fire, B = SUMMIT.bell, rocks = [];
  const cyl = (x, z, rt, rb, ya, yb, col, seg = 8) => {
    const g = new THREE.CylinderGeometry(rt, rb, yb - ya, seg);
    g.translate(x, (ya + yb) / 2, z);
    const c = jitter(col, r, 0.05), cap = c.clone().multiplyScalar(0.88);
    fb.addGeometry(g, (m, n) => (Math.abs(n.y) > 0.5 ? cap : c));
  };
  const gf = groundAt(F.x, F.z);
  cyl(F.x, F.z, 1.5, 1.8, gf - 0.8, gf + 1.6, P.stone, 9);          // 石砌的圓台
  cyl(F.x, F.z, 1.65, 1.65, gf + 1.6, gf + 1.8, P.concrete, 9);     // 台面的石板
  cyl(F.x, F.z, 1.05, 0.7, gf + 1.8, gf + 2.4, P.lampPole, 8);      // 鐵火盆
  for (let i = 0; i < 5; i++) { const a = i * 1.257; beam(fb, V3(F.x + Math.cos(a) * 0.7, gf + 2.35, F.z + Math.sin(a) * 0.7), V3(F.x - Math.cos(a) * 0.5, gf + 2.75, F.z - Math.sin(a) * 0.5), 0.16, 0.16, jitter(P.woodDark, r, 0.08)); }   // 柴
  rocks.push({ x: F.x, z: F.z, r: 1.7, top: 99 });
  const gb = groundAt(B.x, B.z), bronze = new THREE.Color('#b08d3c');
  for (const a of [-1.1, 1.1]) beam(fb, V3(B.x + a, gb - 0.3, B.z), V3(B.x + a, gb + 3.0, B.z), 0.24, 0.24, jitter(P.woodDark, r, 0.05));
  beam(fb, V3(B.x - 1.5, gb + 3.0, B.z), V3(B.x + 1.5, gb + 3.0, B.z), 0.26, 0.3, jitter(P.woodDark, r, 0.05));
  beam(fb, V3(B.x, gb + 2.85, B.z), V3(B.x, gb + 2.5, B.z), 0.06, 0.06, P.rope);
  cyl(B.x, B.z, 0.2, 0.3, gb + 2.3, gb + 2.52, bronze, 8);           // 鐘頂
  cyl(B.x, B.z, 0.3, 0.52, gb + 1.55, gb + 2.3, bronze, 8);          // 鐘身
  cyl(B.x, B.z, 0.56, 0.56, gb + 1.48, gb + 1.56, bronze, 8);        // 鐘口
  const mesh = new THREE.Mesh(fb.build(), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return rocks;
}
