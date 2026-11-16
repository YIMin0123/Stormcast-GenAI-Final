import { isIP, SocketAddress } from 'node:net';

const MAX_PER_SOURCE = 16;
const MAX_SOURCES = 8192;
const SOURCE_TTL = 60000;
const UPGRADE_BURST = 24, UPGRADE_PER_MINUTE = 120;
const GUEST_BURST = 8, GUEST_PER_MINUTE = 12;
const TOTAL_UPGRADE_BURST = 256, TOTAL_UPGRADES_PER_MINUTE = 480;
const TOTAL_GUEST_BURST = 48, TOTAL_GUESTS_PER_MINUTE = 60;

export function admissionKey(ip) {
  if (isIP(ip) !== 6) return ip;
  const address = new SocketAddress({ address: ip, family: 'ipv6' }).address;
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) return address.slice(7);
  // IPv6 客戶可在同一 /64 內自行換位址，統一用前四組判斷來源。
  const [head, tail] = address.split('::');
  const groups = head ? head.split(':') : [];
  if (tail !== undefined) {
    const suffix = tail ? tail.split(':') : [];
    groups.push(...Array(8 - groups.length - suffix.length).fill('0'), ...suffix);
  }
  return `${groups.slice(0, 4).join(':')}::/64`;
}

function spend(bucket, burst, perMinute, now) {
  bucket.credit = Math.min(burst, bucket.credit + (now - bucket.at) * perMinute / 60000);
  bucket.at = now;
  if (bucket.credit < 1) return false;
  bucket.credit--;
  return true;
}

export class Admission {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.sources = new Map();
    this.pruneAt = 0;
    const at = now();
    this.upgrades = { credit: TOTAL_UPGRADE_BURST, at };
    this.guests = { credit: TOTAL_GUEST_BURST, at };
  }

  // 只在通過 Origin 檢查、伺服器還有名額時呼叫。回傳 0 表示可升級。
  upgrade(key) {
    const now = this.now();
    if (now >= this.pruneAt) {
      this.pruneAt = now + SOURCE_TTL;
      for (const [ip, source] of this.sources) {
        if (!source.open && now - Math.max(source.upgrades.at, source.guests.at) >= SOURCE_TTL) this.sources.delete(ip);
      }
    }
    const source = this.sources.get(key);
    if (source && (source.open >= MAX_PER_SOURCE || !spend(source.upgrades, UPGRADE_BURST, UPGRADE_PER_MINUTE, now))) return 429;
    if (!spend(this.upgrades, TOTAL_UPGRADE_BURST, TOTAL_UPGRADES_PER_MINUTE, now)) return 503;
    if (!source) {
      if (this.sources.size >= MAX_SOURCES) return 503;
      this.sources.set(key, { open: 0, upgrades: { credit: UPGRADE_BURST - 1, at: now }, guests: { credit: GUEST_BURST, at: now } });
    }
    return 0;
  }

  opened(key) {
    const source = this.sources.get(key);
    source.open++;
    return () => { source.open--; };
  }

  guest(key) {
    const now = this.now();
    return spend(this.sources.get(key).guests, GUEST_BURST, GUEST_PER_MINUTE, now)
      && spend(this.guests, TOTAL_GUEST_BURST, TOTAL_GUESTS_PER_MINUTE, now);
  }
}
