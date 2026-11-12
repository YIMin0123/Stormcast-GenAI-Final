// FFT 頻譜海浪（Tessendorf 方法）：三層級聯，每層 256×256 個波，全部在 GPU 上算。
// 每幀流程：頻譜隨時間演化 → 逆 FFT → 位移圖（含累積泡沫）→ 斜率圖（含 mipmap）。
import * as THREE from 'three';

const G = 9.81;
const TAU = Math.PI * 2;

const quadVert = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// h(k,t) = h0(k) e^{-iωt} + conj(h0(-k)) e^{+iωt}，並同時準備水平位移的頻譜
const spectrumFrag = /* glsl */ `
uniform sampler2D uH0;
uniform int uN;
uniform float uPatch, uTime;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 mn = vec2(p);
  float n = float(uN);
  mn = mix(mn, mn - n, step(n * 0.5, mn));
  vec2 k = 6.2831853 * mn / uPatch;
  float kl = length(k);
  vec4 h0 = texelFetch(uH0, p, 0);
  // 每道浪的角速度湊成 2π/2048 的整數倍：時間每 2048 秒繞一圈時接得起來（多人模式下大家的浪才對得上，見 weather.js 的 WAVE_LOOP）
  float w = floor(sqrt(9.81 * kl) / 0.0030679616 + 0.5) * 0.0030679616 * uTime;
  float c = cos(w), s = sin(w);
  vec2 h = vec2(h0.x * c + h0.y * s, h0.y * c - h0.x * s) + vec2(h0.z * c - h0.w * s, h0.w * c + h0.z * s);
  vec2 ih = vec2(-h.y, h.x);
  vec2 kn = kl > 1e-6 ? k / kl : vec2(0.0);
  vec2 dx = ih * kn.x, dz = ih * kn.y;
  // 兩個實數訊號塞進一個複數：(h + i·Dx)、(Dz)
  gl_FragColor = vec4(h.x - dx.y, h.y + dx.x, dz.x, dz.y);
}
`;

// Stockham 形式的 FFT，一次處理一個階段；不需要位元反轉
const fftFrag = /* glsl */ `
uniform sampler2D uInput;
uniform int uN, uSub;
uniform bool uHoriz;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int idx = uHoriz ? p.x : p.y;
  int hs = uSub / 2;
  int ev = (idx / uSub) * hs + (idx % hs);
  ivec2 pe = uHoriz ? ivec2(ev, p.y) : ivec2(p.x, ev);
  ivec2 po = uHoriz ? ivec2(ev + uN / 2, p.y) : ivec2(p.x, ev + uN / 2);
  vec4 e = texelFetch(uInput, pe, 0), o = texelFetch(uInput, po, 0);
  float a = 6.2831853 * float(idx % uSub) / float(uSub);
  vec2 tw = vec2(cos(a), sin(a));
  gl_FragColor = vec4(e.xy + cmul(tw, o.xy), e.zw + cmul(tw, o.zw));
}
`;

const wrapFn = /* glsl */ `
uniform int uN;
ivec2 wrap(ivec2 p) { return ivec2((p.x + uN) % uN, (p.y + uN) % uN); }
`;

// 位移圖：rgb = (Dx, h, Dz)，a = 累積泡沫（波面摺疊處產生，隨時間衰減）
const dispFrag = /* glsl */ `
${wrapFn}
uniform sampler2D uFft;
uniform sampler2D uPrev;
uniform float uPatch, uChop, uDecay, uFoamBias, uScale;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(uFft, p, 0);
  vec4 xp = texelFetch(uFft, wrap(p + ivec2(1, 0)), 0), xm = texelFetch(uFft, wrap(p - ivec2(1, 0)), 0);
  vec4 zp = texelFetch(uFft, wrap(p + ivec2(0, 1)), 0), zm = texelFetch(uFft, wrap(p - ivec2(0, 1)), 0);
  float k = uChop * uScale / (2.0 * uPatch / float(uN));
  float dDxdx = k * (xp.y - xm.y), dDzdz = k * (zp.z - zm.z);
  float dDxdz = k * (zp.y - zm.y), dDzdx = k * (xp.z - xm.z);
  float J = (1.0 + dDxdx) * (1.0 + dDzdz) - dDxdz * dDzdx;
  float prev = texelFetch(uPrev, p, 0).a;
  float foam = max(prev * uDecay, clamp((uFoamBias - J) * 3.0, 0.0, 1.0));
  gl_FragColor = vec4(uChop * c.y, c.x, uChop * c.z, foam);
}
`;

// 斜率圖：rg = (∂h/∂x, ∂h/∂z)，b = 水平位移的散度，a = 泡沫
const slopeFrag = /* glsl */ `
${wrapFn}
uniform sampler2D uDisp;
uniform float uPatch;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 xp = texelFetch(uDisp, wrap(p + ivec2(1, 0)), 0), xm = texelFetch(uDisp, wrap(p - ivec2(1, 0)), 0);
  vec4 zp = texelFetch(uDisp, wrap(p + ivec2(0, 1)), 0), zm = texelFetch(uDisp, wrap(p - ivec2(0, 1)), 0);
  float k = 1.0 / (2.0 * uPatch / float(uN));
  gl_FragColor = vec4(k * (xp.y - xm.y), k * (zp.y - zm.y), k * ((xp.x - xm.x) + (zp.z - zm.z)),
                      texelFetch(uDisp, p, 0).a);
}
`;

function jonswap(omega, U, fetch) {
  const alpha = 0.076 * Math.pow((U * U) / (fetch * G), 0.22);
  const wp = 22 * Math.pow((G * G) / (U * fetch), 1 / 3);
  const sigma = omega <= wp ? 0.07 : 0.09;
  const r = Math.exp(-((omega - wp) ** 2) / (2 * sigma * sigma * wp * wp));
  return (alpha * G * G) / omega ** 5 * Math.exp(-1.25 * (wp / omega) ** 4) * Math.pow(3.3, r);
}

export class FftOcean {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    const N = this.N = opts.size ?? 256;
    this.patches = opts.patches ?? [700, 113, 23];
    this.chop = opts.chop ?? 0.85;
    const windAngle = opts.windAngle ?? Math.PI / 2 + 0.3;
    const U = opts.windSpeed ?? 14, fetch = opts.fetch ?? 2e5, hsTarget = opts.hs ?? 2.2;
    // floatRT：顯示晶片能不能畫進 32 位元浮點貼圖（不少手機只能畫 16 位元的）。不能的話 FFT 整個改用 16 位元算
    this.floatRT = renderer.extensions.has('EXT_color_buffer_float');
    const fftType = this.floatRT ? THREE.FloatType : THREE.HalfFloatType;
    // 位移圖能做線性過濾時才用 32 位元；否則退回 16 位元。船的浮力照樣讀回（16 位元的另外換算，見 _read）
    const mapType = this.floatRT && renderer.extensions.has('OES_texture_float_linear') ? THREE.FloatType : THREE.HalfFloatType;
    this.canRead = true;

    // ---- 初始頻譜（CPU）----
    let seed = 20240611;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(TAU * rnd());
    const raw = [];
    let variance = 0;
    this.patches.forEach((L, ci) => {
      const dk = TAU / L;
      const kMin = ci === 0 ? 0 : (TAU / L) * 6;
      const kMax = ci === this.patches.length - 1 ? Infinity : (TAU / this.patches[ci + 1]) * 6;
      const h = new Float32Array(N * N * 2);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const kx = dk * (i < N / 2 ? i : i - N), kz = dk * (j < N / 2 ? j : j - N);
          const k = Math.hypot(kx, kz);
          if (k < 1e-6 || k < kMin || k >= kMax) continue;
          const omega = Math.sqrt(G * k);
          const dth = Math.atan2(kz, kx) - windAngle;
          const cosd = Math.cos(dth);
          // 順風為主（cos⁴ 分佈），留一點逆風成分讓海面不那麼單向
          const D = (cosd > 0 ? (8 / (3 * Math.PI)) * cosd ** 4 : 0) * 0.94 + 0.06 / TAU;
          const Sk = jonswap(omega, U, fetch) * D * (G / (2 * omega)) / k;
          const amp = Math.sqrt(Math.max(Sk, 0) * dk * dk * 0.5);
          const o = (j * N + i) * 2;
          h[o] = gauss() * amp; h[o + 1] = gauss() * amp;
          variance += h[o] * h[o] + h[o + 1] * h[o + 1];
        }
      }
      raw.push(h);
    });
    // 每個波數同時有 h0(k) 與 h0(-k) 兩項貢獻，所以總變異數是兩倍
    const norm0 = hsTarget / (4 * Math.sqrt(2 * variance));

    const target = (type, mip) => {
      const t = new THREE.WebGLRenderTarget(N, N, {
        type, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
        minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter,
        magFilter: mip ? THREE.LinearFilter : THREE.NearestFilter,
        generateMipmaps: mip,
        wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      });
      if (mip) t.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return t;
    };

    this.fft = [target(fftType, false), target(fftType, false)];
    // JONSWAP 的能量集中在長浪，短浪偏弱，海面會太平滑；這裡把中、短波加強到接近實測的海面粗糙度
    const gain = opts.gain ?? [1, 1.7, 2.0];
    this.cascades = raw.map((h, ci) => {
      const norm = norm0 * gain[ci];
      const data = new Float32Array(N * N * 4);
      let slopeVar = 0;
      const dk = TAU / this.patches[ci];
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const o = (j * N + i) * 2, m = (((N - j) % N) * N + ((N - i) % N)) * 2, d = (j * N + i) * 4;
          data[d] = h[o] * norm; data[d + 1] = h[o + 1] * norm;
          data[d + 2] = h[m] * norm; data[d + 3] = -h[m + 1] * norm;
          const kx = dk * (i < N / 2 ? i : i - N), kz = dk * (j < N / 2 ? j : j - N);
          slopeVar += 2 * (kx * kx + kz * kz) * (data[d] ** 2 + data[d + 1] ** 2);
        }
      }
      const h0 = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
      h0.minFilter = h0.magFilter = THREE.NearestFilter;
      h0.needsUpdate = true;
      return {
        patch: this.patches[ci], h0, slopeVar,
        disp: [target(mapType, true), target(mapType, true)], cur: 0,
        slope: target(THREE.HalfFloatType, true),
      };
    });

    const mat = (frag, uniforms) => new THREE.ShaderMaterial({
      vertexShader: quadVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false,
    });
    this.mSpec = mat(spectrumFrag, { uH0: { value: null }, uN: { value: N }, uPatch: { value: 1 }, uTime: { value: 0 } });
    this.mFft = mat(fftFrag, { uInput: { value: null }, uN: { value: N }, uSub: { value: 2 }, uHoriz: { value: true } });
    this.mDisp = mat(dispFrag, {
      uFft: { value: null }, uPrev: { value: null }, uN: { value: N }, uPatch: { value: 1 },
      uChop: { value: this.chop }, uDecay: { value: 1 }, uFoamBias: { value: 0.8 }, uScale: { value: 1 },
    });
    this.mSlope = mat(slopeFrag, { uDisp: { value: null }, uN: { value: N }, uPatch: { value: 1 } });

    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.stages = Math.round(Math.log2(N));
    this.readBuf = new Float32Array(16);
    this.scale = 1;
  }

  // 把位移圖的一塊讀回 CPU（Float32Array）。16 位元的圖：能用 32 位元讀就直接讀，不能的話讀 16 位元再換算。
  // 真的讀不了（少數手機）時 out 維持原樣（全 0），船就只是不跟著浪起伏，遊戲照跑
  _read(rt, x, y, w, h, out) {
    if (rt.texture.type === THREE.FloatType) { this.renderer.readRenderTargetPixels(rt, x, y, w, h, out); return; }
    const gl = this.renderer.getContext(), prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt);
    if (this.floatRT) gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, out);
    else {
      const n = w * h * 4;
      if (!this._half || this._half.length < n) this._half = new Uint16Array(n);
      const hb = this._half.subarray(0, n);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.HALF_FLOAT, hb);
      for (let i = 0; i < n; i++) out[i] = THREE.DataUtils.fromHalfFloat(hb[i]);
    }
    this.renderer.setRenderTarget(prev);
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  // t：模擬時間；dt：距上次更新的時間（控制泡沫衰減）；scale：風浪強度
  // foamScale：累積白浪用的強度（風暴時外海的浪比 scale 大，白浪要跟著變多）
  update(t, dt, scale, foamScale = scale) {
    this.scale = scale;
    const N = this.N;
    this.cascades.forEach((c, ci) => {
      const su = this.mSpec.uniforms;
      su.uH0.value = c.h0; su.uPatch.value = c.patch; su.uTime.value = t % 2048;
      this.pass(this.mSpec, this.fft[0]);

      let src = 0;
      const fu = this.mFft.uniforms;
      for (let s = 0; s < this.stages * 2; s++) {
        fu.uInput.value = this.fft[src].texture;
        fu.uHoriz.value = s < this.stages;
        fu.uSub.value = 2 << (s % this.stages);
        this.pass(this.mFft, this.fft[1 - src]);
        src = 1 - src;
      }

      const du = this.mDisp.uniforms;
      du.uFft.value = this.fft[src].texture;
      du.uPrev.value = c.disp[c.cur].texture;
      du.uPatch.value = c.patch;
      du.uScale.value = foamScale;
      // 大浪的泡沫留得久，小浪的消得快
      du.uDecay.value = Math.exp(-dt / [5.5, 2.2, 0.8][ci]);
      du.uFoamBias.value = [0.95, 0.93, 0.86][ci];
      c.cur = 1 - c.cur;
      this.pass(this.mDisp, c.disp[c.cur]);

      const lu = this.mSlope.uniforms;
      lu.uDisp.value = c.disp[c.cur].texture; lu.uPatch.value = c.patch;
      this.pass(this.mSlope, c.slope);
    });
    this.renderer.setRenderTarget(null);
  }

  // 一次讀回 (x, z) 周圍 8×8 格的浪高，之後用 sampleCached 取樣，避免每個取樣點都向 GPU 要資料
  cacheBlock(x, z) {
    if (!this.canRead) return;
    const c = this.cascades[0], N = this.N, B = 8;
    const gx = ((x / c.patch) % 1 + 1) % 1 * N, gz = ((z / c.patch) % 1 + 1) % 1 * N;
    const bi = Math.min(N - B, Math.max(0, Math.floor(gx) - B / 2));
    const bj = Math.min(N - B, Math.max(0, Math.floor(gz) - B / 2));
    this.blockX0 = x - (gx - bi) * c.patch / N;
    this.blockZ0 = z - (gz - bj) * c.patch / N;
    if (!this.blockBuf) this.blockBuf = new Float32Array(B * B * 4);
    this._read(c.disp[c.cur], bi, bj, B, B, this.blockBuf);
    // 第二層（波長三到十幾公尺的中浪）也讀一塊：畫面上的海面是這兩層加起來的，船要跟著同一片水面浮沉，
    // 不然小一點的浪會直接穿過船身。這一層每 113 公尺重複一次，船常常跨在接縫上，所以要繞回另一頭去讀
    const c1 = this.cascades[1], B1 = this.B1 = 48, t1 = N / c1.patch;
    const g1x = ((x / c1.patch) % 1 + 1) % 1 * N, g1z = ((z / c1.patch) % 1 + 1) % 1 * N;
    const i1 = Math.floor(g1x) - B1 / 2, j1 = Math.floor(g1z) - B1 / 2;
    this.b1X0 = x - (g1x - i1) / t1; this.b1Z0 = z - (g1z - j1) / t1;
    if (!this.block1) { this.block1 = new Float32Array(B1 * B1 * 4); this._tmp1 = new Float32Array(B1 * B1 * 4); }
    const wi = ((i1 % N) + N) % N, wj = ((j1 % N) + N) % N, w0 = Math.min(B1, N - wi), h0 = Math.min(B1, N - wj);
    const part = (sx, sy, w, h, dx, dy) => {
      this._read(c1.disp[c1.cur], sx, sy, w, h, this._tmp1);
      for (let r = 0; r < h; r++) this.block1.set(this._tmp1.subarray(r * w * 4, (r + 1) * w * 4), ((dy + r) * B1 + dx) * 4);
    };
    part(wi, wj, w0, h0, 0, 0);
    if (w0 < B1) part(0, wj, B1 - w0, h0, w0, 0);
    if (h0 < B1) part(wi, 0, w0, B1 - h0, 0, h0);
    if (w0 < B1 && h0 < B1) part(0, 0, B1 - w0, B1 - h0, w0, h0);
  }

  // 兩層位移在 (x, z) 的總和，寫進 out[0..2]（還沒乘上浪的強度）
  _disp(x, z, out) {
    const bil = (b, B, fx, fz, k) => {
      fx = Math.min(B - 1.001, Math.max(0, fx)); fz = Math.min(B - 1.001, Math.max(0, fz));
      const i = Math.floor(fx), j = Math.floor(fz), ax = fx - i, az = fz - j, o = (j * B + i) * 4 + k;
      return (b[o] * (1 - ax) + b[o + 4] * ax) * (1 - az) + (b[o + B * 4] * (1 - ax) + b[o + B * 4 + 4] * ax) * az;
    };
    const t0 = this.N / this.cascades[0].patch, t1 = this.N / this.cascades[1].patch;
    const x0 = (x - this.blockX0) * t0 - 0.5, z0 = (z - this.blockZ0) * t0 - 0.5, x1 = (x - this.b1X0) * t1 - 0.5, z1 = (z - this.b1Z0) * t1 - 0.5;
    for (let k = 0; k < 3; k++) out[k] = bil(this.blockBuf, 8, x0, z0, k) + bil(this.block1, this.B1, x1, z1, k);
    return out;
  }

  // 畫面上 (x, z) 正上方的水面高度（公尺），算法跟海面的 shader 一樣：兩層位移相加；
  // 浪頭的水是往旁邊擠過去的（水平位移），所以 (x, z) 上方的那一點其實是從旁邊的網格點搬過來的，要倒推回去找。
  // k：這裡的浪放大幾倍（避浪、風暴、淺水變小）
  sampleSurface(x, z, k = 1) {
    if (!this.blockBuf || !this.block1) return this.sampleCached(x, z) * k;
    const s = this.scale * k, d = this._dv || (this._dv = [0, 0, 0]);
    let px = x, pz = z;
    for (let it = 0; it < 2; it++) { this._disp(px, pz, d); px = x - d[0] * s; pz = z - d[2] * s; }
    return this._disp(px, pz, d)[1] * s;
  }

  sampleCached(x, z) {
    if (!this.blockBuf) return 0;
    const B = 8, t = this.N / this.cascades[0].patch, b = this.blockBuf;
    const fx = Math.min(B - 1.001, Math.max(0, (x - this.blockX0) * t - 0.5));
    const fz = Math.min(B - 1.001, Math.max(0, (z - this.blockZ0) * t - 0.5));
    const i = Math.floor(fx), j = Math.floor(fz), ax = fx - i, az = fz - j;
    const at = (ii, jj) => b[(jj * B + ii) * 4 + 1];
    return ((at(i, j) * (1 - ax) + at(i + 1, j) * ax) * (1 - az)
      + (at(i, j + 1) * (1 - ax) + at(i + 1, j + 1) * ax) * az) * this.scale;
  }

  // 讀回最大一層在 (x, z) 的浪高（公尺），給船的浮力用
  sampleHeight(x, z) {
    if (!this.canRead) return 0;
    const c = this.cascades[0], N = this.N;
    const gx = ((x / c.patch) % 1 + 1) % 1 * N - 0.5, gz = ((z / c.patch) % 1 + 1) % 1 * N - 0.5;
    const i = Math.min(N - 2, Math.max(0, Math.floor(gx))), j = Math.min(N - 2, Math.max(0, Math.floor(gz)));
    const fx = Math.min(1, Math.max(0, gx - i)), fz = Math.min(1, Math.max(0, gz - j));
    this._read(c.disp[c.cur], i, j, 2, 2, this.readBuf);
    const b = this.readBuf;
    return ((b[1] * (1 - fx) + b[5] * fx) * (1 - fz) + (b[9] * (1 - fx) + b[13] * fx) * fz) * this.scale;
  }
}

// 可無縫拼接的細胞雜訊貼圖，當作泡沫的紋理（氣泡網狀結構）
export function makeFoamTexture(size = 256) {
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const layer = (cells) => {
    const pts = Array.from({ length: cells * cells }, () => [rnd(), rnd()]);
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const px = (x / size) * cells, py = (y / size) * cells;
        const cx = Math.floor(px), cy = Math.floor(py);
        let f1 = 9, f2 = 9;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const ix = (cx + ox + cells) % cells, iy = (cy + oy + cells) % cells;
            const p = pts[iy * cells + ix];
            const d = Math.hypot(cx + ox + p[0] - px, cy + oy + p[1] - py);
            if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
          }
        }
        // 氣泡中心暗、邊界亮
        out[y * size + x] = Math.min(1, f1 * 1.15) * (0.55 + 0.45 * Math.min(1, (f2 - f1) * 3 + 0.3));
      }
    }
    return out;
  };
  const a = layer(9), b = layer(23), c = layer(51);
  const data = new Uint8Array(size * size * 4);
  for (let k = 0; k < size * size; k++) {
    const v = Math.min(1, a[k] * 0.5 + b[k] * 0.32 + c[k] * 0.28);
    data[k * 4] = data[k * 4 + 1] = data[k * 4 + 2] = Math.round(v * 255);
    data[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
