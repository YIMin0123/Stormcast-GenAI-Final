// 主頁（填名字、挑房間那一頁）的公告，以及「距離下次刷新」倒數的算法。改公告只要改下面的文字。
// 不碰畫面、不依賴 three：瀏覽器與伺服器都能 import。
import { SERVER } from './config.js';

export const NOTICE = {
  title: '公告',
  items: [
    '海裡有 36 種魚和 10 種雜物，分普通、少見、稀有三級，各處水域、時段、天氣釣到的都不一樣。',
    '商店東邊的工作台賣餌：按 B 換餌，每拋一次竿用掉一個，越貴的餌越容易釣到少見、稀有的魚。',
    '每隔一段時間會全服刷新：錢、船、裝備、還沒賣的魚和排行榜全部重來，倒數見下方。',
    '操作：WASD 移動、F 釣魚（按住蓄力）、E 互動、B 換餌、G 表情、M 地圖、C 視角、Enter 聊天。',
  ],
};

// 下一次全服刷新的時間（毫秒時間戳）：從 SERVER.refresh.first 起每 everyHours 小時一次
export function nextRefreshAt(now = Date.now()) {
  const first = Date.parse(SERVER.refresh.first), every = SERVER.refresh.everyHours * 3600 * 1000;
  return now <= first ? first : first + Math.ceil((now - first) / every) * every;
}

// 倒數的文字：「1 天 3 時 12 分 08 秒」（不足一天不顯示天）
export function countdownText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d ? `${d} 天 ` : ''}${pad(h)} 時 ${pad(m)} 分 ${pad(sec)} 秒`;
}

// 刷新的時刻（台灣時間），例如「11 月 15 日 08:00」
export function refreshLabel(at) {
  const t = new Date(at + 8 * 3600 * 1000);   // 轉成台灣時間（UTC+8）再用 UTC 欄位讀
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getUTCMonth() + 1} 月 ${t.getUTCDate()} 日 ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}
