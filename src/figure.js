// 人物：Q 版低多邊形水手服少女。造型和貼圖是 Tripo AI 依角色設定圖生成的，
// 用 tools/tripo_figure.py（Blender）整理成 public/models/girl.glb：轉成遊戲座標、綁骨架、把貼圖上的五官抹掉、另外做一層貼著臉的薄片放表情。
// 座標：+X 前方、+Y 向上、+Z 右側；原點在兩腳中間的地面，身高 1.62。
// 關節跟以前程式拼的人物一樣（遊戲其他地方只轉這幾個關節）：legs（髖關節）、upper（腰）、head（脖子）、arms（肩膀）。
// 模型的手是 A 字張開的；手臂的關節底下再掛一根骨頭先把手轉回垂直，所以關節轉 0 就是手直直垂下，跟以前一樣。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 關節位置（要跟 tools/tripo_figure.py 裡的一致：權重是照這些位置分的）
const HIP_Y = 0.486, HIP_Z = 0.151, WAIST_Y = 0.76, NECK_Y = 0.97;
const SHOULDER_Y = 0.923, SHOULDER_Z = 0.219, HAND_Y = 0.6, HAND_Z = 0.373;
const A_POSE = Math.atan2(HAND_Z - SHOULDER_Z, SHOULDER_Y - HAND_Y);   // 模型的手往外張開幾度
export const ARM_LEN = Math.hypot(HAND_Z - SHOULDER_Z, SHOULDER_Y - HAND_Y) + 0.02;   // 肩膀到握東西的位置；握舵時用它算手臂要拉長多少

// 網址加 ?boy 換成男版（開發測試用；之後換角色／換裝再做正式的選擇）
const MODEL = new URLSearchParams(location.search).has('boy') ? 'boy' : 'girl';
const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/${MODEL}.glb`);
const SRC = {};
gltf.scene.traverse((m) => { if (m.isSkinnedMesh) SRC[m.name.startsWith('face') ? 'face' : 'body'] = m; });

// ---- 像素雜點：每個面依它最朝向的軸，把物件自己的座標切成邊長 TEXEL 的方格，每格隨機亮一點或暗一點 ----
const TEXEL = 0.035;   // 方格大一點、明暗差多一點，才看得出一格一格的色塊
// 人物的記號：畫面的 alpha 寫成 2.4，環境光遮蔽（ao.js）看到就只套一點點。
// Q 版的臉被瀏海、側髮包在裡面，遮蔽會在額頭和臉頰兩旁壓出一片灰灰的雜點，像臉很髒
const FIG_ALPHA = 2.4;
function figFlag(sh) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
	gl_FragColor.a = ${FIG_ALPHA.toFixed(1)};`);
}

function pixelMat(color, { amp = 0.09, ...extra } = {}) {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vPix;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvPix = position;');
    sh.fragmentShader = 'varying vec3 vPix;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
	{
		vec3 fa = abs( cross( dFdx( vPix ), dFdy( vPix ) ) );
		vec3 c = floor( vPix / ${TEXEL.toFixed(4)} );
		vec2 g = fa.x > fa.y && fa.x > fa.z ? c.yz + 17.0 : ( fa.y > fa.z ? c.xz + 41.0 : c.xy + 83.0 );
		float h = fract( sin( dot( g, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
		diffuseColor.rgb *= 1.0 + ( h - 0.5 ) * ${amp.toFixed(3)};
	}`);
    figFlag(sh);
  };
  m.customProgramCacheKey = () => 'pix' + amp;
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
  const smallO = () => { px(LIP, 54, 96, 3, 1); px(LIP, 53, 97, 1, 2); px(LIP, 57, 97, 1, 2); px(LIP, 54, 99, 3, 1); px('#c46e56', 54, 97, 3, 2); };
  const smileMouth = () => { px(LIP, 51, 95, 1, 1); px(LIP, 52, 96, 1, 1); px(LIP, 53, 97, 5, 1); px(LIP, 58, 96, 1, 1); px(LIP, 59, 95, 1, 1); };
  const openSmile = () => { px(LIP, 51, 95, 9, 1); px(MOUTH, 52, 96, 7, 3); px(LIP, 51, 96, 1, 2); px(LIP, 59, 96, 1, 2); px(LIP, 52, 98, 1, 1); px(LIP, 58, 98, 1, 1); px(LIP, 53, 99, 5, 1); px('#e07a6a', 54, 97, 3, 1); };
  switch (id) {
    case 'happy':     happyEye(20); happyEye(76); brows(2); openSmile(); break;
    case 'surprised': eyeOpen(20, 56); eyeOpen(76, 56); brows(5);
      px(LIP, 54, 95, 3, 1); px(LIP, 53, 96, 1, 4); px(LIP, 57, 96, 1, 4); px(LIP, 54, 100, 3, 1); px(MOUTH, 54, 96, 3, 4); break;
    case 'thinking':  eyeOpen(22, 63); eyeOpen(78, 63); brows(0, 0, 1); brows(4, -2, -1); px(LIP, 55, 98, 5, 1); break;
    case 'closed':    closedEye(20); closedEye(76); brows(); smileMouth(); break;
    case 'smile':     eyeOpen(20); eyeOpen(76); brows(1); smileMouth(); break;
    case 'cry':
      squeeze(20, 1); squeeze(76, -1); brows(0, 4);
      for (const x of [24, 82]) { px('#8fd0f5', x, 80, 4, 26); px('#c8ecff', x + 1, 82, 1, 20); }   // 兩道淚
      px(LIP, 52, 97, 7, 1); px(MOUTH, 52, 98, 7, 2); px(LIP, 51, 98, 1, 2); px(LIP, 59, 98, 1, 2); px(LIP, 52, 100, 7, 1); break;
    case 'wink':      eyeOpen(20); squeeze(76, -1); brows(1); openSmile(); break;
    default:          eyeOpen(20); eyeOpen(76); brows(); smallO();
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return (faceTex[id] = t);
}

export function buildFigure() {
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
  const face = new THREE.MeshLambertMaterial({ map: faceTexture(), alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });   // 鏤空靠 alphaTest，不用半透明混色（alpha 要拿來當記號）
  face.onBeforeCompile = figFlag;
  face.customProgramCacheKey = () => 'figface';
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
  // 掌舵的第一人稱只看得到兩隻手臂：另外做一份只有手臂那些面的網格，平常藏著
  const armsOnly = new THREE.SkinnedMesh(armGeometry(), bodyMat);
  armsOnly.bind(body.skeleton, new THREE.Matrix4());
  armsOnly.visible = false;
  g.add(armsOnly);
  armBones.forEach((b, i) => { b.rotation.x = arms[i].userData.side * A_POSE; });   // 往身體收回 A 字的角度

  g.traverse((m) => { if (m.isMesh) m.userData.figure = true; });
  // fpHide：掌舵的第一人稱要藏起來的；fpShow：那時才顯示的（只有手臂）；mats：這個人用到的所有材質
  // setFace：換表情（FACES 裡的一個）
  const setFace = (id) => { const t = faceTexture(FACES.includes(id) ? id : 'normal'); if (face.map !== t) face.map = t; };
  g.userData = { legs, arms, head, upper, setFace, fpHide: [body, faceMesh], fpShow: [armsOnly], torso: [], mats: [bodyMat, face] };
  return g;
}

// 只有手臂的那些三角形（三個頂點都主要跟著手臂骨頭的）
let armGeo = null;
function armGeometry() {
  if (armGeo) return armGeo;
  const src = SRC.body.geometry, idx = src.index.array, si = src.attributes.skinIndex, sw = src.attributes.skinWeight;
  const names = SRC.body.skeleton.bones.map((b) => b.name);
  const isArm = (v) => { let best = 0, bw = -1; for (let k = 0; k < 4; k++) if (sw.getComponent(v, k) > bw) { bw = sw.getComponent(v, k); best = si.getComponent(v, k); } return names[best].startsWith('arm'); };
  const out = [];
  for (let i = 0; i < idx.length; i += 3) if (isArm(idx[i]) && isArm(idx[i + 1]) && isArm(idx[i + 2])) out.push(idx[i], idx[i + 1], idx[i + 2]);
  armGeo = src.clone();
  armGeo.setIndex(out);
  return armGeo;
}
