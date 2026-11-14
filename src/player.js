// 步行中的玩家：在島上、木棧道和船的甲板上走動，可以跑、可以跳，也可以下水游泳。
// 人直接走上船、走下船；站在船上時位置記在船身座標裡，船怎麼動人就跟著動。
import * as THREE from 'three';
import { buildFigure } from './boat.js';
import { ACTION_BY_ID, MOOD_TIME } from './emotes.js';

const WALK = 3.2, RUN = 6.0;
const SWIM = 1.6, SWIM_FAST = 2.3;
const GRAVITY = 18, JUMP = 6.0;   // 跳起來約 1 公尺高
const JUMP_SWIM = 7.2;            // 從水裡跳：要先把泡在水裡的身體拔出來，所以要更用力
const AIR_STEER = 2, AIR_DRAG = 0.08; // 空中能逐漸轉向；鬆開方向時只受少量空氣阻力
const STEP = 0.6;                 // 走路能直接踏上去的高度
const CLIMB = 1.5;                // 從岸邊攀上船舷的高度
const CLIMB_SWIM = 2.7;           // 從水裡攀上船
const DROP = 0.35;                // 落差比這個大就算踩空，會掉下去
const HOPS = [0.5, 1.0, 1.5];     // 碼頭與船之間的空隙，一步能跨多遠
const BODY = 0.32;                // 身體的半徑：牆、柱子、箱子離身體中心這麼近就擋住（不然鏡頭、半個身體會鑽進牆裡）
const BODY_SWIM = 0.5;            // 游泳時：人是趴著的、眼睛貼著水面，第一人稱貼到木樁前會整個畫面都是樁，離遠一點
const SUBMERGE = 0.95;             // 浮在水裡時，腳在水面下多深（只露出頭和肩膀）

export class Player {
  constructor(x, z, yaw, look) {
    this.mesh = buildFigure(look);
    this.x = x; this.z = z; this.y = 0;   // 世界座標
    this.yaw = yaw;                        // 面向：(cos yaw, sin yaw)
    this.boat = null;                      // 腳下踩的船；不在船上時為 null
    this.lx = 0; this.lz = 0;              // 在船上時的船身座標
    this.base = 0;                         // 腳下支撐面的高度（游泳時是水面下 SUBMERGE 的地方）
    this.h = 0; this.vy = 0;               // 離支撐面的高度與垂直速度（h > 0 = 在空中）
    this.airVX = 0; this.airVZ = 0;        // 離地時保留的水平速度（世界座標）
    this.groundVX = 0; this.groundVZ = 0;  // 這一幀人物自己在地面移動的速度
    this.flowVX = 0; this.flowVZ = 0;      // 腳下河水的水平速度
    this.hopExtraX = 0; this.hopExtraZ = 0; // 跨過船與碼頭間隙的額外補位，不算作速度
    this.off = new THREE.Vector3();        // 跨步、踏階時用來平滑畫面的偏移
    this.pos = new THREE.Vector3();        // 畫面上的位置（鏡頭跟這個）
    this.phase = 0;
    this.moving = false;
    this.run = false;
    this.carry = false;                    // 雙手捧著東西
    this.fly = false;                      // 開發者模式：飛行中（速度、上下速度、最高高度由 main.js 照 DEVMODE 設）
    this.flySpeed = 24; this.flyFast = 72; this.flyVert = 8; this.flyMaxH = 150;
    this.rod = false;                      // 右手拿著釣竿
    this.onWater = false;                  // 腳下是水（踩不到底）
    this.swim = false;                     // 正在游泳（在水裡、不是掉下去的途中）
    this.tilt = 0;                         // 游泳時身體往前趴的角度
    this.wPitch = 0; this.wRoll = 0;       // 跟著浪面傾斜的角度
    this.clock = 0; this.bob = 0; this.lean = 0; this.roll = 0;   // 動作用：時間、上下起伏、前傾、左右晃
    this.airSide = 1; this.wasAir = false;
    this.load = 1;   // 走路速度的倍數：抱著裝滿魚的箱子會變慢（main.js 照箱子的重量設）   // 跳起來時哪隻腳在前（每跳一次換一邊）
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
      this.base = boat.walkDeckY?.(this.x, this.z) ?? boat.deckY(this.x, this.z);
    } else {
      this.x = x; this.z = z;
      const s = this._surface(x, z, world);
      this.base = s ? s.y : world.ground(x, z);
      this.onWater = !!(s && s.swim);
    }
    this.h = 0; this.vy = 0;
    this.airVX = this.airVZ = this.groundVX = this.groundVZ = this.flowVX = this.flowVZ = 0;
    this.y = this.base;
    this.off.set(0, 0, 0);
    this.pos.set(this.x, this.y, this.z);
    this.mesh.position.copy(this.pos);
  }

  // 船以外的地方：(x, z) 處能待的面。地面比水面下 SUBMERGE 還低就是踩不到底，浮在水裡
  _surface(x, z, world) {
    let g = world.ground(x, z);
    const w = world.water(x, z) - SUBMERGE;
    // 水中或橋面下的人可以從橋底游過；跳得比橋面高時，橋仍是可落腳的面。
    if (this.onWater && g > w + STEP && (this.h <= 0 || this.base + this.h < g)) {
      const u = world.ground(x, z, true); if (u < w) g = u;
    }
    if (g > 90) return null;
    return g < w ? { boat: null, y: w, swim: true } : { boat: null, y: g, swim: false };
  }

  // (x, z) 處能待的面；被擋住時回傳 'wall'
  _probe(x, z, world) {
    for (const b of world.boats) {
      if (b.sinking) continue;
      const l = b.toLocal(x, z);
      if (b.deckContains(l.x, l.z)) {
        const y = b.walkDeckY?.(x, z) ?? b.deckY(x, z), ground = this._surface(x, z, world);
        // 船停在橋下、兩者水平範圍重疊時，腳已高於橋面就應落在橋上。
        if (ground && !ground.swim && ground.y > y && this.base + this.h >= ground.y) return ground;
        return b.blockedLocal(l.x, l.z) ? 'wall' : { boat: b, lx: l.x, lz: l.z, y, swim: false };
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
    // 船舷是有高度的牆：走路不能直接穿出去，但可以跳過，或跨往附近可站的碼頭。
    if (this.boat && !this.fly && this.boat.deckClearance && this.boat.railHeightAt) {
      const b = this.boat, l = b.toLocal(tx, tz), now = b.deckClearance(this.lx, this.lz), next = b.deckClearance(l.x, l.z);
      const outward = next < BODY && next < now - 1e-6;
      const landing = s.boat !== b && !s.swim && this._reach(s);
      if (outward && this.h < b.railHeightAt(l.x) && !landing && !this._nearLanding(dx / len, dz / len, world, b)) return false;
    }
    if (!s.boat && this._bump(tx, tz, dx / len, dz / len, s.swim, world)) return false;
    // 站在碼頭或船上、前面是要掉下去的水：如果只是碼頭和船之間的空隙就一步跨過去；
    // 跨不過去（前面整片是水）就直接走下去、掉進水裡
    if (s.swim && !this.onWater && this.h <= 0 && s.y < this.base - DROP) {
      for (const hop of HOPS) {
        const hx = this.x + (dx / len) * hop, hz = this.z + (dz / len) * hop;
        const t = this._probe(hx, hz, world);
        if (t === 'wall') break;
        if (t.swim) continue;
        if (t.boat === this.boat || !this._reach(t)) break;
        this.hopExtraX += hx - this.x - dx; this.hopExtraZ += hz - this.z - dz;
        this.off.x += this.x - hx; this.off.z += this.z - hz;
        this._enter(t, hx, hz);
        return true;
      }
    }
    if (!this._reach(s)) return false;
    this._enter(s, tx, tz);
    return true;
  }

  _nearLanding(ux, uz, world, boat) {
    for (const hop of HOPS) {
      const s = this._probe(this.x + ux * hop, this.z + uz * hop, world);
      if (s === 'wall') return false;
      if (s.boat === boat || s.swim) continue;
      if (this._reach(s)) return true;
    }
    return false;
  }

  // 身體的寬度：往前走時，前方和斜前方離中心 BODY 的地方碰到牆就停（只看前面：已經貼著牆的人還是走得開）。
  // 船上不看（船上的走道窄，船自己的擋牆已經留了餘裕）；游泳時看水面底下的東西（棧橋的樁），不看棧板上的
  _bump(tx, tz, ux, uz, swim, world) {
    for (const a of [0, 0.75, -0.75]) {
      const c = Math.cos(a), s = Math.sin(a);
      const R = swim ? BODY_SWIM : BODY, px = tx + (ux * c - uz * s) * R, pz = tz + (ux * s + uz * c) * R;
      if (world.boats.some((b) => { if (b.sinking) return false; const l = b.toLocal(px, pz); return b.deckContains(l.x, l.z); })) continue;
      if (world.ground(px, pz, swim) > 90) return true;
    }
    return false;
  }

  // 被水流帶著走（漩渦、水龍捲）
  drift(dx, dz, world) { this._move(dx, dz, world); }

  // 河水直接推動站在河床上的人；離開邊緣時把水流和走路速度帶進空中。
  riverDrift(vx, vz, dt, world) {
    this.flowVX = vx; this.flowVZ = vz;
    const grounded = this.h <= 0;
    this._move(vx * dt, vz * dt, world);
    if (grounded && this.h > 0) this._launch();
  }

  _launch() {
    this.airVX = this.groundVX + this.flowVX;
    this.airVZ = this.groundVZ + this.flowVZ;
  }

  // dirX/dirZ：想走的方向（世界座標，可為 0）
  // world.ground(x,z,under)：地面或棧板高度（很大的值 = 牆）；under = true 時不算棧板，只看底下的地面
  // world.water(x,z)：水面高度；world.boats：可以走上去的船
  // fly：開發者模式的飛行（rise：+1 上升、-1 下降）。沒有重力，空中會撞到比腳高的東西；落到地上還是飛行狀態
  update(dt, dirX, dirZ, run, jump, world, rise = 0) {
    const fly = this.fly && !this.seat;
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
      this.base = (this.boat.walkDeckY?.(this.x, this.z) ?? this.boat.deckY(this.x, this.z)) + (seat ? seat.h - 0.38 : 0);
      this.onWater = false;
    } else {
      const feet = this.base + this.h;
      const s = this._surface(this.x, this.z, world);
      this.base = s ? s.y : world.ground(this.x, this.z);
      // 空中換支撐面時保持世界高度；不能把原本離水面的高度加到橋面上。
      if (s && this.h > 0) this.h = Math.max(0, feet - this.base);
      this.onWater = !!(s && s.swim);
    }
    const swim = this.swim = this.onWater && this.h <= 0 && !(fly && rise > 0);

    const airborne = this.h > 0 && !fly && !seat;
    const startX = this.x, startZ = this.z;
    this.hopExtraX = this.hopExtraZ = 0;
    this.groundVX = this.groundVZ = 0;
    const len = Math.hypot(dirX, dirZ);
    this.moving = len > 0.01;
    let dx = 0, dz = 0;
    if (airborne) {
      if (this.moving) {
        const v = (run ? RUN : WALK) * this.load, steer = 1 - Math.exp(-AIR_STEER * dt);
        this.airVX += (dirX / len * v - this.airVX) * steer;
        this.airVZ += (dirZ / len * v - this.airVZ) * steer;
      }
      const drag = Math.exp(-AIR_DRAG * dt);
      this.airVX *= drag; this.airVZ *= drag;
      dx = this.airVX * dt; dz = this.airVZ * dt;
    } else if (this.moving) {
      let v = fly ? (this.flyDash ? this.flyFast : this.flySpeed) : swim ? (run ? SWIM_FAST : SWIM) : (run ? RUN : WALK) * this.load;   // load：抱著重的魚箱走得慢
      if (fly) { /* 飛行：不管水、不管手上拿什麼 */ } else if (swim && this.carry) v *= 0.7;                                                        // 捧著東西游比較慢
      else if (!swim && !this.boat && this.base < world.water(this.x, this.z) - 0.45) v *= 0.6; // 涉水
      dx = (dirX / len) * v * dt; dz = (dirZ / len) * v * dt;
    }
    const sp = Math.hypot(dx, dz);
    if (sp > 0) {
      // 高速飛行一幀可能跨越薄牆，分段檢查整條路徑。
      const steps = Math.max(1, Math.ceil(sp / 0.15)), sx = dx / steps, sz = dz / steps;
      for (let i = 0; i < steps; i++) if (!this._move(sx, sz, world)) {
        // 被擋住就沿著邊滑：在船上沿船的縱橫向分解，在陸地沿東西南北分解
        const ax = this.boat ? Math.cos(this.boat.heading) : 1, az = this.boat ? Math.sin(this.boat.heading) : 0;
        const a = sx * ax + sz * az, b = -sx * az + sz * ax;
        const along = this._move(a * ax, a * az, world), across = this._move(-b * az, b * ax, world);
        if (airborne) {
          const va = this.airVX * ax + this.airVZ * az, vb = -this.airVX * az + this.airVZ * ax;
          this.airVX = (along ? va * ax : 0) - (across ? vb * az : 0);
          this.airVZ = (along ? va * az : 0) + (across ? vb * ax : 0);
        }
      }
    }
    if (!airborne && dt > 0 && !fly) {
      this.groundVX = (this.x - startX - this.hopExtraX) / dt;
      this.groundVZ = (this.z - startZ - this.hopExtraZ) / dt;
      if (this.h > 0) this._launch();
    }
    if (this.moving) {
      // 身體平滑轉向行進方向
      let d = Math.atan2(dirZ, dirX) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 12));
      this.phase += dt * (swim ? 6 : run ? 13 : 8.5);
    }

    if (fly) {
      // 飛行：Shift 上升、Q 下降，放開就停在半空；往上碰到頭頂的東西（棧板底、洞頂）不管，往下碰到地面就站著
      this.vy = 0;
      this.airVX = this.airVZ = 0;
      this.h = Math.min(Math.max(this.h + rise * this.flyVert * dt, 0), Math.max(0, this.flyMaxH - this.base));
      this.y = this.base + this.h;
      this.run = false;
      this.animate(dt);
      return;
    }
    // 跳躍與重力。游泳時也能跳：用力一蹬，整個人竄出水面（腳離水面約半公尺）
    if (jump && swim && !this.boat && world.ground(this.x, this.z) > this.base + 1.5) jump = false;   // 在棧橋底下游：頭上是棧板，跳不起來
    if (jump && this.h <= 0) { this._launch(); this.vy = swim ? JUMP_SWIM : JUMP; this.h = 1e-3; }
    if (this.h > 0) {
      this.vy -= GRAVITY * dt;
      this.h += this.vy * dt;
      if (this.h <= 0) { this.h = 0; this.vy = 0; }
    }
    if (this.h <= 0) this.airVX = this.airVZ = 0;
    this.y = this.base + this.h;
    this.run = run;
    this.animate(dt);
  }

  // 別人的人偶（多人）：沒有物理，位置和狀態都是網路傳來的，填好之後呼叫這個擺動作
  // st：{ moving, run, swim, carry, rod, seated, h }
  puppet(dt, st) {
    this.moving = st.moving; this.run = st.run; this.swim = st.swim; this.carry = st.carry; this.rod = st.rod; this.h = st.h;
    this.seat = st.seated ? (this.seat || {}) : null;
    if (this.moving) this.phase += dt * (this.swim ? 6 : this.run ? 13 : 8.5);
    this.animate(dt);
  }

  // 依照目前的狀態（moving、run、h、swim、carry、rod、seat、act、phase…）擺出動作、放到畫面上的位置
  animate(dt) {
    const run = this.run, swim = this.swim, seat = this.seat;
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
    // 每次離地換一邊：這次左腳右手在前，下次就右腳左手在前（別人看你跳也一樣會換）
    if (air && !this.wasAir) this.airSide = -this.airSide;
    this.wasAir = air;
    const swing = air ? 0.65 * this.airSide : this.moving ? stroke * (swim ? 0.45 : run ? 1.1 : 0.78) : 0;
    const { legs, arms, head } = this.mesh.userData;
    const ease = 1 - Math.exp(-dt * 14);
    // 剛開始捧東西或剛放下時，手臂抬起／放下慢一點（拿起平板、把魚抱起來的動作看得到）
    if (this.carry !== this.wasCarry) { this.wasCarry = this.carry; this.liftT = 0.6; }
    this.liftT = Math.max(0, (this.liftT || 0) - dt);
    const armE = this.liftT > 0 ? 1 - Math.exp(-dt * 7) : ease;
    const shift = idle ? 0.06 * Math.sin(T * 1.3) : 0;
    // 游泳：往前游時兩腿快速交替打水；停著踩水時兩腿慢慢一前一後地踩
    const kick = swim ? (this.moving ? 0.42 * Math.sin(T * 13) : 0.32 * Math.sin(T * 3.2)) : 0;
    const legSwing = swim ? kick : swing + shift;
    legs[0].rotation.z += ((seat ? 1.36 : legSwing) - legs[0].rotation.z) * ease;   // 坐著：兩條腿往前伸
    legs[1].rotation.z += ((seat ? 1.36 : -legSwing) - legs[1].rotation.z) * ease;
    const paddle = swim && !this.carry;
    const tread = paddle && !this.moving;   // 停在水裡踩水：雙手在胸前左右撥水
    const loose = idle ? 0.10 * Math.sin(T * 1.7) : 0;
    const scull = 0.15 * Math.sin(T * 3.2);
    const armL = this.carry ? 1.15 : tread ? 1.25 + scull : paddle ? 2.3 + stroke * 0.9 : -swing * 1.05 + loose;
    const armR = this.carry ? 1.15 : tread ? 1.25 - scull : paddle ? 2.3 - stroke * 0.9 : this.rod ? 0.95 : swing * 1.05 - loose;
    arms[0].rotation.z += (armL - arms[0].rotation.z) * armE;
    arms[1].rotation.z += (armR - arms[1].rotation.z) * armE;
    // 手臂往兩旁張開多少：平常張成 A 字（手才不會插進裙子，也比較像設定圖），走路時多一點，跳起來時舉高
    for (const arm of arms) {
      const side = arm.userData.side, busy = this.carry || (paddle && !tread) || (this.rod && side > 0);
      const out = tread ? 0.55 + 0.35 * Math.sin(T * 3.2) : busy ? 0 : 0.48 + (air ? 0.8 : this.moving ? 0.08 : 0.04 * Math.sin(T * 1.7 + side));
      arm.rotation.x += (-side * out - arm.rotation.x) * armE;
    }
    if (swim && !this.moving) this.phase += dt * 2.5;   // 停在水裡時踩水
    const walking = this.moving && !swim && !air;
    const slowEase = 1 - Math.exp(-dt * 8);
    // 游泳時身體自己也在動：每划一下往前竄、浮起一點再沉下去，身體跟著划手左右翻；踩水時整個人慢慢上下浮沉
    const swimBob = !swim ? 0 : this.moving ? 0.07 * Math.abs(Math.sin(this.phase)) - 0.035 : 0.06 * Math.sin(T * 1.9) + 0.02 * Math.sin(T * 6.4);
    this.bob += ((walking ? Math.abs(Math.cos(this.phase)) * (run ? 0.075 : 0.05) : idle ? 0.012 * Math.sin(T * 2.2) : swimBob) - this.bob) * ease;
    this.lean += ((walking ? (run ? 0.17 : 0.06) : 0) - this.lean) * slowEase;
    const swimRoll = !swim ? 0 : this.moving ? stroke * 0.22 : 0.05 * Math.sin(T * 1.3);
    this.roll += ((walking ? stroke * 0.06 : idle ? 0.025 * Math.sin(T * 1.3) : swimRoll) - this.roll) * ease;
    // 頭跟著鏡頭看的方向轉（轉不過去就看前面）；游泳時把頭抬起來
    let rel = this.lookYaw - this.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const reach = Math.min(1, Math.max(0, (2.5 - Math.abs(rel)) / 0.7));
    const hy = -Math.max(-1.25, Math.min(1.25, rel)) * reach;
    const hp = Math.max(-0.5, Math.min(0.45, this.lookPitch * 0.7 + 0.05)) + this.tilt * 0.75 - this.lean * 0.6;
    head.rotation.y += (hy - head.rotation.y) * slowEase;
    head.rotation.z += (hp - head.rotation.z) * slowEase;
    const swimHead = !swim ? 0 : this.moving ? -stroke * 0.16 : 0.08 * Math.sin(T * 0.8);   // 游的時候頭跟著划手往兩邊偏（換氣）
    head.rotation.x += ((idle ? 0.06 * Math.sin(T * 0.9) : walking ? -stroke * 0.04 : swimHead) - head.rotation.x) * slowEase;

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
    // 浮在水裡時身體順著浪面：前面高就仰一點、側面高就往那邊歪（離開水就慢慢回正）
    const onW = this.onWater && !this.boat, fx = Math.cos(this.yaw), fz = Math.sin(this.yaw);
    const sF = onW ? (this.wsX || 0) * fx + (this.wsZ || 0) * fz : 0, sR = onW ? -(this.wsX || 0) * fz + (this.wsZ || 0) * fx : 0;
    this.wPitch += (Math.atan(sF) * 0.8 - this.wPitch) * slow;
    this.wRoll += (Math.atan(sR) * 0.8 - this.wRoll) * slow;
    this.mesh.rotation.set(this.roll + (pose?.roll ?? 0) * w - this.wRoll, -this.yaw, -this.tilt - this.lean + this.wPitch, 'YZX');
  }

  // 水面的坡度（世界座標，游泳時身體跟著浪面傾斜）
  waveSlope(gx, gz) { this.wsX = gx; this.wsZ = gz; }

  // 告訴角色鏡頭正在看哪裡，頭會跟著轉過去
  look(yaw, pitch) { this.lookYaw = yaw; this.lookPitch = pitch; }

  eye(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.eyeH, this.pos.z);
  }
}
