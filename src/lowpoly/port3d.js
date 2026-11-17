// 大港灣島的碼頭與山城的模型（大港座標，配置見 havenPlan.js 的 PORT）：
// 海堤廣場、主棧橋和丁字碼頭、西翼修船突堤、東翼指棧、下水的石坡道、繫纜樁、爬梯、鑄鐵路燈；
// 岸上三棟（遠洋船塢＆補給所、榮譽榜亭、水產批發所）、東岸高台的海神祭壇、依山的小屋、海岬上的大燈塔。
// 交給全場共用的那個低面材質畫；走路、擋船的判斷在 havenShape.js（portWall、portPier、havenDeck）
import * as THREE from 'three';
import { FaceBuilder, withSurf, SURF } from './kit.js';
import { jitter } from './palette.js';
import { beam } from './river3d.js';
import { portBollards } from './havenShape.js';
import { PORT, BAY, TOWN } from './havenPlan.js';
import { placeGoods, ladder3d, tire3d, lampPost, signBoard, bulbs, glowQuads } from './siteKit.js';
import { GOOD_COLORS as Q } from './goods3d.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// groundAt(x, z)：畫出來的地面多高；bedAt(x, z)：海底多深（樁要插到底）。phone：手機（小裝飾不蓋）。
// shelves：這個據點的商品與工位（layout.js 的 SITE_SHELF_W 裡 site = 'haven' 的那幾筆）
// 回傳 { bollards 繫纜樁 [{ x, z, y }], rocks 擋路的 [{ x, z, r, top }], bulb 燈塔的燈, lamp 燈塔燈的位置, tags 價格牌, unlit 不吃光的材質,
//        lamps 晚上的路燈 [[x, y, z]], light(glow) 每幀調燈 }
export function buildPort({ P, r, mat, group, groundAt, bedAt, phone = false, shelves = [] }) {
  const fb = new FaceBuilder(), out = { bollards: [], rocks: [], lamps: [], unlit: [] };
  const G = TOWN.y, D = PORT.deckY;
  // 放在某個位置、轉了某個角度的方塊（a 橫向、b 縱向，都是那個東西自己的座標）
  const rbox = (M, a0, a1, y0, y1, b0, b1, top, side = top, amt = 0.04) => {
    const g = new THREE.BoxGeometry(a1 - a0, y1 - y0, b1 - b0);
    g.translate((a0 + a1) / 2, (y0 + y1) / 2, (b0 + b1) / 2);
    g.applyMatrix4(M);
    const ct = jitter(top, r, amt), cs = jitter(side, r, amt);
    fb.addGeometry(g, (m, n) => (n.y > 0.5 ? ct : cs));
  };
  const I = new THREE.Matrix4();
  const box = (x0, x1, y0, y1, z0, z1, top, side = top, amt = 0.04) => rbox(I, x0, x1, y0, y1, z0, z1, top, side, amt);
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
  // 屋脊沿著 x 的兩片斜屋頂（一片一片的，顏色各差一點）：範圍 x0..x1、z0..z1，屋簷高 y0、屋脊再高 rise、屋簷多出去 o
  const roof = (x0, x1, z0, z1, y0, rise, o, col, strip = 1.4) => {
    const zm = (z0 + z1) / 2;
    for (let x = x0 - o; x < x1 + o - 0.01; x += strip) {
      const xb = Math.min(x1 + o, x + strip), c1 = jitter(col, r, 0.06), c2 = jitter(col, r, 0.06).multiplyScalar(0.86), under = c2.clone().multiplyScalar(0.6);
      const a = V3(x, y0, z0 - o), b = V3(xb, y0, z0 - o), c = V3(xb, y0 + rise, zm), d = V3(x, y0 + rise, zm), e = V3(x, y0, z1 + o), f = V3(xb, y0, z1 + o);
      fb.tri(a, d, c, c2); fb.tri(a, c, b, c2); fb.tri(e, f, c, c1); fb.tri(e, c, d, c1);
      fb.tri(a, c, d, under); fb.tri(a, b, c, under); fb.tri(e, c, f, under); fb.tri(e, d, c, under);
    }
    box(x0 - o, x1 + o, y0 + rise - 0.06, y0 + rise + 0.1, zm - 0.13, zm + 0.13, P.woodDark);
  };
  const glows = [];   // 晚上亮的窗、燈籠的火
  const signs = [];

  // ---- 棧板：一片一片橫著鋪（坡道跟著斜下去）；木棧橋底下有樑和插到海底的樁 ----
  for (const d of PORT.decks) {
    const at = (a, b, y) => V3(d.x + d.ux * a - d.uz * b, y, d.z + d.uz * a + d.ux * b), yAt = (a) => d.y0 + (d.y1 - d.y0) * (a / d.len);
    const step = d.stone ? 1.0 : phone ? 1.0 : 0.5;
    for (let a = 0; a < d.len - 0.01; a += step) {
      const m = Math.min(d.len, a + step / 2), w = d.half * (1 + (r() - 0.5) * 0.04), y = yAt(m) - (d.stone ? 0.25 : 0.05);
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
    cyl(b.x, b.z, 0.2, 0.24, D, D + 0.42, P.metal, 7);
    cyl(b.x, b.z, 0.3, 0.3, D + 0.42, D + 0.52, P.metal, 7);
    out.bollards.push({ x: b.x, z: b.z, y: D + 0.42 });
  }
  // 爬梯、西翼修船突堤邊上的防撞輪胎
  for (const l of PORT.ladders) ladder3d(fb, l, D, P, r);
  for (const x of [-12.5, -10, -5.5, -3.5]) tire3d(fb, { x, z: -26, nz: -1 }, D, r);
  for (const z of [-21.5, -24.5]) tire3d(fb, { x: -14, z, nx: -1 }, D, r);

  // ---- 海堤廣場：兩道石頭收邊夾著一條木棧（坡道、石坡道的口留著） ----
  {
    const Z = PORT.plaza, open = (x) => Math.abs(x) < 2.9 || Math.abs(x + 15) < 1.9, y = G + 0.04;
    for (let x = Z.x0; x < Z.x1 - 0.01; x += 2) {
      if (open(x + 1)) continue;
      for (const z of [Z.z0, Z.z1 - 0.6]) box(x + 0.02, x + 1.98, y - 0.7, y + 0.06, z, z + 0.6, r() < 0.3 ? P.concrete : P.stone, P.stone, 0.05);
    }
    const step = phone ? 1.0 : 0.5;
    for (let x = Z.x0; x < Z.x1 - 0.01; x += step) {
      if (open(x + step / 2)) continue;
      beam(fb, V3(x + step / 2, y - 0.06, Z.z0 + 0.6), V3(x + step / 2, y - 0.06, Z.z1 - 0.6), step * 0.93, 0.12, jitter(r() < 0.25 ? P.woodLight : r() < 0.2 ? P.woodGrey : P.wood, r, 0.06));
    }
    // 廣場朝海那一側的矮石墩（一顆一顆，中間留空）
    if (!phone) for (let x = Z.x0 + 1; x < Z.x1; x += 4) if (!open(x)) cyl(x, Z.z1 - 0.3, 0.2, 0.26, y, y + 0.55, P.stone, 6);
  }

  // ---- 西：遠洋船塢＆補給所（三面牆、正面敞開；後牆一排補給吧台、前面一座船塢展示島） ----
  {
    const C = PORT.chandlery, wy = G + C.h;
    box(C.x0, C.x1, G - 0.4, G + 0.06, C.z0, C.z1, P.wood, P.stone, 0.05);                                    // 地板
    for (const x of [C.x0 + 0.15, C.x1 - 0.15]) for (const z of [C.z0 + 0.15, C.z1 - 0.15]) box(x - 0.16, x + 0.16, G, wy, z - 0.16, z + 0.16, P.woodDark);
    box((C.x0 + C.x1) / 2 - 0.14, (C.x0 + C.x1) / 2 + 0.14, G, wy, C.z1 - 0.3, C.z1 - 0.02, P.woodDark);    // 正面中柱
    box(C.x0, C.x1, G, wy, C.z0, C.z0 + 0.14, P.plaster, P.plaster, 0.03);                                    // 背牆
    box(C.x0, C.x1, G, G + 0.9, C.z0 + 0.14, C.z0 + 0.19, P.wood, P.wood, 0.05);                              // 背牆的木腰板
    for (const sx of [C.x0, C.x1 - 0.14]) {
      box(sx, sx + 0.14, G, wy, C.z0, C.z1 - 1.2, P.plaster, P.plaster, 0.03);
      box(sx - 0.02, sx + 0.16, G + 1.2, G + 2.3, C.z0 + 2.4, C.z0 + 4.2, P.window, P.window, 0.02);          // 側窗
      glows.push({ p: V3(sx + (sx === C.x0 ? -0.03 : 0.17), G + 1.75, C.z0 + 3.3), ux: 0, uz: 1, w: 1.7, h: 1.0 });
    }
    box(C.x0, C.x1, wy - 0.3, wy, C.z1 - 0.2, C.z1, P.woodDark);
    roof(C.x0, C.x1, C.z0, C.z1, wy - 0.05, 1.7, 0.7, P.roofSlate);
    for (const x of [C.x0, C.x1]) { const c = jitter(P.plaster, r, 0.03); face([V3(x, wy, C.z0), V3(x, wy, C.z1), V3(x, wy + 1.55, (C.z0 + C.z1) / 2)], V3((C.x0 + C.x1) / 2, wy, (C.z0 + C.z1) / 2), c); }
    signs.push(signBoard('遠洋船塢＆補給所', 6.4, 0.85, (C.x0 + C.x1) / 2, wy + 0.5, C.z1 + 0.76));
    box((C.x0 + C.x1) / 2 - 3.3, (C.x0 + C.x1) / 2 + 3.3, wy + 0.02, wy + 0.98, C.z1 + 0.66, C.z1 + 0.75, P.woodDark);
    // 吧台、展示島（最東邊那一段留給站在地上的修船台）
    const B = PORT.bar, N = PORT.island, nx1 = N.x1 - 1.3;
    box(B.x0, B.x1, G + B.h - 0.1, G + B.h, B.z0, B.z1, P.woodLight, P.wood); box(B.x0 + 0.08, B.x1 - 0.08, G, G + B.h - 0.1, B.z0 + 0.06, B.z1 - 0.06, P.wood, P.woodDark, 0.05);
    box(N.x0, nx1, G + N.h - 0.1, G + N.h, N.z0, N.z1, P.woodLight, P.wood); box(N.x0 + 0.08, nx1 - 0.08, G, G + N.h - 0.1, N.z0 + 0.06, N.z1 - 0.06, Q.navy, Q.navy, 0.04);
    if (!phone) {
      // 後牆的層板和上面的貨、屋角的木箱木桶、樑下吊的兩盞燈
      for (const y of [G + 1.7, G + 2.4]) { box(C.x0 + 0.4, C.x1 - 0.4, y, y + 0.06, C.z0 + 0.14, C.z0 + 0.5, P.wood, P.woodDark); for (let x = C.x0 + 0.6; x < C.x1 - 1; x += 0.9 + r() * 0.5) { const h = 0.2 + r() * 0.3; box(x, x + 0.4 + r() * 0.3, y + 0.06, y + 0.06 + h, C.z0 + 0.18, C.z0 + 0.45, [P.crate, Q.blue, Q.red, P.woodLight, Q.steel, Q.yellow][Math.floor(r() * 6)], undefined, 0.07); } }
      for (const [x, z, s] of [[C.x0 + 0.8, C.z1 - 2.2, 0.9], [C.x0 + 0.7, C.z1 - 3.2, 0.7], [C.x1 - 0.8, C.z0 + 1.0, 0.8]]) box(x - s / 2, x + s / 2, G, G + s * 0.85, z - s / 2, z + s / 2, P.crate, P.crate, 0.07);
      cyl(C.x1 - 0.8, C.z0 + 2.2, 0.34, 0.3, G, G + 0.85, P.wood, 9);
    }
    for (const x of [C.x0 + 3, C.x1 - 3]) { beam(fb, V3(x, wy - 0.05, (C.z0 + C.z1) / 2), V3(x, wy - 0.6, (C.z0 + C.z1) / 2), 0.03, 0.03, Q.dark); out.lamps.push([x, wy - 0.7, (C.z0 + C.z1) / 2]); }
  }

  // ---- 中：榮譽榜亭（四根柱子的遮雨亭；排行榜的板面由 boards.js 另外貼上去，這裡只有木框） ----
  {
    const A = PORT.pavilion, wy = G + A.h, cx = (A.x0 + A.x1) / 2, cz = (A.z0 + A.z1) / 2, K = PORT.boards;
    box(A.x0 - 0.3, A.x1 + 0.3, G - 0.4, G + 0.08, A.z0 - 0.3, A.z1 + 0.3, P.stone, P.stone, 0.05);
    const red = withSurf(new THREE.Color('#8f3326'), SURF.wood);
    for (const x of [A.x0 + 0.2, A.x1 - 0.2]) for (const z of [A.z0 + 0.2, A.z1 - 0.2]) { box(x - 0.17, x + 0.17, G + 0.08, wy, z - 0.17, z + 0.17, red); box(x - 0.24, x + 0.24, G + 0.08, G + 0.3, z - 0.24, z + 0.24, P.stone); }
    for (const z of [A.z0 + 0.2, A.z1 - 0.2]) box(A.x0, A.x1, wy - 0.3, wy, z - 0.12, z + 0.12, red);
    for (const x of [A.x0 + 0.2, A.x1 - 0.2]) box(x - 0.12, x + 0.12, wy - 0.3, wy, A.z0, A.z1, red);
    // 四坡的屋頂：四片斜面收到一條短屋脊
    const o = 0.8, rise = 1.5, rl = (A.x1 - A.x0) * 0.25, c1 = jitter(P.roofRed, r, 0.04), c2 = c1.clone().multiplyScalar(0.86), mid = V3(cx, wy, cz);
    const p = [V3(A.x0 - o, wy - 0.05, A.z0 - o), V3(A.x1 + o, wy - 0.05, A.z0 - o), V3(A.x1 + o, wy - 0.05, A.z1 + o), V3(A.x0 - o, wy - 0.05, A.z1 + o)], ra = V3(cx - rl, wy + rise, cz), rb = V3(cx + rl, wy + rise, cz);
    face([p[0], p[1], rb, ra], mid, c2); face([p[3], p[2], rb, ra], mid, c1); face([p[0], p[3], ra], mid, c1.clone().multiplyScalar(0.93)); face([p[1], p[2], rb], mid, c2.clone().multiplyScalar(0.93));
    face([p[0], p[1], p[2], p[3]], V3(cx, wy + 5, cz), c2.clone().multiplyScalar(0.55));   // 屋簷底
    box(cx - rl - 0.1, cx + rl + 0.1, wy + rise - 0.05, wy + rise + 0.12, cz - 0.12, cz + 0.12, P.woodDark);
    // 排行榜的木框：一排四欄
    const bx0 = K.cols[0].x - K.cols[0].w / 2 - 0.12, bx1 = K.cols[3].x + K.cols[3].w / 2 + 0.12;
    box(bx0, bx1, G + K.y0 - 0.12, G + K.y0 + K.h + 0.12, K.z - 0.14, K.z - 0.04, P.woodDark);
    for (const x of [bx0 - 0.1, bx1 + 0.1]) box(x - 0.1, x + 0.1, G + 0.08, G + K.y0 + K.h + 0.3, K.z - 0.19, K.z + 0.01, P.woodDark);   // 柱子立在框的外側（不蓋到看板的邊）
    box(bx0 - 0.28, bx1 + 0.28, G + K.y0 + K.h + 0.12, G + K.y0 + K.h + 0.3, K.z - 0.22, K.z + 0.1, red);
    out.lamps.push([cx, wy - 0.45, cz + 0.6]);
    beam(fb, V3(cx, wy - 0.05, cz + 0.6), V3(cx, wy - 0.35, cz + 0.6), 0.03, 0.03, Q.dark);
  }

  // ---- 東：大港水產批發所（開放大棚：鋼軌天車吊著大秤、兩條碎冰魚槽、後牆的價格板） ----
  {
    const M = PORT.market, wy = G + M.h, S = PORT.sell, top = G + 4.1, tin = withSurf(P.roofTin, SURF.tin), ice = new THREE.Color('#dcecf3');
    box(M.x0, M.x1, G - 0.4, G + 0.05, M.z0, M.z1, P.concrete, P.stone, 0.03);
    for (const x of [M.x0 + 0.15, (M.x0 + M.x1) / 2, M.x1 - 0.15]) for (const z of [M.z0 + 0.15, M.z1 - 0.15]) box(x - 0.14, x + 0.14, G, wy + (z > M.z0 + 1 ? 0.9 : 0), z - 0.14, z + 0.14, Q.steel, Q.dark);
    box(M.x0, M.x1, G, G + 1.2, M.z0, M.z0 + 0.14, P.concrete, P.concrete, 0.03);
    for (let x = M.x0; x < M.x1 - 0.01; x += 1.5) box(x, Math.min(M.x1, x + 1.5) - 0.03, G + 1.2, wy, M.z0 + 0.02, M.z0 + 0.1, tin, tin, 0.07);
    // 單斜的鐵皮屋頂：正面高、背面低
    for (let x = M.x0 - 0.6; x < M.x1 + 0.6 - 0.01; x += 1.5) {
      const xb = Math.min(M.x1 + 0.6, x + 1.5), c = jitter(tin, r, 0.07), a = V3(x, wy - 0.05, M.z0 - 0.6), b = V3(xb, wy - 0.05, M.z0 - 0.6), c3 = V3(xb, wy + 0.95, M.z1 + 0.8), d = V3(x, wy + 0.95, M.z1 + 0.8), u = c.clone().multiplyScalar(0.6);
      fb.tri(a, d, c3, c); fb.tri(a, c3, b, c); fb.tri(a, c3, d, u); fb.tri(a, b, c3, u);
    }
    box(M.x0, M.x1, wy + 0.6, wy + 0.9, M.z1 - 0.26, M.z1 - 0.04, Q.steel, Q.dark);
    signs.push(signBoard('大港水產批發所', 6.2, 0.85, (M.x0 + M.x1) / 2, wy + 0.2, M.z1 + 0.02));
    signs.push(signBoard('全品項收購價 ＋15％', 4.6, 0.9, 14.7, G + 2.9, M.z0 + 0.16));
    // 鋼軌天車：一條橫貫大棚的工字樑，天車吊著鐵鍊、大秤、鉤子
    beam(fb, V3(M.x0 + 0.2, top, S.z), V3(M.x1 - 0.2, top, S.z), 0.22, 0.3, jitter(Q.yellow, r, 0.03));
    for (const x of [M.x0 + 0.4, (M.x0 + M.x1) / 2, M.x1 - 0.4]) beam(fb, V3(x, top + 0.1, S.z), V3(x, wy + 0.5, S.z), 0.1, 0.1, Q.dark);
    box(S.x - 0.3, S.x + 0.3, top - 0.32, top - 0.12, S.z - 0.22, S.z + 0.22, Q.dark);
    beam(fb, V3(S.x, top - 0.3, S.z), V3(S.x, top - 0.9, S.z), 0.07, 0.07, P.metal);     // 吊鍊
    const dial = new THREE.CylinderGeometry(0.62, 0.62, 0.16, 12);                         // 秤面（朝海灣那一側）
    dial.rotateX(Math.PI / 2); dial.translate(S.x, top - 1.5, S.z);
    const dc = jitter(P.white, r, 0.02), rim = jitter(P.metal, r, 0.03);
    fb.addGeometry(dial, (m, n) => (Math.abs(n.z) > 0.5 ? dc : rim));
    beam(fb, V3(S.x, top - 1.52, S.z + 0.1), V3(S.x + 0.3, top - 1.2, S.z + 0.1), 0.05, 0.03, P.flagRed);   // 指針
    beam(fb, V3(S.x, top - 2.1, S.z), V3(S.x, top - 2.65, S.z), 0.06, 0.06, P.metal);     // 鉤子
    beam(fb, V3(S.x, top - 2.65, S.z), V3(S.x + 0.22, top - 2.5, S.z), 0.06, 0.06, P.metal);
    for (const [a, b, sz] of [[-2.2, -4.6, 0.9], [-2.0, -3.6, 0.7], [-1.2, -5.0, 0.8]]) {
      const Mx = new THREE.Matrix4().makeRotationY(r() * 0.6).setPosition(S.x + a, G + 0.05, S.z + b);
      rbox(Mx, -sz / 2, sz / 2, 0, sz * 0.8, -sz / 2, sz / 2, P.crate, P.crate, 0.06);
    }
    // 碎冰魚槽：不鏽鋼槽、滿滿的碎冰、冰上躺著幾條魚
    for (const t of PORT.troughs) {
      box(t.x0, t.x1, G + 0.55, G + 0.8, t.z0, t.z1, Q.steel, Q.steel, 0.03);
      for (const x of [t.x0 + 0.15, t.x1 - 0.15]) for (const z of [t.z0 + 0.12, t.z1 - 0.12]) box(x - 0.06, x + 0.06, G, G + 0.55, z - 0.06, z + 0.06, Q.dark);
      box(t.x0 + 0.06, t.x1 - 0.06, G + 0.8, G + 0.9, t.z0 + 0.06, t.z1 - 0.06, ice, ice, 0.04);
      if (!phone) for (let x = t.x0 + 0.5; x < t.x1 - 0.4; x += 0.75 + r() * 0.3) {
        const Mx = new THREE.Matrix4().makeRotationY((r() - 0.5) * 1.2).setPosition(x, G + 0.9, (t.z0 + t.z1) / 2 + (r() - 0.5) * 0.4), c = [Q.silver, Q.blue, Q.pink, Q.steel][Math.floor(r() * 4)];
        rbox(Mx, -0.26, 0.2, 0, 0.09, -0.07, 0.07, c, c, 0.05); rbox(Mx, 0.2, 0.32, 0, 0.08, -0.1, 0.1, c, c, 0.05);
      }
    }
    for (const x of [M.x0 + 3, M.x1 - 3]) { beam(fb, V3(x, wy + 0.3, (M.z0 + M.z1) / 2 + 1.5), V3(x, wy - 0.4, (M.z0 + M.z1) / 2 + 1.5), 0.03, 0.03, Q.dark); out.lamps.push([x, wy - 0.5, (M.z0 + M.z1) / 2 + 1.5]); }
  }

  // ---- 東岸高台的海神祈福祭壇：圓石台（外圈一階石階）、鳥居、兩座常夜石燈籠、供桌 ----
  {
    const A = PORT.altar, y = G + A.lift, T = A.table, red = withSurf(new THREE.Color('#b8322a'), SURF.wood);
    cyl(A.x, A.z, A.r + A.step, A.r + A.step + 0.15, G - 2.6, G + A.lift / 2, P.stone, 14);
    cyl(A.x, A.z, A.r, A.r + 0.05, G, y, P.stone, 14);
    // 鳥居：朝海灣那一側，兩根紅柱、上面兩道橫木
    const tz = A.z + 2.3, th = 3.5;
    for (const sx of [-1, 1]) { cyl(A.x + sx * 1.5, tz, 0.15, 0.18, y, y + th, red, 8); cyl(A.x + sx * 1.5, tz, 0.24, 0.26, y, y + 0.3, Q.black, 8); }
    box(A.x - 2.3, A.x + 2.3, y + th, y + th + 0.22, tz - 0.17, tz + 0.17, red); box(A.x - 2.5, A.x + 2.5, y + th + 0.22, y + th + 0.36, tz - 0.22, tz + 0.22, Q.black);
    box(A.x - 1.85, A.x + 1.85, y + th - 0.7, y + th - 0.52, tz - 0.1, tz + 0.1, red);
    box(A.x - 0.25, A.x + 0.25, y + th - 0.52, y + th, tz - 0.06, tz + 0.06, Q.black, Q.black, 0.02);
    // 供桌（鋪紅布）
    box(A.x - T.hw, A.x + T.hw, y, y + T.h - 0.06, T.z0 + 0.05, T.z1 - 0.05, P.woodDark);
    box(A.x - T.hw - 0.05, A.x + T.hw + 0.05, y + T.h - 0.06, y + T.h, T.z0, T.z1, red, red, 0.03);
    box(A.x - T.hw * 0.7, A.x + T.hw * 0.7, y + 0.25, y + T.h - 0.06, T.z1 - 0.05, T.z1 - 0.02, Q.gold, Q.gold, 0.03);
    // 常夜石燈籠：石座、石柱、火袋（晚上亮）、笠
    for (const sx of [-1, 1]) {
      const lx = A.x + sx * 2.2, lz = A.z - 1.3;
      cyl(lx, lz, 0.3, 0.36, y, y + 0.2, P.stone, 6); cyl(lx, lz, 0.13, 0.16, y + 0.2, y + 1.0, P.stone, 6); cyl(lx, lz, 0.3, 0.2, y + 1.0, y + 1.12, P.stone, 6);
      box(lx - 0.2, lx + 0.2, y + 1.12, y + 1.5, lz - 0.2, lz + 0.2, P.stone, P.stone, 0.03);
      cyl(lx, lz, 0.08, 0.42, y + 1.5, y + 1.78, P.stone, 6);
      for (const [ux, uz, ox, oz] of [[1, 0, 0, 0.205], [1, 0, 0, -0.205], [0, 1, 0.205, 0], [0, 1, -0.205, 0]]) glows.push({ p: V3(lx + ox, y + 1.31, lz + oz), ux, uz, w: 0.24, h: 0.24 });
      out.lamps.push([lx, y + 1.3, lz]);
    }
  }

  // ---- 鑄鐵路燈：廣場一排、主棧橋、丁字碼頭 ----
  for (const [x, z] of PORT.lamps) {
    const onPier = z > -51, side = Math.abs(x) < 2.5;
    out.lamps.push(lampPost(fb, x, onPier ? D : groundAt(x, z), z, P, r, 3.4, side ? -Math.sign(x) : 0, side ? 0 : 1));
  }

  // ---- 依山的小屋：石砌的地基墊到最高的那個牆角，坡越陡地基越高 ----
  const roofs = [P.roofRed, P.roofSlate, P.roofTin], shutters = [Q.navy, Q.greenDark, Q.redDark, P.woodDark], flowers = [Q.red, Q.yellow, Q.pink, Q.white];
  PORT.houses.forEach(([x, z, w, d, h, turn, kind], k) => {
    const rot = Math.atan2(BAY.x - x, BAY.z - z) + turn * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
    const toW = (a, b) => [x + a * c + b * s, z - a * s + b * c];
    const ys = [[-hw, -hd], [hw, -hd], [-hw, hd + 1.2], [hw, hd + 1.2], [0, 0]].map(([a, b]) => groundAt(...toW(a, b)));
    const y0 = Math.max(...ys) + 0.3, lo = Math.min(...ys) - 0.8 - y0;
    const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, y0, z), L = (a, y, b) => V3(a, y, b).applyMatrix4(M);
    const wall = kind ? P.plaster : P.wood, trim = kind ? P.woodDark : P.woodLight, rise = hd * 0.75, o = 0.45, roofCol = roofs[k % roofs.length];
    rbox(M, -hw - 0.2, hw + 0.2, lo, 0, -hd - 0.2, hd + 1.2, P.stone);                       // 地基＋門前的平台
    if (kind || phone) rbox(M, -hw, hw, 0, h, -hd, hd, wall, wall, 0.05);                    // 灰泥牆：一整面
    else for (let i = 0; i * 0.42 < h - 0.01; i++) { const e = i % 2 ? 0 : 0.015; rbox(M, -hw - e, hw + e, i * 0.42, Math.min(h, (i + 1) * 0.42), -hd - e, hd + e, wall, wall, 0.07); }   // 木屋：一層一層的魚鱗板
    rbox(M, -hw - 0.04, hw + 0.04, 0, 0.25, -hd - 0.04, hd + 0.04, trim);                    // 地檻
    rbox(M, -0.55, 0.55, 0, 2.0, hd, hd + 0.07, P.woodDark);                                 // 門
    for (const a of [-hw * 0.6, hw * 0.6]) {
      rbox(M, a - 0.45, a + 0.45, 1.1, 2.0, hd, hd + 0.06, P.window, P.window, 0.02);        // 正面的窗
      glows.push({ p: L(a, 1.55, hd + 0.075), ux: c, uz: -s, w: 0.84, h: 0.84 });
      if (phone) continue;
      const sc = shutters[k % shutters.length];
      for (const sd of [-1, 1]) rbox(M, a + sd * 0.48, a + sd * 0.48 + sd * 0.28, 1.05, 2.05, hd + 0.02, hd + 0.08, sc, sc, 0.04);   // 百葉窗
      rbox(M, a - 0.5, a + 0.5, 0.88, 1.06, hd + 0.04, hd + 0.26, P.woodDark, P.woodDark);    // 花箱
      for (let i = 0; i < 4; i++) rbox(M, a - 0.42 + i * 0.22, a - 0.26 + i * 0.22, 1.06, 1.16 + r() * 0.08, hd + 0.07, hd + 0.23, i % 2 ? flowers[(k + i) % 4] : Q.green, Q.green, 0.08);
    }
    for (const sd of [-1, 1]) { rbox(M, sd * hw - 0.03, sd * hw + 0.03, 1.1, 2.0, -0.5, 0.5, P.window, P.window, 0.02); glows.push({ p: L(sd * (hw + 0.045), 1.55, 0), ux: s, uz: c, w: 0.94, h: 0.84 }); }   // 兩側的窗
    // 門前往下走的石階
    if (!phone) for (let i = 1; i <= 3; i++) rbox(M, -0.8, 0.8, lo, -i * 0.22, hd + 1.2 + (i - 1) * 0.34, hd + 1.2 + i * 0.34, P.stone, P.stone, 0.05);
    // 屋頂：兩片斜面（屋脊順著屋子的寬）、兩頭的山牆
    const mid = L(0, h + rise * 0.4, 0), c1 = jitter(roofCol, r, 0.04), c2 = c1.clone().multiplyScalar(0.86);
    face([L(-hw - o, h - 0.1, -hd - o), L(hw + o, h - 0.1, -hd - o), L(hw + o, h + rise, 0), L(-hw - o, h + rise, 0)], mid, c2);
    face([L(-hw - o, h - 0.1, hd + o), L(hw + o, h - 0.1, hd + o), L(hw + o, h + rise, 0), L(-hw - o, h + rise, 0)], mid, c1);
    for (const sd of [-1, 1]) face([L(sd * hw, h, -hd), L(sd * hw, h, hd), L(sd * hw, h + rise * (hd / (hd + o)), 0)], mid, jitter(wall, r, 0.05));
    rbox(M, hw * 0.45, hw * 0.45 + 0.6, h + rise * 0.35, h + rise + 0.7, -0.3, 0.3, P.stone);   // 煙囪
  });

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
    out.rocks.push({ x: T.x, z: T.z, r: T.r + 0.7, top: y0 + 1.0 });
    out.rocks.push({ x: T.x, z: T.z, r: T.r, top: yt + 3.6 });
    // 燈：自己發亮、不吃霧（遠遠就要看得到）
    const bulb = new THREE.Mesh(new THREE.CylinderGeometry(T.top - 0.3, T.top - 0.3, 1.7, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false }));
    bulb.position.set(T.x, yt + 1.25, T.z);
    group.add(bulb);
    out.bulb = bulb;
    out.lamp = [T.x, yt + 1.25, T.z];
  }

  // ---- 商品和價格牌（站在地上的工位：突堤上的修船樁踩棧板，其他踩地面） ----
  const goods = placeGoods(fb, group, shelves, { P, floorOf: (s) => (s.lz > -50 ? D : G + 0.06) });
  out.tags = goods.tags;
  out.unlit.push(...goods.unlit);
  for (const s of signs) { group.add(s.mesh); out.unlit.push(s.mat); }

  const mesh = new THREE.Mesh(fb.build(), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  // 路燈、吊燈的燈泡和亮起來的窗：天黑了才亮
  const lamp = bulbs(out.lamps, 0.15), win = glowQuads(glows);
  group.add(lamp.mesh, win.mesh);
  out.light = (glow) => {
    lamp.mat.color.copy(lamp.mat.userData.base).multiplyScalar(0.45 + 1.4 * glow);
    win.mesh.visible = glow > 0.02;
    win.mat.color.copy(win.mat.userData.base).multiplyScalar(0.25 + 0.95 * glow);
  };
  return out;
}
