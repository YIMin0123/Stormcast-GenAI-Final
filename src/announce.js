// 主頁（填名字、挑房間那一頁）的公告，以及「距離下次刷新」倒數的算法。改公告只要改下面的文字。
// 不碰畫面、不依賴 three：瀏覽器與伺服器都能 import。
import { SERVER } from './config.js';

export const NOTICE = {
  title: '公告',
  items: [
    '海裡有 36 種魚和 10 種雜物，分普通、少見、稀有三級，各處水域、時段、天氣釣到的都不一樣。',
    '每隔一段時間會全服刷新：錢、船、裝備、還沒賣的魚和排行榜全部重來（圖鑑會留著）。',
  ],
};

// 更新資訊：最新的放最上面。每次上線前加一條（id 用日期 YYYY-MM-DD，同一天多條就加 -2、-3，字串比大小就是新舊）。
// 主頁公告顯示最近幾條、平板的「公告」app 全部列出；玩家沒看過的就亮小紅點（見 updates.js）。寫給玩家看的，別寫工程細節
export const UPDATES = [
  {
    id: '2026-11-17', date: '11 月 17 日', title: '釣魚節奏調整、魚市場新攤位、新的主頁',
    items: [
      '主頁改成簡潔的標題頁：全服刷新倒數放進主卡，右上角有「公告」，有沒看過的更新會亮小紅點；平板也新增了「公告」app。',
      '釣魚節奏調整：魚上鉤的等待時間不再因釣竿升級縮短（釣竿改成影響拋竿距離與收線的穩定度）；浮標輕輕點頭是試探，太早拉竿會把魚嚇跑。',
      '同一片海域連續釣太多條，魚群會受驚；換個地方，或在魚市場買「誘魚桶」（按 U 使用）打窩，就能聚集一批魚。海上的魚群也維持得比較久。',
      '釣竿、船、引擎的升級上限提高到 Lv5。魚箱改成每人限買 1 個，但容量更大。',
      '魚市場新增攤位：船殼塗裝（買了可在平板的「船」app 換色，別人看得到）、探魚聲納、自動抽水龍骨、船首集魚燈，以及榮譽頭銜石碑（頭銜在全服刷新後會永久保留）。',
      '平板背包可以花錢向海神祈福：「黃金魚潮」讓全服 5 分鐘更容易釣到少見與稀有魚，「風暴海神祭」會立刻召喚風暴。',
      '修正：魚和魚箱放在船艙蓋上不再穿進去、人物站在碼頭邊緣的範圍更準、海鷗盤旋時不再上下浮動。手機預設改成 60 FPS，並新增 45 FPS 選項。',
    ],
  },
  {
    id: '2026-11-15', date: '11 月 15 日', title: '魚箱、擱淺、海浪',
    items: [
      '魚箱浮在水裡也拿得到：游到自己的魚箱旁邊會自動抱起來（抱著魚箱游比較慢、比較累，上岸或爬上船再放下）。',
      '開船時，畫面上魚箱標籤顯示的距離改成照船的位置算，不再偏掉。',
      '擱淺的船可以脫困：低速倒車、前進、轉向都能用，只是不能再開上陸地。',
      '地圖上掌舵的人，名字會跟著他的船走。',
      '海浪往前推的速度放慢了，看起來比較自然。',
      '海上的大事件（風暴、雷暴雨、巨浪、漩渦）改成平靜 30 分鐘才來一次。',
      '伺服器更新重開之後，會自動幫你重新進入同一間房，不用再按「回到大廳」。',
    ],
  },
  {
    id: '2026-11-14', date: '11 月 14 日', title: '平板、魚箱與海上的動物',
    items: [
      '新增平板（按 Tab，手機是右上角的平板鈕）：地圖、船（叫船、換船）、天氣、圖鑑、背包、房間、設定都在裡面。',
      '魚箱可以抱著搬，也能把魚或整個魚箱送給旁邊的人；放在外面的魚大家看得到，誰先撿到算誰的。',
      '海上和岸邊多了海鷗、海豚、海龜、魚群、螃蟹、鯨魚和鯊魚背鰭，出入水都有水花；單隻海鷗的叫聲聽得出方向。',
      '拿掉了島上一直在響的鳥叫聲。',
      '要更新時，畫面上方會出現全服公告（跑馬燈）和倒數。',
    ],
  },
];

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

// 刷新規則的文字，例如「每 3 天台灣時間 05:00」（由 SERVER.refresh 推算，不寫死）
export function refreshRule() {
  const every = SERVER.refresh.everyHours, days = every / 24, t = new Date(Date.parse(SERVER.refresh.first) + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${Number.isInteger(days) ? `每 ${days} 天` : `每 ${every} 小時`}台灣時間 ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

// 刷新的時刻（台灣時間），例如「11 月 15 日 08:00」
export function refreshLabel(at) {
  const t = new Date(at + 8 * 3600 * 1000);   // 轉成台灣時間（UTC+8）再用 UTC 欄位讀
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getUTCMonth() + 1} 月 ${t.getUTCDate()} 日 ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}
