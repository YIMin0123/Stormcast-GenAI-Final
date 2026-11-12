// 環境光遮蔽：東西靠在一起的地方（牆腳、屋簷下、樹叢裡、箱子和地面之間）會比較暗。
// 沒有它，每個面都一樣亮，物件像貼在畫面上而不是站在地上。
// 遮蔽量用 three.js 內建的 GTAO 算（只吃深度，法線從深度反推），這裡只負責接到場景的深度貼圖、
// 以及最後怎麼疊回畫面：暗角帶藍（卡通風的陰影不是灰黑）、遠處淡掉、天空不碰。
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const MIX_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tAO;
uniform sampler2D tDepth;
uniform vec2 uAoSize;     // 遮蔽貼圖的大小（像素）
uniform vec2 uNearFar;
uniform vec3 uTint;       // 完全被遮住的地方，顏色乘上這個
uniform float uStrength;
uniform vec2 uFade;       // 離鏡頭多遠開始淡、多遠完全沒有
uniform float uGrass;      // 草地上遮蔽剩幾成
uniform float uFigure;     // 人物身上遮蔽剩幾成
uniform float uDebug;
uniform float uSplit;      // 測試用：畫面左邊這個比例不套遮蔽，方便左右對照
varying vec2 vUv;

float dist(float d) { return uNearFar.x * uNearFar.y / (uNearFar.y - d * (uNearFar.y - uNearFar.x)); }

void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  float d = texture2D(tDepth, vUv).x;
  if (d >= 1.0) { gl_FragColor = uDebug > 0.5 ? vec4(1.0) : vec4(c.rgb, min(c.a, 1.0)); return; }
  float z = dist(d);

  // 遮蔽是用較低的解析度算的。直接放大的話，前景的暗角會滲到後面的東西上（物件邊緣一圈髒髒的）；
  // 所以取周圍四格時，只採信深度跟這個像素差不多的那幾格
  vec2 p = vUv * uAoSize - 0.5, f = fract(p), px = 1.0 / uAoSize;
  vec2 b = (floor(p) + 0.5) * px;
  float ao = 0.0, ws = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 uv = b + vec2(float(i), float(j)) * px;
      float wb = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
      float zi = dist(texture2D(tDepth, uv).x);
      float w = (wb + 0.02) * exp(-abs(zi - z) / z * 90.0) + 1e-5;
      ao += texture2D(tAO, uv).r * w;
      ws += w;
    }
  }
  ao /= ws;

  float k = clamp((1.0 - ao) * uStrength, 0.0, 1.0) * (1.0 - smoothstep(uFade.x, uFade.y, z));
  float fig = step(2.25, c.a) * step(c.a, 2.5);           // 人物把 alpha 寫成 2.4（見 figure.js）
  k *= mix(mix(1.0, uGrass, clamp(c.a - 1.0, 0.0, 1.0)), uFigure, fig);   // 草和長草的地面把 alpha 寫成大於 1（見 renderShaders.js）
  if (c.a > 2.5) k = 0.0;   // 海面把 alpha 寫成 3（見 main.js 的 waterFlag）：海面不套遮蔽
  if (vUv.x < uSplit) k = 0.0;
  if (uDebug > 0.5) { gl_FragColor = vec4(vec3(1.0 - k), 1.0); return; }
  gl_FragColor = vec4(c.rgb * mix(vec3(1.0), uTint, k), min(c.a, 1.0));
}`;

export class ShadePass extends GTAOPass {
  // scale：遮蔽用畫面的幾分之幾來算（1 = 全解析度）
  constructor(scene, camera, scale = 1) {
    super(scene, camera, 4, 4, { depthTexture: null });   // 深度貼圖每幀從場景的緩衝區拿，不另外畫一次場景
    this.aoScale = scale;
    this.output = GTAOPass.OUTPUT.Off;                    // 內建的疊法（乘上灰黑）不用，下面自己疊
    // 半徑不到一公尺：只壓「貼在一起」的地方。再大的話，人和繫船柱周圍的地面會暈出一大圈，看起來像髒漬。
    // 取樣數不能省：少了會留下一顆一顆的雜點
    this.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.5, distanceFallOff: 1, scale: 2.4, samples: 16 });
    this.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 8, radiusExponent: 2, rings: 2, samples: 16 });
    this.mix = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: MIX_FRAG, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      uniforms: {
        tDiffuse: { value: null }, tAO: { value: this.pdRenderTarget.texture }, tDepth: { value: null },
        uAoSize: { value: new THREE.Vector2(4, 4) }, uNearFar: { value: new THREE.Vector2(1, 1000) },
        uTint: { value: new THREE.Vector3(0.30, 0.33, 0.46) }, uStrength: { value: 1.5 },   // 顏色跟影子差不多的灰藍；太藍會像染色
        uFade: { value: new THREE.Vector2(90, 260) }, uGrass: { value: 0.3 }, uFigure: { value: 0.15 }, uDebug: { value: 0 }, uSplit: { value: 0 },
      },
    });
  }

  setSize(w, h) {
    const aw = Math.max(2, Math.ceil(w * this.aoScale)), ah = Math.max(2, Math.ceil(h * this.aoScale));
    super.setSize(aw, ah);
    this.mix.uniforms.uAoSize.value.set(aw, ah);
  }

  render(renderer, writeBuffer, readBuffer) {
    const depth = readBuffer.depthTexture;
    this.gtaoMaterial.uniforms.tDepth.value = depth;
    this.pdMaterial.uniforms.tDepth.value = depth;
    super.render(renderer, writeBuffer, readBuffer);   // 只算遮蔽，結果在 pdRenderTarget
    const u = this.mix.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = depth;
    u.uNearFar.value.set(this.camera.near, this.camera.far);
    this._renderPass(renderer, this.mix, this.renderToScreen ? null : writeBuffer);
  }

  dispose() {
    super.dispose();
    this.mix.dispose();
  }
}
