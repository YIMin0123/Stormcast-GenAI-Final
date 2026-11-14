// 魚箱的容量（瀏覽器和伺服器共用，只有算式）：照魚模型的實際大小放，魚越大越快滿；比箱子長的放不進去
import { SPECIES } from './fishdata.js';
import { FISHBOX } from './config.js';

// 一條魚佔多少體積（立方公尺）：身長 × 身高 × 身寬，魚是紡錘形，大約只佔外框的一半
export function fishVolume(id, len) {
  const sp = SPECIES[id];
  if (!sp) return 0;
  return len * (len * (sp.h || 0.25)) * (len * (sp.w || 0.12)) * 0.5;
}
// 箱子能裝的體積
export const BOX_VOLUME = FISHBOX.w * FISHBOX.d * FISHBOX.h * FISHBOX.fill;
// 最長放得進去的魚：斜斜放在箱底的對角線
export const BOX_LONGEST = Math.hypot(FISHBOX.w, FISHBOX.d);

// 這條魚放不放得進這個箱子。list：箱子裡已經有的魚 [{ id, len }]。回傳 '' 放得進去；'long' 太長；'full' 滿了
export function boxFit(list, id, len) {
  if (len > BOX_LONGEST) return 'long';
  const used = list.reduce((s, f) => s + fishVolume(f.id, f.len), 0);
  return used + fishVolume(id, len) > BOX_VOLUME ? 'full' : '';
}
// 箱子滿了幾成（0–1）
export const boxUsed = (list) => Math.min(1, list.reduce((s, f) => s + fishVolume(f.id, f.len), 0) / BOX_VOLUME);
// 抱著這箱魚走路是平常的幾倍速度
export const boxSpeed = (kg) => Math.max(FISHBOX.slowest, 1 - (1 - FISHBOX.slowest) * Math.min(1, kg / FISHBOX.heavy));
