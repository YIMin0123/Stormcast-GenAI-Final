// 天氣的畫面特效：雨絲、閃電、水龍捲。
import * as THREE from 'three';
import { TSU, TSU_H } from './weather.js';
import { tsuExtra, swellLib } from './renderShaders.js';

// 雨：一盒跟著鏡頭走的雨絲，每一滴掉到底就從上面再來一次。雨被風吹斜，風一陣一陣的，雨絲也跟著忽斜忽直
export class Rain {
  constructor(n = 3600) {
    const seed = new Float32Array(n * 2 * 4), pos = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      for (let e = 0; e < 2; e++) seed.set([...s, e], (i * 2 + e) * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));   // xyz：位置的亂數；w：線段的頭或尾
    this.box = new THREE.Vector3(40, 24, 40);
    this.off = new THREE.Vector3();
    this._t = 0;
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmount: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) },
        uBox: { value: this.box }, uOff: { value: this.off }, uVel: { value: new THREE.Vector3(0, -17, 0) },
        uRoofA: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uRoofB: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime, uAmount;
        uniform vec3 uCam, uBox, uOff, uVel;
        uniform vec4 uRoofA[2], uRoofB[2];   // 遮雨的屋頂：A = 中心 xz、方向 ux uz；B = 半寬、半長、屋頂高度（半寬 0 = 沒有）
        varying float vA;
        void main() {
          float extra = -6.0 * aSeed.y;                                  // 每一滴掉的速度不太一樣
          vec3 w = mod(aSeed.xyz * uBox + uOff + vec3(0.0, extra * uTime, 0.0) - uCam, uBox) - 0.5 * uBox + uCam;
          float dry = 0.0;   // 這一滴在屋頂底下：不畫（用雨絲的頭來判斷，頭尾兩個頂點才會一致）
          for (int i = 0; i < 2; i++) {
            vec2 d = w.xz - uRoofA[i].xy, u = uRoofA[i].zw;
            if (w.y < uRoofB[i].z && abs(dot(d, u)) < uRoofB[i].x && abs(dot(d, vec2(-u.y, u.x))) < uRoofB[i].y) dry = 1.0;
          }
          w += aSeed.w * (uVel + vec3(0.0, extra, 0.0)) * 0.042;         // 雨絲順著它掉的方向拉長
          float on = step(fract(aSeed.x * 7.31 + aSeed.z * 3.17), uAmount) * (1.0 - dry);   // 雨越大，畫出來的雨絲越多
          vA = on * (0.3 + 0.35 * fract(aSeed.z * 11.7));
          gl_Position = on > 0.5 ? projectionMatrix * viewMatrix * vec4(w, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() { gl_FragColor = vec4(uColor, vA); }`,
    });
    this.lines = new THREE.LineSegments(g, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    this.lines.visible = false;
  }

  // 有屋頂遮雨的地方（最多兩塊，見 layout.js 的 ROOFS_W）
  setRoofs(roofs) {
    const u = this.material.uniforms;
    roofs.slice(0, 2).forEach((b, i) => { u.uRoofA.value[i].set(b.cx, b.cz, b.ux, b.uz); u.uRoofB.value[i].set(b.hx, b.hz, b.y, 0); });
  }

  // amount：雨勢 0–1；light：現在有多亮（晚上的雨絲是暗的，閃電時整片亮起來）；wx、wz：風把雨往哪邊吹（公尺／秒）
  update(time, cam, amount, light, wx = 3, wz = 1.5) {
    this.lines.visible = amount > 0.02;
    const u = this.material.uniforms, dt = Math.min(0.1, Math.max(0, time - this._t));
    this._t = time;
    u.uVel.value.set(wx, -17, wz);
    // 風會變，所以位移要一幀一幀累加（直接用「速度 × 時間」的話，風一變整片雨會瞬間跳位）
    const o = this.off, b = this.box;
    o.x = (o.x + wx * dt) % b.x; o.y = (o.y - 17 * dt) % b.y; o.z = (o.z + wz * dt) % b.z;
    u.uTime.value = time; u.uCam.value.copy(cam); u.uAmount.value = amount;
    const l = 0.3 + 0.7 * light;   // 雨絲會反光，天再暗也比背景亮一點（不然大雨時反而看不到雨）
    u.uColor.value.setRGB(0.75 * l, 0.8 * l, 0.88 * l);
  }
}

// 閃電：從九百公尺高的雲底劈到海面。照真的順序來——
// 先導：一條暗淡的亮線從雲底往下竄，沿路分出好幾條岔（都往下、往外伸，沒碰到海面的就停在半空）
// 回擊：其中一條碰到海面的瞬間，整條主幹爆亮（岔路也跟著亮一下就滅）
// 再擊：同一條主幹接著再閃兩三下（這時岔路已經不亮了），所以閃電看起來會抖
// 形狀是「中點位移」的碎形：大彎裡有小彎、小彎裡還有更小的折
const BOLT_TOP = 900, BOLT_MAX = 512;
const _bv = new THREE.Vector3();
function jagged(a, b, levels, rough) {
  let pts = [a, b];
  for (let l = 0; l < levels; l++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1], len = p.distanceTo(q);
      const m = p.clone().add(q).multiplyScalar(0.5);
      m.x += (Math.random() * 2 - 1) * rough * len; m.z += (Math.random() * 2 - 1) * rough * len; m.y += (Math.random() * 2 - 1) * rough * len * 0.5;
      next.push(m, q);
    }
    pts = next;
  }
  return pts;
}

export class Bolt {
  // pix：一個像素張開的角度（共用的 uniform）——很遠的閃電也至少有幾個像素寬，不會細到看不見
  constructor(pix = { value: 0.001 }) {
    const g = this.geometry = new THREE.BufferGeometry();
    const attr = (name, size) => { const a = new THREE.BufferAttribute(new Float32Array(BOLT_MAX * 4 * size), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.aPos = attr('position', 3); this.aOther = attr('aOther', 3); this.aSide = attr('aSide', 2); this.aInfo = attr('aInfo', 3);
    const idx = new Uint16Array(BOLT_MAX * 6);
    for (let i = 0; i < BOLT_MAX; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      // 疊加上去的光，而且不能動到畫面的 alpha（alpha 是太陽光束用的「這裡有東西擋光」遮罩，寫進去的話閃電會變成一條擋光的黑線）
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: { uPix: pix, uGrow: { value: 0 }, uLead: { value: 0 }, uMain: { value: 0 }, uBranch: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aOther;   // 這一節的另一頭
        attribute vec2 aSide;    // x：亮線的左緣或右緣；y：這個頂點是這一節的頭（+1）還是尾（-1）
        attribute vec3 aInfo;    // x：先導竄到這裡的時刻（0 雲底、1 落地）；y：粗細；z：主幹 1、岔路 0
        uniform float uPix, uGrow, uLead, uMain, uBranch;
        varying float vS, vI;
        void main() {
          vec4 mv = viewMatrix * vec4(position, 1.0);
          vec4 mo = viewMatrix * vec4(aOther, 1.0);
          vec3 dir = normalize((mo.xyz - mv.xyz) * aSide.y);
          vec3 side = normalize(cross(dir, normalize(mv.xyz)));   // 永遠正面對著鏡頭的一條帶子
          float dist = length(mv.xyz);
          // 寬度含外圍的光暈：近看主幹約 9 公尺寬（中間那條白芯約 2 公尺），遠看至少 9 個像素
          float w = max(4.5, uPix * dist * 4.5) * aInfo.y;
          mv.xyz += side * aSide.x * w;
          vS = aSide.x;
          float t = aInfo.x;
          float lead = uLead * step(t, uGrow) * (0.10 + 0.9 * smoothstep(uGrow - 0.07, uGrow, t));   // 先導：暗暗的，只有正在往下竄的那個頭是亮的
          vI = lead + mix(uBranch, uMain, aInfo.z);
          vI *= smoothstep(${BOLT_TOP.toFixed(1)}, ${(BOLT_TOP - 240).toFixed(1)}, position.y);      // 頂端沒入雲裡
          vI *= exp(-dist * dist * ${(1 / 3000 ** 2).toExponential(3)});                             // 隔著雨幕，遠的暗一點（但閃電夠亮，比別的東西看得遠得多）
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vS, vI;
        void main() {
          float a = abs(vS);
          float core = smoothstep(0.26, 0.12, a);      // 中間一條銳利的白芯
          float halo = pow(max(1.0 - a, 0.0), 2.6);    // 外圍一圈藍紫色的光暈（max 不能省：a 內插後可能略大於 1，pow 吃到負數會變成 NaN，被 bloom 抹成一圈黑邊）
          gl_FragColor = vec4((vec3(1.0, 0.98, 1.0) * core * 7.0 + vec3(0.42, 0.48, 1.0) * halo * 1.2) * max(vI, 0.0), 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    this.t = 0; this.lead = 0.14; this.strokes = []; this.end = 0;
    this.light = 0;                       // 現在有多亮（0–1）：整個場景跟著它閃
    this.at = new THREE.Vector3();        // 閃電的中段在哪裡：那個方向的雲被照得最亮
  }

  // 打在 (x, z)，ground 是那裡的地面高度（海面是 0）
  strike(x, z, ground = 0) {
    const a = Math.random() * Math.PI * 2, off = 80 + Math.random() * 260;
    const top = new THREE.Vector3(x + Math.cos(a) * off, BOLT_TOP, z + Math.sin(a) * off), foot = new THREE.Vector3(x, ground, z);
    const main = jagged(top, foot, 6, 0.17);
    let total = 0;
    for (let i = 1; i < main.length; i++) total += main[i].distanceTo(main[i - 1]);
    let n = 0;
    const P = this.aPos.array, O = this.aOther.array, S = this.aSide.array, I = this.aInfo.array;
    const put = (p, q, tp, tq, wid, isMain) => {
      if (n >= BOLT_MAX) return;
      for (let k = 0; k < 4; k++) {
        const v = n * 4 + k, head = k < 2, e = head ? p : q, o = head ? q : p;
        P[v * 3] = e.x; P[v * 3 + 1] = e.y; P[v * 3 + 2] = e.z;
        O[v * 3] = o.x; O[v * 3 + 1] = o.y; O[v * 3 + 2] = o.z;
        S[v * 2] = k % 2 ? 1 : -1; S[v * 2 + 1] = head ? 1 : -1;
        I[v * 3] = head ? tp : tq; I[v * 3 + 1] = wid; I[v * 3 + 2] = isMain;
      }
      n++;
    };
    const chain = (pts, t0, t1, wid, isMain, taper) => {
      const m = pts.length - 1;
      for (let i = 0; i < m; i++) put(pts[i], pts[i + 1], t0 + (t1 - t0) * i / m, t0 + (t1 - t0) * (i + 1) / m, wid * (taper ? 1 - 0.55 * i / m : 1), isMain);
    };
    chain(main, 0, 1, 1, 1, false);
    // 岔路：從主幹的某一節岔出去，方向大致跟著主幹往下、再往旁邊偏；岔路上還會再分出更細的小岔
    const fork = (pts, tAt, levels, wid, count, lenK) => {
      for (let b = 0; b < count; b++) {
        const i = 2 + Math.floor(Math.random() * (pts.length - 6)), s = pts[i];
        if (s.y - ground < 90) continue;
        const ang = Math.random() * Math.PI * 2, lean = 0.5 + Math.random() * 0.8;
        _bv.copy(pts[Math.min(i + 3, pts.length - 1)]).sub(pts[Math.max(i - 2, 0)]).normalize();
        _bv.x += Math.cos(ang) * lean; _bv.z += Math.sin(ang) * lean; _bv.y = Math.min(_bv.y, -0.25);
        _bv.normalize();
        const len = Math.min((s.y - ground) * lenK * (0.35 + 0.65 * Math.random()), (s.y - ground - 40) / -_bv.y);
        const br = jagged(s.clone(), s.clone().addScaledVector(_bv, len), levels, 0.2);
        const t0 = tAt(i), t1 = t0 + len / total;
        chain(br, t0, t1, wid, 0, true);
        if (levels > 3) fork(br, (j) => t0 + (t1 - t0) * j / (br.length - 1), 3, wid * 0.6, Math.random() < 0.65 ? 1 + Math.floor(Math.random() * 2) : 0, 0.55);
      }
    };
    fork(main, (i) => i / (main.length - 1), 4, 0.55, 5 + Math.floor(Math.random() * 7), 0.6);
    this.aPos.needsUpdate = this.aOther.needsUpdate = this.aSide.needsUpdate = this.aInfo.needsUpdate = true;
    this.geometry.setDrawRange(0, n * 6);
    this.at.set((top.x + x) / 2, BOLT_TOP * 0.6, (top.z + z) / 2);
    this.t = 0;
    this.lead = 0.11 + Math.random() * 0.06;
    this.strokes = [{ at: this.lead, p: 1 }];
    for (let k = Math.floor(Math.random() * 4), at = this.lead; k > 0; k--) { at += 0.05 + Math.random() * 0.09; this.strokes.push({ at, p: 0.45 + 0.4 * Math.random() }); }
    this.end = this.strokes[this.strokes.length - 1].at + 0.3;
    this.mesh.visible = true;
  }

  update(dt) {
    if (!this.mesh.visible) { this.light = 0; return; }
    const u = this.material.uniforms, t = (this.t += dt);
    if (t > this.end) { this.mesh.visible = false; this.light = 0; return; }
    let main = 0;
    for (const s of this.strokes) if (t >= s.at) main = Math.max(main, s.p * Math.exp(-(t - s.at) / 0.05));
    if (t >= this.lead) main = Math.max(main, 0.07 * Math.min(1, (this.end - t) / 0.15));   // 兩下之間電還在流：主幹留著一條暗暗的線
    u.uGrow.value = Math.min(1, t / this.lead);
    u.uLead.value = t < this.lead ? 1 : 0;
    u.uMain.value = main;
    u.uBranch.value = t >= this.lead ? 0.8 * Math.exp(-(t - this.lead) / 0.035) : 0;
    this.light = t < this.lead ? 0.06 * t / this.lead : main;
  }
}

// 飛沫：風大到一個程度（風暴、颱風），浪頭的水被整片削下來，變成一道一道貼著海面往下風處飛的白霧。
// 每一道是順著風拉長的一條薄霧（幾十公尺長、兩三公尺寬），邊緣撕得破破碎碎，跟著長浪的起伏貼在水面上方；
// 一盒跟著鏡頭走，飛出盒子就從上風處再進來
export class Spindrift {
  // env：{ uTime, uWindDir }（跟海面共用的 uniform）
  constructor(env, n = 280) {
    const seed = new Float32Array(n * 4 * 4), corner = new Float32Array(n * 4 * 2), idx = new Uint16Array(n * 6);
    for (let i = 0; i < n; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < 4; k++) { seed.set(s, (i * 4 + k) * 4); corner.set([k < 2 ? 0 : 1, k % 2 ? 1 : -1], (i * 4 + k) * 2); }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));   // x：這條霧的頭（0）或尾（1）；y：左緣或右緣
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.box = new THREE.Vector2(150, 150);
    this.off = new THREE.Vector2();
    this._t = 0;
    this.material = new THREE.ShaderMaterial({
      // 不動畫面的 alpha（那是太陽光束用的遮罩）
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: {
        uTime: env.uTime, uSwellT: env.uTime, uWindDir: env.uWindDir, uSwell: { value: 0 },
        uCam: { value: new THREE.Vector3() }, uBox: { value: this.box }, uOff: { value: this.off },
        uAmount: { value: 0 }, uSwellK: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        ${swellLib}
        attribute vec4 aSeed;
        attribute vec2 aCorner;
        uniform vec3 uCam;
        uniform vec2 uBox, uOff;
        uniform float uAmount, uSwellK;
        varying vec3 vUv;   // x：沿著這條霧（0 頭、1 尾）；y：橫向（-1 到 1）；z：這條霧有多長（公尺）
        varying float vA, vSeed;
        void main() {
          float on = step(aSeed.w, uAmount);                                 // 風越大，飛沫越多
          vec2 c = mod(aSeed.xz * uBox + uOff - uCam.xz, uBox) - 0.5 * uBox + uCam.xz;
          float len = mix(16.0, 46.0, fract(aSeed.w * 7.3)), wid = mix(0.9, 2.6, fract(aSeed.w * 13.7)) * (0.6 + 0.4 * aSeed.y);
          vec2 xz = c + uWindDir * (aCorner.x - 0.5) * len;
          // 貼在水面上方：跟著長浪起伏；大多數貼得很低，少數被捲到三四公尺高
          float h = 0.5 + 4.0 * aSeed.y * aSeed.y * aSeed.y + 0.4 * sin(aSeed.w * 40.0 + uTime * 1.7);
          vec3 w = vec3(xz.x, uSwellK * longSwell(xz).x + h, xz.y);
          // 繞著風向轉、永遠把寬的那一面對著鏡頭
          vec3 axis = vec3(uWindDir.x, 0.0, uWindDir.y), side = normalize(cross(axis, w - uCam) + vec3(0.0, 1e-4, 0.0));
          w += side * aCorner.y * wid;
          float d = distance(c, uCam.xz);
          vA = on * smoothstep(0.5 * uBox.x, 0.34 * uBox.x, d) * smoothstep(5.0, 16.0, length(w - uCam));   // 盒子邊緣淡出（不會憑空冒出來）；貼到臉上的也淡掉
          vUv = vec3(aCorner.x, aCorner.y, len);
          vSeed = aSeed.w * 91.0;
          gl_Position = vA > 0.004 ? projectionMatrix * viewMatrix * vec4(w, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec3 vUv;
        varying float vA, vSeed;
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          float u = vUv.x, v = vUv.y;
          // 一絲一絲順著風拉長的紋路，往下風處流；整條霧頭濃尾淡、邊緣撕破
          float n = 0.6 * vn(vec2(u * vUv.z * 0.16 - uTime * 2.2 + vSeed, v * 1.6 + vSeed)) + 0.4 * vn(vec2(u * vUv.z * 0.5 - uTime * 4.0, v * 4.0 + vSeed * 1.7));
          float body = (1.0 - v * v) * smoothstep(0.0, 0.12, u) * pow(1.0 - u, 0.7);
          float a = smoothstep(0.42, 0.95, n + 0.75 * body - 0.35) * body;
          gl_FragColor = vec4(uColor, 0.34 * a * vA);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  // amount：飛沫有多濃 0–1；swellK：鏡頭這裡的長浪有多高（公尺）；light：現在有多亮；wx、wz：風速（公尺／秒）
  update(time, cam, amount, swellK, light, wx, wz) {
    this.mesh.visible = amount > 0.02;
    const u = this.material.uniforms, dt = Math.min(0.1, Math.max(0, time - this._t)), o = this.off, b = this.box;
    this._t = time;
    o.x = (o.x + 0.8 * wx * dt) % b.x; o.y = (o.y + 0.8 * wz * dt) % b.y;   // 飛沫比風慢一點
    u.uCam.value.copy(cam); u.uAmount.value = amount; u.uSwellK.value = swellK;
    const l = 0.25 + 0.75 * light;
    u.uColor.value.setRGB(0.86 * l, 0.9 * l, 0.94 * l);
  }
}

// ---- 水龍捲 -----------------------------------------------------------------
// 三個部分：頭頂一片壓低的暗雲、從雲底垂下來的細長漏斗、腳下一圈被捲起來的水霧。
// 生成的順序照真的來：海面先出現打轉的白沫（在海面的 shader 裡）→ 漏斗從雲底往下伸 → 碰到海面才捲起水霧；
// 消散時漏斗變細、扭成一條繩子，縮回雲裡
// 尺寸是龐然大物：腳下的漏斗直徑約 85 公尺、水霧圈寬近 500 公尺，頂端伸進一公里高的雲底（再往上就沒入霧裡了）
const SPOUT_H = 1000;   // 雲底的高度（公尺）
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

const spoutLib = /* glsl */ `
uniform float uTime, uSeed;
uniform vec3 uAmbient, uSunCol, uFogCol;
uniform float uGloom, uFogDen;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// 遠的地方融進霧裡（跟場景同一個霧，但淡很多：這麼大的東西隔著雨幕也看得到輪廓，往上才漸漸沒入雲霧）
vec3 hazed(vec3 c, vec3 world, float k) {
  float d = distance(world, cameraPosition);
  return mix(uFogCol, c, exp(-k * uFogDen * uFogDen * d * d));
}
// 漏斗的中心線在高度 t（0 海面、1 雲底）偏離正中央多少：頂端跟著雲走、底部黏在海面上，
// 中間被風吹成弧形，再疊上小幅的扭動。水霧和水花也跟著這條線走，才不會跟漏斗分家
uniform vec2 uLean;
uniform float uThin;
vec2 spoutAxis(float t) {
  float bow = sin(3.14159 * t);
  vec2 c = uLean * t;
  c += bow * 85.0 * vec2(sin(t * 2.6 + uTime * 0.11 + uSeed), cos(t * 2.1 - uTime * 0.09 + uSeed * 1.7));
  c += bow * (18.0 + 40.0 * uThin) * vec2(sin(t * 9.0 - uTime * 0.4 + uSeed * 2.3), cos(t * 7.0 + uTime * 0.33 + uSeed));
  return c;
}
`;
const spoutEnd = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// 漏斗：圓柱的每一圈頂點在 shader 裡擺到該在的位置，所以整條可以慢慢扭動，不是一根硬梆梆的管子在轉
const funnelVert = /* glsl */ `
${spoutLib}
uniform float uReach;
varying vec3 vWorld, vRad;
varying float vT, vAng, vAlong;
void main() {
  float tip = 1.0 - uReach;                                 // 漏斗的尖端現在伸到哪裡（0 海面、1 雲底）
  float t = max(position.y, tip);
  vAlong = (t - tip) / max(1.0 - tip, 1e-3);
  float touch = smoothstep(0.92, 1.0, uReach);
  float r = 42.0 + 48.0 * t + 400.0 * pow(t, 6.0);          // 大半段是一根粗柱子，接近雲底才張開成喇叭口
  r *= 1.0 - 0.62 * uThin * (1.0 - t * t);
  r *= mix(smoothstep(0.0, 0.12, vAlong), 1.0, touch);       // 還沒碰到海面時尖端是收起來的
  r += touch * 20.0 * exp(-t * 30.0);
  vec2 c = spoutAxis(t);
  vRad = vec3(position.x, 0.0, position.z);
  vec4 w = modelMatrix * vec4(vec3(c.x, t * ${SPOUT_H}.0, c.y) + vRad * r, 1.0);
  vWorld = w.xyz; vT = t; vAng = uv.x * 6.28318;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const funnelFrag = /* glsl */ `
${spoutLib}
uniform float uFade;
varying vec3 vWorld, vRad;
varying float vT, vAng, vAlong;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = clamp(dot(normalize(vRad), normalize(vec3(V.x, 0.0, V.z))), 0.0, 1.0);   // 1 正對鏡頭、0 輪廓
  // 繞著管身往上爬的條紋：看得出它在轉
  float tw = vAng + vT * 11.0 - uTime * 0.9;                 // 順著螺旋走的角度（螺旋很陡：水氣是一邊繞一邊被往上抽）
  float n = 0.6 * vn(vec2(cos(tw), sin(tw)) * 3.6 + vec2(vT * 13.0 - uTime * 0.35, uSeed))
          + 0.4 * vn(vec2(cos(tw * 2.0), sin(tw * 2.0)) * 2.8 + vec2(uSeed, vT * 31.0 - uTime * 0.8));
  float band = smoothstep(0.52, 0.58, n);                    // 細長、長短不一的一絲一絲
  // 空心的管子：兩側的輪廓又暗又實，中間比較亮、比較透
  float edge = smoothstep(0.86, 0.50, facing);
  vec3 col = mix(vec3(0.19, 0.225, 0.28), vec3(0.37, 0.42, 0.49), band * (1.0 - edge));
  col = mix(col, vec3(0.085, 0.105, 0.145), edge);
  col = mix(col, vec3(0.10, 0.12, 0.16), smoothstep(0.76, 0.90, vT));   // 往上接進暗雲裡：顏色跟雲底一樣，喇叭口的邊緣淡掉
  col *= uAmbient;
  float a = mix(0.84, 0.98, edge) * uFade * smoothstep(0.0, 0.04, vAlong) * smoothstep(1.0, 0.91, vT);
  gl_FragColor = vec4(hazed(col, vWorld, 0.16), a);
  ${spoutEnd}
}`;

// 暗雲：一片中間往下垂、往外漸漸抬高的雲底，邊緣是一塊一塊的
const cloudVert = /* glsl */ `
uniform vec2 uLean;
varying vec3 vWorld;
varying vec2 vP;
varying float vU;
void main() {
  vU = position.y;
  float r = mix(250.0, 1500.0, vU);
  vP = position.xz * r;
  float y = ${SPOUT_H - 40}.0 + 160.0 * (1.0 - exp(-(r - 250.0) / 500.0));
  vec4 w = modelMatrix * vec4(vP.x + uLean.x, y, vP.y + uLean.y, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const cloudFrag = /* glsl */ `
${spoutLib}
uniform float uFade;
varying vec3 vWorld;
varying vec2 vP;
varying float vU;
void main() {
  float ca = cos(uTime * 0.04), sa = sin(uTime * 0.04);
  vec2 q = mat2(ca, -sa, sa, ca) * vP;                       // 整片雲繞著漏斗慢慢轉
  float n = 0.6 * vn(q / 300.0 + uSeed) + 0.4 * vn(q / 95.0 + 7.0);
  float dens = smoothstep(0.0, 0.06, n * 0.75 + 0.62 - vU * 1.25);
  // 雲底是一塊一塊深淺不同的暗灰，越靠近漏斗越黑
  float lump = 0.55 * vn(q / 170.0 + 31.0 + uSeed) + 0.45 * vn(q / 60.0 + 3.0);
  vec3 col = mix(vec3(0.085, 0.10, 0.135), vec3(0.19, 0.225, 0.28), smoothstep(0.47, 0.53, lump + 0.45 * vU - 0.12));
  col = mix(col, vec3(0.27, 0.31, 0.37), smoothstep(0.50, 0.56, n + 0.5 * vU - 0.3)) * uAmbient;
  gl_FragColor = vec4(hazed(col, vWorld, 0.06), 0.95 * dens * uFade);
  ${spoutEnd}
}`;

// 水霧：貼著海面往外往上張開的一圈，上緣是一撮一撮被甩出去的
// 水霧是一團有厚度的霧，不是一面牆：由內到外疊五層半透明的薄霧，裡面的又高又窄、貼著漏斗往上爬，
// 外面的又矮又寬、貼著海面散開。每一層的輪廓邊緣都淡掉，疊起來中間濃、外圍稀，看不出是一層一層的殼
const ringVert = /* glsl */ `
${spoutLib}
uniform float uGrow;
uniform vec4 uShell;   // (內徑, 往外張開多少, 高度, 轉速)
varying vec3 vWorld, vRad;
varying float vS, vAng, vH;
void main() {
  vS = position.y;
  vAng = uv.x * 6.28318;
  // 貼著海面的地方近乎直立，越往上越往外散開；整圈不是正圓，會慢慢變形
  float r = (uShell.x + uShell.y * pow(vS, 1.25)) * (0.6 + 0.4 * uGrow);
  r *= 1.0 + 0.09 * sin(3.0 * vAng + uTime * 0.23 + uShell.x) + 0.05 * sin(5.0 * vAng - uTime * 0.17 + uShell.z);
  vH = uShell.z * vS * uGrow;
  vRad = vec3(position.x, 0.0, position.z);
  vec2 c = spoutAxis(vH / ${SPOUT_H}.0);
  vec4 w = modelMatrix * vec4(c.x + position.x * r, vH - 1.0, c.y + position.z * r, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// 水花：幾千片被風撕成長條的碎水，位置直接在 shader 裡照時間算（不用 CPU 一顆一顆模擬）。三種：
//   0 被捲上去的：從外圍貼著海面繞進來，越繞越快、越繞越高，纏著漏斗往上爬，到頂被甩開、散掉
//   1 被甩出去的：從水霧圈裡順著風的切線方向拋出去，劃一道弧線落回海面
//   2 繞著轉的水霧：一大團一大團淡淡的霧，繞著漏斗慢慢轉、慢慢往上飄
const sprayVert = /* glsl */ `
${spoutLib}
attribute vec4 aSeed;
attribute vec2 aKind;
uniform float uGrow;
varying vec2 vUv;
varying vec3 vWorld;
varying float vA, vKind, vSeed;
vec3 sprayPos(float tt, out float fade, out float age) {
  vec4 s = aSeed;
  float k2 = aKind.y;
  if (aKind.x < 0.5) {
    float T = mix(9.0, 15.0, s.y), u = fract(tt / T + s.x);
    float rr = mix(mix(110.0, 300.0, s.z), mix(52.0, 95.0, s.w), smoothstep(0.0, 0.55, u))
             + 150.0 * k2 * pow(max(u - 0.62, 0.0) / 0.38, 2.0);
    float y = mix(70.0, 460.0, k2 * k2) * pow(u, 1.5) + 2.0;
    float th = s.x * 44.0 + s.z * 6.283 - mix(2.2, 4.5, s.w) * (u + 1.3 * u * u);
    vec2 c = spoutAxis(y / ${SPOUT_H}.0);
    age = u; fade = smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.7, u);
    return vec3(c.x + cos(th) * rr, y, c.y + sin(th) * rr);
  }
  if (aKind.x < 1.5) {
    float vy = mix(20.0, 46.0, s.y), T = vy / 4.9, cyc = tt / T + s.x, t = fract(cyc) * T;
    float th = s.z * 6.283 + floor(cyc) * 2.4;
    vec2 rad = vec2(cos(th), sin(th)), tg = vec2(rad.y, -rad.x);
    vec2 p = rad * mix(60.0, 190.0, s.w) + (tg * mix(22.0, 42.0, k2) + rad * mix(6.0, 22.0, fract(k2 * 7.3))) * t * (1.0 - 0.035 * t);
    age = t / T; fade = smoothstep(0.0, 0.1, age) * smoothstep(1.0, 0.8, age);
    return vec3(p.x, vy * t - 4.9 * t * t + 1.0, p.y);
  }
  float T = mix(16.0, 30.0, s.y), u = fract(tt / T + s.x);
  float rr = mix(70.0, 250.0, s.z) * (1.0 + 0.25 * u);
  float y = mix(8.0, 50.0, s.w) + mix(30.0, 190.0, k2) * u;
  float th = s.x * 44.0 - mix(6.0, 2.5, s.z) * u;
  vec2 c = spoutAxis(y / ${SPOUT_H}.0);
  age = u; fade = smoothstep(0.0, 0.15, u) * smoothstep(1.0, 0.6, u);
  return vec3(c.x + cos(th) * rr, y, c.y + sin(th) * rr);
}
void main() {
  float f0, a0, f1, a1;
  vec3 P0 = sprayPos(uTime, f0, a0), P1 = sprayPos(uTime + 0.08, f1, a1);
  vec4 w0 = modelMatrix * vec4(P0, 1.0);
  vec4 v0 = viewMatrix * w0;
  vec3 dv = (viewMatrix * (modelMatrix * vec4(P1, 1.0))).xyz - v0.xyz;
  // 每一片都順著自己飛的方向拉長（朝著鏡頭飛來的就不拉）
  vec2 dir = normalize(dv.xy + vec2(1e-4, 0.0));
  float wid, len;
  if (aKind.x < 0.5) { wid = mix(1.0, 2.4, aSeed.z) * (1.0 + 1.8 * a0); len = mix(11.0, 28.0, aSeed.w) * (1.0 + 0.6 * a0); }
  else if (aKind.x < 1.5) { wid = mix(1.2, 3.0, aSeed.z) * (1.0 + 2.2 * a0); len = mix(8.0, 17.0, aSeed.w); }
  else { wid = mix(28.0, 62.0, aSeed.w) * (0.7 + 0.6 * a0); len = wid * 1.7; }
  len = mix(wid, len, clamp(length(dv.xy) / max(length(dv), 1e-3), 0.0, 1.0));
  v0.xy += dir * position.x * len + vec2(-dir.y, dir.x) * position.y * wid;
  vUv = position.xy; vKind = aKind.x; vSeed = aSeed.x + aSeed.y;
  // 貼到鏡頭前面的淡掉，免得一片水花蓋住整個畫面
  vA = f0 * uGrow * smoothstep(20.0, 70.0, -v0.z) * (aKind.x < 1.5 ? 0.62 : 0.2);
  vWorld = w0.xyz;
  gl_Position = projectionMatrix * v0;
}`;
const sprayFrag = /* glsl */ `
${spoutLib}
varying vec2 vUv;
varying vec3 vWorld;
varying float vA, vKind, vSeed;
void main() {
  float n = vn(vUv * (vKind > 1.5 ? 1.8 : 2.4) + vSeed * 53.0), n2 = vn(vUv * 5.0 + vSeed * 17.0);
  // 頭寬尾細的一片，邊緣被撕得破破爛爛（不是圓點）
  float w = vKind > 1.5 ? 1.0 : mix(0.4, 1.0, vUv.x * 0.5 + 0.5);
  float d = length(vec2(vUv.x, vUv.y / w));
  float body = smoothstep(1.0, 0.25, d + 0.8 * (n - 0.5) + 0.3 * (n2 - 0.5));
  float a = vA * body;
  if (a < 0.012) discard;
  vec3 light = 0.66 * uAmbient + 0.22 * uSunCol * (1.0 - 0.8 * uGloom);
  vec3 col = mix(vec3(0.58, 0.66, 0.77), vec3(0.94, 0.96, 0.98), smoothstep(0.38, 0.62, n + 0.35 * (1.0 - d))) * light;
  gl_FragColor = vec4(hazed(col, vWorld, 0.16), a);
  ${spoutEnd}
}`;
const ringFrag = /* glsl */ `
${spoutLib}
uniform float uGrow;
uniform vec4 uShell;
uniform float uShellA;
varying vec3 vWorld, vRad;
varying float vS, vAng, vH;
void main() {
  float a = vAng - uTime * uShell.w + vS * 1.4;              // 水霧被風帶著繞圈，一邊繞一邊往上
  float n = 0.5 * vn(vec2(cos(a), sin(a)) * 2.6 + vec2(vS * 5.0 - uTime * 0.35, uSeed + uShell.x))
          + 0.3 * vn(vec2(cos(a * 3.0), sin(a * 3.0)) * 2.4 + vec2(uSeed + uShell.z, vS * 11.0 - uTime * 0.7))
          + 0.2 * vn(vec2(cos(a * 8.0), sin(a * 8.0)) * 2.0 + vec2(vS * 24.0 - uTime * 1.1, uSeed * 1.3));
  // 貼著海面最濃，越往上越稀薄，散成一縷一縷；邊界是糊的（是霧，不是實心的東西）
  float dens = smoothstep(0.0, 0.42, n * 1.3 + 0.55 - vS * 1.45) * smoothstep(1.0, 0.72, vS) * smoothstep(0.0, 5.0, vH);
  // 這一層的左右輪廓淡掉：看不到殼的邊
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = abs(dot(normalize(vRad), normalize(vec3(V.x, 0.0, V.z) + 1e-5)));
  dens *= smoothstep(0.03, 0.55, facing);
  vec3 light = 0.66 * uAmbient + 0.22 * uSunCol * (1.0 - 0.8 * uGloom);
  vec3 col = mix(vec3(0.56, 0.63, 0.73), vec3(0.88, 0.91, 0.94), smoothstep(0.30, 0.70, n + 0.35 * vS)) * light;
  gl_FragColor = vec4(hazed(col, vWorld, 0.16), uShellA * dens * uGrow);
  ${spoutEnd}
}`;

// ---- 巨浪的浪頂飛沫 -----------------------------------------------------------
// 浪頭翻白的那幾段，頂上的水被風一絲一絲地掀起來，落在浪頭後面，拖成一道水霧。
// 跟水龍捲的水花一樣是幾千片長條，位置在 shader 裡算；只擺在鏡頭左右七百公尺內的浪線上
const waveSprayVert = /* glsl */ `
${spoutLib}
${tsuExtra}
attribute vec4 aSeed;
attribute vec2 aKind;        // (第幾道浪, 亂數：> 0.72 的是一大團水霧)
uniform vec4 uTsu;
uniform vec2 uTsu2;
uniform sampler2D uTsuK;
uniform float uL;
varying vec2 vUv;
varying vec3 vWorld;
varying float vA, vKind, vSeed;
// ahead：往後推算幾秒（用來算這一片正往哪個方向飛）
float gImp = 0.0;   // 這一片是不是捲舌砸下去炸起來的水
vec3 sprayPos(float ahead, out float fade, out float age) {
  vec2 dir = uTsu.xy, perp = vec2(dir.y, -dir.x);
  float fi = aKind.x;
  float cl = dot(cameraPosition.xz, perp);
  float l = cl + mod(aSeed.x * 1400.0 - cl, 1400.0) - 700.0;
  float amp = 1.0 + 0.16 * sin(l * 0.009 + 1.7 * fi + uTsu2.x) + 0.09 * sin(l * 0.023 + 2.9 * fi + 2.0 * uTsu2.x);
  float shift = 26.0 * sin(l * 0.0052 + 2.3 * fi + 1.3 * uTsu2.x) + 10.0 * sin(l * 0.0151 + 4.1 * fi + 0.7 * uTsu2.x);
  float br = smoothstep(0.98, 1.14, amp + 0.06 * sin(l * 0.061 + 5.0 * fi));
  float T = mix(2.4, 5.0, aSeed.y), u = fract((uTime + ahead) / T + aSeed.z), t = u * T;
  float a0 = uTsu.z + ${TSU.speed.toFixed(1)} * ahead - fi * ${TSU.gap.toFixed(1)} - shift;   // 浪頭現在在哪
  float dng = textureLod(uTsuK, clamp((dir * a0 + perp * l) / uL + 0.5, 0.0, 1.0), 0.0).r;   // 浪到這裡剩幾成高
  float k = fi < 0.5 ? ${TSU.k[0].toFixed(2)} : fi < 1.5 ? ${TSU.k[1].toFixed(2)} : ${TSU.k[2].toFixed(2)};
  float top = k * amp * uTsu.w * tsuHK(dng);
  float B = tsuBreak(l, br, dng, uTime);
  if (B > 0.3 && fract(aKind.y * 7.31) > 0.4) {
    // 正在捲的那幾段：捲舌砸在浪腳上，水被炸起來、往前往上噴，升到比浪頂還高，再被浪追過去
    float vf = ${TSU.speed.toFixed(1)} * mix(0.9, 1.3, fract(aKind.y * 3.7));
    float a = a0 + tsuLeanS(B, uTsu.w) + mix(11.0, 19.0, aSeed.w) - ${TSU.speed.toFixed(1)} * t + 1.3 * vf * (1.0 - exp(-t / 1.3));
    vec2 xz = dir * a + perp * (l + (fract(aKind.y * 13.7) - 0.5) * 10.0 * t);
    age = u; gImp = 1.0;
    fade = smoothstep(0.0, 0.06, u) * pow(1.0 - u, 1.2) * B;
    return vec3(xz.x, top * 0.33 + mix(7.0, 17.0, aSeed.y) * t - 2.6 * t * t, xz.y);
  }
  // 從浪頂被掀起來：往上拋、落在浪頭後面（浪往前跑，水花留在原地）
  float a = a0 + 4.0 - ${TSU.speed.toFixed(1)} * mix(0.5, 0.95, aSeed.w) * t;
  vec2 xz = dir * a + perp * (l + (fract(aKind.y * 13.7) - 0.5) * 16.0 * t);
  float y = top * 0.97 + mix(3.0, 10.0, aSeed.w) * t - 1.7 * t * t;
  age = u;
  fade = smoothstep(0.0, 0.08, u) * pow(1.0 - u, 1.3) * (0.2 + 0.8 * br) * smoothstep(0.05, 0.45, dng) * min(tsuHK(dng) / ${TSU_H.peak.toFixed(3)}, 1.0);   // 外海的浪頭很矮，沒什麼水花
  return vec3(xz.x, y, xz.y);
}
void main() {
  float f0, a0, f1, a1;
  vec3 P0 = sprayPos(0.0, f0, a0), P1 = sprayPos(0.08, f1, a1);
  vec4 v0 = viewMatrix * vec4(P0, 1.0);
  vec3 dv = (viewMatrix * vec4(P1, 1.0)).xyz - v0.xyz;
  vec2 dir = normalize(dv.xy + vec2(1e-4, 0.0));
  bool puff = aKind.y > 0.72;
  float wid = puff ? mix(6.0, 13.0, aSeed.z) * (1.0 + 1.2 * a0) : mix(2.0, 4.5, aSeed.z) * (1.0 + 2.5 * a0);   // 水霧一團最大二十幾公尺：再大就比浪本身還搶眼
  float len = puff ? wid * 1.3 : mix(6.0, 12.0, aSeed.w);
  len = mix(wid, len, clamp(length(dv.xy) / max(length(dv), 1e-3), 0.0, 1.0));
  v0.xy += dir * position.x * len + vec2(-dir.y, dir.x) * position.y * wid;
  vUv = position.xy; vKind = puff ? 2.0 : 0.0; vSeed = aSeed.x + aSeed.y;
  vA = f0 * smoothstep(20.0, 70.0, -v0.z) * (puff ? mix(0.26, 0.11, gImp) : 0.5);   // 砸下去的那團水霧淡一點，不要把浪底下的空腔整個遮住
  vWorld = P0;
  gl_Position = vA < 0.012 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * v0;   // 淡到看不見的那幾片直接不畫（省下一大片透明像素）
}`;

// env：{ uTime, uAmbient, uSunCol, uGloom, fog, uTsu, uTsu2, uDanger, uL }
export class WaveSpray {
  constructor(env) {
    const N = 3 * 1800, seed = new Float32Array(N * 4), kind = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
      kind[i * 2] = i % 3; kind[i * 2 + 1] = Math.random();
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 2));
    g.instanceCount = N;
    this.u = {
      uTime: env.uTime, uAmbient: env.uAmbient, uSunCol: env.uSunCol, uGloom: env.uGloom,
      uFogCol: { value: env.fog.color }, uFogDen: { value: 0 }, uSeed: { value: 0 }, uLean: { value: new THREE.Vector2() }, uThin: { value: 0 },
      uTsu: env.uTsu, uTsu2: env.uTsu2, uTsuK: env.uTsuK, uL: env.uL,
    };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: waveSprayVert, fragmentShader: sprayFrag, side: THREE.DoubleSide, transparent: true, depthWrite: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    this.fog = env.fog;
  }

  update(on) {
    this.mesh.visible = on;
    this.u.uFogDen.value = this.fog.density;
  }
}

// env：{ uTime, uAmbient, uSunCol, uGloom }（跟海面共用的 uniform）與 fog（場景的霧）
export class Spout {
  constructor(env) {
    const tube = (radial, rows) => new THREE.CylinderGeometry(1, 1, 1, radial, rows, true).translate(0, 0.5, 0);
    const u = this.u = {
      uTime: env.uTime, uAmbient: env.uAmbient, uSunCol: env.uSunCol, uGloom: env.uGloom,
      uFogCol: { value: env.fog.color }, uFogDen: { value: 0 }, uSeed: { value: Math.random() * 40 },
      uReach: { value: 0 }, uThin: { value: 0 }, uLean: { value: new THREE.Vector2() }, uFade: { value: 0 }, uGrow: { value: 0 },
    };
    const mat = (vertexShader, fragmentShader, side) => new THREE.ShaderMaterial({ uniforms: u, vertexShader, fragmentShader, side, transparent: true, depthWrite: false });
    this.cloud = new THREE.Mesh(tube(64, 10), mat(cloudVert, cloudFrag, THREE.DoubleSide));
    this.funnel = new THREE.Mesh(tube(48, 72), mat(funnelVert, funnelFrag, THREE.FrontSide));
    const shell = (x, y, z, w, a) => {
      const m = new THREE.Mesh(tube(72, 10), mat(ringVert, ringFrag, THREE.DoubleSide));
      m.material.uniforms = { ...u, uShell: { value: new THREE.Vector4(x, y, z, w) }, uShellA: { value: a } };
      m.renderOrder = 4;
      return m;
    };
    this.ring = new THREE.Group();
    this.ring.add(shell(46, 40, 230, 0.95, 0.42), shell(66, 70, 170, 0.8, 0.52), shell(95, 105, 125, 0.66, 0.56),
      shell(135, 115, 85, 0.54, 0.48), shell(180, 100, 50, 0.45, 0.38));
    // 水花：每一片是一個小方塊，種類與亂數放在每片各自的屬性裡
    const counts = [4400, 1700, 110], N = counts[0] + counts[1] + counts[2];
    const seed = new Float32Array(N * 4), kind = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
      kind[i * 2] = i < counts[0] ? 0 : i < counts[0] + counts[1] ? 1 : 2;
      kind[i * 2 + 1] = Math.random();
    }
    const sg = new THREE.InstancedBufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    sg.setIndex([0, 1, 2, 0, 2, 3]);
    sg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    sg.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 2));
    sg.instanceCount = N;
    this.spray = new THREE.Mesh(sg, mat(sprayVert, sprayFrag, THREE.DoubleSide));
    this.spray.renderOrder = 4;
    this.cloud.renderOrder = this.funnel.renderOrder = 3;
    this.group = new THREE.Group();
    this.group.add(this.cloud, this.funnel, this.ring, this.spray);
    this.group.traverse((o) => { o.frustumCulled = false; });
    this.group.visible = false;
    this.fog = env.fog;
    this.touch = 0;   // 漏斗碰到海面的程度（0–1）：水霧、聲音、吹翻船都看這個
  }

  // v：weather.js 裡的那道水龍捲（沒有就傳 undefined）
  update(v) {
    this.group.visible = !!v;
    if (!v) { this.touch = 0; return; }
    const u = this.u, left = v.life - v.age;
    u.uFogDen.value = this.fog.density;
    // 這麼大的東西動作是慢的：半分鐘才從雲底垂到海面，消散也要半分鐘
    u.uReach.value = smooth(5, 34, v.age) * smooth(3, 22, left);
    u.uThin.value = 1 - smooth(14, 38, left);
    u.uFade.value = smooth(0, 10, v.age) * smooth(0, 8, left);
    this.touch = u.uGrow.value = smooth(0.9, 1, u.uReach.value) * smooth(30, 44, v.age) * smooth(14, 28, left);
    u.uLean.value.set(v.vx * 30, v.vz * 30);   // 雲走在前面，漏斗的腳拖在後面
    this.group.position.set(v.x, 0, v.z);
    this.ring.visible = this.spray.visible = this.touch > 0.01;
  }
}
