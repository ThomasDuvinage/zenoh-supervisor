export interface LatencyStats {
  n: number;
  last: number;
  min: number;
  avg: number;
  max: number;
  /** mean absolute difference between consecutive samples */
  jitter: number;
  /** samples below zero: the two clocks are not synchronised */
  negative: number;
}

/** computed on the UI tick only (not per message), so high-rate topics stay cheap */
export function latencyStats(lat: number[]): LatencyStats | null {
  if (lat.length === 0) return null;
  let sum = 0, jit = 0, neg = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < lat.length; i++) {
    sum += lat[i];
    if (lat[i] < min) min = lat[i];
    if (lat[i] > max) max = lat[i];
    if (lat[i] < 0) neg++;
    if (i > 0) jit += Math.abs(lat[i] - lat[i - 1]);
  }
  return {
    n: lat.length,
    last: lat[lat.length - 1],
    min,
    avg: sum / lat.length,
    max,
    jitter: lat.length > 1 ? jit / (lat.length - 1) : 0,
    negative: neg,
  };
}

export const fmtMs = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(1)} ms`);
