// 商品與工位的模型（低面平塗）：海上修船屋、大港灣島的攤位共用，母港的捐款箱、郵筒也用這裡的。
// 每個模型都蓋在自己的原點上：y = 0 是擺放面（櫃台面；修船台、捐款箱、郵筒是站在地上的，y = 0 是地面），客人在 +z 那一側。
// 蓋好的是一個幾何（有顏色、材質種類），用 placeGeo() 擺進別人的 FaceBuilder
import * as THREE from 'three';
import { FaceBuilder, SColor, SURF, withSurf, rng } from './kit.js';
import { jitter } from './palette.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = (hex, surf = 0) => withSurf(new THREE.Color(hex), surf);
const Q = {
  steel: C('#a9b1b5', SURF.metal), dark: C('#3a3f43', SURF.metal), brass: C('#c79a3a', SURF.metal), gold: C('#e3b94a', SURF.metal), iron: C('#2a2c2e', SURF.metal),
  red: C('#c8352a'), redDark: C('#8f2a22'), white: C('#eeeeea'), blue: C('#3c78b4'), orange: C('#e0782f'), yellow: C('#e8c13a'), green: C('#3f8a55'), greenDark: C('#2c6a3f'),
  screen: C('#3ad06a'), screenDark: C('#12331f'), paper: C('#efe6cf'), cork: C('#c9a36b', SURF.wood), bulb: C('#ffe2a0'), pink: C('#e7a9a2'), silver: C('#c9d3d8'),
  rose: C('#6b2a22', SURF.wood), roseDark: C('#4a1c17', SURF.wood), black: C('#1d1b1a'), cloth: C('#27406a', SURF.cloth), rope: C('#b59a68', SURF.cloth),
  navy: C('#234a86'), crimson: C('#c72a2e'), emerald: C('#1f8c61'), obsidian: C('#292b33'),
};
export const GOOD_COLORS = Q;

// 把一個蓋好的幾何（有 color、aSurf）擺進 fb：位置、繞 y 轉 ry、放大 s；顏色、材質種類照抄，紋路方向跟著轉
const _m3 = new THREE.Matrix3();
export function placeGeo(fb, geo, x, y, z, ry = 0, s = 1) {
  const M = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ry), V(s, s, s));
  const g = geo.clone().applyMatrix4(M), col = g.attributes.color, sf = g.attributes.aSurf;
  const m3 = _m3.setFromMatrix4(M).clone();
  fb.addGeometry(g, (m, n, i) => {
    const c = new SColor(col.getX(i * 3), col.getY(i * 3), col.getZ(i * 3));
    if (sf) { c.surf = sf.getX(i * 3); c.grain = V(sf.getY(i * 3), sf.getZ(i * 3), sf.getW(i * 3)).applyMatrix3(m3).normalize(); }
    return c;
  });
}

// 一個小工具組：在自己的 FaceBuilder 裡蓋方塊、圓柱、斜放的方塊
export function kit(r) {
  const fb = new FaceBuilder();
  const GX = V(1, 0, 0), GY = V(0, 1, 0), GZ = V(0, 0, 1);
  const longest = (a, b, c) => (a >= b && a >= c ? GX : b >= c ? GY : GZ);
  // 方塊：x0..x1、y0..y1、z0..z1；top 上面的顏色、side 側面的顏色
  const box = (x0, x1, y0, y1, z0, z1, top, side = top, amt = 0.03) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const ct = jitter(top, r, amt), cs = jitter(side, r, amt), cd = cs.clone().multiplyScalar(0.9);
    fb.grain = longest(x1 - x0, y1 - y0, z1 - z0);
    fb.addGeometry(g, (m, n) => (n.y > 0.5 ? ct : Math.abs(n.x) > 0.5 ? cd : cs));
    fb.grain = null;
  };
  // 圓柱（或圓錐）：底面中心 (x, y, z)、上下半徑、高 h；rotX／rotZ 讓它躺下來
  const cyl = (x, y, z, rt, rb, h, seg, col, rotX = 0, rotZ = 0, amt = 0.03) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.translate(0, h / 2, 0);
    if (rotX) g.rotateX(rotX);
    if (rotZ) g.rotateZ(rotZ);
    g.translate(x, y, z);
    const cs = jitter(col, r, amt), cap = cs.clone().multiplyScalar(1.07);
    fb.addGeometry(g, (m, n) => (Math.abs(rotX || rotZ ? 0 : n.y) > 0.5 ? cap : cs));
  };
  // 一根從 a 到 b 的方條（寬 w、厚 h）
  const bar = (a, b, w, h, col, amt = 0.03) => {
    const d = b.clone().sub(a), len = d.length();
    const g = new THREE.BoxGeometry(w, len, h);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(GY, d.clone().normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    const c = jitter(col, r, amt), c2 = c.clone().multiplyScalar(0.88);
    fb.addGeometry(g, (m, n) => (n.y > 0.4 ? c : c2));
  };
  const ball = (x, y, z, rad, col, detail = 1) => { const g = new THREE.IcosahedronGeometry(rad, detail); g.translate(x, y, z); const c = jitter(col, r, 0.03); fb.addGeometry(g, (m, n) => (n.y > 0.3 ? c : c.clone().multiplyScalar(0.9))); };
  const torus = (x, y, z, R, t, col, rotX = Math.PI / 2, rotZ = 0) => { const g = new THREE.TorusGeometry(R, t, 5, 12); g.rotateX(rotX); if (rotZ) g.rotateZ(rotZ); g.translate(x, y, z); const c = jitter(col, r, 0.03); fb.addGeometry(g, () => c); };
  return { fb, box, cyl, bar, ball, torus, add: (geo, x, y, z, ry = 0, s = 1) => placeGeo(fb, geo, x, y, z, ry, s), geo: () => fb.build() };
}

// 站在地上的工位（y = 0 是地面，不是櫃台面）
export const FLOOR_GOODS = new Set(['repair', 'title', 'mailbox']);

// 一樣商品的模型。P：色板；boatGeo(type, P, 船殼顏色, 亂數種子)：船的低面模型（harbor3d.js 的）
export function goodGeo(id, { P, boatGeo = null, seed = 1 }) {
  const r = rng(9000 + seed * 13 + id.length * 101 + id.charCodeAt(id.length - 1));
  const k = kit(r), { box, cyl, bar, ball, torus } = k;
  const tray = (hw = 0.2, hd = 0.14) => box(-hw, hw, 0, 0.012, -hd, hd, P.woodDark);
  switch (id) {
    case 'fuel': {   // 紅色手提油桶：兩桶並排，後面再疊一桶
      const can = (x, z, y = 0) => {
        box(x - 0.2, x + 0.2, y, y + 0.48, z - 0.1, z + 0.1, Q.red, Q.red);
        box(x - 0.14, x + 0.1, y + 0.48, y + 0.53, z - 0.03, z + 0.03, Q.redDark);
        box(x - 0.14, x - 0.1, y + 0.4, y + 0.53, z - 0.03, z + 0.03, Q.redDark);
        box(x + 0.06, x + 0.1, y + 0.4, y + 0.53, z - 0.03, z + 0.03, Q.redDark);
        cyl(x + 0.15, y + 0.48, z, 0.035, 0.045, 0.1, 6, Q.dark);
        box(x - 0.17, x + 0.17, y + 0.12, y + 0.36, z + 0.1, z + 0.106, Q.redDark, Q.redDark, 0.02);
      };
      can(-0.24, 0.02); can(0.24, 0.02); can(0, -0.2);
      break;
    }
    case 'rod': {   // 釣竿：小木座上插三支往後仰的竿子
      box(-0.3, 0.3, 0, 0.08, -0.14, 0.14, P.woodDark, P.wood);
      [-0.18, 0, 0.18].forEach((dx, i) => {
        const lean = -0.2 - i * 0.05, col = [Q.blue, Q.black, Q.redDark][i];
        cyl(dx, 0.05, 0, 0.018, 0.024, 0.34, 6, Q.cork, lean);
        cyl(dx, 0.05 + 0.33 * Math.cos(lean), 0.33 * Math.sin(lean), 0.007, 0.016, 1.2, 5, col, lean);
        cyl(dx - 0.025, 0.04 + 0.2 * Math.cos(lean), 0.2 * Math.sin(lean) + 0.07, 0.05, 0.05, 0.05, 8, Q.dark, 0, Math.PI / 2);
      });
      break;
    }
    case 'box': {   // 魚箱（保冷箱）：白色箱身、藍色蓋子
      box(-0.32, 0.32, 0, 0.32, -0.2, 0.2, Q.white, Q.white, 0.02);
      box(-0.34, 0.34, 0.32, 0.4, -0.22, 0.22, Q.blue, Q.blue, 0.02);
      for (const sx of [-1, 1]) box(sx * 0.33 - 0.025, sx * 0.33 + 0.025, 0.2, 0.26, -0.1, 0.1, Q.blue, Q.blue, 0.02);
      break;
    }
    case 'chum': {   // 誘魚桶：橘紅木桶、上下兩道桶箍、頂上的餌料塊、提把、白色標牌
      cyl(0, 0, 0, 0.19, 0.16, 0.34, 10, C('#d95f18'));
      cyl(0, 0.05, 0, 0.185, 0.175, 0.03, 10, Q.dark); cyl(0, 0.26, 0, 0.198, 0.19, 0.03, 10, Q.dark);
      cyl(0, 0.34, 0, 0.17, 0.19, 0.03, 10, P.woodDark);
      for (let i = 0; i < 4; i++) { const a = i * 1.55; box(Math.cos(a) * 0.07 - 0.04, Math.cos(a) * 0.07 + 0.04, 0.37, 0.42, Math.sin(a) * 0.07 - 0.03, Math.sin(a) * 0.07 + 0.03, Q.red, Q.redDark, 0.02); }
      torus(0, 0.42, 0, 0.15, 0.012, Q.steel, 0);
      box(-0.09, 0.09, 0.12, 0.22, 0.175, 0.19, Q.white, Q.white, 0.01); box(-0.05, 0.05, 0.15, 0.19, 0.19, 0.196, Q.gold, Q.gold, 0.01);
      break;
    }
    case 'bait_shrimp': tray(); cyl(0, 0, 0, 0.16, 0.13, 0.24, 10, Q.blue); for (let i = 0; i < 5; i++) { const a = i * 1.3; box(Math.cos(a) * 0.07 - 0.05, Math.cos(a) * 0.07 + 0.05, 0.24, 0.29, Math.sin(a) * 0.07 - 0.02, Math.sin(a) * 0.07 + 0.02, Q.orange, Q.red, 0.02); } break;
    case 'bait_minnow': box(-0.24, 0.24, 0, 0.07, -0.17, 0.17, Q.steel, Q.steel, 0.02); for (let i = 0; i < 4; i++) { const x = -0.12 + (i % 2) * 0.2, z = -0.07 + Math.floor(i / 2) * 0.13; box(x - 0.09, x + 0.07, 0.07, 0.1, z - 0.025, z + 0.025, Q.silver, Q.white, 0.03); box(x + 0.07, x + 0.11, 0.07, 0.1, z - 0.035, z + 0.035, Q.steel, Q.steel, 0.03); } break;
    case 'bait_squid': box(-0.24, 0.24, 0, 0.2, -0.17, 0.17, Q.white, Q.white, 0.02); box(-0.25, 0.25, 0.2, 0.23, -0.02, 0.19, Q.white, Q.white, 0.02); for (let i = 0; i < 3; i++) cyl(-0.1 + i * 0.1, 0.2, -0.1, 0.035, 0.025, 0.2, 6, Q.pink, 0, Math.PI / 2); break;
    case 'bait_lure': tray(0.17, 0.11); box(-0.17, 0.17, 0, 0.4, -0.02, 0, Q.paper, Q.paper, 0.02); box(-0.12, 0.12, 0.34, 0.37, 0, 0.012, Q.red, Q.red, 0.02); for (let i = 0; i < 3; i++) cyl(-0.1 + i * 0.1, 0.08, 0.02, 0.012, 0.03, 0.2, 6, [Q.brass, Q.steel, Q.yellow][i]); break;
    case 'engine': {   // 舷外機：木架子上夾著一台引擎，螺旋槳朝著客人
      for (const sx of [-1, 1]) box(sx * 0.45 - 0.05, sx * 0.45 + 0.05, 0, 0.72, -0.2, -0.1, P.woodDark);
      box(-0.53, 0.53, 0.62, 0.72, -0.22, -0.08, P.wood);
      box(-0.12, 0.12, 0.58, 0.8, -0.25, -0.05, Q.dark);
      box(-0.2, 0.2, 0.78, 0.98, -0.05, 0.38, Q.dark);
      { const g = new THREE.CylinderGeometry(0.21, 0.23, 0.3, 10); g.scale(1, 1, 1.25); g.translate(0, 1.13, 0.17); k.fb.addGeometry(g, (m, n) => (n.y > 0.5 || m.y > 1.21 ? Q.white : Q.red)); }
      box(-0.09, 0.09, 0.3, 0.78, 0.05, 0.25, Q.dark); box(-0.07, 0.07, 0.13, 0.3, -0.02, 0.42, Q.dark); box(-0.02, 0.02, 0, 0.13, 0.12, 0.34, Q.dark);
      cyl(0, 0.215, 0.42, 0.04, 0.04, 0.08, 8, Q.brass, Math.PI / 2);
      for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + 0.4; bar(V(Math.cos(a) * 0.03, 0.215 + Math.sin(a) * 0.03, 0.47), V(Math.cos(a) * 0.18, 0.215 + Math.sin(a) * 0.18, 0.5), 0.08, 0.02, Q.brass); }
      break;
    }
    case 'fisher': case 'trawler': {   // 船模型：照真的船縮小，放在兩個 V 形的木托上；漁船加藍色遮陽棚、大漁船加雙層艦橋和黃黑 A 字吊架
      const T = id === 'fisher' ? 13 : 18, s = 1 / 15, draft = id === 'fisher' ? 1.0 : 1.3;
      for (const sx of [-0.28, 0.28]) box(sx * T / 13 - 0.04, sx * T / 13 + 0.04, 0, 0.08, -0.16, 0.16, P.woodDark);
      const y0 = 0.06 + draft * s * 0.8;
      if (boatGeo) k.add(boatGeo(id, P, id === 'fisher' ? P.hullBlue : P.hullRed, id === 'fisher' ? 51 : 61), 0, y0, 0, 0, s);
      const u = (v) => v * s;   // 船上的公尺 → 模型的公尺
      if (id === 'fisher') {
        const D = 0.85;
        for (const [x, z] of [[0.2, -1.45], [0.2, 1.45], [3.6, -1.45], [3.6, 1.45]]) box(u(x) - 0.006, u(x) + 0.006, y0 + u(D), y0 + u(D + 2.15), u(z) - 0.006, u(z) + 0.006, Q.white);
        for (let i = 0; i < 6; i++) box(u(0.1 + i * 0.6), u(0.1 + (i + 1) * 0.6), y0 + u(D + 2.15), y0 + u(D + 2.25), u(-1.6), u(1.6), i % 2 ? Q.white : Q.blue, i % 2 ? Q.white : Q.blue, 0.01);
      } else {
        const D = 1.05, top = D + 2.5;
        box(u(-6.0), u(-2.2), y0 + u(top + 0.1), y0 + u(top + 0.2), u(-1.8), u(1.8), Q.steel);                                   // 二樓瞭望台的地板
        for (const z of [-1.8, 1.8]) box(u(-6.0), u(-2.2), y0 + u(top + 0.9), y0 + u(top + 1.0), u(z) - 0.004, u(z) + 0.004, Q.dark);   // 護欄
        box(u(-4.2) - 0.006, u(-4.2) + 0.006, y0 + u(top + 0.2), y0 + u(top + 2.6), -0.006, 0.006, Q.white);                    // 雷達塔
        box(u(-4.2) - 0.004, u(-4.2) + 0.004, y0 + u(top + 2.5), y0 + u(top + 2.65), u(-0.9), u(0.9), Q.white);
        for (const z of [-2.2, 2.2]) bar(V(u(-7.9), y0 + u(D), u(z)), V(u(-6.6), y0 + u(D + 3.8), u(z * 0.55)), 0.016, 0.016, Q.yellow);   // A 字吊架的兩條腿
        box(u(-6.75), u(-6.45), y0 + u(D + 3.7), y0 + u(D + 3.9), u(-1.3), u(1.3), Q.black);
        for (const z of [-1.2, 1.2]) cyl(u(-6.9), y0 + u(D + 0.7), u(z), 0.012, 0.012, u(2.4), 6, Q.black);                      // 雙煙囪
      }
      break;
    }
    case 'mod_sonar': {   // 探魚聲納：深色主機＋綠螢幕＋天線
      box(-0.18, 0.18, 0, 0.04, -0.14, 0.14, Q.dark);
      box(-0.15, 0.15, 0.04, 0.28, -0.08, 0.05, Q.dark);
      box(-0.12, 0.12, 0.08, 0.24, 0.05, 0.06, Q.screen, Q.screen, 0.01);
      for (const rr of [0.03, 0.06]) torus(0, 0.16, 0.062, rr, 0.004, Q.screenDark, 0);
      cyl(0.12, 0.28, -0.02, 0.015, 0.025, 0.18, 8, Q.brass);
      for (let i = 0; i < 3; i++) cyl(-0.11 + i * 0.05, 0.04, 0.09, 0.012, 0.012, 0.02, 6, [Q.red, Q.yellow, Q.white][i]);
      break;
    }
    case 'mod_lamp': {   // 船首集魚燈：支架＋朝著客人的大探照燈頭
      box(-0.12, 0.12, 0, 0.04, -0.12, 0.12, Q.dark);
      box(-0.03, 0.03, 0.04, 0.2, -0.03, 0.03, Q.dark);
      for (const sx of [-1, 1]) box(sx * 0.13 - 0.012, sx * 0.13 + 0.012, 0.16, 0.34, -0.02, 0.02, Q.steel);
      cyl(0, 0.25, -0.1, 0.13, 0.08, 0.22, 10, Q.brass, Math.PI / 2);
      cyl(0, 0.25, 0.12, 0.12, 0.12, 0.02, 10, Q.bulb, Math.PI / 2);
      break;
    }
    case 'paint': {   // 船殼塗裝：五彩油漆桶、刷子、後面一塊色卡板
      const cols = [Q.crimson, Q.navy, Q.emerald, Q.obsidian, Q.gold];
      box(-0.36, 0.36, 0, 0.62, -0.2, -0.17, P.woodLight, P.woodDark);
      cols.forEach((c, i) => box(-0.3 + i * 0.125, -0.2 + i * 0.125, 0.36, 0.56, -0.17, -0.16, c, c, 0.01));
      cols.forEach((c, i) => { const x = -0.26 + i * 0.13, z = i % 2 ? 0.08 : -0.03; cyl(x, 0, z, 0.055, 0.055, 0.14, 8, Q.steel); cyl(x, 0.14, z, 0.05, 0.05, 0.015, 8, c); });
      bar(V(0.3, 0.02, 0.1), V(0.36, 0.26, 0.02), 0.03, 0.02, P.woodLight); box(0.33, 0.39, 0.24, 0.32, 0, 0.04, Q.dark);
      break;
    }
    case 'repair': {   // 修船工作台：紅白相間的氣動修船控制箱（儀表、拉桿、氣管捲盤）＋後面的工具掛板
      box(-0.5, 0.5, 0, 0.1, -0.26, 0.26, Q.dark);
      box(-0.46, 0.46, 0.1, 0.62, -0.24, 0.24, Q.red, Q.red);
      box(-0.46, 0.46, 0.62, 0.98, -0.24, 0.24, Q.white, Q.white);
      box(-0.48, 0.48, 0.98, 1.04, -0.26, 0.26, Q.dark);
      for (let i = 0; i < 3; i++) { cyl(-0.26 + i * 0.26, 0.8, 0.24, 0.085, 0.085, 0.03, 10, Q.white, Math.PI / 2); cyl(-0.26 + i * 0.26, 0.8, 0.27, 0.07, 0.07, 0.006, 10, i === 1 ? Q.yellow : Q.paper, Math.PI / 2); bar(V(-0.26 + i * 0.26, 0.8, 0.28), V(-0.26 + i * 0.26 + 0.04, 0.85, 0.28), 0.012, 0.006, Q.red); }
      bar(V(0.32, 1.04, 0.05), V(0.38, 1.3, 0.12), 0.035, 0.035, Q.steel); ball(0.385, 1.32, 0.125, 0.045, Q.redDark);   // 拉桿
      for (let i = 0; i < 2; i++) cyl(-0.3 + i * 0.16, 1.04, -0.05, 0.035, 0.035, 0.05, 8, i ? Q.green : Q.red);       // 按鈕
      cyl(-0.46, 0.36, 0, 0.19, 0.19, 0.1, 12, Q.yellow, 0, Math.PI / 2); cyl(-0.57, 0.36, 0, 0.06, 0.06, 0.03, 8, Q.dark, 0, Math.PI / 2);   // 氣管捲盤
      torus(-0.52, 0.36, 0, 0.15, 0.03, Q.black, 0, 0);
      box(-0.5, 0.5, 1.2, 1.9, -0.3, -0.26, Q.cork, P.woodDark);                                                       // 工具掛板
      for (const [x, h] of [[-0.36, 0.3], [-0.2, 0.42], [-0.02, 0.26], [0.16, 0.38], [0.34, 0.3]]) { box(x - 0.02, x + 0.02, 1.36, 1.36 + h, -0.26, -0.24, Q.steel, Q.dark); box(x - 0.05, x + 0.05, 1.3 + h, 1.38 + h, -0.26, -0.24, Q.steel, Q.dark); }
      for (const sx of [-1, 1]) box(sx * 0.48 - 0.03, sx * 0.48 + 0.03, 1.04, 1.9, -0.3, -0.24, P.woodDark);
      break;
    }
    case 'title': {   // 漁會捐款箱：木座台上的紅木箱（四角金邊、頂上黑鐵投幣口、正面金色鎖頭、背後立著功德牌）
      box(-0.42, 0.42, 0, 0.72, -0.4, 0.4, P.woodDark, P.woodDark);
      box(-0.46, 0.46, 0.72, 0.8, -0.42, 0.42, P.wood, P.woodDark);
      const y = 0.8;
      box(-0.3, 0.3, y, y + 0.36, -0.2, 0.2, Q.rose, Q.rose);
      box(-0.32, 0.32, y + 0.36, y + 0.42, -0.22, 0.22, Q.roseDark, Q.roseDark);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * 0.3 - 0.025, sx * 0.3 + 0.025, y, y + 0.43, sz * 0.2 - 0.025, sz * 0.2 + 0.025, Q.gold, Q.gold, 0.02);
      for (const yy of [y + 0.02, y + 0.33]) { box(-0.31, 0.31, yy, yy + 0.03, 0.2, 0.212, Q.gold, Q.gold, 0.02); box(-0.31, 0.31, yy, yy + 0.03, -0.212, -0.2, Q.gold, Q.gold, 0.02); }
      box(-0.11, 0.11, y + 0.42, y + 0.435, -0.035, 0.035, Q.iron); box(-0.08, 0.08, y + 0.435, y + 0.44, -0.012, 0.012, Q.black, Q.black, 0.01);   // 投幣口
      box(-0.05, 0.05, y + 0.12, y + 0.22, 0.2, 0.235, Q.gold, Q.gold, 0.02); torus(0, y + 0.24, 0.218, 0.035, 0.01, Q.gold, 0);                     // 鎖頭
      box(-0.28, 0.28, y + 0.42, y + 0.92, -0.2, -0.17, Q.roseDark, Q.roseDark); box(-0.24, 0.24, y + 0.5, y + 0.86, -0.17, -0.165, Q.gold, Q.gold, 0.02);   // 功德牌
      box(-0.3, 0.3, y + 0.92, y + 0.97, -0.22, -0.15, Q.gold, Q.gold, 0.02);
      break;
    }
    case 'mailbox': {   // 漁會意見信箱：綠色的郵筒（圓筒身、紅色圓頂、黑色投信口），站在一圈石座上；筒身正面留給價格牌（tag）
      cyl(0, 0, 0, 0.3, 0.34, 0.12, 10, P.stone);
      cyl(0, 0.12, 0, 0.22, 0.24, 0.95, 12, Q.green);
      cyl(0, 0.2, 0, 0.245, 0.245, 0.05, 12, Q.greenDark); cyl(0, 0.96, 0, 0.235, 0.235, 0.05, 12, Q.greenDark);
      cyl(0, 1.07, 0, 0.27, 0.25, 0.06, 12, Q.red);
      cyl(0, 1.13, 0, 0.08, 0.26, 0.16, 12, Q.red); ball(0, 1.31, 0, 0.05, Q.gold);
      box(-0.13, 0.13, 0.78, 0.84, 0.2, 0.245, Q.black, Q.black, 0.01); box(-0.15, 0.15, 0.84, 0.87, 0.19, 0.27, Q.greenDark);                  // 投信口和上面的小雨遮
      break;
    }
    case 'altar': {   // 供桌上的東西：銅香爐（三炷香）、兩支紅燭、一盤供果
      cyl(0, 0, 0, 0.16, 0.1, 0.06, 8, Q.brass); cyl(0, 0.06, 0, 0.2, 0.15, 0.16, 8, Q.brass); cyl(0, 0.22, 0, 0.17, 0.2, 0.03, 8, Q.paper);
      for (const sx of [-1, 1]) box(sx * 0.2 - 0.02, sx * 0.2 + 0.02, 0.12, 0.2, -0.02, 0.02, Q.brass);
      for (let i = 0; i < 3; i++) { cyl(-0.05 + i * 0.05, 0.24, 0, 0.006, 0.006, 0.3, 4, Q.redDark); ball(-0.05 + i * 0.05, 0.55, 0, 0.014, Q.orange, 0); }
      for (const sx of [-1, 1]) { cyl(sx * 0.5, 0, 0, 0.06, 0.08, 0.05, 7, Q.brass); cyl(sx * 0.5, 0.05, 0, 0.035, 0.035, 0.26, 7, Q.red); ball(sx * 0.5, 0.34, 0, 0.03, Q.bulb, 0); }
      cyl(0, 0, 0.2, 0.17, 0.12, 0.04, 8, Q.white); for (let i = 0; i < 3; i++) ball(Math.cos(i * 2.1) * 0.07, 0.09, 0.2 + Math.sin(i * 2.1) * 0.07, 0.06, i ? Q.orange : Q.red, 0);
      break;
    }
    default: return null;
  }
  return k.geo();
}
