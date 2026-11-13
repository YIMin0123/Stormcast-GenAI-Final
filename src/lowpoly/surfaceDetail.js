// 電腦版的「程式貼圖」：照每一面記的材質種類（kit.js 的 SURF、頂點的 aSurf）在著色器裡畫紋路——
// 木紋、石砌的縫、岩石的裂紋、鐵皮浪板、屋瓦一排一排、灰泥、布紋、冰。只改顏色深淺和一點點凹凸（光照看得出來），
// 仍然是平塗卡通的色塊，只是近看多了質感；離鏡頭 18 公尺開始淡掉、40 公尺以外就不畫（遠處的細紋只會閃，也白花力氣）。
// 雜訊不在著色器裡現算（每個像素算幾十次雜湊，內顯一幀多 30 毫秒），而是開場先在 CPU 做一張可以無縫鋪的雜訊貼圖，
// 著色器只取樣（四個通道是四種粗細的雜訊）。
// 手機不用（不記 aSurf、不改著色器）；電腦在畫質設定裡可以關（uDetail = 0 時整段跳過）
import * as THREE from 'three';

export const detailUniform = { value: 0 };

// ---- 雜訊貼圖：256×256，上下左右接得起來。R：每張 4 格（大塊）、G：16 格、B：64 格（細）、A：8 格 ----
function noiseTexture() {
  const N = 256, data = new Uint8Array(N * N * 4);
  let s = 1234567;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const layer = (cells) => {
    const g = Array.from({ length: cells * cells }, rnd), out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = x / N * cells, fy = y / N * cells, ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const at = (i, j) => g[((j % cells) * cells) + (i % cells)];
      const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
      out[y * N + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
    return out;
  };
  const fbm = (c) => { const a = layer(c), b = layer(c * 2), o = new Float32Array(N * N); for (let i = 0; i < o.length; i++) o[i] = a[i] * 0.67 + b[i] * 0.33; return o; };
  const ch = [fbm(4), fbm(16), layer(64), fbm(8)];
  for (let i = 0; i < N * N; i++) for (let k = 0; k < 4; k++) data[i * 4 + k] = Math.round(ch[k][i] * 255);
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
let noiseTex = null;

// 注意（D3D／NVIDIA 踩過的坑）：螢幕導數（dFdx、fwidth、還有貼圖自己選 mipmap 用的導數）只能在「整塊像素都走同一條路」的地方算。
// 材質種類、遠近淡出是每個像素不同的分支，在分支裡算導數會拿到亂七八糟的值，normalize 一個零向量就變 NaN，
// 再被泛光一路糊開，整個畫面一大片變黑、一閃一閃。所以導數全部在分支外先算好，貼圖用 textureGrad 自己給導數，
// normalize 之前都先確認長度不是零。
const PARS = /* glsl */`
uniform float uDetail;
uniform sampler2D uSdNoise;
varying vec4 vSurf;
varying vec3 vWPos;
float sdHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
// 細紋離遠了（一個像素裡塞好幾條）就換成平均值，不然會閃：w 是紋路座標在一個像素裡變了多少，回傳 0（太細）～ 1（看得清楚）
float sdAA(float w) { return 1.0 - smoothstep(0.25, 0.7, w); }
// 世界座標沿著 d 方向的量，在一個像素裡變了多少（px、py 是世界座標的螢幕導數）
float sdW(vec3 d, vec3 px, vec3 py) { return abs(dot(px, d)) + abs(dot(py, d)); }
vec3 sdNorm(vec3 v, vec3 fallback) { float l = dot(v, v); return l > 1e-20 ? v * inversesqrt(l) : fallback; }
// 用高度的螢幕導數（dhx、dhy）把法線推歪一點（跟 three.js 的 bumpMap 同一套算法）：sx、sy 是相機座標的導數
vec3 sdBump(vec3 sx, vec3 sy, vec3 nor, float dhx, float dhy) {
	vec3 r1 = cross(sy, nor), r2 = cross(nor, sx);
	float det = dot(sx, r1);
	vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
	return sdNorm(abs(det) * nor - grad, nor);
}
`;

const FRAG = /* glsl */`
	if (uDetail > 0.0) {   // 整個畫面一樣，分支沒問題
		float sdFade = uDetail * (1.0 - smoothstep(18.0, 40.0, distance(vWPos, cameraPosition))) * step(0.5, vSurf.x);
		vec3 P = vWPos;
		vec3 sdPx = dFdx(P), sdPy = dFdy(P);
		vec3 sdVx = dFdx(-vViewPosition), sdVy = dFdy(-vViewPosition);
		vec3 N = sdNorm((vec4(normal, 0.0) * viewMatrix).xyz, vec3(0.0, 1.0, 0.0));   // 世界座標的面法線
		// 紋路方向：面上記的方向（木頭的長邊、浪板的走向）投影到這一面上；沒有記（或剛好垂直這一面）就用往上，再不行用 x
		vec3 G = vSurf.yzw;
		G = G - N * dot(G, N);
		if (dot(G, G) < 0.01) { G = vec3(0.0, 1.0, 0.0) - N * N.y; if (dot(G, G) < 0.01) G = vec3(1.0, 0.0, 0.0) - N * N.x; }
		G = sdNorm(G, vec3(1.0, 0.0, 0.0));
		vec3 B = cross(N, G);
		float u = dot(P, G), v = dot(P, B);
		vec2 uvX = vec2(dot(sdPx, G), dot(sdPx, B)), uvY = vec2(dot(sdPy, G), dot(sdPy, B));
		float uW = abs(uvX.x) + abs(uvY.x), vW = abs(uvX.y) + abs(uvY.y);
		// 沒有方向的材質（石頭、灰泥…）：照面朝哪邊，取兩個軸當平面座標
		bool flr = abs(N.y) > 0.6, sideX = abs(N.x) > abs(N.z);
		vec2 pp = flr ? P.xz : sideX ? P.zy : P.xy;
		vec2 ppX = flr ? sdPx.xz : sideX ? sdPx.zy : sdPx.xy, ppY = flr ? sdPy.xz : sideX ? sdPy.zy : sdPy.xy;
		#define SD_UV(sx, sy, o) textureGrad(uSdNoise, vec2(u * (sx), v * (sy)) + (o), uvX * vec2(sx, sy), uvY * vec2(sx, sy))
		#define SD_PP(sc, o) textureGrad(uSdNoise, pp * (sc) + (o), ppX * (sc), ppY * (sc))
		float m = 1.0, h = 0.0, bump = 0.0;
		int kind = sdFade > 0.0 ? int(vSurf.x + 0.5) : 0;   // 太遠、或沒記材質：不畫
		if (kind == 7 && N.y < 0.25) kind = 1;   // 屋頂的底面、山牆的三角形：從底下看是木板，不畫屋瓦
		if (kind == 1) {
			// 木頭：順著長邊的細木紋（被雜訊推彎）、一條一條深淺，偶爾一個節
			// 彎曲只用很慢變化的雜訊（快的會把木紋切成一段一段，像樹皮）
			vec4 a = SD_UV(0.04, 0.25, vec2(0.0)), b = SD_UV(0.2, 1.2, vec2(0.37));
			float q = v * 9.0 + (a.r - 0.5) * 6.0 + (a.g - 0.5) * 1.5;
			float line = smoothstep(0.05, 0.5, abs(fract(q) - 0.5) * 2.0);
			float aa = sdAA(vW * 9.0);
			m = mix(0.95, mix(0.88, 1.04, line), aa) * (0.95 + 0.1 * b.g);
			m *= 1.0 - 0.12 * smoothstep(0.78, 0.92, b.a);
			h = line * aa * 0.4 + b.g * 0.3; bump = 0.5;
		} else if (kind == 2) {
			// 石砌：一排一排錯開的石塊、深色的灰縫、每塊石頭深淺不同、表面粗糙
			vec3 hz = abs(N.y) > 0.7 ? vec3(1.0, 0.0, 0.0) : sdNorm(vec3(-N.z, 0.0, N.x), vec3(1.0, 0.0, 0.0));
			float su = dot(P, hz) / 0.55, sv = (abs(N.y) > 0.7 ? P.z : P.y) / 0.32;
			float row = floor(sv); su += mod(row, 2.0) * 0.5;
			vec2 f = vec2(fract(su), fract(sv));
			float edge = min(min(f.x, 1.0 - f.x) * 0.55, min(f.y, 1.0 - f.y) * 0.32);
			float aa = sdAA(sdW(hz, sdPx, sdPy) / 0.55);
			float mortar = smoothstep(0.012, 0.03, edge) * aa + (1.0 - aa);
			float tint = 0.88 + 0.2 * sdHash(vec3(floor(su), row, 3.0));
			float rough = SD_PP(0.5, 0.0).g;
			m = mix(0.62, tint, mortar) * (0.9 + 0.2 * rough);
			h = mortar * 0.7 + rough * 0.4; bump = 1.0;
		} else if (kind == 6) {
			// 岩石：大塊的深淺、細細的裂縫、表面的顆粒
			vec4 a = SD_PP(0.12, 0.0), b = SD_PP(0.5, 0.21);
			float crack = 1.0 - smoothstep(0.0, 0.035, abs(a.a - 0.5));
			m = (0.78 + 0.34 * a.r) * (0.92 + 0.14 * a.g) * (0.95 + 0.08 * b.g) * (1.0 - 0.32 * crack);
			h = a.r * 1.2 + b.g * 0.3 - crack * 0.6; bump = 1.2;
		} else if (kind == 3) {
			// 金屬：細細的刷紋＋一點鏽斑
			float br = SD_UV(0.15, 2.5, vec2(0.0)).b;
			float rust = smoothstep(0.62, 0.8, SD_PP(0.15, 0.0).a);
			m = (0.94 + 0.1 * br) * mix(1.0, 0.78, rust);
			h = br * 0.2; bump = 0.4;
		} else if (kind == 8) {
			// 鐵皮浪板：順著記的方向一道一道起伏，還有往下流的鏽痕
			float k = v / 0.11;
			float aa = sdAA(vW / 0.11);
			float wave = sin(k * 6.2832);
			vec4 a = SD_UV(0.04, 0.5, vec2(0.0));
			float streak = smoothstep(0.55, 0.85, a.g);
			m = (1.0 + 0.07 * wave * aa) * mix(1.0, 0.8, streak) * (0.95 + 0.1 * a.r);
			h = wave * aa; bump = 0.9;
		} else if (kind == 7) {
			// 屋瓦：沿著斜坡往下一排一排，每排的下緣有一道陰影，瓦片左右錯開、深淺不同
			vec3 dn = sdNorm(vec3(0.0, -1.0, 0.0) + N * N.y, G);
			vec3 ac = cross(N, dn);
			float rv = dot(P, dn) / 0.24, row = floor(rv);
			float ru = dot(P, ac) / 0.32 + mod(row, 2.0) * 0.5;
			float fv = fract(rv), fu = fract(ru);
			float aa = sdAA(sdW(dn, sdPx, sdPy) / 0.24);
			float lip = smoothstep(0.75, 1.0, fv);
			float gap = 1.0 - smoothstep(0.0, 0.06, min(fu, 1.0 - fu));
			float tint = 0.9 + 0.18 * sdHash(vec3(floor(ru), row, 9.0));
			m = mix(0.97, tint * (1.0 - 0.28 * lip) * (1.0 - 0.25 * gap * sdAA(sdW(ac, sdPx, sdPy) / 0.32)), aa) * (0.95 + 0.1 * SD_PP(0.3, 0.0).g);
			h = (fv - gap * 0.5) * aa; bump = 0.8;
		} else if (kind == 4) {
			// 灰泥：大片的淡淡斑駁＋細小的粗糙
			vec4 a = SD_PP(0.2, 0.0);
			m = (0.93 + 0.12 * a.r) * (0.97 + 0.05 * a.b);
			h = a.b * 0.3 + a.r * 0.3; bump = 0.5;
		} else if (kind == 5) {
			// 布、繩子、網子：細細的織紋
			float k1 = u * 55.0, k2 = v * 55.0;
			float aa = sdAA(uW * 55.0) * sdAA(vW * 55.0);
			float wv = sin(k1 * 6.2832) * sin(k2 * 6.2832);
			m = (1.0 + 0.06 * wv * aa) * (0.94 + 0.12 * SD_PP(0.4, 0.0).g);
			h = wv * aa * 0.3; bump = 0.4;
		} else if (kind == 9) {
			// 冰：亮亮的一塊一塊
			float c = SD_PP(0.25, 0.0).b;
			m = 0.92 + 0.16 * c;
			h = c; bump = 0.8;
		}
		#undef SD_UV
		#undef SD_PP
		diffuseColor.rgb *= mix(1.0, m, sdFade);
		// 凹凸：高度的導數在分支外面算（每個像素都走到這裡）
		float sdH = h * bump * 0.02;
		vec3 sdNb = sdBump(sdVx, sdVy, normal, dFdx(sdH), dFdy(sdH));
		normal = sdNorm(mix(normal, sdNb, sdFade * step(0.001, bump)), normal);
	}
`;

// 把程式貼圖接到低面材質上（材質原本的 onBeforeCompile 照跑，這裡接在它後面）
export function addSurfaceDetail(mat) {
  if (!noiseTex) noiseTex = noiseTexture();
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, renderer) => {
    prev(sh, renderer);
    sh.uniforms.uDetail = detailUniform;
    sh.uniforms.uSdNoise = { value: noiseTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aSurf;
varying vec4 vSurf;
varying vec3 vWPos;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
	{
	#ifdef USE_INSTANCING
		mat4 sdM = modelMatrix * instanceMatrix;
	#else
		mat4 sdM = modelMatrix;
	#endif
		vWPos = ( sdM * vec4( transformed, 1.0 ) ).xyz;
		vSurf = vec4( aSurf.x, mat3( sdM ) * aSurf.yzw );
	}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG}`);
  };
  mat.customProgramCacheKey = () => 'lowpoly-detail3';
}
