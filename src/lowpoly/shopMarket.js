// 橋頭的商店（港口漁具行）和魚市場：外觀、店裡的裝潢、魚市場的攤位、收購站。配置都在 harborPlan.js（SHOP、SHOP_IN、GOODS、MARKET、MARKET_IN、SELL）。
// 一樣是低面平塗，但做得比較細：木板牆一條一條、屋簷有封簷板和椽頭、店門口掛暖簾、屋頂立招牌；
// 店裡有櫃台、整面貨架、釣竿架、吊燈、展示台上的引擎和船模型；魚市場有鋪冰的展示台、一排排的魚、晾乾的魚乾、活魚水槽。
// fb：主要的網格（大家都畫）；fd：小東西（貨架上的雜貨、魚乾、工具…），手機不畫。
// 亂數用自己的種子：這裡加東西不會改到島上其他東西（石頭、樹）的位置
import * as THREE from 'three';
import { FaceBuilder, rng, SColor, SURF, withSurf } from './kit.js';
import { jitter } from './palette.js';
import * as H from './harborPlan.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = (hex, surf = 0) => withSurf(new THREE.Color(hex), surf);

// 這裡才用到的顏色
const Q = {
  noren: C('#27406a', SURF.cloth), norenWhite: C('#efe9dc', SURF.cloth), rug: C('#8a3b2e', SURF.cloth), rugEdge: C('#d9b26b', SURF.cloth),
  steel: C('#a9b1b5', SURF.metal), dark: C('#3a3f43', SURF.metal), brass: C('#c79a3a', SURF.metal), green: C('#3f6b4a', SURF.metal),
  ice: C('#e3f0f4', SURF.ice), ice2: C('#c6e2ec', SURF.ice), glass: C('#4f7f8a'), water: C('#63b7bd'),
  plBlue: C('#3c78b4'), plWhite: C('#eeeeea'), plOrange: C('#e0782f'), plYellow: C('#e8c13a'), plGreen: C('#4f9a5a'),
  red: C('#c8352a'), redDark: C('#8f2a22'), cork: C('#c9a36b', SURF.wood), paper: C('#efe6cf'), chalk: C('#2d3a33'),
  rodBlue: C('#2b4f7a'), rodGreen: C('#3f6b4a'), rodBlack: C('#262626'), rodRed: C('#8e2b24'),
  himono: C('#b48446'), himono2: C('#9a6a35'), flower1: C('#e85d75'), flower2: C('#f2c84b'), flower3: C('#f4f1e8'), leaf: C('#4e8a3a'),
  peg: C('#c9a77c', SURF.wood), bulb: C('#ffe2a0'), black: C('#2a2724'), canvas: C('#e9e2cf', SURF.cloth), chart: C('#d8c79c'),
};

// 把一個蓋好的幾何（有 color、aSurf）用矩陣 M 擺進 fb：顏色、材質種類照抄，紋路方向跟著轉
const _m3 = new THREE.Matrix3();
function put(fb, geo, M) {
  const g = geo.clone().applyMatrix4(M);
  const col = g.attributes.color, sf = g.attributes.aSurf;
  _m3.setFromMatrix4(M);
  const m3 = _m3.clone();
  fb.addGeometry(g, (m, n, i) => {
    const c = new SColor(col.getX(i * 3), col.getY(i * 3), col.getZ(i * 3));
    if (sf) { c.surf = sf.getX(i * 3); c.grain = V(sf.getY(i * 3), sf.getZ(i * 3), sf.getW(i * 3)).applyMatrix3(m3).normalize(); }
    return c;
  });
}
const mat4 = (x, y, z, ry = 0, rx = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), V(s, s, s));

// 一個三角形，保證正面朝外（ref 是物體裡面的一點）
function face(fb, a, b, c, col, ref) {
  const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
  const m = a.clone().add(b).add(c).multiplyScalar(1 / 3);
  if (n.dot(m.sub(ref)) < 0) fb.tri(a, c, b, col); else fb.tri(a, b, c, col);
}
// 一個圓柱（或圓錐）加進 fb：底面中心 (x, y, z)、高 h、上下半徑、幾邊形、顏色（或依面決定顏色的函式）
function cyl(fb, x, y, z, rt, rb, h, seg, col, r, rotX = 0, rotZ = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(0, h / 2, 0);
  if (rotX) g.rotateX(rotX);
  if (rotZ) g.rotateZ(rotZ);
  g.translate(x, y, z);
  const cs = typeof col === 'function' ? null : jitter(col, r, 0.04);
  fb.addGeometry(g, (m, n) => (cs ? (Math.abs(n.y) > 0.5 ? cs.clone().multiplyScalar(1.06) : cs) : col(m, n)));
}

// ---- 魚：側躺的低面魚（頭朝 +x、背朝 +z、厚度在 y），len 長 ----
// 背和腹兩種顏色，尾鰭、眼睛
function fishGeo(len, back, belly, fin, seed) {
  const fb = new FaceBuilder(), r = rng(seed);
  const hh = len * 0.16, t = len * 0.07;   // 半高、半厚
  const st = [[0, 0, 0], [0.12, 0.62, 0.7], [0.38, 1, 1], [0.7, 0.62, 0.7], [0.86, 0.22, 0.3]];   // [沿身長, 高比例, 厚比例]
  const ring = st.map(([s, k, w]) => {
    const x = len * (0.5 - s);
    return { top: V(x, t * w, 0), bot: V(x, -t * w, 0), up: V(x, 0, hh * k), dn: V(x, 0, -hh * k * 0.9) };
  });
  const cb = jitter(back, r, 0.05), cw = jitter(belly, r, 0.04), ref = V(0, 0, 0);
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    for (const side of ['top', 'bot']) {
      face(fb, a[side], b[side], b.up, cb, ref); face(fb, a[side], b.up, a.up, cb, ref);
      face(fb, a[side], b.dn, b[side], cw, ref); face(fb, a[side], a.dn, b.dn, cw, ref);
    }
  }
  // 尾鰭：從尾柄張開成一把扇子（薄薄的兩面）
  const p = ring[ring.length - 1], tx = -len * 0.5, cf = jitter(fin, r, 0.05);
  const t1 = V(tx, 0, hh * 0.95), t2 = V(tx + len * 0.06, 0, 0), t3 = V(tx, 0, -hh * 0.95);
  fb.tri(p.up, t1, t2, cf); fb.tri(p.up, t2, t1, cf); fb.tri(p.dn, t2, t3, cf); fb.tri(p.dn, t3, t2, cf);
  fb.tri(p.up, t2, p.dn, cf); fb.tri(p.up, p.dn, t2, cf);
  // 背鰭
  const d0 = ring[2].up, d1 = V(len * 0.02, 0, hh * 1.35), d2 = V(-len * 0.18, 0, hh * 0.85);
  fb.tri(d0, d1, d2, cf); fb.tri(d0, d2, d1, cf);
  // 眼睛（兩面各一個）
  const ex = len * 0.4, ez = hh * 0.25, es = len * 0.035;
  for (const sy of [1, -1]) {
    const y = t * 0.62 * sy + 0.002 * sy;
    face(fb, V(ex + es, y, ez), V(ex - es, y, ez + es), V(ex - es, y, ez - es), Q.black, V(ex, 0, ez));
  }
  return fb.build();
}
// 幾種魚：[背, 腹, 鰭]
const SPECIES = [
  ['#2f5f6b', '#d8dde0', '#3d5d63'],   // 鯖魚
  ['#d9575a', '#f0b5a8', '#c94a4a'],   // 鯛魚
  ['#5e7f8f', '#e9ecef', '#d8c24a'],   // 青甘
  ['#7f949c', '#dfe4e2', '#8a9aa0'],   // 竹筴魚
  ['#4a4f58', '#c9c3b8', '#3b3f45'],   // 黑鯛
];

export function buildShopMarket({ fb, fd, P, box, obox, gableRoof, boatGeo, out, camBox }) {
  const r = rng(24601), D = H.DECK_Y;
  // 燈籠：方形的燈罩、上下兩片蓋子（跟棧橋上的一樣；用這裡自己的亂數）
  const lantern = (x, y, z, s = 1) => {
    box(fb, x - 0.2 * s, x + 0.2 * s, y - 0.22 * s, y + 0.22 * s, z - 0.2 * s, z + 0.2 * s, P.bulb, P.bulb, r, 0.01);
    box(fb, x - 0.26 * s, x + 0.26 * s, y + 0.22 * s, y + 0.3 * s, z - 0.26 * s, z + 0.26 * s, P.lampPole, P.lampPole, r);
    box(fb, x - 0.24 * s, x + 0.24 * s, y - 0.3 * s, y - 0.22 * s, z - 0.24 * s, z + 0.24 * s, P.lampPole, P.lampPole, r);
  };
  const S = H.SHOP, top = D + S.h, t = 0.25;

  // =========================================================================
  // 商店：外牆（橫釘的木板，一條一條上下疊）、轉角柱、石砌地基
  // =========================================================================
  box(fb, S.x0 - 0.2, S.x1 + 0.2, D - 1.4, D - 0.07, S.z0 - 0.2, S.z0 + 1.5, P.stone, P.stone, r);   // 後面的石砌地基（坡比較高的那邊露出來）
  // 一面牆：從 a 到 b（水平），y0..y1，厚 t；朝外的那面每條木板下緣多一條突出的壓條（看得到一條條影子）
  const siding = (x0, x1, z0, z1, y0, y1, out) => {
    const H_ = 0.3, horiz = x1 - x0 > z1 - z0;
    for (let y = y0, i = 0; y < y1 - 0.01; y += H_, i++) {
      const ya = y, yb = Math.min(y + H_, y1), k = r();
      const col = k < 0.1 ? P.woodGrey : k < 0.55 ? P.wood : P.woodLight;
      box(fb, x0, x1, ya, yb, z0, z1, col, col.clone().multiplyScalar(0.94), r, 0.05);
      // 壓條：在朝外那一面
      const o = 0.025;
      if (horiz) { const zo = out > 0 ? z1 : z0 - o; box(fb, x0, x1, ya, ya + 0.045, zo, zo + o, col.clone().multiplyScalar(0.8), col.clone().multiplyScalar(0.7), r, 0.03); }
      else { const xo = out > 0 ? x1 : x0 - o; box(fb, xo, xo + o, ya, ya + 0.045, z0, z1, col.clone().multiplyScalar(0.8), col.clone().multiplyScalar(0.7), r, 0.03); }
    }
  };
  // 牆上的窗：挖不了洞，就把窗框、玻璃、窗台貼在牆面上（兩面都貼），外面再加一個花台
  const winX = (x, zc, w, h, y0, flowers) => {   // 東西兩面牆上的窗（牆面在 x，窗寬沿 z）
    for (const sg of [-1, 1]) {
      const xf = x + sg * (t / 2 + 0.005);
      box(fb, xf - 0.02, xf + 0.02, y0, y0 + h, zc - w / 2, zc + w / 2, Q.glass, Q.glass, r, 0.02);
      for (const [a, b, c, d] of [[y0 - 0.06, y0, zc - w / 2 - 0.06, zc + w / 2 + 0.06], [y0 + h, y0 + h + 0.06, zc - w / 2 - 0.06, zc + w / 2 + 0.06], [y0, y0 + h, zc - w / 2 - 0.06, zc - w / 2], [y0, y0 + h, zc + w / 2, zc + w / 2 + 0.06], [y0, y0 + h, zc - 0.03, zc + 0.03], [y0 + h / 2 - 0.03, y0 + h / 2 + 0.03, zc - w / 2, zc + w / 2]]) {
        box(fb, xf - 0.05, xf + 0.05, a, b, c, d, P.white, P.white, r, 0.02);
      }
      box(fb, xf - 0.02 + sg * 0.08, xf + 0.02 + sg * 0.08, y0 - 0.1, y0 - 0.04, zc - w / 2 - 0.12, zc + w / 2 + 0.12, P.woodDark, P.woodDark, r);   // 窗台
    }
    if (flowers) {   // 外面的花台＋幾朵花
      const xo = x + flowers * (t / 2 + 0.18);
      box(fb, xo - 0.16, xo + 0.16, y0 - 0.38, y0 - 0.1, zc - w / 2, zc + w / 2, P.woodDark, P.wood, r);
      for (let i = 0; i < 9; i++) {
        const z = zc - w / 2 + 0.12 + (w - 0.24) * (i / 8), fx = xo + (r() - 0.5) * 0.16, s = 0.07 + r() * 0.05;
        const g = new THREE.IcosahedronGeometry(s, 0); g.translate(fx, y0 - 0.06 + r() * 0.06, z);
        fd.addGeometry(g, () => jitter([Q.flower1, Q.flower2, Q.flower3, Q.leaf, Q.leaf][Math.floor(r() * 5)], r, 0.06));
      }
    }
  };
  siding(S.x0, S.x1, S.z0, S.z0 + t, D, top, -1);           // 後牆（朝外是 -z）
  siding(S.x0, S.x0 + t, S.z0, S.z1, D, top, -1);           // 西牆
  siding(S.x1 - t, S.x1, S.z0, S.z1, D, top, 1);            // 東牆
  siding(S.open.x1, S.x1, S.z1 - t, S.z1, D, top, 1);       // 正面東半邊（外面立排行榜）
  siding(S.x0, S.open.x0, S.z1 - t, S.z1, D, top, 1);       // 正面最西邊那一小段
  siding(S.x0, S.open.x1, D + 2.75, top, S.z1 - t, S.z1, 1);   // 開口上方
  box(fb, S.x0 - 0.05, S.open.x1 + 0.05, D + 2.6, D + 2.78, S.z1 - t - 0.02, S.z1 + 0.04, P.woodDark, P.woodDark, r);   // 開口上的橫樑
  // 轉角柱、正面的柱子、牆腳的踢腳板
  for (const [x, z] of [[S.x0 + 0.12, S.z0 + 0.12], [S.x1 - 0.12, S.z0 + 0.12]]) box(fb, x - 0.17, x + 0.17, D, top + 0.05, z - 0.17, z + 0.17, P.woodDark, P.woodDark, r);
  for (const x of [S.x0 + 0.1, S.open.x1 - 0.1, S.x1 - 0.1]) { box(fb, x - 0.18, x + 0.18, D, top + 0.05, S.z1 - 0.2, S.z1 + 0.15, P.woodDark, P.woodDark, r); out.solids.push({ x, z: S.z1 - 0.03, r: 0.22 }); }
  // 窗：西牆一扇（櫃台後面）、東牆兩扇（對著橋頭，外面有花台）
  winX(S.x0 + t / 2, -12.6, 1.3, 1.0, D + 1.25, 0);
  winX(S.x1 - t / 2, -13.0, 1.4, 1.1, D + 1.15, 1);
  winX(S.x1 - t / 2, -8.0, 1.4, 1.1, D + 1.15, 1);
  // 屋頂：斜屋頂（電腦版有一排排屋瓦的紋路）＋屋脊、封簷板、山牆的博風板、屋簷下一根根椽頭
  gableRoof(fb, S.x0, S.x1, S.z0, S.z1, top, 2.2, 0.7, P.roofSlate, r);
  const zm = (S.z0 + S.z1) / 2, over = 0.7, run = (S.z1 - S.z0) / 2 + over, slope = Math.atan2(2.2, run), sl = Math.hypot(2.2, run);
  box(fb, S.x0 - over - 0.05, S.x1 + over + 0.05, top + 2.16, top + 2.34, zm - 0.14, zm + 0.14, P.woodDark, P.woodDark, r);   // 屋脊
  for (const sg of [-1, 1]) {
    const ze = zm + sg * run;
    obox(fb, (S.x0 + S.x1) / 2, top - 0.08, ze + sg * 0.02, 1, 0, S.x1 - S.x0 + 2 * over + 0.1, 0.06, 0.24, P.woodDark, P.woodDark, r);   // 封簷板
    for (let x = S.x0 - over + 0.35; x < S.x1 + over - 0.2; x += 0.62) box(fb, x - 0.05, x + 0.05, top - 0.2, top - 0.05, ze - sg * 0.75 - 0.3, ze - sg * 0.75 + 0.3, P.woodDark, P.woodDark, r);   // 椽頭
    for (const ex of [S.x0 - over - 0.02, S.x1 + over + 0.02]) {   // 博風板：沿著山牆的斜邊
      obox(fb, ex, top + 1.1 + 0.04, zm + sg * run / 2, 0, sg, sl + 0.1, 0.06, 0.26, P.woodDark, P.woodDark, r, 0.03, 0, -slope);
    }
  }
  // 煙囪：石砌，頂上一塊蓋
  box(fb, S.x0 + 3, S.x0 + 3.8, top + 0.6, top + 3.0, S.z0 + 2, S.z0 + 2.8, P.stone, P.stone, r);
  box(fb, S.x0 + 2.9, S.x0 + 3.9, top + 3.0, top + 3.12, S.z0 + 1.9, S.z0 + 2.9, P.stone, P.stone, r);
  // 屋頂上的招牌：立在前坡上，兩根柱子撐著（字在 harbor.js 用貼圖畫，這裡是木框和背板）
  {
    const sg = H.SIGNS[0], roofY = (z) => top + 2.2 * (S.z1 + over - z) / run;
    box(fb, sg.x - sg.w / 2 - 0.12, sg.x + sg.w / 2 + 0.12, sg.y - sg.h / 2 - 0.1, sg.y + sg.h / 2 + 0.1, sg.z - 0.1, sg.z - 0.01, P.woodDark, P.woodDark, r);
    for (const x of [sg.x - sg.w * 0.35, sg.x + sg.w * 0.35]) box(fb, x - 0.07, x + 0.07, roofY(sg.z - 0.2) - 0.1, sg.y + sg.h / 2, sg.z - 0.26, sg.z - 0.12, P.woodDark, P.woodDark, r);
    box(fb, sg.x - sg.w / 2 - 0.2, sg.x + sg.w / 2 + 0.2, sg.y + sg.h / 2 + 0.1, sg.y + sg.h / 2 + 0.18, sg.z - 0.22, sg.z + 0.08, P.roofSlate, P.roofSlate, r);   // 招牌上的小屋簷
  }
  // 店門口：一片往外斜的小屋簷（庇）、底下的暖簾（深藍布、底下一道白浪）、兩旁的燈籠
  {
    const x0 = S.x0 - 0.1, x1 = S.open.x1 + 0.2, zw = S.z1, dz = 0.95, y0 = D + 2.95, y1 = D + 2.68;
    const pitch = Math.atan2(y0 - y1, dz), L = Math.hypot(dz, y0 - y1);
    obox(fb, (x0 + x1) / 2, (y0 + y1) / 2, zw + dz / 2, 1, 0, x1 - x0, L, 0.06, P.roofSlate, P.woodDark, r, 0.03, pitch, 0);
    obox(fb, (x0 + x1) / 2, y1 - 0.06, zw + dz + 0.02, 1, 0, x1 - x0, 0.05, 0.16, P.woodDark, P.woodDark, r);
    for (const x of [x0 + 0.3, x1 - 0.3]) obox(fb, x, D + 2.5, zw + 0.3, 0, 1, 0.78, 0.07, 0.07, P.woodDark, P.woodDark, r, 0.03, 0, 0.69);   // 斜撐
    // 暖簾：掛在開口前面一根橫桿上，分成六片
    const nx0 = S.open.x0 + 0.15, nx1 = S.open.x1 - 0.15, n = 6, pw = (nx1 - nx0) / n;
    box(fb, nx0 - 0.15, nx1 + 0.15, D + 2.5, D + 2.56, zw + 0.06, zw + 0.12, P.woodDark, P.woodDark, r);
    for (let i = 0; i < n; i++) {
      const a = nx0 + i * pw + 0.015, b = a + pw - 0.03;
      box(fb, a, b, D + 2.1, D + 2.5, zw + 0.08, zw + 0.1, Q.noren, Q.noren, r, 0.03);
      box(fb, a, b, D + 2.12, D + 2.2, zw + 0.1, zw + 0.105, Q.norenWhite, Q.norenWhite, r, 0.02);   // 底下一道白
    }
    // 中間兩片上的白色圓（店的記號）
    for (const xc of [nx0 + pw * 2.5, nx0 + pw * 3.5]) {
      const g = new THREE.CircleGeometry(0.11, 10); g.translate(xc, D + 2.33, zw + 0.104);
      fb.addGeometry(g, () => Q.norenWhite);
    }
    lantern(S.x0 + 0.8, D + 2.3, S.z1 + 0.45, 0.8);
    lantern(S.x1 - 0.3, D + 2.4, S.z1 + 0.45, 0.8);
  }
  // 東牆外面：救生圈、靠著牆的兩支船槳
  {
    const x = S.x1 + 0.06, z = -10.5, y = D + 1.75;
    const g = new THREE.TorusGeometry(0.32, 0.08, 6, 16); g.rotateY(Math.PI / 2); g.translate(x, y, z);
    fb.addGeometry(g, (m) => { const a = Math.atan2(m.y - y, m.z - z); return Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 2 ? Q.plWhite : Q.red; });
    for (const [oz, p] of [[-6.1, 0.2], [-6.6, -0.16]]) {   // 兩支船槳斜靠在牆上（p：往前後歪多少）
      obox(fb, S.x1 + 0.1, D + 1.05, oz, 0, 1, 0.05, 0.05, 2.1, P.woodLight, P.woodLight, r, 0.04, 0, p);
      obox(fb, S.x1 + 0.1, D + 1.05 - 0.8 * Math.cos(p), oz + 0.8 * Math.sin(p), 0, 1, 0.18, 0.04, 0.5, P.woodLight, P.woodLight, r, 0.04, 0, p);
    }
  }

  // =========================================================================
  // 店裡
  // =========================================================================
  const I = H.SHOP_IN;
  // 天花板的橫樑（沿 z）＋吊燈
  for (const x of [-24.2, -20.1, -16.0]) box(fb, x - 0.1, x + 0.1, top - 0.22, top, S.z0 + t, S.z1 - t, P.woodDark, P.woodDark, r);
  const pendant = (x, z, y) => {
    box(fd, x - 0.012, x + 0.012, y + 0.2, top - 0.22, z - 0.012, z + 0.012, Q.black, Q.black, r);
    cyl(fb, x, y, z, 0.05, 0.26, 0.22, 8, Q.green, r);
    out.bulbs.push({ zone: 'shop', x, y: y - 0.02, z, r: 0.075 });   // 燈泡（會亮會暗，harbor.js 做）
  };
  pendant(-24.2, -11.35, top - 1.0); pendant(-22.0, -11.35, top - 1.0); pendant(-16.0, -11.0, top - 0.95); pendant(-20.1, -8.0, top - 0.95);
  // 地毯：櫃台前面
  {   // 一樣厚、不疊在一起（薄薄一層疊一層的小台階會被陰影抓到、一閃一閃）：中間一塊、四邊一圈淺色的邊
    const x0 = -25.9, x1 = -21.3, z0 = -10.6, z1 = -8.6, e = 0.14, y1 = D + 0.03;
    box(fb, x0 + e, x1 - e, D, y1, z0 + e, z1 - e, Q.rug, Q.rug, r, 0.03);
    box(fb, x0, x1, D, y1, z0, z0 + e, Q.rugEdge, Q.rugEdge, r, 0.02); box(fb, x0, x1, D, y1, z1 - e, z1, Q.rugEdge, Q.rugEdge, r, 0.02);
    box(fb, x0, x0 + e, D, y1, z0 + e, z1 - e, Q.rugEdge, Q.rugEdge, r, 0.02); box(fb, x1 - e, x1, D, y1, z0 + e, z1 - e, Q.rugEdge, Q.rugEdge, r, 0.02);
  }

  // ---- 櫃台：深色的櫃身（直條木板）、淺色的檯面、底下內縮的踢腳 ----
  {
    const c = I.counter, cy = D + c.h;
    box(fb, c.x0 + 0.06, c.x1 - 0.06, D, D + 0.1, c.z0 + 0.06, c.z1 - 0.06, P.woodDark, P.woodDark, r);
    box(fb, c.x0 + 0.02, c.x1 - 0.02, D + 0.1, cy - 0.06, c.z0 + 0.02, c.z1 - 0.02, P.wood, P.wood, r);
    for (let x = c.x0 + 0.2; x < c.x1 - 0.1; x += 0.31) box(fb, x - 0.025, x + 0.025, D + 0.12, cy - 0.08, c.z1 - 0.02, c.z1 + 0.01, P.woodDark, P.woodDark, r);   // 正面的直條
    box(fb, c.x0 - 0.05, c.x1 + 0.05, cy - 0.06, cy, c.z0 - 0.04, c.z1 + 0.07, P.woodLight, P.woodDark, r);   // 檯面
    // 收銀機（櫃台東端）、帳本、小鈴
    const rx = c.x1 - 0.42, rz = (c.z0 + c.z1) / 2 - 0.05;
    box(fb, rx - 0.22, rx + 0.22, cy, cy + 0.16, rz - 0.2, rz + 0.18, Q.dark, Q.dark, r);
    obox(fb, rx, cy + 0.21, rz + 0.04, 1, 0, 0.42, 0.28, 0.08, Q.brass, Q.dark, r, 0.03, -0.45, 0);
    box(fb, rx - 0.18, rx + 0.18, cy + 0.16, cy + 0.36, rz - 0.2, rz - 0.12, Q.dark, Q.dark, r);
    box(fd, rx - 0.12, rx + 0.12, cy + 0.36, cy + 0.42, rz - 0.18, rz - 0.14, Q.paper, Q.paper, r);
    box(fd, c.x0 + 0.25, c.x0 + 0.7, cy, cy + 0.04, rz - 0.15, rz + 0.18, Q.redDark, Q.paper, r);   // 帳本
    cyl(fd, c.x1 - 0.95, cy, rz + 0.15, 0.02, 0.07, 0.08, 8, Q.brass, r);   // 小鈴
  }
  // ---- 櫃台上的商品 ----
  const G = Object.fromEntries(H.GOODS.map((g) => [g.id, g]));
  {
    // 油：紅色的油桶（提把、油嘴）
    const g = G.fuel, y = g.y;
    box(fb, g.x - 0.2, g.x + 0.2, y, y + 0.48, g.z - 0.1, g.z + 0.1, Q.red, Q.red, r);
    box(fb, g.x - 0.14, g.x + 0.1, y + 0.48, y + 0.53, g.z - 0.03, g.z + 0.03, Q.redDark, Q.redDark, r);
    box(fb, g.x - 0.14, g.x - 0.1, y + 0.4, y + 0.53, g.z - 0.03, g.z + 0.03, Q.redDark, Q.redDark, r);
    box(fb, g.x + 0.06, g.x + 0.1, y + 0.4, y + 0.53, g.z - 0.03, g.z + 0.03, Q.redDark, Q.redDark, r);
    cyl(fb, g.x + 0.15, y + 0.48, g.z, 0.035, 0.045, 0.1, 6, Q.dark, r);
    for (const sx of [-1, 1]) box(fb, g.x - 0.17, g.x + 0.17, y + 0.12, y + 0.36, g.z + sx * 0.1 - 0.005, g.z + sx * 0.1 + 0.005, Q.redDark, Q.redDark, r, 0.02);   // 側面的 X 壓紋（簡化成一塊）
  }
  {
    // 扳手：斜立的展示板上一支大扳手
    const g = G.wrench, y = g.y, M = mat4(g.x, y + 0.2, g.z - 0.02, 0, -0.35);
    const sub = new FaceBuilder();
    box(sub, -0.28, 0.28, -0.2, 0.2, -0.03, 0.0, P.woodLight, P.woodDark, r);
    box(sub, -0.2, 0.12, -0.03, 0.03, 0.0, 0.025, Q.steel, Q.steel, r, 0.02);
    for (const [a, b] of [[0.12, 0.2]]) { box(sub, a, b, -0.07, -0.025, 0, 0.025, Q.steel, Q.steel, r, 0.02); box(sub, a, b, 0.025, 0.07, 0, 0.025, Q.steel, Q.steel, r, 0.02); }
    box(sub, -0.27, -0.2, -0.06, 0.06, 0, 0.025, Q.steel, Q.steel, r, 0.02);
    put(fb, sub.build(), M);
    box(fb, g.x - 0.18, g.x + 0.18, y, y + 0.05, g.z - 0.1, g.z + 0.12, P.woodDark, P.woodDark, r);
  }
  {
    // 釣竿：小木座上插三支往後仰的竿子（握把、捲線器）
    const g = G.rod, y = g.y;
    box(fb, g.x - 0.3, g.x + 0.3, y, y + 0.08, g.z - 0.14, g.z + 0.14, P.woodDark, P.wood, r);
    [-0.18, 0, 0.18].forEach((dx, i) => {
      const lean = -0.2 - i * 0.05, col = [Q.rodBlue, Q.rodBlack, Q.rodRed][i];
      const at = (d) => [g.x + dx, y + 0.05 + d * Math.cos(lean), g.z + d * Math.sin(lean)];   // 竿子上離底座 d 公尺的那一點
      cyl(fb, g.x + dx, y + 0.05, g.z, 0.018, 0.024, 0.34, 6, Q.cork, r, lean);
      const [hx, hy, hz] = at(0.33);
      cyl(fb, hx, hy, hz, 0.007, 0.016, 1.2, 5, col, r, lean);
      const [qx, qy, qz] = at(0.2);   // 捲線器：掛在握把朝客人那一側
      cyl(fb, qx - 0.025, qy - 0.01, qz + 0.07, 0.05, 0.05, 0.05, 8, Q.dark, r, 0, Math.PI / 2);
      box(fb, qx - 0.008, qx + 0.008, qy - 0.01, qy + 0.01, qz + 0.01, qz + 0.07, Q.dark, Q.dark, r, 0.02);
    });
  }
  {
    // 魚箱（保冷箱）：白色箱身、藍色蓋子、兩邊的提把
    const g = G.box, y = g.y;
    box(fb, g.x - 0.32, g.x + 0.32, y, y + 0.32, g.z - 0.2, g.z + 0.2, Q.plWhite, Q.plWhite, r, 0.02);
    box(fb, g.x - 0.34, g.x + 0.34, y + 0.32, y + 0.4, g.z - 0.22, g.z + 0.22, Q.plBlue, Q.plBlue, r, 0.02);
    for (const sx of [-1, 1]) box(fb, g.x + sx * 0.33 - 0.025, g.x + sx * 0.33 + 0.025, y + 0.2, y + 0.26, g.z - 0.1, g.z + 0.1, Q.plBlue, Q.plBlue, r, 0.02);
  }

  // ---- 櫃台後面：靠後牆整排貨架（五層），上面擺滿釣具盒、線軸、瓶罐、繩子；貨架上方的牆掛一張漁網和浮球 ----
  {
    const b = I.backShelf;
    const levels = [D + 0.1, D + 0.62, D + 1.14, D + 1.66, D + 2.18];
    for (const y of levels) box(fb, b.x0, b.x1, y, y + 0.05, b.z0, b.z1, P.woodLight, P.woodLight, r, 0.03);
    for (let x = b.x0; x <= b.x1 + 0.01; x += (b.x1 - b.x0) / 4) box(fb, x - 0.04, x + 0.04, D, D + 2.3, b.z0, b.z1, P.woodDark, P.woodDark, r);
    box(fb, b.x0, b.x1, D, D + 2.3, b.z0 - 0.02, b.z0 + 0.02, P.wood, P.wood, r);   // 背板
    const goods = [
      (x, y, z, w) => { const c = [Q.plGreen, Q.plOrange, Q.plBlue, Q.plYellow][Math.floor(r() * 4)]; const h = 0.12 + r() * 0.06; box(fd, x - w / 2, x + w / 2, y, y + h, z - 0.18, z + 0.18, c, c.clone().multiplyScalar(0.85), r, 0.03); },   // 釣具盒
      (x, y, z, w) => { for (let i = 0; i < 3; i++) cyl(fd, x - w / 3 + i * w / 3, y, z, 0.06, 0.06, 0.14, 8, [Q.rodBlue, Q.plOrange, Q.plGreen, Q.paper][Math.floor(r() * 4)], r); },   // 線軸
      (x, y, z, w) => { for (let i = 0; i < 4; i++) { const bx = x - w / 2 + 0.08 + i * (w - 0.16) / 3; cyl(fd, bx, y, z, 0.035, 0.045, 0.22, 6, [Q.glass, Q.plYellow, Q.redDark][i % 3], r); cyl(fd, bx, y + 0.22, z, 0.015, 0.02, 0.06, 5, Q.dark, r); } },   // 瓶子
      (x, y, z, w) => { const g = new THREE.TorusGeometry(0.13, 0.05, 5, 10); g.rotateX(Math.PI / 2); g.translate(x, y + 0.05, z); fd.addGeometry(g, () => jitter(P.rope, r, 0.05)); },   // 一捆繩子
      (x, y, z, w) => { box(fd, x - w / 2, x + w / 2, y, y + 0.22, z - 0.15, z + 0.15, P.crate, P.woodDark, r); },   // 小木箱
      (x, y, z, w) => { for (let i = 0; i < 3; i++) box(fd, x - w / 2 + i * w / 3 + 0.02, x - w / 2 + (i + 1) * w / 3 - 0.02, y, y + 0.24 + r() * 0.06, z - 0.08, z + 0.08, Q.paper, [Q.red, Q.plBlue, Q.plGreen][i], r, 0.03); },   // 一盒盒的餌
    ];
    for (const y of levels.slice(0, 4).map((v) => v + 0.05)) {
      for (let x = b.x0 + 0.12; x < b.x1 - 0.3;) {
        const w = 0.35 + r() * 0.3;
        if (x + w > b.x1 - 0.1) break;
        if (r() < 0.86) goods[Math.floor(r() * goods.length)](x + w / 2, y, (b.z0 + b.z1) / 2, w);
        x += w + 0.06;
      }
    }
    // 最上層放幾個浮球和一個船模型的盒子
    for (let x = b.x0 + 0.4; x < b.x1 - 0.3; x += 0.7 + r() * 0.4) { const g = new THREE.IcosahedronGeometry(0.13, 1); g.translate(x, D + 2.36, (b.z0 + b.z1) / 2); fd.addGeometry(g, () => jitter(r() < 0.5 ? P.float : Q.green, r, 0.04)); }
    // 貨架上方的牆：一串三角小旗（紅、白、藍、黃輪流），繩子微微下垂
    const ny = top - 0.28, nz = S.z0 + t + 0.04, x0 = b.x0 + 0.2, x1 = b.x1 - 0.2, sag = (x) => 0.18 * (1 - ((x - x0) / (x1 - x0) * 2 - 1) ** 2);
    const flagCols = [Q.red, Q.plWhite, Q.plBlue, Q.plYellow];
    for (let x = x0, i = 0; x < x1 - 0.3; x += 0.34, i++) {
      const xa = x, xb = x + 0.28, ya = ny - sag(xa), yb = ny - sag(xb), col = jitter(flagCols[i % 4], r, 0.04);
      const a = V(xa, ya, nz), b2 = V(xb, yb, nz), m = V((xa + xb) / 2, (ya + yb) / 2 - 0.32, nz + 0.01);
      fd.tri(a, m, b2, col); fd.tri(a, b2, m, col);
      obox(fd, x + 0.17, ny - sag(x + 0.17), nz, 1, 0, 0.36, 0.012, 0.012, P.rope, P.rope, r, 0.02, 0, 0);
    }
  }
  // ---- 西牆邊：一排賣的釣竿（底下一條有洞的木座，上面靠著牆） ----
  {
    const k = I.rodRack, ym = D + 1.55;
    box(fb, k.x0 + 0.1, k.x1, D, D + 0.14, k.z0, k.z1, P.woodDark, P.wood, r);
    box(fb, k.x0, k.x0 + 0.12, ym - 0.05, ym + 0.05, k.z0, k.z1, P.woodDark, P.woodDark, r);
    const cols = [Q.rodBlue, Q.rodGreen, Q.rodBlack, Q.rodRed, P.woodLight];
    for (let z = k.z0 + 0.22, i = 0; z < k.z1 - 0.1; z += 0.3, i++) {
      const lean = 0.1 + r() * 0.02, x = (k.x0 + k.x1) / 2 + 0.05;   // 往西牆那邊靠
      cyl(fb, x, D + 0.1, z, 0.02, 0.026, 0.4, 6, Q.cork, r, 0, lean);
      cyl(fb, x - Math.sin(-lean) * 0.4 * -1, D + 0.5, z, 0.008, 0.019, 1.9, 5, cols[i % cols.length], r, 0, lean);
      cyl(fd, x + 0.06, D + 0.45, z, 0.045, 0.045, 0.045, 8, Q.dark, r, Math.PI / 2);
    }
  }
  // ---- 東半邊：三座展示台（深色台座、淺色台面），擺引擎和兩艘船的模型 ----
  I.plinths.forEach((p) => {
    const y = D + p.h;
    box(fb, p.x0 + 0.05, p.x1 - 0.05, D, D + 0.08, p.z0 + 0.05, p.z1 - 0.05, P.woodDark, P.woodDark, r);
    box(fb, p.x0 + 0.03, p.x1 - 0.03, D + 0.08, y - 0.05, p.z0 + 0.03, p.z1 - 0.03, P.wood, P.wood, r);
    box(fb, p.x0, p.x1, y - 0.05, y, p.z0, p.z1, P.woodLight, P.woodDark, r);
    box(fb, p.x0 + 0.15, p.x1 - 0.15, D + 0.12, y - 0.12, p.z1 - 0.03, p.z1 + 0.005, P.woodDark, P.woodDark, r);   // 正面的嵌板（價格牌貼在這）
  });
  {
    // 舷外機：木架子（一根橫木）上夾著一台引擎：上面是引擎罩、中間是傳動軸、下面是螺旋槳
    const g = G.engine, y = g.y, bx = g.x, bz = g.z;
    for (const sx of [-1, 1]) box(fb, bx + sx * 0.45 - 0.05, bx + sx * 0.45 + 0.05, y, y + 0.72, bz - 0.2, bz - 0.1, P.woodDark, P.woodDark, r);
    box(fb, bx - 0.53, bx + 0.53, y + 0.62, y + 0.72, bz - 0.22, bz - 0.08, P.wood, P.wood, r);   // 架子的橫木（引擎夾在上面）
    box(fb, bx - 0.12, bx + 0.12, y + 0.58, y + 0.8, bz - 0.25, bz - 0.05, Q.dark, Q.dark, r);   // 夾具
    // 引擎：下半截深色、上面一個圓圓的引擎罩（紅色、白頂）；中間的腳往下接齒輪箱，螺旋槳朝著客人
    box(fb, bx - 0.2, bx + 0.2, y + 0.78, y + 0.98, bz - 0.05, bz + 0.38, Q.dark, Q.dark, r);
    const sub = new FaceBuilder();
    const cg = new THREE.CylinderGeometry(0.21, 0.23, 0.3, 10); cg.scale(1, 1, 1.25);
    sub.addGeometry(cg, (m, n) => (n.y > 0.5 ? Q.plWhite : m.y > 0.08 ? Q.plWhite : Q.red));
    put(fb, sub.build(), mat4(bx, y + 1.13, bz + 0.17));
    box(fb, bx - 0.09, bx + 0.09, y + 0.3, y + 0.78, bz + 0.05, bz + 0.25, Q.dark, Q.dark, r);   // 中間的腳
    box(fb, bx - 0.07, bx + 0.07, y + 0.13, y + 0.3, bz - 0.02, bz + 0.42, Q.dark, Q.dark, r);   // 齒輪箱
    box(fb, bx - 0.02, bx + 0.02, y + 0.0, y + 0.13, bz + 0.12, bz + 0.34, Q.dark, Q.dark, r);   // 底下的鰭
    cyl(fb, bx, y + 0.215, bz + 0.42, 0.04, 0.04, 0.08, 8, Q.brass, r, Math.PI / 2);   // 螺旋槳的軸心
    for (let i = 0; i < 3; i++) {   // 三片葉片，在朝客人的那一面張開
      const a = i * Math.PI * 2 / 3 + 0.4;
      obox(fb, bx + Math.cos(a) * 0.1, y + 0.215 + Math.sin(a) * 0.1, bz + 0.47, 1, 0, 0.15, 0.02, 0.08, Q.brass, Q.brass, r, 0.03, 0.4, a);
    }
  }
  // 船模型：照真的船縮小 1/14，放在兩個 V 形的木托上
  for (const [id, hull] of [['fisher', P.hullBlue], ['trawler', P.hullRed]]) {
    const g = G[id], s = 1 / 14, T = { fisher: 13, trawler: 18 }[id];
    for (const sx of [-0.28, 0.28]) box(fb, g.x + sx * T / 13 - 0.04, g.x + sx * T / 13 + 0.04, g.y, g.y + 0.08, g.z - 0.16, g.z + 0.16, P.woodDark, P.woodDark, r);
    const draft = id === 'fisher' ? 1.0 : 1.3;
    put(fb, boatGeo(id, P, hull, id === 'fisher' ? 51 : 61), mat4(g.x, g.y + 0.06 + draft * s * 0.8, g.z, 0, 0, 0, s));
  }
  // ---- 東半邊後牆：工作台、洞洞板上掛工具、一條掛在牆上的大魚標本 ----
  {
    const b = I.bench, y = D + b.h;
    box(fb, b.x0, b.x1, y - 0.07, y, b.z0, b.z1, P.woodLight, P.woodDark, r);
    for (const x of [b.x0 + 0.08, b.x1 - 0.08]) for (const z of [b.z0 + 0.08, b.z1 - 0.08]) box(fb, x - 0.05, x + 0.05, D, y - 0.07, z - 0.05, z + 0.05, P.woodDark, P.woodDark, r);
    box(fb, b.x0 + 0.05, b.x1 - 0.05, D + 0.18, D + 0.23, b.z0 + 0.05, b.z1 - 0.05, P.wood, P.wood, r);   // 下層板
    box(fb, b.x0 + 0.3, b.x0 + 0.9, D + 0.23, D + 0.5, b.z0 + 0.15, b.z1 - 0.15, Q.red, Q.redDark, r);   // 工具箱
    box(fd, b.x0 + 1.4, b.x0 + 1.75, y, y + 0.16, b.z0 + 0.2, b.z0 + 0.45, Q.dark, Q.dark, r);   // 虎鉗
    box(fd, b.x0 + 1.45, b.x0 + 1.7, y + 0.16, y + 0.22, b.z0 + 0.1, b.z0 + 0.55, Q.steel, Q.steel, r);
    for (let i = 0; i < 4; i++) cyl(fd, b.x0 + 2.4 + i * 0.22, y, b.z0 + 0.35, 0.06, 0.06, 0.16, 8, [Q.plBlue, Q.red, Q.plYellow, Q.steel][i], r);   // 機油罐
    { const px = b.x1 - 0.7, py = y + 0.05; for (let i = 0; i < 3; i++) { const a = i * 2.1; obox(fd, px + Math.cos(a) * 0.12, py + 0.02, b.z0 + 0.35 + Math.sin(a) * 0.12, Math.cos(a), Math.sin(a), 0.2, 0.1, 0.03, Q.brass, Q.brass, r); } cyl(fd, px, py, b.z0 + 0.35, 0.05, 0.05, 0.06, 6, Q.brass, r); }   // 一個備用螺旋槳
    // 洞洞板＋工具的影子
    const pz = S.z0 + t + 0.02;
    box(fb, b.x0 + 0.2, b.x1 - 0.6, y + 0.3, y + 1.5, pz, pz + 0.03, Q.peg, Q.peg, r, 0.03);
    for (let x = b.x0 + 0.45; x < b.x1 - 0.8; x += 0.32 + r() * 0.15) {
      const h = 0.18 + r() * 0.3, yy = y + 0.45 + r() * 0.6;
      box(fd, x - 0.02, x + 0.02, yy, yy + h, pz + 0.03, pz + 0.05, [Q.dark, Q.steel, Q.red][Math.floor(r() * 3)], Q.dark, r, 0.03);
      if (r() < 0.5) box(fd, x - 0.06, x + 0.06, yy + h - 0.06, yy + h, pz + 0.03, pz + 0.05, Q.steel, Q.dark, r, 0.03);
    }
    // 大魚標本：木牌＋一條大魚
    const fx = -13.2, fy = D + 2.35;
    box(fb, fx - 0.6, fx + 0.6, fy - 0.28, fy + 0.28, pz, pz + 0.04, P.woodDark, P.woodDark, r);
    put(fb, fishGeo(1.0, Q.rodBlue.clone().lerp(new THREE.Color('#3a6f8f'), 0.5), new THREE.Color('#dfe6ea'), new THREE.Color('#2e4f6b'), 77), mat4(fx, fy, pz + 0.12, 0, -Math.PI / 2, 0));
  }
  // 東牆裡面：舵輪、一張海圖
  {
    const x = S.x1 - t - 0.04, z = -10.5, y = D + 2.0;
    const g = new THREE.TorusGeometry(0.34, 0.035, 5, 14); g.rotateY(Math.PI / 2); g.translate(x, y, z); fd.addGeometry(g, () => jitter(P.wood, r, 0.04));
    for (let i = 0; i < 4; i++) obox(fd, x, y, z, 0, 1, 0.84, 0.04, 0.04, P.woodDark, P.woodDark, r, 0.03, 0, i * Math.PI / 4);   // 輻條（伸出輪圈外當把手）
    cyl(fd, x - 0.03, y, z, 0.07, 0.07, 0.08, 8, P.woodDark, r, 0, Math.PI / 2);
    box(fb, x - 0.02, x, D + 1.3, D + 2.2, -12.2, -11.05, Q.chart, Q.chart, r, 0.03);
  }
  camBox(S.x0, S.x1, D, top, S.z0, S.z0 + t); camBox(S.x0, S.x0 + t, D, top, S.z0, S.z1); camBox(S.x1 - t, S.x1, D, top, S.z0, S.z1);
  camBox(S.open.x1, S.x1, D, top, S.z1 - t, S.z1); camBox(S.x0, S.open.x1, D + 2.6, top, S.z1 - t, S.z1);
  camBox(S.x0 - 0.7, S.x1 + 0.7, top, top + 2.2, S.z0 - 0.7, S.z1 + 0.7);   // 屋頂

  // =========================================================================
  // 魚市場
  // =========================================================================
  const M = H.MARKET, MI = H.MARKET_IN;
  box(fb, M.x0 - 0.2, M.x1 + 0.2, D - 1.4, D - 0.07, M.z0 - 0.2, M.z0 + 1.5, P.stone, P.stone, r);
  // 屋頂的斜面：後高前低
  const zb = M.z0 - 0.5, zf = M.z1 + 0.9, yb = D + M.h + 0.85, yf = D + M.h - 0.1;
  const roofY = (z) => yb + (yf - yb) * (z - zb) / (zf - zb);
  const rPitch = Math.atan2(yb - yf, zf - zb), rLen = Math.hypot(zf - zb, yb - yf);
  const PX = [M.x0 + 0.3, (M.x0 + M.x1) / 2, M.x1 - 0.3], PZ = [M.z0 + 0.3, M.z1 - 0.3];
  for (const x of PX) for (const z of PZ) {
    const ht = roofY(z) - 0.32;
    box(fb, x - 0.16, x + 0.16, D, ht, z - 0.16, z + 0.16, P.wood, P.wood, r);
    box(fb, x - 0.2, x + 0.2, D, D + 0.12, z - 0.2, z + 0.2, P.stone, P.stone, r);   // 柱腳的石墩
    out.solids.push({ x, z, r: 0.2 });
  }
  // 前後兩根大樑、每排柱子上一根斜樑、樑下的斜撐、斜樑上的椽子
  for (const z of PZ) {
    const y = roofY(z) - 0.32;
    box(fb, M.x0 - 0.1, M.x1 + 0.1, y - 0.24, y, z - 0.12, z + 0.12, P.woodDark, P.woodDark, r);
    for (let i = 0; i < PX.length; i++) for (const sx of [-1, 1]) {
      if ((i === 0 && sx < 0) || (i === PX.length - 1 && sx > 0)) continue;
      obox(fb, PX[i] + sx * 0.35, y - 0.55, z, 1, 0, 0.85, 0.1, 0.1, P.woodDark, P.woodDark, r, 0.03, 0, sx * 0.78);
    }
  }
  for (const x of PX) obox(fb, x, (roofY(PZ[0]) + roofY(PZ[1])) / 2 - 0.2, (PZ[0] + PZ[1]) / 2, 0, 1, PZ[1] - PZ[0] + 0.5, 0.16, 0.2, P.woodDark, P.woodDark, r, 0.03, 0, -rPitch);
  for (let x = M.x0 - 0.3; x <= M.x1 + 0.35; x += 1.25) obox(fb, x, roofY((zb + zf) / 2) - 0.1, (zb + zf) / 2, 0, 1, rLen - 0.2, 0.08, 0.1, P.wood, P.wood, r, 0.03, 0, -rPitch);
  // 鐵皮浪板：一片一片（有的舊一點、有一點鏽色），電腦版看得到一道道起伏
  for (let x = M.x0 - 0.6, i = 0; x < M.x1 + 0.6; x += 1.05, i++) {
    const k = r(), col = k < 0.2 ? P.roofTin.clone().lerp(new THREE.Color('#8a6a52'), 0.35) : k < 0.5 ? P.roofTin.clone().multiplyScalar(0.92) : P.roofTin;
    obox(fb, x + 0.55, roofY((zb + zf) / 2) + 0.01 + (i % 2) * 0.012, (zb + zf) / 2, 0, 1, rLen, 1.12, 0.03, col, col.clone().multiplyScalar(0.7), r, 0.03, 0, -rPitch);
  }
  obox(fb, (M.x0 + M.x1) / 2, yf - 0.1, zf + 0.02, 1, 0, M.x1 - M.x0 + 1.4, 0.05, 0.2, P.woodDark, P.woodDark, r);   // 前緣的封簷板
  camBox(M.x0 - 0.6, M.x1 + 0.6, D + M.h - 0.1, D + M.h + 0.85, M.z0 - 0.5, M.z1 + 0.9);
  // 店名招牌的木框（字在 harbor.js）、前樑上掛兩個紅燈籠
  { const sg = H.SIGNS[1]; box(fb, sg.x - sg.w / 2 - 0.1, sg.x + sg.w / 2 + 0.1, sg.y - sg.h / 2 - 0.08, sg.y + sg.h / 2 + 0.08, PZ[1] + 0.12, sg.z - 0.01, P.woodDark, P.woodDark, r); }
  for (const x of [16.4, 23.6]) {
    const y = roofY(PZ[1]) - 1.05, z = PZ[1] + 0.05;
    box(fd, x - 0.01, x + 0.01, y + 0.28, roofY(PZ[1]) - 0.56, z - 0.01, z + 0.01, Q.black, Q.black, r);
    const g = new THREE.SphereGeometry(0.22, 8, 5); g.scale(1, 1.35, 1); g.translate(x, y, z);
    fb.addGeometry(g, (m) => (Math.abs(m.y - y) > 0.24 ? Q.black : jitter(Q.red, r, 0.03)));
  }
  // 後牆：直釘的舊木板、上緣壓一條；中間掛黑板（字在 harbor.js）
  {
    for (let x = M.x0 - 0.2; x < M.x1 + 0.2; x += 0.3) { const k = r(); const col = k < 0.3 ? P.woodGrey : k < 0.6 ? P.wood : P.woodLight; box(fb, x, Math.min(x + 0.3, M.x1 + 0.2), D, D + 2.2, M.z0, M.z0 + 0.2, col, col.clone().multiplyScalar(0.92), r, 0.05); }
    box(fb, M.x0 - 0.25, M.x1 + 0.25, D + 2.2, D + 2.28, M.z0 - 0.02, M.z0 + 0.24, P.woodDark, P.woodDark, r);
    const sg = H.SIGNS[2];
    box(fb, sg.x - sg.w / 2 - 0.08, sg.x + sg.w / 2 + 0.08, sg.y - sg.h / 2 - 0.08, sg.y + sg.h / 2 + 0.08, M.z0 + 0.2, sg.z - 0.005, P.woodDark, P.woodDark, r);
    camBox(M.x0 - 0.2, M.x1 + 0.2, D, D + 2.2, M.z0, M.z0 + 0.2);
  }
  // 後牆兩邊的魚乾架：一根橫桿、繩子上吊著一排排剖開的魚乾
  for (const [x0, x1] of [[M.x0 + 0.5, 18.3], [21.7, M.x1 - 0.5]]) {
    const z = M.z0 + 0.45;
    box(fb, x0, x1, D + 2.0, D + 2.05, z - 0.025, z + 0.025, P.woodDark, P.woodDark, r);
    for (const x of [x0 + 0.1, x1 - 0.1]) box(fb, x - 0.03, x + 0.03, D + 1.95, D + 2.05, M.z0 + 0.2, z + 0.03, P.woodDark, P.woodDark, r);
    for (let x = x0 + 0.25; x < x1 - 0.15; x += 0.32) {
      for (const [dz, yy] of [[-0.06, D + 1.72], [0.06, D + 1.42]]) {
        const col = jitter(r() < 0.5 ? Q.himono : Q.himono2, r, 0.05), cx = x + (r() - 0.5) * 0.05, cz = z + dz;
        box(fd, cx - 0.004, cx + 0.004, yy + 0.18, D + 2.0, cz - 0.004, cz + 0.004, Q.black, Q.black, r, 0);
        const a = V(cx, yy + 0.2, cz), b = V(cx - 0.1, yy + 0.05, cz), c2 = V(cx, yy - 0.08, cz), d = V(cx + 0.1, yy + 0.05, cz);
        fd.tri(a, b, c2, col); fd.tri(a, c2, d, col); fd.tri(a, c2, b, col); fd.tri(a, d, c2, col);
        fd.tri(c2, V(cx - 0.06, yy - 0.18, cz), V(cx + 0.06, yy - 0.18, cz), col); fd.tri(c2, V(cx + 0.06, yy - 0.18, cz), V(cx - 0.06, yy - 0.18, cz), col);
      }
    }
  }

  // ---- 前排兩座鋪冰的展示台：木頭台架、往前斜的淺盤、碎冰、一排排的魚、插在冰上的價格卡 ----
  const fishLib = [];
  for (let s = 0; s < SPECIES.length; s++) for (const len of [0.34, 0.46]) fishLib.push({ g: fishGeo(len, new THREE.Color(SPECIES[s][0]), new THREE.Color(SPECIES[s][1]), new THREE.Color(SPECIES[s][2]), 300 + s * 7 + len * 100), len });
  MI.displays.forEach((d) => {
    const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2, w = d.x1 - d.x0, dp = d.z1 - d.z0, ty = D + 0.9, tilt = 0.2;
    // 台架：四根腳、前面一條擋板（直條）
    for (const x of [d.x0 + 0.08, d.x1 - 0.08]) for (const z of [d.z0 + 0.1, d.z1 - 0.1]) box(fb, x - 0.05, x + 0.05, D, ty - 0.05, z - 0.05, z + 0.05, P.woodDark, P.woodDark, r);
    box(fb, d.x0 + 0.04, d.x1 - 0.04, D + 0.15, D + 0.2, d.z0 + 0.06, d.z1 - 0.06, P.wood, P.wood, r);
    for (let x = d.x0 + 0.1; x < d.x1 - 0.05; x += 0.22) box(fb, x, x + 0.2, D + 0.28, ty - 0.12, d.z1 - 0.07, d.z1 - 0.04, P.woodLight, P.woodLight, r, 0.06);
    // 斜的淺盤（在台子自己的座標裡蓋，再一起斜放上去）
    const sub = new FaceBuilder(), sd = new FaceBuilder();
    box(sub, -w / 2, w / 2, -0.05, 0, -dp / 2, dp / 2, P.woodDark, P.woodDark, r);
    for (const [a, b, c2, e] of [[-w / 2, w / 2, -dp / 2, -dp / 2 + 0.05], [-w / 2, w / 2, dp / 2 - 0.05, dp / 2], [-w / 2, -w / 2 + 0.05, -dp / 2, dp / 2], [w / 2 - 0.05, w / 2, -dp / 2, dp / 2]]) box(sub, a, b, 0, 0.1, c2, e, P.woodLight, P.wood, r);
    // 碎冰：一格一格高低不一、白裡透藍
    const nx = Math.round((w - 0.1) / 0.09), nz = Math.round((dp - 0.1) / 0.09), hgt = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) hgt.push(0.035 + r() * 0.03);
    const at = (i, j) => V(-w / 2 + 0.05 + (w - 0.1) * i / nx, hgt[j * (nx + 1) + i], -dp / 2 + 0.05 + (dp - 0.1) * j / nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const c1 = jitter(r() < 0.3 ? Q.ice2 : Q.ice, r, 0.04), c3 = jitter(r() < 0.3 ? Q.ice2 : Q.ice, r, 0.04);
      sub.tri(at(i, j), at(i, j + 1), at(i + 1, j + 1), c1); sub.tri(at(i, j), at(i + 1, j + 1), at(i + 1, j), c3);
    }
    // 魚：兩排斜斜地排，頭朝前
    for (const [row, zz] of [[0, -dp * 0.2], [1, dp * 0.22]]) {
      for (let x = -w / 2 + 0.3, k = 0; x < w / 2 - 0.25; k++) {
        const f = fishLib[Math.floor(r() * fishLib.length)];
        const ang = (row ? 0.5 : -0.5) + (r() - 0.5) * 0.25 + Math.PI / 2;
        put(sd, f.g, mat4(x, 0.085 + f.len * 0.04, zz + (r() - 0.5) * 0.06, ang, 0, 0));
        x += f.len * 0.55 + 0.04;
      }
    }
    // 價格卡：白色小卡插在冰上
    for (let x = -w / 2 + 0.6; x < w / 2 - 0.3; x += 1.1) obox(sd, x, 0.16, dp / 2 - 0.12, 1, 0, 0.16, 0.012, 0.1, Q.paper, Q.paper, r, 0.02, -0.4, 0);
    const Mt = mat4(cx, ty, cz, 0, tilt, 0);
    put(fb, sub.build(), Mt); put(fb, sd.build(), Mt);
  });

  // ---- 收購站：中間那根柱子上掛電子價格板（字在 harbor.js）、左邊磅秤上的漁獲籃、右邊賣出的按鈕 ----
  {
    const B = H.SELL.board, Ba = H.SELL.basket, Bu = H.SELL.button;
    box(fb, B.x - 0.66, B.x + 0.66, D + 1.15, D + 1.95, B.z - 0.08, B.z + 0.08, Q.dark, Q.dark, r);
    box(fb, B.x - 0.6, B.x + 0.6, D + 1.2, D + 1.9, B.z + 0.06, B.z + 0.081, P.window, P.window, r, 0.01);
    box(fb, B.x - 0.76, B.x + 0.76, D + 1.95, D + 2.02, B.z - 0.1, B.z + 0.22, Q.dark, Q.dark, r);   // 板子上一片小遮簷
    // 磅秤：金屬平台、後面一根柱子頂著圓形的錶
    box(fb, Ba.x - 0.55, Ba.x + 0.55, D, D + 0.1, Ba.z - 0.5, Ba.z + 0.5, Q.steel, Q.dark, r);
    box(fb, Ba.x - 0.05, Ba.x + 0.05, D + 0.1, D + 1.0, Ba.z - 0.5, Ba.z - 0.4, Q.dark, Q.dark, r);
    cyl(fb, Ba.x, D + 1.0, Ba.z - 0.48, 0.2, 0.2, 0.08, 14, (m, n) => (n.z > 0.5 ? Q.plWhite : Q.dark), r, Math.PI / 2);
    obox(fb, Ba.x + 0.05, D + 1.06, Ba.z - 0.39, 0.7, 0.7, 0.16, 0.02, 0.01, Q.red, Q.red, r, 0.01, Math.PI / 2, 0.8);
    // 籃子：編織的（電腦版有布紋），四面＋底
    const bw = 0.45, bd = 0.38, bh = 0.42, bc = withSurf(P.woodLight, SURF.cloth), y0 = D + 0.1;
    box(fb, Ba.x - bw, Ba.x + bw, y0, y0 + 0.04, Ba.z - bd, Ba.z + bd, bc, bc, r);
    for (const [a, b, c2, e] of [[-bw, bw, -bd, -bd + 0.04], [-bw, bw, bd - 0.04, bd], [-bw, -bw + 0.04, -bd, bd], [bw - 0.04, bw, -bd, bd]]) box(fb, Ba.x + a, Ba.x + b, y0, y0 + bh, Ba.z + c2, Ba.z + e, bc, bc.clone().multiplyScalar(0.88), r);
    box(fb, Ba.x - bw - 0.02, Ba.x + bw + 0.02, y0 + bh - 0.05, y0 + bh, Ba.z - bd - 0.02, Ba.z + bd + 0.02, P.woodDark, P.woodDark, r);   // 籃口一圈
    // 按鈕：一根圓柱台、黃色的面板、紅色的大按鈕
    cyl(fb, Bu.x, D, Bu.z, 0.17, 0.2, 0.92, 10, Q.plWhite, r);
    cyl(fb, Bu.x, D + 0.92, Bu.z, 0.2, 0.2, 0.05, 10, Q.plYellow, r);
    cyl(fb, Bu.x, D + 0.97, Bu.z, 0.11, 0.12, 0.08, 10, Q.red, r);
  }

  // ---- 棚子裡：處理魚的長桌（不鏽鋼檯面）、冰櫃和魚箱、活魚水槽、幾個桶子 ----
  {
    const tb = MI.table, y = D + tb.h;
    box(fb, tb.x0, tb.x1, y - 0.05, y, tb.z0, tb.z1, Q.steel, Q.steel, r, 0.02);
    for (const x of [tb.x0 + 0.06, tb.x1 - 0.06]) for (const z of [tb.z0 + 0.06, tb.z1 - 0.06]) box(fb, x - 0.03, x + 0.03, D, y - 0.05, z - 0.03, z + 0.03, Q.steel, Q.steel, r);
    box(fb, tb.x0 + 0.05, tb.x1 - 0.05, D + 0.2, D + 0.23, tb.z0 + 0.05, tb.z1 - 0.05, Q.steel, Q.steel, r);
    box(fb, tb.x1 - 0.9, tb.x1 - 0.1, y - 0.18, y + 0.01, tb.z0 + 0.12, tb.z1 - 0.12, Q.dark, Q.dark, r);   // 水槽
    box(fb, tb.x1 - 0.85, tb.x1 - 0.15, y - 0.06, y - 0.05, tb.z0 + 0.15, tb.z1 - 0.15, Q.water, Q.water, r, 0.02);
    for (const x of [tb.x0 + 0.8, tb.x0 + 2.4]) box(fb, x - 0.32, x + 0.32, y, y + 0.03, tb.z0 + 0.2, tb.z1 - 0.2, P.woodLight, P.woodLight, r, 0.03);   // 砧板
    put(fd, fishLib[3].g, mat4(tb.x0 + 0.8, y + 0.06, (tb.z0 + tb.z1) / 2, 0.3));
    put(fd, fishLib[9].g, mat4(tb.x0 + 2.4, y + 0.06, (tb.z0 + tb.z1) / 2, -0.2));
    for (const x of [tb.x0 + 1.25, tb.x0 + 2.85]) { box(fd, x - 0.01, x + 0.01, y + 0.03, y + 0.045, tb.z0 + 0.3, tb.z0 + 0.42, Q.black, Q.black, r, 0); box(fd, x - 0.012, x + 0.012, y + 0.03, y + 0.04, tb.z0 + 0.42, tb.z0 + 0.62, Q.steel, Q.steel, r, 0); }   // 刀
    for (const x of [tb.x0 + 0.5, tb.x0 + 1.6]) cyl(fb, x, D + 0.23, (tb.z0 + tb.z1) / 2, 0.2, 0.16, 0.3, 10, Q.plBlue, r);   // 桌下的水桶
    // 冰櫃
    const ch = MI.chest;
    box(fb, ch.x0, ch.x1, D, D + 0.72, ch.z0, ch.z1, Q.plWhite, Q.plWhite, r, 0.02);
    box(fb, ch.x0 - 0.02, ch.x1 + 0.02, D + 0.72, D + 0.82, ch.z0 - 0.02, ch.z1 + 0.02, Q.plBlue, Q.plBlue, r, 0.02);
    box(fb, (ch.x0 + ch.x1) / 2 - 0.25, (ch.x0 + ch.x1) / 2 + 0.25, D + 0.55, D + 0.62, ch.z1, ch.z1 + 0.04, Q.dark, Q.dark, r, 0.02);
    // 疊起來的魚箱：最上面那箱裝著冰和魚
    const bx = MI.boxes, cxb = (bx.x0 + bx.x1) / 2, czb = (bx.z0 + bx.z1) / 2;
    for (let i = 0; i < 3; i++) { const y0 = D + i * 0.3, dx = (r() - 0.5) * 0.08; box(fb, bx.x0 + dx, bx.x1 + dx, y0, y0 + 0.28, bx.z0, bx.z1, P.fishbox, P.fishbox.clone().multiplyScalar(0.85), r); }
    box(fb, bx.x0 + 0.06, bx.x1 - 0.06, D + 0.84, D + 0.87, bx.z0 + 0.06, bx.z1 - 0.06, Q.ice, Q.ice, r, 0.03);
    for (let i = 0; i < 3; i++) put(fd, fishLib[i * 2].g, mat4(cxb + (i - 1) * 0.3, D + 0.9, czb + (r() - 0.5) * 0.2, Math.PI / 2 + (r() - 0.5) * 0.3));
    // 活魚水槽：兩個玻璃缸（金屬框、看得到水面）、上面一台打氣機
    const tk = MI.tanks, mz = (tk.z0 + tk.z1) / 2;
    for (const [z0, z1] of [[tk.z0, mz - 0.05], [mz + 0.05, tk.z1]]) {
      box(fb, tk.x0, tk.x1, D, D + 0.35, z0, z1, Q.dark, Q.dark, r);
      box(fb, tk.x0 + 0.04, tk.x1 - 0.04, D + 0.35, D + 1.05, z0 + 0.04, z1 - 0.04, Q.glass, Q.glass, r, 0.02);
      box(fb, tk.x0 + 0.05, tk.x1 - 0.05, D + 0.96, D + 0.97, z0 + 0.05, z1 - 0.05, Q.water, Q.water, r, 0.02);
      for (const x of [tk.x0, tk.x1 - 0.05]) for (const z of [z0, z1 - 0.05]) box(fb, x, x + 0.05, D + 0.35, D + 1.08, z, z + 0.05, Q.steel, Q.steel, r);
      box(fb, tk.x0, tk.x1, D + 1.05, D + 1.08, z0, z1, Q.steel, Q.steel, r, 0.02);
    }
    box(fd, tk.x0 + 0.5, tk.x0 + 0.9, D + 1.08, D + 1.26, mz - 0.2, mz + 0.2, Q.plGreen, Q.plGreen, r, 0.02);
    // 桶子、刷子
    for (const [x, z] of [[23.2, -11.6], [23.65, -11.3]]) cyl(fb, x, D, z, 0.2, 0.17, 0.35, 10, r() < 0.5 ? Q.plOrange : Q.plBlue, r);
    obox(fd, 23.0, D + 0.55, -11.95, 0, 1, 0.04, 0.04, 1.1, P.woodLight, P.woodLight, r, 0.03, 0.15, 0);
    // 棚子裡吊兩顆燈泡
    for (const x of [16.6, 23.4]) { const y = roofY(-9.5) - 0.9; box(fd, x - 0.01, x + 0.01, y + 0.1, roofY(-9.5) - 0.15, -9.51, -9.49, Q.black, Q.black, r, 0); cyl(fb, x, y, -9.5, 0.06, 0.2, 0.14, 8, Q.green, r); out.bulbs.push({ zone: 'market', x, y: y - 0.03, z: -9.5, r: 0.07 }); }
  }

  // ---- 室內燈的開關：白色面板、中間一個撥桿 ----
  for (const sw of H.SWITCHES) {
    const tx = -sw.nz, tz = sw.nx;   // 沿著牆面的方向
    const at = (u, v) => [sw.x + sw.nx * u + tx * v, sw.z + sw.nz * u + tz * v];
    const [ax, az] = at(-0.02, 0), [bx, bz] = at(0.02, 0);
    obox(fb, (ax + bx) / 2, sw.y, (az + bz) / 2, tx, tz, 0.12, 0.03, 0.18, Q.plWhite, Q.plWhite, r, 0.01);
    const [cx, cz] = at(0.03, 0);
    obox(fb, cx, sw.y, cz, tx, tz, 0.03, 0.03, 0.07, Q.dark, Q.dark, r, 0.01);
  }

  // ---- 旗子（のぼり）的旗桿：魚市場前兩支、商店門口一支（布在 harbor.js 用貼圖畫）----
  for (const sg of H.SIGNS.filter((s) => s.style === 'nobori')) {
    const x = sg.x - sg.w / 2 - 0.03, z = sg.z;
    cyl(fb, x, D, z, 0.2, 0.24, 0.16, 10, Q.dark, r);
    cyl(fb, x, D + 0.16, z, 0.022, 0.022, sg.y + sg.h / 2 + 0.15 - D - 0.16, 6, Q.steel, r);
    box(fb, x, x + sg.w + 0.05, sg.y + sg.h / 2 + 0.02, sg.y + sg.h / 2 + 0.05, z - 0.012, z + 0.012, Q.steel, Q.steel, r, 0);
    out.solids.push({ x, z, r: 0.26 });
  }
}
