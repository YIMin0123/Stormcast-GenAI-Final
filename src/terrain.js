// 地圖：開闊海洋上的六座島，沒有大陸。高程單位公尺，海平面 = 0，負值為海底。
// 座標原點在地圖中心，+z 是南方（風浪由北往南傳）。

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// 輸出約落在 [-1, 1]
function fbm(x, y, seed, octaves = 5) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (valueNoise(x, y, seed + o * 17) * 2 - 1);
    norm += amp;
    x *= 2.03; y *= 2.03; amp *= 0.5;
  }
  return sum / norm;
}

export const SEA_FLOOR = -30;

// 每座島由一到數個圓丘組成：位置（公尺）、半徑、峰頂高度；pow 越大頂部越平（沙洲用）
// R：島的大概半徑（著色與佈景用）
// shape：地形的性格——beach/bw 沙灘壓得多平、多寬；jag 礁岩的崎嶇程度；cliff 斷崖的高度（公尺）；hill 山丘起伏
// look：地表的樣子——rock 裸岩多寡、veg 草木多寡、white 沙子多白、dry 草有多乾黃
// flora：島上種什麼、擺多少石頭
export const ISLANDS = [
  {
    id: 'home', name: '母港島', x: 0, z: 40, R: 150, bumps: [{ x: 0, z: 40, r: 125, peak: 18 }],
    shape: { beach: 0.72, bw: 2.2, jag: 0, cliff: 0, hill: 0.28 },
    look: { rock: 0.12, veg: 1.0, white: 0.15, dry: 0.15 },
    flora: { broadleaf: 300, conifer: 150, palm: 0, bush: 160, shoreRock: 46, landRock: 30 },
  },
  {
    id: 'west', name: '西嶼', x: -520, z: -360, R: 125, bumps: [{ x: -520, z: -360, r: 95, peak: 23 }],
    shape: { beach: 0.5, bw: 1.7, jag: 0.10, cliff: 0, hill: 0.36 },
    look: { rock: 0.45, veg: 0.9, white: 0.0, dry: 0.1 },
    flora: { broadleaf: 30, conifer: 380, palm: 0, bush: 80, shoreRock: 90, landRock: 50 },
  },
  {
    id: 'twin', name: '雙峰島', x: 530, z: -380, R: 150, bumps: [{ x: 500, z: -400, r: 100, peak: 22 }, { x: 600, z: -330, r: 70, peak: 13 }],
    shape: { beach: 0.45, bw: 1.6, jag: 0.12, cliff: 7, hill: 0.24 },
    look: { rock: 0.7, veg: 0.55, white: 0.05, dry: 0.45 },
    flora: { broadleaf: 60, conifer: 120, palm: 0, bush: 140, shoreRock: 110, landRock: 90 },
  },
  {
    id: 'rocks', name: '北礁', x: 0, z: -660, R: 110,
    bumps: [{ x: 0, z: -660, r: 45, peak: 9 }, { x: 60, z: -700, r: 32, peak: 6 }, { x: -55, z: -625, r: 28, peak: 5 },
      { x: -20, z: -712, r: 14, peak: 7 }, { x: 38, z: -636, r: 12, peak: 6 }, { x: -84, z: -672, r: 10, peak: 4 }, { x: 98, z: -655, r: 9, peak: 5 }],
    shape: { beach: 0.12, bw: 1.2, jag: 0.55, cliff: 0, hill: 0.3 },
    look: { rock: 1.0, veg: 0.08, white: 0.0, dry: 0.6 },
    flora: { broadleaf: 0, conifer: 0, palm: 0, bush: 18, shoreRock: 190, landRock: 70 },
  },
  {
    id: 'sand', name: '沙洲島', x: -540, z: 420, R: 150, bumps: [{ x: -560, z: 400, r: 105, peak: 3.5, pow: 4 }, { x: -500, z: 445, r: 65, peak: 2.5, pow: 4 }],
    shape: { beach: 0.86, bw: 3.0, jag: 0, cliff: 0, hill: 0.12 },
    look: { rock: 0.0, veg: 0.35, white: 1.0, dry: 0.5 },
    flora: { broadleaf: 0, conifer: 0, palm: 150, bush: 130, shoreRock: 8, landRock: 0 },
  },
  {
    id: 'east', name: '東嶼', x: 560, z: 380, R: 120, bumps: [{ x: 560, z: 380, r: 90, peak: 11 }],
    shape: { beach: 0.62, bw: 2.0, jag: 0.05, cliff: 2.2, hill: 0.32 },
    look: { rock: 0.4, veg: 0.7, white: 0.25, dry: 0.3 },
    flora: { broadleaf: 110, conifer: 20, palm: 0, bush: 150, shoreRock: 60, landRock: 60 },
  },
];

// 母港：在母港島南側（背風面）挖出一個港灣。岸邊留一塊平地蓋岸壁和房子；西邊一道斜坡（船揚場）一路伸進水裡
export const HOME = {
  cove: { x: -4, z: 144, r: 46, depth: 11 },
  terrace: { x0: -31, x1: 23, z0: 101, z1: 108, y: 0.9, blend: 10, back: 2.6 },   // back：靠山那一側用擋土牆收邊，平地很快就接回山坡
  ramp: { x0: -41, x1: -33, z0: 106, z1: 126, top: 1.15, bottom: -1.7 },
  // 防波堤底下的拋石基座：堤身和外側的消波塊都坐在這上面，往兩邊斜斜地下到海床
  mole: { rects: [{ x0: 18, x1: 26.5, z0: 116, z1: 164.5 }, { x0: -14.5, x1: 26.5, z0: 156, z1: 164.5 }], top: -1.0, slope: 1.1 },
};

// 稜線狀的雜訊（礁岩的尖脊）：輸出約落在 [0, 1]
function ridged(x, y, seed) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < 3; o++) {
    sum += amp * (1 - Math.abs(valueNoise(x, y, seed + o * 31) * 2 - 1));
    norm += amp;
    x *= 2.1; y *= 2.1; amp *= 0.5;
  }
  return sum / norm;
}
const SHAPE_KEYS = ['beach', 'bw', 'jag', 'cliff', 'hill'];

export function makeTerrain(N, L, seed = 11) {
  const bed = new Float32Array(N * N);
  const rises = new Float32Array(ISLANDS.length), sh = {};
  const T = HOME.terrace, C = HOME.cove;

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N, v = (j + 0.5) / N;
      const x = (u - 0.5) * L, z = (v - 0.5) * L;
      // 把取樣位置扭曲一下，海岸線才不會是正圓
      // 母港島扭曲得少（海灣與平台的位置要準），其他島扭曲得多，輪廓各有不同
      const far = Math.min(1, Math.max(0, (Math.hypot(x, z - 40) - 180) / 220));
      const amp = 18 + 30 * far * far * (3 - 2 * far);
      const wx = x + amp * fbm(u * 9 + 1.7, v * 9, seed + 400, 3) + 7 * fbm(u * 37, v * 37 + 2.1, seed + 600, 2);
      const wz = z + amp * fbm(u * 9, v * 9 + 5.2, seed + 500, 3) + 7 * fbm(u * 37 + 4.4, v * 37, seed + 700, 2);

      // 多個圓丘取最高者（不相加），重疊處才不會疊成一座高山
      let rise = 0, near = 0;
      for (let n = 0; n < ISLANDS.length; n++) {
        let r = 0;
        for (const o of ISLANDS[n].bumps) {
          const d2 = ((wx - o.x) ** 2 + (wz - o.z) ** 2) / (o.r * o.r);
          r = Math.max(r, (o.peak - SEA_FLOOR) * Math.exp(-(o.pow === 4 ? d2 * d2 : d2)));
        }
        rises[n] = r;
        if (r > rise) { rise = r; near = n; }
      }
      let b = SEA_FLOOR + 3 * fbm(u * 6, v * 6, seed + 100, 4) + rise;
      if (rise < 4) { bed[j * N + i] = b; continue; }   // 離每座島都很遠的深海：不用再算下去

      // 這裡是哪座島的地盤，地形就照那座島的性格來（兩座島之間平滑過渡）
      let wsum = 0;
      for (const k of SHAPE_KEYS) sh[k] = 0;
      for (let n = 0; n < ISLANDS.length; n++) {
        const w = (rises[n] / rise) ** 6;
        if (w < 1e-4) continue;
        wsum += w;
        for (const k of SHAPE_KEYS) sh[k] += w * ISLANDS[n].shape[k];
      }
      for (const k of SHAPE_KEYS) sh[k] /= wsum;
      const isle = ISLANDS[near];

      // 山丘起伏：越高的地方越崎嶇
      b += sh.hill * Math.max(b + 2, 0) * fbm(u * 26, v * 26, seed + 300, 4);
      // 礁岩：一道一道的尖脊，露出水面就是礁石
      if (sh.jag > 0.01 && b > -8) {
        const r1 = ridged(u * 95, v * 95, seed + 800), r2 = ridged(u * 240, v * 240, seed + 850);
        b += sh.jag * Math.max(b + 5, 0) * ((r1 * r1 - 0.33) * 2.2 + (r2 * r2 - 0.33) * 1.1);
      }
      // 斷崖：某個高度以上整片抬高，迎風的北面最陡
      if (sh.cliff > 0.05 && b > 0.6) {
        const dn = (isle.z - z) / Math.max(Math.hypot(x - isle.x, z - isle.z), 1);   // 1 = 在島的正北邊
        // 崖腳的高度、崖有多高都隨地點變化，才不會像一圈整齊的蛋糕邊
        const wob = fbm(u * 17, v * 17, seed + 950, 3);
        const t = Math.min(1, Math.max(0, (b + 1.6 * fbm(u * 44, v * 44, seed + 900, 3) + 2.6 * wob - 1.6) / 1.0));
        b += sh.cliff * (0.75 + 0.9 * wob) * t * t * (3 - 2 * t) * (0.15 + 0.85 * Math.min(1, Math.max(0, dn * 1.4 + 0.4)));
      }

      // 沙灘：海平面上下這一段壓得比較平緩，島才不會像一座小山直接插進海裡；
      // 浪也才有一段沙灘可以沖上來、再退回去
      // 水面下壓得更寬：岸外有一片淺灘，浪才有地方捲起來、破掉，水色也才有由淺到深的一段
      const bw = b < 0 ? sh.bw * 3 : sh.bw;
      b *= 1 - sh.beach * Math.exp(-(b * b) / (bw * bw));

      // 母港海灣與平台用未扭曲的座標，位置才準
      b -= C.depth * Math.exp(-((x - C.x) ** 2 + (z - C.z) ** 2) / (C.r * C.r));
      const dx = Math.max(T.x0 - x, 0, x - T.x1), dz = Math.max((T.z0 - z) * (T.blend / T.back), 0, z - T.z1);
      const w = Math.max(0, 1 - Math.hypot(dx, dz) / T.blend);
      if (w > 0) b += (Math.min(Math.max(b, T.y - 0.2), T.y) - b) * w * w * (3 - 2 * w);
      // 船揚場：一道平整的斜坡，從岸上一路下到水裡
      const R = HOME.ramp, rx = Math.max(R.x0 - x, 0, x - R.x1), rz = Math.max(R.z0 - z, 0, z - R.z1);
      const rw = Math.max(0, 1 - Math.hypot(rx, rz) / 3);
      if (rw > 0) {
        const t = Math.min(1, Math.max(0, (z - R.z0) / (R.z1 - R.z0)));
        b += (R.top + (R.bottom - R.top) * t - b) * rw * rw * (3 - 2 * rw);
      }
      for (const m of HOME.mole.rects) {
        const d = Math.hypot(Math.max(m.x0 - x, 0, x - m.x1), Math.max(m.z0 - z, 0, z - m.z1));
        if (d < 22) b = Math.max(b, HOME.mole.top - d * HOME.mole.slope);
      }

      bed[j * N + i] = b;
    }
  }
  return { bed };
}

// 避浪係數（0 = 完全平靜，1 = 完全暴露）：逆著浪的來向看出去，若近處有陸地擋著就比較平靜。
// 島的背風面與港灣因此會是靜水。
export function computeShelter(bed, N, L, waveAngle) {
  const DX = L / N, STEP = 1.25, REACH = 260;
  const MAXS = Math.ceil(REACH / (STEP * DX));
  const out = new Float32Array(N * N).fill(1);
  const rays = [-0.22, 0, 0.22].map((da) => [-Math.cos(waveAngle + da) * STEP, -Math.sin(waveAngle + da) * STEP]);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (bed[k] > 0.5) { out[k] = 0; continue; }
      let sum = 0;
      for (const [sx, sz] of rays) {
        let e = 1, x = i, z = j;
        for (let s = 1; s <= MAXS; s++) {
          x += sx; z += sz;
          const xi = Math.round(x), zi = Math.round(z);
          if (xi < 0 || zi < 0 || xi >= N || zi >= N) break;
          if (bed[zi * N + xi] > 0.5) { e = Math.min(1, ((s * STEP * DX) / REACH) ** 1.5); break; }
        }
        sum += e;
      }
      out[k] = sum / 3;
    }
  }
  // 模糊幾次，模擬波浪繞射進遮蔽區
  const tmp = new Float32Array(N * N);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        let s = 0, c = 0;
        for (let dj = -2; dj <= 2; dj++) {
          const jj = j + dj; if (jj < 0 || jj >= N) continue;
          for (let di = -2; di <= 2; di++) {
            const ii = i + di; if (ii < 0 || ii >= N) continue;
            s += out[jj * N + ii]; c++;
          }
        }
        tmp[j * N + i] = s / c;
      }
    }
    out.set(tmp);
  }
  const bytes = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) bytes[k] = Math.round(Math.min(1, Math.max(0, out[k])) * 255);
  return bytes;
}

// 離岸距離（公尺，最多 max）：水裡的每一格離最近的陸地多遠。
// 岸邊的浪靠它知道岸在哪裡、朝哪個方向捲過去（跟風向無關，每一面海岸的浪都是朝著岸來的）。
export function computeShoreDist(bed, N, L, max = 96) {
  const DX = L / N, INF = 1e12;
  const f = new Float64Array(N * N);
  for (let k = 0; k < N * N; k++) f[k] = bed[k] >= 0 ? 0 : INF;
  // 精確的歐氏距離轉換：先每一欄、再每一列各做一次一維的（Felzenszwalb）
  const g = new Float64Array(N), d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1);
  const pass = () => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < N; q++) {
      let sx;
      for (;;) {
        const p = v[k];
        sx = ((g[q] + q * q) - (g[p] + p * p)) / (2 * q - 2 * p);
        if (sx <= z[k] && k > 0) k--; else break;
      }
      k++; v[k] = q; z[k] = sx; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < N; q++) {
      while (z[k + 1] < q) k++;
      const p = v[k];
      d[q] = (q - p) * (q - p) + g[p];
    }
  };
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) g[j] = f[j * N + i];
    pass();
    for (let j = 0; j < N; j++) f[j * N + i] = d[j];
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) g[i] = f[j * N + i];
    pass();
    for (let i = 0; i < N; i++) f[j * N + i] = d[i];
  }
  let out = new Float32Array(N * N), tmp = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) out[k] = Math.min(Math.max(Math.sqrt(f[k]) * DX - 0.5 * DX, 0), max);
  // 稍微抹平：海岸線是一格一格的，不抹的話浪頭的線條會跟著鋸齒
  for (let n = 0; n < 2; n++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, N - 1), j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, N - 1);
        tmp[j * N + i] = (out[j * N + i] * 4 + (out[j * N + i0] + out[j * N + i1] + out[j0 * N + i] + out[j1 * N + i]) * 2
          + out[j0 * N + i0] + out[j0 * N + i1] + out[j1 * N + i0] + out[j1 * N + i1]) / 16;
      }
    }
    [out, tmp] = [tmp, out];
  }
  return out;
}
