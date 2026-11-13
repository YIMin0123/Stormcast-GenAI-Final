// 坡上的小屋和大漁旗的旗桿（旗面是會飄的布，在 harbor.js 另外做成一塊網格，這裡只記位置）。
// 小屋：石砌地基＋門前的石階、木屋是一片片的魚鱗板（灰泥屋是灰泥牆＋木框）、四角木柱、屋簷下一圈橫樑；
// 屋頂有屋脊、博風板、封簷板；窗戶有窗框、十字窗櫺、窗台、兩扇百葉窗、窗下的花箱；門有門框、門上的小雨遮、門把；
// 電腦版（fd）再加門邊的燈、柴堆、水桶、盆栽、長椅。
// 亂數用自己的種子：這裡加東西不會改到島上其他東西（石頭、樹）的位置（harbor3d.js 照舊跳過原本用掉的亂數）
import * as THREE from 'three';
import { FaceBuilder, rng, SURF, withSurf } from './kit.js';
import { jitter } from './palette.js';
import * as H from './harborPlan.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = (hex, surf = 0) => withSurf(new THREE.Color(hex), surf);
const Q = {
  trim: C('#e9e1cf', SURF.wood), shutter: [C('#3f6b8f', SURF.wood), C('#4f7a4a', SURF.wood), C('#8f3b2e', SURF.wood)],
  brass: C('#c79a3a', SURF.metal), dark: C('#3a3f43', SURF.metal), soil: C('#5a3d2a'), leaf: C('#4e8a3a'),
  flower: [C('#e85d75'), C('#f2c84b'), C('#f4f1e8'), C('#b56be0')], log: C('#8a6038', SURF.wood), logEnd: C('#d8b27a', SURF.wood),
  pot: C('#b5653d'), bulb: C('#ffe2a0'), water: C('#4f8fa0'),
};

function cyl(fb, x, y, z, rt, rb, h, seg, col, r, rotX = 0, rotZ = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(0, h / 2, 0);
  if (rotX) g.rotateX(rotX);
  if (rotZ) g.rotateZ(rotZ);
  g.translate(x, y, z);
  const cs = jitter(col, r, 0.04);
  fb.addGeometry(g, (m, n) => (Math.abs(n.y) > 0.5 ? cs.clone().multiplyScalar(1.06) : cs));
}

// 小屋（照 H.HOUSES）。fb：主要網格、fd：小東西（手機不畫）；merge(fb, sub, rot, x, y, z)：把小屋自己座標蓋的東西轉過去放好
export function buildHouses({ fb, fd, P, box, obox, gableRoof, merge, harborHeight, out }) {
  const r = rng(4242);
  H.HOUSES.forEach((hs, k) => {
    const c = Math.cos(hs.rot), s = Math.sin(hs.rot), hw = hs.w / 2, hd = hs.d / 2, h = hs.h;
    const toW = (a, b) => [hs.x + a * c + b * s, hs.z - a * s + b * c];   // 小屋座標 → 港座標（跟 merge 的轉法一樣）
    const ys = [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]].map(([a, b]) => harborHeight(...toW(a, b)));
    const lo = Math.min(...ys), y0 = Math.max(...ys) + 0.35;
    const sub = new FaceBuilder(), sd = new FaceBuilder();
    const wood = k % 2 === 0, shutter = Q.shutter[k % 3];

    // 地基：石砌、上緣壓一圈石板；正面多伸出去一公尺當門廊（水桶、盆栽、長椅放在上面）
    const PORCH = 1.0, lo2 = Math.min(lo, ...[-hw, hw].map((a) => harborHeight(...toW(a, hd + PORCH + 0.1))));
    box(sub, -hw - 0.15, hw + 0.15, lo2 - y0 - 0.5, -0.06, -hd - 0.15, hd + PORCH, P.stone, P.stone, r);
    box(sub, -hw - 0.2, hw + 0.2, -0.08, 0, -hd - 0.2, hd + PORCH + 0.05, P.stone, P.stone, r, 0.03);

    // 牆：木屋是一片片橫釘的魚鱗板（深淺不一），灰泥屋是灰泥＋腰帶木條
    if (wood) {
      box(sub, -hw + 0.02, hw - 0.02, 0, h, -hd + 0.02, hd - 0.02, P.woodDark, P.woodDark, r);
      const bh = 0.22;
      for (let y = 0.02; y < h - 0.05; y += bh) {
        const col = () => (r() < 0.2 ? P.woodLight : P.wood);
        const y1 = Math.min(y + bh + 0.02, h);
        box(sub, -hw + 0.1, hw - 0.1, y, y1, hd - 0.02, hd + 0.03, col(), col(), r, 0.05);       // 正面
        box(sub, -hw + 0.1, hw - 0.1, y, y1, -hd - 0.03, -hd + 0.02, col(), col(), r, 0.05);     // 背面
        box(sub, -hw - 0.03, -hw + 0.02, y, y1, -hd + 0.1, hd - 0.1, col(), col(), r, 0.05);     // 兩側
        box(sub, hw - 0.02, hw + 0.03, y, y1, -hd + 0.1, hd - 0.1, col(), col(), r, 0.05);
      }
    } else {
      box(sub, -hw + 0.02, hw - 0.02, 0, h, -hd + 0.02, hd - 0.02, P.plaster, P.plaster, r);
      for (const y of [0, 1.0]) {   // 下緣的地檻、窗下的腰帶
        box(sub, -hw, hw, y, y + 0.14, hd - 0.02, hd + 0.04, P.woodDark, P.woodDark, r);
        box(sub, -hw, hw, y, y + 0.14, -hd - 0.04, -hd + 0.02, P.woodDark, P.woodDark, r);
        box(sub, -hw - 0.04, -hw + 0.02, y, y + 0.14, -hd, hd, P.woodDark, P.woodDark, r);
        box(sub, hw - 0.02, hw + 0.04, y, y + 0.14, -hd, hd, P.woodDark, P.woodDark, r);
      }
    }
    // 四角的木柱、屋簷下一圈橫樑
    for (const x of [-hw, hw]) for (const z of [-hd, hd]) box(sub, x - 0.1, x + 0.1, 0, h, z - 0.1, z + 0.1, P.woodDark, P.woodDark, r);
    box(sub, -hw - 0.08, hw + 0.08, h - 0.18, h, hd - 0.04, hd + 0.08, P.woodDark, P.woodDark, r);
    box(sub, -hw - 0.08, hw + 0.08, h - 0.18, h, -hd - 0.08, -hd + 0.04, P.woodDark, P.woodDark, r);

    // 屋頂：兩片斜面＋屋脊、兩端的博風板、前後的封簷板
    const rise = 1.8, over = 0.45, roof = k === 1 ? P.roofSlate : P.roofRed;
    gableRoof(sub, -hw, hw, -hd, hd, h, rise, over, roof, r);
    // 山牆的三角形：蓋在屋頂兩端（原本是屋頂的顏色）上面，用牆的顏色（兩面都畫，背面那片會被剔掉）
    {
      const gw = wood ? P.wood : P.plaster, top = h + rise - 0.08;
      for (const sx of [-1, 1]) {
        const x = sx * (hw + over + 0.012), zs = hd + over - 0.12;
        const a = V(x, h + 0.03, -zs), b = V(x, h + 0.03, zs), t = V(x, top, 0);
        const cg = jitter(gw, r, 0.03);
        sub.grain = V(0, 0, 1);   // 木紋橫的（跟牆板一樣）
        sub.tri(a, b, t, cg); sub.tri(b, a, t, cg);
        sub.grain = null;
      }
    }
    box(sub, -hw - over - 0.05, hw + over + 0.05, h + rise - 0.06, h + rise + 0.12, -0.13, 0.13, P.woodDark, P.woodDark, r);
    const run = hd + over, slope = Math.atan2(rise, run), len = Math.hypot(rise, run) + 0.1;
    for (const ex of [-hw - over - 0.03, hw + over + 0.03]) for (const sg of [-1, 1]) {
      obox(sub, ex, h + rise / 2 + 0.02, sg * run / 2, 0, 1, len, 0.06, 0.2, P.woodDark, P.woodDark, r, 0.03, 0, -sg * slope);   // 後半（sg=-1）往 +z 爬高、前半往 -z 爬高
    }
    for (const sg of [-1, 1]) box(sub, -hw - over, hw + over, h - 0.12, h + 0.04, sg * (hd + over) - 0.04, sg * (hd + over) + 0.04, P.woodDark, P.woodDark, r);
    // 煙囪：石砌、頂上一片蓋板
    box(sub, hw - 1.4, hw - 0.7, h + 0.4, h + 2.3, -0.6, 0.1, P.stone, P.stone, r);
    box(sub, hw - 1.48, hw - 0.62, h + 2.3, h + 2.42, -0.68, 0.18, P.stone, P.stone, r, 0.02);

    // 門（朝海）：門框、門板（上面一扇小窗）、門把、門上的小雨遮和兩支斜撐
    const fz = hd + (wood ? 0.03 : 0.02);
    box(sub, -0.62, 0.62, 0, 2.1, fz, fz + 0.05, Q.trim, Q.trim, r, 0.02);
    box(sub, -0.5, 0.5, 0, 1.95, fz + 0.03, fz + 0.08, P.woodDark, P.woodDark, r);
    box(sub, -0.22, 0.22, 1.35, 1.75, fz + 0.06, fz + 0.09, P.window, P.window, r, 0.01);
    for (const x of [-0.22, 0, 0.22]) box(sd, x - 0.015, x + 0.015, 0.1, 1.25, fz + 0.08, fz + 0.09, P.woodDark, P.woodDark, r, 0.02);   // 門板的直條
    box(sd, 0.32, 0.4, 0.95, 1.02, fz + 0.08, fz + 0.14, Q.brass, Q.brass, r, 0.02);
    obox(sub, 0, 2.38, fz + 0.38, 1, 0, 1.6, 0.8, 0.06, roof, P.woodDark, r, 0.03, -0.32, 0);
    for (const x of [-0.7, 0.7]) obox(sub, x, 2.12, fz + 0.2, 0, 1, 0.5, 0.06, 0.06, P.woodDark, P.woodDark, r, 0.02, 0, 0.7);

    // 窗：窗框、玻璃、十字窗櫺、突出的窗台、兩扇打開的百葉窗、窗下的花箱（花在 fd）
    const win = (wx, face) => {   // face：'front'（+z）、'left'（-x）、'right'（+x）
      const place = (x0, x1, y0w, y1, d0, d1, top, side, amt = 0.02, b = sub) => {
        if (face === 'front') box(b, wx + x0, wx + x1, y0w, y1, fz + d0, fz + d1, top, side, r, amt);
        else {
          const sx = face === 'right' ? 1 : -1, wx0 = sx * (hw + (wood ? 0.03 : 0.02));
          box(b, Math.min(wx0 + sx * d0, wx0 + sx * d1), Math.max(wx0 + sx * d0, wx0 + sx * d1), y0w, y1, wx - x1, wx - x0, top, side, r, amt);
        }
      };
      place(-0.48, 0.48, 1.0, 1.9, 0, 0.05, Q.trim, Q.trim);                 // 窗框
      place(-0.4, 0.4, 1.08, 1.82, 0.03, 0.06, P.window, P.window, 0.01);   // 玻璃
      place(-0.025, 0.025, 1.08, 1.82, 0.05, 0.08, Q.trim, Q.trim);         // 窗櫺
      place(-0.4, 0.4, 1.43, 1.48, 0.05, 0.08, Q.trim, Q.trim);
      place(-0.56, 0.56, 0.94, 1.0, 0, 0.14, Q.trim, Q.trim);               // 窗台
      for (const sx of [-1, 1]) place(sx > 0 ? 0.5 : -0.86, sx > 0 ? 0.86 : -0.5, 1.0, 1.9, 0.02, 0.06, shutter, shutter);   // 百葉窗
      for (const sx of [-1, 1]) for (let y = 1.1; y < 1.85; y += 0.12) place(sx > 0 ? 0.53 : -0.83, sx > 0 ? 0.83 : -0.53, y, y + 0.03, 0.06, 0.075, shutter, shutter, 0.03, sd);   // 百葉的橫條
      place(-0.45, 0.45, 0.72, 0.92, 0.04, 0.24, P.woodDark, P.woodDark);  // 花箱
      place(-0.42, 0.42, 0.9, 0.93, 0.06, 0.22, Q.soil, Q.soil, 0.03, sd);
      for (let i = 0; i < 6; i++) {
        const x = -0.36 + i * 0.144, col = Q.flower[Math.floor(r() * Q.flower.length)];
        place(x - 0.05, x + 0.05, 0.93, 1.02 + r() * 0.05, 0.08, 0.2, Q.leaf, Q.leaf, 0.05, sd);
        place(x - 0.035, x + 0.035, 1.0, 1.08 + r() * 0.04, 0.11, 0.17, col, col, 0.05, sd);
      }
    };
    for (const wx of [-hw + 1.1, hw - 1.1]) win(wx, 'front');
    win(0, 'left'); win(0, 'right');

    // 門前的石階：從門口一階一階下到地面（地面照實際的坡算）
    const [fx, fzw] = toW(0, hd + PORCH + 0.6), groundY = harborHeight(fx, fzw) - y0;
    const nStep = Math.max(1, Math.ceil(-groundY / 0.2));
    for (let i = 0; i < nStep; i++) {
      const top = groundY * (i + 1) / (nStep + 1);
      box(sub, -0.75 - i * 0.05, 0.75 + i * 0.05, groundY - 0.3, top, hd + PORCH, hd + PORCH + 0.3 + i * 0.3, P.stone, P.stone, r, 0.04);
    }

    // 電腦版的小東西：門邊的壁燈、牆邊的柴堆、水桶、台階旁的盆栽、門旁的長椅
    {
      const lx = 0.9, ly = 2.0;
      box(sd, lx - 0.03, lx + 0.03, ly - 0.05, ly + 0.25, fz + 0.04, fz + 0.3, Q.dark, Q.dark, r, 0.02);
      box(sd, lx - 0.1, lx + 0.1, ly - 0.32, ly - 0.06, fz + 0.2, fz + 0.4, Q.bulb, Q.dark, r, 0.01);
      box(sd, lx - 0.13, lx + 0.13, ly - 0.06, ly, fz + 0.17, fz + 0.43, Q.dark, Q.dark, r, 0.02);
    }
    const side = k % 2 ? -1 : 1, sxw = side * (hw + 0.45);
    for (let row = 0; row < 3; row++) for (let i = 0; i < 6 - row; i++) {   // 柴堆：靠著側牆疊成三層
      const z = -hd + 0.6 + i * 0.27 + row * 0.13, y = 0.13 + row * 0.24;
      cyl(sd, sxw - side * 0.3, y, z, 0.12, 0.12, 0.6, 7, Q.log, r, 0, Math.PI / 2);
    }
    {
      const [bx, bz] = toW(sxw, -hd + 1.1);
      out.solids.push({ x: bx, z: bz, r: 0.75 });
    }
    cyl(sd, -side * (hw - 0.5), 0, hd + 0.55, 0.26, 0.22, 0.55, 10, P.woodDark, r);   // 水桶
    cyl(sd, -side * (hw - 0.5), 0.5, hd + 0.55, 0.23, 0.23, 0.02, 10, Q.water, r);
    { const [wx, wz] = toW(-side * (hw - 0.5), hd + 0.55); out.solids.push({ x: wx, z: wz, r: 0.3 }); }
    for (const sx of [-1, 1]) {   // 台階兩旁的盆栽
      cyl(sd, sx * 1.05, 0, hd + 0.35, 0.16, 0.12, 0.3, 8, Q.pot, r);
      const g = new THREE.IcosahedronGeometry(0.22, 0); g.translate(sx * 1.05, 0.45, hd + 0.35);
      sd.addGeometry(g, () => jitter(Q.leaf, r, 0.08));
      const [px, pz] = toW(sx * 1.05, hd + 0.35);
      out.solids.push({ x: px, z: pz, r: 0.2 });
    }
    {   // 長椅：門和窗之間，靠著正面的牆
      const bx = side * (hw - 2.1);
      box(sd, bx - 0.6, bx + 0.6, 0.42, 0.48, hd + 0.12, hd + 0.5, P.wood, P.woodDark, r);
      for (const dx of [-0.5, 0.5]) box(sd, bx + dx - 0.04, bx + dx + 0.04, 0, 0.42, hd + 0.15, hd + 0.47, P.woodDark, P.woodDark, r);
      const [wx, wz] = toW(bx, hd + 0.32);
      out.solids.push({ x: wx, z: wz, r: 0.55 });
    }

    merge(fb, sub, hs.rot, hs.x, y0, hs.z);
    merge(fd, sd, hs.rot, hs.x, y0, hs.z);
    // 走得上去的門廊和石階（港座標的矩形，見 main.js 的 walkGround）：門廊是平的，石階當成一道斜坡
    {
      const z0 = hd + 0.15, z1 = hd + PORCH + 0.05, sz1 = hd + PORCH + 0.3 + (nStep - 1) * 0.3;
      const [pcx, pcz] = toW(0, (z0 + z1) / 2), [scx, scz] = toW(0, (z1 + sz1) / 2);
      out.porches.push({ cx: pcx, cz: pcz, ux: c, uz: -s, hl: hw + 0.2, hw: (z1 - z0) / 2, y0, y1: y0 });
      out.porches.push({ cx: scx, cz: scz, ux: c, uz: -s, hl: 0.8, hw: (sz1 - z1) / 2, y0, y1: y0 + groundY });
    }
    out.camBoxes.push({ cx: hs.x, cy: y0 + (h + 1.8) / 2, cz: hs.z, w: hs.w + 0.9, h: h + 1.8, d: hs.d + 0.9, rot: hs.rot });
  });
}

// 大漁旗的旗桿（白桿、金色的頂）；旗面的位置記在 out.flags（harbor.js 做成會飄的布）
export function buildFlagPoles({ fb, P, box, harborHeight, out }) {
  const r = rng(5151);
  out.flags = [];
  H.FLAGS.forEach((f, i) => {
    const y0 = harborHeight(f.x, f.z) - 0.2;
    box(fb, f.x - 0.08, f.x + 0.08, y0, y0 + f.h, f.z - 0.08, f.z + 0.08, P.white, P.white, r);
    box(fb, f.x - 0.14, f.x + 0.14, y0 + f.h, y0 + f.h + 0.25, f.z - 0.14, f.z + 0.14, P.yellow, P.yellow, r);
    box(fb, f.x - 0.2, f.x + 0.2, y0 - 0.1, y0 + 0.35, f.z - 0.2, f.z + 0.2, P.stone, P.stone, r);   // 桿腳的石墩
    out.solids.push({ x: f.x, z: f.z, r: 0.22 });
    out.flags.push({ x: f.x, z: f.z, top: y0 + f.h - 0.1, w: 2.9, h: 1.9, col: [P.flagRed, P.yellow, P.flagRed][i], stripe: P.flagBlue, seed: i * 1.7 });
  });
}
