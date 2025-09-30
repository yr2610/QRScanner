const ALPHABET = "0123456789abcdefghijkmnopqrstuvw";

export function encodeMask32(mask) {
  const normalized = (mask >>> 0) >>> 0;
  let value = BigInt(normalized) << 3n;
  let out = "";
  for (let i = 6; i >= 0; i--) {
    const shift = BigInt(i * 5);
    const idx = Number((value >> shift) & 31n);
    out += ALPHABET[idx];
  }
  return out;
}

export function makeMaskFromGot(got, total) {
  const totalClamped = Math.max(0, Math.floor(total)) >>> 0;
  if (!totalClamped) return 0;
  let mask = 0 >>> 0;
  for (let bucket = 0; bucket < 32; bucket++) {
    const start = Math.floor((bucket * totalClamped) / 32);
    const exclusiveEnd = Math.floor(((bucket + 1) * totalClamped) / 32);
    const end = Math.min(totalClamped, exclusiveEnd) - 1;
    if (start > end) continue;
    let missing = false;
    for (let idx = start; idx <= end; idx++) {
      if (!got[idx]) { missing = true; break; }
    }
    if (missing) mask |= (1 << (31 - bucket));
  }
  return mask >>> 0;
}
