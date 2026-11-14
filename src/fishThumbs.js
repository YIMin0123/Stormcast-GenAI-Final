// 圖鑑用的魚縮圖：用遊戲裡同一個 3D 模型，側面拍一張小照片（第一次打開圖鑑時才拍，之後重用）。
// 借用主畫面的 renderer 畫到一張離屏的圖上，不另開 WebGL（手機開第二個 WebGL 很貴）
import * as THREE from 'three';
import { SPECIES } from './fishdata.js';
import { makeFishMesh } from './fish.js';

const W = 192, H = 120;
let cache = null;

export function fishThumbs(renderer) {
  if (cache) return cache;
  cache = new Map();
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8aa6b8, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(0.6, 1.2, 1.5);
  scene.add(sun);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
  const px = new Uint8Array(W * H * 4), cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), img = g.createImageData(W, H);
  const was = { target: renderer.getRenderTarget(), tone: renderer.toneMapping, clear: renderer.getClearAlpha(), color: renderer.getClearColor(new THREE.Color()) };
  const box = new THREE.Box3(), c = new THREE.Vector3(), s = new THREE.Vector3();
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  for (const [id, sp] of Object.entries(SPECIES)) {
    const m = makeFishMesh(sp, 1);
    m.rotation.y = sp.kind === 'junk' ? -0.5 : 0;   // 雜物斜一點拍，看得出是什麼
    if (sp.kind === 'junk') m.rotation.x = 0.35;
    scene.add(m);
    box.setFromObject(m); box.getCenter(c); box.getSize(s);
    const k = Math.max(s.x / W, s.y / H) * 1.18;   // 留一點邊
    cam.left = -W * k / 2; cam.right = W * k / 2; cam.top = H * k / 2; cam.bottom = -H * k / 2;
    cam.position.set(c.x, c.y, c.z + 10); cam.lookAt(c); cam.updateProjectionMatrix();
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);   // 讀出來是上下顛倒的
    g.putImageData(img, 0, 0);
    cache.set(id, cv.toDataURL('image/png'));
    scene.remove(m);
    m.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); for (const mt of [].concat(o.material)) { if (mt.map) mt.map.dispose(); mt.dispose(); } } });
  }
  renderer.setRenderTarget(was.target);
  renderer.toneMapping = was.tone;
  renderer.setClearColor(was.color, was.clear);
  rt.dispose();
  return cache;
}
