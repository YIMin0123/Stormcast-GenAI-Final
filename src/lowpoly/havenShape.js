// 探險大港灣島的形狀：只有數字和算式（不碰畫面），瀏覽器和伺服器共用。座標是大港座標（見 havenPlan.js）。
import * as V from './havenPlan.js';
import { fbm } from './homeShape.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const bump = (d, w) => Math.exp(-(d / w) * (d / w));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 這一點相對海灣的位置。回傳 [th 從灣口算起的角度, r 離灣心多遠]。
// 先把位置照雜訊推歪一點：海岸線和山脊才不會是圓規畫出來的
function polar(x, z) {
  const W = V.RIDGE.warp;
  const wx = x + (fbm(x * 0.011 + 3.1, z * 0.011 + 7.7) - 0.5) * W, wz = z + (fbm(x * 0.011 + 19.3, z * 0.011 + 1.9) - 0.5) * W;
  const dx = wx - V.BAY.x, dz = wz - V.BAY.z;
  return [Math.atan2(dx, dz), Math.hypot(dx, dz)];
}

// 山脊在這個角度的樣子：{ H 山脊線多高, R 山脊線離灣心多遠, wIn / wOut 往灣內、往外海的坡多寬, tau 0 = 灣口（沒有山）… 1 = 完整的山 }
function ridgeAt(th) {
  const G = V.RIDGE, a = Math.abs(th), cape = G.capes[th < 0 ? 0 : 1];
  const back = smooth(0.7, 2.5, a);
  const tau = smooth(cape.tip, cape.tip + G.tipWide, a);
  // 沿著山脊高高低低（用角度的 cos、sin 取雜訊，繞一圈回來接得起來）
  const n = (fbm(Math.cos(th) * 1.7 + 5.3, Math.sin(th) * 1.7 + 9.1) - 0.5) * 2 + (fbm(Math.cos(th) * 6.5 + 1.3, Math.sin(th) * 6.5 + 4.1) - 0.5) * 0.9;
  const H = (G.base * (1 + G.rough * n) + G.peak.add * bump(wrap(th - G.peak.at), G.peak.wide) + cape.add * bump(a - cape.at, 0.32)) * tau;
  // 山脊線忽遠忽近；往外海的坡一段寬一段窄：寬的是伸出去的山稜（海岸凸出去變成小岬角），窄的是凹進來的小灣
  const c2 = Math.cos(th), s2 = Math.sin(th);
  const R = lerp(G.r[0], G.r[1], back) + (fbm(c2 * 2.6 + 21.7, s2 * 2.6 + 3.3) - 0.5) * 2 * G.wobble;
  const spur = 1 + (fbm(c2 * G.spurs + 31.1, s2 * G.spurs + 17.9) - 0.5) * 2 * G.spur;
  return { H, tau, R, wIn: lerp(G.inW[0], G.inW[1], back), wOut: lerp(G.outW[0], G.outW[1], back) * spur };
}

// 山的剖面：0（山脊線）= 1，1（山腳）= 0。山脊線附近尖一點（不是饅頭形）
const profile = (t) => lerp(1 - smooth(0.08, 0.92, t), (1 - t) * (1 - t), 0.3);

// ---- 島的高度（公尺；海平面 0，負的是海底）----
export function havenHeight(x, z) {
  const D = V.DEPTH;
  if (x * x + z * z > V.REACH * V.REACH) return D.floor;
  const [th, r] = polar(x, z), a = Math.abs(th);
  const g = ridgeAt(th), d = r - g.R, inside = d < 0, t = inside ? -d / g.wIn : d / g.wOut;
  // 山腳的水深：有山的地方是淺灘，灣口那一段沒有山、是深的航道
  const foot = lerp(D.channel, D.shelf, g.tau);
  let h;
  if (t < 1) {
    h = foot + (g.H - foot) * profile(t) * smooth(0, 8, g.H);
    // 地面的起伏：越高的地方越明顯
    h += (fbm(x * 0.035 + 40, z * 0.035) - 0.5) * 10 * smooth(3, 22, h) + (fbm(x * 0.09 + 7, z * 0.09 + 70) - 0.5) * 3 * smooth(1.5, 8, h);
  } else if (inside) h = Math.min(foot, lerp(foot, D.bay, smooth(1.0, 1.6, t)));   // 灣內
  else h = lerp(foot, D.floor, smooth(1.0, 2.6, t));                                // 外海：慢慢深到海底
  // 灣底的山腳整平一片（碼頭、山城）：靠海那一側是直落的岸壁，靠山那一側慢慢接回山坡
  const T = V.TOWN, ka = smooth(T.from, T.from + 0.25, a);
  if (ka > 0 && inside) {
    const shore = -0.8 * g.wIn, lo = shore - T.fill, hi = shore + T.wide;
    const q = Math.max((lo - d) / 1.2, (d - hi) / 8, 0);
    h += (T.y - h) * ka * (1 - smooth(0, 1, q));
  }
  return Math.max(riverTerrain(x, z, caveTerrain(x, z, h)), D.floor);
}

// ==== 透天洞穴 ====
// 地形分上下兩層：上層是 havenHeight（山坡、洞頂），下層是洞裡（深潭、暗門水道）。
const CV = V.CAVE, AX = [Math.sin(CV.axisDeg * Math.PI / 180), Math.cos(CV.axisDeg * Math.PI / 180)];
// 洞穴自己的座標：[s 沿著暗門水道往外海, l 橫向, rho 離深潭中心多遠]
export function caveCoords(x, z) {
  const dx = x - CV.x, dz = z - CV.z;
  return [dx * AX[0] + dz * AX[1], -dx * AX[1] + dz * AX[0], Math.hypot(dx, dz)];
}
// 天窗的邊離深潭中心多遠（照方向不一樣，不是正圓）。dx, dz：從深潭中心算起
function skyR(dx, dz) {
  const a = Math.atan2(dz, dx);
  let k = 1;
  for (const [n, amp, ph] of CV.sky.lobes) k += amp * Math.sin(n * a + ph);
  return CV.sky.r * k;
}
// 離天窗的邊多遠（負的 = 在天窗裡面）
export const skyEdge = (x, z) => Math.hypot(x - CV.x, z - CV.z) - skyR(x - CV.x, z - CV.z);
// 天窗最寬的地方離中心多遠
export const SKY_MAX = (() => { let m = 0; for (let i = 0; i < 360; i++) m = Math.max(m, skyR(Math.cos(i * Math.PI / 180), Math.sin(i * Math.PI / 180))); return m; })();
// 圓穹在離中心 rho 的地方多高
const domeY = (rho) => CV.dome.cy + CV.dome.ry * Math.sqrt(Math.max(0, 1 - (rho / CV.dome.rx) ** 2));

// 暗門洞口那面崖壁在橫向 l 的地方往山裡凹進去多少
const faceDent = (l) => CV.cove.face * fbm(l * 0.21 + 23.1, 4.7);
// 崖面在橫向 l 的地方、沿水道方向的位置（藤蔓掛在這條線上）
export const coveFaceS = (l) => CV.face - 0.25 - faceDent(l);
// 洞穴對上層地形的影響：洞頂不夠厚的地方墊高；暗門洞口外面挖一道海蝕溝（兩側是陡壁，盡頭是洞口所在的崖面）
function caveTerrain(x, z, h) {
  const [s, l, rho] = caveCoords(x, z), D = CV.dome;
  if (rho > 120) return h;
  if (rho < D.rx + 12) h = Math.max(h, rho < D.rx ? domeY(rho) + CV.roof : (D.cy + CV.roof) * (1 - smooth(D.rx, D.rx + 12, rho)));
  const C = CV.cove;
  if (s > CV.face - 2 - C.face) {
    // 兩側的崖壁各自凹凸（只會比原本寬）；盡頭的崖面也不是一道平牆，這裡凹進去多一點、那裡少一點
    const side = l < 0 ? 17.3 : 41.9;
    const w = C.half + (s - CV.face) * C.widen + C.rough * fbm(s * 0.11 + side, side * 0.7);
    const sf = s + faceDent(l);
    const k = (1 - smooth(w, w + C.wall, Math.abs(l))) * smooth(CV.face - 2, CV.face + 1.5, sf);
    if (k > 0) h += (Math.min(h, C.floor) - h) * k;
  }
  return h;
}

// 深潭的底：大部分是潭底，暗門對面那一側沿著洞壁有一道露出水面的岩台
function poolFloor(s, rho) {
  const L = CV.ledge, k = smooth(CV.r - L.wide - 1.5, CV.r - L.wide + 0.5, rho) * smooth(L.from, L.from - 5, s);
  return CV.pool + (L.y - CV.pool) * k;
}
// 下層：(x, z) 在洞裡（深潭或暗門水道）的話回傳洞底的高度，不在就回傳 null。extra：水道多算寬幾公尺
export function caveFloor(x, z, extra = 0) {
  const [s, l, rho] = caveCoords(x, z);
  if (rho < CV.r) return poolFloor(s, rho);
  if (s > 0 && s < CV.face + 2 && Math.abs(l) < CV.door.half + extra) return CV.door.floor;
  return null;
}
// 洞裡這一點頭上的洞頂多高（天窗底下是 Infinity：頭上沒有東西）
export function caveCeil(x, z) {
  const rho = caveCoords(x, z)[2];
  return skyEdge(x, z) < 0 ? Infinity : rho < CV.r ? domeY(rho) : CV.door.ceil;
}
// 高度 y 的人或東西在 (x, z)：如果它其實在洞裡（比洞頂低，或正好在天窗底下），回傳洞底的高度；在洞頂上面或洞外就回傳 null（照上層的地面）
export function caveUnder(x, z, y) {
  const f = caveFloor(x, z);
  if (f === null) return null;
  const c = caveCeil(x, z);
  return c === Infinity || (y !== null && y < c - 0.4) ? f : null;
}
// 洞穴附近（船要照精確的下層算，不能用 2 公尺一格的海床圖：水道只有 4.2 公尺寬）
export const nearCave = (x, z) => (x - CV.x) ** 2 + (z - CV.z) ** 2 < (CV.face + 14) ** 2;

// 這裡的水道多寬（公尺）：暗門水道裡是它的寬度，其他地方是 Infinity。比它寬的船進不去
export function caveGate(x, z) {
  const [s, l, rho] = caveCoords(x, z);
  return rho >= CV.r - 1 && s > 0 && s < CV.face + 1 && Math.abs(l) < CV.door.half + 3 ? CV.door.half * 2 : Infinity;
}
// 暗門水道往外海的方向（大港座標的單位向量）
export const CAVE_AXIS = AX;

// 遊戲用的海床（跟 homeShape.js 的 homeBed 同一個角色）：洞裡照下層（那裡是水），其他照山坡。
// 水道在這張圖上多算寬一點——圖是 2 公尺一格，太窄的話水面的顏色、白沫會斷斷續續；船能不能過另外照 havenLow 精確地算
export const havenBed = (x, z) => caveFloor(x, z, 1.2) ?? havenHeight(x, z);
// 船和游泳的人眼中的地面（精確的下層）
export const havenLow = (x, z) => caveFloor(x, z) ?? havenHeight(x, z);

// 這一點是不是在岩石裡（山坡的地面以下，又不在洞的空腔裡；離洞壁不到 pad 公尺也算）。鏡頭的遮擋判斷用：
// 不拿洞穴的模型去算，七千多個三角形每幀試好幾條線，光這一項就要好幾毫秒
export const caveRock = (x, y, z, pad = 0.3) => cavitySdf(x, y, z) > -pad && y < havenHeight(x, z) + pad;

// 洞穴的空腔（立體的，給模型用）：負的 = 在空腔裡，正的 = 在岩石裡，數字大約是離洞壁幾公尺。
// 圓穹（橢球，潭底以上）＋天窗的豎井（邊緣不是正圓）＋暗門水道（圓角的長方形斷面，到洞口變成一道歪斜、頂端收尖的裂口），洞壁照雜訊凹凸
export function cavitySdf(x, y, z) {
  const [s, l, rho] = caveCoords(x, z), D = CV.dome, T = CV.door;
  const n = fbm(x * 0.21 + y * 0.13 + 3.7, z * 0.21 - y * 0.17 + 8.1) - 0.5;
  const dome = Math.max((Math.hypot(rho / D.rx, (y - D.cy) / D.ry) - 1) * D.rx + n * 1.6, poolFloor(s, rho) - y);
  const shaft = Math.max(skyEdge(x, z) + n * 1.0, D.cy + D.ry - 7 - y);
  const M = T.mouth, m = smooth(CV.face - M.from, CV.face + 1, s);   // 0 = 水道裡面，1 = 洞口
  const top = T.ceil + m * (M.rise + M.tilt * l), up = smooth(0.5, 3, y);
  const hw = (T.half + m * M.flare * up) * (1 - 0.8 * m * smooth(top - 6, top, y)), lc = l - m * M.lean * smooth(1, top, y);
  const rr = 1.4, ax = Math.abs(lc) - (hw - rr), ay = Math.abs(y - (top + T.floor) / 2) - ((top - T.floor) / 2 - rr);
  const tun = Math.max(Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0) - rr + n * (0.5 + 1.1 * m), 8 - s, s - (CV.face + 10));
  return Math.min(dome, shaft, tun);
}

// ==== 山澗小河 ====
const RV = V.RIVER;
// 河道的中線：照設計圖的幾個點拉一條平滑的曲線，沿線每公尺取一點 { x, z, s 沿河的距離, y 河床高度 }。
// falls：瀑布 { i 瀑布頂是第幾點（下一點就在瀑布底）, top, bottom 河床的高度, bx, bz 底下水潭的中心 }
const RIV = (() => {
  const P = RV.path, n = P.length, fine = [], pts = [];
  const cr = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  for (let i = 0; i < n - 1; i++) {
    const a = P[Math.max(0, i - 1)], b = P[i], c = P[i + 1], d = P[Math.min(n - 1, i + 2)];
    for (let k = 0; k < 20; k++) { const t = k / 20; fine.push([cr(a[0], b[0], c[0], d[0], t), cr(a[1], b[1], c[1], d[1], t), i + t]); }
  }
  fine.push([P[n - 1][0], P[n - 1][1], n - 1]);
  let acc = 0, next = 0;
  for (let i = 0; i < fine.length; i++) {
    if (i > 0) acc += Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]);
    if (acc < next && i < fine.length - 1) continue;
    // 河床的高度：兩個設計點之間直線變化；瀑布那一點的下游從瀑布底的高度算起
    const u = fine[i][2], k = Math.min(n - 2, Math.floor(u)), t = u - k, y0 = P[k][3] ?? P[k][2], y1 = P[k + 1][2];
    pts.push({ x: fine[i][0], z: fine[i][1], s: acc, y: y0 + (y1 - y0) * t, u });
    next = acc + 1;
  }
  const falls = [], lip = new Set();
  for (let k = 1; k < n - 1; k++) {
    if (P[k].length < 4) continue;
    let i = 0;
    while (i < pts.length - 2 && pts[i + 1].u < k) i++;
    const b = pts[Math.min(pts.length - 1, i + 1 + Math.round(RV.basin.ahead))];
    falls.push({ i, top: P[k][2], bottom: P[k][3], bx: b.x, bz: b.z });
    lip.add(i);
  }
  const pad = RV.flat + RV.bank + 1, sp = RV.spring.r + RV.bank + 1;
  const box = [Math.min(P[0][0] - sp, ...pts.map((p) => p.x - pad)), Math.max(P[0][0] + sp, ...pts.map((p) => p.x + pad)),
    Math.min(P[0][1] - sp, ...pts.map((p) => p.z - pad)), Math.max(P[0][1] + sp, ...pts.map((p) => p.z + pad))];
  return { pts, falls, lip, box };
})();
export const riverPath = () => RIV.pts;
export const riverFalls = () => RIV.falls;

// 這一點相對小河的位置：{ d 離中線多遠, lat 在中線的哪一側多遠（有正負）, i 最近的是第幾段, t 在那一段的哪裡, s 沿河的距離, y 那裡的河床高度, tx / tz 往下游的方向 }。
// 離小河很遠（超出它的範圍）回傳 null
export function riverAt(x, z) {
  const B = RIV.box;
  if (x < B[0] || x > B[1] || z < B[2] || z > B[3]) return null;
  const p = RIV.pts;
  let best = Infinity, bi = 0, bt = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], ex = p[i + 1].x - a.x, ez = p[i + 1].z - a.z;
    const t = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez)));
    const dx = x - a.x - ex * t, dz = z - a.z - ez * t, d2 = dx * dx + dz * dz;
    if (d2 < best) { best = d2; bi = i; bt = t; }
  }
  const a = p[bi], b = p[bi + 1], len = Math.hypot(b.x - a.x, b.z - a.z), tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
  // 瀑布那一段：前半在瀑布頂、後半在瀑布底（河床在中間直接掉下去）
  const y = RIV.lip.has(bi) ? (bt < 0.5 ? a.y : b.y) : a.y + (b.y - a.y) * bt;
  return { d: Math.sqrt(best), lat: -(x - a.x) * tz + (z - a.z) * tx, i: bi, t: bt, s: a.s + (b.s - a.s) * bt, y, tx, tz };
}

// 把地面挖成河床：d 是離「河床平的那一段」的邊多遠（負的 = 在河床上）。河床以外 bank 公尺內慢慢接回原本的山坡，
// 兩岸至少高出河床 lip 公尺（下坡那一側原本的地面比河床低，就墊一道土堤）
const carve = (h, d, bed, lip = RV.lip) => {
  if (d >= RV.bank) return h;
  if (d <= 0) return bed;
  return Math.max(bed + (h - bed) * smooth(0, RV.bank, d), bed + lip * smooth(0, 1.2, d) * (1 - smooth(1.2, RV.bank, d)));
};
// 小河對地形的影響：先挖源頭的湧泉池，再挖河道，最後挖瀑布底下的水潭
function riverTerrain(x, z, h) {
  const q = riverAt(x, z);
  if (!q) return h;
  const P0 = RIV.pts[0], S = RV.spring, B = RV.basin, ds = Math.hypot(x - P0.x, z - P0.z) - S.r;
  // 水潭只算瀑布底下那一側（不然會把瀑布頂的河道也挖掉）
  const pools = RIV.falls.filter((f) => q.i > f.i || (q.i === f.i && q.t >= 0.5)).map((f) => [Math.hypot(x - f.bx, z - f.bz) - B.r, f.bottom - B.deep]);
  // 河道穿過池子、水潭的地方不墊土堤（不然池子裡會多一道埂）
  const open = ds < 1.5 || pools.some(([d]) => d < 1.5);
  let out = carve(carve(h, ds, P0.y + RV.water.depth - S.depth), q.d - RV.flat, q.y, open ? 0 : RV.lip);
  for (const [d, bed] of pools) out = Math.min(out, carve(out, d, bed, 0));
  return out;
}
// 這一點是不是河床、湧泉池或瀑布底的水潭（上色、擺東西用）。pad：多算寬幾公尺
export function riverBed(x, z, pad = 0) {
  const q = riverAt(x, z);
  if (!q) return false;
  if (q.d < RV.flat + pad || Math.hypot(x - RIV.pts[0].x, z - RIV.pts[0].z) < RV.spring.r + pad) return true;
  return RIV.falls.some((f) => Math.hypot(x - f.bx, z - f.bz) < RV.basin.r + pad);
}

// ==== 天窗跳水台 ====
// 平台的位置（第一次問的時候才算，要用到地面的高度）：{ x, z 根的那一頭的中點, ux / uz 往洞中心伸出去的方向, len 全長, half 半寬, y 台面的高度, rim 從根算起幾公尺以後懸在洞口上面 }
let DECK = null;
export function diveDeck() {
  if (DECK) return DECK;
  const D = V.DIVE, cx = Math.cos(D.at), cz = Math.sin(D.at);
  let d = 0;
  while (skyEdge(CV.x + cx * d, CV.z + cz * d) < 0) d += 0.1;
  DECK = {
    x: CV.x + cx * (d + D.back), z: CV.z + cz * (d + D.back), ux: -cx, uz: -cz, len: D.back + D.out, half: D.wide / 2, rim: D.back,
    y: havenHeight(CV.x + cx * (d + 1), CV.z + cz * (d + 1)) + D.lift,
  };
  return DECK;
}
// 腳在高度 feet 的人在 (x, z)：踩在跳水台上的話回傳台面的高度，不是就回傳 null（在底下深潭裡游的人、沒有說高度的都不算）
export function havenDeck(x, z, feet) {
  if (feet === null || feet === undefined) return null;
  const K = diveDeck(), dx = x - K.x, dz = z - K.z, a = dx * K.ux + dz * K.uz, b = -dx * K.uz + dz * K.ux;
  return a > -0.2 && a < K.len && Math.abs(b) < K.half && feet > K.y - 0.7 ? K.y : null;
}
