// 介面上的小圖示（線條畫，顏色跟著文字走）。網頁裡寫 <i data-ic="名字"></i> 的地方會自動換成圖示。
const svg = (inner) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const p = (d) => `<path d="${d}"/>`;

export const ICON = {
  // 互動：一隻手
  hand: svg(p('M8 13V6.5a1.5 1.5 0 0 1 3 0V11') + p('M11 11V4.5a1.5 1.5 0 0 1 3 0V11') + p('M14 11V6.5a1.5 1.5 0 0 1 3 0V16a5 5 0 0 1-5 5h-.6a5 5 0 0 1-4-2l-3.3-4.5a1.5 1.5 0 0 1 2.3-1.9L8 14.5')),
  // 放下、放進去：往下的箭頭和一個盤子
  drop: svg(p('M12 3v11') + p('M7.5 9.5L12 14l4.5-4.5') + p('M4 16v4h16v-4')),
  // 換餌：一個魚鉤
  bait: svg(p('M12 3v10') + p('M12 13a4 4 0 1 1-4 4') + p('M6 15l2 2 2-2')),
  // 放手、站起來：離開的箭頭
  leave: svg(p('M10 4H5v16h5') + p('M14 8l4 4-4 4') + p('M9 12h9')),
  // 釣魚：一條魚
  fish: svg(p('M2.5 12c3-4.5 9-5.5 13-2.5l5-3.5v12l-5-3.5c-4 3-10 2-13-2.5z') + '<circle cx="7.5" cy="11.3" r="0.6" fill="currentColor"/>'),
  // 跳：往上的箭頭和地面
  jump: svg(p('M12 17V4') + p('M6.5 9.5L12 4l5.5 5.5') + p('M5 21h14')),
  map: svg(p('M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z') + p('M9 4v13.5') + p('M15 6.5V20')),
  chat: svg(p('M4 5h16v11H10.5L6 20v-4H4z')),
  emote: svg('<circle cx="12" cy="12" r="9"/>' + p('M8.5 14.5c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2') + '<circle cx="9" cy="9.8" r="0.7" fill="currentColor"/><circle cx="15" cy="9.8" r="0.7" fill="currentColor"/>'),
  // 視角：一隻眼睛
  view: svg(p('M2 12c3-4.7 6.3-7 10-7s7 2.3 10 7c-3 4.7-6.3 7-10 7s-7-2.3-10-7z') + '<circle cx="12" cy="12" r="3"/>'),
  // 全螢幕：四個角
  full: svg(p('M4 9V4h5') + p('M15 4h5v5') + p('M20 15v5h-5') + p('M9 20H4v-5')),
  // 船的耐久：一艘船
  boat: svg(p('M3 15h18l-2.5 5h-13z') + p('M11 3v9') + p('M11 4l7 8h-7')),
  // 燃油：一滴油
  fuel: svg(p('M12 3c3.5 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2.5-6.5 6-11z')),
  // 船速：儀表
  speed: svg(p('M4 18a8 8 0 1 1 16 0') + p('M12 18l4-6.5')),
  // 丟：往前上方拋出去的弧線箭頭
  throw: svg(p('M4 19c1.5-7 6.5-12 15-13') + p('M14 3.5l5 2.5-2.5 5') + '<circle cx="5" cy="19" r="1.6" fill="currentColor"/>'),
  // 錢：一枚銅板
  coin: svg('<circle cx="12" cy="12" r="9"/>' + p('M14.6 9.3c-.5-.9-1.5-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2s1.2 1.6 2.7 1.9c1.5.4 2.7.9 2.7 2.2 0 1.2-1.2 2-2.7 2-1.2 0-2.2-.6-2.7-1.5') + p('M12 6.2v1.6M12 16.2v1.6')),
  // 體力：閃電
  bolt: svg(p('M13 2L5 14h6l-1 8 8-12h-6z')),
};

for (const e of document.querySelectorAll('[data-ic]')) e.innerHTML = ICON[e.dataset.ic] || '';
