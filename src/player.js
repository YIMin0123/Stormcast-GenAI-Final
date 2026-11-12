// 步行中的玩家：在島上、木棧道和船的甲板上走動，可以跑、可以跳，也可以下水游泳。
// 人直接走上船、走下船；站在船上時位置記在船身座標裡，船怎麼動人就跟著動。
import * as THREE from 'three';
import { buildFigure } from './boat.js';
import { ACTION_BY_ID, MOOD_TIME } from './emotes.js';

const WALK = 3.2, RUN = 6.0;
const SWIM = 1.6, SWIM_FAST = 2.3;
const GRAVITY = 18, JUMP = 6.0;   // 跳起來約 1 公尺高
const STEP = 0.6;                 // 走路能直接踏上去的高度
const CLIMB = 1.5;                // 從岸邊攀上船舷的高度
const CLIMB_SWIM = 2.7;           // 從水裡攀上船
const DROP = 0.35;                // 落差比這個大就算踩空，會掉下去
const HOPS = [0.5, 1.0, 1.5];     // 碼頭與船之間的空隙，一步能跨多遠
const SUBMERGE = 0.95;             // 浮在水裡時，腳在水面下多深（只露出頭和肩膀）

export class Player {
  constructor(x, z, yaw) {
    this.mesh = buildFigure();
    this.x = x; this.z = z; this.y = 0;   // 世界座標
    this.yaw = yaw;                        // 面向：(cos yaw, sin yaw)
    this.boat = null;                      // 腳下踩的船；不在船上時為 null
    this.lx = 0; this.lz = 0;              // 在船上時的船身座標
    this.base = 0;                         // 腳下支撐面的高度（游泳時是水面下 SUBMERGE 的地方）
    this.h = 0; this.vy = 0;               // 離支撐面的高度與垂直速度（h > 0 = 在空中）
    this.off = new THREE.Vector3();        // 跨步、踏階時用來平滑畫面的偏移
    this.pos = new THREE.Vector3();        // 畫面上的位置（鏡頭跟這個）
    this.phase = 0;
    this.moving = false;
    this.carry = false;                    // 雙手捧著東西
    this.rod = false;                      // 右手拿著釣竿
    this.onWater = false;                  // 腳下是水（踩不到底）
    this.swim = false;                     // 正在游泳（在水裡、不是掉下去的途中）
    this.tilt = 0;                         // 游泳時身體往前趴的角度
    this.clock = 0; this.bob = 0; this.lean = 0; this.roll = 0;   // 動作用：時間、上下起伏、前傾、左右晃
    this.lookYaw = 0; this.lookPitch = 0;  // 鏡頭看的方向（頭會跟著轉）
    this.eyeH = 1.25;                      // 眼睛離腳多高（游泳時只剩頭露出水面）
    this.seat = null;                      // 坐在船上的哪個位子：{ boat, x, z, h 坐墊高度, yaw 面向（相對船首） }；沒坐是 null
    // 動作與表情（輪盤選的）：act 正在播的動作、actT 播了幾秒；emoteW 動作接管身體的程度（0–1，淡入淡出）；
    // mood 玩家選的表情、moodLeft 還剩幾秒
    this.act = null; this.actT = 0; this.emoteW = 0; this.lastPose = null;
    this.mood = null; this.moodLeft = 0;
  }

  // 播一個動作；現在不能做（游泳、坐在船上、拿著東西或釣竿、在空中）就回傳 false
  playAction(id) {
    const a = ACTION_BY_ID[id];
    if (!a || this.swim || this.seat || this.carry || this.rod || this.h > 0) return false;
    this.act = a; this.actT = 0;
    return true;
  }

  // 換表情，維持 MOOD_TIME 秒（選「普通」就是馬上變回來）
  setMood(id) {
    this.mood = id === 'normal' ? null : id;
    this.moodLeft = this.mood ? MOOD_TIME : 0;
  }

  // 第一人稱：整個人都不畫（低頭只看到地面，不會看到自己的大頭和肩膀），但影子照樣投在地上；
  // 手上的釣竿和抱著的東西不受影響
  setFirstPerson(on) {
    for (const mat of this.mesh.userData.mats) { mat.colorWrite = !on; mat.depthWrite = !on; }
    this.mesh.traverse((m) => { if (m.userData.hull && m.parent.userData.figure) m.visible = !on; });   // 描邊
  }

  // 直接放到某處（開局、放開方向盤時）
  place(world, x, z, boat = null) {
    this.boat = boat;
    this.seat = null;
    this.onWater = this.swim = false;
    if (boat) {
      this.lx = x; this.lz = z;
      const w = boat.toWorld(x, z);
      this.x = w.x; this.z = w.z;
      this.base = boat.deckY(this.x, this.z);
    } else {
      this.x = x; this.z = z;
      const s = this._surface(x, z, world);
      this.base = s ? s.y : world.ground(x, z);
      this.onWater = !!(s && s.swim);
    }
    this.h = 0; this.vy = 0;
    this.y = this.base;
    this.off.set(0, 0, 0);
    this.pos.set(this.x, this.y, this.z);
    this.mesh.position.copy(this.pos);
  }

  // 船以外的地方：(x, z) 處能待的面。地面比水面下 SUBMERGE 還低就是踩不到底，浮在水裡
  _surface(x, z, world) {
    let g = world.ground(x, z);
    if (g > 90) return null;
    const w = world.water(x, z) - SUBMERGE;
    // 人已經在水裡：頭上是棧橋的話，從橋底下游過去
    if (this.onWater && g > w + STEP) { const u = world.ground(x, z, true); if (u < w) g = u; }
    return g < w ? { boat: null, y: w, swim: true } : { boat: null, y: g, swim: false };
  }

  // (x, z) 處能待的面；被擋住時回傳 'wall'
  _probe(x, z, world) {
    for (const b of world.boats) {
      if (b.sinking) continue;
      const l = b.toLocal(x, z);
      if (b.deckContains(l.x, l.z)) {
        return b.blockedLocal(l.x, l.z) ? 'wall' : { boat: b, lx: l.x, lz: l.z, y: b.deckY(x, z), swim: false };
      }
    }
    return this._surface(x, z, world) ?? 'wall';
  }

  // 從現在的位置上不上得去那個面
  _reach(s) {
    const dy = s.y - (this.base + this.h);
    if (this.h > 0) return dy < DROP;
    if (s.boat !== this.boat) return dy < (s.boat && this.onWater ? CLIMB_SWIM : CLIMB);
    return dy < STEP;
  }

  _enter(s, x, z) {
    const dy = s.y - (this.base + this.h);
    if (this.h > 0) {
      // 人在空中：腳還高於那個面就繼續飛（保留跳躍的速度），碰到了才落地
      if (dy < 0) this.h = -dy;
      else { this.off.y -= dy; this.h = 0; this.vy = 0; }
    } else if (dy < -DROP) {
      this.vy = 0; this.h = -dy;      // 踩空：開始往下掉
    } else {
      if (Math.abs(dy) > 0.15) this.off.y -= dy;  // 踏階：畫面上平滑接過去
      this.h = 0;
    }
    this.boat = s.boat;
    if (s.boat) { this.lx = s.lx; this.lz = s.lz; }
    this.x = x; this.z = z;
    this.base = s.y;
    this.onWater = !!s.swim;
  }

  // 試著移動 (dx, dz)；成功回傳 true
  _move(dx, dz, world) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    const tx = this.x + dx, tz = this.z + dz;
    const s = this._probe(tx, tz, world);
    if (s === 'wall') return false;
    // 站在碼頭或船上、前面是要掉下去的水：如果只是碼頭和船之間的空隙就一步跨過去；
    // 否則邊緣擋著，走路不會掉下水（要下水就用跳的）
    if (s.swim && !this.onWater && this.h <= 0 && s.y < this.base - DROP) {
      for (const hop of HOPS) {
        const hx = this.x + (dx / len) * hop, hz = this.z + (dz / len) * hop;
        const t = this._probe(hx, hz, world);
        if (t === 'wall') return false;
        if (t.swim) continue;
        if (t.boat === this.boat || !this._reach(t)) return false;
        this.off.x += this.x - hx; this.off.z += this.z - hz;
        this._enter(t, hx, hz);
        return true;
      }
      return false;
    }
    if (!this._reach(s)) return false;
    this._enter(s, tx, tz);
    return true;
  }

  // 被水流帶著走（漩渦、水龍捲）
  drift(dx, dz, world) { this._move(dx, dz, world); }

  // dirX/dirZ：想走的方向（世界座標，可為 0）
  // world.ground(x,z,under)：地面或棧板高度（很大的值 = 牆）；under = true 時不算棧板，只看底下的地面
  // world.water(x,z)：水面高度；world.boats：可以走上去的船
  update(dt, dirX, dirZ, run, jump, world) {
    // 坐著：釘在位子上，不能走、不能跳；屁股在坐墊的高度（整個人放低），面向位子的方向
    if (this.seat && (this.seat.boat !== this.boat || this.boat.sinking)) this.seat = null;
    const seat = this.seat;
    if (seat) {
      this.lx = seat.x; this.lz = seat.z; this.h = 0; this.vy = 0;
      this.yaw = this.boat.heading + seat.yaw;
      dirX = dirZ = 0; jump = false;
    }
    // 腳下的面可能在動（船、浪），每幀重算
    if (this.boat) {
      const w = this.boat.toWorld(this.lx, this.lz);
      this.x = w.x; this.z = w.z;
      this.base = this.boat.deckY(this.x, this.z) + (seat ? seat.h - 0.38 : 0);
      this.onWater = false;
    } else {
      const s = this._surface(this.x, this.z, world);
      this.base = s ? s.y : world.ground(this.x, this.z);
      this.onWater = !!(s && s.swim);
    }
    const swim = this.swim = this.onWater && this.h <= 0;

    const len = Math.hypot(dirX, dirZ);
    this.moving = len > 0.01;
    if (this.moving) {
      let v = swim ? (run ? SWIM_FAST : SWIM) : (run ? RUN : WALK);
      if (swim && this.carry) v *= 0.7;                                                        // 捧著東西游比較慢
      else if (!swim && !this.boat && this.base < world.water(this.x, this.z) - 0.45) v *= 0.6; // 涉水
      const sp = v * dt, dx = (dirX / len) * sp, dz = (dirZ / len) * sp;
      if (!this._move(dx, dz, world)) {
        // 被擋住就沿著邊滑：在船上沿船的縱橫向分解，在陸地沿東西南北分解
        const ax = this.boat ? Math.cos(this.boat.heading) : 1, az = this.boat ? Math.sin(this.boat.heading) : 0;
        const a = dx * ax + dz * az, b = -dx * az + dz * ax;
        this._move(a * ax, a * az, world);
        this._move(-b * az, b * ax, world);
      }
      // 身體平滑轉向行進方向
      let d = Math.atan2(dirZ, dirX) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 12));
      this.phase += dt * (swim ? 6 : run ? 13 : 8.5);
    }

    // 跳躍與重力（游泳時不能跳）
    if (jump && this.h <= 0 && !swim) { this.vy = JUMP; this.h = 1e-3; }
    if (this.h > 0) {
      this.vy -= GRAVITY * dt;
      this.h += this.vy * dt;
      if (this.h <= 0) { this.h = 0; this.vy = 0; }
    }
    this.y = this.base + this.h;

    // ---- 動作 ----
    // 走路：手腳大幅擺動、身體一上一下、左右微晃；跑步擺得更大、身體往前傾；
    // 跳起來：雙手往兩旁張開、腿前後分開；游泳：身體往前趴、雙手輪流划水；
    // 站著不動：重心輪流換腳、手輕輕晃、頭微微歪來歪去
    const air = this.h > 0;
    // 動作：一走動、跳起來、下水、坐下、拿起東西就停；播一次的動作播完就停
    if (this.act) {
      this.actT += dt;
      if (this.moving || air || swim || seat || this.carry || this.rod || (!this.act.loop && this.actT > this.act.dur)) this.act = null;
    }
    const stroke = Math.sin(this.phase);
    const idle = !this.moving && !air && !swim;
    const T = (this.clock += dt);
    const swing = air ? 0.65 : this.moving ? stroke * (swim ? 0.45 : run ? 1.1 : 0.78) : 0;
    const { legs, arms, head } = this.mesh.userData;
    const ease = 1 - Math.exp(-dt * 14);
    const shift = idle ? 0.06 * Math.sin(T * 1.3) : 0;
    legs[0].rotation.z += ((seat ? 1.36 : swing + shift) - legs[0].rotation.z) * ease;   // 坐著：兩條腿往前伸
    legs[1].rotation.z += ((seat ? 1.36 : -swing - shift) - legs[1].rotation.z) * ease;
    const paddle = swim && !this.carry;
    const loose = idle ? 0.10 * Math.sin(T * 1.7) : 0;
    const armL = this.carry ? 1.15 : paddle ? 2.3 + stroke * (this.moving ? 0.9 : 0.25) : -swing * 1.05 + loose;
    const armR = this.carry ? 1.15 : paddle ? 2.3 - stroke * (this.moving ? 0.9 : 0.25) : this.rod ? 0.95 : swing * 1.05 - loose;
    arms[0].rotation.z += (armL - arms[0].rotation.z) * ease;
    arms[1].rotation.z += (armR - arms[1].rotation.z) * ease;
    // 手臂往兩旁張開多少：平常張成 A 字（手才不會插進裙子，也比較像設定圖），走路時多一點，跳起來時舉高
    for (const arm of arms) {
      const side = arm.userData.side, busy = this.carry || paddle || (this.rod && side > 0);
      const out = busy ? 0 : 0.48 + (air ? 0.8 : this.moving ? 0.08 : 0.04 * Math.sin(T * 1.7 + side));
      arm.rotation.x += (-side * out - arm.rotation.x) * ease;
    }
    if (swim && !this.moving) this.phase += dt * 2.5;   // 停在水裡時踩水
    const walking = this.moving && !swim && !air;
    const slowEase = 1 - Math.exp(-dt * 8);
    this.bob += ((walking ? Math.abs(Math.cos(this.phase)) * (run ? 0.075 : 0.05) : idle ? 0.012 * Math.sin(T * 2.2) : 0) - this.bob) * ease;
    this.lean += ((walking ? (run ? 0.17 : 0.06) : 0) - this.lean) * slowEase;
    this.roll += ((walking ? stroke * 0.06 : idle ? 0.025 * Math.sin(T * 1.3) : 0) - this.roll) * ease;
    // 頭跟著鏡頭看的方向轉（轉不過去就看前面）；游泳時把頭抬起來
    let rel = this.lookYaw - this.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const reach = Math.min(1, Math.max(0, (2.5 - Math.abs(rel)) / 0.7));
    const hy = -Math.max(-1.25, Math.min(1.25, rel)) * reach;
    const hp = Math.max(-0.5, Math.min(0.45, this.lookPitch * 0.7 + 0.05)) + this.tilt * 0.75 - this.lean * 0.6;
    head.rotation.y += (hy - head.rotation.y) * slowEase;
    head.rotation.z += (hp - head.rotation.z) * slowEase;
    head.rotation.x += ((idle ? 0.06 * Math.sin(T * 0.9) : walking ? -stroke * 0.04 : 0) - head.rotation.x) * slowEase;

    const slow = 1 - Math.exp(-dt * 6);
    this.tilt += ((swim ? (this.moving ? 1.15 : 0.3) : 0) - this.tilt) * slow;
    this.eyeH += ((swim ? SUBMERGE + 0.25 : 1.25) - this.eyeH) * slow;

    // 動作接管關節：照動作的角度蓋過上面平常的姿勢（淡入淡出；動作停了以後從最後那個姿勢慢慢回來）
    const pose = this.act ? (this.lastPose = this.act.pose(this.actT)) : this.lastPose;
    this.emoteW += ((this.act ? 1 : 0) - this.emoteW) * (1 - Math.exp(-dt * 10));
    if (!this.act && this.emoteW < 0.002) { this.emoteW = 0; this.lastPose = null; }
    const w = pose ? this.emoteW : 0, mix = (obj, k, v) => { if (v !== undefined) obj[k] += (v - obj[k]) * w; };
    const { upper, setFace } = this.mesh.userData;
    for (const jt of arms) jt.rotation.y += (0 - jt.rotation.y) * ease;   // 平常手臂不往內收（拍手、鞠躬時才收）
    if (pose) {
      [arms, legs].forEach((joints, j) => joints.forEach((jt, i) => {
        const q = (j === 0 ? pose.arms : pose.legs)?.[i];
        if (q) { mix(jt.rotation, 'x', q.x); mix(jt.rotation, 'y', q.y); mix(jt.rotation, 'z', q.z); }
      }));
      if (pose.head) { mix(head.rotation, 'x', pose.head.x); mix(head.rotation, 'z', pose.head.z); }
    }
    upper.rotation.z = (pose?.waist?.z ?? 0) * w;
    upper.rotation.y = (pose?.waist?.y ?? 0) * w;
    // 表情：玩家選的優先；沒選的話用動作附帶的表情
    if (this.moodLeft > 0 && (this.moodLeft -= dt) <= 0) this.mood = null;
    setFace(this.mood ?? (this.act && this.act.face) ?? 'normal');

    this.off.multiplyScalar(Math.exp(-dt * 14));
    this.pos.set(this.x + this.off.x, this.y + this.off.y, this.z + this.off.z);
    // 身體往前趴的時候整個人浮高一點，頭才不會埋進水裡
    this.mesh.position.set(this.pos.x, this.pos.y + 0.36 * this.tilt + this.bob + (pose?.lift ?? 0) * w, this.pos.z);
    this.mesh.rotation.set(this.roll + (pose?.roll ?? 0) * w, -this.yaw, -this.tilt - this.lean, 'YZX');
  }

  // 告訴角色鏡頭正在看哪裡，頭會跟著轉過去
  look(yaw, pitch) { this.lookYaw = yaw; this.lookPitch = pitch; }

  eye(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.eyeH, this.pos.z);
  }
}
