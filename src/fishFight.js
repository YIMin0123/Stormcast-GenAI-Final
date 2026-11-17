export const REEL_PROTOCOL = 1;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const range = (a, b, random) => a + (b - a) * random();

export function newFishFight(strength, rodLv) {
  return {
    strength, force: 0.35, progress: 0.3, strain: 0, grace: 1, inZone: true,
    zone: 0.45, target: 0.45, changeIn: 0.8, dash: 1,
    width: clamp(0.42 - 0.10 * strength, 0.17, 0.40) + 0.022 * rodLv,
    speed: Math.min(0.18 + 0.30 * strength, 0.72),
    risk: clamp((strength / (1 + 0.38 * rodLv) - 0.6) / 0.8, 0, 1.3),
    result: null,
  };
}

export function moveReelForce(force, held, seconds) {
  return clamp(force + (held ? 0.85 : -0.7) * seconds, 0, 1);
}

export function moveFightZone(zone, target, speed, seconds) {
  const step = speed * seconds;
  return zone + clamp(target - zone, -step, step);
}

export function stepFishFight(f, held, seconds, random = Math.random) {
  if (f.result) return;
  const half = f.width / 2;
  if ((f.changeIn -= seconds) <= 0) {
    f.target = range(half, 1 - half, random);
    f.changeIn += range(0.5, 1.7, random) / (0.7 + 0.5 * Math.min(f.strength, 1.6));
    f.dash = random() < 0.25 ? 1.6 : 1;
  }
  f.zone = moveFightZone(f.zone, f.target, f.speed * f.dash, seconds);
  f.force = moveReelForce(f.force, held, seconds);
  f.inZone = Math.abs(f.force - f.zone) <= half;
  f.grace -= seconds;
  if (f.inZone) f.progress += seconds * 0.2 / (0.7 + 0.5 * f.strength);
  else if (f.grace <= 0) f.progress -= seconds * (0.10 + 0.04 * f.strength);

  const over = f.force - f.zone - half;
  if (over > 0 && f.risk > 0 && f.grace <= 0) f.strain += seconds * f.risk * (0.5 + 2.5 * over);
  else f.strain = Math.max(0, f.strain - seconds * 0.4);

  if (f.strain >= 1) f.result = 'snap';
  else if (f.progress <= 0) f.result = 'escape';
  else if (f.progress >= 1) f.result = 'caught';
}

// 用遊戲端自己的輸入時間預測指標，伺服器只採它收到輸入的時間。
// inputs[0] 保留最近一次已確認的邊緣。更晚的邊緣依序套回最新快照。
export function predictReelForce(sample, inputs, now, rtt) {
  const first = inputs[0];
  const ackAt = first?.n === sample.n ? first.at : -Infinity;
  let at = sample.n ? Math.max(sample.at - rtt, ackAt) : (first?.at ?? now);
  let force = sample.force, held = sample.held;
  for (const input of inputs) {
    if (input.n <= sample.n) continue;
    const edgeAt = Math.max(at, input.at);
    force = moveReelForce(force, held, (edgeAt - at) / 1000);
    at = edgeAt;
    held = input.held;
  }
  return moveReelForce(force, held, Math.max(0, now - at) / 1000);
}
