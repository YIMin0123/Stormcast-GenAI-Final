// 後製的光效：太陽（月亮）從雲邊、樹縫射出來的光束。
// 光暈（亮的地方往外暈開）用 three.js 內建的 UnrealBloomPass，在 main.js 裡接上。
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// 做法：先挑出「太陽附近、夠亮、而且是天空」的像素當光源（畫面的 alpha：天空是 0，樹、山、船、房子是 1），
// 再從每個像素往太陽的方向一路取樣、取平均。被樹或雲擋住的方向取到的是黑的，沒擋住的方向取到亮的，
// 結果就是一道一道從太陽散開的光。全部在四分之一解析度做，最後疊回畫面上
export class SunRaysPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.sun = new THREE.Vector2(0.5, 0.5);   // 太陽在畫面上的位置（0..1，可以在畫面外）
    this.strength = 0;                         // 0 = 關掉（太陽在背後、在水裡）
    const rt = () => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.a = rt();
    this.b = rt();
    const base = { vertexShader: VERT, depthTest: false, depthWrite: false };
    this.color = new THREE.Color(1, 0.9, 0.7);   // 光束的顏色（太陽或月亮當下的顏色）
    this.mask = new THREE.ShaderMaterial({
      ...base,
      // uThr：(天空多暗就幾乎不發光, 多亮就全發光, 光暈的範圍——越大越集中在太陽附近)
      uniforms: { tScene: { value: null }, uSun: { value: this.sun }, uAspect: { value: 1 }, uColor: { value: this.color }, uThr: { value: new THREE.Vector3(0.2, 0.9, 11.0) } },
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform vec2 uSun;
        uniform float uAspect;
        uniform vec3 uColor;
        uniform vec3 uThr;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tScene, vUv);
          float l = max(c.r, max(c.g, c.b));
          float sky = 1.0 - clamp(c.a, 0.0, 1.0);                       // 只有天空會發光；樹、山、房子是擋光的
          vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
          float halo = exp(-dot(d, d) * uThr.z);                        // 太陽周圍一圈光暈
          vec3 src = uColor * halo * (0.25 + 0.75 * smoothstep(uThr.x, uThr.y, l))   // 烏雲後面的光弱一點
                   + min(c.rgb, vec3(4.0)) * smoothstep(1.6, 3.5, l) * 0.35;          // 太陽本身
          gl_FragColor = vec4(src * sky, 1.0);
        }`,
    });
    this.blur = new THREE.ShaderMaterial({
      ...base,
      uniforms: { tMap: { value: null }, uSun: { value: this.sun }, uLen: { value: 0.6 } },
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap;
        uniform vec2 uSun;
        uniform float uLen;
        varying vec2 vUv;
        void main() {
          vec2 step = (uSun - vUv) * uLen / 12.0;
          vec2 p = vUv;
          vec3 acc = vec3(0.0);
          float w = 1.0, tot = 0.0;
          for (int i = 0; i < 12; i++) {
            acc += texture2D(tMap, p).rgb * w;
            tot += w;
            w *= 0.94;
            p += step;
          }
          gl_FragColor = vec4(acc / tot, 1.0);
        }`,
    });
    this.add = new THREE.ShaderMaterial({
      ...base,
      uniforms: { tMap: { value: null }, uStrength: { value: 1 } },
      transparent: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap;
        uniform float uStrength;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(texture2D(tMap, vUv).rgb * uStrength, 1.0);
        }`,
    });
    this.quad = new FullScreenQuad(this.mask);
  }

  setSize(w, h) {
    const qw = Math.max(2, Math.round(w / 4)), qh = Math.max(2, Math.round(h / 4));
    this.a.setSize(qw, qh);
    this.b.setSize(qw, qh);
    this.mask.uniforms.uAspect.value = w / h;
  }

  render(renderer, writeBuffer, readBuffer) {
    if (this.strength < 0.004) return;
    const draw = (mat, target) => { this.quad.material = mat; renderer.setRenderTarget(target); this.quad.render(renderer); };
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    this.mask.uniforms.tScene.value = readBuffer.texture;
    draw(this.mask, this.a);
    // 兩段式：第一段跨一大步，第二段把每一步之間補滿，等於沿路取了 144 個點
    this.blur.uniforms.tMap.value = this.a.texture; this.blur.uniforms.uLen.value = 0.62;
    draw(this.blur, this.b);
    this.blur.uniforms.tMap.value = this.b.texture; this.blur.uniforms.uLen.value = 0.62 / 12;
    draw(this.blur, this.a);
    this.add.uniforms.tMap.value = this.a.texture;
    this.add.uniforms.uStrength.value = this.strength;
    draw(this.add, readBuffer);
    renderer.autoClear = auto;
  }

  dispose() {
    this.a.dispose(); this.b.dispose();
    this.mask.dispose(); this.blur.dispose(); this.add.dispose(); this.quad.dispose();
  }
}
