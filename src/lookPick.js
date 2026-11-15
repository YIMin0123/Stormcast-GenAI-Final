// 進遊戲前選角色：填名字那張卡片上方有一個小視窗，站著選中的角色慢慢轉圈、偶爾換個表情；
// 底下兩顆按鈕切換女生／男生，選了就記住（下次打開預設是它）。
// 預覽用自己的一個小 WebGL 畫布（跟遊戲畫面分開），選單關掉就停。
import * as THREE from 'three';
import { buildFigure, LOOKS, FACES } from './figure.js';
import { addOutline } from './toon.js';
import { myLook, setMyLook } from './look.js';
import { TOUCH } from './touch.js';
import { FramePacer } from './framePacer.js';

const $ = (id) => document.getElementById(id);

// 角色預覽只在填名字時播放，進房後釋放資源。
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
  let look = myLook(), spin = 0.6, faceT = 2.5, faceI = 0, raf = null;
  const clock = new FramePacer();
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
    if (!w || !h) return false;
    const ratio = renderer.getPixelRatio();
    if (cv.width !== Math.floor(w * ratio) || cv.height !== Math.floor(h * ratio)) {
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    return true;
  };
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const ms = clock.take(now, TOUCH ? 30 : 0);
    if (ms === null || !size()) return;
    const dt = Math.min(0.05, ms / 1000);
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
    renderer.render(scene, camera);
  };
  const setVisible = (visible) => {
    if (visible === (raf !== null)) return;
    clock.reset();
    if (visible) raf = requestAnimationFrame(loop);
    else { cancelAnimationFrame(raf); raf = null; }
  };
  const resetClock = () => clock.reset();
  document.addEventListener('visibilitychange', resetClock);
  return {
    setVisible,
    dispose() {
      setVisible(false);
      document.removeEventListener('visibilitychange', resetClock);
      for (const f of Object.values(figs)) f.traverse((m) => { if (m.isMesh && !m.userData.hull) [m.material].flat().forEach((x) => x.dispose()); });
      renderer.dispose();
    },
  };
}
