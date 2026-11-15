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
