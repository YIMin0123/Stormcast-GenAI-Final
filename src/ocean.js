// FFT 頻譜海浪（Tessendorf 方法）：三層級聯，每層 256×256 個波，全部在 GPU 上算。
// 每幀流程：頻譜隨時間演化 → 逆 FFT → 位移圖（含累積泡沫）→ 斜率圖（含 mipmap）。
import * as THREE from 'three';

const G = 9.81;
const TAU = Math.PI * 2;

const quadVert = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// h(k,t) = h0(k) e^{-iωt} + conj(h0(-k)) e^{+iωt}，並同時準備水平位移的頻譜
// 三層並排在同一張 3N×N 的圖上一起算（手機的顯示晶片每換一次繪製目標都有固定的開銷，分開算要多換很多次）
const spectrumFrag = /* glsl */ `
uniform sampler2D uH0;
uniform int uN;
uniform vec3 uPatches;
uniform float uTime;
uniform vec2 uShape;   // 今天的海是哪一種浪：(kp² − kp0², A)，見 seaShape()
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int ci = p.x / uN;
  float uPatch = ci == 0 ? uPatches.x : (ci == 1 ? uPatches.y : uPatches.z);
  vec2 mn = vec2(float(p.x - ci * uN), float(p.y));
  float n = float(uN);
  mn = mix(mn, mn - n, step(n * 0.5, mn));
  vec2 k = 6.2831853 * mn / uPatch;
  float kl = length(k);
  vec4 h0 = texelFetch(uH0, p, 0) * (kl > 1e-6 ? uShape.y * exp(-0.625 * uShape.x / (kl * kl)) : 0.0);
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

// Stockham 形式的 FFT，一次處理一個階段；不需要位元反轉。三層並排（橫向那幾趟各自在自己那一塊裡做）
const fftFrag = /* glsl */ `
uniform sampler2D uInput;
uniform int uN, uSub;
uniform bool uHoriz;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int base = (p.x / uN) * uN;
  int idx = uHoriz ? p.x - base : p.y;
  int hs = uSub / 2;
  int ev = (idx / uSub) * hs + (idx % hs);
  ivec2 pe = uHoriz ? ivec2(base + ev, p.y) : ivec2(p.x, ev);
  ivec2 po = uHoriz ? ivec2(base + ev + uN / 2, p.y) : ivec2(p.x, ev + uN / 2);
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
uniform int uOff;   // 這一層在並排的 FFT 圖裡從第幾格開始
uniform float uPatch, uChop, uDecay, uFoamBias, uScale;
vec4 F(ivec2 q) { q = wrap(q); return texelFetch(uFft, ivec2(q.x + uOff, q.y), 0); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = F(p);
  vec4 xp = F(p + ivec2(1, 0)), xm = F(p - ivec2(1, 0));
  vec4 zp = F(p + ivec2(0, 1)), zm = F(p - ivec2(0, 1));
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

// 風浪的頻譜（Pierson–Moskowitz 的形狀）：短浪那一段跟風多大無關（已經飽和了），風越大只是多出越長的浪。
// 所以整片海只存「最大的海」那一份（浪峰波長 LAMBDA0），小一點的海每幀在著色器裡把比浪峰長的浪濾掉就是了：
// 小浪短而碎、大浪又長又慢，是同一份頻譜切在不同的地方
const LAMBDA0 = 150, KP0 = TAU / LAMBDA0;
function spectrum(omega) {
  const wp = Math.sqrt(G * KP0);
  return (G * G) / omega ** 5 * Math.exp(-1.25 * (wp / omega) ** 4);
}
// 外海的示性波高（公尺）→ 浪峰的波長（公尺）。小浪接近「吹了很久的海」（波長約波高的四十倍），
// 風暴的浪是新生的、比較陡（二十幾倍）；最長只到 LAMBDA0（再長的交給颱風的長浪）
const PEAK = [[0.25, 11], [0.75, 28], [1.3, 45], [2.5, 80], [5, 128], [7.5, LAMBDA0]];
export function peakLambda(hs) {
  if (hs <= PEAK[0][0]) return PEAK[0][1];
  for (let i = 1; i < PEAK.length; i++) if (hs <= PEAK[i][0]) {
    const [h0, l0] = PEAK[i - 1], [h1, l1] = PEAK[i];
    return l0 + (l1 - l0) * (hs - h0) / (h1 - h0);
  }
  return LAMBDA0;
}

export class FftOcean {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    const N = this.N = opts.size ?? 256;
    this.patches = opts.patches ?? [700, 113, 23];
    this.chop = opts.chop ?? 0.85;
    const windAngle = opts.windAngle ?? Math.PI / 2 + 0.3;
    const hsTarget = this.hs = opts.hs ?? 2.2;
    // lite（手機版的海面）：顯示晶片不算 FFT，畫面直接用背景執行緒算好的那兩層（見 _pump 與 renderShaders.js 的 liteWaterVert）
    this.lite = !!opts.lite;
    this.foamScale = 1;
    // floatRT：顯示晶片能不能畫進 32 位元浮點貼圖（不少手機只能畫 16 位元的）。不能的話 FFT 整個改用 16 位元算
    this.floatRT = renderer.extensions.has('EXT_color_buffer_float');
    const fftType = this.floatRT && !opts.fft16 ? THREE.FloatType : THREE.HalfFloatType;
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
          const Sk = spectrum(omega) * D * (G / (2 * omega)) / k;
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

    // aniso：各向異性過濾。只給斜率圖（像素著色器取樣、貼著水面看遠處才清楚）；
    // 位移圖是頂點著色器用 textureLod 取樣的，頂點階段用不到它，而且 Adreno（三星、小米等）在頂點階段
    // 「指定層級取樣＋各向異性過濾」會讀到亂值，海面變成越遠越高的斜坡
    const target = (type, mip, aniso = false, w = N) => {
      const t = new THREE.WebGLRenderTarget(w, N, {
        type, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
        minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter,
        magFilter: mip ? THREE.LinearFilter : THREE.NearestFilter,
        generateMipmaps: mip,
        wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      });
      if (mip && aniso) t.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return t;
    };

    const NC = this.patches.length;
    this.fft = [target(fftType, false, false, NC * N), target(fftType, false, false, NC * N)];
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
        // 最小那一層的位移圖只拿來算斜率，不用縮小版（省掉每幀做兩次縮小）
        disp: [target(mapType, ci < 2), target(mapType, ci < 2)], cur: 0,
        slope: target(THREE.HalfFloatType, true, true),
      };
    });

    // 能量照波數分成一格一格記下來：浪峰切在哪裡，整片海多高、各層多陡，查這張表就知道（見 seaShape）
    const NB = 400, kLo = TAU / this.patches[0] * 0.9, kHi = TAU / this.patches[NC - 1] * N;
    this._bins = { NB, kLo, lg: Math.log(kHi / kLo), e: this.cascades.map(() => new Float64Array(NB)), k2: new Float64Array(NB) };
    for (let b = 0; b < NB; b++) this._bins.k2[b] = (kLo * Math.exp((b + 0.5) / NB * this._bins.lg)) ** 2;
    this.cascades.forEach((c, ci) => {
      const d = c.h0.image.data, dk = TAU / c.patch, eb = this._bins.e[ci];
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const q = (j * N + i) * 4, en = d[q] * d[q] + d[q + 1] * d[q + 1];
        if (!en) continue;
        const k = dk * Math.hypot(i < N / 2 ? i : i - N, j < N / 2 ? j : j - N);
        eb[Math.min(NB - 1, Math.max(0, Math.floor(Math.log(k / kLo) / this._bins.lg * NB)))] += 2 * en;
      }
    });
    this._var0 = this._sum(0).v;
    this.shape = this.seaShape(99);

    // 三層的初始頻譜並排成一張（第 j 列 = 各層的第 j 列接在一起）
    const atlas = new Float32Array(NC * N * N * 4);
    this.cascades.forEach((c, ci) => {
      const d = c.h0.image.data;
      for (let j = 0; j < N; j++) atlas.set(d.subarray(j * N * 4, (j + 1) * N * 4), (j * NC * N + ci * N) * 4);
    });
    this.h0Atlas = new THREE.DataTexture(atlas, NC * N, N, THREE.RGBAFormat, THREE.FloatType);
    this.h0Atlas.minFilter = this.h0Atlas.magFilter = THREE.NearestFilter;
    this.h0Atlas.needsUpdate = true;

    const mat = (frag, uniforms) => new THREE.ShaderMaterial({
      vertexShader: quadVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false,
    });
    this.mSpec = mat(spectrumFrag, { uH0: { value: this.h0Atlas }, uN: { value: N }, uPatches: { value: new THREE.Vector3(...this.patches) }, uTime: { value: 0 }, uShape: { value: new THREE.Vector2(0, 1) } });
    this.mFft = mat(fftFrag, { uInput: { value: null }, uN: { value: N }, uSub: { value: 2 }, uHoriz: { value: true } });
    this.mDisp = mat(dispFrag, {
      uFft: { value: null }, uPrev: { value: null }, uN: { value: N }, uPatch: { value: 1 }, uOff: { value: 0 },
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
    this.rc = 1; this.rs = 0;   // 浪的方向比原本轉了多少（cos、sin）：風向變了，整片浪跟著轉
  }

  // 浪峰切在 kp（比它長的浪濾掉）時：整片海的變異數 v、各層的斜率變異數 s[]。x = kp² − kp0²
  _sum(x) {
    const B = this._bins, s = B.e.map(() => 0);
    let v = 0;
    for (let b = 0; b < B.NB; b++) {
      const f = Math.exp(-1.25 * x / B.k2[b]);
      for (let ci = 0; ci < s.length; ci++) { const en = B.e[ci][b] * f; v += en; s[ci] += en * B.k2[b]; }
    }
    return { v, s };
  }

  // 外海的示性波高 hs（公尺）時，海是什麼樣子：{ x, A, slopeVar }。
  // 每道浪乘上 A·exp(-0.625·x / k²)：x = kp² − kp0²（把比浪峰長的浪濾掉），A 把濾完的海補回原本的高度——
  // 所以不管哪一種海，位移圖的示性波高都是 this.hs，實際多高照舊由浪的強度（scale）去乘
  seaShape(hs) {
    const kp = TAU / peakLambda(hs), x = Math.max(0, kp * kp - KP0 * KP0), r = this._sum(x);
    const A = Math.sqrt(this._var0 / Math.max(r.v, 1e-12));
    return { x, A, slopeVar: r.s.map((v) => v * A * A) };
  }

  // 風向（浪向）比原本轉了幾弧度
  setTurn(a) { this.rc = Math.cos(a); this.rs = Math.sin(a); }

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
  // hsOpen：外海現在的示性波高（公尺）——決定浪峰多長（小浪短而碎、大浪又長又慢）
  update(t, dt, scale, foamScale = scale, hsOpen = 99) {
    this.scale = scale;
    this.foamScale = foamScale;
    const N = this.N;
    if (hsOpen !== this._hsOpen) { this._hsOpen = hsOpen; this.shape = this.seaShape(hsOpen); }
    if (this.lite) { this._pump(t); return; }
    this.mSpec.uniforms.uShape.value.set(this.shape.x, this.shape.A);
    // 頻譜與逆 FFT：三層並排一起算
    this.mSpec.uniforms.uTime.value = t % 2048;
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
    // 位移圖（含泡沫）與斜率圖：每層各自一張（要能重複鋪、要有縮小版）
    this.cascades.forEach((c, ci) => {
      const du = this.mDisp.uniforms;
      du.uFft.value = this.fft[src].texture;
      du.uOff.value = ci * N;
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
    this._pump(t);
  }

  // 船的浮力、游泳、鏡頭在不在水下……要知道浪高的地方，用的是背景執行緒（oceanWorker.js）用 CPU 算的同一片海：
  // 以前是從顯示晶片讀回來，但手機上的 Chrome 每讀一次 CPU 都要停下來等十幾毫秒（連只讀一個像素也一樣）。
  // 兩層各一個背景執行緒，各自每隔一小段時間（step）算一張「稍微未來」的海，主執行緒在前後兩張之間內插出現在的浪高。
  // 這兩層最短的浪也要一秒半以上才起伏一次，一秒算十來張就夠平順了——以前是一算完馬上再算，手機上兩顆核心整天滿載。
  // 開不了背景執行緒的瀏覽器才退回從顯示晶片讀
  _pump(t) {
    // 自己數的時間（不繞圈）：傳進來的時間跳了（對時、繞回 0 以外的跳動）就把手上的丟掉重來
    t %= 2048;
    let reset = false;
    if (this._clock === undefined) { this._clock = t; reset = true; }
    else {
      let d = t - this._last;
      if (d < -1024) d += 2048;
      if (d < -0.01 || d > 1.5) { this._clock = t; reset = true; } else this._clock += Math.max(d, 0);
    }
    this._last = t;
    const now = this._clock;
    if (this._workers === undefined) {
      this._workers = null;
      try {
        const M = this.M = 128, N = this.N;
        this._workers = [0, 1].map((ci) => {
          // 粗一半的格子：把有值的那幾十個頻率搬過去（其餘本來就是 0）
          const src = this.cascades[ci].h0.image.data, h0 = new Float32Array(M * M * 4);
          for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
            const m = i < M / 2 ? i : i - M, q = j < M / 2 ? j : j - M;
            if (m === -M / 2 || q === -M / 2) continue;
            const s = (((q + N) % N) * N + ((m + N) % N)) * 4, d = (j * M + i) * 4;
            h0[d] = src[s]; h0[d + 1] = src[s + 1]; h0[d + 2] = src[s + 2]; h0[d + 3] = src[s + 3];
          }
          const w = new Worker(new URL('./oceanWorker.js', import.meta.url), { type: 'module' });
          const st = { w, busy: false, cost: 0.05, sent: 0, id: 0, want: 0, snaps: [], spare: [], a: null, b: null, k: 1, step: [0.16, 0.08][ci], jobs: 0 };
          if (this.lite) {
            // 手機版：每張浪配一組貼圖（位移、斜率＋白浪）。四組輪流用
            const tex = () => {
              const t = new THREE.DataTexture(new Uint16Array(M * M * 4), M, M, THREE.RGBAFormat, THREE.HalfFloatType);
              t.wrapS = t.wrapT = THREE.RepeatWrapping;
              t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
              t.needsUpdate = true;
              return t;
            };
            st.pool = Array.from({ length: 4 }, () => ({ d: tex(), s: tex() }));
            st.spareH = [];
            st.ta = st.tb = st.pool[0];
          }
          w.postMessage({ init: { N: M, chop: this.chop, patch: [this.patches[ci]], h0: [h0], lite: this.lite ? { bias: [0.95, 0.93][ci], tau: [5.5, 2.2][ci] } : null } });
          w.onmessage = (e) => {
            st.busy = false; st.jobs++;
            st.cost = 0.8 * st.cost + 0.2 * (performance.now() - st.sent) / 1000;   // 算一張要多久（秒）
            if (e.data.half) st.spareH.push(e.data.half);
            if (e.data.id !== st.id) { st.spare.push(e.data.bufs[0]); return; }      // 重來之前送出去的：不要了
            const snap = { t: st.want, data: e.data.bufs[0], tex: null };
            if (e.data.half) {
              // 抄進這張浪專用的貼圖（16 位元的那份馬上可以還給背景執行緒再利用）
              snap.tex = st.pool.pop();
              snap.tex.d.image.data.set(e.data.half[0]); snap.tex.d.needsUpdate = true;
              snap.tex.s.image.data.set(e.data.half[1]); snap.tex.s.needsUpdate = true;
            }
            st.snaps.push(snap);
            while (st.snaps.length > 3) { const old = st.snaps.shift(); st.spare.push(old.data); if (old.tex) st.pool.unshift(old.tex); }
          };
          w.onerror = () => { this._workers = null; };
          return st;
        });
      } catch (err) { this._workers = null; }
    }
    if (!this._workers) return;
    for (const st of this._workers) {
      if (reset) { st.id++; for (const s of st.snaps) { st.spare.push(s.data); if (s.tex) st.pool.unshift(s.tex); } st.snaps.length = 0; st.a = st.b = null; }
      const last = st.snaps[st.snaps.length - 1];
      // 手上最新的那張快要用完了（扣掉算一張要花的時間）才請下一張
      if (!st.busy && (!last || now + st.cost * 1.6 + 0.05 >= last.t)) {
        st.busy = true; st.sent = performance.now();
        st.want = !last ? now : (last.t + st.step > now + st.cost ? last.t + st.step : now + st.cost * 1.3 + 0.03);
        const buf = st.spare.pop(), half = this.lite ? st.spareH.pop() : undefined;
        st.w.postMessage({ t: st.want % 2048, id: st.id, shape: [this.shape.x, this.shape.A], foam: this.foamScale, bufs: buf ? [buf] : undefined, half },
          [...(buf ? [buf.buffer] : []), ...(half ? [half[0].buffer, half[1].buffer] : [])]);
      }
      // 現在落在哪兩張之間
      const n = st.snaps.length;
      if (!n) { st.a = st.b = null; continue; }
      let i = 0;
      while (i < n - 1 && st.snaps[i + 1].t <= now) i++;
      const A = st.snaps[i], B = st.snaps[Math.min(i + 1, n - 1)];
      st.a = A.data; st.b = B.data;
      if (A.tex) { st.ta = A.tex; st.tb = B.tex; }
      st.k = B.t > A.t ? Math.min(1, Math.max(0, (now - A.t) / (B.t - A.t))) : 0;
    }
  }

  // 背景執行緒的結果有沒有到（兩層都要有）
  get _cpuReady() { return !!(this._workers && this._workers[0].b && this._workers[1].b); }

  // 背景執行緒算的那一層在 (x, z)（浪的座標）的位移，加進 out：full 時是 (Dx, h, Dz)，否則只加 h（out[1]）。
  // 格子比畫面用的粗，所以用三次內插（Catmull–Rom）：最短的浪一道只有三四格，直線內插會把浪頭削平
  _cpu(ci, x, z, out, full) {
    const st = this._workers[ci], M = this.M, mask = M - 1, patch = this.patches[ci], cell = patch / M;
    const u = (x - 0.5 * patch / this.N) / cell, v = (z - 0.5 * patch / this.N) / cell;   // 畫面上的貼圖是取格子中央，所以差半格（畫面那種格子的半格）
    const i0 = Math.floor(u), j0 = Math.floor(v), fx = u - i0, fz = v - j0;
    const wx = this._wx || (this._wx = [0, 0, 0, 0]), wz = this._wz || (this._wz = [0, 0, 0, 0]);
    let f2 = fx * fx, f3 = f2 * fx;
    wx[0] = -0.5 * f3 + f2 - 0.5 * fx; wx[1] = 1.5 * f3 - 2.5 * f2 + 1; wx[2] = -1.5 * f3 + 2 * f2 + 0.5 * fx; wx[3] = 0.5 * f3 - 0.5 * f2;
    f2 = fz * fz; f3 = f2 * fz;
    wz[0] = -0.5 * f3 + f2 - 0.5 * fz; wz[1] = 1.5 * f3 - 2.5 * f2 + 1; wz[2] = -1.5 * f3 + 2 * f2 + 0.5 * fz; wz[3] = 0.5 * f3 - 0.5 * f2;
    const a = st.a, b = st.b, k = st.k;
    let s0 = 0, s1 = 0, s2 = 0;
    for (let r = 0; r < 4; r++) {
      const row = ((j0 - 1 + r) & mask) * M;
      for (let c = 0; c < 4; c++) {
        const o = (row + ((i0 - 1 + c) & mask)) * 4, w = wz[r] * wx[c];
        s1 += w * (a[o + 1] + (b[o + 1] - a[o + 1]) * k);
        if (full) { s0 += w * (a[o] + (b[o] - a[o]) * k); s2 += w * (a[o + 2] + (b[o + 2] - a[o + 2]) * k); }
      }
    }
    out[0] += s0; out[1] += s1; out[2] += s2;
  }

  // 從顯示晶片讀一塊（背景執行緒還沒好、或開不了的時候才用）
  _get(ci, x, y, w, h, out) {
    const c = this.cascades[ci];
    this._read(c.disp[c.cur], x, y, w, h, out);
  }

  // 背景執行緒還沒有結果時的退路：一次讀回 (x, z) 周圍的浪高，之後用 sampleCached 取樣，避免每個取樣點都向 GPU 要資料
  cacheBlock(x, z) {
    if (!this.canRead || this._cpuReady) return;
    [x, z] = [x * this.rc + z * this.rs, z * this.rc - x * this.rs];
    const c = this.cascades[0], N = this.N, B = 8;
    const gx = ((x / c.patch) % 1 + 1) % 1 * N, gz = ((z / c.patch) % 1 + 1) % 1 * N;
    const bi = Math.min(N - B, Math.max(0, Math.floor(gx) - B / 2));
    const bj = Math.min(N - B, Math.max(0, Math.floor(gz) - B / 2));
    this.blockX0 = x - (gx - bi) * c.patch / N;
    this.blockZ0 = z - (gz - bj) * c.patch / N;
    if (!this.blockBuf) this.blockBuf = new Float32Array(B * B * 4);
    this._get(0, bi, bj, B, B, this.blockBuf);
    // 第二層（波長三到十幾公尺的中浪）也讀一塊：畫面上的海面是這兩層加起來的，船要跟著同一片水面浮沉，
    // 不然小一點的浪會直接穿過船身。這一層每 113 公尺重複一次，船常常跨在接縫上，所以要繞回另一頭去讀
    const c1 = this.cascades[1], B1 = this.B1 = 48, t1 = N / c1.patch;
    const g1x = ((x / c1.patch) % 1 + 1) % 1 * N, g1z = ((z / c1.patch) % 1 + 1) % 1 * N;
    const i1 = Math.floor(g1x) - B1 / 2, j1 = Math.floor(g1z) - B1 / 2;
    this.b1X0 = x - (g1x - i1) / t1; this.b1Z0 = z - (g1z - j1) / t1;
    if (!this.block1) { this.block1 = new Float32Array(B1 * B1 * 4); this._tmp1 = new Float32Array(B1 * B1 * 4); }
    const wi = ((i1 % N) + N) % N, wj = ((j1 % N) + N) % N, w0 = Math.min(B1, N - wi), h0 = Math.min(B1, N - wj);
    const part = (sx, sy, w, h, dx, dy) => {
      this._get(1, sx, sy, w, h, this._tmp1);
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
    const s = this.scale * k, d = this._dv || (this._dv = [0, 0, 0]);
    if (this._cpuReady) {
      const X = x * this.rc + z * this.rs, Z = z * this.rc - x * this.rs;   // 轉到浪的座標去找（高度不受旋轉影響）
      let px = X, pz = Z;
      for (let it = 0; it < 3; it++) {
        d[0] = d[1] = d[2] = 0;
        this._cpu(0, px, pz, d, true); this._cpu(1, px, pz, d, true);
        if (it < 2) { px = X - d[0] * s; pz = Z - d[2] * s; }
      }
      return d[1] * s;
    }
    if (!this.blockBuf || !this.block1) return this.sampleCached(x, z) * k;
    [x, z] = [x * this.rc + z * this.rs, z * this.rc - x * this.rs];
    let px = x, pz = z;
    for (let it = 0; it < 2; it++) { this._disp(px, pz, d); px = x - d[0] * s; pz = z - d[2] * s; }
    return this._disp(px, pz, d)[1] * s;
  }

  sampleCached(x, z) {
    if (this._cpuReady) return this.sampleHeight(x, z);
    if (!this.blockBuf) return 0;
    [x, z] = [x * this.rc + z * this.rs, z * this.rc - x * this.rs];
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
    if (this._cpuReady) {
      const d = this._dh || (this._dh = [0, 0, 0]);
      d[1] = 0;
      this._cpu(0, x * this.rc + z * this.rs, z * this.rc - x * this.rs, d, false);
      return d[1] * this.scale;
    }
    if (!this.canRead) return 0;
    [x, z] = [x * this.rc + z * this.rs, z * this.rc - x * this.rs];
    const c = this.cascades[0], N = this.N;
    const gx = ((x / c.patch) % 1 + 1) % 1 * N - 0.5, gz = ((z / c.patch) % 1 + 1) % 1 * N - 0.5;
    const i = Math.min(N - 2, Math.max(0, Math.floor(gx))), j = Math.min(N - 2, Math.max(0, Math.floor(gz)));
    const fx = Math.min(1, Math.max(0, gx - i)), fz = Math.min(1, Math.max(0, gz - j));
    this._get(0, i, j, 2, 2, this.readBuf);
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
