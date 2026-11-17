// 瞄準物件外輪廓描邊後處理 Pass（僅在有瞄準目標時以短視距實心深度預掃描＋目標剪影繪製，不受船隻隱形水罩或透明特效干擾）
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const AIM_LAYER = 30;
const OCC_FAR = 56;

/**
 * 收集目標物件底下所有可見且非碰撞代理的可渲染網格。
 */
function collectVisibleMeshes(root, out, seen) {
  if (!root || !root.visible || root.userData?.hull || root.userData?.camProxy) return;
  if ((root.isMesh || root.isSkinnedMesh) && !seen.has(root)) {
    seen.add(root);
    out.push(root);
  }
  const ch = root.children;
  for (let i = 0; i < ch.length; i++) collectVisibleMeshes(ch[i], out, seen);
}

/**
 * 判斷材質是否屬於不應遮擋描邊的非實體物件（隱形水罩、第一人稱隱形身軀、玻璃、粒子、透明陰影圈等）。
 */
function isNonOccluderMat(mat) {
  if (!mat) return true;
  if (Array.isArray(mat)) {
    for (let i = 0; i < mat.length; i++) if (!isNonOccluderMat(mat[i])) return false;
    return true;
  }
  return !mat.colorWrite || !mat.depthWrite || (mat.transparent && !(mat.alphaTest > 0));
}

/**
 * 收集場景中不該寫入遮擋深度的葉節點（含水罩／海面／透明物件與目標自身），暫時移出 Layer 0。
 */
function collectDepthSkip(node, targetSet, camLayers, out) {
  if (!node.visible) return;
  if (node.userData?.noAimOcc || node.isPoints || node.isLine || node.isSprite) {
    if (node.layers.test(camLayers)) {
      out.push({ obj: node, mask: node.layers.mask });
      node.layers.set(AIM_LAYER);
    }
    return;
  }
  if ((node.isMesh || node.isSkinnedMesh || node.isInstancedMesh) && node.layers.test(camLayers)) {
    if (!targetSet.has(node) && isNonOccluderMat(node.material)) {
      out.push({ obj: node, mask: node.layers.mask });
      node.layers.set(AIM_LAYER);
    }
  }
  const ch = node.children;
  for (let i = 0; i < ch.length; i++) collectDepthSkip(ch[i], targetSet, camLayers, out);
}

/**
 * 對當前準心瞄準的 3D 物件渲染粗綠色外輪廓描邊，無目標時自動略過以維持零額外開銷。
 */
export class AimOutlinePass extends Pass {
  constructor(scene, camera, color = 0x44ff70, widthPx = 4.2) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.widthPx = widthPx;
    this.enabled = false;
    this.needsSwap = true;

    this._targets = [];
    this._ignore = [];
    this._meshes = [];
    this._ignoreMeshes = [];
    this._seen = new Set();
    this._ignoreSeen = new Set();
    this._oldMasks = [];
    this._skipMasks = [];
    this._clearColor = new THREE.Color();

    this._maskRT = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
    });

    // 深度預掃描材質：僅寫入硬體深度（略微後推避免與船板／地面共面閃爍）
    this._occMat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 2,
    });

    // 目標剪影材質：雙面純白輸出，硬體深度自動剔除被前方箱壁／船殼／山石擋住的部位
    this._maskMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });

    this._compMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tMask: { value: this._maskRT.texture },
        uTexel: { value: new THREE.Vector2(1 / 4, 1 / 4) },
        uRadius: { value: widthPx },
        // OutputPass 之後已是 sRGB 數值空間，直接傳入 sRGB 分量避免二次暗化
        uColor: { value: new THREE.Vector3(((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255) },
      },
      vertexShader: /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tMask;
uniform vec2 uTexel;
uniform float uRadius;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  float center = texture2D(tMask, vUv).r;
  if (center > 0.5) {
    gl_FragColor = base;
    return;
  }

  float hit = 0.0;
  // 內圈四鄰域確保 1px 細邊（魚尾/細槓）不會漏針孔
  vec2 rNear = uTexel * max(1.0, uRadius * 0.34);
  hit = max(hit, texture2D(tMask, vUv + vec2( rNear.x, 0.0)).r);
  hit = max(hit, texture2D(tMask, vUv + vec2(-rNear.x, 0.0)).r);
  hit = max(hit, texture2D(tMask, vUv + vec2(0.0,  rNear.y)).r);
  hit = max(hit, texture2D(tMask, vUv + vec2(0.0, -rNear.y)).r);

  // 中圈 10 向 + 外圈 20 向圓形擴張，高 DPR 下外緣仍密合無鋸齒斷點
  vec2 rMid = uTexel * (uRadius * 0.65);
  for (int i = 0; i < 10; i++) {
    float a = float(i) * 0.62831853;
    hit = max(hit, texture2D(tMask, vUv + vec2(cos(a), sin(a)) * rMid).r);
  }
  vec2 rOut = uTexel * uRadius;
  float outerHit = 0.0;
  for (int i = 0; i < 20; i++) {
    float a = float(i) * 0.31415926;
    outerHit = max(outerHit, texture2D(tMask, vUv + vec2(cos(a), sin(a)) * rOut).r);
  }
  hit = max(hit, outerHit * 0.92);

  // 線性濾波邊緣可能有極微弱滲值，切掉底噪並平滑顯色，同時確保描邊 Alpha 不透明
  float alpha = smoothstep(0.05, 0.35, hit);
  if (center > 0.0) alpha *= 1.0 - smoothstep(0.25, 0.5, center);
  gl_FragColor = vec4(mix(base.rgb, uColor, alpha), mix(base.a, 1.0, alpha));
}`,
      depthTest: false,
      depthWrite: false,
    });

    this._quad = new FullScreenQuad(this._compMat);
  }

  /**
   * 設定當前要描邊的目標 Object3D 陣列與需於深度預掃描中忽略的物件（如箱內魚群）；目標為空時關閉 Pass。
   */
  setTargets(objs, ignore = null) {
    this._targets.length = 0;
    this._ignore.length = 0;
    if (objs && objs.length) {
      for (let i = 0; i < objs.length; i++) {
        if (objs[i]) this._targets.push(objs[i]);
      }
    }
    if (ignore && ignore.length) {
      for (let i = 0; i < ignore.length; i++) {
        if (ignore[i]) this._ignore.push(ignore[i]);
      }
    }
    this.enabled = this._targets.length > 0;
  }

  setSize(width, height) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this._maskRT.setSize(w, h);
    this._compMat.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  render(renderer, writeBuffer, readBuffer) {
    const meshes = this._meshes;
    const ignoreMeshes = this._ignoreMeshes;
    const seen = this._seen;
    const ignoreSeen = this._ignoreSeen;
    const oldMasks = this._oldMasks;
    const skipMasks = this._skipMasks;
    meshes.length = 0;
    ignoreMeshes.length = 0;
    seen.clear();
    ignoreSeen.clear();
    oldMasks.length = 0;
    skipMasks.length = 0;

    for (let i = 0; i < this._targets.length; i++) {
      collectVisibleMeshes(this._targets[i], meshes, seen);
    }
    for (let i = 0; i < this._ignore.length; i++) {
      collectVisibleMeshes(this._ignore[i], ignoreMeshes, ignoreSeen);
    }

    const rtW = Math.max(1, readBuffer.width);
    const rtH = Math.max(1, readBuffer.height);
    if (this._maskRT.width !== rtW || this._maskRT.height !== rtH) {
      this.setSize(rtW, rtH);
    }

    if (meshes.length) {
      const prevTarget = renderer.getRenderTarget();
      const prevAutoClear = renderer.autoClear;
      const prevShadowAuto = renderer.shadowMap.autoUpdate;
      const prevCamMask = this.camera.layers.mask;
      const prevFar = this.camera.far;
      const prevBg = this.scene.background;
      const prevOverride = this.scene.overrideMaterial;
      renderer.getClearColor(this._clearColor);
      const prevAlpha = renderer.getClearAlpha();

      try {
        this.camera.far = Math.min(prevFar, OCC_FAR);
        this.camera.updateProjectionMatrix();
        this.scene.background = null;
        renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(this._maskRT);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, true, false);
        renderer.autoClear = false;

        // 1) 將目標自身與非遮擋物暫移至 AIM_LAYER，只畫真實固體遮擋深度
        for (let i = 0; i < meshes.length; i++) {
          oldMasks.push(meshes[i].layers.mask);
          meshes[i].layers.set(AIM_LAYER);
        }
        collectDepthSkip(this.scene, seen, this.camera.layers, skipMasks);
        for (let i = 0; i < ignoreMeshes.length; i++) {
          const m = ignoreMeshes[i];
          if (!seen.has(m) && m.layers.test(this.camera.layers)) {
            skipMasks.push({ obj: m, mask: m.layers.mask });
            m.layers.set(AIM_LAYER);
          }
        }
        this.scene.overrideMaterial = this._occMat;
        renderer.render(this.scene, this.camera);

        // 2) 復原非遮擋物後只繪製 AIM_LAYER（目標本身），以硬體深度決定可見剪影
        for (let i = 0; i < skipMasks.length; i++) skipMasks[i].obj.layers.mask = skipMasks[i].mask;
        skipMasks.length = 0;
        this.camera.layers.set(AIM_LAYER);
        this.scene.overrideMaterial = this._maskMat;
        renderer.render(this.scene, this.camera);
      } finally {
        for (let i = 0; i < skipMasks.length; i++) skipMasks[i].obj.layers.mask = skipMasks[i].mask;
        for (let i = 0; i < meshes.length; i++) meshes[i].layers.mask = oldMasks[i];
        this.camera.layers.mask = prevCamMask;
        this.camera.far = prevFar;
        this.camera.updateProjectionMatrix();
        this.scene.background = prevBg;
        this.scene.overrideMaterial = prevOverride;
        renderer.shadowMap.autoUpdate = prevShadowAuto;
        renderer.autoClear = prevAutoClear;
        renderer.setClearColor(this._clearColor, prevAlpha);
        renderer.setRenderTarget(prevTarget);
      }

      const dpr = renderer.getPixelRatio();
      this._compMat.uniforms.uRadius.value = Math.max(2.5, this.widthPx * Math.min(2.2, dpr));
      this._compMat.uniforms.tDiffuse.value = readBuffer.texture;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      if (this.clear) renderer.clear();
      this._quad.render(renderer);
      return;
    }

    // 目標當幀恰好無任何可見網格時直通複製（確保 needsSwap 的 writeBuffer 不殘留舊幀）
    renderer.getClearColor(this._clearColor);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this._maskRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.setClearColor(this._clearColor, prevAlpha);
    this._compMat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this._quad.render(renderer);
  }

  dispose() {
    this._maskRT.dispose();
    this._occMat.dispose();
    this._maskMat.dispose();
    this._compMat.dispose();
    this._quad.dispose();
  }
}
