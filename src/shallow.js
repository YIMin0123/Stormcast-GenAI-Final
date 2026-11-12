// 岸邊的淺水模擬：在鏡頭附近一小塊範圍裡，用 GPU 解淺水方程式。
// 外海的浪（FFT）從深水那一側餵進來，進到淺灘後自己變陡、破碎、沖上沙灘、再退回去，也會繞過礁石與木樁。
// 深水處不模擬（那裡照舊用 FFT），所以只有水深 5 公尺以內的地方由這裡接手。
//
// 網格是交錯式的：每格存水深 h（格子中心）、u（右側格線上的流速）、w（下側格線上的流速）、泡沫。
// 每一步兩個 pass：先更新流速（半拉格朗日平流 + 水面坡度的加速度），再用新流速更新水深（迎風格式）。
import * as THREE from 'three';
import { shoreWaves } from './renderShaders.js';

const quadVert = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const SWE = {
  cap: 6.0,          // 模擬用的海床最深只到這裡（更深的地方反正交給 FFT）
  force: [3.0, 5.0], // 水深在這個範圍內，由「完全自己算」過渡到「跟著 FFT 走」
  maxObst: 48,
};

const common = /* glsl */ `
precision highp float;
uniform sampler2D uState;   // (水深 h, 流速 u, 流速 w, 泡沫)
uniform sampler2D uBedS;    // (模擬用海床高度, 真實水深, 障礙物權重, 0)
uniform int uSize;
uniform float uDx;
uniform float uDt;

vec4 S(ivec2 p) { return texelFetch(uState, clamp(p, ivec2(0), ivec2(uSize - 1)), 0); }
vec4 B(ivec2 p) { return texelFetch(uBedS, clamp(p, ivec2(0), ivec2(uSize - 1)), 0); }
// 以「索引座標」雙線性取某個分量
float bil(int ch, vec2 ic) {
  vec2 f = floor(ic), t = ic - f;
  ivec2 q = ivec2(f);
  return mix(mix(S(q)[ch], S(q + ivec2(1, 0))[ch], t.x), mix(S(q + ivec2(0, 1))[ch], S(q + ivec2(1, 1))[ch], t.x), t.y);
}
`;

// 海床：地形高度加上障礙物（木樁、礁石），只在視窗移動時重算
const bedFrag = /* glsl */ `
precision highp float;
uniform sampler2D uBed;
uniform int uN;
uniform float uL;
uniform vec2 uOrigin;
uniform float uDx;
uniform vec4 uObst[${SWE.maxObst}];   // (x, z, 半徑, 0)
uniform int uObstN;

float bedAt(vec2 xz) {
  float n = float(uN);
  vec2 g = clamp((xz / uL + 0.5) * n - 0.5, vec2(0.0), vec2(n - 1.001));
  ivec2 p = ivec2(floor(g));
  vec2 f = g - vec2(p);
  ivec2 q = min(p + 1, ivec2(uN - 1));
  return mix(mix(texelFetch(uBed, p, 0).r, texelFetch(uBed, ivec2(q.x, p.y), 0).r, f.x),
             mix(texelFetch(uBed, ivec2(p.x, q.y), 0).r, texelFetch(uBed, q, 0).r, f.x), f.y);
}

void main() {
  vec2 xz = uOrigin + gl_FragCoord.xy * uDx;
  float b = bedAt(xz);
  float obst = 0.0, wall = 0.0;
  for (int i = 0; i < ${SWE.maxObst}; i++) {
    if (i >= uObstN) break;
    float d = length(xz - uObst[i].xy), r = max(uObst[i].z, 0.3);
    wall = max(wall, step(d, r));
    obst = max(obst, smoothstep(r + 1.3, r + 0.1, d));
  }
  // 障礙物所在的格子當成突出水面的陸地，水會繞過去
  gl_FragColor = vec4(mix(max(b, -${SWE.cap.toFixed(1)}), max(b, 0.0) + 1.5, wall), -b, obst * (1.0 - wall), wall);
}
`;

// 視窗移動：把舊的狀態搬到新位置，新露出來的格子從靜止的水面開始
const shiftFrag = /* glsl */ `
${common}
uniform ivec2 uShift;   // 新視窗的原點相對於舊視窗移動了幾格
uniform float uWet;     // 1 = 這張是「濕沙」貼圖

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), q = p + uShift;
  float b = B(p).r;
  if (q.x < 0 || q.y < 0 || q.x >= uSize || q.y >= uSize) {
    gl_FragColor = uWet > 0.5 ? vec4(smoothstep(0.3, 0.05, b), 0.0, 0.0, 0.0) : vec4(max(-b, 0.0), 0.0, 0.0, 0.0);
  } else {
    gl_FragColor = texelFetch(uState, q, 0);
  }
}
`;

// 第一個 pass：流速
const velFrag = /* glsl */ `
${common}
uniform vec2 uOrigin;
uniform vec4 uPoke[4];   // 游泳的人：(x, z, 速度 x, 速度 z)
uniform int uPokeN;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 pc = vec2(p);
  vec4 s = S(p), sx = S(p + ivec2(1, 0)), sz = S(p + ivec2(0, 1));
  vec4 bd = B(p);
  float b = bd.r, bx = B(p + ivec2(1, 0)).r, bz = B(p + ivec2(0, 1)).r;
  float eta = b + s.r, etax = bx + sx.r, etaz = bz + sz.r;
  float k = uDt / uDx;

  // ---- 平流：沿著水流往回找，這裡的水是從哪裡流過來的 ----
  // u 存在 (i+1, j+0.5)，w 存在 (i+0.5, j+1)
  float wAtU = 0.25 * (s.b + sx.b + S(p + ivec2(0, -1)).b + S(p + ivec2(1, -1)).b);
  vec2 xu = pc + vec2(1.0, 0.5) - k * vec2(s.g, wAtU);
  float u = bil(1, xu - vec2(1.0, 0.5));
  float uAtW = 0.25 * (s.g + sz.g + S(p + ivec2(-1, 0)).g + S(p + ivec2(-1, 1)).g);
  vec2 xw = pc + vec2(0.5, 1.0) - k * vec2(uAtW, s.b);
  float w = bil(2, xw - vec2(0.5, 1.0));

  // ---- 游泳的人推著水走：身體附近的水被帶著往人前進的方向流（前面推起一道水、後面拉出一個凹）----
  for (int i = 0; i < 4; i++) {
    if (i >= uPokeN) break;
    vec4 pk = uPoke[i];
    vec2 du = uOrigin + (pc + vec2(1.0, 0.5)) * uDx - pk.xy, dw = uOrigin + (pc + vec2(0.5, 1.0)) * uDx - pk.xy;
    u += (pk.z - u) * 0.12 * exp(-dot(du, du) / 0.2);
    w += (pk.w - w) * 0.12 * exp(-dot(dw, dw) / 0.2);
  }

  // ---- 水面坡度推著水走 ----
  u -= 9.81 * k * (etax - eta);
  w -= 9.81 * k * (etaz - eta);

  // 乾的格子比隔壁的水面還高：水流不過去
  if ((s.r < 0.002 && b > etax) || (sx.r < 0.002 && bx > eta)) u = 0.0;
  if ((s.r < 0.002 && b > etaz) || (sz.r < 0.002 && bz > eta)) w = 0.0;

  // 底部摩擦：水越薄阻力越大，沖上沙灘的薄水才會慢下來、停住、再流回去
  float hu = max(0.5 * (s.r + sx.r), 0.015), hw = max(0.5 * (s.r + sz.r), 0.015);
  u /= 1.0 + uDt * 0.011 * abs(u) / pow(hu, 1.333);
  w /= 1.0 + uDt * 0.011 * abs(w) / pow(hw, 1.333);

  // 深水區跟著 FFT 走，流速不要自己越滾越大
  float wf = smoothstep(${SWE.force[0].toFixed(1)}, ${SWE.force[1].toFixed(1)}, bd.g);
  float damp = 1.0 - uDt * 0.6 * wf;
  // 流速上限：保證一步之內流出去的水不會比格子裡有的還多
  float lim = 0.24 * uDx / uDt;
  u = clamp(u * damp, -lim, lim);
  w = clamp(w * damp, -lim, lim);

  // ---- 泡沫跟著水流漂 ----
  vec2 vc = 0.5 * vec2(s.g + S(p + ivec2(-1, 0)).g, s.b + S(p + ivec2(0, -1)).b);
  float foam = bil(3, pc - k * vc);

  gl_FragColor = vec4(s.r, u, w, foam);
}
`;

// 第二個 pass：水深、外海的浪、泡沫的生成與消散
const heightFrag = /* glsl */ `
${common}
uniform sampler2D uPrev;     // 這一步開始前的狀態（算水面升降的速度用）
uniform sampler2D uDisp0;    // FFT 最大那一層的位移
uniform sampler2D uShelter;
uniform sampler2D uDanger;
uniform vec2 uOrigin;
uniform float uL;
uniform float uPatch0;
uniform float uWaveScale;
uniform float uStorm;
uniform float uSurge;
uniform sampler2D uShore;    // 離岸距離
uniform float uTime;
uniform vec4 uPoke[4];
uniform int uPokeN;
${shoreWaves}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = S(p), l = S(p + ivec2(-1, 0)), d = S(p + ivec2(0, -1)), r = S(p + ivec2(1, 0)), t = S(p + ivec2(0, 1));
  vec4 bd = B(p);
  float b = bd.r;
  float uR = c.g, uL_ = l.g, wT = c.b, wD = d.b;
  // 迎風：水從哪一格流出來，就用那一格的水深
  float fR = (uR > 0.0 ? c.r : r.r) * uR, fL = (uL_ > 0.0 ? l.r : c.r) * uL_;
  float fT = (wT > 0.0 ? c.r : t.r) * wT, fD = (wD > 0.0 ? d.r : c.r) * wD;
  float h = max(c.r - uDt / uDx * (fR - fL + fT - fD), 0.0);

  // ---- 外海的浪從深水這一側餵進來 ----
  vec2 xz = uOrigin + gl_FragCoord.xy * uDx;
  vec2 uv = clamp(xz / uL + 0.5, 0.0, 1.0);
  float danger = textureLod(uDanger, uv, 0.0).r;
  float ws = min(uWaveScale * (1.0 + uStorm * mix(danger, 1.0, uSurge)), 3.4);
  float shel = textureLod(uShelter, uv, 0.0).r;
  float K = smoothstep(0.3, 8.0, bd.g) * ws * shel;
  // 餵進來的浪 = 風浪 + 朝著岸捲過來的那一道道浪（後者讓每一面海岸的浪都是往岸上打，不是順著風向飄）
  float sdS = textureLod(uShore, uv, 0.0).r, pre;
  float swl = sdS < 66.0 ? swell(sdS, shorePhase(xz, uTime), xz, shoreExpo(shel, SHORE_SEA), pre).x : 0.0;
  float target = max(textureLod(uDisp0, xz / uPatch0, 0.0).y * K * 0.85 + swl - b, 0.0);
  float wf = smoothstep(${SWE.force[0].toFixed(1)}, ${SWE.force[1].toFixed(1)}, bd.g);
  h += (target - h) * (1.0 - exp(-uDt * 3.5 * wf));

  // 游泳的人身體一上一下（踩水、划水），把水一下壓下去一下讓開，推出一圈一圈往外傳的波
  for (int i = 0; i < 4; i++) {
    if (i >= uPokeN) break;
    vec2 dp = xz - uPoke[i].xy;
    if (h > 0.05) h += uDt * 0.22 * cos(uTime * 4.6 + float(i)) * exp(-dot(dp, dp) / 0.18);
  }

  // 沙灘會吸水：留在岸上的薄水慢慢滲掉，不會積成永遠不乾的水窪
  if (b > 0.03) h = max(h - uDt * 0.004, 0.0);
  if (bd.a > 0.5) h = 0.0;

  // ---- 泡沫 ----
  float div = (uR - uL_ + wT - wD) / uDx;                 // 負值 = 水往這裡擠 = 浪頭正在破
  vec2 vc = 0.5 * vec2(uR + uL_, wT + wD);
  float speed = length(vc);
  float rise = abs(h - texelFetch(uPrev, p, 0).r) / uDt;  // 水面升降的速度
  float src = 1.1 * max(-div - 0.7, 0.0) * (1.0 - wf)
            + 0.45 * smoothstep(1.5, 3.2, speed) * smoothstep(0.5, 0.05, h) * step(0.004, h)   // 薄水衝得快也會起泡
            + bd.b * (1.6 * smoothstep(0.25, 1.5, speed) + 2.5 * smoothstep(0.15, 0.8, rise));  // 浪打在木樁、礁石上
  float foam = c.a * exp(-uDt / mix(2.6, 1.2, wf)) + uDt * src;
  if (h < 0.004) foam *= exp(-uDt / 0.7);

  gl_FragColor = vec4(h, c.g, c.b, clamp(foam, 0.0, 1.4));
}
`;

// 給畫面用的貼圖：(水深, 水面坡度 x, 水面坡度 z, 泡沫)。障礙物所在的格子用旁邊的水補起來，木樁周圍的水面才不會破洞
const outFrag = /* glsl */ `
${common}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = S(p);
  vec4 bd = B(p);
  float h = c.r, foam = c.a;
  float eta = bd.r + h;
  if (bd.a > 0.5) {
    float sum = 0.0, n = 0.0, f = 0.0, e = 0.0;
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        ivec2 q = p + ivec2(i, j);
        vec4 bq = B(q);
        if (bq.a > 0.5) continue;
        vec4 sq = S(q);
        // 木樁底下實際的水深 = 旁邊的水面高度 − 這裡真正的海床
        sum += max(bq.r + sq.r + bd.g, 0.0) * step(0.002, sq.r); f += sq.a; e += bq.r + sq.r; n += 1.0;
      }
    }
    if (n > 0.0) { h = sum / n; foam = f / n; eta = e / n; }
    gl_FragColor = vec4(h, 0.0, 0.0, foam);
    return;
  }
  // 坡度只在濕的格子之間算，免得乾濕交界冒出一道假的陡坡
  vec4 l = S(p + ivec2(-1, 0)), r = S(p + ivec2(1, 0)), d = S(p + ivec2(0, -1)), t = S(p + ivec2(0, 1));
  vec4 bl = B(p + ivec2(-1, 0)), br = B(p + ivec2(1, 0)), bdn = B(p + ivec2(0, -1)), bt = B(p + ivec2(0, 1));
  float eL = l.r > 0.002 && bl.a < 0.5 ? bl.r + l.r : eta, eR = r.r > 0.002 && br.a < 0.5 ? br.r + r.r : eta;
  float eD = d.r > 0.002 && bdn.a < 0.5 ? bdn.r + d.r : eta, eT = t.r > 0.002 && bt.a < 0.5 ? bt.r + t.r : eta;
  vec2 sl = h > 0.002 ? vec2(eR - eL, eT - eD) / (2.0 * uDx) : vec2(0.0);
  gl_FragColor = vec4(h, clamp(sl, -1.5, 1.5), foam);
}
`;

// 濕沙：被水漫過就是濕的，之後慢慢變乾
const wetFrag = /* glsl */ `
${common}
uniform sampler2D uWetPrev;
uniform float uFrameDt;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float prev = texelFetch(uWetPrev, p, 0).r;
  float now = smoothstep(0.003, 0.015, S(p).r);
  gl_FragColor = vec4(max(prev * exp(-uFrameDt / 28.0), now), 0.0, 0.0, 0.0);
}
`;

export class ShallowWater {
  // opts：n（格數）、cell（一格幾公尺）
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.n = opts.n ?? 384;
    this.cell = opts.cell ?? 0.4;
    this.size = this.n * this.cell;
    this.block = 8;                    // 視窗一次移動幾格（免得每幀都在搬）
    this.step = 1 / 60;
    this.acc = 0;
    this.on = false;
    this.origin = new THREE.Vector2(1e9, 1e9);   // 視窗左上角（世界座標）
    this.obstacles = [];               // 所有障礙物 { x, z, r }

    const linear = renderer.extensions.has('OES_texture_float_linear');
    const n = this.n;
    const target = (type, filter) => new THREE.WebGLRenderTarget(n, n, {
      type, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: filter, magFilter: filter, generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    this.state = [target(THREE.FloatType, THREE.NearestFilter), target(THREE.FloatType, THREE.NearestFilter), target(THREE.FloatType, THREE.NearestFilter)];
    this.cur = 0;
    this.bed = target(THREE.FloatType, THREE.NearestFilter);
    // 畫面要用內插的：不支援浮點數線性過濾的顯示卡改用半精度
    this.out = target(linear ? THREE.FloatType : THREE.HalfFloatType, THREE.LinearFilter);
    this.wet = [target(THREE.HalfFloatType, THREE.LinearFilter), target(THREE.HalfFloatType, THREE.LinearFilter)];
    this.wetCur = 0;

    const base = () => ({ uState: { value: null }, uBedS: { value: this.bed.texture }, uSize: { value: n }, uDx: { value: this.cell }, uDt: { value: this.step } });
    const mat = (frag, uniforms) => new THREE.ShaderMaterial({
      vertexShader: quadVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false,
    });
    this.mBed = mat(bedFrag, {
      uBed: { value: null }, uN: { value: 1 }, uL: { value: 1 }, uOrigin: { value: new THREE.Vector2() }, uDx: { value: this.cell },
      uObst: { value: Array.from({ length: SWE.maxObst }, () => new THREE.Vector4()) }, uObstN: { value: 0 },
    });
    this.mShift = mat(shiftFrag, { ...base(), uShift: { value: new THREE.Vector2() }, uWet: { value: 0 } });
    this.pokes = [];                   // 游泳的人 { x, z, vx, vz }（swimfx.js 每幀填）
    const pokeU = { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }, pokeN = { value: 0 };
    this.pokeU = pokeU; this.pokeN = pokeN;
    this.mVel = mat(velFrag, { ...base(), uOrigin: { value: new THREE.Vector2() }, uPoke: pokeU, uPokeN: pokeN });
    this.mHeight = mat(heightFrag, {
      ...base(), uPrev: { value: null }, uDisp0: { value: null }, uShelter: { value: null }, uDanger: { value: null },
      uOrigin: { value: new THREE.Vector2() }, uL: { value: 1 }, uPatch0: { value: 1 },
      uWaveScale: { value: 1 }, uStorm: { value: 0 }, uSurge: { value: 0 },
      uShore: { value: null }, uTime: { value: 0 }, uPoke: pokeU, uPokeN: pokeN,
    });
    this.mOut = mat(outFrag, base());
    this.mWet = mat(wetFrag, { ...base(), uWetPrev: { value: null }, uFrameDt: { value: 0 } });

    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  get texture() { return this.out.texture; }
  get wetTexture() { return this.wet[this.wetCur].texture; }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  // 把視窗移到 (x, z) 附近；fresh = 整個重來
  _moveTo(ox, oz, env, fresh) {
    const shiftX = fresh ? 1e6 : Math.round((ox - this.origin.x) / this.cell);
    const shiftZ = fresh ? 1e6 : Math.round((oz - this.origin.y) / this.cell);
    this.origin.set(ox, oz);

    // 這個視窗裡有哪些障礙物（最多 maxObst 個，離中心近的優先）
    const cx = ox + this.size / 2, cz = oz + this.size / 2, half = this.size / 2 + 2;
    const near = this.obstacles.filter((o) => Math.abs(o.x - cx) < half && Math.abs(o.z - cz) < half);
    if (near.length > SWE.maxObst) {
      near.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
      near.length = SWE.maxObst;
    }
    const bu = this.mBed.uniforms;
    near.forEach((o, i) => bu.uObst.value[i].set(o.x, o.z, o.r, 0));
    bu.uObstN.value = near.length;
    bu.uBed.value = env.bedTex; bu.uN.value = env.bedN; bu.uL.value = env.L;
    bu.uOrigin.value.copy(this.origin);
    this._pass(this.mBed, this.bed);

    const su = this.mShift.uniforms;
    su.uShift.value.set(shiftX, shiftZ);
    su.uState.value = this.state[this.cur].texture; su.uWet.value = 0;
    this.cur = (this.cur + 1) % 3;
    this._pass(this.mShift, this.state[this.cur]);
    su.uState.value = this.wet[this.wetCur].texture; su.uWet.value = 1;
    this.wetCur = 1 - this.wetCur;
    this._pass(this.mShift, this.wet[this.wetCur]);
  }

  // dt：這一幀過了多久；center：鏡頭注視點；active：附近有沒有淺水（沒有就整個不算）
  // env：{ bedTex, bedN, L, shelterTex, dangerTex, disp0, patch0, waveScale, storm, surge }
  update(dt, center, active, env) {
    if (!active) { this.on = false; return; }
    const snap = this.block * this.cell;
    const ox = Math.round((center.x - this.size / 2) / snap) * snap, oz = Math.round((center.z - this.size / 2) / snap) * snap;
    const fresh = !this.on || Math.abs(ox - this.origin.x) > this.size || Math.abs(oz - this.origin.y) > this.size;
    if (fresh || ox !== this.origin.x || oz !== this.origin.y) this._moveTo(ox, oz, env, fresh);
    this.on = true;

    this.pokeN.value = Math.min(4, this.pokes.length);
    this.pokes.slice(0, 4).forEach((p, i) => this.pokeU.value[i].set(p.x, p.z, p.vx, p.vz));
    this.mVel.uniforms.uOrigin.value.copy(this.origin);
    const hu = this.mHeight.uniforms;
    hu.uDisp0.value = env.disp0; hu.uShelter.value = env.shelterTex; hu.uDanger.value = env.dangerTex;
    hu.uOrigin.value.copy(this.origin); hu.uL.value = env.L; hu.uPatch0.value = env.patch0;
    hu.uShore.value = env.shoreTex; hu.uTime.value = env.time;
    hu.uWaveScale.value = env.waveScale; hu.uStorm.value = env.storm; hu.uSurge.value = env.surge;

    // 固定步長；剛開始（或跳到新地方）多跑幾步讓水面先動起來
    this.acc = Math.min(this.acc + dt, this.step * 3);
    let steps = Math.floor(this.acc / this.step);
    this.acc -= steps * this.step;
    if (fresh) steps = Math.max(steps, 3);
    for (let i = 0; i < steps; i++) {
      const a = this.state[this.cur], b = this.state[(this.cur + 1) % 3], c = this.state[(this.cur + 2) % 3];
      this.mVel.uniforms.uState.value = a.texture;
      this._pass(this.mVel, b);
      hu.uState.value = b.texture; hu.uPrev.value = a.texture;
      this._pass(this.mHeight, c);
      this.cur = (this.cur + 2) % 3;
    }
    if (steps > 0) {
      this.mOut.uniforms.uState.value = this.state[this.cur].texture;
      this._pass(this.mOut, this.out);
    }
    const wu = this.mWet.uniforms;
    wu.uState.value = this.state[this.cur].texture; wu.uWetPrev.value = this.wet[this.wetCur].texture; wu.uFrameDt.value = dt;
    this.wetCur = 1 - this.wetCur;
    this._pass(this.mWet, this.wet[this.wetCur]);
    this.renderer.setRenderTarget(null);
  }
}
