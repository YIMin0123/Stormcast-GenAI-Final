// 飛沫、水花：CPU 模擬（重力、空氣阻力）。每一顆畫成一小滴半透明的水，飛得越快拉得越長（像相機快門拍到的那樣），
// 顏色跟著場景的光走：晚上是暗的，閃電、太陽照到才亮——不再是一顆顆發光的白點。
import * as THREE from 'three';

const WIDTH = 0.09;   // 水滴畫多粗 = emit 的 size × 這個（size 本來是舊的圓點直徑，水滴本身細得多）
const BLUR = 0.045;   // 拖影：拉出這麼多秒飛過的距離
const MIN_PX = 0.9;   // 遠處的水滴最細畫成這麼多像素（再細會一閃一閃），細不下去就改成變淡

const vert = /* glsl */ `
attribute vec2 corner;     // x：橫向 −1..1；y：0 尾巴、1 頭
attribute vec3 iPos;
attribute vec3 iVel;
attribute float iA;
attribute float iSize;
uniform float uScale;      // 距離 1 公尺時一公尺是幾個像素
uniform float uBlur;
varying vec2 vQ;           // 以半寬為單位：x 橫向、y 從尾巴的圓心往頭算
varying float vLen, vA;
void main() {
  if (iA <= 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 h = (viewMatrix * vec4(iPos, 1.0)).xyz;
  vec3 t = (viewMatrix * vec4(iPos - iVel * uBlur, 1.0)).xyz;
  float w = iSize * ${(WIDTH / 2).toFixed(3)};
  float dist = max(-h.z, 0.05);
  float wMin = ${MIN_PX.toFixed(2)} * 0.5 * dist / uScale;
  float a = iA;
  if (w < wMin) { a *= (w / wMin) * (w / wMin); w = wMin; }
  // 貼著鏡頭的不畫：不然一顆水滴會糊成整片畫面那麼大的白球
  a *= smoothstep(0.25, 0.9, dist);
  vec3 ax = h - t, mid = 0.5 * (h + t);
  float L = length(ax);
  vec3 along = L > 1e-5 ? ax / L : vec3(0.0, 1.0, 0.0);
  vec3 side = cross(along, normalize(mid));
  side = length(side) > 1e-4 ? normalize(side) : vec3(1.0, 0.0, 0.0);
  vec3 p = mix(t - along * w, h + along * w, corner.y) + side * w * corner.x;
  vLen = L / w;
  vQ = vec2(corner.x, corner.y * (vLen + 2.0) - 1.0);
  vA = a;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`;

const frag = /* glsl */ `
uniform vec3 uAmbient;
uniform vec3 uSunCol;
uniform float uGloom;
varying vec2 vQ;
varying float vLen, vA;
void main() {
  float y = clamp(vQ.y, 0.0, vLen);
  float r = length(vec2(vQ.x, vQ.y - y));
  float a = smoothstep(1.0, 0.55, r);
  if (a <= 0.0) discard;
  float k = vLen > 0.01 ? y / vLen : 1.0;   // 0 尾巴、1 頭
  // 拖得越長越淡（同一滴水攤在更長的一段上）；頭比尾巴實
  a *= vA * clamp(2.6 / (vLen + 2.6), 0.22, 1.0) * mix(0.35, 1.0, k);
  // 水是透明的：主要是映出天光，邊緣反光亮一點，正中間透過去
  // 晚上也留一點：跟雨絲一樣會反光（不然大雨夜裡完全看不到地上在濺水）
  vec3 light = max(0.62 * uAmbient + 0.38 * uSunCol * (1.0 - 0.8 * uGloom), vec3(0.20, 0.22, 0.26));
  vec3 col = mix(vec3(0.62, 0.70, 0.78), vec3(0.93, 0.95, 0.97), smoothstep(0.2, 0.9, r) * 0.6 + 0.4 * k) * light;
  gl_FragColor = vec4(col, a * 0.55);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Spray {
  // light：場景共用的 uniform（要有 uAmbient、uSunCol、uGloom），水滴才跟著天色、閃電變亮變暗
  constructor(max = 900, light = null) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1e9);
    this.life = new Float32Array(max).fill(1);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.next = 0;

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.Float32BufferAttribute([-1, 0, 1, 0, 1, 1, -1, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const inst = (arr, n) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', inst(this.pos, 3));
    g.setAttribute('iVel', inst(this.vel, 3));
    g.setAttribute('iA', inst(this.alpha, 1));
    g.setAttribute('iSize', inst(this.size, 1));
    g.instanceCount = max;
    const L = light || {};
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        uScale: { value: 500 }, uBlur: { value: BLUR },
        uAmbient: L.uAmbient || { value: new THREE.Vector3(1, 1, 1) },
        uSunCol: L.uSunCol || { value: new THREE.Vector3(1, 1, 1) },
        uGloom: L.uGloom || { value: 0 },
      },
    });
    this.points = new THREE.Mesh(g, this.material);   // 名字沿用舊的（以前是點）：外面用它來藏起來、加進場景
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  emit(x, y, z, vx, vy, vz, life, size) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.age[i] = 0; this.life[i] = life; this.size[i] = size;
  }

  update(dt) {
    const { pos, vel, age, life, alpha } = this;
    const drag = Math.exp(-0.9 * dt);
    for (let i = 0; i < this.max; i++) {
      if (age[i] >= life[i]) { alpha[i] = 0; continue; }
      age[i] += dt;
      const k = i * 3;
      vel[k + 1] -= 9.81 * dt;
      vel[k] *= drag; vel[k + 1] *= drag; vel[k + 2] *= drag;
      pos[k] += vel[k] * dt; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] += vel[k + 2] * dt;
      const t = age[i] / life[i];
      alpha[i] = t >= 1 ? 0 : Math.min(1, age[i] * 30) * (1 - t * t);
    }
    const a = this.points.geometry.attributes;
    a.iPos.needsUpdate = true; a.iVel.needsUpdate = true; a.iA.needsUpdate = true; a.iSize.needsUpdate = true;
  }
}
