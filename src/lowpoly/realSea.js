// 樣品間用的「遊戲裡的海」：直接用遊戲的 FFT 海浪（ocean.js）和海面著色器（renderShaders.js）；
// lite = 手機版的輕量海面（浪由背景執行緒算好當貼圖、卡通風著色器、不映倒影，見 renderShaders.js 的 liteWaterVert）。
// 海床、避浪、離岸距離這些資料改從港口島的高度算出來。只是拿來看低面的島配寫實的海好不好看，玩法（浮力、海嘯）不接。
import * as THREE from 'three';
import { waterVert, waterFrag, liteWaterVert, liteWaterFrag } from '../renderShaders.js';
import { FftOcean, makeFoamTexture } from '../ocean.js';
import { computeShelter, computeShoreDist, SEA_FLOOR, ISLANDS } from '../terrain.js';
import { computeDanger, computeOffshore, computeTsuK, seaOpen } from '../weather.js';

const L = 1024;     // 資料涵蓋的範圍（公尺），島在正中央；外面都當深海
const NF = 512;     // 海床 2 m 一格
const N = 256;      // 避浪、危險度 4 m 一格
const HS = 2.2;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 海面網格：以鏡頭注視點為中心的極座標網格，近處密、遠處疏，一路鋪到地平線（跟遊戲一樣）
function makePolarGeometry(nA = 384, nR = 420, r0 = 0.8, rMax = 34000) {
  const pos = new Float32Array((1 + nA * nR) * 3);
  for (let i = 0; i < nR; i++) {
    const r = r0 * Math.pow(rMax / r0, i / (nR - 1));
    for (let j = 0; j < nA; j++) {
      const a = (j / nA) * Math.PI * 2, k = (1 + i * nA + j) * 3;
      pos[k] = r * Math.cos(a); pos[k + 2] = r * Math.sin(a);
    }
  }
  const idx = new Uint32Array(nA * 3 + (nR - 1) * nA * 6);
  let t = 0;
  for (let j = 0; j < nA; j++) { idx[t++] = 0; idx[t++] = 1 + ((j + 1) % nA); idx[t++] = 1 + j; }
  for (let i = 0; i < nR - 1; i++) {
    for (let j = 0; j < nA; j++) {
      const a = 1 + i * nA + j, b = 1 + i * nA + ((j + 1) % nA), c = a + nA, d = b + nA;
      idx[t++] = a; idx[t++] = b; idx[t++] = c;
      idx[t++] = b; idx[t++] = d; idx[t++] = c;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

const tex = (data, n, format, type, linear) => {
  const t = new THREE.DataTexture(data, n, n, format, type);
  t.minFilter = t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
};

// 手機版海面的細碎波紋：可以無縫拼接的坡度圖（跟遊戲 main.js 的 makeRippleTexture 一樣）
function makeRippleTexture(size = 128) {
  let seed = 7331;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const waves = Array.from({ length: 26 }, () => {
    const kx = Math.round((rnd() - 0.5) * 22), kz = Math.round((rnd() - 0.5) * 22), k = Math.hypot(kx, kz) || 1;
    return { kx, kz, a: 1 / (2 + k), p: rnd() * Math.PI * 2 };
  });
  const sx = new Float32Array(size * size), sz = new Float32Array(size * size);
  let mx = 1e-6;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let x = 0, z = 0;
    for (const w of waves) { const c = w.a * Math.cos(2 * Math.PI * (w.kx * i + w.kz * j) / size + w.p); x += c * w.kx; z += c * w.kz; }
    sx[j * size + i] = x; sz[j * size + i] = z;
    mx = Math.max(mx, Math.abs(x), Math.abs(z));
  }
  const data = new Uint8Array(size * size * 4);
  for (let k = 0; k < size * size; k++) { data[k * 4] = Math.round((sx[k] / mx * 0.5 + 0.5) * 255); data[k * 4 + 1] = Math.round((sz[k] / mx * 0.5 + 0.5) * 255); data[k * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// heightAt：島的高度函式（陸地、水泥平台是正的，港池、近岸是 -3.2）。quays：岸壁的矩形（畫水線用，最多 3 個）
export function makeRealSea(renderer, { heightAt, quays = [], waveAngle = Math.PI / 2 + 0.35, fft16 = false, lite = false }) {
  // ---- 海床：島的高度；離陸地越遠越深（先找出每一格離陸地多遠）----
  const bed = new Float32Array(NF * NF);
  for (let j = 0; j < NF; j++) for (let i = 0; i < NF; i++) {
    bed[j * NF + i] = heightAt(((i + 0.5) / NF - 0.5) * L, ((j + 0.5) / NF - 0.5) * L);
  }
  const off = computeOffshore(bed, NF, L);
  for (let k = 0; k < NF * NF; k++) {
    if (bed[k] > 0) continue;
    const d = off[k];
    bed[k] = Math.max(SEA_FLOOR, Math.min(bed[k], -1.2 - 0.09 * d - 22 * smooth(30, 160, d)));
  }
  const coarse = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = 2 * j * NF + 2 * i;
    coarse[j * N + i] = (bed[k] + bed[k + 1] + bed[k + NF] + bed[k + NF + 1]) / 4;
  }
  const danger = computeDanger(coarse, N, L);
  const bedTex = tex(bed, NF, THREE.RedFormat, THREE.FloatType, false);
  const shelterTex = tex(computeShelter(coarse, N, L, waveAngle), N, THREE.RedFormat, THREE.UnsignedByteType, true);
  const dangerTex = tex(danger, N, THREE.RedFormat, THREE.UnsignedByteType, true);
  const tsuKTex = tex(computeTsuK(coarse, danger, N, L), N, THREE.RedFormat, THREE.UnsignedByteType, true);
  const shoreTex = tex(Uint16Array.from(computeShoreDist(bed, NF, L), (v) => THREE.DataUtils.toHalfFloat(v)), NF, THREE.RedFormat, THREE.HalfFloatType, true);

  const ocean = new FftOcean(renderer, { hs: HS, windAngle: waveAngle, fft16, lite });
  const bed16 = lite ? tex(Uint16Array.from(bed, (v) => THREE.DataUtils.toHalfFloat(v)), NF, THREE.RedFormat, THREE.HalfFloatType, true) : null;
  const V4 = (n, w = 0) => Array.from({ length: n }, () => new THREE.Vector4(0, 0, w, 0));
  const u = {
    uBed: { value: bedTex }, uShelter: { value: shelterTex }, uShore: { value: shoreTex }, uN: { value: NF }, uL: { value: L },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 }, uSwellT: { value: 0 },
    uCenter: { value: new THREE.Vector2() }, uMeshRot: { value: new THREE.Vector2(1, 0) }, uWaveScale: { value: 1 },
    uWakeBox: { value: new THREE.Vector4() }, uLampOn: { value: 0 }, uWaveRot: { value: new THREE.Vector2(1, 0) }, uTide: { value: 0 },
    uPixelAngle: { value: 0.001 }, uWake: { value: V4(16, -1e6) }, uRip: { value: V4(24, -1e6) }, uSwimmer: { value: V4(4) },
    uDisp0: { value: null }, uDisp1: { value: null },
    uSlope0: { value: ocean.cascades[0].slope.texture },
    uSlope1: { value: ocean.cascades[1].slope.texture },
    uSlope2: { value: ocean.cascades[2].slope.texture },
    uPatch: { value: new THREE.Vector3(...ocean.patches) }, uTexN: { value: ocean.N },
    uSlopeVar: { value: new THREE.Vector3(...ocean.cascades.map((c) => c.slopeVar)) },
    uFoamTex: { value: makeFoamTexture() }, uHs: { value: HS },
    uLD0A: { value: null }, uLD0B: { value: null }, uLD1A: { value: null }, uLD1B: { value: null },
    uLS0A: { value: null }, uLS0B: { value: null }, uLS1A: { value: null }, uLS1B: { value: null },
    uLK: { value: new THREE.Vector2() }, uLOff: { value: 0.5 / 128 - 0.5 / ocean.N }, uVortexOn: { value: 0 },
    uBed16: { value: bed16 }, uRipTex: { value: lite ? makeRippleTexture() : null },
    uWindT: { value: 0 }, uWindAmp: { value: 0.5 }, uWindDir: { value: new THREE.Vector2(Math.cos(waveAngle), Math.sin(waveAngle)) },
    uShoreW: { value: new THREE.Vector4(Math.cos(waveAngle), Math.sin(waveAngle), 0, 0) }, uShoreP: { value: 0 },
    uUnder: { value: 0 }, uCamDepth: { value: 0 },
    uReflTex: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 },
    uReflPass: { value: 0 }, uReflY: { value: 0 },
    uShTri: { value: Array.from({ length: 6 }, () => new THREE.Vector2(1e6, 1e6)) },
    uShHull: { value: new THREE.Vector4(1e6, 1e6, 1, 0) }, uShSize: { value: new THREE.Vector2(5, 1.3) },
    uQuay: { value: Array.from({ length: 3 }, (_, i) => (quays[i] ? new THREE.Vector4(...quays[i]) : new THREE.Vector4(1e6, 1e6, 1e6, 1e6))) },
    uHull: { value: Array.from({ length: 3 }, () => new THREE.Vector4(1e6, 1e6, 1, 0)) },
    uHullSize: { value: Array.from({ length: 3 }, () => new THREE.Vector3(1, 1, 0)) },
    uDanger: { value: dangerTex }, uTsuK: { value: tsuKTex }, uStorm: { value: 0 }, uTsu: { value: new THREE.Vector4(0, 1, 0, 0) }, uTsu2: { value: new THREE.Vector2() }, uGloom: { value: 0 },
    uSunCol: { value: new THREE.Vector3(1, 0.93, 0.8) }, uAmbient: { value: new THREE.Vector3(1, 1, 1) },
    uDay: { value: 1 }, uDusk: { value: 0 }, uFog: { value: 0 }, uHazeK: { value: 1 }, uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector3(0, 1, 0) }, uRain: { value: 0 }, uCloudMap: { value: null }, uPaint: { value: new THREE.Vector3(0, 1, 0) }, uCloudT: { value: new THREE.Vector2() }, uSwell: { value: 0 }, uSurge: { value: 0 },
    uVortex: { value: V4(3) },
    uLamp: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
    uBeam: { value: new THREE.Vector4(0, 0, 1, 0) }, uBeamOn: { value: 0 },
    uIsle: { value: ISLANDS.map(() => new THREE.Vector4(1e6, 1e6, 1, 0)) },
    uShadowMap: { value: null }, uShadowMat: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 }, uShadowTexel: { value: 1 / 2048 },
    uSwe: { value: null }, uSweWet: { value: null }, uSweOrigin: { value: new THREE.Vector2() }, uSweSize: { value: 1 }, uSweOn: { value: 0 },
    uHome: { value: new THREE.Vector4(1, 0, 0, 0) },   // 港座標 = 世界座標
  };

  const VS = lite ? liteWaterVert : waterVert;
  const water = new THREE.Mesh(lite ? makePolarGeometry(160, 150) : makePolarGeometry(), new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: lite ? liteWaterFrag : waterFrag, uniforms: u, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, side: THREE.DoubleSide,
  }));
  water.frustumCulled = false;
  water.renderOrder = 2;
  // 海面的記號（alpha = 3）：後製的角落暗影、光束靠它認出海面
  const flag = new THREE.Mesh(water.geometry, new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: 'void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 3.0); }', uniforms: u, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor,
    depthWrite: false, depthFunc: THREE.LessEqualDepth, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, side: THREE.DoubleSide,
  }));
  flag.frustumCulled = false;
  flag.renderOrder = 2.1;
  water.add(flag);

  // 有些手機（Adreno）連結不了完整版的海面程式：第一次畫完檢查，失敗就改用拆開的版本（跟遊戲一樣）
  let checked = false;
  function check() {
    if (checked || lite) return;
    const p = renderer.properties.get(water.material).currentProgram;
    if (!p) return;
    checked = true;
    const gl = renderer.getContext();
    if (!gl.getProgramParameter(p.program, gl.LINK_STATUS)) {
      console.warn('海面程式連結失敗，改用拆開的版本');
      for (const m of [water.material, flag.material]) { m.defines.WATER_SPLIT = 1; m.needsUpdate = true; }
    }
  }

  // 時段的光：跟遊戲 weather.js 的 light() 同一套算法，方向改用樣品間的太陽
  function setHour(hour, dir) {
    const a = ((hour - 6) / 12) * Math.PI, sy = Math.sin(a) * 0.78 / Math.hypot(Math.cos(a) * 0.8, Math.sin(a) * 0.78, 0.45);
    const day = smooth(-0.12, 0.2, sy), dusk = smooth(-0.1, 0.02, sy) * (1 - smooth(0.05, 0.42, sy));
    if (sy > -0.08) {
      const lvl = smooth(-0.08, 0.18, sy), w = smooth(0.05, 0.4, sy);
      u.uSunCol.value.set(lvl, lvl * (0.55 + 0.38 * w), lvl * (0.3 + 0.5 * w));
    } else {
      const lvl = 0.13 * 0.8;
      u.uSunCol.value.set(lvl * 0.6, lvl * 0.74, lvl);
    }
    const amb = [0.05, 0.065, 0.11].map((n) => n + (1 - n) * day);
    amb[1] *= 1 - 0.18 * dusk; amb[2] *= 1 - 0.3 * dusk;
    u.uAmbient.value.set(...amb);
    u.uDay.value = day; u.uDusk.value = dusk;
    u.uSunDir.value.copy(dir);
    if (u.uSunDir.value.y < 0.06) { u.uSunDir.value.y = 0.06; u.uSunDir.value.normalize(); }
  }

  let time = 0;
  function update(dt, target, camera, sun) {
    time += dt;
    u.uTime.value = u.uSwellT.value = time;
    u.uWindT.value = time;
    // 白浪照外海的浪去累積；外海的示性波高決定今天是哪一種浪（跟遊戲 main.js 的 updateOcean 一樣）
    const openLv = seaOpen(u.uWaveScale.value, 0);
    ocean.update(time, dt, u.uWaveScale.value, openLv, Math.round(HS * openLv * 50) / 50);
    u.uSlopeVar.value.set(...ocean.shape.slopeVar);
    u.uDisp0.value = ocean.cascades[0].disp[ocean.cascades[0].cur].texture;
    u.uDisp1.value = ocean.cascades[1].disp[ocean.cascades[1].cur].texture;
    if (lite && ocean._workers) {
      const [w0, w1] = ocean._workers;
      if (w0.ta && w1.ta) {
        u.uLD0A.value = w0.ta.d; u.uLD0B.value = w0.tb.d; u.uLS0A.value = w0.ta.s; u.uLS0B.value = w0.tb.s;
        u.uLD1A.value = w1.ta.d; u.uLD1B.value = w1.tb.d; u.uLS1A.value = w1.ta.s; u.uLS1B.value = w1.tb.s;
        u.uLK.value.set(w0.k, w1.k);
      }
    }
    u.uCenter.value.set(target.x, target.z);
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    u.uPixelAngle.value = THREE.MathUtils.degToRad(camera.fov) / db.y;
    if (sun && sun.castShadow && sun.shadow.map) {
      u.uShadowMap.value = sun.shadow.map.depthTexture;
      u.uShadowMat.value = sun.shadow.matrix;
      u.uShadowTexel.value = 1 / sun.shadow.mapSize.x;
      u.uShadowOn.value = 1;
    } else { u.uShadowMap.value = null; u.uShadowOn.value = 0; }
  }

  // ---- 海面倒影（電腦才開）：鏡像相機把水面以上的東西畫到一半解析度的貼圖，隔一幀才重畫（跟遊戲一樣）----
  const reflRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
  u.uReflTex.value = reflRT.texture;
  const vcam = new THREE.PerspectiveCamera(), UP = new THREE.Vector3(0, 1, 0);
  const _rp = new THREE.Vector3(), _cw = new THREE.Vector3(), _vp = new THREE.Vector3(), _look = new THREE.Vector3(), _tg = new THREE.Vector3();
  const _rot = new THREE.Matrix4(), _cc = new THREE.Color(), _db = new THREE.Vector2();
  const clipOn = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)], clipOff = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e7)];
  const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  let tick = 0;
  // 裁切平面的數量兩趟要一樣，材質才不會每幀換程式：開倒影的時候平常也留一個切不到東西的
  function reflect(on, scene, camera, hide = []) {
    if (lite) on = false;   // 手機版的海面不映倒影
    renderer.clippingPlanes = on ? clipOff : [];
    if (!on || camera.position.y < 0.3) { u.uReflOn.value = 0; tick = 0; return; }
    if (tick++ & 1 && tick > 2) return;
    renderer.getDrawingBufferSize(_db);
    const w = Math.max(2, Math.floor(_db.x / 2)), h = Math.max(2, Math.floor(_db.y / 2));
    if (reflRT.width !== w || reflRT.height !== h) reflRT.setSize(w, h);
    u.uReflOn.value = 1;
    camera.updateMatrixWorld();
    _rp.set(0, 0, 0);
    _cw.setFromMatrixPosition(camera.matrixWorld);
    _rot.extractRotation(camera.matrixWorld);
    _vp.subVectors(_rp, _cw).reflect(UP).negate().add(_rp);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_cw);
    _tg.subVectors(_rp, _look).reflect(UP).negate().add(_rp);
    vcam.position.copy(_vp);
    vcam.up.set(0, 1, 0).applyMatrix4(_rot).reflect(UP);
    vcam.lookAt(_tg);
    vcam.near = camera.near; vcam.far = camera.far;
    vcam.updateMatrixWorld();
    vcam.projectionMatrix.copy(camera.projectionMatrix);
    { const n = camera.near, f = 450, e = vcam.projectionMatrix.elements; e[10] = -(f + n) / (f - n); e[14] = (-2 * f * n) / (f - n); }
    vcam.projectionMatrixInverse.copy(vcam.projectionMatrix).invert();
    u.uReflMat.value.copy(BIAS).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
    const vis = hide.map((o) => o.visible);
    water.visible = false; hide.forEach((o) => { o.visible = false; });
    const auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;   // 陰影貼圖這一趟不重畫
    u.uReflPass.value = 1;
    renderer.clippingPlanes = clipOn;
    const ca = renderer.getClearAlpha();
    renderer.getClearColor(_cc);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(reflRT);
    renderer.clear();
    renderer.render(scene, vcam);
    renderer.setRenderTarget(null);
    renderer.setClearColor(_cc, ca);
    renderer.clippingPlanes = clipOff;
    u.uReflPass.value = 0;
    renderer.shadowMap.autoUpdate = auto;
    water.visible = true; hide.forEach((o, i) => { o.visible = vis[i]; });
  }

  return { water, uniforms: u, update, setHour, check, reflect, ocean, lite };
}
