// 在背景執行緒重算避浪圖（哪裡是背風面）：風向變了才算，一次一兩百毫秒，放在主執行緒會卡一下。
// 收：先一次 { bed, N, L }，之後每次 { angle, turn }；回：{ out: Uint8Array, turn }
import { computeShelter } from './terrain.js';
let bed = null, N = 0, L = 0;
self.onmessage = (e) => {
  const d = e.data;
  if (d.bed) { bed = d.bed; N = d.N; L = d.L; return; }
  const out = computeShelter(bed, N, L, d.angle);
  self.postMessage({ out, turn: d.turn }, [out.buffer]);
};
