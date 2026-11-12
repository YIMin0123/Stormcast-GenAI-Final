// 人物：低多邊形的 Q 版水手服少女（早期 3D 主機的味道），照角色設定的四視圖做。
// 座標：+X 前方、+Y 向上、+Z 右側；原點在兩腳中間的地面。全身高約 1.62 公尺，頭（連頭髮）約佔三分之一多一點。
// 每一塊都是稜角分明的凸多面體，一個面一個顏色；表面再疊一層一格一格的明暗雜點（像素貼圖的感覺），
// 眼睛、眉毛、腮紅、嘴畫在臉前面的一張小圖上。
// 四肢各自掛在關節上（肩膀、髖部、脖子），走路、坐下、握舵時轉動關節即可。
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const ARM_LEN = 0.27;   // 肩膀到握東西的位置（整條手臂再長 0.03）；握舵時用它算手臂要拉長多少
const SHOULDER_Y = 0.85, SHOULDER_Z = 0.165, HIP_Y = 0.44, HIP_Z = 0.1, NECK_Y = 1.0;

// ---- 像素雜點：每個面依它最朝向的軸，把物件自己的座標切成邊長 TEXEL 的方格，每格隨機亮一點或暗一點 ----
const TEXEL = 0.022;
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
  };
  m.customProgramCacheKey = () => 'pix' + amp;
  return m;
}

// 把一堆點包起來的凸多面體。法線取相鄰面的平均（描邊是沿法線往外推的，這樣輪廓線才不會在稜角上裂開），
// 表面的明暗則由材質的 flatShading 一個面一個面算
function solid(points, mat) {
  let geo = new ConvexGeometry(points.map((p) => new THREE.Vector3(...p)));
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-4);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}
// 一圈八個點（切了角的長方形）：高度 y、前後 x0–x1、左右半寬 hz、切角 c
const ring = (y, x0, x1, hz, c) => [[x0, y, hz - c], [x0, y, c - hz], [x1, y, hz - c], [x1, y, c - hz], [x0 + c, y, hz], [x0 + c, y, -hz], [x1 - c, y, hz], [x1 - c, y, -hz]];
// 一圈橢圓形排列的點：高度 y、中心的前後位置 cx、前後半徑 rx、左右半徑 rz
const oval = (y, cx, rx, rz, n = 10) => Array.from({ length: n }, (_, i) => { const a = (i + 0.5) / n * Math.PI * 2; return [cx + rx * Math.cos(a), y, rz * Math.sin(a)]; });
// 八角柱（切了角的方柱）：上端在 y0、下端在 y1，半寬 r0 → r1，前後中心 cx、左右中心 cz
const oct = (y0, y1, r0, r1, cx = 0, cz = 0) => [...ring(y0, cx - r0, cx + r0, r0, r0 * 0.42), ...ring(y1, cx - r1, cx + r1, r1, r1 * 0.42)].map(([x, y, z]) => [x, y, z + cz]);
// 一撮尖尖的頭髮：根部是一塊四邊形，尾端收成一個尖（前後兩點，back 是尖端的前後厚度）
const tuft = (root, tip, back = 0.03) => [...root, tip, [tip[0] - back, tip[1], tip[2]]];
// 一撮會彎的頭髮：根部 → 中段（縮成 k 倍寬，移到 mid）→ 尖端，拆成兩個凸塊接起來，中段那裡就有一個彎
function strand(root, mid, tip, k = 0.6, back = 0.03) {
  const c = [0, 1, 2].map((i) => root.reduce((t, p) => t + p[i], 0) / root.length);
  const m = root.map((p) => p.map((v, i) => mid[i] + (v - c[i]) * k));
  return [[...root, ...m], tuft(m, tip, back)];
}
const mz = (pts) => pts.map(([x, y, z]) => [x, y, -z]);              // 左右翻過來
const shift = (pts, dx, dz) => pts.map(([x, y, z]) => [x + dx, y, z + dz]);

// ---- 臉：一張 110×110 的小圖（一格 4 公釐），貼在臉的正前方，放大時不做平滑 ----
// 圖的範圍：左右 ±0.22、上下 1.42 → 0.98；圖的左邊是人物的右手邊（+Z）
let faceTex = null;
function faceTexture() {
  if (faceTex) return faceTex;
  const cv = document.createElement('canvas');
  cv.width = 110; cv.height = 110;
  const g = cv.getContext('2d');
  const px = (c, x, y, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  // 腮紅：眼睛外下方一小塊，邊緣淡一點（跟膚色混過，不用半透明）
  for (const x0 of [13, 84]) {
    px('#f6ae8e', x0, 84, 13, 11);
    px('#f6a085', x0 + 1, 85, 11, 9);
    px('#f59a80', x0 + 2, 86, 9, 7);
  }
  // 眼睛：深咖啡色的直長方塊，四角各切一格，沒有亮點
  for (const x0 of [20, 76]) {
    px('#362824', x0 + 1, 56, 12, 29);
    px('#362824', x0, 57, 14, 27);
    px('#3d2b26', x0 + 2, 79, 10, 4);   // 下緣稍微淡一點
  }
  // 眉毛：細細一條，微微拱起，外側稍微往下
  const brow = (pts) => { for (const [x, y, w] of pts) px('#5a3a2c', x, y, w, 2); };
  brow([[13, 41, 4], [17, 40, 14]]);
  brow([[79, 40, 14], [93, 41, 4]]);
  // 嘴：小小一個 o
  px('#9c4a3a', 54, 96, 3, 1); px('#9c4a3a', 53, 97, 1, 2); px('#9c4a3a', 57, 97, 1, 2); px('#9c4a3a', 54, 99, 3, 1);
  px('#c46e56', 54, 97, 3, 2);
  faceTex = new THREE.CanvasTexture(cv);
  faceTex.magFilter = faceTex.minFilter = THREE.NearestFilter;
  faceTex.generateMipmaps = false;
  faceTex.colorSpace = THREE.SRGBColorSpace;
  return faceTex;
}

export function buildFigure() {
  const g = new THREE.Group();
  const skin = pixelMat(0xf6bd92, { amp: 0.07 }), hair = pixelMat(0x6c3d2c, { amp: 0.12 }), shirt = pixelMat(0xf2e0da, { amp: 0.07 });
  const skirt = pixelMat(0x3f3862, { amp: 0.1, side: THREE.DoubleSide }), navy = pixelMat(0x3d3660, { amp: 0.08 });
  const red = pixelMat(0xc8322d, { amp: 0.1 }), boot = pixelMat(0x67392a, { amp: 0.1 }), sole = pixelMat(0x4a2b21, { amp: 0.08 });
  const trim = pixelMat(0xeee6ee, { amp: 0.04 });
  // 臉的小圖：只有五官的地方不透明。標成透明的，才不會被描邊、也不投影
  const face = new THREE.MeshLambertMaterial({ map: faceTexture(), alphaTest: 0.5, transparent: true });

  let parent = g, oy = 0;   // 現在往哪個關節上加東西、那個關節的高度（下面的座標都是整個人的座標，加上去時換算）
  const list = [];
  const put = (m) => { m.position.y -= oy; parent.add(m); list.push(m); return m; };
  const add = (pts, mat) => put(solid(pts, mat));

  // ---- 腿：膚色的八角柱（上端藏在裙子裡）＋ 粗粗的咖啡色短靴（靴筒、往前凸的鞋頭、深色鞋底） ----
  const legs = [-1, 1].map((s) => {
    const joint = new THREE.Group();
    joint.position.set(0, HIP_Y, s * HIP_Z);
    g.add(joint);
    const bz = s * 0.015;   // 靴子比腿稍微往外
    const parts = [
      solid(oct(0.5, 0.2, 0.072, 0.066), skin),   // 腿的上端只比髖關節高一點點：坐下時腿往前抬，上端才不會從裙子後面戳出來
      solid(shift(oct(0.25, 0.07, 0.094, 0.1), -0.018, bz), boot),
      solid(shift([[-0.125, 0.02, 0.108], [-0.125, 0.02, -0.108], [-0.125, 0.13, 0.1], [-0.125, 0.13, -0.1], [0.03, 0.14, 0.1], [0.03, 0.14, -0.1],
        [0.12, 0.12, 0.09], [0.12, 0.12, -0.09], [0.165, 0.08, 0.08], [0.165, 0.08, -0.08], [0.17, 0.02, 0.085], [0.17, 0.02, -0.085],
        [0.1, 0.02, 0.115], [0.1, 0.02, -0.115]], 0, bz), boot),
      solid(shift([[-0.13, 0, 0.11], [-0.13, 0, -0.11], [0.1, 0, 0.118], [0.1, 0, -0.118], [0.175, 0, 0.085], [0.175, 0, -0.085],
        [-0.13, 0.026, 0.112], [-0.13, 0.026, -0.112], [0.1, 0.026, 0.12], [0.1, 0.026, -0.12], [0.178, 0.026, 0.087], [0.178, 0.026, -0.087]], 0, bz), sole),
    ];
    for (const m of parts) { m.position.y -= HIP_Y; joint.add(m); }
    return joint;
  });

  // ---- 手臂：白色短袖（下緣張開）＋ 膚色手臂 ＋ 末端粗一點的方塊手 ----
  const arms = [-1, 1].map((s) => {
    const joint = new THREE.Group();
    joint.position.set(-0.015, SHOULDER_Y, s * SHOULDER_Z);
    g.add(joint);
    const at = (pts) => pts.map(([x, y, z]) => [x, y - SHOULDER_Y, z]);
    const sleeve = solid(at(oct(0.885, 0.745, 0.064, 0.086)), shirt);                       // 袖子
    const hand = new THREE.Group();                                                          // 手（掛在手腕上）
    hand.position.y = 0.635 - SHOULDER_Y;
    hand.add(solid([...oct(0, -0.06, 0.066, 0.07), ...oct(-0.075, -0.082, 0.055, 0.055)], skin));
    joint.add(sleeve, solid(at(oct(0.79, 0.62, 0.056, 0.06)), skin), hand);                 // 中間是手臂
    const grip = new THREE.Object3D();                                                       // 手心：拿東西（釣竿）的位置
    grip.position.y = -0.04;
    hand.add(grip);
    joint.userData.side = s;
    joint.userData.grip = grip;
    // 握舵時手臂要伸長才搆得到：只拉長手臂那一段，袖子和手維持原來的樣子
    joint.userData.stretch = (k) => { joint.scale.y = k; sleeve.scale.y = hand.scale.y = 1 / k; };
    return joint;
  });

  // ---- 身體：短短的白色水手服、深藍百褶裙、藍色水手領、紅領巾 ----
  add([...ring(0.69, -0.11, 0.125, 0.178, 0.05), ...ring(0.75, -0.105, 0.12, 0.172, 0.05), ...ring(0.86, -0.098, 0.112, 0.17, 0.05),
    ...ring(0.92, -0.085, 0.1, 0.13, 0.045), ...ring(0.975, -0.06, 0.07, 0.072, 0.03)], shirt);
  put(new THREE.Mesh(skirtGeometry(), skirt));
  // 水手領：背後垂一片方領（上緣在脖子後面），從肩膀繞到胸前收成 V 字；邊上一條白線
  add([[-0.06, 1.0, 0.07], [-0.06, 1.0, -0.07], [-0.088, 0.975, 0.12], [-0.088, 0.975, -0.12], [-0.12, 0.86, 0.135], [-0.12, 0.86, -0.135],
    [-0.045, 1.0, 0.07], [-0.045, 1.0, -0.07], [-0.07, 0.97, 0.115], [-0.07, 0.97, -0.115], [-0.1, 0.86, 0.13], [-0.1, 0.86, -0.13]], navy);
  for (const s of [-1, 1]) {
    const S = (pts) => (s > 0 ? pts : mz(pts));
    add(S([[-0.06, 1.0, 0.07], [-0.088, 0.975, 0.125], [0.04, 0.975, 0.075], [0.035, 0.945, 0.135],
      [-0.05, 0.985, 0.065], [-0.075, 0.96, 0.115], [0.035, 0.96, 0.07], [0.03, 0.935, 0.12]]), navy);             // 肩上那一段
    add(S([[0.04, 0.975, 0.075], [0.035, 0.945, 0.135], [0.118, 0.925, 0.0], [0.113, 0.9, 0.04],
      [0.03, 0.965, 0.07], [0.025, 0.935, 0.12], [0.102, 0.92, 0.0], [0.1, 0.9, 0.035]]), navy);                    // 胸前那一段
    add(S([[0.036, 0.952, 0.128], [0.041, 0.958, 0.122], [0.113, 0.908, 0.036], [0.117, 0.913, 0.031],
      [0.027, 0.945, 0.125], [0.103, 0.905, 0.034]]), trim);                                                         // 胸前的白線
    add(S([[-0.123, 0.875, 0.118], [-0.123, 0.875, 0.108], [-0.093, 0.965, 0.108], [-0.093, 0.965, 0.098],
      [-0.113, 0.875, 0.118], [-0.083, 0.965, 0.106]]), trim);                                                        // 背後方領兩側的白線
  }
  add([[-0.124, 0.874, 0.118], [-0.124, 0.874, -0.118], [-0.121, 0.884, 0.108], [-0.121, 0.884, -0.108],
    [-0.112, 0.874, 0.118], [-0.112, 0.874, -0.118], [-0.11, 0.884, 0.108], [-0.11, 0.884, -0.108]], trim);              // 背後方領下緣的白線
  add([...ring(0.955, 0.098, 0.14, 0.034, 0.012), ...ring(0.905, 0.105, 0.147, 0.03, 0.012)], red);                  // 領巾的結
  add([[0.135, 0.905, 0.03], [0.135, 0.905, -0.025], [0.118, 0.905, 0.025], [0.118, 0.905, -0.02],
    [0.172, 0.775, 0.1], [0.155, 0.775, 0.095], [0.17, 0.78, -0.03], [0.153, 0.78, -0.028],
    [0.18, 0.72, 0.05], [0.165, 0.72, 0.05]], red);                                                                   // 垂下來的領巾（往右手邊斜一點）
  const torso = list.splice(0);   // 到這裡為止是軀幹：第一人稱走路時留著，掌舵時才藏

  // ---- 頭：掛在脖子的關節上，可以轉頭、抬頭、低頭 ----
  const neck = solid(oct(1.05, 0.95, 0.045, 0.048), skin);
  g.add(neck);
  const head = new THREE.Group();
  head.position.y = NECK_Y;
  g.add(head);
  parent = head; oy = NECK_Y;
  // 頭殼：正面是一整片平的臉（x = 0.205），下巴寬寬的、兩角切掉
  add([[0.205, 1.43, 0.2], [0.205, 1.43, -0.2], [0.205, 1.04, 0.2], [0.205, 1.04, -0.2], [0.205, 1.01, 0.175], [0.205, 1.01, -0.175],
    [0.2, 0.982, 0.12], [0.2, 0.982, -0.12], [0.15, 0.975, 0.12], [0.15, 0.975, -0.12], [0.07, 0.99, 0.17], [0.07, 0.99, -0.17],
    [0.15, 1.03, 0.235], [0.15, 1.03, -0.235], [0.12, 1.3, 0.25], [0.12, 1.3, -0.25], [-0.06, 1.08, 0.235], [-0.06, 1.08, -0.235],
    [-0.08, 1.35, 0.25], [-0.08, 1.35, -0.25], [-0.22, 1.25, 0.2], [-0.22, 1.25, -0.2], [-0.2, 1.08, 0.15], [-0.2, 1.08, -0.15],
    [0.0, 1.55, 0.15], [0.0, 1.55, -0.15]], skin);
  const faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44), face);
  faceMesh.rotation.y = Math.PI / 2;
  faceMesh.position.set(0.2075, 1.2, 0);
  put(faceMesh);
  for (const s of [-1, 1]) add(oct(1.19, 1.11, 0.03, 0.028, -0.05, s * 0.245), skin);   // 耳朵（從側髮和後面那束頭髮之間露出來）

  // ---- 頭髮 ----
  // 頭頂：屋脊一樣尖起來的一大塊，從正面看像個五角形；前緣是額頭上的瀏海根部，後面蓋到後頸（正中間露出水手領的上緣）
  add([[-0.02, 1.625, 0.03], ...oval(1.6, -0.01, 0.06, 0.08, 8), ...oval(1.56, -0.02, 0.14, 0.17, 10), ...oval(1.52, -0.025, 0.205, 0.24, 10),
    ...oval(1.48, -0.025, 0.235, 0.275, 12), ...oval(1.44, -0.01, 0.26, 0.3, 12), ...oval(1.4, 0, 0.28, 0.325, 12),
    [0.285, 1.42, 0.12], [0.285, 1.42, -0.12], [0.06, 1.34, 0.33], [0.06, 1.34, -0.33], [-0.12, 1.34, 0.335], [-0.12, 1.34, -0.335],
    [-0.27, 1.34, 0.2], [-0.27, 1.34, -0.2], [-0.29, 1.34, 0.05], [-0.29, 1.34, -0.05],
    [-0.02, 1.22, 0.32], [-0.02, 1.22, -0.32], [-0.2, 1.2, 0.3], [-0.2, 1.2, -0.3], [-0.285, 1.2, 0.18], [-0.285, 1.2, -0.18], [-0.3, 1.2, 0],
    [-0.08, 1.08, 0.27], [-0.08, 1.08, -0.27], [-0.22, 1.08, 0.22], [-0.22, 1.08, -0.22], [-0.27, 1.08, 0.1], [-0.27, 1.08, -0.1],
    [-0.16, 1.02, 0.12], [-0.16, 1.02, -0.12], [-0.215, 1.02, 0]], hair);
  // 瀏海：從額頭垂下來的幾片大尖片，尖端垂到眼睛的高度（中間偏右手邊那片最長，一片蓋到左眼的上緣）。
  // 不是一整片平板：根部沿著額頭的弧度往兩旁往後收，每片中段往前鼓、尖端往臉收，相鄰兩片前後錯開一點
  // [右手邊根部 z、高度]、[左手邊根部 z、高度]、[尖端 z、高度]、這片往前多凸多少
  const fx = (z) => 0.292 - z * z;   // 額頭前緣的弧度：越往兩旁越往後
  for (const [[za, ya], [zb, yb], [zt, yt], dx] of [
    [[0.215, 1.44], [0.124, 1.36], [0.165, 1.27], -0.008],
    [[0.124, 1.36], [-0.036, 1.405], [0.046, 1.18], 0.008],
    [[-0.036, 1.405], [-0.196, 1.34], [-0.13, 1.184], 0],
    [[-0.196, 1.34], [-0.235, 1.43], [-0.23, 1.25], -0.01],
  ]) {
    const xa = fx(za) + dx, xb = fx(zb) + dx;
    const root = [[xa, ya, za], [xb, yb, zb], [xa, 1.45, za], [xb, 1.45, zb], [xa - 0.05, 1.45, za], [xb - 0.05, 1.45, zb], [xa - 0.045, ya, za], [xb - 0.045, yb, zb]];
    const mzt = (za + zb) / 2 + ((zt - (za + zb) / 2) * 0.45), my = (ya + yb) / 2 + (yt - (ya + yb) / 2) * 0.45;
    for (const pts of strand(root, [fx(mzt) + dx + 0.004, my, mzt], [Math.max(0.224, fx(zt) + dx - 0.04), yt, zt], 0.55, 0.02)) add(pts, hair);
  }
  // 兩側：臉旁垂下來的一大片（在臉頰外側、耳朵前面，上半貼著頭、下半往外鼓），下緣三撮尖：裡面那撮往脖子收，最外面那撮往外翹；
  // 耳朵後面再一大束往外鼓、往下垂到肩膀。每一撮都是中段彎一下的兩節，不是直直的楔子
  for (const s of [-1, 1]) {
    const S = (pts) => (s > 0 ? pts : mz(pts));
    const side = (root, mid, tip, k = 0.6, back = 0.04) => { for (const pts of strand(root, mid, tip, k, back)) add(S(pts), hair); };
    const q140 = [[0.09, 1.4, 0.21], [0.09, 1.4, 0.33], [-0.03, 1.4, 0.34], [-0.03, 1.4, 0.22]];
    const q122 = [[0.085, 1.22, 0.215], [0.085, 1.22, 0.375], [-0.03, 1.22, 0.385], [-0.03, 1.22, 0.225]];
    const q108 = [[0.075, 1.08, 0.205], [0.07, 1.08, 0.39], [-0.03, 1.08, 0.4], [-0.03, 1.08, 0.215]];
    add(S([...q140, ...q122]), hair); add(S([...q122, ...q108]), hair);                                     // 臉旁那一大片
    side([[0.08, 1.12, 0.2], [0.08, 1.12, 0.29], [-0.03, 1.12, 0.29], [-0.03, 1.12, 0.21]], [0.068, 1.0, 0.258], [0.045, 0.88, 0.215], 0.6, 0.05);
    side([[0.075, 1.12, 0.27], [0.075, 1.12, 0.37], [-0.03, 1.12, 0.37], [-0.03, 1.12, 0.27]], [0.05, 1.03, 0.35], [0.02, 0.94, 0.325], 0.6, 0.05);
    side([[0.07, 1.16, 0.33], [0.07, 1.16, 0.4], [-0.03, 1.16, 0.4], [-0.03, 1.16, 0.33]], [0.04, 1.1, 0.418], [0.02, 1.03, 0.45], 0.65, 0.05);
    add(S([[-0.04, 1.32, 0.27], [-0.04, 1.32, 0.34], [-0.26, 1.3, 0.3], [-0.26, 1.3, 0.21], [-0.12, 1.17, 0.385],
      [-0.04, 1.04, 0.33], [-0.1, 1.04, 0.375], [-0.24, 1.04, 0.34], [-0.29, 1.04, 0.22], [-0.2, 1.04, 0.2]]), hair);   // 耳後那束
    side([[-0.05, 1.08, 0.3], [-0.05, 1.08, 0.37], [-0.2, 1.08, 0.36], [-0.2, 1.08, 0.29]], [-0.1, 0.97, 0.385], [-0.13, 0.87, 0.35]);
    side([[-0.15, 1.08, 0.25], [-0.15, 1.08, 0.35], [-0.28, 1.08, 0.3], [-0.28, 1.08, 0.2]], [-0.2, 0.96, 0.33], [-0.2, 0.85, 0.285]);
    side([[0.0, 1.12, 0.31], [0.0, 1.12, 0.37], [-0.12, 1.12, 0.38], [-0.12, 1.12, 0.32]], [-0.04, 1.02, 0.405], [-0.07, 0.94, 0.395]);
  }

  // ---- 紅色大蝴蝶結：綁在後腦勺左上方，一片往上往外翹，一片往下往外垂 ----
  add([[-0.265, 1.51, -0.03], [-0.265, 1.51, -0.1], [-0.265, 1.43, -0.03], [-0.265, 1.43, -0.1],
    [-0.33, 1.5, -0.035], [-0.33, 1.5, -0.095], [-0.33, 1.44, -0.035], [-0.33, 1.44, -0.095]], red);
  add([[-0.27, 1.5, -0.08], [-0.27, 1.45, -0.09], [-0.32, 1.5, -0.08], [-0.32, 1.45, -0.09],
    [-0.31, 1.625, -0.36], [-0.42, 1.59, -0.35], [-0.32, 1.42, -0.36], [-0.41, 1.4, -0.35]], red);
  add([[-0.27, 1.46, -0.08], [-0.27, 1.43, -0.06], [-0.32, 1.46, -0.08], [-0.32, 1.43, -0.06],
    [-0.3, 1.27, -0.36], [-0.41, 1.27, -0.36], [-0.3, 1.15, -0.43], [-0.42, 1.16, -0.425],
    [-0.3, 1.05, -0.12], [-0.4, 1.07, -0.13]], red);

  g.traverse((m) => { if (m.isMesh) m.userData.figure = true; });
  // fpHide：掌舵的第一人稱要藏起來的部分（脖子以上）；mats：這個人用到的所有材質
  g.userData = { legs, arms, head, fpHide: [neck, head], torso, mats: [skin, hair, shirt, skirt, navy, red, boot, sole, trim, face] };
  return g;
}

// 百褶裙：十六片，一片凸一片凹；上窄下寬（A 字）、前後比左右扁一點
function skirtGeometry() {
  const n = 16;
  let geo = new THREE.CylinderGeometry(1, 1, 1, n, 1, true);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = ((Math.round(Math.atan2(x, z) / (Math.PI * 2) * n) % n) + n) % n;
    const f = k % 2 ? 0.955 : 1, top = y > 0;
    p.setXYZ(i, x * (top ? 0.1 : 0.225) * f, top ? 0.73 : 0.47, z * (top ? 0.12 : 0.275) * f);
  }
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-4);
  geo.computeVertexNormals();
  return geo;
}
