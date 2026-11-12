// 飛沫粒子：CPU 模擬（重力、空氣阻力），以柔邊圓點畫出。
import * as THREE from 'three';

const vert = /* glsl */ `
attribute float aAlpha;
attribute float aSize;
uniform float uScale;
varying float vA;
void main() {
  vA = aAlpha;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
}
`;

const frag = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = vA * smoothstep(1.0, 0.15, dot(c, c) * 4.0);
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a * 0.6);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Spray {
  constructor(max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1e9);
    this.life = new Float32Array(max).fill(1);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.next = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 500 }, uColor: { value: new THREE.Color(0.95, 0.96, 0.97) } },
    });
    this.points = new THREE.Points(g, this.material);
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
      alpha[i] = t >= 1 ? 0 : Math.min(1, age[i] * 10) * (1 - t);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true; a.aAlpha.needsUpdate = true; a.aSize.needsUpdate = true;
  }
}
