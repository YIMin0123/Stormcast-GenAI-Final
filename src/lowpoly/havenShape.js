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
  return Math.max(h, D.floor);
}

// 遊戲用的海床（跟 homeShape.js 的 homeBed 同一個角色）
export const havenBed = havenHeight;
