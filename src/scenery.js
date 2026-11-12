// 島上的佈景：樹（闊葉、針葉、椰子；模型在 foliage.js）、灌木、草叢、岩石，以及母港旁的燈塔。
// 全部用程式生成。每座島各自一組，依鏡頭距離切換精細與簡化兩種模型，太遠（已經在霧裡）就不畫。
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ISLANDS } from './terrain.js';
import { realBroadleaf, animeConifer, animePalm, animeBush, animeTuft, foliageMaterials, swayDepth } from './foliage.js';
import { bulb } from './toon.js';

// ---- 亂數與雜訊（固定種子，每次開遊戲長得一樣） ----
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function hash3(x, y, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1103515245) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function noise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const sm = (t) => t * t * (3 - 2 * t);
  const fx = sm(x - ix), fy = sm(y - iy), fz = sm(z - iz);
  const at = (a, b, c) => hash3(ix + a, iy + b, iz + c, seed);
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp(lerp(at(0, 0, 0), at(1, 0, 0), fx), lerp(at(0, 1, 0), at(1, 1, 0), fx), fy),
    lerp(lerp(at(0, 0, 1), at(1, 0, 1), fx), lerp(at(0, 1, 1), at(1, 1, 1), fx), fy), fz);
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ---- 幾何小工具 ----
// 把一塊幾何整理成「非索引、只有位置／法線／顏色」，之後才能合併
function part(geo, colorFn, normalFn = null) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    if (normalFn) { const v = normalFn(p.getX(i), p.getY(i), p.getZ(i)); n.setXYZ(i, v[0], v[1], v[2]); }
    const col = colorFn(p.getX(i), p.getY(i), p.getZ(i), n.getY(i));
    c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function displace(geo, fn) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const v = fn(p.getX(i), p.getY(i), p.getZ(i)); p.setXYZ(i, v[0], v[1], v[2]); }
  return geo;
}
const BARK = [0.17, 0.14, 0.115];
const radial = (x, y, z) => { const l = Math.hypot(x, z) || 1e-3; return [x / l, 0, z / l]; };   // 樹幹的法線：朝外，明暗才圓滑

// ---- 岩石 ----
// 一塊有稜有角的石頭：先是一顆圓石，再用幾個平面把它「削」過（像石頭裂開、剝落留下的平面），
// 所以有圓的地方、也有平的面和稜線；頂上削平一塊（人站得上去）。底部埋在地裡。
// 明暗：每個面各自一個亮度（朝上的亮、側面深淺不一），稜線才看得出來。
// 顏色、裂紋、青苔、水線都在材質裡畫（paintRock），這裡只給上亮下暗的底色
function rock(seed, lo) {
  const r = rng(seed * 7 + 3);
  const sx = 0.85 + 0.4 * hash3(1, 2, 3, seed), sz = 0.85 + 0.4 * hash3(4, 5, 6, seed), sy = 0.6 + 0.3 * hash3(7, 8, 9, seed);
  const moss = hash3(3, 3, 3, seed) > 0.45 ? 1 : 0;
  // 削石頭的平面：(方向, 離中心多遠)。第一個是頂面
  const cuts = [[[(r() - 0.5) * 0.3, 1, (r() - 0.5) * 0.3], Math.min(0.66 / sy, 0.95)]];
  for (let i = 0; i < 9; i++) {
    const a = r() * 6.2832, e = 0.5 + 1.25 * r();   // 多半是側面，偶爾斜斜朝上或朝下
    cuts.push([[Math.cos(a) * Math.sin(e), Math.cos(e), Math.sin(a) * Math.sin(e)], 0.62 + 0.26 * r()]);
  }
  for (const c of cuts) { const l = Math.hypot(...c[0]); c[0] = c[0].map((v) => v / l); }
  const g = displace(new THREE.IcosahedronGeometry(1, lo ? 1 : 3), (x, y, z) => {
    let v = [x, y, z];
    for (const [n, d] of cuts) { const o = v[0] * n[0] + v[1] * n[1] + v[2] * n[2] - d; if (o > 0) v = [v[0] - n[0] * o, v[1] - n[1] * o, v[2] - n[2] * o]; }
    const k = 0.95 + 0.10 * noise3(x * 1.3 + 3, y * 1.3, z * 1.3, seed);   // 圓的地方也不是正圓
    return [v[0] * k * sx, v[1] * k * sy, v[2] * k * sz];
  });
  g.deleteAttribute('uv');
  g.computeVertexNormals();   // 沒有共用頂點，所以每個三角形各自一個方向
  const P = g.attributes.position, N = g.attributes.normal, col = new Float32Array(P.count * 3), flag = new Float32Array(P.count * 2);
  // 削出來的平面在石頭被壓扁、拉長之後朝哪個方向
  const planes = cuts.map(([n]) => { const v = [n[0] / sx, n[1] / sy, n[2] / sz], l = Math.hypot(...v); return v.map((q) => q / l); });
  for (let i = 0; i < P.count; i += 3) {
    const fx = N.getX(i), fy = N.getY(i), fz = N.getZ(i);
    // 這個三角形在哪一個削出來的平面上？在平面上的：整個面同一個方向、同一個亮度（每個面深淺不一，朝上的亮），稜線才清楚。
    // 不在平面上的（圓的地方）：照圓石的方向打光，表面是滑順的，不會看到一個一個三角形
    let pl = -1, best = 0.965;
    planes.forEach((n, j) => { const d = fx * n[0] + fy * n[1] + fz * n[2]; if (d > best) { best = d; pl = j; } });
    const face = pl < 0 ? 0.98 : (0.86 + 0.26 * hash3(pl, 11, 5, seed)) * (0.92 + 0.16 * clamp01(planes[pl][1]));
    for (let k = i; k < i + 3; k++) {
      const x = P.getX(k), y = P.getY(k), z = P.getZ(k);
      const sm = [x / (sx * sx), y / (sy * sy), z / (sz * sz)], sl = Math.hypot(...sm) || 1;
      const nn = pl < 0 ? [sm[0] / sl, sm[1] / sl, sm[2] / sl] : [planes[pl][0] * 0.88 + sm[0] / sl * 0.12, planes[pl][1] * 0.88 + sm[1] / sl * 0.12, planes[pl][2] * 0.88 + sm[2] / sl * 0.12];
      const nl = Math.hypot(...nn) || 1;
      N.setXYZ(k, nn[0] / nl, nn[1] / nl, nn[2] / nl);
      const v = (0.74 + 0.30 * clamp01((y / sy + 0.4) / 0.9)) * face;
      col.set([v * 1.03, v, v * 0.96], k * 3);
      flag[k * 2] = moss;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(flag, 2));   // 借用貼圖座標的位置傳「這一種石頭長不長青苔」
  return g;
}

// 岩石表面的筆觸：紅色那一層是深淺（灰 = 不變）——一塊一塊深淺不同的色塊、幾道深色的裂紋（旁邊一道亮邊）、小缺口；
// 綠色那一層是一團一團的雲狀，拿來決定青苔、海藻長在哪。上下左右接得起來
function rockTexture() {
  const S = 512, r = rng(31337);
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const A = mk(), B = mk(), ga = A.getContext('2d'), gb = B.getContext('2d');
  const tile = (fn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy); };
  ga.fillStyle = 'rgb(128,128,128)'; ga.fillRect(0, 0, S, S);
  gb.fillStyle = 'rgb(0,0,0)'; gb.fillRect(0, 0, S, S);
  // 色塊：不規則的多邊形，邊緣是清楚的（像一筆一筆塗上去）
  for (let i = 0; i < 14; i++) {
    const cx = r() * S, cy = r() * S, rad = 40 + 70 * r(), n = 5 + Math.floor(r() * 4), v = 128 + (r() < 0.5 ? -1 : 1) * (8 + 10 * r()), a0 = r() * 6.28;
    const pts = Array.from({ length: n }, (_, k) => { const a = a0 + (k / n) * 6.2832, d = rad * (0.6 + 0.5 * r()); return [cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7]; });
    tile((ox, oy) => {
      ga.fillStyle = `rgba(${v},${v},${v},0.55)`;
      ga.beginPath();
      pts.forEach((q, k) => (k ? ga.lineTo(q[0] + ox, q[1] + oy) : ga.moveTo(q[0] + ox, q[1] + oy)));
      ga.closePath();
      ga.fill();
    });
  }
  // 裂紋：彎彎折折的一道，偶爾分岔；深色的線旁邊貼著一道亮邊
  const crack = (x, y, ang, len, w) => {
    const pts = [[x, y]];
    let a = ang;
    for (let d = 0; d < len; d += 10) { a += (r() - 0.5) * 0.9; x += Math.cos(a) * 10; y += Math.sin(a) * 10; pts.push([x, y]); if (w > 3.2 && r() < 0.1) crack(x, y, a + (r() < 0.5 ? -1 : 1) * (0.6 + 0.6 * r()), len * 0.4, w * 0.6); }
    tile((ox, oy) => {
      for (const [dx, dy, style, lw] of [[2.5, 2.5, 'rgba(186,186,186,0.85)', w], [0, 0, 'rgb(30,30,30)', w]]) {
        ga.strokeStyle = style; ga.lineWidth = lw; ga.lineJoin = 'round'; ga.lineCap = 'round';
        ga.beginPath();
        pts.forEach((q, k) => (k ? ga.lineTo(q[0] + ox + dx, q[1] + oy + dy) : ga.moveTo(q[0] + ox + dx, q[1] + oy + dy)));
        ga.stroke();
      }
    });
  };
  for (let i = 0; i < 5; i++) crack(r() * S, r() * S, r() * 6.28, 140 + 220 * r(), 4.5 + 2 * r());
  for (let i = 0; i < 9; i++) crack(r() * S, r() * S, r() * 6.28, 20 + 30 * r(), 3);   // 小缺口
  // 雲狀
  for (let i = 0; i < 16; i++) {
    const cx = r() * S, cy = r() * S, rad = 50 + 80 * r();
    tile((ox, oy) => {
      const gr = gb.createRadialGradient(cx + ox, cy + oy, rad * 0.15, cx + ox, cy + oy, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      gb.fillStyle = gr;
      gb.beginPath(); gb.arc(cx + ox, cy + oy, rad, 0, 6.2832); gb.fill();
    });
  }
  const da = ga.getImageData(0, 0, S, S), db = gb.getImageData(0, 0, S, S).data;
  for (let i = 0; i < db.length; i += 4) { da.data[i + 1] = db[i]; da.data[i + 2] = 0; da.data[i + 3] = 255; }
  ga.putImageData(da, 0, 0);
  const t = new THREE.CanvasTexture(A);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// 岩石的材質：不靠貼圖座標，從三個方向把筆觸貼上去（哪一面朝哪就用哪個方向的），大石頭小石頭上的紋路一樣粗細。
//   裂紋和色塊；長青苔的那幾種石頭，朝上的面有一片一片的青苔；
//   岸邊的石頭：水線以下常常泡在水裡，顏色深，水線附近長一圈海藻
function paintRock(mat) {
  const tex = { value: rockTexture() };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRockTex = tex;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockP;\nvarying vec3 vRockN;\nvarying vec3 vRockW;\nvarying float vRockUp;\nvarying float vRockMoss;')
      .replace('#include <project_vertex>', `#include <project_vertex>
	vec4 rockW = vec4( transformed, 1.0 );
	vec3 rockN = normal;
	float rockS = 1.0;
	#ifdef USE_INSTANCING
		rockW = instanceMatrix * rockW;
		rockN = mat3( instanceMatrix ) * rockN;
		rockS = length( instanceMatrix[ 0 ].xyz );
	#endif
	vRockW = ( modelMatrix * rockW ).xyz;
	vRockUp = normalize( mat3( modelMatrix ) * rockN ).y;
	vRockP = position * rockS;
	vRockN = normal;
	vRockMoss = uv.x;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uRockTex;\nvarying vec3 vRockP;\nvarying vec3 vRockN;\nvarying vec3 vRockW;\nvarying float vRockUp;\nvarying float vRockMoss;')
      .replace('#include <color_fragment>', `#include <color_fragment>
	{
		vec3 rw = pow( abs( normalize( vRockN ) ), vec3( 16.0 ) );   // 幾乎只用最正對的那個方向：三個方向混在一起筆觸會糊掉
		rw /= rw.x + rw.y + rw.z;
		vec3 rp = vRockP * 0.42;
		vec2 rt = texture2D( uRockTex, rp.yz ).rg * rw.x + texture2D( uRockTex, rp.zx + 0.37 ).rg * rw.y + texture2D( uRockTex, rp.xy + 0.71 ).rg * rw.z;
		diffuseColor.rgb *= 0.55 + 0.9 * rt.r;
		// 青苔：朝上的面才長，一片一片的，邊緣清楚；泡得到海水的高度不長
		float mossK = vRockMoss * smoothstep( 0.5, 0.72, vRockUp ) * smoothstep( 0.56, 0.62, rt.g ) * smoothstep( 0.9, 1.3, vRockW.y );
		diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.12, 0.25, 0.075 ) * ( 0.7 + 0.6 * rt.r ), mossK );
		// 水線以下：常常泡在水裡，顏色深（交界是一條微微起伏的線）；水線上緣一圈細細的暗綠色海藻
		float tideY = vRockW.y + 0.06 * ( rt.g - 0.5 );
		float wetK = 1.0 - smoothstep( 0.17, 0.22, tideY );
		diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.60, 0.61, 0.64 ), wetK );
		float weed = smoothstep( 0.07, 0.11, tideY ) * ( 1.0 - smoothstep( 0.17, 0.22, tideY ) );
		diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.10, 0.17, 0.08 ), 0.45 * weed );
	}`);
  };
  return mat;
}

// 擋路的範圍：半徑 = 第一個數 × 樹的大小 + 第二個數（公尺）
const TRUNK = { broadleaf: [0.085, 0.1], conifer: [0.045, 0.12], palm: [0.055, 0.1], bush: [0.3, 0] };   // Q 版的樹幹比較胖
const CHUNK = 60;   // 島上每一塊的邊長（公尺）
const FINE = 48;    // 離鏡頭多近才畫精細版

// 每種東西的精細版與簡化版
const KINDS = {
  broadleaf: { make: realBroadleaf, variants: 3 },   // 寫實版：分枝的樹幹、樹皮貼圖、一叢一叢的葉片（在 foliage.js）
  conifer: { make: animeConifer, variants: 3 },   // 針葉樹、椰子樹也在 foliage.js（跟闊葉樹共用樹皮、葉子的材質，會隨風搖）
  palm: { make: animePalm, variants: 3 },
  bush: { make: animeBush, variants: 3 },   // 灌木也在 foliage.js：葉片、細枝、小花，三種花色
  tuft: { make: animeTuft, variants: 3 },   // 草叢也在 foliage.js：會隨風擺的長草，有的抽穗
  rock: { make: rock, variants: 4 },
};

// env：{ L, heightAt(x, z), skip(x, z)（不種樹的地方）, clear(x, z)（連石頭都不放的地方）, light（燈塔的位置） }
export function makeScenery(env) {
  const group = new THREE.Group();
  const { heightAt, skip, clear, light } = env;
  const mats = {};
  const geos = {};
  const fol = foliageMaterials();
  for (const [name, k] of Object.entries(KINDS)) {
    mats[name] = new THREE.MeshLambertMaterial({ vertexColors: true, side: k.side ?? THREE.FrontSide });
    if (name === 'rock') paintRock(mats[name]);
    // 一種東西可以由好幾塊模型組成（例如樹幹和葉子用不同的材質）。
    // 位置、法線、顏色都相同的頂點合併起來：頂點數少很多，畫起來比較快
    const make = (seed, lo) => [].concat(k.make(seed, lo)).map((p) => (p.isBufferGeometry
      ? { geo: mergeVertices(p, 1e-4), mat: mats[name] }
      : { geo: mergeVertices(p.geo, 1e-4), mat: fol[p.mat] }));
    geos[name] = Array.from({ length: k.variants }, (_, v) => ({
      hi: make(1000 + v * 77 + name.length * 13, false),
      lo: make(1000 + v * 77 + name.length * 13, true),
    }));
  }
  const slopeAt = (x, z) => Math.hypot(heightAt(x + 1.5, z) - heightAt(x - 1.5, z), heightAt(x, z + 1.5) - heightAt(x, z - 1.5)) / 3;

  const rocks = [];     // 擋路的東西：石頭、樹幹、灌木 { x, z, r, top }
  const obstacles = []; // 立在水邊的石頭（淺水模擬的障礙物）{ x, z, r }
  const isles = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eul = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color();

  ISLANDS.forEach((isle, n) => {
    const rnd = rng(9001 + n * 131);
    const items = {};   // kind → variant → [{ pos, quat, scale, color }]
    const add = (kind, x, y, z, s, sy, yaw, tiltX, tiltZ, tint) => {
      const v = Math.floor(rnd() * KINDS[kind].variants);
      ((items[kind] ??= [])[v] ??= []).push({ x, y, z, s, sy, yaw, tiltX, tiltZ, tint });
    };
    // 在島的範圍內隨機找點：回傳 [x, z, 高度]
    const spot = () => {
      const o = isle.bumps[Math.floor(rnd() * isle.bumps.length)], a = rnd() * 6.2832, d = Math.sqrt(rnd()) * o.r * 1.25;
      const x = o.x + Math.cos(a) * d, z = o.z + Math.sin(a) * d;
      return [x, z, heightAt(x, z)];
    };
    const clump = (x, z) => noise3(x * 0.035, 0, z * 0.035, 40 + n);   // 樹成片成片地長
    const F = isle.flora, dryK = isle.look.dry;

    const plant = (kind, want, ok, size, tintFn) => {
      for (let tries = 0, got = 0; got < want && tries < want * 60; tries++) {
        const [x, z, h] = spot();
        if (skip(x, z) || !ok(x, z, h)) continue;
        const s = size();
        add(kind, x, h - (kind === 'bush' || kind === 'tuft' ? 0.05 : 0.3), z, s, s * (0.85 + 0.3 * rnd()), rnd() * 6.2832, 0, 0, tintFn());
        if (TRUNK[kind]) rocks.push({ x, z, r: TRUNK[kind][0] * s + TRUNK[kind][1], top: 99 });   // 樹幹、灌木擋路
        got++;
      }
    };
    const leafTint = () => { const v = 0.8 + 0.4 * rnd(); return [v * (1 + 0.5 * dryK * rnd()), v, v * (0.9 + 0.2 * rnd())]; };
    plant('broadleaf', F.broadleaf, (x, z, h) => h > 2.4 && h < 15 && slopeAt(x, z) < 0.5 && clump(x, z) > 0.36, () => 6 + 5 * rnd(), leafTint);
    plant('conifer', F.conifer, (x, z, h) => h > 3.2 && slopeAt(x, z) < 0.75 && clump(x + 300, z) > 0.34, () => 8 + 7 * rnd(), () => { const v = 0.8 + 0.4 * rnd(); return [v, v, v]; });
    plant('palm', F.palm, (x, z, h) => h > 0.9 && h < 3.4 && slopeAt(x, z) < 0.3 && clump(x, z) > 0.3, () => 7 + 4 * rnd(), () => { const v = 0.85 + 0.3 * rnd(); return [v, v, v]; });
    // 灌木：草木少或乾燥的島，有一部分換成草叢
    const tuftShare = clamp01(dryK * 1.3 - 0.15);
    plant('bush', Math.round(F.bush * (1 - tuftShare)), (x, z, h) => h > 1.7 && slopeAt(x, z) < 0.9, () => 0.9 + 1.3 * rnd(), leafTint);
    plant('tuft', Math.round(F.bush * tuftShare * 2.2), (x, z, h) => h > 0.75 && h < 9 && slopeAt(x, z) < 0.7, () => 0.8 + 0.9 * rnd(), () => { const v = 0.8 + 0.4 * rnd(); return [v, v, v * 0.9]; });

    // 岩石：礁岩多的島石頭比較黑、比較大
    const dark = isle.look.rock > 0.8 ? 0.55 : 0.85, big = 0.8 + 0.7 * isle.look.rock;
    const stone = (want, ok, size) => {
      for (let tries = 0, got = 0; got < want && tries < want * 80; tries++) {
        const [x, z, h] = spot();
        if ((clear && clear(x, z)) || !ok(x, z, h)) continue;
        const r = size() * big, sy = 0.7 + 0.5 * rnd(), v = dark * (0.42 + 0.22 * rnd());
        const y = h - r * 0.3 * sy;
        add('rock', x, y, z, r, r * sy, rnd() * 6.2832, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5, [v * 1.04, v, v * 0.95]);
        if (r > 0.55) rocks.push({ x, z, r: r * 0.8, top: y + r * sy * 0.62 });
        if (h < 0.9 && r > 0.55) obstacles.push({ x, z, r: r * 0.75 });
        got++;
      }
    };
    stone(F.shoreRock, (x, z, h) => h > -1.7 && h < 1.0, () => (rnd() < 0.12 ? 1.8 + 1.6 * rnd() : 0.45 + 1.1 * rnd()));
    stone(F.landRock, (x, z, h) => h > 1.4 && (slopeAt(x, z) > 0.3 || rnd() < 0.3), () => 0.4 + 1.2 * rnd());

    // ---- 建立模型 ----
    // 整座島一組簡化版（遠看用），另外把島切成一塊一塊，每塊各有精細版與簡化版（走近了才畫精細的）
    const build = (list, kind, v, lod) => geos[kind][v][lod].map(({ geo, mat }) => {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((o, i) => {
        eul.set(o.tiltX, o.yaw, o.tiltZ);
        q.setFromEuler(eul);
        pos.set(o.x, o.y, o.z); sc.set(o.s, o.sy, o.s);
        m4.compose(pos, q, sc);
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, col.setRGB(o.tint[0], o.tint[1], o.tint[2]));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();   // 整組一起做視野外剔除
      if (Object.values(fol).includes(mat)) mesh.customDepthMaterial = swayDepth(mat);   // 影子跟著樹一起搖
      return mesh;
    });
    const far = new THREE.Group(), nearGrp = new THREE.Group(), chunks = new Map();
    for (const [kind, byVariant] of Object.entries(items)) {
      byVariant.forEach((list, v) => {
        if (!list || !list.length) return;
        far.add(...build(list, kind, v, 'lo'));
        const cells = new Map();
        for (const o of list) {
          const key = Math.floor((o.x - isle.x) / CHUNK) * 64 + Math.floor((o.z - isle.z) / CHUNK);
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(o);
        }
        for (const [key, part] of cells) {
          if (!chunks.has(key)) {
            const c = { hi: new THREE.Group(), lo: new THREE.Group(), x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
            nearGrp.add(c.hi, c.lo);
            chunks.set(key, c);
          }
          const c = chunks.get(key);
          for (const o of part) { c.x0 = Math.min(c.x0, o.x); c.x1 = Math.max(c.x1, o.x); c.z0 = Math.min(c.z0, o.z); c.z1 = Math.max(c.z1, o.z); }
          c.hi.add(...build(part, kind, v, 'hi'));
          c.lo.add(...build(part, kind, v, 'lo'));
        }
      });
    }
    nearGrp.visible = false;
    group.add(far, nearGrp);
    isles.push({ x: isle.x, z: isle.z, R: isle.R, far, near: nearGrp, chunks: [...chunks.values()] });
  });

  // ---- 燈塔：小小一座，立在母港旁的岸上 ----
  const best = heightAt(light.x, light.z);
  const lh = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f0ea });
  const red = new THREE.MeshLambertMaterial({ color: 0xc23b2c });
  // Q 版：矮矮胖胖的塔身、大大的燈室、圓圓的紅屋頂
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 4.3, 19, 20), white);
  tower.position.y = 9.5;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(3.37, 3.71, 4, 20), red);
  band.position.y = 9.5;
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 0.6, 20), new THREE.MeshLambertMaterial({ color: 0x4a3320 }));
  gallery.position.y = 19.2;
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 3.2, 14),
    bulb(0xffe9a8, 0.8));
  lamp.position.y = 21.1;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(2.8, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), red);
  cap.scale.y = 0.85;
  cap.position.y = 22.7;
  lh.add(tower, band, gallery, lamp, cap);
  // 石砌的塔基、門、沿塔身往上的小窗、平台的欄杆、燈室的窗格
  const stone = new THREE.MeshLambertMaterial({ color: 0x8a8580 }), dk = new THREE.MeshLambertMaterial({ color: 0x33291f });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.0, 1.8, 20), stone);
  base.position.y = 0.9;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 1.9), dk);
  door.position.set(-4.0, 2.7, 0);
  lh.add(base, door);
  [[5.0, 2.2], [13.3, 4.1], [16.0, 0.9]].forEach(([y, a]) => {
    const r = 4.3 - (1.6 * y) / 19;
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.3, 0.75), dk);
    win.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    win.rotation.y = -a;
    lh.add(win);
  });
  const rail = new THREE.Mesh(new THREE.TorusGeometry(3.8, 0.08, 6, 24).rotateX(Math.PI / 2), dk);
  rail.position.y = 20.7;
  lh.add(rail);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.2, 0.09), dk);
    p.position.set(Math.cos(a) * 3.8, 20.1, Math.sin(a) * 3.8);
    lh.add(p);
    if (i % 2 === 0) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2, 0.12), dk);
      bar.position.set(Math.cos(a) * 2.12, 21.1, Math.sin(a) * 2.12);
      lh.add(bar);
    }
  }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), red);
  ball.position.y = 25.3;
  lh.add(ball);
  lh.position.set(light.x, best - 0.5, light.z);
  lh.scale.setScalar(0.5);
  group.add(lh);

  // 晚上旋轉的光束：兩道往相反方向照的光
  // 不是一根實心的管子，而是空氣被照亮：
  //   一條沿著光軸的帶子，永遠轉向鏡頭（從哪個角度看都是一道邊緣化開的光）；
  //   從燈口一點點寬出去，越遠越散、越淡，尾端淡到沒有；
  //   光掃到正對鏡頭時，燈本身會閃一下。
  // 只加亮、不動畫面的 alpha（alpha 是「這裡是不是天空」的記號，太陽／月亮的光暈靠它；之前光束把它蓋掉，才會看到一根暗色的管子）
  const BEAM_LEN = 320;
  const beamOpacity = { value: 0 };
  const addLight = {
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  };
  const beamMat = new THREE.ShaderMaterial({
    ...addLight,
    uniforms: { opacity: beamOpacity },
    vertexShader: /* glsl */ `
      attribute float side;
      varying float vU;
      varying float vX;
      varying float vG;
      void main() {
        vec3 P = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 A = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
        vec3 V = cameraPosition - P;
        float dc = length(V);
        vec3 C = cross(A, V / max(dc, 0.001));
        float sn = length(C);                       // 視線跟光軸的夾角（sin）
        float ax = abs(position.x);
        float r = 1.0 + ax * 0.024;                 // 光暈的半徑（亮的芯只佔中間三分之一左右）；燈塔的光幾乎是平行的，散得很慢
        vU = side;
        vX = ax;
        // 斜著看，視線穿過的光比較厚，所以比較亮；幾乎順著光軸看時帶子會扁掉，淡出（交給燈的閃光）
        vG = min(1.0 / max(sn, 0.001), 1.5) * smoothstep(0.0, 0.06, sn) * exp(-dc / 115.0);   // 離鏡頭越遠，被空氣吃掉越多
        gl_Position = projectionMatrix * viewMatrix * vec4(P + C / max(sn, 0.001) * side * r, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float opacity;
      varying float vU;
      varying float vX;
      varying float vG;
      void main() {
        float u2 = vU * vU;
        // 橫切面：中間最厚最亮，往兩邊化開到 0（沒有邊線）
        float prof = 0.55 * pow(max(1.0 - u2, 0.0), 3.0) + 0.45 * exp(-u2 * 16.0);   // 外面一圈淡淡的暈，中間一道比較亮的芯
        // 沿著光軸：越遠光越散，尾端淡到沒有
        float along = 1.0 / (1.0 + vX / 30.0) * smoothstep(${BEAM_LEN.toFixed(1)}, ${(BEAM_LEN * 0.25).toFixed(1)}, vX);
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.72) * prof * along * vG * opacity, 1.0);
      }`,
  });
  const beamGeo = new THREE.BufferGeometry();
  {
    const N = 22, pos = [], side = [], idx = [];
    for (let i = -N; i <= N; i++) {
      const x = Math.sign(i) * BEAM_LEN * Math.pow(Math.abs(i) / N, 1.7);   // 靠近燈塔切得比較細
      pos.push(x, 0, 0, x, 0, 0);
      side.push(1, -1);
      if (i < N) { const a = (i + N) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    beamGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    beamGeo.setAttribute('side', new THREE.Float32BufferAttribute(side, 1));
    beamGeo.setIndex(idx);
  }
  // 燈的光點：平常是一小團暖光；光束掃到正對鏡頭時閃一下、變大（遠遠看燈塔就是這樣一閃一閃的）
  const flareMat = new THREE.ShaderMaterial({
    ...addLight,
    uniforms: { opacity: beamOpacity },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      varying float vF;
      void main() {
        vec3 Cw = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 A = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
        vec3 V = cameraPosition - Cw;
        float d = length(V);
        // 只看水平方向對不對得上（燈的透鏡上下會散開一點），站在燈塔腳下附近也看得到閃光
        vF = pow(abs(dot(normalize(A.xz), normalize(V.xz + vec2(0.0001)))), 110.0) * smoothstep(0.85, 0.35, abs(V.y) / max(d, 0.001));
        float size = (1.1 + 0.014 * d) * (1.0 + 1.1 * vF);
        vec4 mv = viewMatrix * vec4(Cw, 1.0);
        mv.xyz += normalize(-mv.xyz) * 1.5;         // 往鏡頭靠一點，不要被燈室擋住
        mv.xy += position.xy * size;
        vP = position.xy;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float opacity;
      varying vec2 vP;
      varying float vF;
      void main() {
        float r2 = dot(vP, vP);
        float g = (exp(-r2 * 9.0) + 0.3 * exp(-r2 * 2.2)) * smoothstep(1.0, 0.6, sqrt(r2));
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.72) * g * opacity * (0.9 + 2.2 * vF), 1.0);
      }`,
  });
  const beam = new THREE.Group();
  const ribbon = new THREE.Mesh(beamGeo, beamMat), flare = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), flareMat);
  ribbon.frustumCulled = flare.frustumCulled = false;   // 頂點在 shader 裡才展開，包圍球不準
  ribbon.renderOrder = flare.renderOrder = 5;
  beam.add(ribbon, flare);
  beam.position.set(light.x, best - 0.5 + 10.55, light.z);
  beam.visible = false;
  group.add(beam);

  // 依鏡頭位置決定畫什麼：
  //   已經在霧裡的島（約 800 公尺外）不畫；遠的島整座畫簡化版；
  //   所在的島分區處理，鏡頭附近幾十公尺畫精細版，其餘畫簡化版。
  // simple = true（畫水面倒影時）一律用簡化版
  function update(cam, simple = false, far = 820) {
    for (const o of isles) {
      const d = Math.hypot(cam.x - o.x, cam.z - o.z) - o.R;
      const close = d < 230 && !simple;
      o.far.visible = !close && d < far;
      o.near.visible = close;
      if (!close) continue;
      for (const c of o.chunks) {
        const dx = Math.max(c.x0 - cam.x, 0, cam.x - c.x1), dz = Math.max(c.z0 - cam.z, 0, cam.z - c.z1);
        const fine = dx * dx + dz * dz < FINE * FINE;
        c.hi.visible = fine;
        c.lo.visible = !fine;
      }
    }
  }

  return { group, lighthouse: lh.position.clone(), lighthouseMesh: lh, beam, beamMat, rocks, obstacles, update, isles };
}
