// 頂部水平羅盤條（透明無框 ESWN 方位尺＋導航與魚群熱點整合標記）

const CARDINALS = new Map([
  [0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'],
  [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW'],
]);

/**
 * 將角度差折回 [-180, 180) 度區間。
 */
export const wrap180 = (deg) => ((deg + 540) % 360 + 360) % 360 - 180;

/**
 * 格式化羅盤上的精簡距離標籤（公尺／公里）。
 */
export function compassDist(m) {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m < 100) return `${Math.round(m)}m`;
  if (m < 1000) return `${Math.round(m / 10) * 10}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

/**
 * 計算羅盤尺規上目標相對準心的螢幕水平偏移（超過可視角時截斷至左右邊緣）。
 */
export function projectCompassX(targetDeg, headingDeg, width, fovDeg = 120) {
  const half = fovDeg / 2;
  const d = wrap180(targetDeg - headingDeg);
  const pad = 22;
  const rawX = width / 2 + (d / fovDeg) * width;
  if (Math.abs(d) <= half - 4) return { x: rawX, clamped: 0, delta: d, aligned: Math.abs(d) <= 6 };
  return { x: d < 0 ? pad : width - pad, clamped: d < 0 ? -1 : 1, delta: d, aligned: false };
}

const MARKER_CFG = {
  wp: { color: '#52f0ff', icon: 'pin', pri: 0 },
  hot: { color: '#ffd250', icon: 'fish', pri: 1 },
  chum: { color: '#ff9f43', icon: 'chum', pri: 2 },
  boat: { color: '#ffe9a8', icon: 'boat', pri: 3 },
};

/**
 * 繪製精簡向量標記圖示（導航菱形針、魚形、誘魚點、小船），在各種高 DPR 螢幕下都保持銳利。
 */
function drawIcon(ctx, kind, cx, cy, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(8, 20, 32, 0.92)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  if (kind === 'pin') {
    ctx.moveTo(0, -5);
    ctx.lineTo(4.2, 0);
    ctx.lineTo(0, 5);
    ctx.lineTo(-4.2, 0);
    ctx.closePath();
  } else if (kind === 'fish') {
    ctx.moveTo(5.2, 0);
    ctx.quadraticCurveTo(1.2, -3.8, -2.2, -1.3);
    ctx.lineTo(-5.2, -3.0);
    ctx.lineTo(-3.9, 0);
    ctx.lineTo(-5.2, 3.0);
    ctx.lineTo(-2.2, 1.3);
    ctx.quadraticCurveTo(1.2, 3.8, 5.2, 0);
  } else if (kind === 'chum') {
    ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
  } else {
    ctx.moveTo(5, 0);
    ctx.lineTo(-4, 3.4);
    ctx.lineTo(-2.2, 0);
    ctx.lineTo(-4, -3.4);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

export class CompassBar {
  constructor(host, fovDeg = 120) {
    this.host = host;
    this.fovDeg = fovDeg;
    this.cv = document.createElement('canvas');
    this.cv.style.cssText = 'width:100%;height:100%;display:block;';
    host.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d');
    this._w = 0;
    this._h = 0;
    this._dpr = 0;
    this._lastSig = '';
    this._shown = false;
  }

  /**
   * 依目前方位角與圖標資料按需重繪羅盤（無變化或隱藏時零重繪成本）。
   */
  update(visible, headingDeg, markers = []) {
    if (visible !== this._shown) {
      this._shown = visible;
      this.host.style.display = visible ? 'block' : 'none';
      if (!visible) this._lastSig = '';
    }
    if (!visible) return;

    const rect = this.host.getBoundingClientRect();
    const w = Math.max(120, Math.round(rect.width));
    const h = Math.max(30, Math.round(rect.height));
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (w !== this._w || h !== this._h || dpr !== this._dpr) {
      this._w = w; this._h = h; this._dpr = dpr;
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
      this._lastSig = '';
    }

    const hd = ((headingDeg % 360) + 360) % 360;
    let sig = `${w}x${h}:${Math.round(hd * 5)}`;
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      sig += `|${m.kind}:${Math.round(m.deg)}:${Math.round(m.dist)}:${m.count ?? ''}:${m.hotLinked ? 1 : 0}`;
    }
    if (sig === this._lastSig) return;
    this._lastSig = sig;
    this._draw(hd, markers, w, h, dpr);
  }

  _draw(hd, markers, w, h, dpr) {
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const fov = this.fovDeg;
    const pxPerDeg = w / fov;
    const fadeW = Math.max(20, w * 0.12);
    const edgeFade = (x) => {
      const distEdge = Math.min(x, w - x);
      return distEdge >= fadeW ? 1 : Math.max(0, distEdge / fadeW);
    };

    // 1) 純透明無底框刻度與 ESWN 方位字母（不繪製任何角度數字）
    const tickY = Math.round(h * 0.44);
    const labelY = Math.round(h * 0.76);
    const startDeg = Math.floor((hd - fov / 2) / 5) * 5;
    const endDeg = Math.ceil((hd + fov / 2) / 5) * 5;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let raw = startDeg; raw <= endDeg; raw += 5) {
      const deg = ((raw % 360) + 360) % 360;
      const d = wrap180(deg - hd);
      const x = cx + d * pxPerDeg;
      const alpha = edgeFade(x);
      if (alpha <= 0.02) continue;

      const major = deg % 15 === 0;
      const card = CARDINALS.get(deg);
      ctx.save();
      ctx.globalAlpha = alpha * (major ? 0.92 : 0.48);
      ctx.shadowColor = 'rgba(6, 18, 30, 0.78)';
      ctx.shadowBlur = 2.5;
      ctx.strokeStyle = deg === 0 ? '#ff7f5c' : '#ffffff';
      ctx.lineWidth = card && card.length === 1 ? 2.0 : 1.3;
      ctx.beginPath();
      ctx.moveTo(x, tickY);
      ctx.lineTo(x, tickY + (major ? 5.5 : 3.2));
      ctx.stroke();

      if (card) {
        const main = card.length === 1;
        ctx.globalAlpha = alpha * (main ? 1 : 0.82);
        ctx.font = main ? '700 14px system-ui, sans-serif' : '600 10.5px system-ui, sans-serif';
        ctx.fillStyle = deg === 0 ? '#ff7f5c' : main ? '#ffffff' : '#dceeff';
        ctx.strokeStyle = 'rgba(6, 18, 30, 0.85)';
        ctx.lineWidth = 3.2;
        ctx.strokeText(card, x, labelY);
        ctx.fillText(card, x, labelY);
      }
      ctx.restore();
    }

    // 2) 中央準星固定三角指標（無角度讀數框）
    ctx.save();
    ctx.shadowColor = 'rgba(6, 18, 30, 0.85)';
    ctx.shadowBlur = 2.5;
    ctx.fillStyle = '#ffd250';
    ctx.strokeStyle = 'rgba(6, 18, 30, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, tickY + 1);
    ctx.lineTo(cx - 4.5, tickY - 5.5);
    ctx.lineTo(cx + 4.5, tickY - 5.5);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    // 3) 導航與魚群圖標軌道（上排）
    const iconY = Math.round(h * 0.22);
    const placed = [];
    const sorted = [...markers].sort((a, b) => (MARKER_CFG[a.kind]?.pri ?? 9) - (MARKER_CFG[b.kind]?.pri ?? 9));
    for (let i = 0; i < sorted.length; i++) {
      const m = sorted[i];
      const cfg = MARKER_CFG[m.kind];
      if (!cfg) continue;
      if (Math.abs(wrap180(m.deg - hd)) > fov / 2 - 4 && !m.edge) continue;

      const p = projectCompassX(m.deg, hd, w, fov);
      let mx = p.x;
      let showText = !p.clamped;
      for (let j = 0; j < placed.length; j++) {
        if (Math.abs(placed[j] - mx) < 30) {
          if (p.clamped) mx += p.clamped < 0 ? 18 : -18;
          else showText = false;
        }
      }
      mx = Math.max(12, Math.min(w - 12, mx));
      placed.push(mx);

      ctx.save();
      ctx.globalAlpha = p.clamped ? 0.88 : 1;
      ctx.shadowColor = 'rgba(6, 18, 30, 0.78)';
      ctx.shadowBlur = 2.5;
      if (p.aligned) {
        ctx.fillStyle = m.hotLinked ? 'rgba(255, 210, 80, 0.26)' : 'rgba(255, 255, 255, 0.18)';
        ctx.beginPath();
        ctx.arc(mx, iconY, 8.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (m.hotLinked) {
        drawIcon(ctx, 'pin', mx - 4.5, iconY, '#52f0ff');
        drawIcon(ctx, 'fish', mx + 5, iconY, '#ffd250');
      } else {
        drawIcon(ctx, cfg.icon, mx, iconY, cfg.color);
      }

      const textShift = m.hotLinked ? 12 : 7;
      if (p.clamped) {
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.fillStyle = cfg.color;
        ctx.strokeStyle = 'rgba(6, 18, 30, 0.9)';
        ctx.lineWidth = 2.4;
        const arrow = p.clamped < 0 ? '‹' : '›';
        const ax = mx + (p.clamped < 0 ? -9 : m.hotLinked ? 12 : 8);
        ctx.strokeText(arrow, ax, iconY + 0.5);
        ctx.fillText(arrow, ax, iconY + 0.5);
      } else if (showText) {
        const distStr = compassDist(m.dist);
        const tag = m.count != null ? `${m.count}尾·${distStr}` : distStr;
        if (tag) {
          ctx.font = '600 9.5px ui-monospace, SFMono-Regular, monospace';
          ctx.textAlign = 'left';
          ctx.strokeStyle = 'rgba(6, 18, 30, 0.92)';
          ctx.lineWidth = 2.6;
          ctx.strokeText(tag, mx + textShift, iconY + 0.5);
          ctx.fillStyle = m.hotLinked ? '#ffe996' : cfg.color;
          ctx.fillText(tag, mx + textShift, iconY + 0.5);
        }
      }
      ctx.restore();
    }
  }
}
