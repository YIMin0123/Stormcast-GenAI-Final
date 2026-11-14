// 游泳的人跟著畫面上的浪起伏：用海面的頂點程式本身（renderShaders.js 的 PROBE）算人腳下那一點畫出來的水面高度，
// 風浪、岸邊捲上來的浪、颱風長浪、巨浪、漩渦都算到，人和浪才對得上。
// 結果非同步讀回（不卡畫面，晚一兩幀才拿到），再照它上下的速度推算到現在這一刻。
import * as THREE from 'three';
import { waterVert, liteWaterVert, probeFrag } from './renderShaders.js';

const NEAR = 4;       // 量的那一點跟要問的位置差幾公尺以內，就直接用量到的
const FRESH = 1;      // 量到的結果多久以內算數（秒）：太短的話低幀率時會在新舊算法之間跳
const AHEAD = 0.15;   // 最多往前推算幾秒

// uniforms：海面共用的 uniform；defines()：海面材質現在的 defines（巨浪來時會換）；camera：隨便一台（點的位置寫死在畫面中央）
export function makeSurfaceProbe(renderer, { uniforms, defines, lite, floatRT, camera }) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  let defKey = '';
  const mat = new THREE.ShaderMaterial({ vertexShader: lite ? liteWaterVert : waterVert, fragmentShader: probeFrag, uniforms, depthTest: false, depthWrite: false });
  const pt = new THREE.Points(geo, mat);
  pt.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(pt);
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: floatRT ? THREE.FloatType : THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const buf = floatRT ? new Float32Array(4) : new Uint16Array(4);
  const read = (i) => (floatRT ? buf[i] : THREE.DataUtils.fromHalfFloat(buf[i]));
  let busy = false, dead = false;
  let ox = 0, oz = 0;   // 上一次量的那一點被浪往旁邊推了多少：下次先往回挪，量到的才是人正上方的水面
  const s = { ok: false, x: 0, z: 0, h: 0, v: 0, t: -1 };

  return {
    // 每幀叫一次：量 (x, z) 的水面（上一次還沒讀回來就先跳過）
    request(x, z) {
      if (busy || dead) return;
      const now = performance.now() / 1000;
      const d = defines(), key = JSON.stringify(d);
      if (key !== defKey) { defKey = key; mat.defines = { ...d, PROBE: 1 }; mat.needsUpdate = true; }
      const c = uniforms.uCenter.value, r = uniforms.uMeshRot.value;
      const wx = x - ox - c.x, wz = z - oz - c.y, a = geo.attributes.position.array;
      a[0] = wx * r.x + wz * r.y; a[1] = 0; a[2] = -wx * r.y + wz * r.x;   // 海面網格轉過的角度倒轉回去
      geo.attributes.position.needsUpdate = true;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(prev);
      busy = true;
      renderer.readRenderTargetPixelsAsync(rt, 0, 0, 1, 1, buf).then(() => {
        busy = false;
        const h = read(0), dx = read(1), dz = read(2);
        if (!Number.isFinite(h) || read(3) < 0.5) return;
        if (Math.hypot(x - s.x, z - s.z) < NEAR && now > s.t && now - s.t < FRESH) s.v = (h - s.h) / (now - s.t);
        else s.v = 0;
        Object.assign(s, { ok: true, x, z, h, t: now });
        ox = Math.max(-3, Math.min(3, dx)); oz = Math.max(-3, Math.min(3, dz));
      }).catch(() => { busy = false; dead = true; });   // 讀不回來（顯示晶片不支援）：改回舊的算法
    },
    state: () => ({ ...s, dead, busy }),   // 測試用
    // (x, z) 的水面高度；沒有夠新、夠近的結果就回傳 null
    at(x, z) {
      const now = performance.now() / 1000;
      if (!s.ok || now - s.t > FRESH || Math.abs(x - s.x) > NEAR || Math.abs(z - s.z) > NEAR) return null;
      return s.h + s.v * Math.min(Math.max(now - s.t, 0), AHEAD);
    },
  };
}
