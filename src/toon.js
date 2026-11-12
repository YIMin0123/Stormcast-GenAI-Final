// 手繪動畫背景風的光影與描邊。
import * as THREE from 'three';

// ---- 光影 ----
// 船、建築、人物、樹幹、石頭這些一般材質：受光面和背光面之間是一段短而柔和的過渡（像筆刷掃過），不是寫實的漸層。
// 葉叢另外處理：暗面染成深藍綠、亮面染成暖黃綠，中間分成柔和的三層
THREE.ShaderChunk.lights_lambert_pars_fragment = THREE.ShaderChunk.lights_lambert_pars_fragment
  .replace('float dotNL = saturate( dot( geometryNormal, directLight.direction ) );', 'float rawNL = dot( geometryNormal, directLight.direction );')
  .replace('vec3 irradiance = dotNL * directLight.color;', `#if defined( LEAF_FLUTTER ) || defined( LEAF_TONE )
		float lt = 0.5 * smoothstep( -0.32, -0.08, rawNL ) + 0.5 * smoothstep( 0.18, 0.46, rawNL );
		vec3 irradiance = directLight.color * mix( vec3( 0.20, 0.40, 0.46 ), vec3( 1.16, 1.06, 0.60 ), lt );
	#else
		vec3 irradiance = directLight.color * smoothstep( -0.04, 0.26, rawNL ) * ( 0.88 + 0.12 * smoothstep( 0.45, 0.8, rawNL ) );
	#endif`);

// 正在畫水面倒影時為 1（各個著色器共用）
export const REFL = { value: 0 };

// ---- 描邊 ----
// 只有角色和船描邊（背景不描，才像手繪的背景配上賽璐珞的人物）。
// 做法：同一個模型再畫一次，只畫背面、沿著法線往外推一點點、塗成深棕色；露在外面的那一圈就是輪廓線。
// 往外推的量跟距離成正比，所以線在畫面上的粗細固定（一個多像素）
const hullMat = new THREE.MeshBasicMaterial({ color: 0x3a281c, side: THREE.BackSide });
hullMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
	transformed += normalize( normal ) * length( ( modelViewMatrix * vec4( transformed, 1.0 ) ).xyz ) * 0.0019;`);
};
export function addOutline(root) {
  const list = [];
  root.traverse((m) => {
    if (m.isMesh && !m.userData.hull && !m.material.transparent && !m.material.isMeshBasicMaterial && m.geometry.attributes.normal) list.push(m);
  });
  for (const m of list) {
    // 有骨架的（人物）：描邊也要跟著同一副骨架動
    const h = m.isSkinnedMesh ? new THREE.SkinnedMesh(m.geometry, hullMat) : new THREE.Mesh(m.geometry, hullMat);
    if (m.isSkinnedMesh) h.bind(m.skeleton, m.bindMatrix);
    h.userData.hull = true;
    m.add(h);
  }
}

// ---- 會發光的東西 ----
// 燈泡、燈籠這些自己發光的材質：白天是熄著的顏色，天黑後亮度拉到遠超過 1，後製的光暈才會把它暈開。
// main.js 每幀依天色設定亮度
export const BULBS = [];
export function bulb(hex, k = 1) {
  const m = new THREE.MeshBasicMaterial({ color: hex });
  m.userData.base = new THREE.Color(hex);
  m.userData.k = k;
  BULBS.push(m);
  return m;
}

// 邊緣柔和淡出的圓形、方形貼圖：地上的光圈、物件腳下貼地的暗影都用它
let discTex = null, squareTex = null;
function softTex(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  draw(c.getContext('2d'));
  return new THREE.CanvasTexture(c);
}
export function softDisc() {
  return (discTex ??= softTex((g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    [[0, 1], [0.3, 0.8], [0.6, 0.32], [0.85, 0.07], [1, 0]].forEach(([t, a]) => gr.addColorStop(t, `rgba(255,255,255,${a})`));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  }));
}
export function softSquare() {
  return (squareTex ??= softTex((g) => {
    g.shadowColor = '#fff'; g.shadowBlur = 9;
    g.fillStyle = '#fff';
    for (let i = 0; i < 2; i++) g.fillRect(13, 13, 38, 38);
  }));
}
