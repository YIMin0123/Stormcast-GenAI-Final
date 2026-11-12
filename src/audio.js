// 程序生成的聲音：用濾過的雜訊做出海浪聲、浪花嘶聲，以及海嘯逼近時的低頻轟鳴。
// 瀏覽器規定要使用者點擊後才能發聲，所以由按鈕呼叫 start()。

export class OceanAudio {
  constructor() { this.ctx = null; this.on = false; }

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
    this.spoutPan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    this.spoutPan.connect(this.master);
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

  stop() {
    if (!this.ctx) return;
    this.on = false;
    this.master.gain.value = 0;
  }

  // 雷聲。dist：閃電離這裡多遠（公尺）。
  // 聲音每秒走 343 公尺，所以先看到閃、過幾秒才聽到。
  // 近的：先是「啪」一聲撕裂般的爆響，接著隆隆聲滾好幾秒（閃電有一公里長，各段的聲音陸續傳到，所以會拖很久、中間還有幾下重的）；
  // 遠的：高音在路上被吃掉了，只剩低沉、拖得更長的悶響
  thunder(dist = 800) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + dist / 343;
    const near = Math.min(1, Math.max(0, 1 - dist / 1500));
    const vol = (0.3 + 2.0 * near * near) * Math.min(1, Math.max(0.3, 1.25 - dist / 4500));
    const dur = 3.5 + 3 * (1 - near) + Math.random() * 1.5;
    // 隆隆聲的起伏：一開始最響，後面再來幾下餘響，整體慢慢收掉
    const n = 72, curve = new Float32Array(n), claps = [[0, 1]];
    for (let k = 2 + Math.floor(Math.random() * 3); k > 0; k--) claps.push([0.08 + 0.5 * Math.random(), 0.3 + 0.45 * Math.random()]);
    for (let i = 1; i < n - 1; i++) {
      const u = i / (n - 1);
      let v = 0.16 * Math.exp(-u * 2.2);
      for (const [at, amp] of claps) if (u >= at) v = Math.max(v, amp * Math.exp(-(u - at) * dur / (0.35 + 0.5 * (1 - near))));
      curve[i] = vol * v * Math.sqrt(1 - u) * (0.8 + 0.4 * Math.random());
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 75 + 420 * near * near;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setValueCurveAtTime(curve, t + 0.001, dur);
    src.connect(lp).connect(g).connect(this.master);
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
      c.connect(bp).connect(cg).connect(this.master);
      c.start(t, Math.random() * 2); c.stop(t + 0.65);
    }
  }

  // wave：風浪強度 0–2.5；roar：附近激流的程度 0–1；under：鏡頭是否在水下；throttle、speed：0–1；rain：雨勢 0–1
  // spout：最近的水龍捲有多近 0–1；spoutPan：它在左邊（-1）還是右邊（+1）；wind：風有多大（0 微風、1 颱風、陣風時超過 1）
  set(wave, roar, under, throttle = 0, speed = 0, rain = 0, spout = 0, spoutPan = 0, wind = 0) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime, k = 0.25;
    this.spoutRoar.gain.setTargetAtTime(1.5 * spout, t, k);
    this.spoutFlut.gain.setTargetAtTime(0.4 * spout, t, k);
    this.spoutHiss.gain.setTargetAtTime(0.5 * spout * spout * spout, t, k);
    if (this.spoutPan.pan) this.spoutPan.pan.setTargetAtTime(spoutPan, t, 0.15);
    this.rainG.gain.setTargetAtTime(0.09 * rain, t, k);
    this.rainLow.gain.setTargetAtTime(0.07 * rain * rain, t, k);
    this.windLow.gain.setTargetAtTime(0.42 * wind, t, 0.3);
    this.windHowl.gain.setTargetAtTime(0.5 * wind * wind, t, 0.3);
    this.windHowlF.frequency.setTargetAtTime(380 + 420 * wind, t, 0.4);
    this.wash.gain.setTargetAtTime(0.10 + 0.14 * wave + 0.25 * roar, t, k);
    this.hiss.gain.setTargetAtTime(0.012 * wave * wave + 0.10 * roar, t, k);
    this.rumble.gain.setTargetAtTime(1.6 * roar, t, k);
    this.muffle.frequency.setTargetAtTime(under ? 320 : 18000, t, 0.08);
    this.engine.gain.setTargetAtTime(0.035 + 0.07 * throttle, t, 0.3);
    this.engOsc.frequency.setTargetAtTime(30 + 26 * Math.max(throttle, speed), t, 0.4);
  }
}
