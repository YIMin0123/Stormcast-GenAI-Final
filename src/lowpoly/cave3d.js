// 透天洞穴的模型（大港座標）：洞的內壁、潭底、天窗的豎井、暗門水道，還有天窗口和暗門洞口那兩小塊地形。
// 山坡的地形是「高度圖」做的（每個位置只有一個高度），做不出中空的洞；這裡改用立體的做法：
// 把「岩石（地面以下）扣掉洞穴的空腔」當成一塊實心的東西，在立體的格子上找出它的表面（Surface Nets），轉成低面的岩壁。
// 天窗口、暗門洞口這兩處，山坡的地形本來就要被洞切開，所以那一小塊地面也由這裡畫（haven3d.js 那邊相對應的三角形不畫），
// 切口才會是乾淨的一圈，不會露縫。
import * as THREE from 'three';
import { FaceBuilder, fbm } from './kit.js';
import { jitter } from './palette.js';
import { cavitySdf, caveCoords, SKY_MAX } from './havenShape.js';
import { CAVE } from './havenPlan.js';

// 這一點是不是在「由洞穴模型接手畫地面」的那兩塊裡：天窗口一圈、暗門洞口前後。shrink：往內縮幾公尺
// （山坡的地形用縮過的範圍挖洞，兩邊重疊一圈，接縫才不會露出來）
export function cavePatch(x, z, shrink = 0) {
  const [s, l, rho] = caveCoords(x, z);
  return rho < SKY_MAX + 3.5 - shrink || (Math.abs(l) < 8 - shrink && s > CAVE.face - 6 + shrink && s < CAVE.face + 5 - shrink);
}

// 在立體格子上找表面。f(x, y, z)：負的 = 實心裡面。回傳三角形 [[a, b, c], ...]（Vector3，正面朝實心的外面）
function surfaceNets(f, x0, y0, z0, nx, ny, nz, h) {
  const sx = nx + 1, sy = ny + 1, S = new Float32Array(sx * sy * (nz + 1));
  const at = (i, j, k) => i + sx * (j + sy * k);
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) S[at(i, j, k)] = f(x0 + i * h, y0 + j * h, z0 + k * h);
  // 每個有表面穿過的格子放一個頂點：穿過它的那幾條邊的交點取平均
  const vert = new Map(), cell = (i, j, k) => i + nx * (j + ny * k);
  const E = [[0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1], [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1], [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1]];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let px = 0, py = 0, pz = 0, n = 0;
    for (const e of E) {
      const a = S[at(i + e[0], j + e[1], k + e[2])], b = S[at(i + e[3], j + e[4], k + e[5])];
      if ((a < 0) === (b < 0)) continue;
      const t = a / (a - b);
      px += e[0] + (e[3] - e[0]) * t; py += e[1] + (e[4] - e[1]) * t; pz += e[2] + (e[5] - e[2]) * t; n++;
    }
    if (n) vert.set(cell(i, j, k), new THREE.Vector3(x0 + (i + px / n) * h, y0 + (j + py / n) * h, z0 + (k + pz / n) * h));
  }
  // 每條有表面穿過的格線，周圍四個格子的頂點圍成一個四邊形
  // 四個格子的順序固定是「從那條格線的正方向看過去逆時針」，所以正面朝格線的正方向；實心在正的那一頭的話整個反過來。
  // （不能用算出來的法線判斷朝哪邊：四邊形常常是歪的，法線會騙人，判斷錯的那一片從洞裡看就是一個破洞）
  const tris = [];
  const quad = (c, axis, sign) => {
    const p = c.map((q) => vert.get(q));
    if (p.some((q) => !q)) return;
    if (sign > 0) tris.push([p[0], p[1], p[2]], [p[0], p[2], p[3]]);
    else tris.push([p[0], p[2], p[1]], [p[0], p[3], p[2]]);
  };
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const a = S[at(i, j, k)];
    if (i < nx && j > 0 && j < ny && k > 0 && k < nz) { const b = S[at(i + 1, j, k)]; if ((a < 0) !== (b < 0)) quad([cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k)], 0, a < 0 ? 1 : -1); }
    if (j < ny && i > 0 && i < nx && k > 0 && k < nz) { const b = S[at(i, j + 1, k)]; if ((a < 0) !== (b < 0)) quad([cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1)], 1, a < 0 ? 1 : -1); }
    if (k < nz && i > 0 && i < nx && j > 0 && j < ny) { const b = S[at(i, j, k + 1)]; if ((a < 0) !== (b < 0)) quad([cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k)], 2, a < 0 ? 1 : -1); }
  }
  return tris;
}

// groundAt(x, z)：山坡畫出來的地面多高（haven3d.js 的地形）。tint：跟山坡同一套「越高越黃」的調色
// 回傳洞穴的網格（已經加進 group）
export function buildCave({ P, r, mat, group, groundAt, tint }) {
  const C = CAVE, H = 1.5, D = C.dome;
  // 要算的範圍：圓穹四周、暗門水道一路到洞口外面
  const ax = Math.sin(C.axisDeg * Math.PI / 180), az = Math.cos(C.axisDeg * Math.PI / 180), far = C.face + 7, pad = 10;
  const xs = [C.x - D.rx - 5, C.x + D.rx + 5, C.x + ax * far - pad, C.x + ax * far + pad], zs = [C.z - D.rx - 5, C.z + D.rx + 5, C.z + az * far - pad, C.z + az * far + pad];
  const x0 = Math.min(...xs), z0 = Math.min(...zs), nx = Math.ceil((Math.max(...xs) - x0) / H), nz = Math.ceil((Math.max(...zs) - z0) / H);
  // 每一直行的地面高度先查好
  const G = new Float32Array((nx + 1) * (nz + 1));
  let top = 0;
  for (let k = 0; k <= nz; k++) for (let i = 0; i <= nx; i++) { const g = groundAt(x0 + i * H, z0 + k * H); G[k * (nx + 1) + i] = g; top = Math.max(top, g); }
  const y0 = C.pool - 2 * H, ny = Math.ceil((top + 3 - y0) / H);
  const gAt = (x, z) => G[Math.round((z - z0) / H) * (nx + 1) + Math.round((x - x0) / H)];
  const solid = (x, y, z) => Math.max(y - gAt(x, z), -cavitySdf(x, y, z));
  const tris = surfaceNets(solid, x0, y0, z0, nx, ny, nz, H);

  // ---- 上色 ----
  const strata = [P.rock2, P.rockWarm.clone().multiplyScalar(0.92), P.rock.clone().multiplyScalar(0.88), P.cliff.clone().lerp(P.rock2, 0.6).multiplyScalar(0.85)];
  const BAND = 3.2;   // 岩層厚度，跟山坡同一個數字，層次才接得起來
  const skyO = new THREE.Vector3(C.x, D.cy + D.ry, C.z), mouth = new THREE.Vector3(C.x + ax * C.face, 1, C.z + az * C.face);
  const fb = new FaceBuilder(), m = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), v = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    m.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    const g = groundAt(m.x, m.z), wall = -cavitySdf(m.x, m.y, m.z) > m.y - g - 0.45;   // 這一面是洞壁，還是地面
    if (!wall && !cavePatch(m.x, m.z)) continue;   // 洞穴以外的地面：山坡自己畫
    let col;
    if (!wall) {
      // 天窗口、暗門洞口那兩小塊地面：照山坡的規則上色
      const patch = fbm(m.x * 0.05 + 40, m.z * 0.05);
      if (n.y < 0.74 && m.y > -1.5) { col = strata[((Math.floor(m.y / (BAND * 0.5) + (fbm(m.x * 0.06 + 13, m.z * 0.06) - 0.5) * 2.4) % 4) + 4) % 4]; if (m.y < 0.5) col = col.clone().multiplyScalar(0.82); }
      else if (m.y < 0.35) col = P.sandWet;
      else col = tint(patch < 0.42 ? P.grassDark : patch < 0.55 ? P.grass2 : P.grass, m.x, m.y, m.z, 3);
    } else {
      // 洞壁：一層層的岩石；潭底是濕沙；水面以下顏色深。再照「看得到多少天光」壓暗——
      // 天窗正下方和豎井最亮，離天窗越遠、越背對它越暗；暗門水道越靠近洞口越亮
      col = strata[((Math.floor(m.y / (BAND * 0.5) + (fbm(m.x * 0.06 + 13, m.z * 0.06) - 0.5) * 2.4) % 4) + 4) % 4];
      if (n.y > 0.6 && m.y < -2) col = P.sandWet.clone().multiplyScalar(0.8);
      else if (m.y < 0.4) col = col.clone().multiplyScalar(0.78);
      v.subVectors(skyO, m);
      const d = v.length(), facing = Math.max(0.25, n.dot(v) / d), down = Math.max(0, v.y / d);
      const sky = m.y > skyO.y - 4 ? 1 : Math.min(1, 2.6 * Math.PI * C.sky.r * C.sky.r * down * facing / (d * d));
      const door = Math.exp(-m.distanceTo(mouth) / 7);
      col = col.clone().multiplyScalar(0.46 + 0.54 * Math.min(1, Math.max(sky, door)));
    }
    fb.tri(a.clone(), b.clone(), c.clone(), jitter(col, r, 0.05), [0, 0, 0], 0.25);
  }
  const mesh = new THREE.Mesh(fb.build(), mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;   // 洞壁在山裡面，影子由山坡投
  mesh.userData.noCast = true;
  group.add(mesh);
  return mesh;
}
