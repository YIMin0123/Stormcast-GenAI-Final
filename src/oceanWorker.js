// 在背景執行緒用 CPU 算最大兩層 FFT 海浪的位移圖，給船的浮力、游泳、鏡頭等要知道浪高的地方用。
// 算法跟 ocean.js 裡顯示晶片的那一套一模一樣（頻譜隨時間演化 → Stockham 逆 FFT → 位移），算出來的海面跟畫面上的一致。
// 以前是從顯示晶片讀回來，但手機上的 Chrome 每讀一次 CPU 就得停下來等十幾毫秒，一幀的時間有一大半耗在那裡。
//
// 收：{ init: { N, chop, h0: [Float32Array, ...], patch: [...] } }，之後每次 { t, bufs: [Float32Array, ...] }（bufs 用完還回來再利用）
// 回：{ t, bufs: [每層一張 N×N×4 的 (Dx, h, Dz, 0)] }
let N = 0, chop = 1, H0 = [], PATCH = [], W = [], KX = [], KZ = [], stages = 0;
let a0, a1, b0, b1;   // FFT 用的兩組（實部、虛部交錯）工作區：A = h + i·Dx、B = Dz
let tw = [];          // 每個階段的旋轉因子與索引

function init(o) {
  N = o.N; chop = o.chop; H0 = o.h0; PATCH = o.patch;
  stages = Math.round(Math.log2(N));
  const n = N * N;
  a0 = new Float64Array(2 * n); a1 = new Float64Array(2 * n);
  b0 = new Float64Array(2 * n); b1 = new Float64Array(2 * n);
  // 每道浪的角速度（跟著色器一樣湊成 2π/2048 的整數倍）與水平位移的方向
  W = []; KX = []; KZ = [];
  for (let ci = 0; ci < H0.length; ci++) {
    const w = new Float64Array(n), kx = new Float64Array(n), kz = new Float64Array(n);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const m = i >= N / 2 ? i - N : i, q = j >= N / 2 ? j - N : j;
      const x = 6.2831853 * m / PATCH[ci], z = 6.2831853 * q / PATCH[ci], kl = Math.hypot(x, z), p = j * N + i;
      w[p] = Math.floor(Math.sqrt(9.81 * kl) / 0.0030679616 + 0.5) * 0.0030679616;
      kx[p] = kl > 1e-6 ? x / kl : 0; kz[p] = kl > 1e-6 ? z / kl : 0;
    }
    W.push(w); KX.push(kx); KZ.push(kz);
  }
  // Stockham：第 s 階段子序列長 sub = 2,4,…,N；輸出 idx 取輸入的 ev 與 ev + N/2
  tw = [];
  for (let s = 0; s < stages; s++) {
    const sub = 2 << s, hs = sub / 2, ev = new Int32Array(N), c = new Float64Array(N), si = new Float64Array(N);
    for (let idx = 0; idx < N; idx++) {
      ev[idx] = Math.floor(idx / sub) * hs + (idx % hs);
      const a = 6.2831853 * (idx % sub) / sub;
      c[idx] = Math.cos(a); si[idx] = Math.sin(a);
    }
    tw.push({ ev, c, s: si });
  }
}

// 一個階段：horiz = 沿 x（同一列裡）做；否則沿 z（同一行裡）。兩種分開寫，內層迴圈才沒有分支
function stage(src, dst, t, horiz) {
  const half = N / 2, { ev, c, s } = t;
  if (horiz) {
    for (let r = 0; r < N; r++) {
      const row = r * N;
      for (let idx = 0; idx < N; idx++) {
        const pe = 2 * (row + ev[idx]), po = pe + 2 * half, p = 2 * (row + idx);
        const or = src[po], oi = src[po + 1], cr = c[idx], ci = s[idx];
        dst[p] = src[pe] + cr * or - ci * oi;
        dst[p + 1] = src[pe + 1] + cr * oi + ci * or;
      }
    }
  } else {
    for (let idx = 0; idx < N; idx++) {
      const re = 2 * ev[idx] * N, ro = re + 2 * half * N, rp = 2 * idx * N, cr = c[idx], ci = s[idx];
      for (let col = 0; col < 2 * N; col += 2) {
        const pe = re + col, po = ro + col, p = rp + col;
        const or = src[po], oi = src[po + 1];
        dst[p] = src[pe] + cr * or - ci * oi;
        dst[p + 1] = src[pe + 1] + cr * oi + ci * or;
      }
    }
  }
}

function fft2(x, y) {   // 結果在回傳的那一個陣列裡
  let src = x, dst = y;
  for (let s = 0; s < stages * 2; s++) {
    stage(src, dst, tw[s % stages], s < stages);
    const k = src; src = dst; dst = k;
  }
  return src;
}

function cascade(ci, t, out) {
  const h0 = H0[ci], w = W[ci], kx = KX[ci], kz = KZ[ci], n = N * N;
  for (let p = 0; p < n; p++) {
    const ang = w[p] * t, c = Math.cos(ang), s = Math.sin(ang), q = p * 4;
    const hx = h0[q] * c + h0[q + 1] * s + h0[q + 2] * c - h0[q + 3] * s;
    const hy = h0[q + 1] * c - h0[q] * s + h0[q + 3] * c + h0[q + 2] * s;
    // i·h 乘上水平方向：Dx、Dz 的頻譜
    const dxr = -hy * kx[p], dxi = hx * kx[p], dzr = -hy * kz[p], dzi = hx * kz[p];
    a0[2 * p] = hx - dxi; a0[2 * p + 1] = hy + dxr;
    b0[2 * p] = dzr; b0[2 * p + 1] = dzi;
  }
  const A = fft2(a0, a1), B = fft2(b0, b1);
  for (let p = 0; p < n; p++) {
    out[4 * p] = chop * A[2 * p + 1];
    out[4 * p + 1] = A[2 * p];
    out[4 * p + 2] = chop * B[2 * p];
    out[4 * p + 3] = 0;
  }
}

self.onmessage = (e) => {
  const d = e.data;
  if (d.init) { init(d.init); return; }
  const bufs = d.bufs || H0.map(() => new Float32Array(N * N * 4));
  for (let ci = 0; ci < H0.length; ci++) cascade(ci, d.t, bufs[ci]);
  self.postMessage({ t: d.t, bufs }, bufs.map((b) => b.buffer));
};
