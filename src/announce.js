// 主頁（填名字、挑房間那一頁）的公告，以及「距離下次刷新」倒數的算法。改公告只要改下面的文字。
// 不碰畫面、不依賴 three：瀏覽器與伺服器都能 import。
import { SERVER } from './config.js';

// 刷新週期簡稱，例如「每週」或「72h」（由 SERVER.refresh 推算，不寫死）
export function refreshPeriodTag() {
  const every = SERVER.refresh.everyHours;
  return every === 168 ? '每週' : Number.isInteger(every / 24) ? `每 ${every / 24} 天` : `${every}h`;
}

// 刷新規則的文字，例如「每週日台灣時間 05:00」（由 SERVER.refresh 推算，不寫死）
export function refreshRule() {
  const every = SERVER.refresh.everyHours, days = every / 24, t = new Date(Date.parse(SERVER.refresh.first) + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const period = days === 7 ? `每週${'日一二三四五六'[t.getUTCDay()]}` : Number.isInteger(days) ? `每 ${days} 天` : `每 ${every} 小時`;
  return `${period}台灣時間 ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

export const NOTICE = {
  title: '公告',
  items: [
    '海裡有 36 種魚和 10 種雜物，分普通、少見、稀有三級，各處水域、時段、天氣釣到的都不一樣。',
    `${refreshPeriodTag()}定時全服刷新（${refreshRule()}）：錢、船、裝備、還沒賣的魚和排行榜全部重來（圖鑑與等級會留著；漁會稱號另外每週一清晨 5 點重新計算）。`,
  ],
};

// 更新資訊：最新的放最上面。每次上線前加一條（id 用日期 YYYY-MM-DD，同一天多條就加 -a、-b、-c……，字串比大小就是新舊；不要用 -10，字串比起來會比 -9 小）。
// 主頁公告顯示最近幾條、平板的「公告」app 全部列出；玩家沒看過的就亮小紅點（見 updates.js）。寫給玩家看的，別寫工程細節
export const UPDATES = [
  {
    id: '2026-11-17-b', date: '11 月 17 日', title: '四種魚餌各有用法、餌價會漲會跌',
    items: [
      '四種餌都改成 8 個一份、基本價 $100，不再是越貴越好，看要釣什麼來選：',
      '蝦餌：魚咬得比較快，礁石、沿岸、小河和秘境的魚比較愛。小魚餌：釣起來的魚重 12%，鮪魚、鬼頭刀、紅甘這些外海迴游魚比較愛。',
      '花枝餌：少釣到雜物和小魚，白帶魚、旗魚、鯊魚這些夜裡和深海的魚比較愛。特級亮片餌：最容易釣到稀有魚，大魚收線時也掙扎得比較小力。',
      '餌價每間房各自浮動：有人買哪種，那種就漲、其他三種跟著降；一陣子沒人買會慢慢回到 $100。價格牌上會標「特價↓」或「熱銷↑」，撿便宜的換著用吧！',
    ],
  },
  {
    id: '2026-11-17-a', date: '11 月 14 日～17 日', title: '近期更新總整理',
    items: [
      '平板（按 Tab，手機是右上角的平板鈕）：地圖、叫船換船、天氣、圖鑑、背包、房間、榜單、祭壇、公告都在裡面。',
      '船怎麼修、怎麼買都換了地方：開進「海上修船屋」或大港船塢修船、買船、升級；漁船有魚艙，大漁船還能爬上二樓瞭望台。',
      '船隊（最多 6 人）：平板「房間」可以組隊、申請加入，有隊長和隊伍聊天；同隊經驗多、賣魚分紅，還能幫隊友掌舵；船壞了也能請人拖回港。',
      '等級與漁會捐贈榜：釣魚、賣魚、捐款都會累積經驗；每週捐贈榜前幾名有專屬稱號。',
      '釣魚更有節奏：浮標輕輕點頭是試探，別太早拉；同一處釣太多魚群會散，用「誘魚桶」打窩。魚是釣到的人的，賣出的錢也歸釣到的人。',
      '海上多了海鷗、海豚、海龜和鯨魚，36 種魚也重新做得更漂亮。',
      '房間人少時會自動合併（上方跑馬燈倒數）、一間房到 20 人就開下一間；連線超過 10 分鐘沒操作會被請出房間，進度都會存著。',
      '畫面更順：手機的影子不再一格一格跳、預設 60 FPS，電腦設定也有「動態調整畫質」。',
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

// 刷新的時刻（台灣時間），例如「11 月 15 日 08:00」
export function refreshLabel(at) {
  const t = new Date(at + 8 * 3600 * 1000);   // 轉成台灣時間（UTC+8）再用 UTC 欄位讀
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getUTCMonth() + 1} 月 ${t.getUTCDate()} 日 ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}
