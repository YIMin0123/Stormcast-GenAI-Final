// 平板上要顯示的文字：方位、風級、天空、潮汐、預報、徵兆。都是純計算（不碰畫面），main.js 把數字丟進來
import { tideAt, TIDE } from './weather.js';

const DIRS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
// 方位角（度）：0 = 北（世界座標 -z）、順時針，90 = 東（+x）
export const bearing = (dx, dz) => (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
export const dirName = (dx, dz) => DIRS[Math.round(bearing(dx, dz) / 45) % 8];
// 距離：近的寫「旁邊」，其他的取整到 10 公尺
export const distText = (d) => (d < 12 ? '就在旁邊' : d < 1000 ? `${Math.round(d / 10) * 10} 公尺` : `${(d / 1000).toFixed(1)} 公里`);
export const whereFrom = (dx, dz) => { const d = Math.hypot(dx, dz); return d < 12 ? '就在旁邊' : `${dirName(dx, dz)}方 ${distText(d)}`; };

// 蒲福風級（公尺／秒）
const BF = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
export const beaufort = (ms) => { let i = 0; while (i < BF.length && ms >= BF[i]) i++; return i; };
const BF_WORD = ['無風', '幾乎沒風', '輕風', '微風', '和風', '清風', '強風：小船要小心', '疾風：別出海', '大風：很危險', '烈風', '狂風', '暴風', '颶風'];
export const windWord = (lv) => BF_WORD[Math.min(lv, BF_WORD.length - 1)];

// 時間：「上午」＋「8:05」
export function clockOf(hour) {
  const h = Math.floor(hour), m = Math.floor((hour - h) * 60 / 5) * 5;
  const part = h < 5 ? '凌晨' : h < 12 ? '上午' : h < 18 ? '下午' : '晚上';
  return { part, hm: `${h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')}` };
}
const hourText = (h) => { h = ((h % 24) + 24) % 24; const c = clockOf(h); return `${c.part} ${c.hm}`; };

// 天空：圖示＋一兩個字。phase 是 weather.js Sea 的階段
export function skyOf({ phase, rain, fog, gloom, night }) {
  if (phase === 'typhoon') return { icon: 'storm', text: '颱風' };
  if (phase === 'storm') return { icon: 'storm', text: '暴風雨' };
  if (phase === 'thunder') return { icon: 'storm', text: '雷雨' };
  if (rain > 0.45) return { icon: 'rain', text: '大雨' };
  if (rain > 0.08) return { icon: 'rain', text: '下雨' };
  if (fog > 0.3) return { icon: 'fog', text: '起霧' };
  if (gloom > 0.35) return { icon: 'cloud', text: '陰天' };
  return night ? { icon: 'moon', text: '晴朗' } : { icon: 'sun', text: '晴朗' };
}

// 潮汐：漲還是退、幾小時後滿潮／乾潮
export function tideText(day, hour) {
  const now = tideAt(day, hour), rising = tideAt(day, hour + 0.05) > now;
  const ph = (2 * Math.PI * (day * 24 + hour) / TIDE.period) % (2 * Math.PI);
  const goal = rising ? Math.PI / 2 : 1.5 * Math.PI;
  const left = (((goal - ph) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) * TIDE.period;
  const when = left < 0.75 ? '快要' : `約 ${Math.round(left)} 小時後`;
  const lv = Math.abs(now) < 0.05 ? '平均潮位' : `${now > 0 ? '+' : '-'}${Math.abs(now).toFixed(1)} 公尺`;
  return `${rising ? '漲潮中' : '退潮中'}（${lv}），${when}${rising ? '滿潮' : '乾潮'}`;
}
export const tideShort = (day, hour) => (tideAt(day, hour + 0.05) > tideAt(day, hour) ? '漲潮中' : '退潮中');

// 今天的預報（伺服器每天早上 6 點擲出當天的天氣：風浪、雲、雨的時段、清晨的霧）
export function forecast(c) {
  const out = [], h = c.hour;
  out.push(c.windGoal < 0.85 ? '今天風浪平靜，適合開小船出海' : c.windGoal < 1.45 ? '今天風浪普通' : '今天風浪偏大，小船出外海要小心');
  if (c.rainAmt > 0) {
    const from = c.rainFrom, to = c.rainTo, inRain = (h >= from && h < to) || (h + 24 >= from && h + 24 < to);
    const past = h >= to % 24 && h >= from && to <= 24;
    out.push(inRain ? `正在下雨，${hourText(to)}左右停` : past ? '今天的雨已經下過了' : `${hourText(from)}到${hourText(to)}會下雨（雨天比較好釣，有些魚只在雨天出來）`);
  } else out.push('今天不會下雨');
  if (c.fogAmt > 0 && h < 9.5) out.push(h < 4.5 ? '清晨 4 點半到 9 點半會起霧' : '現在起霧，9 點半左右散');
  out.push(c.cloudGoal > 0.3 ? '雲比較多' : '天空大致晴朗');
  out.push('明天的天氣，早上 6 點才知道');
  return out;
}

// 徵兆：海上現在有什麼不對勁。danger：要不要用警告的顏色
export function signsOf(sea) {
  const p = sea.phase, out = [];
  let danger = true;
  if (p === 'brew') out.push('風浪一點一點變大、天色越來越沉：颱風可能要來了，船先開回港裡比較安全', '颱風來之前，海裡會冒出平常少見的魚');
  else if (p === 'typhoon') out.push('颱風正在經過：浪又高又亂，別出海');
  else if (p === 'omen') out.push('海面忽然安靜下來，遠方傳來低鳴：巨浪要來了', '在船上的話往深海開，在岸上的話往高處跑');
  else if (p === 'waves') out.push('巨浪正在打過來');
  else if (p === 'storm') out.push('暴風雨正在經過：浪很大，可能會冒出水龍捲');
  else if (p === 'thunder') out.push('雷雨：會打雷，浪也比較大');
  else if (p === 'whirl') out.push('海上出現漩渦：別把船開過去');
  else danger = false;
  if (sea.after > 0 && p === 'calm') out.push('風暴剛過去：海裡有平常釣不到的魚和漂流物');
  if (!out.length) out.push('海上很平靜，看不出異狀');
  return { list: out, danger };
}
