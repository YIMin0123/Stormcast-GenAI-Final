// 聲音以實地錄音為主（public/audio/ 裡的 mp3，CC0 授權，來源見該資料夾的 CREDITS.txt）：
//   海浪、岸邊的小浪、海鷗、雨、雷、風、引擎、捲線器、腳步、島上的鳥叫蟲鳴，以及各種短音效。
//   按下「遊戲音效」之後才在背景載入。
// 程式合成的聲音（濾過的雜訊）只當備用：哪一種聲音的錄音檔還沒有、或沒載到，那一種才用合成的頂著；
//   錄音一載好，對應的合成聲就完全關掉（兩種疊在一起聽起來很怪）。
// 有方位的聲音：引擎、海鷗、岸邊的浪、水龍捲、海嘯和漩渦的轟鳴、雷、浮標的水花，都從它們在世界裡的位置傳過來
//   （戴耳機聽得出前後左右；喇叭則是左右）。每幀由外面用 listen() 告訴它耳朵（鏡頭）在哪、朝哪，用 place() 告訴它聲音在哪。
//   遠近的大小聲照舊由外面算好的音量決定，這裡只管方向。雨、風、外海的浪、鳥叫蟲鳴是四面八方來的，不分方位。
// 瀏覽器規定要使用者點擊後才能發聲，所以由按鈕呼叫 start()。

// 會一直循環播放的錄音：[檔名, 從第幾秒, 到第幾秒, 接法]
//   接法是數字：一段接一段排進去，頭尾重疊這麼多秒、交叉淡入淡出（長的環境音，接縫聽不出來）
//   接法是 'n'：直接讓瀏覽器原地循環（引擎、捲線器、腳步——這些要即時改變播放速度，檔案本身已經剪成頭尾接得起來）
const LOOPS = {
  sea: ['sea-waves.mp3', 0, 54, 2],
  shore: ['small-waves.mp3', 0, 52.5, 2],
  gulls: ['gulls-harbor.mp3', 0, 57.5, 2],
  rain: ['rain-puddle.mp3', 0, 75, 2],
  engine: ['engine.wav', 0, 600, 'n'],       // wav、ogg 的頭尾是準的，原地循環不會有接縫（mp3 頭尾會多出一小段空白）
  reel: ['reel.mp3', 0.1, 14.9, 'n'],
  // 風：平常的風聲、強風的呼嘯（音高跟著風速變）；水龍捲用同一段強風錄音放慢，從它所在的方向傳過來
  wind: ['wind.ogg', 0, 600, 'n'],
  gale: ['gale.ogg', 0, 600, 'n'],
  spout: ['gale.ogg', 0, 600, 'n'],
  // 海嘯、漩渦逼近時的轟鳴：大水的錄音放慢、只留低頻
  roar: ['roar.ogg', 0, 600, 'n'],
  // 島上的環境音：夜裡的蟲、樹林裡的風（白天的鳥叫太吵，拿掉了）
  night: ['night.mp3', 0, 600, 2],
  trees: ['trees.mp3', 0, 600, 2],
};
// 短音效：名字 → 幾個版本，每個是 [檔名, 從第幾秒, 播幾秒, 音量]（播的時候隨機挑一個）
const one = (file, k, ...cuts) => cuts.map(([at, dur]) => [file, at, dur, k]);
const CLIPS = {
  cast: one('whoosh.mp3', 0.8, [0.1, 0.7]),
  plop: one('splash-small.mp3', 0.55, [0, 1.0]),
  bite: one('splash-small.mp3', 0.9, [0, 1.0]),
  hook: one('splash-small.mp3', 0.45, [0, 0.8]),
  land: one('splash-big.mp3', 0.8, [0.1, 1.8]),
  dive: one('splash-big.mp3', 1, [0.1, 2.2]),
  snap: one('twigs.mp3', 1.0, [3.62, 0.65]),
  switch: one('switch.mp3', 0.9, [3.0, 0.45], [4.45, 0.5], [6.2, 0.4], [7.8, 0.4]),
  coin: one('coins.mp3', 0.6, [0.1, 0.95], [1.9, 1.1], [5.5, 1.1], [14.7, 0.95]),
  repair: one('hammer.mp3', 0.9, [5.15, 1.9]),
  pour: one('pour.mp3', 0.7, [0.5, 3]),
  drop: one('thud.mp3', 0.7, [0.0, 0.5], [0.85, 0.5], [1.7, 0.5]),
  pick: one('thud.mp3', 0.4, [2.45, 0.5], [3.3, 0.5]),
  sit: one('thud.mp3', 0.45, [4.15, 0.5]),
  rope: one('thud.mp3', 0.55, [5.05, 0.5]),
  // 腳步：一步一聲，跟著角色的腳落地的那一下播（走在木板上、走在草地沙地上各一組）
  stepWood: one('steps-wood.mp3', 0.75, [0.05, 0.5], [0.7, 0.5], [1.35, 0.5], [1.95, 0.5], [2.55, 0.5], [3.1, 0.5], [3.8, 0.5], [4.45, 0.5], [5.1, 0.5]),
  // 單隻海鷗的一聲叫（從港口那段錄音裡挑前後都很安靜的幾聲）；wildlife.js 照每隻海鷗的位置、動作播，從那隻的方向傳過來
  gull: one('gulls-harbor.mp3', 1.0, [14.94, 0.46], [25.98, 0.4], [19.68, 0.4], [38.54, 0.42], [27.30, 0.4], [20.86, 0.4], [35.34, 0.46], [23.22, 0.4], [18.58, 0.4], [24.70, 0.42]),
  stepGrass: one('steps-grass.mp3', 0.9, [0.0, 0.6], [0.95, 0.6], [1.95, 0.6], [2.85, 0.5], [7.35, 0.5], [8.35, 0.45], [9.3, 0.5], [10.05, 0.55]),
};
const THUNDER = ['thunder-1.mp3', 'thunder-2.mp3', 'thunder-3.mp3'];
// 有方位的循環聲
const SPOTS = ['engine', 'gulls', 'shore', 'spout', 'roar'];

export class OceanAudio {
  constructor() { this.ctx = null; this.on = false; this.buf = {}; this.loops = {}; this.real = 0; this.spots = {}; this.ear = [0, 0, 0]; }

  // 一個有方位的出口：聲音進到 in，一部分經過定位（從某個方向來）、一部分直接出去（沒有方向）。
  // 兩者的比例由「散開的程度」決定：聲音就在身邊、或本來就是一大片的時候，方向感要淡一點
  _spot(x = 0, y = 0, z = 0, spread = 1) {
    const ctx = this.ctx, inp = ctx.createGain(), pan = ctx.createPanner(), wet = ctx.createGain(), dry = ctx.createGain();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse'; pan.rolloffFactor = 0;   // 遠近的音量由外面算，這裡不再衰減一次
    pan.setPosition(x, y, z);
    wet.gain.value = Math.cos(spread * Math.PI / 2); dry.gain.value = Math.sin(spread * Math.PI / 2);
    inp.connect(pan).connect(wet).connect(this.master);
    inp.connect(dry).connect(this.master);
    return { in: inp, pan, wet, dry };
  }

  // 耳朵（鏡頭）的位置、朝向、頭頂的方向
  listen(px, py, pz, fx, fy, fz, ux, uy, uz) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    this.ear[0] = px; this.ear[1] = py; this.ear[2] = pz;
    if (l.positionX) {
      l.positionX.value = px; l.positionY.value = py; l.positionZ.value = pz;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
      l.upX.value = ux; l.upY.value = uy; l.upZ.value = uz;
    } else { l.setPosition(px, py, pz); l.setOrientation(fx, fy, fz, ux, uy, uz); }
  }

  // 各個有方位的循環聲現在在哪：{ 名字: [x, y, z, 散開的程度 0–1] }（1 = 完全沒有方向）
  place(o) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    for (const name in o) {
      const S = this.spots[name], [x, y, z, spread] = o[name];
      if (!S) continue;
      if (S.pan.positionX) {
        S.pan.positionX.setTargetAtTime(x, t, 0.08); S.pan.positionY.setTargetAtTime(y, t, 0.08); S.pan.positionZ.setTargetAtTime(z, t, 0.08);
      } else S.pan.setPosition(x, y, z);
      S.wet.gain.setTargetAtTime(Math.cos(spread * Math.PI / 2), t, 0.15);
      S.dry.gain.setTargetAtTime(Math.sin(spread * Math.PI / 2), t, 0.15);
    }
  }

  // 在背景把錄音檔載進來（載不到的略過）
  _load() {
    const files = new Set([...THUNDER, ...Object.values(LOOPS).map((l) => l[0]), ...Object.values(CLIPS).flat().map((c) => c[0])]);
    for (const f of files) {
      fetch(`audio/${f}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((a) => this.ctx.decodeAudioData(a))
        .then((b) => { this.buf[f] = b; this._ready(f); })
        .catch(() => { /* 沒有這個檔：照舊用合成的聲音 */ });
    }
  }

  // 一個檔載好了：是循環用的就開始播（音量先是 0，由 ambient() 調）
  _ready(f) {
    for (const [name, [file, t0, t1, join]] of Object.entries(LOOPS)) {
      if (file !== f || this.loops[name]) continue;
      const out = this.ctx.createGain();
      out.gain.value = 0;
      const dest = this.spots[name] ? this.spots[name].in : this.master;   // 有方位的走定位的出口
      if (name === 'roar') {                                               // 只留低頻的轟隆聲
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 260;
        out.connect(lp).connect(dest);
      } else out.connect(dest);
      const buf = this.buf[f], a = t0, b = Math.min(t1, buf.duration);
      const L = this.loops[name] = { out, buf, a, b, x: join, next: this.ctx.currentTime + 0.05, rate: 1, srcs: [] };
      if (join === 'n') {
        const src = L.native = this.ctx.createBufferSource();
        src.buffer = buf; src.loop = true; src.loopStart = a; src.loopEnd = b;
        src.connect(out);
        src.start(0, a);
      }
    }
    if (!this._timer) this._timer = window.setInterval(() => this._pump(), 500);
    this._pump();
  }

  // 循環播放：一段接一段排進去，相鄰兩段重疊 X 秒、一個淡出一個淡入
  _pump() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const L of Object.values(this.loops)) {
      if (L.native) continue;
      const len = L.b - L.a, X = L.x;
      L.srcs = L.srcs.filter((s) => s.end > now);
      while (L.next < now + 1.5) {
        const src = this.ctx.createBufferSource(), g = this.ctx.createGain(), t = Math.max(L.next, now + 0.02), dur = len / L.rate;
        src.buffer = L.buf;
        src.playbackRate.value = L.rate;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + X / L.rate);
        g.gain.setValueAtTime(1, t + dur - X / L.rate);
        g.gain.linearRampToValueAtTime(0, t + dur);
        src.connect(g).connect(L.out);
        src.start(t, L.a, len);
        L.srcs.push({ src, end: t + dur });
        L.next = t + dur - X / L.rate;
      }
    }
  }

  _vol(name, v, k = 0.25) { const L = this.loops[name]; if (L) L.out.gain.setTargetAtTime(v, this.ctx.currentTime, k); }
  _rate(name, r) {
    const L = this.loops[name];
    if (!L || Math.abs(r - L.rate) < 0.02) return;
    L.rate = r;
    if (L.native) L.native.playbackRate.setTargetAtTime(r, this.ctx.currentTime, 0.15);
  }

  // 每幀由外面告訴它周圍的狀況，調整各段錄音的音量：
  //   sea：外海的浪有多大 0–1；shore：人離岸邊多近 0–1；gulls：聽得到海鷗的程度 0–1（白天、港口附近、沒下大雨）
  //   rain：雨勢 0–1；engine：引擎開著（0 / 1）；throttle：油門 0–1；pitch：引擎的音高倍率（小船高、大船低）
  //   reel：正在收線 0–1；under：鏡頭在水裡
  //   night：蟲鳴 0–1（夜裡、在島上）；trees：樹林裡的風 0–1
  ambient(o) {
    if (!this.ctx || !this.on) return;
    const dry = o.under ? 0 : 1;
    this._vol('sea', 0.75 * o.sea * (o.under ? 0.25 : 1));
    this._vol('shore', 0.55 * o.shore * dry);
    this._vol('gulls', 0.3 * o.gulls * dry, 1.5);   // 港口上空的一大片叫聲（單隻海鷗的叫聲另外見 CLIPS.gull）
    this._vol('rain', 0.9 * o.rain * dry);
    this._vol('engine', o.engine * (0.22 + 0.3 * o.throttle), 0.3);
    this._rate('engine', o.pitch * (0.85 + 0.5 * o.throttle));
    this._vol('reel', 0.5 * o.reel, 0.06);
    this._vol('night', 0.3 * o.night * dry, 1.2);
    this._vol('trees', 0.5 * o.trees * dry, 0.6);
    this.engineReal = !!this.loops.engine;
    this.engineOn = o.engine;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); this.on = true; this.master.gain.value = 0.9; return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    // 6 秒的粉紅雜訊，循環播放
    const len = ctx.sampleRate * 6;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + 0.029 * w; b1 = 0.985 * b1 + 0.032 * w; b2 = 0.95 * b2 + 0.048 * w;
      d[i] = (b0 + b1 + b2 + w * 0.02) * 2.2;
    }
    this.noise = buf;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;

    this.master = ctx.createGain();
    this.muffle = ctx.createBiquadFilter();   // 水下時整體變悶
    this.muffle.type = 'lowpass'; this.muffle.frequency.value = 18000;
    this.master.connect(this.muffle).connect(ctx.destination);

    const band = (type, freq, q) => {
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      return g;
    };
    this.wash = band('lowpass', 520, 0.4);     // 浪的主體
    this.hiss = band('bandpass', 2600, 0.6);   // 浪花
    this.rumble = band('lowpass', 85, 0.7);    // 海嘯轟鳴
    this.rainG = band('highpass', 3800, 0.5);  // 雨聲
    this.rainLow = band('bandpass', 950, 0.5); // 大雨打在海面上那片厚厚的嘩嘩聲（雨小的時候聽不到）
    // 風聲：低沉的呼呼聲，加上一道尖一點的呼嘯。陣風來的時候音量和音高一起往上竄（風越強叫得越尖）
    this.windLow = band('bandpass', 240, 0.6);
    this.windHowlF = ctx.createBiquadFilter();
    this.windHowlF.type = 'bandpass'; this.windHowlF.frequency.value = 400; this.windHowlF.Q.value = 3.2;
    this.windHowl = ctx.createGain(); this.windHowl.gain.value = 0;
    src.connect(this.windHowlF).connect(this.windHowl).connect(this.master);

    // 水龍捲：低沉的呼嘯加上嘶嘶的水霧聲，從它所在的方向傳過來；越近越大聲，近了才聽得到嘶聲
    for (const name of SPOTS) this.spots[name] = this._spot();
    this.spoutPan = this.spots.spout.in;
    const sband = (type, freq, q) => {
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.spoutPan);
      return g;
    };
    this.spoutRoar = sband('bandpass', 230, 0.8);
    this.spoutHiss = sband('highpass', 1900, 0.4);
    // 呼嘯聲一陣一陣地抖（抖的幅度跟著音量走，沒有水龍捲時是 0）
    const flut = ctx.createOscillator(); flut.frequency.value = 5.3;
    this.spoutFlut = ctx.createGain(); this.spoutFlut.gain.value = 0;
    flut.connect(this.spoutFlut).connect(this.spoutRoar.gain);
    flut.start();

    // 漁船引擎：低頻鋸齒波加一點顫動，音量與音高隨油門變化
    this.engOsc = ctx.createOscillator();
    this.engOsc.type = 'sawtooth'; this.engOsc.frequency.value = 34;
    const engLp = ctx.createBiquadFilter(); engLp.type = 'lowpass'; engLp.frequency.value = 180;
    this.engine = ctx.createGain(); this.engine.gain.value = 0;
    const trem = ctx.createOscillator(); trem.frequency.value = 11;
    const tremG = ctx.createGain(); tremG.gain.value = 0.02;
    trem.connect(tremG).connect(this.engine.gain);
    this.engOsc.connect(engLp).connect(this.engine).connect(this.master);
    this.engOsc.start(); trem.start();
    this._load();

    // 兩個很慢的振盪器疊在浪聲音量上，做出一波一波的起伏
    [[0.11, 0.35], [0.17, 0.25]].forEach(([hz, depth]) => {
      const o = ctx.createOscillator(); o.frequency.value = hz;
      const g = ctx.createGain(); g.gain.value = depth * 0.2;
      o.connect(g).connect(this.wash.gain);
      o.start();
    });
    src.start();
    this.on = true;
    this.master.gain.value = 0.9;
  }

  // 播一個短音效（拋竿、落水、斷竿、開關……）。還沒有載入那個聲音就不播。
  // pos：聲音在世界裡的位置（有給就從那個方向傳過來；離耳朵三公尺內方向感漸漸淡掉）
  // rate：音高倍率（每隻海鷗聲音各有高低）
  play(name, vol = 1, pos = null, rate = 1) {
    const list = CLIPS[name];
    if (!this.ctx || !this.on || !list) return;
    const [file, at, dur, k] = list[Math.floor(Math.random() * list.length)], buf = this.buf[file];
    if (!buf) return;
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    src.buffer = buf;
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);   // 每次音高差一點點，連續聽不會一模一樣
    g.gain.setValueAtTime(vol * k, t);
    g.gain.setValueAtTime(vol * k, t + Math.max(0.05, dur - 0.08));
    g.gain.linearRampToValueAtTime(0, t + dur);              // 尾巴收掉，不會「啪」一聲斷
    let dest = this.master;
    if (pos) {
      const d = Math.hypot(pos.x - this.ear[0], pos.y - this.ear[1], pos.z - this.ear[2]);
      dest = this._spot(pos.x, pos.y, pos.z, Math.min(1, Math.max(0.1, 1 - d / 3))).in;
    }
    src.connect(g).connect(dest);
    src.start(t, at, dur);
  }

  stop() {
    if (!this.ctx) return;
    this.on = false;
    this.master.gain.value = 0;
  }

  // 雷聲。dist：閃電離這裡多遠（公尺）。
  // 聲音每秒走 343 公尺，所以先看到閃、過幾秒才聽到。
  // 近的：先是「啪」一聲撕裂般的爆響，接著隆隆聲滾好幾秒（閃電有一公里長，各段的聲音陸續傳到，所以會拖很久、中間還有幾下重的）；
  // 遠的：高音在路上被吃掉了，只剩低沉、拖得更長的悶響
  // pos：閃電在哪（有給的話雷聲從那個方向滾過來；雷聲本來就是一大片，所以方向感只給一部分）
  thunder(dist = 800, pos = null) {
    if (!this.ctx || !this.on) return;
    const out = pos ? this._spot(pos.x, pos.y, pos.z, 0.4).in : this.master;
    const ctx = this.ctx, t = ctx.currentTime + dist / 343;
    const near = Math.min(1, Math.max(0, 1 - dist / 1500));
    // 有雷聲的錄音就用錄音：隨機挑一段，遠的小聲、高音被吃掉；近處落雷那一下撕裂聲還是用合成的疊上去
    const recs = THUNDER.map((f) => this.buf[f]).filter(Boolean);
    if (recs.length) {
      const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = recs[Math.floor(Math.random() * recs.length)];
      src.playbackRate.value = 0.85 + 0.3 * Math.random();
      lp.type = 'lowpass'; lp.frequency.value = 220 + 9000 * near * near;
      g.gain.value = (0.35 + 1.6 * near * near) * Math.min(1, Math.max(0.3, 1.25 - dist / 4500));
      src.connect(lp).connect(g).connect(out);
      src.start(t);
    }
    if (recs.length) return;               // 有錄音就不用合成的雷聲
    const real = 1;
    const vol = (0.3 + 2.0 * near * near) * Math.min(1, Math.max(0.3, 1.25 - dist / 4500));
    const dur = 3.5 + 3 * (1 - near) + Math.random() * 1.5;
    // 隆隆聲的起伏：一開始最響，後面再來幾下餘響，整體慢慢收掉
    const n = 72, curve = new Float32Array(n), claps = [[0, 1]];
    for (let k = 2 + Math.floor(Math.random() * 3); k > 0; k--) claps.push([0.08 + 0.5 * Math.random(), 0.3 + 0.45 * Math.random()]);
    for (let i = 1; i < n - 1; i++) {
      const u = i / (n - 1);
      let v = 0.16 * Math.exp(-u * 2.2);
      for (const [at, amp] of claps) if (u >= at) v = Math.max(v, amp * Math.exp(-(u - at) * dur / (0.35 + 0.5 * (1 - near))));
      curve[i] = real * vol * v * Math.sqrt(1 - u) * (0.8 + 0.4 * Math.random());
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 75 + 420 * near * near;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setValueCurveAtTime(curve, t + 0.001, dur);
    src.connect(lp).connect(g).connect(out);
    src.start(t, Math.random() * 2); src.stop(t + dur + 0.1);
    if (near > 0.5) {
      // 近處落雷的爆裂聲：很短、很亮的一聲，後面跟著兩三下碎裂的尾巴
      const c = ctx.createBufferSource();
      c.buffer = this.noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500 + 1500 * near; bp.Q.value = 0.4;
      const cg = ctx.createGain(), k = (near - 0.5) * 2;
      cg.gain.setValueAtTime(0, t);
      cg.gain.linearRampToValueAtTime(2.6 * k, t + 0.006);
      cg.gain.exponentialRampToValueAtTime(0.5 * k + 0.001, t + 0.07);
      cg.gain.linearRampToValueAtTime(1.3 * k, t + 0.10);
      cg.gain.exponentialRampToValueAtTime(0.25 * k + 0.001, t + 0.2);
      cg.gain.linearRampToValueAtTime(0.7 * k, t + 0.24);
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      c.connect(bp).connect(cg).connect(out);
      c.start(t, Math.random() * 2); c.stop(t + 0.65);
    }
  }

  // wave：風浪強度 0–2.5；roar：附近激流的程度 0–1；under：鏡頭是否在水下；throttle、speed：0–1；rain：雨勢 0–1
  // spout：最近的水龍捲有多近 0–1；spoutPan：沒在用了（方向改由 place() 給）；wind：風有多大（0 微風、1 颱風、陣風時超過 1）
  set(wave, roar, under, throttle = 0, speed = 0, rain = 0, spout = 0, spoutPan = 0, wind = 0) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime, k = 0.25, L = this.loops, dry = under ? 0.3 : 1;
    // 每一種聲音：有錄音就用錄音、合成的關掉（syn = 0）；沒有錄音才用合成的
    const synSpout = L.spout ? 0 : 1, synRain = L.rain ? 0 : 1, synSea = L.sea ? 0 : 1, synRoar = L.roar ? 0 : 1;
    this.spoutRoar.gain.setTargetAtTime(1.5 * spout * synSpout, t, k);
    this.spoutFlut.gain.setTargetAtTime(0.4 * spout * synSpout, t, k);
    this.spoutHiss.gain.setTargetAtTime(0.5 * spout * spout * spout * synSpout, t, k);
    this._vol('spout', 1.3 * spout * dry); this._rate('spout', 0.62 + 0.12 * spout);
    this.rainG.gain.setTargetAtTime(0.09 * rain * synRain, t, k);
    this.rainLow.gain.setTargetAtTime(0.07 * rain * rain * synRain, t, k);
    // 風：平常的風聲跟著風速慢慢變大；強風的呼嘯在風大時才出來，陣風一來音量和音高一起往上竄
    this.windLow.gain.setTargetAtTime(L.wind ? 0 : 0.42 * wind, t, 0.3);
    this.windHowl.gain.setTargetAtTime(L.gale ? 0 : 0.5 * wind * wind, t, 0.3);
    this.windHowlF.frequency.setTargetAtTime(380 + 420 * wind, t, 0.4);
    this._vol('wind', Math.min(0.75 * wind, 0.6) * dry, 0.4);
    this._vol('gale', Math.min(1.1 * wind * wind, 1.4) * dry, 0.3); this._rate('gale', 0.85 + 0.3 * Math.min(wind, 1.4));
    this.wash.gain.setTargetAtTime((0.10 + 0.14 * wave) * synSea + 0.25 * roar * synRoar, t, k);
    this.hiss.gain.setTargetAtTime(0.012 * wave * wave * synSea + 0.10 * roar * synRoar, t, k);
    this.rumble.gain.setTargetAtTime(1.6 * roar * synRoar, t, k);
    this._vol('roar', 1.6 * roar); this._rate('roar', 0.55);
    this.muffle.frequency.setTargetAtTime(under ? 320 : 18000, t, 0.08);
    // 引擎：有人掌舵才有聲音（以前不管人在哪都有一點怠速聲）；有引擎的錄音就用錄音，合成的關掉
    this.engine.gain.setTargetAtTime(this.engineReal ? 0 : (this.engineOn ?? 1) * (0.035 + 0.07 * throttle), t, 0.3);
    this.engOsc.frequency.setTargetAtTime(30 + 26 * Math.max(throttle, speed), t, 0.4);
  }
}
