// Volume profile — POC, Value Area (70%), HVN, LVN. Bucketed by price.
import type { RawCandle } from "./types";

export interface VolumeProfile {
  buckets: Array<{ price: number; volume: number }>;
  poc: number;      // price of max-volume bucket
  vah: number;      // value area high
  val: number;      // value area low
  hvn: number[];    // top 3 high-volume nodes
  lvn: number[];    // top 3 low-volume nodes
}

export function volumeProfile(candles: RawCandle[], numBuckets = 40): VolumeProfile | null {
  if (candles.length === 0) return null;
  let min = Infinity, max = -Infinity;
  for (const c of candles) { if (c.low < min) min = c.low; if (c.high > max) max = c.high; }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return null;
  const step = (max - min) / numBuckets;
  const vols = new Array(numBuckets).fill(0);
  for (const c of candles) {
    // Distribute volume across the buckets the candle overlaps (typical-price weighted).
    const lo = Math.floor((c.low - min) / step);
    const hi = Math.min(numBuckets - 1, Math.floor((c.high - min) / step));
    const span = Math.max(1, hi - lo + 1);
    const per = c.volume / span;
    for (let b = lo; b <= hi; b++) vols[b] += per;
  }
  const buckets = vols.map((volume, i) => ({ price: min + (i + 0.5) * step, volume }));
  const totalVol = vols.reduce((a, b) => a + b, 0);
  let pocIdx = 0;
  for (let i = 1; i < numBuckets; i++) if (vols[i] > vols[pocIdx]) pocIdx = i;
  // Value area — grow from POC until 70% of total volume.
  let vaVol = vols[pocIdx];
  let lo = pocIdx, hi = pocIdx;
  const target = totalVol * 0.7;
  while (vaVol < target && (lo > 0 || hi < numBuckets - 1)) {
    const up = hi < numBuckets - 1 ? vols[hi + 1] : -1;
    const dn = lo > 0 ? vols[lo - 1] : -1;
    if (up >= dn) { hi += 1; vaVol += up; } else { lo -= 1; vaVol += dn; }
  }
  const sortedByVol = [...buckets].sort((a, b) => b.volume - a.volume);
  return {
    buckets,
    poc: buckets[pocIdx].price,
    vah: buckets[hi].price,
    val: buckets[lo].price,
    hvn: sortedByVol.slice(0, 3).map((b) => b.price),
    lvn: sortedByVol.slice(-3).map((b) => b.price),
  };
}
