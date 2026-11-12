// 寫實版的闊葉樹，以及地面的細節貼圖（草葉、沙粒、岩石裂紋）。
// 貼圖全部在開遊戲時用程式畫出來，不讀任何圖檔。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { REFL } from './toon.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
const wrap = (i, n) => ((i % n) + n) % n;
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ---- 可以無縫拼接的雜訊：x、y 的範圍是 [0, px)、[0, py)，超出去會接回來 ----
function pnoise(x, y, px, py, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (a, b) => hash2(wrap(ix + a, px), wrap(iy + b, py), seed);
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * sx, bot = at(0, 1) + (at(1, 1) - at(0, 1)) * sx;
  return top + (bot - top) * sy;
}
function pfbm(x, y, px, py, seed, oct) {
  let v = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) { v += a * pnoise(x, y, px, py, seed + o * 17); n += a; a *= 0.5; x *= 2; y *= 2; px *= 2; py *= 2; }
  return v / n;
}
// 細胞紋（可拼接）：回傳 [最近的距離, 第二近的距離, 那一格的亂數]
function pworley(x, y, G, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, wx = wrap(cx, G), wy = wrap(cy, G);
      const d = Math.hypot(cx + hash2(wx, wy, seed) - x, cy + hash2(wx, wy, seed + 1) - y);
      if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, seed + 2); } else if (d < f2) f2 = d;
    }
  }
  return [f1, f2, id];
}

// 高度圖的斜率（左右、上下各一個值，-1 到 1），打光時用來做出凹凸
function slopes(hgt, W, H, k) {
  const gx = new Float32Array(W * H), gy = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      gx[i] = Math.max(-1, Math.min(1, (hgt[y * W + wrap(x + 1, W)] - hgt[y * W + wrap(x - 1, W)]) * 0.5 * k));
      gy[i] = Math.max(-1, Math.min(1, (hgt[wrap(y + 1, H) * W + x] - hgt[wrap(y - 1, H) * W + x]) * 0.5 * k));
    }
  }
  return [gx, gy];
}
function dataTex(data, W, H, srgb) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ============================================================ 葉片貼圖
// 四格，每格是一小枝長滿葉子的細枝（枝的根部在格子底邊中央）。葉子以外是透明的
function leafTexture() {
  const S = 1024, C = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const r = rng(4242);
  const leaf = (x, y, ang, len, wid, lum) => {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    const hue = 92 + 14 * r(), sat = 56 + 8 * r(), lit = (r() < 0.5 ? 38 : 33) * lum;
    g.fillStyle = `hsl(${hue},${sat}%,${lit}%)`;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(len * 0.25, -wid, len * 0.7, -wid * 0.85, len, 0);
    g.bezierCurveTo(len * 0.7, wid * 0.85, len * 0.25, wid, 0, 0);
    g.fill();
    // 沿著葉脈對折的感覺：一半亮、一半暗一階，中間一條淺色的葉脈
    g.fillStyle = 'rgba(8,48,6,0.24)';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(len, 0);
    g.bezierCurveTo(len * 0.7, wid * 0.85, len * 0.25, wid, 0, 0);
    g.fill();
    g.strokeStyle = `hsla(${hue - 6},${sat}%,${lit + 11}%,0.8)`;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(len * 0.06, 0);
    g.lineTo(len * 0.9, 0);
    g.stroke();
    g.restore();
  };
  // 一根細枝：一路往前長，兩側長葉子，偶爾分叉
  const twig = (x0, y0, ang, len, depth, lum) => {
    const step = 24, steps = Math.max(2, Math.round(len / step)), pts = [], kids = [];
    let x = x0, y = y0, a = ang;
    for (let i = 0; i <= steps; i++) {
      pts.push([x, y, a]);
      a += (r() - 0.5) * 0.24;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      if (depth < 2 && i > 2 && i < steps - 2 && r() < 0.2) kids.push([x, y, a + (r() < 0.5 ? -1 : 1) * (0.5 + 0.5 * r()), 50 + 70 * r() * (1 - i / steps)]);
    }
    g.strokeStyle = `rgb(${Math.round(62 * lum)},${Math.round(48 * lum)},${Math.round(34 * lum)})`;
    g.lineWidth = 3.5 - depth;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.stroke();
    for (const k of kids) twig(k[0], k[1], k[2], k[3], depth + 1, lum);
    for (let i = 2; i <= steps; i++) {
      const p = pts[i], taper = 1 - 0.35 * (i / steps);
      for (const side of [-1, 1]) leaf(p[0], p[1], p[2] + side * (0.6 + 0.6 * r()), (52 + 22 * r()) * taper, (20 + 6 * r()) * taper, lum);
    }
    const e = pts[steps];
    leaf(e[0], e[1], e[2], 62, 22, lum);
  };
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * C, oy = (cell >> 1) * C, bx = ox + C / 2, by = oy + C - 6;
    g.save();
    g.beginPath();
    g.rect(ox + 3, oy + 3, C - 6, C - 6);
    g.clip();
    // 後面一層顏色深、前面一層顏色亮，看起來才有厚度
    const fan = (angles, lum) => {
      for (const t of angles) {
        const th = t + (r() - 0.5) * 0.14;
        const len = Math.min((C - 70) / Math.cos(th), (C / 2 - 50) / Math.max(Math.abs(Math.sin(th)), 0.05)) * (0.86 + 0.14 * r());
        twig(bx, by, -Math.PI / 2 + th, len, 0, lum);
      }
    };
    fan([-1.0, -0.5, 0.05, 0.55, 1.0], 0.72);
    fan([-0.75, -0.25, 0.28, 0.78], 1.0);
    g.restore();
  }
  return cardAtlas(g, S, [70, 135, 48]);
}

// 把畫好的葉叢圖做成貼圖。fill：透明的地方填什麼顏色（縮小貼圖時邊緣才不會滲出黑邊）
function cardAtlas(g, S, fill) {
  const src = g.getImageData(0, 0, S, S).data, data = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    if (a < 24) { data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; } else { data[i] = src[i]; data[i + 1] = src[i + 1]; data[i + 2] = src[i + 2]; }
    data[i + 3] = a;
  }
  // 自己做縮小版：每縮一級就把透明度調回來，遠看葉子才不會越來越稀
  const CUT = 128, cover = (d, k) => { let c = 0; for (let i = 3; i < d.length; i += 4) if (d[i] * k >= CUT) c++; return c / (d.length / 4); };
  const want = cover(data, 1), mips = [{ data, width: S, height: S }];
  let cur = data, w = S;
  while (w > 1) {
    const nw = w >> 1, dst = new Uint8Array(nw * nw * 4);
    for (let y = 0; y < nw; y++) {
      for (let x = 0; x < nw; x++) {
        const o = (y * nw + x) * 4, a = (y * 2 * w + x * 2) * 4, b = a + 4, c = a + w * 4, d = c + 4;
        for (let k = 0; k < 4; k++) dst[o + k] = (cur[a + k] + cur[b + k] + cur[c + k] + cur[d + k] + 2) >> 2;
      }
    }
    let lo = 0.5, hi = 6;
    for (let it = 0; it < 12; it++) { const k = (lo + hi) / 2; if (cover(dst, k) < want) lo = k; else hi = k; }
    const k = (lo + hi) / 2;
    for (let i = 3; i < dst.length; i += 4) dst[i] = Math.min(255, dst[i] * k);
    mips.push({ data: dst, width: nw, height: nw });
    cur = dst;
    w = nw;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.mipmaps = mips;
  t.generateMipmaps = false;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ============================================================ 椰子葉貼圖
// 八格（四欄兩列），每格是一片羽毛狀的椰子葉（葉柄在格子底邊中央，往上長）：中間一根葉軸，兩側密密地排著細長、尖尖的小葉，
// 斜斜地朝葉尖的方向長；靠葉柄的短，三分之一處最長，到葉尖收成一撮。底下一層深色、上面一層亮色，看起來才有厚度。
// 小葉之間有縫，葉子以外是透明的
function frondTexture() {
  const S = 1024, CW = S / 4, CH = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const r = rng(555);
  // 一片小葉：根部在葉軸上，往外越來越細，尾端微微往葉柄那邊垂
  const blade = (x, y, ang, len, wid, lum) => {
    const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len + len * 0.10;   // 尾端往下垂一點
    const mx = x + Math.cos(ang) * len * 0.5, my = y + Math.sin(ang) * len * 0.5 - len * 0.03;
    const nx = -Math.sin(ang) * wid * 0.5, ny = Math.cos(ang) * wid * 0.5;
    const gr = g.createLinearGradient(x, y, ex, ey), h = 84 + 10 * r(), l = 37 + 6 * r();
    gr.addColorStop(0, `hsl(${h},62%,${l * lum}%)`);              // 靠葉軸：亮黃綠
    gr.addColorStop(0.45, `hsl(${h + 18},58%,${(l - 7) * lum}%)`);
    gr.addColorStop(1, `hsl(${h + 34},55%,${(l - 15) * lum}%)`);  // 葉尖：深綠
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x - nx, y - ny);
    g.quadraticCurveTo(mx - nx * 0.8, my - ny * 0.8, ex, ey);
    g.quadraticCurveTo(mx + nx * 0.8, my + ny * 0.8, x + nx, y + ny);
    g.closePath();
    g.fill();
  };
  for (let cell = 0; cell < 8; cell++) {
    const ox = (cell % 4) * CW, oy = (cell >> 2) * CH, bx = ox + CW / 2, by = oy + CH - 4;
    g.save();
    g.beginPath();
    g.rect(ox + 2, oy + 2, CW - 4, CH - 4);
    g.clip();
    const H = CH - 20, n = 46, bow = (r() - 0.5) * 0.09 * CW, maxR = CW / 2 - 10;
    const rib = (t) => [bx + bow * Math.sin(t * 2.4), by - H * t];
    for (const pass of [0, 1]) {
      for (let i = 2; i <= n; i++) {
        const t = (i + (pass ? 0 : 0.5)) / n, q = rib(Math.min(t, 1));
        // 小葉往外伸多遠：靠葉柄短，很快變長，再慢慢收到葉尖
        const reach = maxR * Math.pow(Math.min(1, (t + 0.02) / 0.2), 0.8) * (1 - 0.74 * Math.pow(t, 2.3));
        const th = 1.18 - 0.62 * t;   // 跟葉軸的夾角：越靠葉尖越往前收
        for (const sd of [-1, 1]) {
          const a = th + (r() - 0.5) * 0.12, k = r() < 0.07 ? 0.55 : 0.86 + 0.2 * r();   // 偶爾有一片短的、斷的
          blade(q[0], q[1], -Math.PI / 2 + sd * a, Math.min(reach * k / Math.sin(a), reach * 1.5) * (pass ? 1 : 1.06), (pass ? 9.5 : 11) * (1 - 0.45 * t), pass ? 1 : 0.6);
        }
      }
    }
    // 葉尖一撮
    const e = rib(1);
    for (const a of [-0.3, 0, 0.3]) blade(e[0], e[1], -Math.PI / 2 + a, 26, 6, 1);
    // 葉軸：黃綠色，越往葉尖越細
    for (let i = 0; i < n; i++) {
      const a = rib(i / n), b = rib((i + 1) / n);
      g.strokeStyle = 'hsl(74,52%,47%)';
      g.lineWidth = 6.5 - 4.5 * (i / n);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
    g.restore();
  }
  return cardAtlas(g, S, [70, 128, 44]);
}

// ============================================================ 針葉貼圖
// 四格，每格是一根杉樹的枝（根部在格子底邊中央，往上長）：中間一根枝條，兩側排滿斜向前的小枝，
// 小枝上密密地長著短針葉；靠根部的小枝短，三分之一處最長，往枝尖收成尖的。葉子以外是透明的
function needleTexture() {
  const S = 1024, C = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const r = rng(977);
  g.lineCap = 'round';
  // 一根小枝：沿途兩側長針葉，末梢是今年新長的，顏色亮一點
  const sprig = (x, y, ang, len, lum, wid) => {
    const step = 6.5, n = Math.max(2, Math.round(len / step));
    let a = ang;
    for (let i = 0; i <= n; i++) {
      const t = i / n, nl = (15 + 6 * r()) * (1 - 0.4 * t) * wid, young = t > 0.7 ? 1.28 : 1;
      for (const sd of [-1, 1]) {
        const na = a + sd * (0.6 + 0.32 * r());
        g.strokeStyle = `hsl(${146 + 12 * r()},${40 + 10 * r()}%,${(23 + 9 * r()) * lum * young}%)`;
        g.lineWidth = 3.4 * wid;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(na) * nl, y + Math.sin(na) * nl);
        g.stroke();
      }
      a += (r() - 0.5) * 0.07;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
    }
  };
  const bough = (bx, by, H, halfW, lum, wid, shift) => {
    const step = 15, n = Math.round(H / step), pts = [];
    let x = bx, y = by, a = -Math.PI / 2 + (r() - 0.5) * 0.05;
    for (let i = 0; i <= n; i++) {
      pts.push([x, y, a]);
      a += (r() - 0.5) * 0.035;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
    }
    g.strokeStyle = `hsl(28,30%,${17 * lum}%)`;
    g.lineWidth = 6;
    g.beginPath();
    pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
    g.stroke();
    for (let i = 0; i <= n; i++) {
      const sN = (i + shift) / n, q = pts[i];
      const shape = Math.min(1, sN / 0.17) * Math.pow(Math.max(1 - sN, 0), 0.72);
      const th = 1.08 - 0.5 * sN;   // 小枝跟主枝的夾角：越靠枝尖越往前收
      for (const sd of [-1, 1]) sprig(q[0], q[1], q[2] + sd * (th + (r() - 0.5) * 0.14), halfW * shape * (0.86 + 0.26 * r()), lum, wid);
    }
    const e = pts[n];
    sprig(e[0], e[1], e[2], 34, lum, wid);
  };
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * C, oy = (cell >> 1) * C, bx = ox + C / 2, by = oy + C - 6;
    g.save();
    g.beginPath();
    g.rect(ox + 3, oy + 3, C - 6, C - 6);
    g.clip();
    // 底下一層顏色深、粗一點把縫補滿，上面一層是亮的
    bough(bx, by, C - 40, 232, 0.66, 1.3, 0.5);
    bough(bx, by, C - 46, 224, 1.0, 1.0, 0);
    g.restore();
  }
  return cardAtlas(g, S, [40, 104, 72]);
}

// ============================================================ 樹皮貼圖（顏色＋凹凸）
function barkTextures() {
  const W = 256, H = 512, hgt = new Float32Array(W * H), col = new Uint8Array(W * H * 4), nrm = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H, i = y * W + x;
      const U = u + (pnoise(u * 4, v * 6, 4, 6, 11) - 0.5) * 0.08;
      const n = pfbm(U * 9, v * 3, 9, 3, 23, 3);
      const plate = smooth(0.0, 0.2, Math.abs(2 * n - 1));                 // 直向的溝紋
      const fine = pnoise(u * 48, v * 96, 48, 96, 5);
      hgt[i] = smooth(0.35, 0.5, plate) * (0.9 + 0.1 * fine);
      const tone = 0.95 + 0.1 * pnoise(u * 3, v * 4, 3, 4, 41);
      const lichen = 0;
      const k = hgt[i];
      col[i * 4] = (74 + 72 * k) * tone * (1 - lichen) + 128 * lichen;
      col[i * 4 + 1] = (50 + 54 * k) * tone * (1 - lichen) + 134 * lichen;
      col[i * 4 + 2] = (38 + 36 * k) * tone * (1 - lichen) + 106 * lichen;
      col[i * 4 + 3] = 255;
    }
  }
  const [gx, gy] = slopes(hgt, W, H, 5);
  for (let i = 0; i < W * H; i++) {
    const l = Math.hypot(gx[i], gy[i], 1);
    nrm[i * 4] = 127.5 - 127.5 * gx[i] / l;
    nrm[i * 4 + 1] = 127.5 - 127.5 * gy[i] / l;
    nrm[i * 4 + 2] = 127.5 + 127.5 / l;
    nrm[i * 4 + 3] = 255;
  }
  return { map: dataTex(col, W, H, true), normalMap: dataTex(nrm, W, H, false) };
}

// ============================================================ 地面的細節貼圖
// detail：紅 = 草、綠 = 沙、藍 = 岩石，各是一張深淺圖（平均約 0.5）
// normal：紅綠 = 草的凹凸、藍與透明度 = 岩石的凹凸
export function makeGroundDetail() {
  const S = 512, n = S * S;
  // ---- 草：幾千根倒向四面八方的草葉，亮的蓋在暗的上面 ----
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d'), r = rng(5);
  g.fillStyle = '#1b1b1b';
  g.fillRect(0, 0, S, S);
  const blades = Array.from({ length: 7500 }, () => ({ x: r() * S, y: r() * S, a: r() * 6.2832, len: 12 + 26 * r(), bend: (r() - 0.5) * 0.9, v: 0.22 + 0.78 * Math.pow(r(), 0.85) }));
  blades.sort((a, b) => a.v - b.v);
  for (const b of blades) {
    const dx = Math.cos(b.a), dy = Math.sin(b.a), px = -dy, py = dx, w = 1.5;
    const c = Math.round(b.v * 255);
    g.fillStyle = `rgb(${c},${c},${c})`;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const x = b.x + ox, y = b.y + oy;
        if (x < -45 || x > S + 45 || y < -45 || y > S + 45) continue;
        const mx = x + dx * b.len * 0.5 + px * b.bend * b.len * 0.3, my = y + dy * b.len * 0.5 + py * b.bend * b.len * 0.3;
        const ex = x + dx * b.len + px * b.bend * b.len * 0.5, ey = y + dy * b.len + py * b.bend * b.len * 0.5;
        g.beginPath();
        g.moveTo(x - px * w, y - py * w);
        g.quadraticCurveTo(mx - px * w * 0.7, my - py * w * 0.7, ex, ey);
        g.quadraticCurveTo(mx + px * w * 0.7, my + py * w * 0.7, x + px * w, y + py * w);
        g.closePath();
        g.fill();
      }
    }
  }
  const gimg = g.getImageData(0, 0, S, S).data;
  const grass = new Float32Array(n), sand = new Float32Array(n), rock = new Float32Array(n);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x, u = x / S, v = y / S;
      grass[i] = (gimg[i * 4] / 255) * (0.8 + 0.4 * pnoise(u * 6, v * 6, 6, 6, 3));
      // ---- 沙：細顆粒、淡淡的風紋、零星的小石子與貝殼屑 ----
      const ripple = Math.sin(6.2832 * (v * 11 + 0.55 * pnoise(u * 5, v * 5, 5, 5, 8)));
      let s = 0.5 + 0.34 * (pnoise(u * 256, v * 256, 256, 256, 1) - 0.5) + 0.22 * (pnoise(u * 90, v * 90, 90, 90, 2) - 0.5) + 0.05 * ripple;
      const speck = pnoise(u * 140, v * 140, 140, 140, 6);
      s = s + (0.1 - s) * smooth(0.83, 0.88, speck) + (0.97 - s) * smooth(0.14, 0.10, speck);
      sand[i] = s;
      // ---- 岩石：大塊的裂紋、小裂紋、表面粗糙的顆粒 ----
      const [f1, f2, id] = pworley(u * 7, v * 7, 7, 3), [g1, g2] = pworley(u * 19, v * 19, 19, 9);
      rock[i] = smooth(0.0, 0.10, f2 - f1) * (0.45 + 0.55 * id) * (0.62 + 0.38 * smooth(0.0, 0.13, g2 - g1)) * (0.7 + 0.6 * pfbm(u * 16, v * 16, 16, 16, 4, 4));
    }
  }
  // 三張圖的平均都調到 0.5：遠看時整體顏色不變
  for (const a of [grass, sand, rock]) {
    let m = 0;
    for (let i = 0; i < n; i++) m += a[i];
    const k = 0.5 / (m / n);
    for (let i = 0; i < n; i++) a[i] = Math.min(1, a[i] * k);
  }
  const [ggx, ggy] = slopes(grass, S, S, 2.6), [rgx, rgy] = slopes(rock, S, S, 6);
  const det = new Uint8Array(n * 4), nrm = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    det[i * 4] = grass[i] * 255; det[i * 4 + 1] = clamp01(sand[i]) * 255; det[i * 4 + 2] = rock[i] * 255; det[i * 4 + 3] = 255;
    nrm[i * 4] = 127.5 + 127.5 * ggx[i]; nrm[i * 4 + 1] = 127.5 + 127.5 * ggy[i]; nrm[i * 4 + 2] = 127.5 + 127.5 * rgx[i]; nrm[i * 4 + 3] = 127.5 + 127.5 * rgy[i];
  }
  return { detail: dataTex(det, S, S, false), normal: dataTex(nrm, S, S, false) };
}

// ============================================================ 隨風搖擺
// 全部在顯示卡上算：整棵樹順著風彎（越高彎越多）、枝條各自來回晃、葉片再細細地抖。
// 樹幹、枝條、葉子用同一條公式，葉叢才不會跟枝條分家；影子也用同一條公式，會跟著動。
// t：一直往前走的時間（風大走得快）；amp：風有多大；dir：風往哪個方向吹（x, z）
export const WIND = { t: { value: 0 }, amp: { value: 0.5 }, dir: { value: new THREE.Vector2(0, 1) } };
const SWAY = /* glsl */ `
uniform float uWindT;
uniform float uWindAmp;
uniform vec2 uWindDir;
vec3 swayTree(vec3 p, vec2 tex) {
  #ifdef USE_INSTANCING
    vec3 base = instanceMatrix[3].xyz;
    vec3 lw = normalize(vec3(uWindDir.x, 0.0, uWindDir.y) * mat3(instanceMatrix));   // 風向換算到這棵樹自己的座標
  #else
    vec3 base = vec3(0.0);
    vec3 lw = vec3(uWindDir.x, 0.0, uWindDir.y);
  #endif
  float ph = base.x * 0.37 + base.z * 0.23;                                          // 每棵樹的節奏錯開
  // 陣風：一波一波順著風向掃過去
  float gust = 0.55 + 0.45 * sin(uWindT * 0.5 - dot(base.xz, uWindDir) * 0.05) * (0.6 + 0.4 * sin(uWindT * 0.21 + ph));
  float a = uWindAmp * gust;
  float hgt = max(p.y, 0.0), rad = length(p.xz);
  vec3 side = vec3(-lw.z, 0.0, lw.x);
  vec3 d = lw * hgt * hgt * a * (0.020 + 0.012 * sin(uWindT * 1.3 + ph));
  d += (lw * 0.7 + vec3(0.0, 0.35, 0.0)) * rad * a * 0.034 * sin(uWindT * 2.1 + ph + dot(p, vec3(3.1, 1.3, 2.7)));
  d += side * rad * a * 0.020 * sin(uWindT * 1.7 + ph * 1.3 + dot(p, vec3(2.3, 1.9, 3.3)));
  #ifdef LEAF_FLUTTER
    float tip = 1.0 - fract(tex.y * 2.0);                                            // 葉叢的根部不動，越往尾端抖越大
    d += (vec3(0.0, 0.65, 0.0) + side * 0.5) * tip * a * 0.013 * sin(uWindT * 5.3 + ph + dot(p, vec3(31.0, 17.0, 23.0)));
  #endif
  #ifdef SWAY_GAIN
    d *= SWAY_GAIN;   // 草叢很矮，照樹的算法幾乎不動，放大幾倍
  #endif
  return p + d;
}
`;
function sway(mat, flutter, extra) {
  if (flutter) mat.defines = { ...(mat.defines || {}), LEAF_FLUTTER: '' };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWindT = WIND.t;
    sh.uniforms.uWindAmp = WIND.amp;
    sh.uniforms.uWindDir = WIND.dir;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + SWAY)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed = swayTree( transformed, uv );');
    if (extra) extra(sh);
  };
  return mat;
}
// 鏡頭鑽進樹裡、或樹擋在鏡頭和人之間時，擋住視線的那一段枝葉要散開，不然整個畫面被一片放大的葉子塞滿、人也看不到。
// 範圍是「從鏡頭到人」這條線周圍一圈（uSightR：多近全部散開、多遠完全不動）。
// 散開的方式是一團一團地消失（用葉子在世界裡的位置決定哪一團先消失），邊緣像被撥開的枝葉，不是整齊的圓洞或網點。
// main.js 每幀更新；畫水面倒影時不套
export const SIGHT = { p: { value: new THREE.Vector3() }, r: { value: new THREE.Vector2(0, 0) } };
function sightCut(sh) {
  sh.uniforms.uSightP = SIGHT.p;
  sh.uniforms.uSightR = SIGHT.r;
  sh.uniforms.uReflPass = REFL;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uSightP;\nuniform vec2 uSightR;\nuniform float uReflPass;')
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
	if ( uSightR.y > 0.0 && uReflPass < 0.5 ) {
		vec3 sp = - vViewPosition;
		float sraw = dot( sp, uSightP ) / max( dot( uSightP, uSightP ), 1e-4 );
		float sd = length( sp - uSightP * clamp( sraw, 0.0, 1.0 ) );
		float sfade = ( 1.0 - smoothstep( uSightR.x, uSightR.y, sd ) ) * ( 1.0 - smoothstep( 0.86, 1.0, sraw ) );   // 人後面的枝葉不動
		if ( sfade > 0.0 ) {
			vec3 sw = ( cameraPosition + sp * mat3( viewMatrix ) ) * 2.1;
			float sn = sin( sw.x + 1.7 * sin( sw.y * 0.83 ) ) * sin( sw.y * 1.17 + 1.7 * sin( sw.z * 0.91 ) ) * sin( sw.z * 1.07 + 1.7 * sin( sw.x * 0.87 ) );
			if ( sn * 0.5 + 0.5 < sfade * 1.25 - 0.12 ) discard;
		}
	}`);
}
// 畫影子時用的材質：位移要跟畫面上的一樣
// 葉叢和樹冠的影子上開一些洞，陽光從洞裡漏下來，樹下就有一塊一塊會晃動的光斑。
// 洞的位置用「垂直於陽光方向」的座標決定，同一道光線穿過的每一層葉子洞都對得上
function dapple(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vDapple;')
    .replace('#include <project_vertex>', `#include <project_vertex>
	vec4 dpW = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		dpW = instanceMatrix * dpW;
	#endif
	dpW = modelMatrix * dpW;
	vDapple = vec2( dot( dpW.xyz, vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] ) ), dot( dpW.xyz, vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] ) ) );`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vDapple;\nuniform float uWindT;')
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
	vec2 dq = vDapple * 3.0;
	float dp = sin( dq.x + 1.3 * sin( dq.y * 0.83 + uWindT * 0.55 ) ) * sin( dq.y * 1.17 + 1.3 * sin( dq.x * 0.71 - uWindT * 0.4 ) );
	if ( dp > 0.40 ) discard;`);
}
export function swayDepth(mat) {
  const d = mat.defines || {};
  if (!mat.userData.depth) {
    const dm = sway(new THREE.MeshDepthMaterial(mat.userData.cutout ? { map: mat.map, alphaTest: 0.5 } : {}), 'LEAF_FLUTTER' in d, mat.userData.dapple ? dapple : undefined);
    if (d.SWAY_GAIN) dm.defines = { ...(dm.defines || {}), SWAY_GAIN: d.SWAY_GAIN };
    mat.userData.depth = dm;
  }
  return mat.userData.depth;
}

// ============================================================ 材質
let mats = null;
export function foliageMaterials() {
  if (mats) return mats;
  const leafMat = (map, extra, key) => {
    const m = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true });
    m.userData.noReceive = true;
    m.customProgramCacheKey = () => key;   // 幾種葉子的設定一模一樣，不各自取名的話會共用同一支著色器（後面各自加的那幾行就沒作用了）
    return sway(m, true, (sh) => {
      sightCut(sh);
      sh.fragmentShader = sh.fragmentShader
        // 葉叢的法線是「從樹冠中心往外」，正反兩面都用同一個方向打光，整團樹冠的明暗才連貫
        .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\n\tvec3 normal = normalize( vNormal );\n\tvec3 nonPerturbedNormal = normal;')
        // 逆光看過去，陽光透過葉片，葉子會透出黃綠色
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
	#if NUM_DIR_LIGHTS > 0
		float thru = pow( saturate( dot( normalize( - vViewPosition ), directionalLights[ 0 ].direction ) ), 3.0 );
		reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[ 0 ].color * vec3( 1.0, 0.95, 0.4 ) * smoothstep( 0.25, 0.32, thru ) * 0.14;
	#endif`);
      if (extra) extra(sh);
    });
  };
  // 闊葉樹的葉片：從葉縫看到葉團另一側的葉子、或從樹下往上看到上層的葉子，要暗下來，樹冠才有裡外之分
  const leaf = leafMat(leafTexture(), (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
      'outgoingLight *= mix( 0.6, 1.0, smoothstep( -0.35, 0.1, dot( normalize( vViewPosition ), normal ) ) );\n\t#include <opaque_fragment>');
  }, 'leaf');
  // 針葉樹的枝：從樹下往上看、或從枝縫看到樹另一側的枝，看到的是枝的背面，要暗下來，樹才有裡外之分
  const needle = leafMat(needleTexture(), (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
      'outgoingLight *= mix( 0.5, 1.0, smoothstep( -0.3, 0.12, dot( normalize( vViewPosition ), normal ) ) );\n\t#include <opaque_fragment>');
  }, 'needle');
  const barkTex = barkTextures();
  const bark = sway(new THREE.MeshLambertMaterial({ ...barkTex, vertexColors: true }), false);
  bark.normalScale.set(0.35, 0.35);
  // 樹冠裡的枝條：鏡頭和人之間的那一段跟葉子一起挖開，不然葉子挖開了、人還是被一堆枝條擋住
  const twig = sway(new THREE.MeshLambertMaterial({ ...barkTex, vertexColors: true }), false, sightCut);
  twig.normalScale.set(0.35, 0.35);
  twig.customProgramCacheKey = () => 'twig';   // 設定跟樹幹一模一樣，不另外取名的話會直接沿用樹幹那支（沒有挖開功能的）著色器
  // 簡化版樹冠裡墊的那一團：代表裡層的葉子，不接影子（不然整團會被自己外層的葉叢遮黑）
  const crown = sway(new THREE.MeshLambertMaterial({ vertexColors: true }), false, (sh) => {
    sightCut(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
	#if NUM_DIR_LIGHTS > 0
		float thru = pow( saturate( dot( normalize( - vViewPosition ), directionalLights[ 0 ].direction ) ), 3.0 );
		reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[ 0 ].color * vec3( 1.0, 0.95, 0.4 ) * smoothstep( 0.25, 0.32, thru ) * 0.14;
	#endif`);
  });
  crown.defines = { LEAF_TONE: '' };   // 跟葉片用同一套明暗配色
  crown.userData.noReceive = true;
  leaf.userData.dapple = needle.userData.dapple = crown.userData.dapple = true;   // 影子上開洞，樹下才有光斑
  // 椰子樹的葉子：從樹下往上看到的是葉子的背面，暗一點。影子照著葉子的形狀（一片片羽毛狀），不另外開洞
  const frond = leafMat(frondTexture(), (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
      'outgoingLight *= mix( 0.62, 1.0, smoothstep( -0.3, 0.12, dot( normalize( vViewPosition ), normal ) ) );\n\t#include <opaque_fragment>');
  }, 'frond');
  frond.userData.cutout = true;
  // 灌木上的小花：平塗的花瓣，兩面都看得到，跟著枝葉一起搖
  const petal = sway(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), false, sightCut);
  petal.userData.noReceive = true;
  petal.customProgramCacheKey = () => 'petal';
  // 草叢的草葉：正反兩面用同一個方向打光（不然背對鏡頭的那一半是黑的），逆光時透出一點黃綠色；擺動的幅度比樹大
  const blade = sway(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), false, (sh) => {
    sightCut(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\n\tvec3 normal = normalize( vNormal );\n\tvec3 nonPerturbedNormal = normal;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
	#if NUM_DIR_LIGHTS > 0
		float thru = pow( saturate( dot( normalize( - vViewPosition ), directionalLights[ 0 ].direction ) ), 3.0 );
		reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[ 0 ].color * vec3( 1.0, 0.95, 0.5 ) * smoothstep( 0.25, 0.32, thru ) * 0.16;
	#endif`);
  });
  blade.defines = { SWAY_GAIN: '9.0' };
  blade.customProgramCacheKey = () => 'blade';
  mats = { leaf, needle, bark, twig, crown, frond, petal, blade };
  return mats;
}

// ============================================================ 闊葉樹
// 一棵樹高約 1（放進場景時再放大成 6～11 公尺）。回傳幾塊不同材質的模型：樹幹枝條、葉叢、（簡化版）樹冠裡的深色團塊
const CENTER = [0, 0.72, 0];   // 樹冠的中心
const VK = 5.5;                // 樹皮貼圖沿著枝幹每單位長度重複幾次
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function realBroadleaf(seed, lo) {
  const r = rng(seed);
  const B = { pos: [], nrm: [], uv: [], col: [], idx: [] }, F = { pos: [], nrm: [], uv: [], col: [], idx: [] };
  const T = { pos: [], nrm: [], uv: [], col: [], idx: [] };   // 樹冠裡的枝條（跟樹幹分開：擋住視線時會跟葉子一起挖開）
  const rnd3 = () => [r() - 0.5, r() - 0.5, r() - 0.5];
  // 越靠近樹冠裡面越暗（被外層的葉子擋住）
  const inner = (x, y, z) => clamp01(Math.hypot(x - CENTER[0], (y - CENTER[1]) * 1.2, z - CENTER[2]) / 0.46);

  // 沿著一串點拉一根管子當枝幹。點：[x, y, z, 半徑]
  const tube = (pts, sides, urep, G = B) => {
    const base = G.pos.length / 3;
    let v = r() * 3, u = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
      const t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      // 管子截面的兩個方向：沿著枝幹一路帶過去，表面才不會扭
      if (!u) u = norm(cross(Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], t));
      else { const d = u[0] * t[0] + u[1] * t[1] + u[2] * t[2]; u = norm([u[0] - t[0] * d, u[1] - t[1] * d, u[2] - t[2] * d]); }
      const w = cross(t, u);
      if (i) v += Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]) * VK;
      const k = (0.5 + 0.5 * Math.min(1, p[1] / 0.25)) * (1.0 - 0.45 * (1 - inner(p[0], p[1], p[2])) * smooth(0.4, 0.6, p[1]));
      for (let s = 0; s <= sides; s++) {
        const ang = (s / sides) * 6.2832, c = Math.cos(ang), sn = Math.sin(ang);
        const nx = u[0] * c + w[0] * sn, ny = u[1] * c + w[1] * sn, nz = u[2] * c + w[2] * sn;
        G.pos.push(p[0] + nx * p[3], p[1] + ny * p[3], p[2] + nz * p[3]);
        G.nrm.push(nx, ny, nz);
        G.uv.push((s / sides) * urep, v);
        G.col.push(k, k, k);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = base + i * (sides + 1) + s, b = a + 1, c = a + sides + 1, d = c + 1;
        G.idx.push(a, b, c, b, d, c);
      }
    }
  };
  // 長出一根枝：從 p 往 d 長 len，沿途微微彎、往上翹
  const grow = (p, d, len, r0, r1, segs, lift, wob) => {
    const pts = [[p[0], p[1], p[2], r0]], dirs = [d];
    let dir = d, q = p;
    for (let i = 1; i <= segs; i++) {
      dir = norm([dir[0] + (r() - 0.5) * wob, dir[1] + lift + (r() - 0.5) * wob * 0.6, dir[2] + (r() - 0.5) * wob]);
      q = [q[0] + dir[0] * len / segs, q[1] + dir[1] * len / segs, q[2] + dir[2] * len / segs];
      pts.push([q[0], q[1], q[2], r0 + (r1 - r0) * (i / segs)]);
      dirs.push(dir);
    }
    return { pts, dirs };
  };
  // 一張葉叢：從 p 沿 d 伸出去的面（side 是它的寬度方向），尾端微微下垂。
  // v 是它所在那一團葉子的「從團心往外」的方向，用來算明暗：每一團都是上面亮、底下暗
  const card = (p, d, side, size, rows, v, gain) => {
    const cell = Math.floor(r() * 4), cu = cell % 2, cv = cell >> 1, base = F.pos.length / 3, tone = 0.84 + 0.32 * r(), jn = rnd3();
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      for (const e of [-0.5, 0.5]) {
        const x = p[0] + d[0] * size * t + side[0] * size * e, y = p[1] + d[1] * size * t + side[1] * size * e - size * 0.16 * t * t, z = p[2] + d[2] * size * t + side[2] * size * e;
        F.pos.push(x, y, z);
        // 法線跟底下那一團一樣：以這一團的中心為主、整個樹冠的中心為輔，葉片和底下的葉團明暗才連成一片
        const n = norm([v[0] * 0.7 + (x - CENTER[0]) + jn[0] * 0.22, v[1] * 0.7 + (y - CENTER[1]) + 0.25 + jn[1] * 0.16, v[2] * 0.7 + (z - CENTER[2]) + jn[2] * 0.22]);
        F.nrm.push(n[0], n[1], n[2]);
        F.uv.push((cu + 0.5 + e * 0.985) / 2, (cv + 1 - t * 0.99 - 0.005) / 2);
        const k = tone * gain * (0.70 + 0.30 * smooth(0.4, 0.8, inner(x, y, z)));
        F.col.push(k, k, k);
      }
    }
    for (let i = 0; i < rows; i++) { const a = base + i * 2; F.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  };

  // ---- 樹冠的形狀：大大小小的葉團疊成一朵雲（中間一大團、周圍一圈、頂上再冒出幾小團）。
  // 葉團的位置用自己的亂數：精細版和簡化版排出來的一樣，走近走遠切換時樹形不會變 ----
  const rl = rng(seed * 3 + 11);
  const lobes = [[0, 0.76, 0, 0.27]];
  const ns = 5 + (rl() < 0.5 ? 1 : 0), a0 = rl() * 6.2832;
  for (let k = 0; k < ns; k++) {      // 周圍一圈
    const a = a0 + (k / ns) * 6.2832 + (rl() - 0.5) * 0.5, d = 0.21 + 0.07 * rl();
    lobes.push([Math.cos(a) * d, 0.58 + 0.14 * rl(), Math.sin(a) * d, 0.17 + 0.06 * rl()]);
  }
  const tones = lobes.map(() => 0.92 + 0.16 * rl());
  if (!lo) {
    for (let k = 0; k < 3; k++) {     // 頂上再冒出幾小團
      const a = a0 + 1 + (k / 3) * 6.2832 + (rl() - 0.5) * 0.8, d = 0.07 + 0.10 * rl();
      lobes.push([Math.cos(a) * d, 0.91 + 0.07 * rl(), Math.sin(a) * d, 0.13 + 0.04 * rl()]);
      tones.push(0.92 + 0.16 * rl());
    }
  }

  // ---- 樹幹：又短又胖，根部往外張開 ----
  const lean = [(r() - 0.5) * 0.12, 1, (r() - 0.5) * 0.12];
  const trunk = grow([0, 0, 0], norm(lean), 0.36 + 0.07 * r(), 0.072, 0.05, lo ? 2 : 4, 0.04, 0.12);
  trunk.pts[0][3] *= 1.4;
  tube(trunk.pts, lo ? 6 : 10, 2);
  const top = trunk.pts[trunk.pts.length - 1];
  if (!lo) {
    // 主幹繼續往上伸進樹冠中央；從樹幹分出一根根粗枝伸向每一團葉子，枝尾再分成幾根細枝伸到葉團裡。
    // 從樹下往上看、或鏡頭把擋住視線的葉子挖開時，看到的是一棵有枝有幹的樹，不是一顆球
    const leader = grow(top, norm([lean[0], 1, lean[2]]), 0.3, 0.046, 0.016, 3, 0.02, 0.1);
    tube(leader.pts, 6, 1);
    const tip = leader.pts[leader.pts.length - 1];
    lobes.forEach(([cx, cy, cz, R], li) => {
      let end = tip;
      if (li > 0) {
        const from = li <= ns ? top : tip;
        const dv = [cx - from[0], cy - R * 0.2 - from[1], cz - from[2]], len = Math.hypot(dv[0], dv[1], dv[2]);
        const limb = grow(from, norm(dv), len * 0.85, li <= ns ? 0.03 : 0.014, 0.009, 3, 0.03, 0.1);
        tube(limb.pts, 5, 1, T);
        end = limb.pts[limb.pts.length - 1];
      }
      for (let k = 0; k < 3; k++) {
        const a = r() * 6.2832, e = 0.35 + 0.9 * r();
        tube(grow(end, [Math.cos(a) * Math.sin(e), Math.cos(e), Math.sin(a) * Math.sin(e)], R * 0.7, 0.008, 0.003, 2, 0.04, 0.2).pts, 3, 0.5, T);
      }
    });
  }

  // ---- 葉子 ----
  // 簡化版（遠看）：每一團是一顆表面凹凸不平的實心葉團，外面貼一圈葉片，輪廓是碎碎的葉尖。
  // 精細版（近看）：葉團是空心的，分三層 ——
  //   外層：貼著表面、一片壓一片的葉片，連底下也有（從樹下往上看得到垂下來的葉子）；
  //   裡層：從細枝往外長的深色葉片，外層葉片之間的縫裡看到的是它們；
  //   芯：只剩一小團很深的顏色，擋住最裡面，不讓整棵樹透光透成一張網
  const YS = 0.86;   // 每一團都稍微壓扁
  // 表面的凹凸：同一個方向永遠得到同一個值，葉團和貼在上面的葉片才對得起來
  const lump = (v, sd) => 1 + 0.17 * Math.sin(v[0] * 6.1 + sd) * Math.sin(v[1] * 5.3 + sd * 1.7) * Math.sin(v[2] * 5.7 + sd * 0.6)
    + 0.05 * Math.sin(v[0] * 11 + v[1] * 9 + v[2] * 13 + sd * 2.3);
  const CORE = lo ? 0.9 : 0.5, CORE_K = lo ? 1 : 0.5;
  const buried = (pos, li, k) => lobes.some(([ox, oy, oz, oR], oi) => oi !== li && Math.hypot(pos[0] - ox, (pos[1] - oy) / YS, pos[2] - oz) < oR * k);
  const blobs = [];
  lobes.forEach(([cx, cy, cz, R], li) => {
    const sd = seed * 0.37 + li * 2.1, tone = tones[li];
    const geo = new THREE.IcosahedronGeometry(R, 1).toNonIndexed();
    geo.deleteAttribute('uv');
    const p = geo.attributes.position, nrm = geo.attributes.normal, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const v = norm([p.getX(i), p.getY(i), p.getZ(i)]), k0 = lump(v, sd) * CORE;
      const x = cx + v[0] * R * k0, y = cy + v[1] * R * k0 * YS, z = cz + v[2] * R * k0;
      p.setXYZ(i, x, y, z);
      // 法線以這一團的中心為主、整個樹冠的中心為輔：每一團各有自己的明暗，整棵樹還是一個整體
      const n = norm([v[0] * 0.7 + (x - CENTER[0]), v[1] * 0.7 + (y - CENTER[1]) + 0.25, v[2] * 0.7 + (z - CENTER[2])]);
      nrm.setXYZ(i, n[0], n[1], n[2]);
      const k = CORE_K * tone * (0.66 + 0.34 * smooth(-0.5, 0.8, v[1])) * (0.93 + 0.14 * Math.sin(v[0] * 9 + v[2] * 7 + sd));
      col.set([0.078 * k, 0.29 * k, 0.036 * k], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    blobs.push(geo);
    // 外層的葉片：均勻撒在這一團的表面，根部貼著表面、葉尖朝外偏下，一片壓一片
    const n = lo ? 10 : Math.round(Math.min(68, Math.max(22, 46 * (R / 0.2) * (R / 0.2)))), span = lo ? 1.6 : 1.9;
    for (let i = 0; i < n; i++) {
      const y = 1 - ((i + 0.5) / n) * span, rad = Math.sqrt(Math.max(1 - y * y, 0)), a = i * 2.39996 + li * 1.7 + r() * 0.4;
      const v = [Math.cos(a) * rad, y, Math.sin(a) * rad], k0 = lump(v, sd) * 0.94;
      const pos = [cx + v[0] * R * k0, cy + v[1] * R * k0 * YS, cz + v[2] * R * k0];
      const j = rnd3();
      if (buried(pos, li, 0.78)) continue;   // 埋在別團裡面的不用放
      // 沿著表面的方向：隨機，但偏向往下垂
      let t = cross(v, norm(j));
      t = [t[0], t[1] - 0.28, t[2]];
      const dv = t[0] * v[0] + t[1] * v[1] + t[2] * v[2];
      t = norm([t[0] - v[0] * dv, t[1] - v[1] * dv, t[2] - v[2] * dv]);
      // 葉團底下的葉片往旁邊平平地伸出去、短一點，不要垂到人的頭上
      const under = smooth(-0.25, -0.6, v[1]), ov = 0.5 - 0.38 * under;
      const d = norm([v[0] * ov + t[0] * 0.85, v[1] * ov + t[1] * 0.85, v[2] * ov + t[2] * 0.85]);
      const side = norm(cross(d, v));
      card(pos, d, side, Math.max(0.11, R * (0.72 + 0.28 * r())) * (lo ? 1.5 : 1 - 0.3 * under), lo ? 1 : 2, v, tone * (0.72 + 0.40 * smooth(-0.4, 0.8, v[1])));
    }
    if (lo) return;
    // 裡層的葉片：從葉團中間往外長，顏色深
    const n2 = Math.round(n * 0.45);
    for (let i = 0; i < n2; i++) {
      const y = 1 - ((i + 0.5) / n2) * 1.9, rad = Math.sqrt(Math.max(1 - y * y, 0)), a = i * 2.39996 + li * 0.9 + 1.3 + r() * 0.5;
      const v = [Math.cos(a) * rad, y, Math.sin(a) * rad], k0 = lump(v, sd) * 0.45;
      const pos = [cx + v[0] * R * k0, cy + v[1] * R * k0 * YS, cz + v[2] * R * k0];
      const t = norm(cross(v, norm(rnd3()))), size = R * (0.5 + 0.2 * r());
      if (buried(pos, li, 0.5)) continue;
      const d = norm([v[0] * 0.8 + t[0] * 0.6, v[1] * 0.8 + t[1] * 0.6 - 0.1, v[2] * 0.8 + t[2] * 0.6]), sv = cross(d, v);
      if (Math.hypot(sv[0], sv[1], sv[2]) < 0.05) continue;
      card(pos, d, norm(sv), size, 1, v, tone * 0.58);
    }
  });
  const parts = [{ geo: toGeo(B), mat: 'bark' }, { geo: toGeo(F), mat: 'leaf' }, { geo: mergeGeometries(blobs), mat: 'crown' }];
  if (T.idx.length) parts.push({ geo: toGeo(T), mat: 'twig' });
  return parts;
}

function toGeo(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(o.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(o.col, 3));
  g.setIndex(o.idx);
  return g;
}

// ============================================================ 針葉樹、椰子樹共用的小工具
const buf = () => ({ pos: [], nrm: [], uv: [], col: [], idx: [] });
const vert = (G, p, n, c) => { G.pos.push(p[0], p[1], p[2]); G.nrm.push(n[0], n[1], n[2]); G.uv.push(0, 0); G.col.push(c[0], c[1], c[2]); return G.pos.length / 3 - 1; };
// 一個三角形。頂點順序自動排好：正面朝著法線指的那一側
const face = (G, a, b, c) => {
  const P = G.pos, N = G.nrm;
  const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
  const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
  const d = (uy * vz - uz * vy) * (N[a * 3] + N[b * 3] + N[c * 3]) + (uz * vx - ux * vz) * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + (ux * vy - uy * vx) * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
  if (d >= 0) G.idx.push(a, b, c); else G.idx.push(a, c, b);
};
// 沿著一串點 [x, y, z, 半徑] 拉一根管子當樹幹。tint(點, 第幾個)：樹皮貼圖要乘上的顏色
function addTube(B, pts, sides, urep, v0, tint) {
  const base = B.pos.length / 3;
  let v = v0, u = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
    const t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    if (!u) u = norm(cross(Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], t));
    else { const d = u[0] * t[0] + u[1] * t[1] + u[2] * t[2]; u = norm([u[0] - t[0] * d, u[1] - t[1] * d, u[2] - t[2] * d]); }
    const w = cross(t, u);
    if (i) v += Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]) * VK;
    const k = tint(p, i);
    for (let s = 0; s <= sides; s++) {
      const ang = (s / sides) * 6.2832, c = Math.cos(ang), sn = Math.sin(ang);
      const nx = u[0] * c + w[0] * sn, ny = u[1] * c + w[1] * sn, nz = u[2] * c + w[2] * sn;
      B.pos.push(p[0] + nx * p[3], p[1] + ny * p[3], p[2] + nz * p[3]);
      B.nrm.push(nx, ny, nz);
      B.uv.push((s / sides) * urep, v);
      B.col.push(k[0], k[1], k[2]);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const a = base + i * (sides + 1) + s, b = a + 1, c = a + sides + 1, d = c + 1;
      B.idx.push(a, b, c, b, d, c);
    }
  }
}
// 一張葉叢（用葉子的貼圖）：從 p 沿 d 伸出去，side 是寬度方向，尾端微微下垂
function addCard(F, r, p, d, side, size, rows, n, tint) {
  const cell = Math.floor(r() * 4), cu = cell % 2, cv = cell >> 1, base = F.pos.length / 3;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    for (const e of [-0.5, 0.5]) {
      F.pos.push(p[0] + d[0] * size * t + side[0] * size * e, p[1] + d[1] * size * t + side[1] * size * e - size * 0.16 * t * t, p[2] + d[2] * size * t + side[2] * size * e);
      F.nrm.push(n[0], n[1], n[2]);
      F.uv.push((cu + 0.5 + e * 0.985) / 2, (cv + 1 - t * 0.99 - 0.005) / 2);
      F.col.push(tint[0], tint[1], tint[2]);
    }
  }
  for (let i = 0; i < rows; i++) { const a = base + i * 2; F.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
}

// ============================================================ 針葉樹
// 一根往外伸、往下垂的枝：沿著 pts（從樹幹到枝尖）鋪一片針葉。橫切面是中間高、兩邊垂下去的「人」字形，
// 從側面看有厚度，不是一張薄紙。nrm：打光用的方向（從樹幹往外偏上）；tintAt(t)：根部到枝尖的深淺
function addBough(F, r, pts, side, width, sag, nrm, tintAt) {
  const cell = Math.floor(r() * 4), cu = cell % 2, cv = cell >> 1, base = F.pos.length / 3, rows = pts.length - 1;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, p = pts[i], k = tintAt(t);
    for (const e of [-0.5, 0, 0.5]) {
      F.pos.push(p[0] + side[0] * width * e, p[1] - Math.abs(e) * 2 * sag, p[2] + side[2] * width * e);
      const n = norm([nrm[0] + side[0] * e * 0.9, nrm[1], nrm[2] + side[2] * e * 0.9]);
      F.nrm.push(n[0], n[1], n[2]);
      F.uv.push((cu + 0.5 + e * 0.985) / 2, (cv + 1 - t * 0.99 - 0.005) / 2);
      const c = k * (e === 0 ? 1 : 0.88);
      F.col.push(c, c, c);
    }
  }
  for (let i = 0; i < rows; i++) {
    const a = base + i * 3;
    F.idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
  }
}

// 動畫背景裡的杉樹：一根筆直的樹幹，枝條一層一層往外伸、往下垂，越往上越短，最上面收成尖頂。
// 近看（精細版）：每一層是一圈各自獨立的枝，枝上是針葉，枝和枝之間有縫，縫裡看得到樹幹和裡面深色的枝葉。
// 遠看（簡化版）：每一層是一整圈裙襬，邊上貼一圈針葉。整棵深藍綠色
export function animeConifer(seed, lo) {
  const r = rng(seed), B = buf(), F = buf(), C = buf();
  const lx = (r() - 0.5) * 0.06, lz = (r() - 0.5) * 0.06, TOP = 0.96;
  const axis = (y) => [lx * y * y, y, lz * y * y];   // 樹幹微微歪一點
  const TS = lo ? 4 : 7, tp = [];
  for (let i = 0; i <= TS; i++) {
    const t = i / TS, c = axis(TOP * t);
    tp.push([c[0], c[1], c[2], 0.045 * Math.pow(1 - t, 1.15) * (i === 0 ? 1.4 : 1) + 0.006]);
  }
  addTube(B, tp, lo ? 6 : 9, 2, r() * 3, () => [1.25, 0.95, 0.80]);   // 偏紅褐的樹皮

  const N = lo ? 5 : 9, M = 8, GREEN = [0.042, 0.205, 0.085];
  // 精細版的裙襬縮到一半大、顏色壓深，當作樹裡面那一團照不到光的枝葉（擋住視線，不會從這頭看穿到那頭）
  const RS = lo ? 1 : 0.4, CK = lo ? 1 : 0.22;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1), y = 0.21 + 0.70 * Math.pow(t, 0.92), last = i === N - 1;
    const R = (0.31 * Math.pow(1 - t, 0.85) + 0.045) * (0.9 + 0.2 * r());
    const c = axis(y), ph = r() * 6.2832, lift = last ? R * 2.4 : Math.max(R * 0.62, 0.09), shade = 0.80 + 0.30 * t;
    const col = (k) => [GREEN[0] * k * shade * CK, GREEN[1] * k * shade * CK, GREEN[2] * k * shade * CK];
    const top = [], mid = [], tip = [], und = [];
    const hub = vert(C, [c[0], y + lift * 0.12, c[2]], [0, -1, 0], col(0.42));   // 底面的中心
    for (let j = 0; j < M; j++) {
      const a = ph + (j / M) * 6.2832, dx = Math.cos(a), dz = Math.sin(a);
      const Rj = R * RS * (j % 2 ? 0.72 : 1.0) * (0.86 + 0.28 * r()), drop = R * RS * 0.24 * (0.5 + r());   // 一長一短，垂下去的量也不一樣
      const pm = [c[0] + dx * Rj * 0.58, y + lift * 0.30, c[2] + dz * Rj * 0.58], pt = [c[0] + dx * Rj, y - drop, c[2] + dz * Rj];
      top.push(vert(C, [c[0] + dx * 0.012, y + lift * (lo ? 1 : 0.8), c[2] + dz * 0.012], norm([dx * 0.5, 1, dz * 0.5]), col(0.80)));
      mid.push(vert(C, pm, norm([dx, 0.8, dz]), col(1.0)));
      tip.push(vert(C, pt, norm([dx, 0.3, dz]), col(1.22)));
      und.push(vert(C, pt, norm([dx * 0.4, -1, dz * 0.4]), col(0.5)));
      if (lo) {   // 簡化版：邊上貼一圈針葉，根部在裙襬上，葉尖朝外偏下、伸出邊緣外面
        const jd = norm([dx + (r() - 0.5) * 0.5, -0.4 - 0.3 * r(), dz + (r() - 0.5) * 0.5]), sd = norm(cross(jd, [0, 1, 0]));
        const k = (0.95 + 0.3 * r()) * shade, size = Math.max(0.075, R * (0.55 + 0.25 * r())) * 1.5;
        addCard(F, r, [pm[0] + (pt[0] - pm[0]) * 0.35, pm[1] + (pt[1] - pm[1]) * 0.35 + 0.01, pm[2] + (pt[2] - pm[2]) * 0.35], jd, sd, size, 1, norm([dx, 0.7, dz]), [k, k, k]);
      }
    }
    for (let j = 0; j < M; j++) {
      const k = (j + 1) % M;
      face(C, top[j], mid[j], mid[k]); face(C, top[j], mid[k], top[k]);
      face(C, mid[j], tip[j], tip[k]); face(C, mid[j], tip[k], mid[k]);
      if (lo) face(C, hub, und[j], und[k]);   // 精細版不封底：從樹下往上看，看到的是上面一層層的枝，不是一塊平板
    }
    if (lo) continue;
    // 精細版：這一層的枝。外圈長的枝伸到樹的輪廓、往下垂；裡圈短的枝錯開半格、位置高一點，把外圈的枝根蓋住
    const ring = (count, reach, yFrom, yTo, wide, rows, up, tone) => {
      for (let j = 0; j < count; j++) {
        const a = ph + ((j + (up ? 0.5 : 0)) / count) * 6.2832 + (r() - 0.5) * 0.4, dx = Math.cos(a), dz = Math.sin(a);
        const L = R * reach * (j % 2 ? 0.8 : 1.0) * (0.9 + 0.25 * r()), y1 = yTo - R * 0.24 * (r() - 0.3), pts = [];
        for (let k = 0; k <= rows; k++) {
          const u = k / rows, d = 0.01 + L * u;
          pts.push([c[0] + dx * d, yFrom + (y1 - yFrom) * (0.3 * u + 0.7 * u * u), c[2] + dz * d]);   // 先平著伸出去，越到枝尖垂得越多
        }
        const W = Math.max(L * wide, 0.09), k0 = (0.88 + 0.26 * r()) * shade * tone;
        addBough(F, r, pts, [-dz, 0, dx], W, W * 0.17, norm([dx * 0.75, up ? 1.1 : 0.8, dz * 0.75]), (u) => k0 * (0.66 + 0.5 * u));
      }
    };
    if (last) {
      ring(5, 1.5, y + lift * 0.15, y - R * 0.3, 1.0, 3, false, 1.05);
      // 樹頂：兩片直立的針葉交叉成十字，收成尖頂
      const peak = axis(y + lift * 0.1);
      const tipTop = axis(y + lift * 1.2), midTop = axis(y + lift * 0.65);
      for (const sd of [[1, 0, 0], [0, 0, 1]]) addBough(F, r, [peak, midTop, tipTop], sd, lift * 0.55, 0, norm([sd[2] * 0.5, 1, sd[0] * 0.5]), () => 1.1 * shade);   // 比枝條窄，才是尖的
    } else {
      const nb = Math.round(9 - 4 * t);
      ring(nb, 1.0, y + lift * 0.78, y - R * 0.24, 0.95, 4, false, 1.0);
      if (i === 0) ring(6, 0.66, y + lift * 0.35, y - R * 0.42, 1.0, 3, true, 0.8);   // 最底下再垂一圈短枝：人站在樹旁，眼前就是這一層
      ring(Math.max(nb - 2, 4), 0.62, y + lift * 1.0, y + lift * 0.42, 1.05, 3, true, 0.92);
    }
  }
  return [{ geo: toGeo(B), mat: 'bark' }, { geo: toGeo(F), mat: 'needle' }, { geo: toGeo(C), mat: 'crown' }];
}

// ============================================================ 椰子樹
// 一片椰子葉：沿著 pts（從葉柄到葉尖）鋪一張羽狀葉的貼圖。橫切面是中間（葉軸）高、兩邊的小葉垂下去的「人」字形，
// 越往葉尖垂得越多。cell：用貼圖上的哪一格；up(i)：那一段葉面朝上的方向；roll：整片葉子繞著葉軸歪一點
function addFrond(F, cell, pts, side, width, up, roll, tint) {
  const cu = cell % 4, cv = cell >> 2, base = F.pos.length / 3, rows = pts.length - 1;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, p = pts[i], u = up(i), sag = width * (0.16 + 0.34 * t);
    for (const e of [-0.5, 0, 0.5]) {
      F.pos.push(p[0] + side[0] * width * e - u[0] * Math.abs(e) * 2 * sag, p[1] - u[1] * Math.abs(e) * 2 * sag + e * width * roll, p[2] + side[2] * width * e - u[2] * Math.abs(e) * 2 * sag);
      const n = norm([u[0] + side[0] * e * 0.9, u[1] + 0.35, u[2] + side[2] * e * 0.9]);
      F.nrm.push(n[0], n[1], n[2]);
      F.uv.push((cu + 0.5 + e * 0.97) / 4, (cv + 1 - t * 0.99 - 0.005) / 2);
      const k = e === 0 ? 1 : 0.9;
      F.col.push(tint[0] * k, tint[1] * k, tint[2] * k);
    }
  }
  for (let i = 0; i < rows; i++) {
    const a = base + i * 3;
    F.idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
  }
}

// 動畫裡的椰子樹：彎彎的樹幹上一圈一圈葉子掉了之後留下的環紋，根部胖一圈；頂上一大蓬羽毛狀的葉子——
// 中間幾片新葉挺著往上，外圈的往外伸、尾端垂下來，最老的兩片枯黃了掛在下面；葉子底下掛著一串椰子
export function animePalm(seed, lo) {
  const r = rng(seed), rc = rng(seed + 5), B = buf(), P = buf();   // B：樹幹和椰子（平塗）；P：葉子。椰子用另一組亂數：精細版和簡化版的葉子才會長得一樣
  const bend = 0.10 + 0.16 * r(), bdir = r() * 6.2832, H = 0.80;
  const spine = (t) => { const k = bend * (1.15 * t * t - 0.15 * t); return [Math.cos(bdir) * k, H * t, Math.sin(bdir) * k]; };
  const rad = (t) => 0.040 - 0.014 * t + 0.026 * Math.exp(-t * 16) + (t > 0.93 ? 0.008 : 0);
  const v0 = r() * 3, tp = [];
  if (lo) {
    for (let i = 0; i <= 4; i++) { const t = i / 4, c = spine(t); tp.push([c[0], c[1], c[2], rad(t)]); }
    addTube(B, tp, 5, 1.5, v0, (p) => { const k = 0.85 + 0.15 * p[1] / H; return [0.34 * k, 0.27 * k, 0.195 * k]; });
  } else {
    // 每一節：底下寬一點、顏色淺，往上收窄、顏色變深，到下一節又突然寬出來，就是一圈一圈的環紋
    const RINGS = 15;
    for (let k = 0; k < RINGS; k++) {
      const t0 = k / RINGS, t1 = (k + 1) / RINGS - 0.004, a = spine(t0), b = spine(t1);
      tp.push([a[0], a[1], a[2], rad(t0) * 1.07], [b[0], b[1], b[2], rad(t1) * 0.95]);
    }
    const e = spine(1);
    tp.push([e[0], e[1], e[2], rad(1) * 0.8]);
    addTube(B, tp, 9, 1.5, v0, (p, i) => { const k = (i % 2 ? 0.66 : 1.0) * (0.82 + 0.18 * p[1] / H); return [0.40 * k, 0.325 * k, 0.235 * k]; });
  }
  const top = spine(1);
  if (!lo) {
    for (let k = 0; k < 5; k++) {   // 一串椰子：有熟的（褐色）、有還青的
      const a = k * 1.3 + rc(), d = 0.044 + 0.014 * rc(), cx = top[0] + Math.cos(a) * d, cy = top[1] - 0.040 - 0.016 * rc(), cz = top[2] + Math.sin(a) * d;
      const col = k % 3 === 2 ? [0.20, 0.27, 0.07] : [0.27, 0.16, 0.065];
      const g = new THREE.IcosahedronGeometry(0.031 + 0.006 * rc(), 1), gp = g.attributes.position, ids = [];
      for (let i = 0; i < gp.count; i++) { const v = norm([gp.getX(i), gp.getY(i), gp.getZ(i)]); ids.push(vert(B, [cx + gp.getX(i), cy + gp.getY(i) * 1.12, cz + gp.getZ(i)], v, col)); }
      for (let i = 0; i < ids.length; i += 3) face(B, ids[i], ids[i + 1], ids[i + 2]);   // 這個球本來就是三個頂點一個面
    }
  }
  // 葉子：從樹頂一圈一圈往外長。u = 0 是中間最新的葉子（挺著往上），u 越大越外圈、越往下垂
  const NF = 15, ROWS = lo ? 4 : 10;
  for (let f = 0; f < NF; f++) {
    const u = (f + 0.5) / NF, old = f >= NF - 2;
    const a = f * 2.39996 + (r() - 0.5) * 0.5, dx = Math.cos(a), dz = Math.sin(a);
    const len = (old ? 0.40 : 0.38 + 0.16 * Math.sin(Math.PI * Math.min(u * 1.15, 1))) * (0.9 + 0.2 * r());
    const rise = old ? -0.15 - 0.2 * r() : 1.25 - 1.15 * u + 0.2 * (r() - 0.5), sag = old ? 1.05 : 0.7 + 0.85 * u + 0.2 * (r() - 0.5);
    const roll = (r() - 0.5) * 0.5, tone = (old ? 0.95 : 1.14 - 0.28 * u) * (0.92 + 0.16 * r()), cell = Math.floor(r() * 8);
    if (lo && f % 2 && !old) continue;   // 簡化版：隔一片留一片（留下來的跟精細版是同一片，遠近切換時樹形不變）
    const rib = (t) => [top[0] + dx * len * t * (1 - 0.14 * t), top[1] + 0.015 + len * (rise * t - sag * t * t), top[2] + dz * len * t * (1 - 0.14 * t)];
    const pts = [], side = [-dz, 0, dx];
    for (let i = 0; i <= ROWS; i++) pts.push(rib(i / ROWS));
    const up = (i) => { const p0 = pts[Math.max(i - 1, 0)], p1 = pts[Math.min(i + 1, ROWS)]; return norm(cross(side, norm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]))); };
    // 最老的葉子枯黃了
    addFrond(P, cell, pts, side, len * (lo ? 0.46 : 0.40), up, roll, old ? [1.25 * tone, 0.86 * tone, 0.42 * tone] : [tone, tone, tone]);
  }
  return [{ geo: toGeo(B), mat: 'crown' }, { geo: toGeo(P), mat: 'frond' }];
}

// ============================================================ 灌木
// 一叢矮矮的灌木（高約 0.8，放進場景時放大成 1～2 公尺）：幾根細枝從地面岔開，上面頂著幾團擠在一起的葉子。
// 精細版（近看）：葉團外面是一片壓一片的葉片（跟闊葉樹同一張葉子貼圖，所以葉子看起來小），縫裡露出深色的裡層，
//   上面開著幾朵五瓣的小花（三種顏色，看種子）。
// 簡化版（遠看）：每團是一顆實心的葉團，外面貼幾片葉片，沒有花。葉團的位置兩版一樣
export function animeBush(seed, lo) {
  const r = rng(seed), rl = rng(seed * 3 + 7), F = buf(), T = buf(), W = buf();   // F：葉片；T：細枝；W：花
  const lobes = [[0, 0.30, 0, 0.40]];
  const ns = 3 + (rl() < 0.5 ? 1 : 0), a0 = rl() * 6.2832;
  for (let k = 0; k < ns; k++) {
    const a = a0 + (k / ns) * 6.2832 + (rl() - 0.5) * 0.7, d = 0.26 + 0.14 * rl(), R = 0.24 + 0.12 * rl();
    lobes.push([Math.cos(a) * d, R * 0.78 + 0.05 * rl(), Math.sin(a) * d, R]);
  }
  const tones = lobes.map(() => 0.9 + 0.2 * rl());
  const YS = 0.85, C0 = [0, 0.3, 0];
  const lump = (v, sd) => 1 + 0.16 * Math.sin(v[0] * 6.1 + sd) * Math.sin(v[1] * 5.3 + sd * 1.7) * Math.sin(v[2] * 5.7 + sd * 0.6);
  const buried = (q, li, k) => lobes.some(([ox, oy, oz, oR], oi) => oi !== li && Math.hypot(q[0] - ox, (q[1] - oy) / YS, q[2] - oz) < oR * k);
  // 打光用的方向：以這一團的中心為主、整叢的中心為輔，偏上
  const lit = (v, q) => norm([v[0] * 0.7 + (q[0] - C0[0]), v[1] * 0.7 + (q[1] - C0[1]) + 0.3, v[2] * 0.7 + (q[2] - C0[2])]);
  if (!lo) {
    // 細枝：從根部岔開，伸進每一團葉子
    for (const [cx, cy, cz] of lobes) {
      addTube(T, [[cx * 0.15, -0.03, cz * 0.15, 0.024], [cx * 0.6, cy * 0.5, cz * 0.6, 0.017], [cx, cy, cz, 0.008]], 4, 0.5, r() * 3, () => [0.72, 0.68, 0.62]);
    }
  }
  const blobs = [];
  const PETAL = [[0.96, 0.92, 0.94], [0.96, 0.55, 0.64], [0.97, 0.83, 0.26]][seed % 3], EYE = seed % 3 === 2 ? [0.92, 0.48, 0.10] : [0.98, 0.80, 0.22];
  lobes.forEach(([cx, cy, cz, R], li) => {
    const sd = seed * 0.41 + li * 2.3, tone = tones[li], CORE = lo ? 0.92 : 0.72, CK = lo ? 1 : 0.38;
    const at = (v, k) => [cx + v[0] * R * k, cy + v[1] * R * k * YS, cz + v[2] * R * k];
    const geo = new THREE.IcosahedronGeometry(R, 1).toNonIndexed();
    geo.deleteAttribute('uv');
    const gp = geo.attributes.position, gn = geo.attributes.normal, col = new Float32Array(gp.count * 3);
    for (let i = 0; i < gp.count; i++) {
      const v = norm([gp.getX(i), gp.getY(i), gp.getZ(i)]), q = at(v, lump(v, sd) * CORE);
      q[1] = Math.max(q[1], -0.02);
      gp.setXYZ(i, q[0], q[1], q[2]);
      const n = lit(v, q);
      gn.setXYZ(i, n[0], n[1], n[2]);
      const k = CK * tone * (0.62 + 0.38 * smooth(-0.5, 0.8, v[1]));
      col.set([0.078 * k, 0.29 * k, 0.036 * k], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    blobs.push(geo);
    // 外層的葉片：貼著葉團表面，葉尖朝外偏下，一片壓一片
    const n = lo ? 7 : Math.round(42 * (R / 0.3) * (R / 0.3));   // 葉片小而密，整叢才是圓圓密密的一團
    for (let i = 0; i < n; i++) {
      const y = 1 - ((i + 0.5) / n) * 1.5, rad = Math.sqrt(Math.max(1 - y * y, 0)), a = i * 2.39996 + li * 1.7 + r() * 0.4;
      const v = [Math.cos(a) * rad, y, Math.sin(a) * rad], q = at(v, lump(v, sd) * 0.95), j = norm([r() - 0.5, r() - 0.5, r() - 0.5]);
      const size = lo ? Math.max(0.2, R * (0.7 + 0.25 * r())) * 1.5 : Math.max(0.15, R * (0.46 + 0.16 * r())), g = tone * (0.74 + 0.36 * smooth(-0.4, 0.8, v[1])) * (0.9 + 0.2 * r());
      if (q[1] < 0.05 || buried(q, li, 0.8)) continue;
      let t = cross(v, j);
      t = [t[0], t[1] - 0.2, t[2]];
      const dv = t[0] * v[0] + t[1] * v[1] + t[2] * v[2];
      t = norm([t[0] - v[0] * dv, t[1] - v[1] * dv, t[2] - v[2] * dv]);
      const d = norm([v[0] * 0.4 + t[0] * 0.9, v[1] * 0.4 + t[1] * 0.9, v[2] * 0.4 + t[2] * 0.9]), sv = cross(d, v);
      if (Math.hypot(sv[0], sv[1], sv[2]) < 0.05) continue;
      addCard(F, r, q, d, norm(sv), size, 1, lit(v, q), [g, g, g]);
    }
    if (lo) return;
    // 裡層的葉片：從葉團中間往外長，顏色深，外層葉片的縫裡看到的是它們
    const n2 = Math.round(n * 0.4);
    for (let i = 0; i < n2; i++) {
      const y = 1 - ((i + 0.5) / n2) * 1.5, rad = Math.sqrt(Math.max(1 - y * y, 0)), a = i * 2.39996 + li * 0.9 + 1.3 + r() * 0.5;
      const v = [Math.cos(a) * rad, y, Math.sin(a) * rad], q = at(v, 0.5), j = norm([r() - 0.5, r() - 0.5, r() - 0.5]), size = R * (0.5 + 0.2 * r());
      if (q[1] < 0.05 || buried(q, li, 0.55)) continue;
      const t = cross(v, j), d = norm([v[0] * 0.8 + t[0] * 0.6, v[1] * 0.8 + t[1] * 0.6, v[2] * 0.8 + t[2] * 0.6]), sv = cross(d, v);
      if (Math.hypot(sv[0], sv[1], sv[2]) < 0.05) continue;
      addCard(F, r, q, d, norm(sv), size, 1, lit(v, q), [tone * 0.56, tone * 0.56, tone * 0.56]);
    }
    // 小花：五片花瓣微微往外翹，中間一點花心；開在葉團朝上、朝外的那一面，稍微浮在葉片上面
    const nf = li === 0 ? 4 : 3;
    for (let f = 0; f < nf; f++) {
      const a = r() * 6.2832, e = 0.25 + 0.85 * r(), v = [Math.cos(a) * Math.sin(e), Math.cos(e), Math.sin(a) * Math.sin(e)], c = at(v, lump(v, sd) * 1.16);
      const sz = 0.06 + 0.025 * r(), spin = r() * 6.2832;
      if (buried(c, li, 1.0)) continue;
      const ta = norm(cross(v, Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), tb = cross(v, ta), nn = norm([v[0], v[1] + 0.6, v[2]]);
      const pt = (x, y, h) => [c[0] + ta[0] * x + tb[0] * y + v[0] * h, c[1] + ta[1] * x + tb[1] * y + v[1] * h, c[2] + ta[2] * x + tb[2] * y + v[2] * h];
      for (let k = 0; k < 5; k++) {
        const th = spin + (k / 5) * 6.2832, dx = Math.cos(th), dy = Math.sin(th), shade = 0.92 + 0.08 * (k % 2);
        const pc = [PETAL[0] * shade, PETAL[1] * shade, PETAL[2] * shade];
        const v0 = vert(W, pt(dx * sz * 0.12, dy * sz * 0.12, 0), nn, pc), v1 = vert(W, pt((dx * 0.58 - dy * 0.52) * sz, (dy * 0.58 + dx * 0.52) * sz, sz * 0.10), nn, pc);
        const v2 = vert(W, pt(dx * sz, dy * sz, sz * 0.22), nn, pc), v3 = vert(W, pt((dx * 0.58 + dy * 0.52) * sz, (dy * 0.58 - dx * 0.52) * sz, sz * 0.10), nn, pc);
        face(W, v0, v1, v2); face(W, v0, v2, v3);
      }
      const e0 = vert(W, pt(sz * 0.26, 0, sz * 0.06), nn, EYE), e1 = vert(W, pt(-sz * 0.13, sz * 0.225, sz * 0.06), nn, EYE), e2 = vert(W, pt(-sz * 0.13, -sz * 0.225, sz * 0.06), nn, EYE);
      face(W, e0, e1, e2);
    }
  });
  const parts = [{ geo: toGeo(F), mat: 'leaf' }, { geo: mergeGeometries(blobs), mat: 'crown' }];
  if (T.idx.length) parts.push({ geo: toGeo(T), mat: 'twig' });
  if (W.idx.length) parts.push({ geo: toGeo(W), mat: 'petal' });
  return parts;
}

// ============================================================ 草叢
// 乾燥的島上一叢一叢的長草（高約 0.6～1，放進場景時再放大）：幾十片細長的草葉從同一處長出來，
// 中間的高、直，外圈的矮、往外倒，葉尖彎下去；根部深綠，往上轉黃綠，葉尖是乾草色，夾著幾片整片枯黃的。
// 三種（看種子）：高高的芒草，抽著幾根帶穗的稈子；矮一點的草叢，沒有穗；中等的，穗少。
// 簡化版（遠看）：草葉少、寬一點，輪廓一樣
export function animeTuft(seed, lo) {
  const r = rng(seed * 5 + 3), G = buf(), kind = seed % 3;
  const H = [1.0, 0.62, 0.8][kind], nb = lo ? 12 : 42, segs = lo ? 2 : 4;
  // 一條帶子：沿著 pts 走，寬度方向 side，半寬 wAt(t)，顏色 cAt(t)
  const strip = (pts, side, wAt, cAt, n) => {
    let pa = -1, pb = -1;
    const m = pts.length - 1;
    for (let i = 0; i <= m; i++) {
      const t = i / m, q = pts[i], w = wAt(t), c = cAt(t);
      const a = vert(G, [q[0] - side[0] * w, q[1] - side[1] * w, q[2] - side[2] * w], n, c);
      const b = w > 1e-4 ? vert(G, [q[0] + side[0] * w, q[1] + side[1] * w, q[2] + side[2] * w], n, c) : a;
      if (i) { if (pa !== pb) face(G, pa, pb, a); if (b !== a) face(G, pb, b, a); }
      pa = a; pb = b;
    }
  };
  for (let b = 0; b < nb; b++) {
    const u = (b + 0.5) / nb, a = b * 2.39996 + (r() - 0.5) * 0.9, dx = Math.cos(a), dz = Math.sin(a);   // u：0 = 叢的中心，1 = 最外圈
    const d0 = 0.02 + 0.15 * Math.sqrt(u), len = H * (1 - 0.5 * u) * (0.8 + 0.4 * r()), lean = len * (0.10 + 0.62 * u) * (0.7 + 0.6 * r()), droop = 0.1 + 0.3 * r();
    const w0 = (0.020 + 0.014 * r()) * (lo ? 2.3 : 1), dry = r() < 0.22, tone = 0.85 + 0.3 * r();
    const c0 = dry ? [0.30, 0.26, 0.12] : [0.13, 0.21, 0.07], c1 = dry ? [0.62, 0.53, 0.28] : [0.33, 0.49, 0.12], c2 = dry ? [0.74, 0.65, 0.40] : [0.62, 0.63, 0.22];
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      pts.push([dx * (d0 + lean * Math.pow(t, 1.8)), -0.03 + len * (t - droop * t * t * t), dz * (d0 + lean * Math.pow(t, 1.8))]);
    }
    strip(pts, [-dz, 0, dx], (t) => w0 * Math.pow(1 - t, 0.7) * (0.65 + 0.35 * Math.min(1, t * 3)),
      (t) => { const c = t < 0.5 ? mixc3(c0, c1, smooth(0, 0.5, t)) : mixc3(c1, c2, smooth(0.5, 1, t)); return [c[0] * tone, c[1] * tone, c[2] * tone]; },
      norm([dx * 0.45, 1, dz * 0.45]));
  }
  // 穗：一根細稈從叢中間抽出來，高過草葉，頂上幾縷細長的穗往一邊散開、垂下去（芒草那種，不是一片葉子）
  const np = [4, 0, 2][kind];
  for (let k = 0; k < np; k++) {
    const a = k * 2.39996 + r() * 1.5, dx = Math.cos(a), dz = Math.sin(a), hgt = H * (1.08 + 0.22 * r()), lean = 0.10 + 0.16 * r();
    const at = (t) => [dx * (0.03 + lean * t * t), -0.03 + hgt * t, dz * (0.03 + lean * t * t)];
    const n = norm([dx * 0.4, 1, dz * 0.4]), stalk = [0.50, 0.44, 0.22];
    strip([at(0), at(0.5), at(1)], [-dz, 0, dx], () => (lo ? 0.012 : 0.008), () => stalk, n);
    if (!lo) strip([at(0), at(0.5), at(1)], [dx, 0, dz], () => 0.008, () => stalk, n);
    const top = at(1), cAt = (t) => mixc3([0.58, 0.50, 0.30], [0.80, 0.72, 0.50], t);
    for (const [da, lk, dk] of (lo ? [[0, 1, 1]] : [[0, 1, 1], [-0.5, 0.8, 1.35], [0.45, 0.72, 0.7], [0.1, 0.55, 1.8]])) {
      const ex = Math.cos(a + da), ez = Math.sin(a + da), L = (0.34 + 0.12 * r()) * lk, pl = [];
      for (let i = 0; i <= 4; i++) { const t = i / 4; pl.push([top[0] + ex * L * 0.7 * t, top[1] + L * (0.8 * t - 0.75 * dk * t * t), top[2] + ez * L * 0.7 * t]); }
      const wAt = (t) => (lo ? 0.03 : 0.015) * Math.sin(Math.PI * Math.pow(t, 0.7));
      strip(pl, [0, 1, 0], wAt, cAt, n);
      if (!lo && !da) strip(pl, [-ez, 0, ex], wAt, cAt, n);
    }
  }
  return [{ geo: toGeo(G), mat: 'blade' }];
}
const mixc3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ============================================================ 雜草
// 一叢草 = 幾片從同一處長出來、往外倒的草葉。幾千叢鋪成一塊方形草皮，草皮跟著鏡頭捲動（位置在著色器裡算）
export function makeGrassGeometry(count, T) {
  const r = rng(2024), pos = [], lean = [], tone = [], idx = [];
  for (let b = 0; b < 6; b++) {
    const a = (b / 6) * 6.2832 + r() * 1.2, d = 0.03 + 0.13 * r(), ox = Math.cos(a) * d, oz = Math.sin(a) * d;
    const la = a + (r() - 0.5) * 1.4, l = 0.12 + 0.45 * r(), w = 0.022 + 0.018 * r(), hk = 0.6 + 0.4 * r();
    const px = -Math.sin(la) * w, pz = Math.cos(la) * w, base = pos.length / 3, t = 0.82 + 0.36 * r();
    for (const [y, k] of [[0, 1], [0, -1], [0.5, 0.75], [0.5, -0.75], [1, 0]]) {
      pos.push(ox + px * k, y * hk, oz + pz * k);
      lean.push(Math.cos(la) * l, Math.sin(la) * l);
      tone.push(t);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aLean', new THREE.Float32BufferAttribute(lean, 2));
  g.setAttribute('aTone', new THREE.Float32BufferAttribute(tone, 1));
  g.setIndex(idx);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seed.set([r() * T, r() * T, r() * 6.2832, r()], i * 4);
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = count;
  return g;
}
