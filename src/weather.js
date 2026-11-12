// 海況與天氣：日夜時間、每天的天氣，以及偶爾隨機發生的海上事件——
//   風暴、雷暴雨、颱風：整片海慢慢變兇；外海還可能冒出水龍捲
//   巨浪：海面先異常平靜，接著幾道浪牆從外海橫掃過來
//   漩渦：外海的水面慢慢轉出一個大洞，把船往裡拉
// 沒有警報，只有前兆：天色變暗、雲變厚、遠方的低鳴。離陸地越遠越危險，島的周圍與港口不受影響。

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 巨浪的形狀：三道三十公尺上下的水牆，前緣陡、背面緩，浪腳前面的海面先陷下去。shader 與這裡用同一組數字
export const TSU = {
  gap: 260,                 // 浪與浪的間距（公尺）
  k: [0.6, 1.0, 0.75],      // 三道浪各自的高度比例：第二道最大
  wf: 1.15, wb: 2.6,        // 前緣與背面的寬度（乘上浪高）
  trough: 0.2, tAt: 2.3, tW: 1.6,   // 浪前的凹陷：深度（佔浪高的比例）、在浪頭前方多遠、多寬（後兩個乘上前緣寬）
  speed: 22,                // 前進速度（公尺/秒）
  reach: 1500,              // 從地圖外多遠開始、到多遠結束
  push: 0.3,                // 浪頭上的水往前衝的速度（佔浪速的比例）：船在浪頭上會被往前推
};
// 捲浪：正在破的那幾段（以及靠近島、撐不住的整道浪），浪頂的水跑得比浪快，
// 正面先被推成凹進去的陡壁，浪頂再往前拋出去、照拋物線落下，砸在浪腳上
// 海面本身的網格往前捲（不是另外貼一片）：浪頂附近的水面沿著兩條拋物線落下——上面那條從浪頂水平拋出去，
// 底面那條從浪壁頂端略往上拋，兩條同時落到同一點（捲舌的尖端），中間夾著越來越薄的水舌，底下是空腔
export const CURL = {
  a0: 1.2,          // 浪的正面從浪頂往下、被往前推成陡壁的範圍（乘上前緣寬）
  lean: 0.667,      // 推到多陡：這個值剛好讓浪壁的上半段接近垂直
  aU: 0.15,         // 浪頂後方這一段的水面變成捲舌的上面（乘上背面寬）
  aL: 0.39,         // 浪頂前方這一段的水面變成捲舌的底面（乘上前緣寬）；再往下是浪壁
  u: 9.2,           // 浪頂的水比浪快多少（公尺/秒）：捲舌往前拋的速度
  g: 9.8,           // 重力
  fall: 0.72,       // 捲舌的尖端落下多少（佔浪高的比例）會砸到浪腳
  dense: 4,         // 海面的網格在浪頂附近加密幾倍（捲起來的形狀才圓滑）
};
// 海嘯到之前岸邊的海水先退下去：深度（佔浪高的比例）；第一道浪前面從多遠開始退、退到底；
// 浪頭前面多近開始漲回來；後面兩道浪之間退到幾成
export const EBB = { depth: 0.075, far: 1000, full: 350, n0: 40, n1: 110, g0: 240, g1: 170, between: 0.8, k0: 0.6, k1: 0.25 };

// 颱風的長浪（湧）：風在幾百公里的海面上吹出來的、又長又高的浪，颱風還沒到它就先到了。
// 波長一兩百到三百公尺，一座一座像會移動的小山；坡很緩（船順著爬上去、滑下來），但浪谷裡看不到地平線。
// 三道波長、方向略有出入的浪疊在一起，所以是一組一組地來：有時連著幾道特別高，有時小一點。
// amp：三道同時到頂時的高度（公尺）；waves：[波長, 佔幾成, 跟風向差幾弧度]。速度照深水波算（越長的浪跑越快）
export const SWELL = { amp: 6.5, waves: [[310, 0.5, 0], [215, 0.32, 0.22], [150, 0.18, -0.31]] };
export const SWELL_K = SWELL.waves.map(([lam, a, ang]) => ({ a, k: 2 * Math.PI / lam, w: Math.sqrt(9.8 * 2 * Math.PI / lam), c: Math.cos(ang), s: Math.sin(ang) }));
// 長浪在 (x, z) 的高度（-1 到 1，還沒乘上 amp 和當下的強度）。dx, dz：風（浪）往哪邊走
export function swellAt(x, z, t, dx, dz) {
  let h = 0;
  for (const w of SWELL_K) h += w.a * Math.sin((x * (w.c * dx - w.s * dz) + z * (w.s * dx + w.c * dz)) * w.k - t * w.w);
  return h;
}
// 浪頭不是一條筆直等高的線：沿著浪線（l）有的地方高、有的地方矮，位置也前後參差。
// 回傳 [高度倍率, 往前挪多少公尺]；i：第幾道浪；seed：這一次事件的亂數
export function tsuCrest(i, l, seed) {
  return [
    1 + 0.16 * Math.sin(l * 0.009 + 1.7 * i + seed) + 0.09 * Math.sin(l * 0.023 + 2.9 * i + 2 * seed),
    26 * Math.sin(l * 0.0052 + 2.3 * i + 1.3 * seed) + 10 * Math.sin(l * 0.0151 + 4.1 * i + 0.7 * seed),
  ];
}

// 危險係數（0–255）：離最近的陸地越遠越大。島周圍約 60 公尺內是 0，320 公尺外是滿的
export function computeDanger(bed, N, L) {
  const DX = L / N, d = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) d[k] = bed[k] > 0 ? 0 : 1e9;
  // 兩趟掃描的近似距離變換
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) {
        v = Math.min(v, d[k - N] + 1);
        if (i > 0) v = Math.min(v, d[k - N - 1] + 1.414);
        if (i < N - 1) v = Math.min(v, d[k - N + 1] + 1.414);
      }
      d[k] = v;
    }
  }
  for (let j = N - 1; j >= 0; j--) {
    for (let i = N - 1; i >= 0; i--) {
      const k = j * N + i;
      let v = d[k];
      if (i < N - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < N - 1) {
        v = Math.min(v, d[k + N] + 1);
        if (i < N - 1) v = Math.min(v, d[k + N + 1] + 1.414);
        if (i > 0) v = Math.min(v, d[k + N - 1] + 1.414);
      }
      d[k] = v;
    }
  }
  const out = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const t = clamp((d[k] * DX - 60) / 260, 0, 1);
    out[k] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  return out;
}

// 巨浪到了每個地方還剩幾成高（0–255）：外海是十成；越靠近陸地越矮（浪在淺水破掉了），到岸邊剩 SHORE；
// 沖上岸之後越往內陸越弱，約 150 公尺就沒了。浪就是靠這張圖沖上沙灘、淹進港口的
export function computeTsuK(bed, danger, N, L, SHORE = 0.16) {
  const DX = L / N, d = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) d[k] = bed[k] > 0 ? 1e9 : 0;   // 陸地上的每一格離最近的海多遠
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) {
        v = Math.min(v, d[k - N] + 1);
        if (i > 0) v = Math.min(v, d[k - N - 1] + 1.414);
        if (i < N - 1) v = Math.min(v, d[k - N + 1] + 1.414);
      }
      d[k] = v;
    }
  }
  for (let j = N - 1; j >= 0; j--) {
    for (let i = N - 1; i >= 0; i--) {
      const k = j * N + i;
      let v = d[k];
      if (i < N - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < N - 1) {
        v = Math.min(v, d[k + N] + 1);
        if (i < N - 1) v = Math.min(v, d[k + N + 1] + 1.414);
        if (i > 0) v = Math.min(v, d[k + N - 1] + 1.414);
      }
      d[k] = v;
    }
  }
  const out = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const inland = clamp((d[k] * DX - 25) / 125, 0, 1);
    out[k] = Math.round(255 * (SHORE + (1 - SHORE) * danger[k] / 255) * (1 - inland * inland * (3 - 2 * inland)));
  }
  return out;
}

// 漩渦與水龍捲的形狀（shader 與這裡用同一組數字）
//   rc：拉力最強的半徑；vin / vt：最強處往中心拉、繞圈的速度（公尺/秒）；far：超過這個距離就沒有影響
//   core：進到這個半徑內船就完了；h：水面凹下去（負）或隆起（正）的高度；hw：凹陷或隆起的寬度
export const VORTEX = {
  // 大漩渦照真實的渦流來（蘭金渦）：核心（半徑 rc）裡的水像一整塊在轉，越靠中心越慢；核心外面流速跟距離成反比。
  // 水面的形狀是流速決定的：中心凹下去的深度 = 最大流速² ÷ 重力，核心邊緣剛好是一半深，往外跟距離平方成反比。
  // 外海只有三十公尺深，所以漏斗做到二十六公尺（再深就挖到海床了）；洞口（陷下去超過一公尺的範圍）直徑約兩百三十公尺
  //   vt：核心邊緣的流速（= √(9.8 × 深度)）；kin0–kin1：往中心流的速度佔繞圈速度的幾成（kr0 → kr1 公尺之間越靠近越大）
  whirl: { rc: 32, vt: Math.sqrt(9.8 * 26), h: -26, far: 460, core: 24, kin0: 0.1, kin1: 0.2, kr0: 80, kr1: 32 },
  // 水龍捲是個龐然大物（漏斗腳下的半徑就有四十幾公尺），幾百公尺外就感覺得到它在拉
  spout: { rc: 80, vin: 3.2, vt: 7, far: 380, core: 46, h: 3, hw: 55 },
};
// 水龍捲周圍的風：繞著它轉、越靠近越強，一陣一陣的。吹在船身上會把船壓歪（橫著受風最危險）
const SPOUT_WIND = { rc: 80, far: 340 };
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TOPU = 1 / Math.cosh(CURL.aU) ** 2;
// shader 裡 tsuCurlPos 的反函數（只算浪壁和背面，不含拋出去的捲舌）：浪頂被往前推之後，
// 「浪頂原本位置前方 q 公尺」那裡的水面，原本是斷面上的哪一點。回傳 a（離浪頂多遠 ÷ 浪寬，正的是正面）
function curlA(q, B, wf, wb) {
  const S = CURL.lean * CURL.a0 * wf * B;
  if (q >= S) {
    if (q >= CURL.a0 * wf) return q / wf;
    let lo = 0, hi = CURL.a0;
    for (let i = 0; i < 12; i++) {
      const a = 0.5 * (lo + hi), x = 1 - a / CURL.a0;
      if (a * wf + S * x * Math.sqrt(x) < q) lo = a; else hi = a;
    }
    return 0.5 * (lo + hi);
  }
  const Bw = smooth(0.25, 0.85, B), S2 = S + Bw * CURL.aU * wb, x0 = S - (1 - Bw) * CURL.aU * wb;
  if (q >= x0) return -CURL.aU * (S - q) / Math.max(S - x0, 1e-6);
  let lo = (q - S2) / wb, hi = -CURL.aU;
  for (let i = 0; i < 12; i++) {
    const a = 0.5 * (lo + hi), c = 1 / Math.cosh(Math.max(a, -12)), top = c * c / TOPU;
    if (a * wb + S2 * top * Math.sqrt(top) < q) lo = a; else hi = a;
  }
  return 0.5 * (lo + hi);
}

const CALM = { storm: 0, gloom: 0, lull: 1, rumble: 0, rain: 0, surge: 0, thunder: 0, swell: 0 };

// 海上的事件。平常是 calm，偶爾隨機發生一種：
//   storm 風暴、thunder 雷暴雨、omen → waves 巨浪、whirl 漩渦、brew → typhoon 颱風
// 風暴、雷暴雨、颱風時外海還可能出現水龍捲
export class Sea {
  constructor() {
    this.phase = 'calm';
    this.t = 0;                      // 這個階段已經過了多久
    this.next = rand(480, 840);      // 平靜多久之後發生下一次（8–14 分鐘）
    this.typhoonIn = rand(5400, 9000); // 颱風好幾個遊戲日才來一次（這裡是累計的平靜秒數）
    // 這些值都是慢慢變的，海才會「漸漸」不對勁
    this.storm = 0;                  // 外海的浪放大 (1 + storm) 倍
    this.gloom = 0;                  // 天色：0 晴朗、1 陰沉
    this.lull = 1;                   // 風浪倍率：巨浪來之前海面會平靜下來
    this.rumble = 0;                 // 遠方的低鳴（給聲音用）
    this.rain = 0;                   // 雨勢
    this.surge = 0;                  // 颱風時連島邊的浪也變大（0–1）
    this.thunder = 0;                // 打雷的頻繁程度（0–1）
    this.swell = 0;
    this.goal = { ...CALM };
    this.slow = 1;                   // 變化放慢的倍數（颱風來之前要醞釀很久）
    this.tsu = { on: false, dx: 0, dz: 1, front: 0, H: 0, seed: 0 };
    this.vortices = [];              // 漩渦與水龍捲：{ kind, x, z, vx, vz, s, age, life }
    this.spoutIn = Infinity;         // 再過幾秒可能冒出一道水龍捲
    this.spoutLeft = 0;
  }

  // 讓一次事件現在開始。已經有事件在進行就不理會。env：{ near: {x, z}, dangerAt(x, z) }
  trigger(kind, env) {
    if (this.phase !== 'calm') return false;
    if (!kind) { const r = Math.random(); kind = r < 0.3 ? 'storm' : r < 0.55 ? 'thunder' : r < 0.8 ? 'tsunami' : 'whirl'; }
    this.t = 0; this.slow = 1;
    if (kind === 'storm' || kind === 'spout') {
      this.phase = 'storm';
      this.dur = rand(170, 230);
      this.goal = { ...CALM, storm: rand(0.9, 1.3), gloom: 0.9, rumble: 0.35, rain: 0.7, thunder: 0.35, swell: 0.3 };
      this.spoutLeft = kind === 'spout' || Math.random() < 0.6 ? 1 : 0;
      this.spoutIn = kind === 'spout' ? 6 : rand(50, 110);
    } else if (kind === 'thunder') {
      this.phase = 'thunder';
      this.dur = rand(150, 200);
      this.goal = { ...CALM, storm: rand(0.45, 0.75), gloom: 1, rumble: 0.3, rain: 1, thunder: 1 };
      this.spoutLeft = Math.random() < 0.4 ? 1 : 0;
      this.spoutIn = rand(50, 100);
    } else if (kind === 'typhoon') {
      // 先醞釀七分鐘：風浪一點一點變大、天色越來越沉，然後才是最猛的五分鐘
      this.phase = 'brew';
      this.dur = 420; this.slow = 5;
      this.goal = { ...CALM, storm: 0.6, gloom: 0.7, lull: 1.2, rumble: 0.3, rain: 0.4, surge: 0.35, swell: 0.5 };
      this.typhoonIn = rand(5400, 9000);
    } else if (kind === 'whirl') {
      if (!this._spawn('whirl', env)) return false;
      this.phase = 'whirl';
      this.goal = { ...CALM, gloom: 0.3, rumble: 0.45 };
    } else {
      this.phase = 'omen';
      this.dur = 45;
      this.goal = { ...CALM, gloom: 0.65, lull: 0.3, rumble: 0.5 };
      const a = rand(0, Math.PI * 2);
      this.tsu = { on: false, dx: Math.cos(a), dz: Math.sin(a), front: -TSU.reach, H: rand(26, 34), seed: rand(0, 6.28) };
    }
    return true;
  }

  // 在外海找一個地方生成漩渦或水龍捲：離玩家的船不遠（看得到、有時間躲），但不會直接出現在腳下
  _spawn(kind, env) {
    if (!env) return false;
    // 水龍捲很大，要生在更遠的地方（不然一出現船就在它的風圈裡）
    const spout = kind === 'spout', dMin = spout ? 520 : 400, dMax = spout ? 820 : 680;   // 大漩渦四百公尺外就感覺得到水流，也要生遠一點
    for (let n = 0; n < 80; n++) {
      const a = rand(0, Math.PI * 2), d = rand(dMin, dMax);
      const x = (n < 50 ? env.near.x : 0) + Math.cos(a) * (n < 50 ? d : rand(0, 850));
      const z = (n < 50 ? env.near.z : 0) + Math.sin(a) * (n < 50 ? d : rand(0, 850));
      if (Math.abs(x) > 900 || Math.abs(z) > 900 || env.dangerAt(x, z) < 0.9) continue;
      if (Math.hypot(x - env.near.x, z - env.near.z) < dMin * 0.8) continue;
      // 水龍捲大致朝著船這邊過來（偏個幾十度），不會一出現就往反方向走掉
      const va = spout ? Math.atan2(env.near.z - z, env.near.x - x) + rand(-0.9, 0.9) : 0, sp = spout ? rand(3, 5.5) : 0;
      this.vortices.push({ kind, x, z, vx: Math.cos(va) * sp, vz: Math.sin(va) * sp, s: 0, age: 0, life: spout ? rand(110, 150) : rand(190, 250) });
      return true;
    }
    return false;
  }

  update(dt, env) {
    this.t += dt;
    const p = this.phase;
    if (p === 'calm') {
      this.typhoonIn -= dt;
      if (this.typhoonIn <= 0) this.trigger('typhoon', env);
      else if (this.t > this.next) { if (!this.trigger(undefined, env)) this.t = this.next - 30; }
    } else if (p === 'storm' || p === 'thunder' || p === 'typhoon') {
      if (this.t > this.dur) {
        // 時間到了：還有水龍捲的話先讓它消散，等它縮回雲裡天才放晴
        const left = this.vortices.filter((v) => v.kind === 'spout');
        for (const v of left) if (v.age < v.life - 40) v.life = v.age + 40;
        this.spoutLeft = 0;
        if (!left.length) this._calm();
      }
    } else if (p === 'brew') {
      if (this.t > this.dur) {
        this.phase = 'typhoon'; this.t = 0; this.dur = 300; this.slow = 1.3;
        this.goal = { storm: 1.7, gloom: 1, lull: 1.3, rumble: 0.6, rain: 1, surge: 1, thunder: 0.6, swell: 1 };
        this.spoutLeft = 2; this.spoutIn = rand(40, 80);
      }
    } else if (p === 'omen') {
      if (this.t > this.dur) { this.phase = 'waves'; this.t = 0; this.tsu.on = true; this.goal.rumble = 1; }
    } else if (p === 'waves') {
      this.tsu.front += TSU.speed * dt;
      if (this.tsu.front - TSU.gap * 2 > TSU.reach) { this.tsu.on = false; this._calm(); }
    } else if (p === 'whirl') {
      if (!this.vortices.some((v) => v.kind === 'whirl')) this._calm();
    }

    // 風暴夠強了，外海才可能冒出水龍捲
    if (this.spoutLeft > 0 && this.storm > 0.4 && (this.spoutIn -= dt) <= 0) {
      if (this._spawn('spout', env)) this.spoutLeft--;
      this.spoutIn = rand(40, 80);
    }
    // 漩渦與水龍捲：慢慢成形、慢慢消散；水龍捲會移動，飄到島邊就散掉
    for (const v of [...this.vortices]) {
      v.age += dt;
      if (v.kind === 'spout') {
        v.x += v.vx * dt; v.z += v.vz * dt;
        const turn = Math.sin(v.age * 0.13 + v.life) * 0.12 * dt, c = Math.cos(turn), s = Math.sin(turn);
        [v.vx, v.vz] = [v.vx * c - v.vz * s, v.vx * s + v.vz * c];
        // 靠近陸地、或風暴已經過去，就開始消散（留夠時間讓漏斗變細、縮回雲裡）
        const fade = (env && env.dangerAt(v.x, v.z) < 0.6) || this.phase === 'calm';
        if (fade && v.age < v.life - 40) v.life = v.age + 40;
        // 海面先起白沫，漏斗垂到海面（約半分鐘）之後吸力和風才到最強
        v.s = smooth(6, 40, v.age) * smooth(0, 28, v.life - v.age);
      } else v.s = smooth(0, 55, v.age) * smooth(0, 35, v.life - v.age);   // 這麼大的漩渦要轉將近一分鐘才成形，散掉也要半分鐘
      if (v.age >= v.life) this.vortices.splice(this.vortices.indexOf(v), 1);
    }

    // 每樣東西變化的快慢不同（秒）：天色先變，海才跟著變；風暴來得慢，巨浪前的平靜來得比較快
    const tau = { storm: this.goal.storm > this.storm ? 32 : 20, gloom: 14, lull: 9, rumble: 12, rain: 14, surge: 30, thunder: 10, swell: 26 };
    for (const key in tau) this[key] += (this.goal[key] - this[key]) * (1 - Math.exp(-dt / (tau[key] * this.slow)));
  }

  _calm() {
    this.phase = 'calm'; this.t = 0; this.slow = 1;
    this.next = rand(480, 840);
    this.goal = { ...CALM };
    this.spoutLeft = 0;
  }

  // 巨浪在 (x, z) 的高度（還沒乘上危險係數）
  heightAt(x, z) {
    const T = this.tsu;
    if (!T.on) return 0;
    const s = x * T.dx + z * T.dz - T.front;   // 在浪頭前方為正
    const l = x * T.dz - z * T.dx;             // 沿著浪線的位置
    const wf = TSU.wf * T.H, wb = TSU.wb * T.H;
    let h = 0;
    for (let k = 0; k < 3; k++) {
      const [amp, shift] = tsuCrest(k, l, T.seed);
      const q = s + k * TSU.gap + shift;
      const c = 1 / Math.cosh(clamp(q / (q > 0 ? wf : wb), -12, 12));
      const t = 1 / Math.cosh(clamp((q - TSU.tAt * wf) / (TSU.tW * wf), -12, 12));
      h += TSU.k[k] * amp * (c * c - TSU.trough * t * t);
    }
    return h * T.H;
  }

  // 浪頭的這一段捲得多兇（0–1）：跟 shader 的 tsuBreak 同一條式子，所以船感受到的跟畫面上看到的是同一段
  breakOf(l, br, tK, time) {
    return Math.max(br * smooth(0.15, 0.75, 0.5 + 0.5 * Math.sin(time * 0.45 + l * 0.018)), smooth(0.97, 0.80, tK)) * smooth(0.30, 0.50, tK);
  }

  // 巨浪在 (x, z) 的高度，把「捲起來」算進去（還沒乘上 tK）：正在捲的那幾段，浪的正面被往前推成陡壁，
  // 船是貼著這面陡壁被托上去的。捲舌本身（拋出去的那片水）不算在高度裡——它是砸在船上的，見 jetAt
  heightCurl(x, z, tK, time) {
    const T = this.tsu;
    if (!T.on) return 0;
    if (tK <= 0.3) return this.heightAt(x, z);
    const s = x * T.dx + z * T.dz - T.front, l = x * T.dz - z * T.dx;
    const wf = TSU.wf * T.H, wb = TSU.wb * T.H;
    let h = 0;
    for (let k = 0; k < 3; k++) {
      const [amp, shift] = tsuCrest(k, l, T.seed);
      const q = s + k * TSU.gap + shift;
      let a = q / (q > 0 ? wf : wb), q0 = q;
      if (Math.abs(q) < TSU.gap / 2) {
        const B = this.breakOf(l, smooth(0.98, 1.14, amp + 0.06 * Math.sin(l * 0.061 + 5 * k)), tK, time);
        if (B > 0) { a = curlA(q, B, wf, wb); q0 = a * (a > 0 ? wf : wb); }
      }
      const c = 1 / Math.cosh(clamp(a, -12, 12));
      const t = 1 / Math.cosh(clamp((q0 - TSU.tAt * wf) / (TSU.tW * wf), -12, 12));
      h += TSU.k[k] * amp * (c * c - TSU.trough * t * t);
    }
    return h * T.H;
  }

  // 最近那道浪頭在這裡捲得怎麼樣：crestNear 的結果再加上 B（捲得多兇）、Bw（捲舌伸出去幾成）、
  // Hc（這一段的浪高，公尺）、land（拋出去的水落在浪頂原本位置的前方幾公尺）
  jetAt(x, z, tK, time) {
    const c = this.crestNear(x, z);
    c.B = this.breakOf(c.l, c.br, tK, time);
    c.Bw = smooth(0.25, 0.85, c.B);
    c.Hc = c.k * this.tsu.H * tK;
    c.land = CURL.lean * CURL.a0 * TSU.wf * this.tsu.H * c.B + c.Bw * CURL.u * Math.sqrt(2 * CURL.fall * Math.max(c.Hc, 0.1) / CURL.g);
    return c;
  }

  // 海嘯到之前岸邊的退潮（公尺，負的）。k：浪到這裡剩幾成高——只有岸邊、港裡退得明顯，外海感覺不到
  ebbAt(x, z, k) {
    const T = this.tsu;
    if (!T.on || k > EBB.k0) return 0;
    const s = x * T.dx + z * T.dz - T.front;
    let e = 0;
    for (let i = 0; i < 3; i++) {
      const q = s + i * TSU.gap;
      if (q > 0) e = Math.max(e, smooth(EBB.n0, EBB.n1, q) * (i ? EBB.between * smooth(EBB.g0, EBB.g1, q) : smooth(EBB.far, EBB.full, q)));
    }
    return -EBB.depth * T.H * e * smooth(EBB.k0, EBB.k1, k);
  }

  // 鏡頭或船離最近的浪頭多遠：回傳 { q, k, br }。q 為正 = 浪還沒到（在它前方幾公尺），為負 = 已經過去了；
  // k：那道浪在這裡的高度比例；br：浪頭的這一段有沒有在破（0–1，畫面上翻白的那幾段）
  crestNear(x, z) {
    const T = this.tsu, out = { q: 1e9, k: 0, br: 0, l: 0, i: -1 };
    if (!T.on) return out;
    const s = x * T.dx + z * T.dz - T.front, l = x * T.dz - z * T.dx;
    for (let k = 0; k < 3; k++) {
      const [amp, shift] = tsuCrest(k, l, T.seed), q = s + k * TSU.gap + shift;
      if (Math.abs(q) < Math.abs(out.q)) {
        out.q = q; out.k = TSU.k[k] * amp; out.l = l; out.i = k;
        out.br = smooth(0.98, 1.14, amp + 0.06 * Math.sin(l * 0.061 + 5 * k));
      }
    }
    return out;
  }

  // 漩渦讓水面凹下去、水龍捲腳下的水面隆起
  vortexH(x, z) {
    let h = 0;
    for (const v of this.vortices) {
      const V = VORTEX[v.kind], r2 = (x - v.x) ** 2 + (z - v.z) ** 2;
      if (r2 > V.far * V.far) continue;
      if (v.kind === 'whirl') h += v.s * V.h * (r2 < V.rc * V.rc ? 1 - r2 / (2 * V.rc * V.rc) : V.rc * V.rc / (2 * r2)) * smooth(V.far, V.far - 120, Math.sqrt(r2));
      else h += v.s * V.h * Math.exp(-r2 / (V.hw * V.hw));
    }
    return h;
  }

  // 離最近的漩渦多遠：回傳 { r, s }（沒有漩渦時 r 是 Infinity）
  whirlNear(x, z) {
    const out = { r: Infinity, s: 0 };
    for (const v of this.vortices) {
      if (v.kind !== 'whirl') continue;
      const r = Math.hypot(v.x - x, v.z - z);
      if (r < out.r) { out.r = r; out.s = v.s; }
    }
    return out;
  }

  // 漩渦與水龍捲對 (x, z) 處的船的拉扯：往中心拉、帶著繞圈。回傳 { x, z, spin, wx, wz }
  //   x, z：水流（公尺/秒）；spin：船頭被扭的速度（弧度/秒）；wx, wz：水龍捲的風（0–1 左右，最強處約 1）
  flowAt(x, z) {
    const out = { x: 0, z: 0, spin: 0, wx: 0, wz: 0 };
    for (const v of this.vortices) {
      const V = VORTEX[v.kind], dx = v.x - x, dz = v.z - z, r = Math.hypot(dx, dz);
      if (r < 0.01) continue;
      const ux = dx / r, uz = dz / r;
      if (v.kind === 'spout' && r < SPOUT_WIND.far) {
        // 漏斗真的碰到海面之後風才大（v.s 在漏斗還沒垂下來時就開始漲了，所以再壓一次）
        const gust = 0.8 + 0.2 * Math.sin(v.age * 1.7 + r * 0.15) + 0.14 * Math.sin(v.age * 4.3 + v.life);
        const w = v.s * v.s * gust * (r / SPOUT_WIND.rc) * Math.exp(1 - r / SPOUT_WIND.rc) * smooth(SPOUT_WIND.far, SPOUT_WIND.far - 80, r);
        out.wx += w * (0.3 * ux - uz); out.wz += w * (0.3 * uz + ux);
      }
      if (r > V.far) continue;
      if (v.kind === 'whirl') {
        // 繞圈的流速：核心外跟距離成反比，核心裡跟距離成正比；往中心流的那一份越靠近越大（小船在四十幾公尺內就開不出來了）
        const vt = V.vt * (r < V.rc ? r / V.rc : V.rc / r) * v.s * smooth(V.far, V.far - 120, r);
        const k = V.kin0 + V.kin1 * smooth(V.kr0, V.kr1, r);
        out.x += vt * (k * ux - uz);
        out.z += vt * (k * uz + ux);
        out.spin -= 0.35 * vt / Math.max(r, V.rc);   // 船頭跟著水流轉的方向被帶著轉
        continue;
      }
      const f = v.s * (r / V.rc) * Math.exp(1 - r / V.rc);
      out.x += f * (V.vin * ux - V.vt * uz);
      out.z += f * (V.vin * uz + V.vt * ux);
      out.spin += f * 0.25;
    }
    return out;
  }

  // (x, z) 是不是已經進到漩渦或水龍捲的中心；是的話回傳 'whirl' 或 'spout'
  coreAt(x, z) {
    for (const v of this.vortices) {
      if (v.s > (v.kind === 'spout' ? 0.85 : 0.5) && Math.hypot(v.x - x, v.z - z) < VORTEX[v.kind].core) return v.kind;
    }
    return null;
  }
}

// ---- 時間與平常的天氣 -------------------------------------------------------
// 白天（6 點到 18 點）15 分鐘、夜晚 15 分鐘。每天清晨決定當天的風浪強弱、晴陰雨、有沒有晨霧
export const HOUR = 75;   // 遊戲裡的一小時是幾秒

export class Climate {
  constructor() {
    this.hour = 8;        // 現在幾點（0–24）
    this.day = 1;
    // 第一天是普通的好天氣
    this.windGoal = 1.2; this.cloudGoal = 0; this.rainAmt = 0; this.rainFrom = 0; this.rainTo = 0; this.fogAmt = 0;
    this.wind = 1.2;      // 風浪強度（慢慢變）
    this.cloud = 0;       // 雲量造成的陰沉程度
    this.rain = 0;        // 雨勢
    this.fog = 0;         // 霧
  }

  // 擲出新的一天
  roll() {
    const r = Math.random();
    this.windGoal = r < 0.25 ? rand(0.5, 0.8) : r < 0.75 ? rand(0.9, 1.4) : rand(1.5, 1.9);
    const s = Math.random();
    this.cloudGoal = s < 0.55 ? 0 : s < 0.75 ? 0.45 : 0.6;
    this.rainAmt = s < 0.75 ? 0 : rand(0.35, 0.65);
    this.rainFrom = rand(6, 20); this.rainTo = this.rainFrom + rand(4, 10);   // 雨下在一天裡的某幾個小時
    this.fogAmt = Math.random() < 0.22 ? rand(0.6, 0.9) : 0;                  // 有些日子清晨起霧
  }

  update(dt) {
    const before = this.hour;
    this.hour += dt / HOUR;
    if (before < 6 && this.hour >= 6) this.roll();
    if (this.hour >= 24) { this.hour -= 24; this.day++; }
    const h = this.hour, h2 = h + 24;
    const raining = (h >= this.rainFrom && h < this.rainTo) || (h2 >= this.rainFrom && h2 < this.rainTo);
    const foggy = h >= 4.5 && h < 9.5;
    const ease = (tau) => 1 - Math.exp(-dt / tau);
    this.wind += (this.windGoal - this.wind) * ease(90);
    this.cloud += (this.cloudGoal - this.cloud) * ease(45);
    this.rain += ((raining ? this.rainAmt : 0) - this.rain) * ease(25);
    this.fog += ((foggy ? this.fogAmt : 0) - this.fog) * ease(45);
  }

  // 夜釣的時段：天黑之後到天亮之前
  get night() { return this.hour >= 18.5 || this.hour < 5.5; }

  // 畫面上的時間：「上午 8:05」
  get label() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60 / 5) * 5;
    const part = h < 5 ? '凌晨' : h < 12 ? '上午' : h < 18 ? '下午' : '晚上';
    return `第 ${this.day} 天　${part} ${h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')}`;
  }

  // 太陽與月亮：回傳現在的主光方向、顏色與各種明暗係數
  light() {
    const a = (this.hour - 6) / 12 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    const norm = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
    const sun = norm(ca * 0.8, sa * 0.78, 0.45), moon = norm(-ca * 0.8, -sa * 0.6, 0.5);
    const sy = sun[1];
    const day = smooth(-0.12, 0.2, sy);                                  // 0 夜晚、1 白天
    const dusk = smooth(-0.1, 0.02, sy) * (1 - smooth(0.05, 0.42, sy));  // 日出日落的那一段
    let dir, col;
    if (sy > -0.08) {
      const lvl = smooth(-0.08, 0.18, sy), w = smooth(0.05, 0.4, sy);
      dir = sun; col = [lvl, lvl * (0.55 + 0.38 * w), lvl * (0.3 + 0.5 * w)];
    } else {
      const lvl = smooth(0.05, 0.3, moon[1]) * 0.13;
      dir = moon; col = [lvl * 0.6, lvl * 0.74, lvl];
    }
    if (dir[1] < 0.06) dir = norm(dir[0], 0.06, dir[2]);   // 光不會從地平線下打上來
    const amb = [0.05, 0.065, 0.11].map((n, i) => n + ([1, 1, 1][i] - n) * day);
    amb[1] *= 1 - 0.18 * dusk; amb[2] *= 1 - 0.3 * dusk;                 // 黃昏的環境光偏暖
    return { dir, col, amb, day, dusk };
  }
}
