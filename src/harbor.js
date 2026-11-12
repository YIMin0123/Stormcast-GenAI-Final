// 日本風的小漁港：水泥岸壁（船就靠在岸壁邊）、往海裡伸出去再轉彎的防波堤（外側堆著消波塊、堤尾一座紅燈標）、
// 船揚場的斜坡、岸壁上的商店、攤位、魚市場棚。
// 除了模型，也回傳可行走的棧板範圍、商店與燈塔位置、出生點，給玩家與船的邏輯用。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildBoatMesh, BOAT_TYPES } from './boat.js';
import { makeCanMesh } from './fish.js';
import { HOME } from './terrain.js';
import { HOME_U, homeGlsl } from './homeGl.js';
import { toWorld } from './frame.js';
import { bulb, softDisc, softSquare } from './toon.js';
import { DECK_Y, DECKS, WALLS, SHOP, LIGHTHOUSE, SELL, SHELF, SHELF_X, SHELF_Z, PLAYER_SPAWN, onDeckLocal, PONTOONS, PONTOON_Y, PONTOON_W, BERTHS } from './layout.js';
// 港口的配置（哪裡是岸壁、商店、攤位、停船格）在 layout.js，伺服器也用同一份；這裡照著它蓋模型
export { DECK_Y, DECKS, WALLS, SHOP, LIGHTHOUSE, SELL, SHELF, SHELF_X, SHELF_Z, PLAYER_SPAWN };
// 這個檔案的座標全是港座標（見 frame.js）；makeHarbor 回傳的 group 由呼叫的人擺到世界裡（位置、轉向）

export const HARBOR_ROCKS = [];   // 消波塊（船和人都過不去）：{ x, z, r, top }

// 電子板的畫面：黑底綠字
const boardCanvas = document.createElement('canvas');
boardCanvas.width = 512; boardCanvas.height = 256;
const boardTex = new THREE.CanvasTexture(boardCanvas);
boardTex.colorSpace = THREE.SRGBColorSpace;
boardTex.anisotropy = 8;
export function setBoard(lines) {
  const g = boardCanvas.getContext('2d');
  g.fillStyle = '#07140c'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#39ff7a';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((t, i) => {
    g.font = `bold ${i === lines.length - 1 ? 64 : 40}px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", monospace`;
    g.fillText(t, 256, 256 * (i + 0.5) / lines.length + (i === lines.length - 1 ? 0 : 6));
  });
  boardTex.needsUpdate = true;
}

const tags = SHELF.map(() => {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面、牆面時紋路才不會閃爍
  return { c, t };
});
// 更新第 i 樣商品的價格牌：[品名, 說明, 價錢]
export function setTag(i, lines) {
  const { c, t } = tags[i], g = c.getContext('2d');
  g.fillStyle = '#5b3a1e'; g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#efe2bd'; g.fillRect(5, 5, 246, 150);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const font = (px) => `bold ${px}px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif`;
  g.fillStyle = '#3a2412'; g.font = font(lines[0].length > 5 ? 28 : 36); g.fillText(lines[0], 128, 34);
  g.fillStyle = '#6a4a2a'; g.font = font(lines[1].length > 9 ? 19 : 22); g.fillText(lines[1], 128, 78);
  g.fillStyle = '#a3261a'; g.font = font(40); g.fillText(lines[2], 128, 124);
  t.needsUpdate = true;
}
// 碼頭的四盞燈（晚上會亮）；UNLIT：招牌、價格牌這些不吃光照的材質，晚上要跟著變暗
export const LAMPS = [[-27, 117.2], [-3, 117.2], [19.3, 138], [4, 156.8]].map(([x, z]) => ({ x: x + 0.5, y: DECK_Y + 2.5, z }));
export const UNLIT = [];
export const POOLS = [];   // 晚上燈光照在地上的光圈：{ mesh, mat, k }
// 路燈以外、晚上也會照到水面和地上的光源（燈籠、販賣機、魚市場的燈泡）：{ x, z, k }
export const EXTRA_LAMPS = [
  { x: SHOP.x - 1.75, z: SHOP.z + SHOP.d / 2 + 0.75, k: 0.35 }, { x: -14.05, z: 105.9, k: 0.3 }, { x: 8.5, z: 107.5, k: 0.5 },
];
export const GLOW = [];   // 晚上會透出燈光的材質（窗戶）

// 畫貼圖用的亂數（固定種子：每次開遊戲畫出來的都一樣）
const trng = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };

// 一張木板貼圖：四條並排的木板（沿著貼圖的橫向）。畫的東西：每條深淺不同、板面上亮下暗、
// 順著板子走的幾道彎彎的木紋、偶爾一個木節（木紋繞過去）、板和板之間的縫（縫的下緣一道亮邊）；
// joints：每條板中間有一處接縫，兩邊釘著釘子（地板、桌面用；牆板是整片的，不畫）。上下左右都接得起來
function plankTexture(base = [150, 108, 66], seed = 1, joints = true) {
  const S = 512, n = 4, ph = S / n, r = trng(seed * 97 + 5);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rgb = (v, a = 1) => `rgba(${base.map((b) => Math.round(Math.min(255, b * v))).join(',')},${a})`;
  for (let i = 0; i < n; i++) {
    const y0 = i * ph, v = 0.86 + 0.26 * r();
    g.fillStyle = rgb(v);
    g.fillRect(0, y0, S, ph);
    const gr = g.createLinearGradient(0, y0, 0, y0 + ph);
    gr.addColorStop(0, 'rgba(255,240,210,0.10)'); gr.addColorStop(0.5, 'rgba(255,240,210,0)'); gr.addColorStop(1, 'rgba(30,16,6,0.15)');
    g.fillStyle = gr;
    g.fillRect(0, y0, S, ph);
    const knots = r() < 0.6 ? [[r() * S, y0 + ph * (0.3 + 0.4 * r()), 8 + 6 * r()]] : [];
    for (let k = 0; k < 6; k++) {
      const yy = y0 + 4 + (ph * (k + 0.6 + 0.5 * (r() - 0.5))) / 6.4, f1 = 1 + Math.floor(r() * 2), f2 = 3 + Math.floor(r() * 3);
      const a1 = 2 + 3.5 * r(), a2 = 0.8 + 1.4 * r(), p1 = r() * 6.2832, p2 = r() * 6.2832;
      g.strokeStyle = rgb(v * 0.62, 0.28 + 0.25 * r());
      g.lineWidth = 1.2 + 1.6 * r();
      g.beginPath();
      for (let x = 0; x <= S; x += 8) {
        let y = yy + a1 * Math.sin((x / S) * 6.2832 * f1 + p1) + a2 * Math.sin((x / S) * 6.2832 * f2 + p2);
        for (const [kx, ky, kr] of knots) {   // 木紋繞過木節
          let dx = x - kx;
          dx -= S * Math.round(dx / S);
          const dy = y - ky;
          y += (dy < 0 ? -1 : 1) * kr * 1.3 * Math.exp(-(dx * dx) / (kr * kr * 6)) * Math.exp(-Math.abs(dy) / (kr * 2.5));
        }
        if (x) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    for (const [kx, ky, kr] of knots) for (const ox of [-S, 0, S]) {
      g.fillStyle = rgb(v * 0.52, 0.85); g.beginPath(); g.ellipse(kx + ox, ky, kr * 1.25, kr * 0.75, 0, 0, 6.2832); g.fill();
      g.fillStyle = rgb(v * 0.36, 0.9); g.beginPath(); g.ellipse(kx + ox, ky, kr * 0.62, kr * 0.36, 0, 0, 6.2832); g.fill();
    }
    if (joints) {
      const jx = r() * S;
      for (const ox of [-S, 0, S]) {
        g.fillStyle = 'rgba(36,22,10,0.8)'; g.fillRect(jx + ox - 1.5, y0, 3, ph);
        g.fillStyle = 'rgba(255,240,210,0.16)'; g.fillRect(jx + ox + 1.5, y0, 1.5, ph);
        g.fillStyle = 'rgba(40,30,24,0.85)';
        for (const sx of [-14, 14]) for (const fy of [0.28, 0.74]) { g.beginPath(); g.arc(jx + ox + sx, y0 + ph * fy, 3.2, 0, 6.2832); g.fill(); }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    g.fillStyle = 'rgba(34,20,9,0.85)'; g.fillRect(0, i * ph, S, 5);
    g.fillStyle = 'rgba(255,238,205,0.20)'; g.fillRect(0, i * ph + 5, S, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面、牆面時紋路才不會閃爍
  return t;
}

// 屋頂的木瓦：一排一排交錯的瓦片，上一排壓著下一排（貼圖往下 = 往屋簷）。
// 每片瓦下緣是圓角、深淺各自不同，壓在下一排上的地方有一道影子，下緣一道亮邊，瓦面上兩三道淡淡的直紋
function shingleTexture(color, seed = 3) {
  const S = 512, rows = 8, cols = 6, rh = S / rows, cw = S / cols, r = trng(seed * 131 + 7);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), base = new THREE.Color(color);
  const tone = (v) => `rgb(${Math.round(Math.min(255, base.r * 255 * v))}, ${Math.round(Math.min(255, base.g * 255 * v))}, ${Math.round(Math.min(255, base.b * 255 * v))})`;
  const info = Array.from({ length: rows }, () => Array.from({ length: cols }, () => [0.74 + 0.4 * r(), 0.15 + 0.2 * r(), 0.45 + 0.15 * r(), 0.7 + 0.2 * r()]));
  g.fillStyle = tone(0.4);
  g.fillRect(0, 0, S, S);
  const tile = (x, y, [v, g1, g2, g3]) => {
    const w = cw - 3, h = rh + 14, rad = 13, x0 = x + 1.5;
    const path = (dy) => {
      g.beginPath();
      g.moveTo(x0, y + dy); g.lineTo(x0 + w, y + dy); g.lineTo(x0 + w, y + dy + h - rad);
      g.quadraticCurveTo(x0 + w, y + dy + h, x0 + w - rad, y + dy + h); g.lineTo(x0 + rad, y + dy + h);
      g.quadraticCurveTo(x0, y + dy + h, x0, y + dy + h - rad);
      g.closePath();
    };
    path(7); g.fillStyle = 'rgba(12,4,2,0.42)'; g.fill();   // 影子落在下一排上
    path(0); g.fillStyle = tone(v); g.fill();
    g.save();
    path(0); g.clip();
    g.fillStyle = 'rgba(255,225,200,0.15)'; g.fillRect(x, y + h - 5, cw, 5);
    g.strokeStyle = 'rgba(20,6,2,0.15)'; g.lineWidth = 1.5;
    for (const gx of [g1, g2, g3]) { g.beginPath(); g.moveTo(x + cw * gx, y + 4); g.lineTo(x + cw * gx + 2, y + h - 8); g.stroke(); }
    g.restore();
  };
  const row = (j, dy) => { for (let i = -1; i <= cols; i++) tile((i + (j % 2) * 0.5) * cw, j * rh + dy, info[j][((i % cols) + cols) % cols]); };
  for (let j = rows - 1; j >= 0; j--) row(j, 0);
  row(rows - 1, -S);   // 最下面那排壓到貼圖外的部分，接回最上面
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面、牆面時紋路才不會閃爍
  return t;
}

// 漁網：透明底上的菱形網格
function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(70, 92, 84, 1)';
  g.lineWidth = 2;
  for (let i = -128; i < 256; i += 16) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke();
    g.beginPath(); g.moveTo(i + 128, 0); g.lineTo(i, 128); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面、牆面時紋路才不會閃爍
  return t;
}

function signTexture(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#5b3a1e'; g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#e9d9b0'; g.fillRect(6, 6, 244, 84);
  g.fillStyle = '#3a2412';
  g.font = 'bold 56px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面、牆面時紋路才不會閃爍
  return t;
}

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面、牆面時紋路才不會閃爍
  return t;
}
// 水泥地。一張貼圖是 16 公尺見方（4×4 塊四公尺的板）：範圍夠大，同一道裂縫、同一塊水漬不會每隔幾公尺就重複一次。
// 畫的東西：每塊板深淺略有不同、抹平時留下的大片色差、掃帚掃過的細紋、露出來的小石粒、
// 水漬和鏽漬、補過的方塊、細裂縫、板和板之間的伸縮縫（縫邊積灰、缺角）
const CONC_M = 16;   // 一張貼圖鋪幾公尺
function concreteTexture() {
  const S = 2048, N = 4, P = S / N;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 20261;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  // 一團邊緣柔和的色塊；靠近貼圖邊緣的會在對面再畫一次，鋪起來才接得上
  const blob = (x, y, rx, ry, rot, rgb, a) => {
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        if (x + ox + rx < 0 || x + ox - rx > S || y + oy + rx < 0 || y + oy - rx > S) continue;
        g.save();
        g.translate(x + ox, y + oy);
        g.rotate(rot);
        g.scale(1, ry / rx);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        gr.addColorStop(0, `rgba(${rgb},${a})`);
        gr.addColorStop(0.55, `rgba(${rgb},${a * 0.7})`);
        gr.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = gr;
        g.beginPath(); g.arc(0, 0, rx, 0, 6.2832); g.fill();
        g.restore();
      }
    }
  };
  // 1. 每塊板是分次灌的，顏色略有差異
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const v = 0.955 + 0.075 * rnd(), warm = rnd();
      g.fillStyle = `rgb(${Math.round(201 * v)},${Math.round(197 * v)},${Math.round((187 - 7 * warm) * v)})`;
      g.fillRect(i * P, j * P, P, P);
    }
  }
  // 2. 大片的深淺
  for (let i = 0; i < 70; i++) blob(rnd() * S, rnd() * S, 110 + 200 * rnd(), 70 + 150 * rnd(), rnd() * 3.14, rnd() < 0.5 ? '255,251,242' : '104,99,90', 0.05 + 0.05 * rnd());
  // 3. 掃帚紋：每塊板各自一個方向
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      g.save();
      g.beginPath(); g.rect(i * P, j * P, P, P); g.clip();
      const ang = ((i + j) % 2 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.12, dx = Math.cos(ang), dy = Math.sin(ang);
      for (let k = 0; k < 110; k++) {
        const x = i * P + rnd() * P, y = j * P + rnd() * P, len = 80 + 320 * rnd();
        g.strokeStyle = rnd() < 0.5 ? `rgba(255,252,244,${0.03 + 0.04 * rnd()})` : `rgba(96,92,84,${0.025 + 0.035 * rnd()})`;
        g.lineWidth = 1.5 + 2.5 * rnd();
        g.beginPath(); g.moveTo(x - dx * len / 2, y - dy * len / 2); g.lineTo(x + dx * len / 2, y + dy * len / 2); g.stroke();
      }
      g.restore();
    }
  }
  // 4. 小石粒：一撮一撮的，不是均勻撒滿
  for (let k = 0; k < 260; k++) {
    const cx = rnd() * S, cy = rnd() * S, n = 5 + Math.floor(12 * rnd()), spread = 16 + 34 * rnd();
    for (let i = 0; i < n; i++) {
      g.fillStyle = rnd() < 0.6 ? `rgba(82,78,71,${0.16 + 0.16 * rnd()})` : `rgba(255,253,246,${0.25 + 0.2 * rnd()})`;
      g.beginPath(); g.arc(cx + (rnd() - 0.5) * 2 * spread, cy + (rnd() - 0.5) * 2 * spread, 1 + 1.8 * rnd(), 0, 6.2832); g.fill();
    }
  }
  // 5. 水漬、油漬、鏽漬：幾團疊在一起，中間深、邊緣不規則
  for (let k = 0; k < 16; k++) {
    const cx = rnd() * S, cy = rnd() * S, sp = 40 + 90 * rnd(), rgb = k % 4 === 0 ? '150,98,60' : '80,75,66';
    for (let i = 0, n = 5 + Math.floor(4 * rnd()); i < n; i++) blob(cx + (rnd() - 0.5) * 2 * sp, cy + (rnd() - 0.5) * 2 * sp, 40 + 70 * rnd(), 28 + 55 * rnd(), rnd() * 3.14, rgb, 0.05 + 0.045 * rnd());
  }
  // 6. 補過的地方：顏色比較新的一塊方形
  for (let k = 0; k < 3; k++) {
    const w = 130 + 150 * rnd(), h = 90 + 120 * rnd(), x = 80 + rnd() * (S - 160 - w), y = 80 + rnd() * (S - 160 - h);
    g.save();
    g.translate(x + w / 2, y + h / 2);
    g.rotate((rnd() - 0.5) * 0.08);
    g.fillStyle = 'rgba(226,223,214,0.6)';
    g.fillRect(-w / 2, -h / 2, w, h);
    g.strokeStyle = 'rgba(88,83,75,0.4)';
    g.lineWidth = 2.5;
    g.strokeRect(-w / 2, -h / 2, w, h);
    g.restore();
  }
  // 7. 細裂縫：歪歪扭扭地走，偶爾分岔，越走越細
  const crack = (x, y, ang, steps, wid) => {
    for (let i = 0; i < steps; i++) {
      const t = i / steps, nx = x + Math.cos(ang) * 13, ny = y + Math.sin(ang) * 13;
      if (nx < 20 || nx > S - 20 || ny < 20 || ny > S - 20) return;
      g.strokeStyle = 'rgba(255,253,246,0.22)';
      g.lineWidth = wid * (1 - 0.6 * t);
      g.beginPath(); g.moveTo(x + 1.5, y + 1.5); g.lineTo(nx + 1.5, ny + 1.5); g.stroke();
      g.strokeStyle = `rgba(56,52,46,${0.62 - 0.25 * t})`;
      g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      x = nx; y = ny;
      ang += (rnd() - 0.5) * 0.75;
      if (wid > 1.6 && rnd() < 0.07) crack(x, y, ang + (rnd() < 0.5 ? -1 : 1) * (0.6 + 0.5 * rnd()), Math.round(steps * 0.4), wid * 0.65);
    }
  };
  g.lineCap = 'round';
  for (let k = 0; k < 10; k++) crack(60 + rnd() * (S - 120), 60 + rnd() * (S - 120), rnd() * 6.2832, 14 + Math.floor(34 * rnd()), 1.8 + 1.4 * rnd());
  // 8. 伸縮縫：縫的兩邊積了灰，縫本身是一道深溝，一側有受光的亮邊；沿縫有些缺角
  for (let k = 0; k <= N; k++) {
    const q = k * P;
    for (const vert of [false, true]) {
      const band = vert ? g.createLinearGradient(q - 22, 0, q + 22, 0) : g.createLinearGradient(0, q - 22, 0, q + 22);
      band.addColorStop(0, 'rgba(84,79,70,0)'); band.addColorStop(0.5, 'rgba(84,79,70,0.2)'); band.addColorStop(1, 'rgba(84,79,70,0)');
      g.fillStyle = band;
      if (vert) g.fillRect(q - 22, 0, 44, S); else g.fillRect(0, q - 22, S, 44);
      g.fillStyle = 'rgba(60,56,50,0.8)';
      if (vert) g.fillRect(q - 2.5, 0, 5, S); else g.fillRect(0, q - 2.5, S, 5);
      g.fillStyle = 'rgba(255,253,246,0.4)';
      if (vert) g.fillRect(q + 2.5, 0, 2, S); else g.fillRect(0, q + 2.5, S, 2);
    }
  }
  g.fillStyle = 'rgba(60,56,50,0.75)';
  for (let k = 0; k < 46; k++) {
    const line = Math.floor(rnd() * N) * P, along = 30 + rnd() * (S - 60), vert = rnd() < 0.5, r0 = 5 + 9 * rnd(), n = 3 + Math.floor(3 * rnd()), a0 = rnd() * 6.2832;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * 6.2832, rr = r0 * (0.6 + 0.6 * rnd()), px = (vert ? line : along) + Math.cos(a) * rr, py = (vert ? along : line) + Math.sin(a) * rr;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面時紋路才不會閃爍
  return t;
}
// ---- 下雨時的水泥地 ----
// 淋到雨的地面顏色變深、斜著看過去泛一層天光；低窪的地方積水，積水像鏡子一樣映著天色，雨點打出一圈圈漣漪。
// 雨越下越久積水越大片，雨停後慢慢乾、積水慢慢縮回去。屋頂和雨棚底下淋不到雨，是乾的。
// main.js 每幀更新：wet 地面有多濕（0～1）、rain 現在雨多大、time 時間；dry 是有遮蔽的範圍 (x0, z0, x1, z1)；
// reflTex / reflMat / reflOn 是碼頭平面以上的景物鏡射出來的畫面（積水裡的倒影），沒有的時候積水只映天色
export const WET = {
  wet: { value: 0 }, rain: { value: 0 }, time: { value: 0 },
  dry: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  reflTex: { value: null }, reflMat: { value: new THREE.Matrix4() }, reflOn: { value: 0 },
};
function wetGround(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWetK = WET.wet;
    sh.uniforms.uRainK = WET.rain;
    sh.uniforms.uWetT = WET.time;
    sh.uniforms.uDry = WET.dry;
    sh.uniforms.uHome = HOME_U;
    sh.uniforms.uDeckRefl = WET.reflTex;
    sh.uniforms.uDeckReflMat = WET.reflMat;
    sh.uniforms.uDeckReflOn = WET.reflOn;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWetPos;\nvarying float vWetUp;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvWetPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvWetUp = normalize( mat3( modelMatrix ) * objectNormal ).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${homeGlsl}
uniform float uWetK;
uniform float uRainK;
uniform float uWetT;
uniform vec4 uDry[ 4 ];
uniform sampler2D uDeckRefl;
uniform mat4 uDeckReflMat;
uniform float uDeckReflOn;
varying vec3 vWetPos;
varying float vWetUp;
float wetHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float wetNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( wetHash( i ), wetHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( wetHash( i + vec2( 0.0, 1.0 ) ), wetHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// 雨點打在積水上的漣漪：地面分成一格一格，每格裡一個位置、時機都不同的圈，從一點擴開、越擴越淡
float wetRings( vec2 p, float rain ) {
	float acc = 0.0;
	for ( int k = 0; k < 2; k ++ ) {
		vec2 g = p * ( k == 0 ? 2.3 : 3.4 ) + float( k ) * 13.7, id = floor( g ), f = fract( g ) - 0.5;
		float h = wetHash( id + 3.1 );
		if ( h > rain * 0.75 ) continue;
		float t = fract( uWetT * ( 0.8 + 0.6 * wetHash( id + 9.7 ) ) + h * 11.0 );
		vec2 c = ( vec2( wetHash( id + 1.7 ), wetHash( id + 5.3 ) ) - 0.5 ) * 0.45;
		float size = 0.22 + 0.2 * wetHash( id + 2.9 );   // 有大圈有小圈
		acc += ( 1.0 - smoothstep( 0.0, 0.05, abs( length( f - c ) - t * size ) ) ) * ( 1.0 - t ) * ( 1.0 - t );
	}
	return acc;
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
	float wetHere = 0.0, wetPud = 0.0;
	if ( uWetK > 0.001 && vWetUp > 0.5 ) {
		vec2 wq = homeLocal( vWetPos.xz );   // 淋不到雨的範圍、積水的位置都用港座標
		float roof = 0.0;
		for ( int i = 0; i < 4; i ++ ) {
			vec4 r = uDry[ i ];
			roof = max( roof, 1.0 - smoothstep( - 0.7, 0.3, max( max( r.x - wq.x, wq.x - r.z ), max( r.y - wq.y, wq.y - r.w ) ) ) );
		}
		wetHere = uWetK * ( 1.0 - roof );
		float low = wetNoise( wq * 0.33 ) * 0.65 + wetNoise( wq * 0.9 + 7.3 ) * 0.35;
		float deep = low - ( 0.81 - 0.17 * wetHere );   // 大於 0 的地方有積水；濕透了也只有最低的那一成多會積
		float flatK = smoothstep( 0.05, 0.3, wetHere ) * step( 0.996, vWetUp );   // 斜坡上積不了水
		wetPud = smoothstep( 0.0, 0.025, deep ) * flatK;
		float rim = ( 1.0 - smoothstep( 0.0, 0.03, abs( deep ) ) ) * flatK;   // 水邊一圈顏色最深
		diffuseColor.rgb *= mix( 1.0, 0.6, wetHere ) * mix( 1.0, 0.7, wetPud ) * ( 1.0 - 0.22 * rim );
	}`)
      .replace('#include <opaque_fragment>', `#if NUM_HEMI_LIGHTS > 0
	if ( wetHere > 0.0 ) {
		float wetF = 0.1 + 0.9 * pow( 1.0 - saturate( dot( normalize( vViewPosition ), normal ) ), 3.0 );   // 越斜著看，映出來的天光越多
		vec3 wetSky = hemisphereLights[ 0 ].skyColor * 0.5;
		vec3 wetRefl = wetSky;
		if ( uDeckReflOn > 0.5 && vWetUp > 0.996 ) {
			// 積水映出碼頭上的東西（旗子、柱子、棚子、人）；沒被東西擋到的地方映的是天。雨點讓倒影微微晃動
			vec4 rc = uDeckReflMat * vec4( vWetPos, 1.0 );
			vec2 wob = vec2( wetNoise( vWetPos.xz * 2.7 + uWetT * 0.7 ), wetNoise( vWetPos.xz * 2.7 - uWetT * 0.6 + 5.0 ) ) - 0.5;
			vec4 rt = texture2D( uDeckRefl, rc.xy / rc.w + wob * 0.006 * ( 0.3 + uRainK ) );
			wetRefl = mix( wetSky, rt.rgb * 0.85, clamp( rt.a, 0.0, 1.0 ) );   // 水裡的倒影比本尊暗一點
		}
		outgoingLight = mix( outgoingLight, wetRefl, wetPud * wetF ) + wetRefl * wetF * 0.22 * wetHere * ( 1.0 - wetPud );
		if ( wetPud > 0.0 && uRainK > 0.02 ) outgoingLight += wetSky * 0.4 * wetPud * wetRings( vWetPos.xz, uRainK );
	}
	#endif
	#include <opaque_fragment>`);
  };
  return mat;
}
// 石砌的護岸、擋土牆：一排一排錯開的石塊，每塊寬窄、深淺、冷暖都不一樣，邊角是圓的，
// 上緣亮、下緣暗（看得出一塊塊凸出來），有幾塊缺了角、有幾塊裂了一道；石塊之間是深色的灰縫
const seawallTexture = () => canvasTex(512, 512, (g) => {
  const r = trng(4242), S = 512, rows = 8, rh = S / rows;
  const rr = (x, y, w, h, q) => { g.beginPath(); g.moveTo(x + q, y); g.arcTo(x + w, y, x + w, y + h, q); g.arcTo(x + w, y + h, x, y + h, q); g.arcTo(x, y + h, x, y, q); g.arcTo(x, y, x + w, y, q); g.closePath(); };
  const MORTAR = 'rgb(90,86,80)';
  g.fillStyle = MORTAR;
  g.fillRect(0, 0, S, S);
  for (let j = 0; j < rows; j++) {
    const ws = [0, 0, 0, 0].map(() => 0.72 + 0.6 * r()), sum = ws.reduce((a, b) => a + b, 0), y = j * rh;
    let x = r() * S;
    for (const wk of ws) {
      const w = (wk / sum) * S, v = 136 + 44 * r(), warm = r() < 0.7 ? 1 : -1, crack = r() < 0.2, chip = r() < 0.18, cx = 0.2 + 0.6 * r(), side = r() < 0.5, cs = 9 + 12 * r();
      // 裂縫：從上緣（或下緣）歪歪斜斜地裂進來，有長有短
      const up = r() < 0.5, cl = 0.45 + 0.55 * r(), kink = [0, 1, 2, 3].map((i) => [(r() - 0.5) * 16, (i + 0.6 + 0.4 * r()) / 4]);
      for (const ox of [-S, 0, S]) {
        const bx = x + ox + 3, by = y + 3, bw = w - 6, bh = rh - 6;
        rr(bx, by, bw, bh, 7);
        g.fillStyle = `rgb(${Math.round(v + 3 * warm)},${Math.round(v)},${Math.round(v - 8 * warm)})`;
        g.fill();
        g.save();
        g.clip();
        const gr = g.createLinearGradient(0, by, 0, by + bh);
        gr.addColorStop(0, 'rgba(255,255,255,0.13)'); gr.addColorStop(0.45, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.16)');
        g.fillStyle = gr; g.fillRect(bx, by, bw, bh);
        g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(bx, by, bw, 2.5);
        if (crack) {
          g.strokeStyle = 'rgba(50,47,44,0.6)'; g.lineWidth = 1.6; g.lineJoin = 'round';
          g.beginPath(); g.moveTo(bx + bw * cx, up ? by + bh : by);
          let ox2 = 0;
          for (const [kx, ky] of kink) { ox2 += kx; const yy = ky * cl * bh; g.lineTo(bx + bw * cx + ox2, up ? by + bh - yy : by + yy); }
          g.stroke();
        }
        if (chip) {
          g.fillStyle = MORTAR;
          g.beginPath();
          if (side) { g.moveTo(bx - 1, by + bh - cs); g.lineTo(bx + cs * 1.5, by + bh + 1); g.lineTo(bx - 1, by + bh + 1); } else { g.moveTo(bx + bw + 1, by + bh - cs); g.lineTo(bx + bw - cs * 1.5, by + bh + 1); g.lineTo(bx + bw + 1, by + bh + 1); }
          g.fill();
        }
        g.restore();
      }
      x += w;
    }
  }
});
// 泡在海裡的牆面：水面附近一圈顏色深（濕的），水線上下長著一道青苔，邊緣高高低低
function tideBand(mat) {
  mat.customProgramCacheKey = () => 'tide';
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTideW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvTideW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTideW;')
      .replace('#include <color_fragment>', `#include <color_fragment>
	float tideQ = vTideW.x + vTideW.z;
	float tideY = vTideW.y + 0.05 * sin( tideQ * 1.7 ) + 0.03 * sin( tideQ * 4.3 + 1.0 );
	diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.62, 0.64, 0.67 ), 1.0 - smoothstep( 0.32, 0.40, tideY ) );
	float tideWeed = smoothstep( -0.30, -0.05, tideY ) * ( 1.0 - smoothstep( 0.14, 0.22, tideY ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.13, 0.22, 0.10 ), 0.5 * tideWeed );`);
  };
  return mat;
}
const stripeTexture = (a, b) => canvasTex(64, 16, (g) => { for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(i * 16, 0, 16, 16); } });
const tinTexture = () => canvasTex(64, 16, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#6f8ea3' : '#84a5b8'; g.fillRect(i * 8, 0, 8, 16); } });
// 大漁旗：紅太陽、藍色的浪、兩個大字
const flagTexture = (text, bg) => canvasTex(256, 160, (g) => {
  g.fillStyle = bg; g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#e8402e'; g.beginPath(); g.arc(196, 52, 34, 0, 6.3); g.fill();
  g.fillStyle = '#2a63b8';
  for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(22 + i * 44, 168, 34, Math.PI, 0); g.fill(); }
  g.fillStyle = '#fff'; g.strokeStyle = '#1c2f55'; g.lineWidth = 6;
  g.font = 'bold 76px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.strokeText(text, 100, 74); g.fillText(text, 100, 74);
}, false);

// 立在水裡的木樁（給淺水模擬當障礙物）
export const PILES = [];
export const BOLLARDS = [];  // 岸壁上的繫纜樁：{ x, z, y }（y 是纜繩套在樁上的高度）。船的纜繩可以綁在上面

// 繫船的纜繩：從船舷拉到岸上的繫纜樁。繩子比兩頭的距離長時中間垂下去（垂到水面就浮在水上），拉緊了就是直的
export class MoorLine {
  constructor() {
    const SEG = this.SEG = 14, RING = this.RING = 5;
    const g = new THREE.BufferGeometry(), idx = [];
    this.pos = new THREE.BufferAttribute(new Float32Array((SEG + 1) * RING * 3), 3);
    this.nor = new THREE.BufferAttribute(new Float32Array((SEG + 1) * RING * 3), 3);
    g.setAttribute('position', this.pos); g.setAttribute('normal', this.nor);
    for (let i = 0; i < SEG; i++) for (let k = 0; k < RING; k++) {
      const a = i * RING + k, b = i * RING + (k + 1) % RING, c = a + RING, d = b + RING;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xb59a68 }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this._p = new THREE.Vector3(); this._q = new THREE.Vector3(); this._t = new THREE.Vector3(); this._n1 = new THREE.Vector3(); this._n2 = new THREE.Vector3();
  }

  // a：船上那一頭；b：樁上那一頭；len：繩長；floor：水面的高度（繩子不會沉到水面下）；
  // via：繩子翻過岸壁邊緣的那一點（有的話，樁到邊緣這段貼著碼頭面走，邊緣到船那段才垂下去）
  set(a, b, len, floor, via = null) {
    const { SEG, RING, _p: p, _q: q, _t: t, _n1: n1, _n2: n2 } = this, P = this.pos.array, N = this.nor.array, R = 0.035;
    const e = via || b, cut = via ? 0.75 : 1;   // 前四分之三的節數給垂下去的那一段
    const d = a.distanceTo(e), hang = len - (via ? via.distanceTo(b) : 0);
    const sag = Math.sqrt(Math.max(0, 3 * d * (hang - d) / 8));   // 拋物線近似：弧長 ≈ 距離 + 8·垂度²／(3·距離)
    const at = (s, out) => {
      if (s > cut) return out.lerpVectors(via, b, (s - cut) / (1 - cut));
      const u = s / cut;
      out.lerpVectors(a, e, u);
      out.y = Math.max(out.y - sag * 4 * u * (1 - u), Math.min(floor + R, a.y, e.y));
      return out;
    };
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG;
      at(s, p);
      t.subVectors(at(Math.min(1, s + 0.02), q), at(Math.max(0, s - 0.02), n1)).normalize();
      n1.set(-t.z, 0, t.x);
      if (n1.lengthSq() < 1e-6) n1.set(1, 0, 0);
      n1.normalize(); n2.crossVectors(t, n1);
      for (let k = 0; k < RING; k++) {
        const ang = k / RING * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang), v = (i * RING + k) * 3;
        const nx = c * n1.x + sn * n2.x, ny = c * n1.y + sn * n2.y, nz = c * n1.z + sn * n2.z;
        P[v] = p.x + R * nx; P[v + 1] = p.y + R * ny; P[v + 2] = p.z + R * nz;
        N[v] = nx; N[v + 1] = ny; N[v + 2] = nz;
      }
    }
    this.pos.needsUpdate = this.nor.needsUpdate = true;
    this.mesh.visible = true;
  }
}

export const SOLIDS = [];   // 棧板上擋路的東西（高出棧板的樁、燈柱、木桶、木箱、繫纜樁）：{ x, z, r }

export function makeHarbor(bedAt) {
  const group = new THREE.Group();
  const deckTex = plankTexture([150, 108, 66], 1);
  const wallTex = plankTexture([176, 138, 92], 2, false);   // 牆板是整片的，沒有接縫
  const darkTex = plankTexture([118, 80, 46], 3);            // 門、櫃檯：深色的木板
  const postMat = new THREE.MeshLambertMaterial({ color: 0x4a3320 });
  const darkWood = new THREE.MeshLambertMaterial({ color: 0x5b3d22 });

  // 木板材質：依實際尺寸設定紋理重複次數，木板寬度才一致
  const planks = (tex, w, d, alongZ) => {
    const t = tex.clone();
    t.needsUpdate = true;
    if (alongZ) { t.rotation = Math.PI / 2; t.repeat.set(d / 1.2, w / 2.4); } else t.repeat.set(w / 2.4, d / 1.2);
    return new THREE.MeshLambertMaterial({ map: t });
  };
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  const post = (x, z, top = DECK_Y + 0.7, r = 0.13) => {
    const bottom = Math.min(bedAt(x, z), 0) - 0.6;
    if (bedAt(x, z) < 0.5) PILES.push({ x, z, r });
    if (top > DECK_Y + 0.3) SOLIDS.push({ x, z, r: r + 0.12 });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, top - bottom, 8), postMat);
    m.position.set(x, (top + bottom) / 2, z);
    group.add(m);
  };

  // ---- 岸壁與防波堤：水泥平台，側面是石砌的護岸，直直插進海裡 ----
  const concTex = concreteTexture(), sideTex = seawallTexture();
  const texMat = (tex, rx, ry, extra = {}) => { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshLambertMaterial({ map: t, ...extra }); };
  const plain = (color) => new THREE.MeshLambertMaterial({ color });
  const concPlain = plain(0xbdb9ae), yellow = wetGround(plain(0xe8b820)), tyre = plain(0x1c1c1e), red = plain(0xd23a2a), ink = plain(0x2a2623);
  DECKS.forEach((r) => {
    const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    box(w, 0.3, d, wetGround(texMat(concTex, w / CONC_M, d / CONC_M)), cx, DECK_Y - 0.15, cz);
    box(w - 0.24, 11, d - 0.24, tideBand(texMat(sideTex, Math.max(w, d) / 3.2, 5.5)), cx, DECK_Y - 0.3 - 5.5, cz);
  });
  // 靠山那一側的擋土牆：石砌的牆面，上緣一道水泥壓頂
  box(58, 4.6, 1.1, texMat(sideTex, 58 / 3.2, 4.6 / 2), -4, 0.3 + 2.3, 100.25);
  box(58.3, 0.25, 1.4, concPlain, -4, 4.72, 100.25);
  // 靠水那一側的黃線
  box(48, 0.02, 0.3, yellow, -6, DECK_Y + 0.011, 117.72);
  box(0.3, 0.02, 38, yellow, 18.28, DECK_Y + 0.011, 137);
  box(28, 0.02, 0.3, yellow, 4, DECK_Y + 0.011, 156.28);
  // 防波堤靠外海那一側的胸牆
  box(0.8, 1.15, 42, concPlain, 21.6, DECK_Y + 0.575, 139);
  box(32, 1.15, 0.8, concPlain, 6, DECK_Y + 0.575, 159.6);
  // 消波塊：四隻腳的水泥塊，沿著防波堤外側亂堆兩層
  {
    const legs = [[0, 1, 0], [0.943, -0.333, 0], [-0.471, -0.333, 0.816], [-0.471, -0.333, -0.816]].map(([x, y, z]) => {
      const g = new THREE.CylinderGeometry(0.2, 0.37, 1.05, 7).translate(0, 0.55, 0);
      return g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, y, z).normalize()));
    });
    const geo = mergeGeometries(legs);
    const spots = [];
    let seed = 7;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const put = (x, z, k) => spots.push([x + (rnd() - 0.5) * 0.7, [0.75, -0.1, -0.75][k] + rnd() * 0.35, z + (rnd() - 0.5) * 0.7]);
    for (let z = 119; z < 164; z += 1.7) for (const k of [0, 1, 2]) put(23.1 + k * 1.7, z, k);
    for (let x = -13; x < 23; x += 1.7) for (const k of [0, 1, 2]) put(x, 161.1 + k * 1.7, k);
    for (let z = 155.5; z < 161; z += 1.7) for (const k of [0, 1]) put(-11.1 - k * 1.7, z, k);
    const tetra = new THREE.InstancedMesh(geo, plain(0xb3afa4), spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    spots.forEach(([x, y, z], i) => {
      const k = 1.05 + 0.3 * rnd();
      q.setFromEuler(e.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28));
      tetra.setMatrixAt(i, m4.compose(v.set(x, y, z), q, sc.set(k, k, k)));
      HARBOR_ROCKS.push({ x, z, r: 1.35, top: y + 1.0 });
    });
    tetra.computeBoundingSphere();
    group.add(tetra);
  }
  // 岸壁上掛著的輪胎防撞墊
  for (let x = -28; x < 18; x += 4.6) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.15, 8, 16), tyre);
    t.position.set(x, 0.62, 118.1);
    group.add(t);
    box(0.03, 0.6, 0.03, ink, x, 1.0, 118.06);
  }
  // 船揚場：鋪在斜坡上的水泥面
  {
    const R = HOME.ramp, len = Math.hypot(R.z1 - R.z0, R.top - R.bottom);
    const slab = box(R.x1 - R.x0 - 0.3, 0.1, len, wetGround(texMat(concTex, (R.x1 - R.x0) / CONC_M, len / CONC_M)), (R.x0 + R.x1) / 2, (R.top + R.bottom) / 2, (R.z0 + R.z1) / 2);
    slab.rotation.x = Math.atan2(R.top - R.bottom, R.z1 - R.z0);
  }
  // 防波堤尾端的紅燈標
  {
    const bx = -8.2, bz = 158;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 3.6, 14), red);
    tower.position.set(bx, DECK_Y + 1.8, bz);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.7, 14), plain(0xf2efe6));
    band.position.set(bx, DECK_Y + 1.6, bz);
    const deckRing = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.12, 14), ink);
    deckRing.position.set(bx, DECK_Y + 3.66, bz);
    const lampB = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.55, 12), bulb(0xff6a4a, 1.2));
    lampB.position.set(bx, DECK_Y + 4.0, bz);
    const capB = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), red);
    capB.position.set(bx, DECK_Y + 4.27, bz);
    group.add(tower, band, deckRing, lampB, capB);
    SOLIDS.push({ x: bx, z: bz, r: 0.85 });
  }

  // ---- 商店：一間木屋，面海開門，有櫃檯、雨棚和招牌 ----
  {
    const s = SHOP, { w, d } = s, h = 3.4, y0 = DECK_Y;
    const wt = wallTex.clone(); wt.needsUpdate = true; wt.rotation = Math.PI / 2; wt.repeat.set(1, w / 1.8);   // 直的牆板，一片從牆腳到屋簷
    box(w, h, d, new THREE.MeshLambertMaterial({ map: wt }), s.x, y0 + h / 2, s.z);
    // 斜屋頂：兩片木瓦屋面（屋簷外伸）、屋脊、兩端的山牆
    const rh = 2.9, hd = d / 2 + 1.05, sl = Math.hypot(hd, rh), ang = Math.atan2(rh, hd);   // Q 版：屋頂又高又大、屋簷伸得很出來
    const shingle = shingleTexture(s.roof);
    shingle.repeat.set((w + 2.2) / 2.2, sl / 1.4);
    // 兩片屋面的貼圖方向相反：都要是「上一排壓下一排、圓角朝屋簷」
    const shingleB = shingle.clone(); shingleB.needsUpdate = true; shingleB.repeat.set((w + 2.2) / 2.2, -sl / 1.4);
    for (const side of [-1, 1]) {
      box(w + 2.2, 0.36, sl + 0.3, new THREE.MeshLambertMaterial({ map: side > 0 ? shingle : shingleB }), s.x, y0 + h + rh / 2 + 0.1, s.z + side * hd / 2).rotation.x = side * ang;
    }
    box(w + 2.4, 0.34, 0.7, darkWood, s.x, y0 + h + rh + 0.16, s.z);
    const yEdge = rh * (1 - d / 2 / hd);
    const gable = new THREE.Shape([[-d / 2, 0], [d / 2, 0], [d / 2, yEdge], [0, rh], [-d / 2, yEdge]].map(([a, b]) => new THREE.Vector2(a, b)));
    const gt = wallTex.clone(); gt.needsUpdate = true; gt.repeat.set(0.55, 0.9);
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.ShapeGeometry(gable).rotateY(Math.PI / 2), new THREE.MeshLambertMaterial({ map: gt, side: THREE.DoubleSide }));
      m.position.set(s.x + side * (w / 2 - 0.02), y0 + h, s.z);
      group.add(m);
    }
    // 牆角的立柱與牆腳的橫木
    for (const px of [-1, 1]) for (const pz of [-1, 1]) box(0.2, h, 0.2, darkWood, s.x + px * w / 2, y0 + h / 2, s.z + pz * d / 2);
    box(w + 0.1, 0.22, d + 0.1, darkWood, s.x, y0 + 0.11, s.z);
    // 窗戶：兩側牆各兩扇，晚上透出燈光
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x2a3844, emissive: 0xffb45a, emissiveIntensity: 0 });
    GLOW.push(glassMat);
    for (const side of [-1, 1]) {
      for (const wz of [-1.5, 1.3]) {
        const wx = s.x + side * (w / 2 + 0.03);
        box(0.1, 1.25, 1.35, darkWood, wx, y0 + 1.85, s.z + wz);
        box(0.12, 1.0, 1.1, glassMat, wx + side * 0.01, y0 + 1.85, s.z + wz);
        box(0.14, 1.0, 0.06, darkWood, wx + side * 0.01, y0 + 1.85, s.z + wz);
        box(0.14, 0.06, 1.1, darkWood, wx + side * 0.01, y0 + 1.85, s.z + wz);
        box(0.22, 0.07, 1.5, darkWood, wx + side * 0.05, y0 + 1.2, s.z + wz);   // 窗台
      }
    }
    // 門框與門把
    box(0.14, 2.5, 0.2, darkWood, s.x - 3.52, y0 + 1.25, s.z + d / 2 + 0.05);
    box(0.14, 2.5, 0.2, darkWood, s.x - 2.08, y0 + 1.25, s.z + d / 2 + 0.05);
    box(1.6, 0.14, 0.2, darkWood, s.x - 2.8, y0 + 2.45, s.z + d / 2 + 0.05);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshLambertMaterial({ color: 0xb8923a }));
    knob.position.set(s.x - 2.3, y0 + 1.1, s.z + d / 2 + 0.15);
    group.add(knob);
    // 屋頂上的煙囪
    const iron = new THREE.MeshLambertMaterial({ color: 0x2b2d2f });
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.7, 12), iron);
    pipe.position.set(s.x + 2.6, y0 + h + rh * 0.62 + 0.85, s.z - 1.1);
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.34, 12), iron);
    hood.position.set(s.x + 2.6, y0 + h + rh * 0.62 + 1.87, s.z - 1.1);
    group.add(pipe, hood);
    // 雨棚的撐桿
    for (const px of [-0.4, 3.6]) box(0.07, 1.65, 0.07, darkWood, s.x + px, y0 + 1.72, s.z + d / 2 + 1.72);
    { const dt = darkTex.clone(); dt.needsUpdate = true; dt.rotation = Math.PI / 2; dt.repeat.set(2.3 / 2.4, 1.3 / 1.2); box(1.3, 2.3, 0.16, new THREE.MeshLambertMaterial({ map: dt }), s.x - 2.8, y0 + 1.15, s.z + d / 2 + 0.04); }   // 門：直的木板
    box(3.6, 1.0, 0.9, planks(darkTex, 3.6, 1.0, false), s.x + 1.6, y0 + 0.5, s.z + d / 2 + 0.45);   // 櫃檯：橫的木板
    box(4.2, 0.12, 1.9, new THREE.MeshLambertMaterial({ color: s.roof }), s.x + 1.6, y0 + 2.6, s.z + d / 2 + 0.9).rotation.x = 0.22;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.1), new THREE.MeshBasicMaterial({ map: signTexture(s.name) }));
    UNLIT.push(sign.material);
    sign.position.set(s.x - 2.8, y0 + h - 0.42, s.z + hd + 0.2);   // 招牌掛在門口上方的屋簷下
    group.add(sign);
    box(3.2, 1.3, 0.12, darkWood, s.x - 2.8, y0 + h - 0.42, s.z + hd + 0.12);
  }

  // ---- 商品架：長桌、商品模型、價格牌 ----
  {
    const tableY = DECK_Y + 0.85;
    const tw = SHELF_X[1] - SHELF_X[0] - 0.3, tx = (SHELF_X[0] + SHELF_X[1]) / 2;
    box(tw, 0.08, 1.1, planks(deckTex, tw, 1.1, false), tx, tableY, SHELF_Z);
    for (const x of [tx - tw / 2 + 0.3, tx, tx + tw / 2 - 0.3]) for (const z of [SHELF_Z - 0.45, SHELF_Z + 0.45]) box(0.1, 0.85, 0.1, darkWood, x, DECK_Y + 0.42, z);
    const iron = new THREE.MeshLambertMaterial({ color: 0x2b2d2f }), crate = new THREE.MeshLambertMaterial({ color: 0xa9824e });
    SHELF.forEach((it, i) => {
      const y = tableY + 0.04;
      if (it.id === 'fuel') {
        const can = makeCanMesh();
        can.position.set(it.x, y + 0.18, SHELF_Z);
        can.rotation.y = 0.4;
        group.add(can);
      } else if (it.id === 'wrench') {
        // 扳手：一根柄，一頭是開口的鉗口
        const w = new THREE.Group();
        const part = (bw, bd, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.035, bd), iron); m.position.set(x, 0, z); w.add(m); };
        part(0.46, 0.06, 0, 0); part(0.06, 0.2, 0.25, 0); part(0.1, 0.05, 0.31, 0.075); part(0.1, 0.05, 0.31, -0.075);
        w.position.set(it.x - 0.05, y + 0.02, SHELF_Z);
        w.rotation.y = 0.5;
        group.add(w);
      } else if (it.id === 'rod') {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.025, 1.5, 6), new THREE.MeshLambertMaterial({ color: 0x3b2a1a }));
        rod.position.set(it.x, y + 0.35, SHELF_Z); rod.rotation.z = 1.1;
        group.add(rod);
      } else if (it.id === 'box') {
        box(0.5, 0.04, 0.4, crate, it.x, y + 0.02, SHELF_Z);
        box(0.5, 0.28, 0.04, crate, it.x, y + 0.14, SHELF_Z - 0.2); box(0.5, 0.28, 0.04, crate, it.x, y + 0.14, SHELF_Z + 0.2);
        box(0.04, 0.28, 0.4, crate, it.x - 0.25, y + 0.14, SHELF_Z); box(0.04, 0.28, 0.4, crate, it.x + 0.25, y + 0.14, SHELF_Z);
      } else if (it.id === 'engine') {
        box(0.5, 0.32, 0.34, iron, it.x, y + 0.16, SHELF_Z);
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), iron);
        pipe.position.set(it.x + 0.12, y + 0.5, SHELF_Z);
        group.add(pipe);
        box(0.18, 0.1, 0.18, new THREE.MeshLambertMaterial({ color: 0xb8923a }), it.x - 0.12, y + 0.37, SHELF_Z);
      } else {
        // 船：桌上擺一艘縮小的模型
        const S = BOAT_TYPES[it.id], k = 1.15 / S.len;
        const m = buildBoatMesh(S);
        m.userData.helmsman.visible = false;
        m.scale.setScalar(k);
        m.position.set(it.x, y + S.draft * k, SHELF_Z);
        group.add(m);
      }
      post(it.x, SHELF_Z - 0.48, DECK_Y + 1.5, 0.035);
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.78), new THREE.MeshBasicMaterial({ map: tags[i].t }));
      tag.position.set(it.x, DECK_Y + 1.95, SHELF_Z - 0.44);
      UNLIT.push(tag.material);
      group.add(tag);
      box(1.33, 0.86, 0.05, darkWood, it.x, DECK_Y + 1.95, SHELF_Z - 0.48);
      setTag(i, [it.id, '', '']);
    });
  }

  // ---- 賣魚的籃子、電子板、按鈕 ----
  {
    const wicker = new THREE.MeshLambertMaterial({ color: 0xb88a4a, side: THREE.DoubleSide });
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.46, 0.5, 14, 1, true), wicker);
    rim.position.set(SELL.basket.x, DECK_Y + 0.25, SELL.basket.z);
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 14), wicker);
    bottom.position.set(SELL.basket.x, DECK_Y + 0.04, SELL.basket.z);
    group.add(rim, bottom);
    post(SELL.board.x - 0.6, SELL.board.z, DECK_Y + 2.5, 0.06);
    post(SELL.board.x + 0.6, SELL.board.z, DECK_Y + 2.5, 0.06);
    box(1.5, 0.8, 0.08, new THREE.MeshLambertMaterial({ color: 0x1b1f22 }), SELL.board.x, DECK_Y + 2.05, SELL.board.z);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.68), new THREE.MeshBasicMaterial({ map: boardTex }));
    screen.position.set(SELL.board.x, DECK_Y + 2.05, SELL.board.z + 0.045);
    group.add(screen);
    setBoard(['把魚放進籃子', '$0']);
    post(SELL.button.x, SELL.button.z, DECK_Y + 1.0, 0.07);
    box(0.3, 0.12, 0.3, darkWood, SELL.button.x, DECK_Y + 1.02, SELL.button.z);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 12), new THREE.MeshLambertMaterial({ color: 0xd8342a }));
    btn.position.set(SELL.button.x, DECK_Y + 1.12, SELL.button.z);
    group.add(btn);
  }

  // ---- 商店門口：暖簾和紅燈籠（晚上會亮） ----
  {
    const s = SHOP, fz = s.z + s.d / 2, navy = plain(0x27446e);
    for (let i = 0; i < 3; i++) box(0.4, 0.55, 0.03, navy, s.x - 3.23 + i * 0.43, DECK_Y + 2.12, fz + 0.16);
    box(1.5, 0.05, 0.05, ink, s.x - 2.8, DECK_Y + 2.42, fz + 0.16);
    const paper = new THREE.MeshLambertMaterial({ color: 0xd8402e, emissive: 0xff6a30, emissiveIntensity: 0 });
    GLOW.push(paper);
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), paper);
    lantern.scale.y = 1.3;
    lantern.position.set(s.x - 1.75, DECK_Y + 2.15, fz + 0.75);
    group.add(lantern);
    for (const dy of [0.33, -0.33]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 10), ink); c.position.set(s.x - 1.75, DECK_Y + 2.15 + dy, fz + 0.75); group.add(c); }
    box(0.02, 0.5, 0.02, ink, s.x - 1.75, DECK_Y + 2.7, fz + 0.75);
  }

  // ---- 攤位：商品桌上方的紅白條紋遮雨棚 ----
  {
    const cx = (SHELF_X[0] + SHELF_X[1]) / 2, w = SHELF_X[1] - SHELF_X[0] + 0.7;
    const tent = box(w, 0.07, 3.0, texMat(stripeTexture('#d9463a', '#f4efe2'), w / 1.6, 1, { side: THREE.DoubleSide }), cx, DECK_Y + 2.72, SHELF_Z + 0.55);
    tent.rotation.x = 0.17;
    for (const x of [SHELF_X[0] - 0.25, SHELF_X[1] + 0.25]) { post(x, SHELF_Z - 0.85, DECK_Y + 2.95, 0.055); post(x, SHELF_Z + 1.95, DECK_Y + 2.48, 0.055); }
  }

  // ---- 自動販賣機：兩台並排，晚上面板會亮 ----
  {
    const panel = new THREE.MeshLambertMaterial({ color: 0xe6edf0, emissive: 0xfff3d6, emissiveIntensity: 0 });
    GLOW.push(panel);
    [[-14.62, 0xd2382e], [-13.48, 0x2f7fd0]].forEach(([x, color]) => {
      box(1.0, 1.85, 0.72, plain(color), x, DECK_Y + 0.925, 105.32);
      box(0.84, 0.95, 0.04, panel, x, DECK_Y + 1.25, 105.69);
      box(0.84, 0.22, 0.04, ink, x, DECK_Y + 0.38, 105.69);
      for (let i = 0; i < 4; i++) box(0.12, 0.26, 0.05, plain([0xf2c21e, 0x3fae5a, 0xd2382e, 0xf4f4f4][i]), x - 0.3 + i * 0.2, DECK_Y + 1.3, 105.71);
    });
  }

  // ---- 魚市場：鐵皮屋頂的棚子，底下堆著魚箱、保麗龍箱，還有一張秤魚的桌子 ----
  {
    const x0 = 1.5, x1 = 15.5, z0 = 104.6, z1 = 110.4, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, top = DECK_Y + 3.0;
    for (const x of [x0 + 0.4, cx, x1 - 0.4]) for (const z of [z0 + 0.4, z1 - 0.4]) post(x, z, top, 0.11);
    const rh = 1.1, hd = (z1 - z0) / 2 + 0.9, sl = Math.hypot(hd, rh), ang = Math.atan2(rh, hd), tin = tinTexture();
    for (const side of [-1, 1]) box(x1 - x0 + 1.4, 0.12, sl + 0.1, texMat(tin, (x1 - x0) / 1.2, 1), cx, top + rh / 2, cz + side * hd / 2).rotation.x = side * ang;
    box(x1 - x0 + 1.5, 0.16, 0.3, ink, cx, top + rh + 0.03, cz);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.1), new THREE.MeshBasicMaterial({ map: signTexture('魚市場') }));
    UNLIT.push(sign.material);
    sign.position.set(cx - 3.2, DECK_Y + 2.5, z1 - 0.28);
    group.add(sign);
    box(3.6, 1.3, 0.1, darkWood, cx - 3.2, DECK_Y + 2.5, z1 - 0.36);
    // 魚箱：藍的橘的疊成好幾疊
    const blue = plain(0x2f74c0), orange = plain(0xee8a2a), foam = plain(0xf3f3ef);
    [[3.0, 105.5, 5, blue], [3.75, 105.45, 3, orange], [4.5, 105.55, 4, blue], [3.4, 106.35, 2, orange], [4.2, 106.4, 3, blue]].forEach(([x, z, n, mat]) => {
      for (let k = 0; k < n; k++) box(0.66, 0.3, 0.46, mat, x + ((k * 7) % 3 - 1) * 0.02, DECK_Y + 0.15 + k * 0.3, z).rotation.y = ((k * 5) % 3 - 1) * 0.05;
    });
    [[12.0, 105.5, 3], [12.85, 105.55, 2], [13.3, 106.2, 1], [12.3, 106.2, 2]].forEach(([x, z, n]) => {
      for (let k = 0; k < n; k++) box(0.74, 0.42, 0.54, foam, x, DECK_Y + 0.21 + k * 0.42, z).rotation.y = ((k * 3) % 3 - 1) * 0.08;
    });
    // 秤魚的桌子和磅秤
    box(2.5, 0.08, 1.0, planks(deckTex, 2.5, 1.0, false), 8.9, DECK_Y + 0.85, 105.75);
    for (const x of [7.8, 10.0]) for (const z of [105.35, 106.15]) box(0.09, 0.85, 0.09, darkWood, x, DECK_Y + 0.42, z);
    box(0.5, 0.12, 0.4, plain(0x7c8a93), 9.4, DECK_Y + 0.95, 105.75);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 16), plain(0xf2f2ee));
    dial.rotation.x = Math.PI / 2;
    dial.position.set(9.4, DECK_Y + 1.3, 105.75);
    group.add(dial);
    box(0.06, 0.3, 0.06, plain(0x7c8a93), 9.4, DECK_Y + 1.1, 105.75);
  }

  // ---- 大漁旗：魚市場旁邊三根旗桿 ----
  // 旗子從旗桿往東飄 1.9 公尺寬：相鄰兩根旗桿至少要隔 2.3 公尺，旗子才不會疊在一起
  [[0.3, '大漁', '#f4efe2'], [-2.2, '豐收', '#f6d24a'], [16.6, '大漁', '#f4efe2']].forEach(([x, text, bg], i) => {
    post(x, 110.9, DECK_Y + 5.2, 0.05);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.2, 6, 1), new THREE.MeshLambertMaterial({ map: flagTexture(text, bg), side: THREE.DoubleSide }));
    const p = flag.geometry.attributes.position;
    for (let k = 0; k < p.count; k++) p.setZ(k, 0.09 * Math.sin(p.getX(k) * 3.2 + i));   // 被風吹得微微起伏
    flag.geometry.computeVertexNormals();
    flag.position.set(x + 1.0, DECK_Y + 4.5, 110.9);
    group.add(flag);
  });

  // ---- 岸壁上的雜物：木桶、木箱、繫纜樁、纜繩、吊桿 ----
  const barrelMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2e });
  const crateMat = new THREE.MeshLambertMaterial({ map: plankTexture([170, 128, 78], 4, false) });
  const barrelGeo = new THREE.LatheGeometry([[0, 0], [0.29, 0], [0.35, 0.2], [0.375, 0.425], [0.35, 0.65], [0.29, 0.85], [0.26, 0.85], [0.26, 0.8], [0, 0.8]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
  const hoopGeo = new THREE.TorusGeometry(1, 0.016, 5, 16).rotateX(Math.PI / 2);
  const hoopMat = new THREE.MeshLambertMaterial({ color: 0x25221f });
  const barrel = (x, z) => {
    const m = new THREE.Mesh(barrelGeo, barrelMat);
    m.position.set(x, DECK_Y, z);
    SOLIDS.push({ x, z, r: 0.45 });
    m.rotation.y = x * 3;
    group.add(m);
    for (const [hy, hr] of [[0.1, 0.325], [0.3, 0.37], [0.55, 0.37], [0.75, 0.325]]) {
      const hoop = new THREE.Mesh(hoopGeo, hoopMat);
      hoop.scale.set(hr, 1, hr);
      hoop.position.set(x, DECK_Y + hy, z);
      group.add(hoop);
    }
  };
  [[-28.9, 105.4], [-28.1, 106.1], [20.6, 105.4], [-29, 116.4], [20.4, 152.5]].forEach(([x, z]) => barrel(x, z));
  [[-27.6, 105.1, 0.8], [20.7, 106.8, 0.8], [19.6, 153.4, 0.7]].forEach(([x, z, sz]) => {
    box(sz, sz, sz, crateMat, x, DECK_Y + sz / 2, z).rotation.y = (x * 7) % 1;
    SOLIDS.push({ x, z, r: sz * 0.62 });
  });

  // 繫纜樁（香菇頭的鐵樁）與盤起來的纜繩
  const ropeMat = new THREE.MeshLambertMaterial({ color: 0xb59a68 });
  const coilGeo = new THREE.TorusGeometry(0.28, 0.05, 6, 16).rotateX(Math.PI / 2);
  const iron = plain(0x34302c);
  [-28, -21.5, -15, -8.5, -2, 4.5, 11, 16.5].forEach((x, i) => {
    const z = 117.2;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.4, 12), iron);
    m.position.set(x, DECK_Y + 0.2, z);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), iron);
    cap.scale.y = 0.55;
    cap.position.set(x, DECK_Y + 0.42, z);
    group.add(m, cap);
    SOLIDS.push({ x, z, r: 0.28 });
    BOLLARDS.push({ x, z, y: DECK_Y + 0.3 });
    if (i % 2 === 0) {
      for (let k = 0; k < 3; k++) {
        const coil = new THREE.Mesh(coilGeo, ropeMat);
        coil.position.set(x + 0.75, DECK_Y + 0.05 + k * 0.085, z - 0.5);
        coil.scale.setScalar(1 - k * 0.1);
        group.add(coil);
      }
    }
  });
  // 卸魚用的小吊桿：一根立柱，橫臂伸到水面上，底下吊著鉤子
  {
    const cx = 13.6, cz = 116.9;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 3.8, 10), yellow);
    mast.position.set(cx, DECK_Y + 1.9, cz);
    group.add(mast);
    box(0.16, 0.16, 3.2, yellow, cx, DECK_Y + 3.7, cz + 1.3);
    box(0.08, 0.08, 1.9, yellow, cx, DECK_Y + 3.1, cz + 0.6).rotation.x = -0.75;
    box(0.02, 1.5, 0.02, ink, cx, DECK_Y + 2.9, cz + 2.7);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 10, 4.4), ink);
    hook.position.set(cx, DECK_Y + 2.08, cz + 2.7);
    group.add(hook);
    SOLIDS.push({ x: cx, z: cz, r: 0.32 });
  }

  // 晒架上掛著的漁網與浮球
  const nt = netTexture();
  nt.repeat.set(5, 2.6);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.55, 6, 3), new THREE.MeshLambertMaterial({ map: nt, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, forceSinglePass: true }));
  {
    const p = net.geometry.attributes.position;   // 網子中間往下垂、往外鼓
    for (let i = 0; i < p.count; i++) { const k = 1 - Math.abs(p.getX(i)) / 1.55; p.setZ(i, 0.18 * k * (0.775 - p.getY(i))); p.setY(i, p.getY(i) - 0.1 * k); }
    net.geometry.computeVertexNormals();
  }
  net.position.set(18, DECK_Y + 1.08, 112.6);
  group.add(net);
  [0xe2582a, 0xf2f0ea, 0x2f6fb0, 0xe2582a, 0xf0c020, 0xf2f0ea].forEach((c, i) => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshLambertMaterial({ color: c }));
    f.position.set(16.8 + i * 0.48, DECK_Y + 1.62 - 0.06 * Math.sin(i * 1.9), 113.8);
    f.scale.set(1, 1.25, 1);
    group.add(f);
    box(0.012, 0.16, 0.012, ropeMat, 16.8 + i * 0.48, DECK_Y + 1.8 - 0.03 * Math.sin(i * 1.9), 113.8);
  });
  for (const x of [16.5, 19.5]) { post(x, 112.6, DECK_Y + 1.9, 0.06); post(x, 113.8, DECK_Y + 1.9, 0.06); }
  box(3.3, 0.06, 0.06, darkWood, 18, DECK_Y + 1.85, 112.6);
  box(3.3, 0.06, 0.06, darkWood, 18, DECK_Y + 1.85, 113.8);

  // 路燈
  const lampMat = bulb(0xffd98a);
  LAMPS.forEach((p) => {
    post(p.x - 0.5, p.z, DECK_Y + 2.8, 0.07);
    box(0.55, 0.06, 0.06, darkWood, p.x - 0.25, DECK_Y + 2.72, p.z);
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), lampMat);
    l.position.set(p.x, p.y, p.z);
    group.add(l);
  });

  // ---- 浮動碼頭：兩條貼著水面的木棧道，從岸壁的跳板走下來；兩側是小舢舨的停船格 ----
  {
    const floatMat = plain(0x2c3a4a);
    for (const p of PONTOONS) {
      const d = p.deck, g = p.gang, len = d.z1 - d.z0, cz = (d.z0 + d.z1) / 2;
      box(PONTOON_W, 0.14, len, planks(deckTex, PONTOON_W, len, true), p.x, PONTOON_Y - 0.07, cz);   // 橋面
      box(PONTOON_W + 0.1, 0.1, len + 0.1, darkWood, p.x, PONTOON_Y - 0.19, cz);                      // 邊框
      for (let z = d.z0 + 1.2; z < d.z1; z += 2.4) box(PONTOON_W - 0.3, 0.55, 1.6, floatMat, p.x, PONTOON_Y - 0.5, z);   // 浮筒
      // 跳板：從岸壁斜下來，兩側有扶手
      const gw = g.x1 - g.x0, gl = Math.hypot(g.z1 - g.z0, DECK_Y - PONTOON_Y), ga = Math.atan2(DECK_Y - PONTOON_Y, g.z1 - g.z0), gz = (g.z0 + g.z1) / 2, gy = (DECK_Y + PONTOON_Y) / 2;
      box(gw, 0.1, gl + 0.3, planks(deckTex, gw, gl, true), p.x, gy - 0.05, gz).rotation.x = ga;
      for (const side of [-1, 1]) {
        const rx = p.x + side * (gw / 2 - 0.03);
        box(0.05, 0.05, gl, darkWood, rx, gy + 0.88, gz).rotation.x = ga;
        for (const t of [0.06, 0.5, 0.94]) box(0.05, 0.9, 0.05, darkWood, rx, DECK_Y + (PONTOON_Y - DECK_Y) * t + 0.44, g.z0 + (g.z1 - g.z0) * t);
      }
      // 定位樁：浮橋套在樁上，隨水位升降；尾端一盞燈
      for (const side of [-1, 1]) post(p.x + side * (PONTOON_W / 2 + 0.16), d.z1 - 0.5, PONTOON_Y + 1.5, 0.11);
      post(p.x, d.z1 + 0.12, PONTOON_Y + 2.25, 0.05);
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), lampMat);
      l.position.set(p.x, PONTOON_Y + 2.33, d.z1 + 0.12);
      group.add(l);
    }
    // 停船格的編號：漆在橋面、堤面上的小牌子
    const numTex = (text) => canvasTex(128, 64, (g) => {
      g.fillStyle = '#f4efe2'; g.fillRect(0, 0, 128, 64);
      g.strokeStyle = '#3a2412'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 58);
      g.fillStyle = '#3a2412'; g.font = 'bold 38px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 34);
    }, false);
    const tag = (text, x, y, z, w, turn) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2).rotateX(-Math.PI / 2), wetGround(new THREE.MeshLambertMaterial({ map: numTex(text), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
      m.position.set(x, y, z);
      m.rotation.y = turn;
      group.add(m);
    };
    for (const b of BERTHS) {
      if (b.kind === 'small') {
        const side = b.heading === 0 ? 1 : -1, px = b.x - side * 3.77;
        tag(b.label, px, PONTOON_Y + 0.006, b.z, 0.56, side > 0 ? -Math.PI / 2 : Math.PI / 2);
        box(0.3, 0.09, 0.08, ink, px + side * 0.36, PONTOON_Y + 0.045, b.z + 0.95);   // 繫船的羊角
      } else if (b.kind === 'big') {
        const along = b.off ? 2.4 : 0;   // 外檔那一格的牌子排在裡面那格的旁邊
        tag(b.label, b.ex - b.nx * 1.1 + (b.nz ? along - 1.2 : 0), DECK_Y + 0.012, b.ez - b.nz * 1.1, 1.0, b.nx ? -Math.PI / 2 : Math.PI);
      }
    }
    // 港外錨地：每一格的船頭前面一顆浮標
    const spots = BERTHS.filter((b) => b.kind === 'anchor');
    const ball = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 10, 8), plain(0xe8742a), spots.length);
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 6), ink, spots.length);
    const m4 = new THREE.Matrix4();
    spots.forEach((b, i) => {
      ball.setMatrixAt(i, m4.makeTranslation(b.x + 10.6, 0.08, b.z));
      pole.setMatrixAt(i, m4.makeTranslation(b.x + 10.6, 0.8, b.z));
    });
    ball.computeBoundingSphere(); pole.computeBoundingSphere();
    group.add(ball, pole);
  }

  // ---- 魚市場棚子裡吊著的一顆燈泡 ----
  box(0.025, 0.55, 0.025, ink, 8.5, DECK_Y + 2.85, 107.5);
  {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), lampMat);
    b.position.set(8.5, DECK_Y + 2.5, 107.5);
    group.add(b);
  }

  // 淋不到雨的範圍（屋簷、雨棚伸出去多少就算到哪裡）
  {
    const tx = (SHELF_X[0] + SHELF_X[1]) / 2, tw = (SHELF_X[1] - SHELF_X[0] + 0.7) / 2;
    WET.dry.value[0].set(SHOP.x - SHOP.w / 2 - 1.1, SHOP.z - SHOP.d / 2 - 1.05, SHOP.x + SHOP.w / 2 + 1.1, SHOP.z + SHOP.d / 2 + 1.05);
    WET.dry.value[1].set(SHOP.x - 0.5, SHOP.z + SHOP.d / 2, SHOP.x + 3.7, SHOP.z + SHOP.d / 2 + 1.85);
    WET.dry.value[2].set(tx - tw, SHELF_Z - 0.95, tx + tw, SHELF_Z + 2.05);
    WET.dry.value[3].set(0.8, 103.7, 16.2, 111.3);
  }

  // ---- 貼地的暗影：東西和地面相接的地方暗一圈，看起來才是「放在地上」而不是浮著 ----
  const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  {
    const ao = (tex) => new THREE.MeshBasicMaterial({ map: tex, color: 0x121a30, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const lay = (tex, list) => {
      const mesh = new THREE.InstancedMesh(flat, ao(tex), list.length);
      list.forEach(([x, z, w, d], i) => mesh.setMatrixAt(i, m4.compose(v.set(x, DECK_Y + 0.024, z), q, sc.set(w, 1, d))));
      mesh.computeBoundingSphere();
      group.add(mesh);
    };
    lay(softDisc(), SOLIDS.filter((c) => onDeckLocal(c.x, c.z)).map((c) => { const k = Math.max(0.9, c.r * 3.4); return [c.x, c.z, k, k]; }));
    const k = 1 / 0.6, sq = (x, z, w, d) => [x, z, w * k, d * k];
    lay(softSquare(), [
      sq(SHOP.x, SHOP.z, SHOP.w + 0.5, SHOP.d + 0.5), sq(SHOP.x + 1.6, SHOP.z + SHOP.d / 2 + 0.45, 3.8, 1.1),
      sq((SHELF_X[0] + SHELF_X[1]) / 2, SHELF_Z, SHELF_X[1] - SHELF_X[0], 1.2),
      sq(-14.05, 105.32, 2.3, 0.85), sq(3.75, 105.95, 2.4, 1.6), sq(12.65, 105.85, 2.2, 1.3), sq(8.9, 105.75, 2.5, 1.0),
      sq(SELL.basket.x, SELL.basket.z, 0.9, 0.9), sq(18, 113.2, 3.2, 1.3),
      sq(21.4, 139, 1.0, 42), sq(6, 159.4, 32, 1.0),
    ]);
  }

  // ---- 地上的污漬：繫纜樁底下流出來的鐵鏽、魚市場棚下老是濕的地板 ----
  // 做法是把底下地面的顏色乘上一個顏色（不是蓋一層上去）：地面的紋路還在，晚上也不會自己亮起來
  {
    const stainTex = (rgb) => canvasTex(64, 64, (g) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      [[0, 1], [0.35, 0.85], [0.7, 0.35], [1, 0]].forEach(([t, a]) => gr.addColorStop(t, `rgba(${rgb},${a})`));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }, false);
    const stain = (rgb, list) => {
      const mat = new THREE.MeshBasicMaterial({
        map: stainTex(rgb), transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      });
      const mesh = new THREE.InstancedMesh(flat, mat, list.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      list.forEach(([x, z, w, d, rot = 0], i) => mesh.setMatrixAt(i, m4.compose(v.set(x, DECK_Y + 0.012, z), q.setFromAxisAngle(up, rot), sc.set(w, 1, d))));
      mesh.computeBoundingSphere();
      mesh.renderOrder = -0.5;   // 在貼地的暗影之前畫
      group.add(mesh);
    };
    // 鐵鏽：樁腳一圈，再順著排水的方向往岸邊流一道
    stain('172,108,66', BOLLARDS.flatMap((b, i) => [[b.x, b.z, 1.15, 1.15], [b.x + 0.12 * Math.sin(i * 2.3), b.z + 0.55, 0.5 + 0.12 * Math.sin(i * 1.7), 1.5, 0.12 * Math.sin(i * 3.1)]]));
    // 濕地板：幾團疊在一起，邊緣才不會是一個整齊的橢圓
    stain('150,156,160', [[8.4, 107.4, 11, 5.2], [5.2, 108.3, 5.5, 3.6, 0.4], [11.8, 108.6, 6, 3.2, -0.3], [8.9, 109.9, 4.5, 2.6, 0.2], [3.9, 106.3, 3.4, 2.4], [12.6, 106.2, 3.2, 2.2]]);
  }

  // ---- 晚上燈光照在地上的光圈 ----
  // 光圈是一片平放在碼頭地面上的發亮圓片，只畫在碼頭、防波堤的範圍裡。以前它會超出岸壁的邊緣、懸在海面和船的上方：
  // 人站在靠岸的船上用第一人稱看，眼睛只比它高二十幾公分，它貼近鏡頭的那一段被裁掉，畫面上就是一條橫線，
  // 橫線以上的船板被它照得發亮、以下沒有。船和海面本來就有路燈的光（點光源、海面著色器裡的 uLamp），不靠這片圓片
  const deckRects = DECKS.map((r) => new THREE.Vector4(r.x0, r.z0, r.x1, r.z1));
  const pool = (x, z, r, color, k) => {
    const mat = new THREE.MeshBasicMaterial({ map: softDisc(), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false });
    mat.customProgramCacheKey = () => 'pool';
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uDeckRect = { value: deckRects };
      sh.uniforms.uHome = HOME_U;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPoolW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvPoolW = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vPoolW;
${homeGlsl}
uniform vec4 uDeckRect[ ${DECKS.length} ];`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
	bool poolOn = false;
	for ( int i = 0; i < ${DECKS.length}; i ++ ) {
		vec4 dr = uDeckRect[ i ];
		vec2 pl = homeLocal( vPoolW );
			if ( pl.x > dr.x && pl.x < dr.z && pl.y > dr.y && pl.y < dr.w ) poolOn = true;
	}
	if ( ! poolOn ) discard;`);
    };
    const mesh = new THREE.Mesh(flat, mat);
    mesh.position.set(x, DECK_Y + 0.03, z);
    mesh.scale.set(r * 2, 1, r * 2);
    mesh.visible = false;
    group.add(mesh);
    POOLS.push({ mesh, mat, k });
  };
  LAMPS.forEach((p) => pool(p.x, p.z, 6.5, 0xffb060, 0.5));
  pool(SHOP.x - 1.75, SHOP.z + SHOP.d / 2 + 1.1, 3.2, 0xff5a30, 0.6);                        // 紅燈籠
  pool(-14.05, 106.7, 2.8, 0xbfe0ff, 0.5);                                                    // 自動販賣機
  pool(8.5, 107.6, 6.5, 0xffc070, 0.6);                                                       // 魚市場的燈泡
  for (const side of [-1, 1]) pool(SHOP.x + side * (SHOP.w / 2 + 1.2), SHOP.z, 2.8, 0xffb45a, 0.45);   // 商店窗戶透出來的光
  pool(-8.2, 158, 3.6, 0xff4030, 0.5);                                                        // 紅燈標

  return group;
}


// makeHarbor 蓋完之後呼叫一次：把給世界用的清單（立在水裡的樁、擋路的東西、消波塊、繫纜樁、路燈）從港座標就地轉成世界座標。
// 清單裡其他欄位（半徑、高度、亮度）不變
export function worldizeHarborLists() {
  for (const list of [PILES, SOLIDS, HARBOR_ROCKS, BOLLARDS, LAMPS, EXTRA_LAMPS]) {
    for (const p of list) [p.x, p.z] = toWorld(p.x, p.z);
  }
}
