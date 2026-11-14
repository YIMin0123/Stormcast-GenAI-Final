// 海上的魚群熱點、風暴後的漂流寶箱：數字和位置。不碰畫面，瀏覽器和伺服器共用。
import { HAVEN, REEF_FRAMES } from './frame.js';

// 魚群熱點（海鳥盤旋、水面翻白沫）：每隔 every 秒冒出一個、維持 life 秒（都是範圍，隨機取）；半徑 r 公尺；
// 出現在離地圖正中間 reach 公尺以內、水夠深、離大島夠遠的海面。拋進圈裡：等咬的時間乘 biteK、魚的個頭大一截
export const HOTSPOT = { every: [240, 420], life: [130, 180], r: 28, reach: 620, minDepth: 10, minOff: 120, biteK: 0.45 };

// 漂流寶箱：暴風雨、颱風、海嘯結束後，從下面這些地方隨機挑 count 個各放一箱，life 秒沒人撿就漂走。
// 撿到的是獎金（cash 的範圍）或一桶油（fuel 的機率）。at：哪一套座標；y：有寫的照它（洞裡的岩台是下層，查地面查不到）
export const CHESTS = {
  count: 4, life: 900, cash: [150, 500], fuel: 0.3, reach: 2.6,
  spots: [
    { at: 'haven', x: 1.1, z: -122.6 },             // 瀑布的水簾後面
    { at: 'haven', x: -32.9, z: -111.4, y: 0.5 },   // 透天洞穴裡的岩台
    { at: 'haven', x: -45.5, z: -162.8 },           // 暗門外面的海蝕溝
    { at: 'haven', x: 47, z: -105 },                // 山頂的湧泉池邊
    { at: 'haven', x: -15, z: -46.5 },              // 碼頭的石坡道底下
    { at: 'atoll', x: 20, z: 0 }, { at: 'atoll', x: -30, z: 10 },   // 環礁的礁盤上
    { at: 'arch', x: 24, z: 6 },                    // 石拱門的腳邊
    { at: 'beacon', x: 5, z: 3 },                   // 燈標岩嶼上
  ],
};

// 世界座標版
const frameOf = (at) => (at === 'haven' ? HAVEN : REEF_FRAMES[at]);
const world = (p, at = 'haven') => { const [x, z] = frameOf(at).toWorld(p.x, p.z); return { x, z }; };
export const CHEST_SPOTS_W = CHESTS.spots.map((s) => ({ ...world(s, s.at), y: s.y, at: s.at }));
