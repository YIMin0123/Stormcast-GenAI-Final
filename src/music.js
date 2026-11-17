// 背景音樂：平常只有海浪、海鷗、風聲，偶爾才淡入一首，播完又回到留白。
//   不是固定公式：
//   - 一首播完後留白一段隨機的時間（P.gap），期滿也只是「擲一次」，沒中就再等一陣子（P.idle、P.idleRetry）
//   - 出港、回港、清晨、黃昏這些時刻有機會馬上來一首（P.moment），沒中就照樣安靜
//   - 同一首不連著播兩次（只有一首可挑時例外）
//   海上出事（海嘯、颱風、漩渦、水龍捲靠近、大雨）不開始新的；正在播的照危險程度淡出，把聲音讓給風浪。
// 音源：public/audio/music/（OpenTracks，舊名 DOVA-SYNDROME，來源見 public/audio/CREDITS.txt）。
//   只用 <audio> 串流播放：要播的那一刻才下載，播完就放掉，不在開場載入、也不把整首解碼放在記憶體裡（手機吃不消）。
//   聲音接進 OceanAudio 的總音量，所以「遊戲音效」開關、總音量、水下變悶都照樣作用；另外乘上音樂音量（setVol）。
// 數字都在這個檔的最上面；由 main.js 每幀呼叫 update()。

const TRACKS = {
  tropical: { file: 'tropical-sea.mp3', gain: 0.75 },   // Tropical Sea／のる：港口白天
  umibe: { file: 'yasashii-umibe.mp3', gain: 0.85 },    // 優しい海辺／蒲鉾さちこ：港口黃昏、傍晚、夜裡
  waltz: { file: 'unabara-waltz.mp3', gain: 0.7 },      // 海原のワルツ／こうだつの：出海
};

// 情境 → 可挑的曲子（多首時隨機）
const MOODS = {
  harborDay: ['tropical'],
  harborEve: ['umibe'],
  depart: ['waltz'],
  arrive: ['tropical', 'umibe'],
  dawn: ['tropical'],
  dusk: ['umibe'],
  sea: ['waltz', 'tropical'],
};

export const P = {
  firstGap: [100, 220],  // 開了聲音之後，至少這麼久不放（秒）
  gap: [150, 360],       // 一首播完後留白多久
  idle: 0.4,             // 留白期滿時，這一輪放不放（在港口）
  idleSea: 0.25,         //                         （在海上：海上本來就該安靜一點）
  idleRetry: [80, 220],  // 這一輪沒放：再等多久擲一次
  moment: 0.45,          // 出港、回港、清晨、黃昏那一刻來一首的機率
  momentQuiet: 40,       // 上一首結束後至少隔這麼久，「那一刻」才算數
  fadeIn: 4,             // 淡入秒數
  fadeOut: 5,            // 曲子快結束時淡出的秒數
  danger: 0.3,           // 危險程度超過這個就不開始、正在播的淡出
  departOff: 160,        // 離岸這麼遠算出了海
  harborOff: 70,         // 回到據點範圍、或離岸這麼近算回港
  dawnHour: 6, duskHour: 17.5,
};

const rand = ([a, b]) => a + Math.random() * (b - a);
const pick = (list, last) => {
  const ok = list.length > 1 ? list.filter((id) => id !== last) : list;
  return ok[Math.floor(Math.random() * ok.length)];
};

// iPhone 規定 <audio> 要在使用者點擊的那一下先播過一次，之後程式才能自己叫它播：用一小段無聲的 wav 解鎖
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

export class Music {
  constructor(audio) {
    this.audio = audio;
    this.vol = 0.6;
    this.el = null; this.gain = null;
    this.now = null;          // 正在播的曲子 id
    this.last = null;         // 上一首
    this.wait = rand(P.firstGap);   // 還要留白幾秒才擲下一次
    this.quiet = 999;         // 上一首結束後過了幾秒
    this.prev = null;         // 上一幀的情境（看「那一刻」用）
  }

  // 由「遊戲音效」打開的那一下呼叫（使用者點擊之中）
  start() {
    const ctx = this.audio.ctx;
    if (!ctx || this.el) return;
    const el = this.el = new Audio();
    el.preload = 'none';
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(this.gain).connect(this.audio.master);
    el.addEventListener('ended', () => this._done());
    el.addEventListener('error', () => { if (this.now) this._done(); });
    el.src = SILENT;
    el.play().catch(() => {});
  }

  setVol(v) {
    this.vol = v;
    if (this.now && this.gain) this.gain.gain.setTargetAtTime(this._level(), this.audio.ctx.currentTime, 0.3);
  }

  _level() { return this.vol * (TRACKS[this.now]?.gain ?? 1); }

  _play(mood) {
    if (!this.el || this.vol <= 0) return false;
    const id = pick(MOODS[mood], this.last);
    const t = this.audio.ctx.currentTime, g = this.gain.gain;
    this.now = id;
    this.fading = false;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(this._level(), t + P.fadeIn);
    this.el.src = `audio/music/${TRACKS[id].file}`;
    this.el.play().catch(() => this._done());
    return true;
  }

  // 一首結束（播完、載不到、或被淡出）：放掉檔案，回到留白
  _done() {
    if (!this.el) return;
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    if (this.now) this.last = this.now;
    this.now = null;
    this.fading = false;
    this.quiet = 0;
    this.wait = rand(P.gap);
  }

  _fade(sec) {
    if (this.fading) return;
    this.fading = true;
    const t = this.audio.ctx.currentTime, g = this.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + sec);
    this.stopAt = performance.now() + sec * 1000;
  }

  // 每幀：o = { site 在不在據點範圍, off 離岸幾公尺, aboard 在船上, hour 遊戲時間（0–24）, danger 0–1, rain 0–1 }
  update(dt, o) {
    if (!this.el) return;
    const on = this.audio.on;
    if (!on) { if (this.now) this._done(); this.prev = null; return; }
    const harbor = !!o.site || o.off < P.harborOff;
    const out = !o.site && o.off > P.departOff;
    const bad = o.danger > P.danger || o.rain > 0.5;

    if (this.now) {
      if (this.fading) { if (performance.now() > this.stopAt) this._done(); }
      else if (bad || this.vol <= 0) this._fade(bad ? 3 : 0.5);
      else {
        const left = this.el.duration - this.el.currentTime;
        if (left > 0 && left < P.fadeOut) this._fade(left);
      }
    } else {
      this.quiet += dt;
      this.wait -= dt;
      // 那一刻：出港、回港、清晨、黃昏
      let moment = null;
      const p = this.prev;
      if (p) {
        if (p.harbor && out && o.aboard) moment = 'depart';
        else if (p.out && harbor) moment = 'arrive';
        else if (p.hour < P.dawnHour && o.hour >= P.dawnHour) moment = 'dawn';
        else if (p.hour < P.duskHour && o.hour >= P.duskHour) moment = 'dusk';
      }
      if (!bad && this.vol > 0) {
        if (moment && this.quiet > P.momentQuiet) {
          // 只在那一幀擲一次：有中就放，沒中就照樣安靜
          if (Math.random() < P.moment) this._play(moment);
        } else if (this.wait <= 0) {
          const eve = o.hour >= 16.5 || o.hour < 5;
          const mood = harbor ? (eve ? 'harborEve' : 'harborDay') : 'sea';
          if (Math.random() < (harbor ? P.idle : P.idleSea)) this._play(mood);
          else this.wait = rand(P.idleRetry);
        }
      }
    }
    // 出海、回港要看「離開了一陣子」：只在確實到了另一邊時才更新起點
    const keep = p0(this.prev);
    this.prev = {
      harbor: harbor || (keep.harbor && !out),
      out: out || (keep.out && !harbor),
      hour: o.hour,
    };
  }

  // 測試用：馬上放某個情境（main.js 的 __sim.music）
  force(mood = 'harborDay') { if (this.now) this._done(); return this._play(mood); }
  get state() { return { now: this.now, last: this.last, wait: Math.round(this.wait), quiet: Math.round(this.quiet), vol: this.vol }; }
}

const p0 = (p) => p ?? { harbor: false, out: false };
