// 釣魚：按住 F 蓄力、放開拋竿 → 等魚咬 → 咬鉤時按 F → 收線小遊戲。
// 收線：條上有一個隨機亂跑的區間。按住 F（或滑鼠左鍵）力道上升、放開下降，
// 把力道維持在區間內魚就被拉近，跑出區間魚就逃遠；拉滿釣起來，掉到零魚跑掉。
// 爆桿：魚的力氣比釣竿受得了的大時，用力過頭（指標在區間的右邊）釣竿的負荷會一直往上加，
// 加滿就斷——魚跑掉，釣竿要拿回商店修。小魚怎麼拉都不會斷；越大越值錢的魚越容易斷，釣竿越好越撐得住。
import * as THREE from 'three';
import { REEL_PROTOCOL, newFishFight, stepFishFight, moveFightZone, predictReelForce } from './fishFight.js';

const ROD_LEN = 2.7;
const GRIP = 0.14;       // 竿尾到握的地方多長
const BREAK_AT = 0.5;    // 釣竿斷在多高的地方（佔全長的比例）
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// env：
//   player、scene
//   canFish()：現在能不能釣（沒在掌舵、手上沒魚）
//   viewYaw()：拋竿的方向
//   isWater(x, z)、surfaceY(x, z)：那裡是不是水面、水面高度
//   pick(x, z) → { id, kg, len, strength }：這個位置會釣到什麼
//   splash(x, y, z)、toast(text)、onCatch(fish)
//   rodLv()：釣竿等級 0–3（拋更遠、區間更寬、魚咬得更快、撐得住更大的魚）
//   broken()：釣竿是不是斷的（斷了就不能釣）；onSnap(fish)：爆桿了
//   sound(name)：播一個音效（拋竿、落水、咬鉤、斷竿……），沒有就不播
//   biteK()：等魚咬的時間倍率（下雨時魚咬得比較快）
//   net：多人釣魚時回報拋竿、拉竿、收線按鍵與收竿。搏魚狀態由伺服器回傳。
export class Fishing {
  constructor(env) {
    this.env = env;
    this.state = 'idle';     // idle | charge | fly | wait | bite | hooking（按了，等伺服器說是哪條魚）| fight | snap（竿子剛斷，愣在那裡的一兩秒）
    this.reel = false;       // 收線鍵有沒有按著（用 setReel 更新）
    this.onlineFight = null;
    this.localFight = null;
    this.power = 0;          // 拋竿力道 0–1
    this.force = 0;          // 收線時玩家的力道 0–1
    this.zone = 0.5;         // 目標區間的中心 0–1
    this.zoneW = 0.3;        // 目標區間的寬度
    this.progress = 0;       // 拉近的進度 0–1
    this.inZone = false;
    this.dist = 0;           // 魚離人還有多遠（公尺）
    this.strain = 0;         // 釣竿的負荷 0–1，滿了就斷
    this.risk = 0;           // 這條魚對這支竿來說有多吃力（0 = 怎麼拉都不會斷）
    this.t = 0;

    // 釣竿：掛在人物右手上
    this.rod = new THREE.Group();
    // 分成握把那一截和前面那一截：爆桿時前面那一截從中間折下來
    const rodMat = new THREE.MeshLambertMaterial({ color: 0x3b2a1a });
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.03, ROD_LEN * BREAK_AT, 6), rodMat);
    lower.position.y = ROD_LEN * BREAK_AT / 2;
    this.rodTop = new THREE.Group();
    this.rodTop.position.y = ROD_LEN * BREAK_AT;
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.021, ROD_LEN * (1 - BREAK_AT), 6), rodMat);
    upper.position.y = ROD_LEN * (1 - BREAK_AT) / 2;
    this.rodTop.add(upper);
    this.rod.add(lower, this.rodTop);
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
      if (!this.env.canFish()) return;
      if (this.env.broken && this.env.broken()) { this.env.toast('釣竿斷了，要拿回商店的攤位修理'); return; }
      this.state = 'charge'; this.power = 0; this.nibbleT = 0; this.env.player.yaw = this.env.viewYaw(); // 身體轉向要拋的方向
    } else if (this.state === 'wait') this._earlyPull();   // 沒真咬就提早拉竿：把魚嚇跑
    else if (this.state === 'bite') {
      if (this.env.net) { this.state = 'hooking'; this.t = 0; this.env.net.hook(); } else this._hook(this.env.pick(this.land.x, this.land.z));
    }
  }

  _earlyPull() {
    this.nibbleT = 0;
    this.env.net?.earlyPull?.();
    this._sound('plop');
    this.env.toast('太早拉竿，把魚嚇跑了！');
    this.cancel(null);
  }

  // ---- 伺服器說的 ----
  serverNibble() {
    if (this.state !== 'wait') return;
    this.nibbleT = 0.38;
    this.env.splash(this.bob.position.x, 0.1, this.bob.position.z);
    this._sound('plop');
  }
  serverBite() {
    if (this.state !== 'wait') return;
    this.nibbleT = 0;
    this.state = 'bite'; this.biteWin = 1.3;
    this.env.splash(this.bob.position.x, 0.1, this.bob.position.z);
    this._sound('bite');
  }
  serverFight(m) {
    if (this.state !== 'hooking') return;
    if (m.v !== REEL_PROTOCOL) return this.serverNo('釣魚系統版本不同，請重新整理網頁');
    this._hook(m.fish);
    this.onlineFight = { id: m.id, n: 0, inputs: [], sample: { ...m, at: performance.now() } };
  }

  setReel(held) {
    this.reel = held;
    const f = this.onlineFight;
    if (!f || f.inputs.at(-1)?.held === held) return;
    const input = { n: ++f.n, held, at: performance.now() };
    f.inputs.push(input);
    this.env.net.reel(f.id, input.n, held);
  }

  serverReel(m) {
    const f = this.onlineFight;
    if (!f || m.id !== f.id || m.n < f.sample.n) return;
    f.sample = { ...m, at: performance.now() };
    while (f.inputs.length > 1 && f.inputs[1].n <= m.n) f.inputs.shift();
  }

  serverEnd(id, result) {
    if (!this.onlineFight || this.onlineFight.id !== id) return;
    if (result === 'caught') this._land();
    else if (result === 'snap') this._snap();
    else {
      this.env.toast(result === 'full' ? '漁獲已滿，先處理手上的漁獲' : '魚掙脫跑掉了');
      this.cancel(null);
    }
  }

  // 伺服器不認（拋到釣不到的地方、按太慢）
  serverNo(msg) {
    if (this.state === 'idle' || this.state === 'fight' || this.state === 'snap') return;
    this.env.toast(msg || (this.state === 'hooking' ? '魚跑了' : '這裡釣不到魚'));
    this.cancel(null);
  }

  // 放開 F
  release() {
    if (this.state !== 'charge') return;
    const p = this.env.player, yaw = this.env.viewYaw(), d = (5 + 17 * this.power) * (1 + 0.20 * this.env.rodLv());
    this._tip();
    this.from.copy(this.tip);
    this.land.set(p.x + Math.cos(yaw) * d, 0, p.z + Math.sin(yaw) * d);
    this.state = 'fly'; this.t = 0; this.nibbleT = 0;
    this.flyDur = 0.5 + 0.4 * this.power;
    this._sound('cast');
  }

  // why：告訴伺服器為什麼不釣了（null = 不用講）
  cancel(why = 'cancel') {
    if (why && this.env.net && this.state !== 'idle' && this.state !== 'charge' && this.state !== 'fly') this.env.net.lose(why);
    this.nibbleT = 0;
    this.onlineFight = this.localFight = null;
    this.state = 'idle'; this.rodTop.rotation.z = 0;
  }

  _sound(name, vol) { if (this.env.sound) this.env.sound(name, vol); }

  _biteTime() { return Math.max(2.5, rand(4.5, 12.5) * (this.env.biteK ? this.env.biteK() : 1)); }

  _hook(fish) {
    const f = this.fish = fish;
    const p = this.env.player;
    this.state = 'fight';
    this.dist0 = this.dist = Math.max(4, Math.hypot(this.land.x - p.x, this.land.z - p.z));
    const state = newFishFight(f.strength, this.env.rodLv());
    this.localFight = this.env.net ? null : state;
    this.risk = state.risk;
    this.zoneW = state.width;
    this._showFight(state);
    if (this.risk > 0.25) this.env.toast(this.risk > 0.8 ? '好重！是個大傢伙——千萬別硬拉，釣竿會斷' : '手感很沉，別拉得太用力，釣竿會斷');
    this._sound('hook');
  }

  _showFight({ force, zone, progress, strain, inZone }) {
    this.force = force;
    this.zone = zone;
    this.progress = progress;
    this.strain = strain;
    this.inZone = inZone;
  }

  _updateFight(dt) {
    const f = this.onlineFight;
    if (!f) {
      stepFishFight(this.localFight, this.reel, dt);
      this._showFight(this.localFight);
      return this.localFight.result;
    }
    const now = performance.now(), s = f.sample;
    if (now - s.at > 5000) return 'timeout';
    const rtt = clamp(this.env.net.rtt() ?? 100, 0, 450);
    this.force = predictReelForce(s, f.inputs, now, rtt);
    this.zone = moveFightZone(s.zone, s.target, s.speed, Math.min(0.45, (now - s.at + rtt) / 1000));
    this.zoneW = s.width;
    const blend = 1 - Math.exp(-dt * 20);
    this.progress += (s.progress - this.progress) * blend;
    this.strain += (s.strain - this.strain) * blend;
    this.inZone = Math.abs(this.force - this.zone) <= this.zoneW / 2;
    return null;
  }

  _snap() {
    this.onlineFight = this.localFight = null;
    this.state = 'snap'; this.t = 0; this.strain = 0;
    const b = this.bob.position;
    this.env.splash(b.x, 0.2, b.z);
    this._sound('snap');
    this.env.onSnap(this.fish);
  }

  _land() {
    const b = this.bob.position;
    this.env.splash(b.x, 0.2, b.z);
    this._sound('land');
    this.cancel(null);
  }

  // 竿子握在右手：照現在的角度擺好，握把的位置對到右手手心（竿尾比手低一小截）
  _hold() {
    const mesh = this.env.player.mesh, a = this.rodAngle;
    this.rod.rotation.z = -a;
    mesh.updateMatrixWorld(true);
    mesh.userData.arms[1].userData.grip.getWorldPosition(this.rod.position);
    mesh.worldToLocal(this.rod.position);
    this.rod.position.x -= Math.sin(a) * GRIP; this.rod.position.y -= Math.cos(a) * GRIP;
    this.rod.updateMatrixWorld(true);
  }

  _tip() {
    this._hold();
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
          this._sound('plop');
          this.state = 'wait';
          if (env.net) { this.biteT = Infinity; env.net.cast(this.land.x, this.land.z); } else this.biteT = this._biteTime();
        }
        break;
      }

      case 'wait': {
        let bob = 0;
        if (this.nibbleT > 0) { this.nibbleT = Math.max(0, this.nibbleT - dt); bob = -0.055 * Math.sin((this.nibbleT / 0.38) * Math.PI); }
        b.set(this.land.x, env.surfaceY(this.land.x, this.land.z) + 0.03 + bob, this.land.z);
        if (Math.hypot(b.x - p.x, b.z - p.z) > 60) { this.cancel(); break; }
        if (!env.net) {
          if (this.biteT > 3.5 && !this.nibbled && this.biteT < 2.2) { this.nibbled = true; if (Math.random() < 0.5) { this.nibbleT = 0.38; env.splash(b.x, 0.1, b.z); this._sound('plop'); } }
          if ((this.biteT -= dt) <= 0) { this.nibbleT = 0; this.nibbled = false; this.state = 'bite'; this.biteWin = 1.3; env.splash(b.x, 0.1, b.z); this._sound('bite'); }
        }
        break;
      }

      case 'bite':
        b.set(this.land.x, env.surfaceY(this.land.x, this.land.z) - 0.1 + Math.sin(this.t * 40) * 0.03, this.land.z);
        angle = 0.85; sag = 0.2;
        if ((this.biteWin -= dt) <= 0) {
          env.toast('魚跑了'); this.state = 'wait';
          if (env.net) { this.biteT = Infinity; env.net.miss(); } else this.biteT = this._biteTime();
        }
        break;

      case 'hooking':   // 按了，等伺服器回話（通常一眨眼）；等太久就當作跑了
        b.set(this.land.x, env.surfaceY(this.land.x, this.land.z) - 0.1 + Math.sin(this.t * 40) * 0.03, this.land.z);
        angle = 0.6; sag = 0.2;
        if (this.t > 4) { env.toast('魚跑了'); this.cancel(); }
        break;

      case 'fight': {
        const result = this._updateFight(dt);
        this.dist = this.dist0 * (1 - this.progress) / 0.7;
        if (result === 'snap') {
          this._snap();
          break;
        }

        // 浮標沿著「人 → 落水點」的方向拉近；沒對上區間時魚左右亂竄
        let ux = this.land.x - p.x, uz = this.land.z - p.z;
        const ul = Math.hypot(ux, uz) || 1;
        ux /= ul; uz /= ul;
        const wig = this.inZone ? 0 : Math.sin(this.t * 14) * 0.5;
        const d = Math.max(this.dist, 1.2);
        const x = p.x + ux * d - uz * wig, z = p.z + uz * d + ux * wig;
        b.set(x, env.surfaceY(x, z) - 0.08, z);
        if (!this.inZone && Math.random() < dt * 6) env.splash(x, 0.1, z);
        angle = 0.25 + 0.5 * (1 - this.force) - 0.12 * this.strain * Math.sin(this.t * 55); sag = 0.5 * (1 - this.force);   // 快斷的時候竿子抖

        if (result === 'escape' || result === 'timeout') {
          env.toast(result === 'timeout' ? '收線同步逾時，請重新拋竿' : '魚掙脫跑掉了');
          this.cancel();
        } else if (result === 'caught') {
          this._land();
          env.onCatch(this.fish);
        }
        break;
      }

      case 'snap':
        // 竿子斷了：前面那一截折下來晃兩下，人愣一會兒才把竿子收起來
        angle = 0.55;
        this.rodTop.rotation.z = -2.2 + 0.5 * Math.exp(-this.t * 3) * Math.cos(this.t * 14);
        if (this.t > 1.6) this.cancel(null);
        break;
    }
    if (this.state === 'snap') {
      this.bob.visible = this.line.visible = false;
      this.rodAngle += (angle - this.rodAngle) * (1 - Math.exp(-dt * 12));
      this._hold();
      return;
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
