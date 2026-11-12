// 釣魚：按住 F 蓄力、放開拋竿 → 等魚咬 → 咬鉤時按 F → 收線小遊戲。
// 收線：條上有一個隨機亂跑的區間。按住 F（或滑鼠左鍵）力道上升、放開下降，
// 把力道維持在區間內魚就被拉近，跑出區間魚就逃遠；拉滿釣起來，掉到零魚跑掉。
import * as THREE from 'three';

const ROD_LEN = 2.7;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// env：
//   player、scene
//   canFish()：現在能不能釣（沒在掌舵、手上沒魚）
//   viewYaw()：拋竿的方向
//   isWater(x, z)、surfaceY(x, z)：那裡是不是水面、水面高度
//   pick(x, z) → { id, kg, len, strength }：這個位置會釣到什麼
//   splash(x, y, z)、toast(text)、onCatch(fish)
//   rodLv()：釣竿等級 0–3（拋更遠、區間更寬、魚咬得更快）
//   biteK()：等魚咬的時間倍率（下雨時魚咬得比較快）
export class Fishing {
  constructor(env) {
    this.env = env;
    this.state = 'idle';     // idle | charge | fly | wait | bite | fight
    this.reel = false;       // 收線鍵有沒有按著（每幀由外面設定）
    this.power = 0;          // 拋竿力道 0–1
    this.force = 0;          // 收線時玩家的力道 0–1
    this.zone = 0.5;         // 目標區間的中心 0–1
    this.zoneW = 0.3;        // 目標區間的寬度
    this.progress = 0;       // 拉近的進度 0–1
    this.inZone = false;
    this.dist = 0;           // 魚離人還有多遠（公尺）
    this.t = 0;

    // 釣竿：掛在人物右手上
    this.rod = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, ROD_LEN, 6), new THREE.MeshLambertMaterial({ color: 0x3b2a1a }));
    stick.position.y = ROD_LEN / 2;
    this.rod.add(stick);
    this.rod.position.set(0.42, 1.12, 0.27);
    this.rod.visible = false;
    env.player.mesh.add(this.rod);
    this.rodAngle = 0.7;     // 從垂直往前倒的角度

    this.bob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff4a33 }));
    this.bob.visible = false;
    this.linePos = new Float32Array(16 * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    env.scene.add(this.bob, this.line);

    this.land = new THREE.Vector3();   // 浮標落水的位置
    this.from = new THREE.Vector3();
    this.tip = new THREE.Vector3();
  }

  // 按下 F
  press() {
    if (this.state === 'idle') {
      if (this.env.canFish()) { this.state = 'charge'; this.power = 0; this.env.player.yaw = this.env.viewYaw(); } // 身體轉向要拋的方向
    } else if (this.state === 'wait') this.cancel();           // 沒魚咬：把線收回來
    else if (this.state === 'bite') this._hook();
  }

  // 放開 F
  release() {
    if (this.state !== 'charge') return;
    const p = this.env.player, yaw = this.env.viewYaw(), d = (5 + 17 * this.power) * (1 + 0.25 * this.env.rodLv());
    this._tip();
    this.from.copy(this.tip);
    this.land.set(p.x + Math.cos(yaw) * d, 0, p.z + Math.sin(yaw) * d);
    this.state = 'fly'; this.t = 0;
    this.flyDur = 0.5 + 0.4 * this.power;
  }

  cancel() { this.state = 'idle'; }

  _biteTime() { return rand(2.5, 9) * Math.pow(0.82, this.env.rodLv()) * (this.env.biteK ? this.env.biteK() : 1); }

  _hook() {
    const f = this.fish = this.env.pick(this.land.x, this.land.z);
    const p = this.env.player;
    this.state = 'fight';
    this.dist0 = this.dist = Math.max(4, Math.hypot(this.land.x - p.x, this.land.z - p.z));
    // 越兇的魚：區間越窄、跑得越快、越常變向
    this.zoneW = clamp(0.40 - 0.11 * f.strength, 0.22, 0.38) + 0.03 * this.env.rodLv();
    this.zoneSpeed = 0.18 + 0.36 * f.strength;
    this.zone = 0.45; this.zoneTarget = 0.45; this.zoneT = 0.8;
    this.force = 0.35;
    this.progress = 0.3;
    this.grace = 1.0;        // 剛上鉤的頭一秒不扣進度，讓人反應
    this.inZone = true;
  }

  _tip() {
    this.rod.rotation.z = -this.rodAngle;
    this.env.player.mesh.updateMatrixWorld(true);
    return this.tip.set(0, ROD_LEN, 0).applyMatrix4(this.rod.matrixWorld);
  }

  update(dt) {
    const env = this.env, p = env.player, b = this.bob.position;
    if (this.state !== 'idle' && !env.canFish()) this.cancel();
    const out = this.state !== 'idle';
    this.rod.visible = out; p.rod = out;
    this.bob.visible = this.line.visible = out && this.state !== 'charge';
    if (!out) return;
    this.t += dt;

    let angle = 0.7, sag = 0.6;
    switch (this.state) {
      case 'charge':
        this.power = Math.min(1, this.power + dt / 1.1);
        angle = -0.2 - 0.5 * this.power;     // 竿子往後拉
        break;

      case 'fly': {
        const s = Math.min(this.t / this.flyDur, 1);
        b.lerpVectors(this.from, this.land, s);
        b.y = this.from.y * (1 - s) + (2 + 3 * this.power) * 4 * s * (1 - s);
        angle = 1.0; sag = 0.1;
        if (s >= 1) {
          if (!env.isWater(this.land.x, this.land.z)) { env.toast('沒拋進水裡'); this.cancel(); break; }
          env.splash(this.land.x, 0.1, this.land.z);
          this.state = 'wait'; this.biteT = this._biteTime();
        }
        break;
      }

      case 'wait':
        b.set(this.land.x, env.surfaceY(this.land.x, this.land.z) + 0.03, this.land.z);
        if (Math.hypot(b.x - p.x, b.z - p.z) > 60) { this.cancel(); break; }
        if ((this.biteT -= dt) <= 0) { this.state = 'bite'; this.biteWin = 1.3; env.splash(b.x, 0.1, b.z); }
        break;

      case 'bite':
        b.set(this.land.x, env.surfaceY(this.land.x, this.land.z) - 0.1 + Math.sin(this.t * 40) * 0.03, this.land.z);
        angle = 0.85; sag = 0.2;
        if ((this.biteWin -= dt) <= 0) { env.toast('魚跑了'); this.state = 'wait'; this.biteT = this._biteTime(); }
        break;

      case 'fight': {
        const f = this.fish, half = this.zoneW / 2;
        // 區間隨機亂跑：每隔一小段時間換一個目標位置，偶爾猛衝
        if ((this.zoneT -= dt) <= 0) {
          this.zoneTarget = rand(half, 1 - half);
          this.zoneT = rand(0.5, 1.7) / (0.7 + 0.5 * f.strength);
          this.dash = Math.random() < 0.25 ? 1.6 : 1;
        }
        const step = this.zoneSpeed * (this.dash ?? 1) * dt;
        this.zone += clamp(this.zoneTarget - this.zone, -step, step);

        // 玩家的力道：按住上升、放開下降
        this.force = clamp(this.force + (this.reel ? 0.85 : -0.7) * dt, 0, 1);
        this.inZone = Math.abs(this.force - this.zone) <= half;
        this.grace -= dt;
        if (this.inZone) this.progress += dt * 0.2 / (0.7 + 0.5 * f.strength);
        else if (this.grace <= 0) this.progress -= dt * (0.10 + 0.04 * f.strength);
        this.dist = this.dist0 * (1 - this.progress) / 0.7;

        // 浮標沿著「人 → 落水點」的方向拉近；沒對上區間時魚左右亂竄
        let ux = this.land.x - p.x, uz = this.land.z - p.z;
        const ul = Math.hypot(ux, uz) || 1;
        ux /= ul; uz /= ul;
        const wig = this.inZone ? 0 : Math.sin(this.t * 14) * 0.5;
        const d = Math.max(this.dist, 1.2);
        const x = p.x + ux * d - uz * wig, z = p.z + uz * d + ux * wig;
        b.set(x, env.surfaceY(x, z) - 0.08, z);
        if (!this.inZone && Math.random() < dt * 6) env.splash(x, 0.1, z);
        angle = 0.25 + 0.5 * (1 - this.force); sag = 0.5 * (1 - this.force);

        if (this.progress <= 0) { env.toast('魚掙脫跑掉了'); this.cancel(); } else if (this.progress >= 1) {
          env.splash(b.x, 0.2, b.z);
          this.cancel();
          env.onCatch(f);
        }
        break;
      }
    }
    if (this.state === 'idle') { this.rod.visible = this.bob.visible = this.line.visible = false; p.rod = false; return; }

    // 線在水裡時，人沒在走動就面向浮標
    if (this.state !== 'charge' && !p.moving) p.yaw = Math.atan2(b.z - p.z, b.x - p.x);

    // 竿子的角度與釣線
    this.rodAngle += (angle - this.rodAngle) * (1 - Math.exp(-dt * 12));
    const tip = this._tip();
    if (this.line.visible) {
      const n = 16, a = this.linePos;
      for (let i = 0; i < n; i++) {
        const s = i / (n - 1);
        a[i * 3] = tip.x + (b.x - tip.x) * s;
        a[i * 3 + 1] = tip.y + (b.y - tip.y) * s - sag * 4 * s * (1 - s);
        a[i * 3 + 2] = tip.z + (b.z - tip.z) * s;
      }
      this.line.geometry.attributes.position.needsUpdate = true;
    }
  }
}
