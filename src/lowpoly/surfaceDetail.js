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

const PARS = /* glsl */`
uniform float uDetail;
uniform sampler2D uSdNoise;
varying vec4 vSurf;
varying vec3 vWPos;
vec4 sdT(vec2 p) { return texture2D(uSdNoise, p); }
float sdHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
// 細紋離遠了（一個像素裡塞好幾條）就換成平均值，不然會閃：k 是紋路座標，回傳 0（太細）～ 1（看得清楚）
float sdAA(float k) { return 1.0 - smoothstep(0.25, 0.7, fwidth(k)); }
// 用高度 h 的螢幕導數把法線推歪一點（跟 three.js 的 bumpMap 同一套算法）：pos、nor 是相機座標
vec3 sdBump(vec3 pos, vec3 nor, float h) {
	vec3 sx = dFdx(pos), sy = dFdy(pos), r1 = cross(sy, nor), r2 = cross(nor, sx);
	float det = dot(sx, r1);
	vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
	return normalize(abs(det) * nor - grad);
}
`;

const FRAG = /* glsl */`
	if (uDetail > 0.0 && vSurf.x > 0.5) {
		float sdFade = uDetail * (1.0 - smoothstep(18.0, 40.0, distance(vWPos, cameraPosition)));
		if (sdFade > 0.0) {
			int kind = int(vSurf.x + 0.5);
			vec3 P = vWPos;
			vec3 N = normalize((vec4(normal, 0.0) * viewMatrix).xyz);   // 世界座標的面法線
			// 紋路方向：面上記的方向（木頭的長邊、浪板的走向）投影到這一面上；沒有記（或剛好垂直這一面）就用往上，再不行用 x
			vec3 G = vSurf.yzw;
			G = G - N * dot(G, N);
			if (dot(G, G) < 0.01) { G = vec3(0.0, 1.0, 0.0) - N * N.y; if (dot(G, G) < 0.01) G = vec3(1.0, 0.0, 0.0) - N * N.x; }
			G = normalize(G);
			vec3 B = cross(N, G);
			float u = dot(P, G), v = dot(P, B);
			// 沒有方向的材質（石頭、灰泥…）：照面朝哪邊，取兩個軸當平面座標
			vec2 pp = abs(N.y) > 0.6 ? P.xz : abs(N.x) > abs(N.z) ? P.zy : P.xy;
			float m = 1.0, h = 0.0, bump = 0.0;
			if (kind == 7 && N.y < 0.25) kind = 1;   // 屋頂的底面、山牆的三角形：從底下看是木板，不畫屋瓦
			if (kind == 1) {
				// 木頭：順著長邊的細木紋（被雜訊推彎）、一條一條深淺，偶爾一個節
				// 彎曲只用很慢變化的雜訊（快的會把木紋切成一段一段，像樹皮）
				vec4 a = sdT(vec2(u * 0.04, v * 0.25)), b = sdT(vec2(u * 0.2, v * 1.2) + 0.37);
				float q = v * 9.0 + (a.r - 0.5) * 6.0 + (a.g - 0.5) * 1.5;
				float line = smoothstep(0.05, 0.5, abs(fract(q) - 0.5) * 2.0);
				float aa = sdAA(q);
				m = mix(0.95, mix(0.88, 1.04, line), aa) * (0.95 + 0.1 * b.g);
				m *= 1.0 - 0.12 * smoothstep(0.78, 0.92, b.a);
				h = line * aa * 0.4 + b.g * 0.3; bump = 0.5;
			} else if (kind == 2) {
				// 石砌：一排一排錯開的石塊、深色的灰縫、每塊石頭深淺不同、表面粗糙
				vec3 hz = abs(N.y) > 0.7 ? vec3(1.0, 0.0, 0.0) : normalize(vec3(-N.z, 0.0, N.x));
				float su = dot(P, hz) / 0.55, sv = (abs(N.y) > 0.7 ? P.z : P.y) / 0.32;
				float row = floor(sv); su += mod(row, 2.0) * 0.5;
				vec2 f = vec2(fract(su), fract(sv));
				float edge = min(min(f.x, 1.0 - f.x) * 0.55, min(f.y, 1.0 - f.y) * 0.32);
				float aa = sdAA(su);
				float mortar = smoothstep(0.012, 0.03, edge) * aa + (1.0 - aa);
				float tint = 0.88 + 0.2 * sdHash(vec3(floor(su), row, 3.0));
				float rough = sdT(pp * 0.5).g;
				m = mix(0.62, tint, mortar) * (0.9 + 0.2 * rough);
				h = mortar * 0.7 + rough * 0.4; bump = 1.0;
			} else if (kind == 6) {
				// 岩石：大塊的深淺、細細的裂縫、表面的顆粒
				vec4 a = sdT(pp * 0.12), b = sdT(pp * 0.5 + 0.21);
				float crack = 1.0 - smoothstep(0.0, 0.035, abs(a.a - 0.5));
				m = (0.78 + 0.34 * a.r) * (0.92 + 0.14 * a.g) * (0.95 + 0.08 * b.g) * (1.0 - 0.32 * crack);
				h = a.r * 1.2 + b.g * 0.3 - crack * 0.6; bump = 1.2;
			} else if (kind == 3) {
				// 金屬：細細的刷紋＋一點鏽斑
				float br = sdT(vec2(u * 0.15, v * 2.5)).b;
				float rust = smoothstep(0.62, 0.8, sdT(pp * 0.15).a);
				m = (0.94 + 0.1 * br) * mix(1.0, 0.78, rust);
				h = br * 0.2; bump = 0.4;
			} else if (kind == 8) {
				// 鐵皮浪板：順著記的方向一道一道起伏，還有往下流的鏽痕
				float k = v / 0.11;
				float aa = sdAA(k);
				float wave = sin(k * 6.2832);
				vec4 a = sdT(vec2(u * 0.04, v * 0.5));
				float streak = smoothstep(0.55, 0.85, a.g);
				m = (1.0 + 0.07 * wave * aa) * mix(1.0, 0.8, streak) * (0.95 + 0.1 * a.r);
				h = wave * aa; bump = 0.9;
			} else if (kind == 7) {
				// 屋瓦：沿著斜坡往下一排一排，每排的下緣有一道陰影，瓦片左右錯開、深淺不同
				vec3 dn = vec3(0.0, -1.0, 0.0) + N * N.y;
				dn = dot(dn, dn) > 0.001 ? normalize(dn) : G;
				vec3 ac = cross(N, dn);
				float rv = dot(P, dn) / 0.24, row = floor(rv);
				float ru = dot(P, ac) / 0.32 + mod(row, 2.0) * 0.5;
				float fv = fract(rv), fu = fract(ru);
				float aa = sdAA(rv);
				float lip = smoothstep(0.75, 1.0, fv);
				float gap = 1.0 - smoothstep(0.0, 0.06, min(fu, 1.0 - fu));
				float tint = 0.9 + 0.18 * sdHash(vec3(floor(ru), row, 9.0));
				m = mix(0.97, tint * (1.0 - 0.28 * lip) * (1.0 - 0.25 * gap * sdAA(ru)), aa) * (0.95 + 0.1 * sdT(pp * 0.3).g);
				h = (fv - gap * 0.5) * aa; bump = 0.8;
			} else if (kind == 4) {
				// 灰泥：大片的淡淡斑駁＋細小的粗糙
				vec4 a = sdT(pp * 0.2);
				m = (0.93 + 0.12 * a.r) * (0.97 + 0.05 * a.b);
				h = a.b * 0.3 + a.r * 0.3; bump = 0.5;
			} else if (kind == 5) {
				// 布、繩子、網子：細細的織紋
				float k1 = u * 55.0, k2 = v * 55.0;
				float aa = sdAA(k1) * sdAA(k2);
				float wv = sin(k1 * 6.2832) * sin(k2 * 6.2832);
				m = (1.0 + 0.06 * wv * aa) * (0.94 + 0.12 * sdT(pp * 0.4).g);
				h = wv * aa * 0.3; bump = 0.4;
			} else if (kind == 9) {
				// 冰：亮亮的一塊一塊
				float c = sdT(pp * 0.25).b;
				m = 0.92 + 0.16 * c;
				h = c; bump = 0.8;
			}
			diffuseColor.rgb *= mix(1.0, m, sdFade);
			if (bump > 0.0) normal = normalize(mix(normal, sdBump(-vViewPosition, normal, h * bump * 0.02), sdFade));
		}
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
  mat.customProgramCacheKey = () => 'lowpoly-detail2';
}
