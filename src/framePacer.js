// 以畫面的時間戳排程，保留不足一幀的時間，避免在 90／144 Hz 螢幕上把上限意外壓低。
export class FramePacer {
  constructor() {
    this.reset();
  }

  reset() {
    this.last = null;
  }

  take(now, hz = 0) {
    const interval = hz ? 1000 / hz : 0;
    if (this.last === null || this.hz !== hz) {
      this.hz = hz;
      this.last = now;
      this.next = now + interval;
      return 0;
    }
    if (interval && now + 1 < this.next) return null;
    const elapsed = now - this.last;
    this.last = now;
    // 允許 1ms 的刷新抖動。掉幀時跳過已錯過的期限，每次回呼最多走一次。
    if (interval) this.next += (Math.floor((now + 1 - this.next) / interval) + 1) * interval;
    return elapsed;
  }
}

export const MOBILE_FRAME_LIMITS = [30, 45, 60, 90, 120];

// 取瀏覽器回呼的間隔。修掉幾個過短或漏掉更新的樣本，避免單次抖動誤開高幀率。
export class RefreshRateProbe {
  constructor() {
    this.hz = MOBILE_FRAME_LIMITS[0];
    this.intervals = [];
    this.reset();
  }

  reset() {
    this.last = null;
    this.intervals.length = 0;
  }

  sample(now) {
    if (this.hz === MOBILE_FRAME_LIMITS.at(-1)) return false;
    const last = this.last;
    this.last = now;
    if (last === null || now <= last) return false;
    if (now - last >= 250) { this.intervals.length = 0; return false; }
    this.intervals.push(now - last);
    if (this.intervals.length < 32) return false;
    this.intervals.sort((a, b) => a - b);
    const steady = this.intervals.slice(4, 24);
    const hz = steady.length * 1000 / steady.reduce((sum, ms) => sum + ms, 0);
    this.intervals.length = 0;
    const supported = MOBILE_FRAME_LIMITS.filter((limit) => hz >= limit * 0.97).at(-1);
    if (supported === undefined || supported <= this.hz) return false;
    this.hz = supported;
    return true;
  }
}
