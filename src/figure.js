// 人物：Q 版低多邊形水手服少女。造型和貼圖是 Tripo AI 依角色設定圖生成的，
// 用 tools/tripo_figure.py（Blender）整理成 public/models/girl.glb：轉成遊戲座標、綁骨架、把貼圖上的五官抹掉、另外做一層貼著臉的薄片放表情。
// 座標：+X 前方、+Y 向上、+Z 右側；原點在兩腳中間的地面，身高 1.62。
// 關節跟以前程式拼的人物一樣（遊戲其他地方只轉這幾個關節）：legs（髖關節）、upper（腰）、head（脖子）、arms（肩膀）。
// 模型的手是 A 字張開的；手臂的關節底下再掛一根骨頭先把手轉回垂直，所以關節轉 0 就是手直直垂下，跟以前一樣。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addOutline } from './toon.js';
import { LOOKS, myLook } from './look.js';
export { LOOKS, myLook };

// 角色：女版（girl）、男版（boy）兩個模型都先載進來；每個人用哪個看他選的（自己的見 look.js，別人的伺服器轉過來）
const loader = new GLTFLoader();
const MODELS = {};
await Promise.all(LOOKS.map(async (look) => {
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${look}.glb`);
  const SRC = {};
  // 關節位置：男女版比例不同，各自存在模型裡（tools/tripo_figure.py 寫進骨架的 extras.joints；權重是照這些位置分的）
  let J = null;
  gltf.scene.traverse((m) => { if (m.userData.joints) J = m.userData.joints; });
  J ??= { NECK: 0.97, SHOULDER: 0.923, SHOULDER_Z: 0.219, WAIST: 0.76, HIP: 0.486, HIP_Z: 0.151, HAND: 0.6, HAND_Z: 0.373 };
  gltf.scene.traverse((m) => { if (m.isSkinnedMesh) SRC[m.name.startsWith('face') ? 'face' : 'body'] = m; });
  // 頂點顏色的紅色 = 這裡用平滑著色（頭部的膚色；見 tools/tripo_figure.py）。拿出來改成 smoothK，顏色本身不用
  const geo = SRC.body.geometry, col = geo.getAttribute('color');
  const k = new Float32Array(geo.getAttribute('position').count);
  if (col) for (let i = 0; i < k.length; i++) k[i] = col.getX(i);
  geo.setAttribute('smoothK', new THREE.BufferAttribute(k, 1));
  geo.deleteAttribute('color');
  MODELS[look] = {
    SRC, J,
    A_POSE: Math.atan2(J.HAND_Z - J.SHOULDER_Z, J.SHOULDER - J.HAND),   // 模型的手往外張開幾度
    ARM_LEN: Math.hypot(J.HAND_Z - J.SHOULDER_Z, J.SHOULDER - J.HAND) + 0.02,   // 肩膀到握東西的位置；握舵時用它算手臂要拉長多少
    armGeo: null,
  };
}));

// ---- 像素雜點：每個面依它最朝向的軸，把物件自己的座標切成邊長 TEXEL 的方格，每格隨機亮一點或暗一點 ----
const TEXEL = 0.035;   // 方格大一點、明暗差多一點，才看得出一格一格的色塊
// 人物的記號：畫面的 alpha 寫成 2.4，環境光遮蔽（ao.js）看到就只套一點點。
// Q 版的臉被瀏海、側髮包在裡面，遮蔽會在額頭和臉頰兩旁壓出一片灰灰的雜點，像臉很髒
const FIG_ALPHA = 2.4;
function figFlag(sh) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
	gl_FragColor.a = ${FIG_ALPHA.toFixed(1)};`);
}

// 臉（k = 1 的地方）的打光：
//   明暗過渡放寬、背光面不壓那麼暗：卡通打光的交界很短，落在臉頰上時會沿著大三角形的邊切出一塊階梯狀的暗區，像黑漬
//   影子只吃四成：瀏海投在臉上的影子形狀碎、邊緣糊，也像黑漬；整個人站到屋簷下時臉還是會跟著暗一點
function softFace(sh, k) {
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <lights_lambert_pars_fragment>', THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
      'smoothstep( -0.04, 0.26, rawNL )', `mix( smoothstep( -0.04, 0.26, rawNL ), 0.62 + 0.38 * smoothstep( -0.5, 0.6, rawNL ), ${k} )`))
    .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
      /directLight\.color \*= (\( directLight\.visible[^;]*);/g, `directLight.color *= mix( ( $1 ), 1.0, 0.6 * ${k} );`));
}

// 著色：平常是平面著色（每個面一個亮度，看得到稜角）；頂點有 smoothK 的地方（頭部膚色）漸漸換成平滑的法線，
// 不然臉在側光下一格一格的很明顯
function pixelMat(color, { amp = 0.09, ...extra } = {}) {
  const m = new THREE.MeshLambertMaterial({ color, ...extra });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float smoothK;\nvarying float vSmooth;\nvarying vec3 vPix;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvPix = position;\n\tvSmooth = smoothK;');
    sh.fragmentShader = 'varying float vSmooth;\nvarying vec3 vPix;\n' + sh.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
	{
		vec3 flatN = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
		normal = normalize( mix( flatN, normal, vSmooth ) );
	}`).replace('#include <color_fragment>', `#include <color_fragment>
	{
		vec3 fa = abs( cross( dFdx( vPix ), dFdy( vPix ) ) );
		vec3 c = floor( vPix / ${TEXEL.toFixed(4)} );
		vec2 g = fa.x > fa.y && fa.x > fa.z ? c.yz + 17.0 : ( fa.y > fa.z ? c.xz + 41.0 : c.xy + 83.0 );
		float h = fract( sin( dot( g, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
		diffuseColor.rgb *= 1.0 + ( h - 0.5 ) * ${amp.toFixed(3)} * ( 1.0 - 0.8 * vSmooth );   // 臉上（平滑著色的地方）雜點淡一點，不然一格一格的
	}`);
    softFace(sh, 'vSmooth');
    figFlag(sh);
  };
  m.customProgramCacheKey = () => 'pix4' + amp;
  return m;
}

// ---- 臉：一張 110×110 的小圖（一格 4 公釐），貼在臉的正前方，放大時不做平滑 ----
// 圖的左邊是人物的右手邊（+Z）；貼在模型臉上的那層薄片（模型裡的 face）的 UV 已經對好這張圖（眼睛的位置、大小）。
// 八種表情各一張（角色設定圖上那組）：普通、開心、驚訝、思考、閉眼、微笑、哭泣、眨眼
export const FACES = ['normal', 'happy', 'surprised', 'thinking', 'closed', 'smile', 'cry', 'wink'];
const faceTex = {};
function faceTexture(id = 'normal') {
  if (faceTex[id]) return faceTex[id];
  const cv = document.createElement('canvas');
  cv.width = 110; cv.height = 110;
  const g = cv.getContext('2d');
  const px = (c, x, y, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const EYE = '#362824', LINE = '#3a2622', BROW = '#5a3a2c', LIP = '#9c4a3a', MOUTH = '#c4524a';
  // 腮紅：眼睛外下方一小塊，邊緣淡一點（跟膚色混過，不用半透明）
  for (const x0 of [13, 84]) {
    px('#f6ae8e', x0, 84, 13, 11);
    px('#f6a085', x0 + 1, 85, 11, 9);
    px('#f59a80', x0 + 2, 86, 9, 7);
  }
  // 眼睛（x0 是左緣，寬 14、高 56–84）
  // 張開的眼睛：16 格寬、從 top 到 85 列的深色長方塊（四角各缺一格），下緣一條稍亮的；中心跟其他表情的眼睛對齊（x0 + 7）
  const eyeOpen = (x0, top = 59) => { const a = x0 - 1; px(EYE, a + 1, top, 14, 85 - top); px(EYE, a, top + 1, 16, 83 - top); px('#3d2b26', a + 2, 79, 12, 4); };
  const arc = (x0, f, w = 3) => { for (let i = 0; i < 14; i++) px(LINE, x0 + i, f(Math.abs(i - 6.5)), 1, w); };
  const happyEye = (x0) => arc(x0, (d) => 64 + Math.round(d * 0.9));            // ^
  const closedEye = (x0) => arc(x0, (d) => 77 - Math.round(d * 0.55), 2);       // ‿（往下彎的一條）
  const squeeze = (x0, dir) => {                                                 // > 或 <（用力閉著）
    for (let i = 0; i < 9; i++) { const x = dir > 0 ? x0 + 2 + i : x0 + 11 - i; px(LINE, x, 62 + i, 2, 2); px(LINE, x, 78 - i, 2, 2); }
  };
  // 眉毛（左眼的從外到內、右眼的從內到外）；lift：整條往上幾格；tilt：內側往上幾格
  const brows = (lift = 0, tilt = 0, only = 0) => {
    if (only >= 0) for (let i = 0; i < 18; i++) px(BROW, 13 + i, 47 - lift - (i < 4 ? -1 : 0) - Math.round(tilt * i / 17), 1, 2);
    if (only <= 0) for (let i = 0; i < 18; i++) px(BROW, 79 + i, 47 - lift - (i > 13 ? -1 : 0) - Math.round(tilt * (17 - i) / 17), 1, 2);
  };
  // 嘴：M 是嘴的上緣那一列。新的模型下巴短，嘴太低會落在下巴轉彎的地方被拉歪，所以比眼睛低 3 公分多一點就好
  const M = 91;
  // 普通的小嘴：輪廓清楚的小圓口（太小、顏色太暗的話遠看像一點髒污）
  const smallO = () => { px(LIP, 54, M, 4, 1); px(LIP, 53, M + 1, 1, 3); px(LIP, 58, M + 1, 1, 3); px(LIP, 54, M + 4, 4, 1); px('#a8463a', 54, M + 1, 4, 2); px('#e2857a', 54, M + 3, 4, 1); };
  const smileMouth = () => { px(LIP, 50, M, 1, 1); px(LIP, 51, M + 1, 1, 1); px(LIP, 52, M + 2, 7, 1); px(LIP, 59, M + 1, 1, 1); px(LIP, 60, M, 1, 1); };
  const openSmile = () => { px(LIP, 51, M, 9, 1); px(MOUTH, 52, M + 1, 7, 3); px(LIP, 51, M + 1, 1, 2); px(LIP, 59, M + 1, 1, 2); px(LIP, 52, M + 3, 1, 1); px(LIP, 58, M + 3, 1, 1); px(LIP, 53, M + 4, 5, 1); px('#e07a6a', 54, M + 3, 3, 1); };
  switch (id) {
    case 'happy':     happyEye(20); happyEye(76); brows(2); openSmile(); break;
    case 'surprised': eyeOpen(20, 56); eyeOpen(76, 56); brows(5);
      px(LIP, 54, M, 4, 1); px(LIP, 53, M + 1, 1, 5); px(LIP, 58, M + 1, 1, 5); px(LIP, 54, M + 6, 4, 1); px('#a8463a', 54, M + 1, 4, 5); break;
    case 'thinking':  eyeOpen(22, 63); eyeOpen(78, 63); brows(0, 0, 1); brows(4, -2, -1); px(LIP, 55, M + 2, 6, 1); break;
    case 'closed':    closedEye(20); closedEye(76); brows(); smileMouth(); break;
    case 'smile':     eyeOpen(20); eyeOpen(76); brows(1); smileMouth(); break;
    case 'cry':
      squeeze(20, 1); squeeze(76, -1); brows(0, 4);
      for (const x of [24, 82]) { px('#8fd0f5', x, 80, 4, 26); px('#c8ecff', x + 1, 82, 1, 20); }   // 兩道淚
      px(LIP, 52, M + 1, 7, 1); px(MOUTH, 52, M + 2, 7, 2); px(LIP, 51, M + 2, 1, 2); px(LIP, 59, M + 2, 1, 2); px(LIP, 52, M + 4, 7, 1); break;
    case 'wink':      eyeOpen(20); squeeze(76, -1); brows(1); openSmile(); break;
    default:          eyeOpen(20); eyeOpen(76); brows(); smallO();
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return (faceTex[id] = t);
}

export function buildFigure(look = myLook()) {
  if (!MODELS[look]) look = 'girl';
  const M = MODELS[look], SRC = M.SRC, J = M.J;
  const HIP_Y = J.HIP, HIP_Z = J.HIP_Z, WAIST_Y = J.WAIST, NECK_Y = J.NECK;
  const SHOULDER_Y = J.SHOULDER, SHOULDER_Z = J.SHOULDER_Z, HAND_Y = J.HAND, HAND_Z = J.HAND_Z;
  const g = new THREE.Group();
  const bone = (parent, x, y, z) => { const b = new THREE.Bone(); b.position.set(x, y, z); parent.add(b); return b; };
  // 骨頭（都是轉角 0 的；位置 = 關節在父關節裡的位置）
  const root = bone(g, 0, 0, 0);                                   // 裙子跟著它（不跟腿擺）
  const upper = bone(g, 0, WAIST_Y, 0);                            // 腰
  const head = bone(upper, 0, NECK_Y - WAIST_Y, 0);                // 脖子
  const legs = [-1, 1].map((s) => bone(g, 0, HIP_Y, s * HIP_Z));
  const armBones = [];
  const arms = [-1, 1].map((s) => {
    const joint = bone(upper, 0, SHOULDER_Y - WAIST_Y, s * SHOULDER_Z);
    const b = bone(joint, 0, 0, 0);                                // 把 A 字張開的手轉回垂直的那根
    armBones.push(b);
    const grip = new THREE.Object3D();                             // 手心：拿東西（釣竿）的位置
    grip.position.set(0, HAND_Y - SHOULDER_Y - 0.02, s * (HAND_Z - SHOULDER_Z));
    b.add(grip);
    joint.userData = {
      side: s, grip, base: new THREE.Vector3(0, SHOULDER_Y, s * SHOULDER_Z),
      stretch: (k) => { joint.scale.y = k; },                     // 握舵時手臂要伸長才搆得到
    };
    return joint;
  });
  // Blender 裡的骨頭名字 → 這裡的骨頭（Blender 的 .L 是人物的左邊 = 遊戲的 -Z）
  // （GLTFLoader 會把名字裡的「.」拿掉，所以比對時只看英數字）
  const byName = { root, upper, head, legL: legs[0], legR: legs[1], armL: armBones[0], armR: armBones[1] };
  const key = (n) => n.replace(/[^A-Za-z0-9]/g, '');

  const bodyMat = pixelMat(0xffffff, { map: SRC.body.material.map, amp: 0.1 });
  // 畫影子時正反面都算：three.js 預設只用背面畫影子，但這個模型是 Tripo 零件拼起來的，裙子、頭髮、零件接縫都是單層的面，
  // 從太陽那邊看過去只有正面的地方影子就整塊不見（裙子出不來、肚子破洞、腳底透光）
  bodyMat.shadowSide = THREE.DoubleSide;
  const face = new THREE.MeshLambertMaterial({ map: faceTexture(), alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });   // 鏤空靠 alphaTest，不用半透明混色（alpha 要拿來當記號）
  face.onBeforeCompile = (sh) => { figFlag(sh); softFace(sh, '1.0'); };   // 表情薄片貼在臉上，打光要跟臉一樣，不然腮紅裡會切出一塊暗三角
  face.customProgramCacheKey = () => 'figface2';
  // 綁定：在模型原本的姿勢（手 A 字張開）下算好每根骨頭的反矩陣，綁好以後再把手轉回垂直
  g.updateMatrixWorld(true);
  const skin = (src, mat) => {
    const m = new THREE.SkinnedMesh(src.geometry, mat);
    m.bind(new THREE.Skeleton(src.skeleton.bones.map((b) => byName[key(b.name)])), new THREE.Matrix4());
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const body = skin(SRC.body, bodyMat);
  const faceMesh = skin(SRC.face, face);
  faceMesh.castShadow = false;   // 貼在臉前面 3 公釐的薄片：投影的話會在臉上印出一片斑點
  faceMesh.userData.noCast = true;
  faceMesh.userData.noHull = true;   // 薄片的描邊從正面看不到，不用多畫一次
  // 掌舵的第一人稱只看得到兩隻手臂：另外做一份只有手臂那些面的網格，平常藏著
  const armsOnly = new THREE.SkinnedMesh(armGeometry(M), bodyMat);
  armsOnly.bind(body.skeleton, new THREE.Matrix4());
  armsOnly.visible = false;
  g.add(armsOnly);
  armBones.forEach((b, i) => { b.rotation.x = arms[i].userData.side * M.A_POSE; });   // 往身體收回 A 字的角度

  g.traverse((m) => { if (m.isMesh) m.userData.figure = true; });
  for (const c of g.children) c.userData.figPart = true;   // 人偶本身的骨頭和網格（restyle 換角色時只拿掉這些，別人掛上去的釣竿、魚不動）
  // fpHide：掌舵的第一人稱要藏起來的；fpShow：那時才顯示的（只有手臂）；mats：這個人用到的所有材質
  // setFace：換表情（FACES 裡的一個）
  const setFace = (id) => { const t = faceTexture(FACES.includes(id) ? id : 'normal'); if (face.map !== t) face.map = t; };
  // look：哪個角色；armLen：肩膀到手心多長（握舵時算手臂要拉長多少）
  g.userData = { look, armLen: M.ARM_LEN, legs, arms, head, upper, setFace, fpHide: [body, faceMesh], fpShow: [armsOnly], torso: [], mats: [bodyMat, face] };
  return g;
}

// 把已經放在場景裡的人偶換成另一個角色（同一個 Group，位置、掛在上面的東西都不變）。
// 原本有描邊、有接影子的話，新的也照樣弄好
export function restyle(g, look) {
  if (g.userData.look === look) return;
  const n = buildFigure(look);
  const old = g.children.filter((c) => c.userData.figPart);
  let hull = false, recv = false;
  for (const c of old) c.traverse((m) => { if (m.userData.hull) hull = true; else if (m.isMesh && m.receiveShadow) recv = true; });
  const fp = g.userData.fpShow?.[0]?.visible;   // 正在掌舵的第一人稱（只顯示手臂）
  for (const c of old) g.remove(c);
  for (const mat of g.userData.mats || []) mat.dispose();
  for (const c of [...n.children]) g.add(c);
  Object.assign(g.userData, n.userData);
  if (fp) { for (const m of g.userData.fpHide) m.visible = false; for (const m of g.userData.fpShow) m.visible = true; }
  if (recv) g.traverse((m) => { if (m.isMesh && !m.userData.hull) m.receiveShadow = true; });
  if (hull) addOutline(g);
}

// 只有手臂的那些三角形（三個頂點都主要跟著手臂骨頭的）
function armGeometry(M) {
  if (M.armGeo) return M.armGeo;
  const SRC = M.SRC, src = SRC.body.geometry, idx = src.index.array, si = src.attributes.skinIndex, sw = src.attributes.skinWeight;
  const names = SRC.body.skeleton.bones.map((b) => b.name);
  const isArm = (v) => { let best = 0, bw = -1; for (let k = 0; k < 4; k++) if (sw.getComponent(v, k) > bw) { bw = sw.getComponent(v, k); best = si.getComponent(v, k); } return names[best].startsWith('arm'); };
  const out = [];
  for (let i = 0; i < idx.length; i += 3) if (isArm(idx[i]) && isArm(idx[i + 1]) && isArm(idx[i + 2])) out.push(idx[i], idx[i + 1], idx[i + 2]);
  M.armGeo = capHoles(src, out);
  return M.armGeo;
}

// 只挑出手臂的面，肩膀那端是開口：低頭看會看到空心的管子。把開口封起來——
// 只被一個三角形用到的邊就是開口的邊，串成一圈一圈；每圈複製一份頂點（蒙皮權重照原本的，跟著手臂動），
// uv 全用這圈第一點的（封口一個顏色，不會拉到貼圖別處），法線用整圈算（Newell），扇形三角補起來，繞向跟原本共用那條邊的三角形相反
function capHoles(src, tris) {
  const geo = src.clone();
  const pos = geo.attributes.position, key = (a, b) => a + ',' + b;
  // 同一個位置可能有好幾個頂點（uv 接縫）：先把位置一樣的併成同一個編號再找邊
  const weld = new Map(), id = new Int32Array(pos.count);
  for (let v = 0; v < pos.count; v++) {
    const k = `${pos.getX(v).toFixed(5)},${pos.getY(v).toFixed(5)},${pos.getZ(v).toFixed(5)}`;
    if (!weld.has(k)) weld.set(k, v);
    id[v] = weld.get(k);
  }
  const edges = new Map();   // 有向邊 a→b（合併後的編號）
  for (let i = 0; i < tris.length; i += 3) for (let j = 0; j < 3; j++) { const a = id[tris[i + j]], b = id[tris[i + (j + 1) % 3]]; edges.set(key(a, b), [a, b]); }
  const next = new Map();   // 開口的邊：反方向那條不存在。封口要反著走：b→a
  for (const [a, b] of edges.values()) if (!edges.has(key(b, a))) next.set(b, a);
  const attrs = Object.keys(geo.attributes), data = Object.fromEntries(attrs.map((n) => [n, Array.from(geo.attributes[n].array)]));
  const add = (v, nrm, uvFrom) => {
    const n = data.position.length / 3;
    for (const a of attrs) {
      const sz = geo.attributes[a].itemSize, from = a === 'uv' ? uvFrom : a === 'normal' ? -1 : v;
      for (let k = 0; k < sz; k++) data[a].push(from < 0 ? nrm[k] : geo.attributes[a].array[from * sz + k]);
    }
    return n;
  };
  const out = tris.slice(), seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    for (let v = start; v !== undefined && !seen.has(v); v = next.get(v)) { seen.add(v); loop.push(v); }
    if (loop.length < 3 || next.get(loop[loop.length - 1]) !== start) continue;   // 沒繞回來就不是完整的一圈
    const nrm = [0, 0, 0], c = [0, 0, 0];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      nrm[0] += (pos.getY(a) - pos.getY(b)) * (pos.getZ(a) + pos.getZ(b));
      nrm[1] += (pos.getZ(a) - pos.getZ(b)) * (pos.getX(a) + pos.getX(b));
      nrm[2] += (pos.getX(a) - pos.getX(b)) * (pos.getY(a) + pos.getY(b));
      c[0] += pos.getX(a); c[1] += pos.getY(a); c[2] += pos.getZ(a);
    }
    const l = Math.hypot(...nrm) || 1;
    for (let k = 0; k < 3; k++) nrm[k] /= l;
    const vs = loop.map((v) => add(v, nrm, loop[0]));
    // 中心點：位置是平均、其他照第一點
    const ci = add(loop[0], nrm, loop[0]);
    for (let k = 0; k < 3; k++) data.position[ci * 3 + k] = c[k] / loop.length;
    for (let i = 0; i < vs.length; i++) out.push(vs[i], vs[(i + 1) % vs.length], ci);
  }
  for (const a of attrs) { const A = geo.attributes[a]; geo.setAttribute(a, new THREE.BufferAttribute(new A.array.constructor(data[a]), A.itemSize, A.normalized)); }
  geo.setIndex(out);
  geo.userData.caps = seen.size;
  return geo;
}
