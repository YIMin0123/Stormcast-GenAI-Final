// 進遊戲前選角色：填名字那張卡片上方有一個小視窗，站著選中的角色慢慢轉圈、偶爾換個表情；
// 底下兩顆按鈕切換女生／男生，選了就記住（下次打開預設是它）。
// 預覽用自己的一個小 WebGL 畫布（跟遊戲畫面分開），選單關掉就停。
import * as THREE from 'three';
import { buildFigure, LOOKS, FACES } from './figure.js';
import { addOutline } from './toon.js';
import { myLook, setMyLook } from './look.js';

const $ = (id) => document.getElementById(id);

// 開始預覽。onPick(look)：換了角色時呼叫。回傳 stop()：選單關掉時呼叫
export function startLookPick(onPick) {
  const cv = $('lookView'), buttons = [...$('lookPick').children];
  const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a7a90, 1.6));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(3, 4, 2);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
  camera.position.set(3.5, 1.2, 0);
  camera.lookAt(0, 0.82, 0);

  // 兩個角色各做一個，選哪個就顯示哪個（換的時候不用重做）
  const figs = {};
  for (const look of LOOKS) {
    const f = buildFigure(look);
    addOutline(f);
    f.visible = false;
    scene.add(f);
    figs[look] = f;
  }
  let look = myLook(), spin = 0.6, faceT = 2.5, faceI = 0, raf = 0, last = performance.now();
  const show = () => {
    for (const l of LOOKS) figs[l].visible = l === look;
    for (const b of buttons) b.classList.toggle('on', b.dataset.look === look);
  };
  show();
  for (const b of buttons) {
    b.addEventListener('click', () => {
      if (b.dataset.look === look) return;
      look = b.dataset.look;
      setMyLook(look);
      figs[look].rotation.y = spin;
      show();
      onPick?.(look);
    });
  }

  const size = () => {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  };
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    spin += dt * 0.7;
    const f = figs[look];
    f.rotation.y = spin;
    // 輕輕上下呼吸，看起來是活的
    f.userData.upper.rotation.z = Math.sin(now / 900) * 0.03;
    faceT -= dt;
    if (faceT <= 0) {   // 每隔幾秒換一個表情，再回到普通的臉
      faceI = (faceI + 1) % 2;
      f.userData.setFace(faceI ? FACES[1 + Math.floor(Math.random() * (FACES.length - 1))] : 'normal');
      faceT = faceI ? 1.6 : 3;
    }
    size();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    for (const f of Object.values(figs)) f.traverse((m) => { if (m.isMesh && !m.userData.hull) [m.material].flat().forEach((x) => x.dispose()); });
    renderer.dispose();
  };
}
