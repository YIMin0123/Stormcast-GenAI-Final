// 據點（海上修船屋、大港灣島）模型共用的零件：把商品模型和價格牌擺上去、爬梯、鑄鐵路燈、防撞輪胎、有字的招牌。
// 都用「那個據點自己的設計圖座標」蓋；交給全場共用的低面材質畫
import * as THREE from 'three';
import { jitter } from './palette.js';
import { beam } from './river3d.js';
import { boatGeo } from './harbor3d.js';
import { goodGeo, placeGeo, FLOOR_GOODS, GOOD_COLORS as Q } from './goods3d.js';
import { makeTag, tagPlane, signTexture } from '../priceTag.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// 把一批商品（layout.js 的 SITE_SHELF_W 裡屬於這個據點的那幾筆）擺進 fb，價格牌的面加進 group。
// floorOf(攤位)：站在地上的工位（修船台、捐款箱、郵筒）腳下的地面多高；skip：這些 id 不擺模型（別人自己蓋）
// 回傳 { tags 價格牌 [{ c, t }]（順序跟 shelves 一樣）, unlit 不吃光的材質 }
export function placeGoods(fb, group, shelves, { P, floorOf, skip = [] }) {
  const tags = [], unlit = [];
  shelves.forEach((s, i) => {
    const ry = s.face > 0 ? 0 : Math.PI;
    if (!skip.includes(s.id)) {
      const geo = goodGeo(s.id, { P, boatGeo, seed: i + 1 });
      if (geo) placeGeo(fb, geo, s.lx, FLOOR_GOODS.has(s.id) ? floorOf(s) : s.y, s.lz, ry);
    }
    const tag = makeTag(), { mesh, mat } = tagPlane(tag);
    mesh.position.set(s.lx, s.tag.y, s.lz + s.face * s.tag.dz);
    mesh.rotation.y = ry;
    group.add(mesh);
    tags.push(tag); unlit.push(mat);
  });
  return { tags, unlit };
}

// 爬梯：兩根直柱＋一階一階的橫桿，從平台面往下插進水裡
export function ladder3d(fb, l, deckY, P, r) {
  const px = -l.nz, pz = l.nx, ox = l.x + l.nx * 0.12, oz = l.z + l.nz * 0.12;
  for (const s of [-0.36, 0.36]) beam(fb, V3(ox + px * s, -2.0, oz + pz * s), V3(ox + px * s, deckY + 0.85, oz + pz * s), 0.09, 0.09, jitter(P.metal, r, 0.04));
  for (let y = -1.7; y < deckY + 0.1; y += 0.36) beam(fb, V3(ox - px * 0.36, y, oz - pz * 0.36), V3(ox + px * 0.36, y, oz + pz * 0.36), 0.07, 0.06, jitter(P.metal, r, 0.04));
}

// 防撞輪胎：掛在平台邊上（t.nx／t.nz 朝外）
export function tire3d(fb, t, deckY, r) {
  const nx = t.nx ?? 0, nz = t.nz ?? 0;
  const g = new THREE.TorusGeometry(0.34, 0.13, 5, 10);
  if (nx) g.rotateY(Math.PI / 2);
  g.translate(t.x + nx * 0.16, deckY - 0.55, t.z + nz * 0.16);
  const c = jitter(Q.black, r, 0.08);
  fb.addGeometry(g, () => c);
  beam(fb, V3(t.x + nx * 0.05, deckY - 0.25, t.z + nz * 0.05), V3(t.x + nx * 0.05, deckY + 0.02, t.z + nz * 0.05), 0.04, 0.04, Q.rope);
}

// 鑄鐵路燈：底座、燈柱、彎出去的燈臂、燈罩。回傳燈泡的位置（[x, y, z]，燈泡本身由呼叫的人另外做成會發亮的）
export function lampPost(fb, x, y, z, P, r, h = 3.4, ax = 0, az = 1) {
  const c = jitter(P.lampPole, r, 0.04);
  const cyl = (rt, rb, ya, yb, seg = 7) => { const g = new THREE.CylinderGeometry(rt, rb, yb - ya, seg); g.translate(x, (ya + yb) / 2, z); fb.addGeometry(g, () => c); };
  cyl(0.17, 0.22, y, y + 0.3); cyl(0.07, 0.1, y + 0.3, y + h); cyl(0.11, 0.07, y + h * 0.55, y + h * 0.55 + 0.1);
  beam(fb, V3(x, y + h - 0.05, z), V3(x + ax * 0.55, y + h + 0.12, z + az * 0.55), 0.07, 0.07, c);
  const bx = x + ax * 0.55, bz = z + az * 0.55, by = y + h - 0.12;
  const g = new THREE.CylinderGeometry(0.08, 0.26, 0.2, 7); g.translate(bx, by + 0.2, bz); fb.addGeometry(g, () => c);
  return [bx, by, bz];
}

// 一塊有字的招牌（不吃光的貼圖）：中心 (x, y, z)、朝 +z 再繞 y 轉 ry。回傳 { mesh, mat }
export function signBoard(text, w, h, x, y, z, ry = 0) {
  const mat = new THREE.MeshBasicMaterial({ map: signTexture(text, w, h), toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  return { mesh, mat };
}

// 一堆會發亮的燈泡（天黑才亮）：pts [[x, y, z]]，合成一個網格。回傳 { mesh, mat }
export function bulbs(pts, size = 0.13, color = 0xffd68a) {
  const geos = pts.map(([x, y, z]) => { const g = new THREE.IcosahedronGeometry(size, 0); g.translate(x, y, z); return g; });
  const pos = [];
  for (const g of geos) pos.push(...g.toNonIndexed().attributes.position.array);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  mat.userData.base = new THREE.Color(color);
  return { mesh: new THREE.Mesh(geo, mat), mat };
}

// 一批朝某個方向的發光小方片（窗戶透出來的燈光、燈籠的火）：quads [{ p 中心 Vector3, ux, uz 橫向（單位向量）, w, h }]
// 合成一個網格，天黑才畫。回傳 { mesh, mat }
export function glowQuads(quads, color = 0xffc86a) {
  const pos = [];
  for (const q of quads) {
    const a = q.p.clone().add(V3(-q.ux * q.w / 2, -q.h / 2, -q.uz * q.w / 2)), b = q.p.clone().add(V3(q.ux * q.w / 2, -q.h / 2, q.uz * q.w / 2));
    const c = q.p.clone().add(V3(q.ux * q.w / 2, q.h / 2, q.uz * q.w / 2)), d = q.p.clone().add(V3(-q.ux * q.w / 2, q.h / 2, -q.uz * q.w / 2));
    for (const v of [a, b, c, a, c, d]) pos.push(v.x, v.y, v.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // 不透明（畫面的 alpha 是「是不是天空」的記號，半透明會把它弄髒）：亮度由外面照天色調顏色
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide });
  mat.userData.base = new THREE.Color(color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  return { mesh, mat };
}
