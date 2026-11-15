const WINDOW_MS = 2000;
const LOWER_WINDOWS = 2;
const RAISE_WINDOWS = 8;
export const MAX_QUALITY_REDUCTION = 3;

// Live overrides only. The player's saved graphics settings remain the ceiling.
export function reducedQuality(settings, level) {
  if (!level) return settings;
  return {
    ...settings,
    ao: false, bloom: false, rays: false, wet: false, msaa: false,
    shadow: level >= 3 ? 0 : level >= 2 ? Math.min(settings.shadow, 1) : settings.shadow,
    grass: level >= 3 ? 0 : level >= 2 ? Math.min(settings.grass, 1) : settings.grass,
  };
}

export class QualityTiming {
  constructor() {
    this.reset();
  }

  reset() {
    this.last = null;
    this.lower = 0;
    this.raise = 0;
  }

  sample(now, fps) {
    if (this.last === null || this.fps !== fps) {
      this.reset();
      this.fps = fps;
      this.start = now + WINDOW_MS;   // Wait for shaders and camera transitions.
      this.last = now;
      this.frames = this.late = 0;
      return null;
    }
    const elapsed = now - this.last;
    this.last = now;
    if (now <= this.start || elapsed <= 0) return null;
    if (!this.frames && now - elapsed < this.start) { this.start = now; return null; }
    this.frames++;
    // Normal pacing can alternate between two refresh intervals (e.g. 45 FPS on 60 Hz).
    if (elapsed > 2000 / fps) this.late++;
    const span = now - this.start;
    if (span < WINDOW_MS) return null;
    const ratio = this.frames * 1000 / (span * fps);
    const hitchRate = this.late / this.frames;
    this.frames = this.late = 0;
    this.start = now;
    this.lower = ratio < 0.85 || hitchRate >= 0.15 ? this.lower + 1 : 0;
    this.raise = ratio >= 0.97 && hitchRate <= 0.03 ? this.raise + 1 : 0;
    if (this.lower >= LOWER_WINDOWS) { this.lower = 0; return 'lower'; }
    if (this.raise >= RAISE_WINDOWS) { this.raise = 0; return 'raise'; }
    return null;
  }
}
