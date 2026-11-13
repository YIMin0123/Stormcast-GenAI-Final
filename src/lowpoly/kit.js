// 低面平塗風的共用工具：亂數、雜訊、每面一色的幾何、鏡像、全場共用的那一個材質。
import * as THREE from 'three';

// ---- 可重現的亂數（同一個種子每次長出一樣的東西）----
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 平滑的 2D 雜訊（地形起伏用）----
function hash(x, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
export function fbm(x, z, oct = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * noise(x * f, z * f); f *= 2.03; amp *= 0.5; }
  return s;
}

// ---- 材質種類（電腦版的程式貼圖用，見 surfaceDetail.js）----
// 顏色上可以帶 surf（哪一種材質）和 grain（木紋、鐵皮浪板的方向）；FaceBuilder 把它們記在頂點的 aSurf 上。
// 手機不畫程式貼圖，也就不記（tagSurfaces(false)），省記憶體
export const SURF = { none: 0, wood: 1, stone: 2, metal: 3, plaster: 4, cloth: 5, rock: 6, shingle: 7, tin: 8, ice: 9 };
let TAG = false;
export function tagSurfaces(on) { TAG = on; }
// 帶材質種類的顏色：clone() 的時候 surf、grain 跟著複製（jitter、multiplyScalar 這些都會留著）
export class SColor extends THREE.Color {
  clone() { const c = super.clone(); c.surf = this.surf; c.grain = this.grain; return c; }
}
// 一個顏色加上材質種類（新的一份，不改原本的）
export const withSurf = (col, surf, grain = null) => { const c = new SColor(col.r, col.g, col.b); c.surf = surf; c.grain = grain; return c; };
const NO_GRAIN = new THREE.Vector3();

// ---- 每面一色的幾何 ----
// tris：[[ax,ay,az, bx,by,bz, cx,cy,cz, r,g,b(線性), sway], ...] 或用 builder 一面一面加。
// 不共用頂點，每個三角形自己三個點，法線就是面的方向（平塗風的稜角）。
// aFx.x：搖動量（0 不動，樹冠約 0.3，草約 3）；aFx.y：1 = 離鏡頭遠了就縮小到消失（草叢）
export class FaceBuilder {
  constructor() { this.p = []; this.c = []; this.fx = []; this.s = []; this.grain = null; }
  // 一個三角形：a、b、c 是 Vector3（逆時針看過去是正面），col 是 THREE.Color，sway 可以給每個點不同的量
  tri(a, b, c, col, sway = [0, 0, 0], shrink = 0, col2 = null) {
    this.p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const cs = col2 || [col, col, col];
    for (const k of cs) this.c.push(k.r, k.g, k.b);
    for (let i = 0; i < 3; i++) this.fx.push(sway[i], shrink);
    if (TAG) {   // 材質種類＋紋路方向（顏色自己帶的優先，沒有就用 this.grain：box() 這些會先設好長邊的方向）
      const k = cs[0], g = k.grain || this.grain || NO_GRAIN, t = k.surf || 0;
      for (let i = 0; i < 3; i++) this.s.push(t, g.x, g.y, g.z);
    }
  }
  // 把一個有索引的幾何（例如 Icosahedron）拆成一面一面，colorOf(面中心, 面法線, 第幾面) 決定顏色
  addGeometry(geo, colorOf, swayOf = () => 0, shrink = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const n = new THREE.Vector3(), m = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
      m.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      this.tri(a.clone(), b.clone(), c.clone(), colorOf(m, n, i / 3), [swayOf(a), swayOf(b), swayOf(c)], shrink);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aFx', new THREE.Float32BufferAttribute(this.fx, 2));
    if (TAG && this.s.length) g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.s, 4));
    g.computeVertexNormals();   // 沒有共用頂點，算出來就是每一面自己的法線
    g.computeBoundingSphere();
    return g;
  }
}

// 左右鏡像的版本：x 取負、三角形繞的方向倒過來（一大批一起畫時不能用負的縮放，背面會畫錯）
export function mirrored(geo) {
  const g = geo.clone();
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) p[i] = -p[i];
  if (g.attributes.aSurf) { const s = g.attributes.aSurf.array; for (let i = 1; i < s.length; i += 4) s[i] = -s[i]; }   // 紋路方向也左右翻
  for (const name of Object.keys(g.attributes)) {
    const at = g.attributes[name], s = at.itemSize, arr = at.array;
    for (let i = 0; i < at.count; i += 3) {
      for (let k = 0; k < s; k++) { const t = arr[(i + 1) * s + k]; arr[(i + 1) * s + k] = arr[(i + 2) * s + k]; arr[(i + 2) * s + k] = t; }
    }
  }
  g.computeVertexNormals();
  return g;
}

// ---- 全場共用的唯一材質 ----
// 顏色寫在頂點上、每個實例可以再乘一個顏色偏移；樹和草在頂點著色器裡隨風擺、草叢離鏡頭遠了縮小到消失
export const lpUniforms = {
  uTime: { value: 0 }, uGrassNear: { value: 22 }, uGrassFar: { value: 34 },
  // 逆光的邊緣光（電腦加強才開）：太陽在物件背後時，側面朝向鏡頭邊緣的面亮起一圈暖光
  uRim: { value: 0 }, uRimCol: { value: new THREE.Color(1, 0.8, 0.6) }, uSunView: { value: new THREE.Vector3(0, 1, 0) },
};
export function makeMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, lpUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aFx;
varying float vMark;
uniform float uTime, uGrassNear, uGrassFar;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
	#ifdef USE_INSTANCING
		vec3 lpIp = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xyz;
	#else
		vec3 lpIp = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
	#endif
	vMark = aFx.y;
	if ( aFx.y > 0.5 && aFx.y < 1.5 ) transformed *= 1.0 - smoothstep( uGrassNear, uGrassFar, distance( lpIp.xz, cameraPosition.xz ) );
	float lpW = sin( uTime * 1.6 + lpIp.x * 0.31 + lpIp.z * 0.17 ) * 0.65 + sin( uTime * 2.7 + lpIp.z * 0.43 ) * 0.35;
	transformed.xz += aFx.x * lpW * vec2( 0.05, 0.035 ) * max( position.y, 0.0 );`);
    // 後製用的記號寫在 alpha：草 1.5（角落暗影壓淡）、海面 3（不套角落暗影）、天空 0（光束只從天空發出）
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vMark;
uniform float uRim;
uniform vec3 uRimCol, uSunView;`)
      .replace('#include <opaque_fragment>', `if ( uRim > 0.0 && ( vMark < 0.1 || vMark > 0.4 ) && vMark < 1.5 ) {   // 地形（0.25）和海面（2）的大平面不打邊緣光，不然整片亮起來
		vec3 vd = normalize( vViewPosition );
		float edge = pow( 1.0 - saturate( dot( normal, vd ) ), 3.0 );
		float back = saturate( -dot( vd, uSunView ) );
		outgoingLight += uRimCol * diffuseColor.rgb * edge * ( 0.25 + 0.75 * back ) * uRim;
	}
	#include <opaque_fragment>
	gl_FragColor.a = vMark > 1.5 ? 3.0 : vMark > 0.5 ? 1.5 : 1.0;`);
  };
  return m;
}
