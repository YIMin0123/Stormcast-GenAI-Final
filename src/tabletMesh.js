// 拿在手上的平板（3D）：自己拿出平板時角色捧在胸前，別人也看得到。
// 擺法跟捧魚一樣：掛在人偶上，(0.5, 1.08, 0) 附近、螢幕朝向人臉
import * as THREE from 'three';

let mats = null;
export function makeTabletMesh() {
  if (!mats) {
    mats = {
      case: new THREE.MeshLambertMaterial({ color: 0x1b2731 }),
      screen: new THREE.MeshBasicMaterial({ color: 0x8fd6f2 }),
    };
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.28), mats.case);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.255), mats.screen);
  scr.rotation.x = -Math.PI / 2;
  scr.position.y = 0.0065;
  g.add(body, scr);
  // 斜斜地朝上、往人那邊傾：看起來像低頭在看
  g.rotation.z = 0.95;
  g.userData.tablet = true;
  return g;
}
