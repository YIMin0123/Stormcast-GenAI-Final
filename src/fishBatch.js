// 魚的合畫（實例化）：躺著不動的魚，同一種魚的同一個零件收在一個 InstancedMesh 裡，一次畫完。
// 每幀：begin() → 每個零件 add(mesh)（用它現在的世界矩陣）→ end()。被收進來的零件本身由呼叫的人藏起來。
// 零件要先由 fishModel.js 標好 userData.inst（{ key 哪種魚的第幾個零件, mat 共用、不擺動的材質 }）
import * as THREE from 'three';

export class FishBatch {
  constructor(scene) {
    this.scene = scene;
    this.groups = new Map();   // key → { im, cap, n }
  }

  begin() { for (const g of this.groups.values()) g.n = 0; }

  add(mesh) {
    const inst = mesh.userData.inst;
    let g = this.groups.get(inst.key);
    if (!g || g.n >= g.cap) g = this._grow(inst, mesh, g);
    g.im.setMatrixAt(g.n++, mesh.matrixWorld);
  }

  end() {
    for (const g of this.groups.values()) {
      g.im.count = g.n;
      g.im.visible = g.n > 0;
      if (g.n) g.im.instanceMatrix.needsUpdate = true;
    }
  }

  // 第一次用到這個零件、或位子不夠：開一個大一倍的
  _grow(inst, mesh, old) {
    const cap = old ? old.cap * 2 : 16;
    const im = new THREE.InstancedMesh(mesh.geometry, inst.mat, cap);
    im.frustumCulled = false;            // 魚到處都有，整組的範圍不好算；本來就只收看得到的
    im.matrixAutoUpdate = false;         // 本身擺在原點，位置都在每一份的矩陣裡
    im.raycast = () => {};               // 瞄準、鏡頭碰撞都照原本的魚算，不要打到這裡
    im.castShadow = mesh.castShadow; im.receiveShadow = mesh.receiveShadow;
    im.renderOrder = mesh.renderOrder;
    if (old) {
      im.instanceMatrix.array.set(old.im.instanceMatrix.array.subarray(0, old.n * 16));
      old.im.removeFromParent();
      old.im.dispose();
    }
    this.scene.add(im);
    const g = { im, cap, n: old ? old.n : 0 };
    this.groups.set(inst.key, g);
    return g;
  }
}
