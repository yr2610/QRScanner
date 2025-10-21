const ALPHABET = "0123456789abcdefghijkmnopqrstuvw";

export function bucketRange(bucket, total) {
  const T = Math.max(0, Math.floor(total)) >>> 0;
  const start = Math.floor((bucket * T) / 32);
  const end = Math.floor(((bucket + 1) * T) / 32) - 1;
  return [start, end];
}

export function makeMaskFromGot(got, total) {
  const T = Math.max(0, Math.floor(total)) >>> 0;
  if (!T) return 0 >>> 0;
  let mask = 0 >>> 0;
  for (let bucket = 0; bucket < 32; bucket++) {
    const [start, end] = bucketRange(bucket, T);
    if (start > end) { mask |= (1 << (31 - bucket)); continue; }
    let complete = true;
    for (let idx = start; idx <= end; idx++) {
      if (!got[idx]) { complete = false; break; }
    }
    if (complete) mask |= (1 << (31 - bucket));
  }
  return mask >>> 0;
}

function toSym7(mask) {
  let value = BigInt(mask >>> 0) << 3n;
  let out = "";
  for (let i = 6; i >= 0; i--) {
    const shift = BigInt(i * 5);
    const idx = Number((value >> shift) & 31n);
    out += ALPHABET[idx];
  }
  return out;
}

function tryH5T2Length(sym7) {
  let body = 0;
  for (let i = 0; i < 5; i++) if (sym7[i] !== '0') body++;
  let tail = 0;
  if (sym7[5] !== '0') tail++;
  if (sym7[6] !== '0') tail++;
  return 1 + body + tail;
}

export function encode(mask) {
  const sym7 = toSym7(mask >>> 0);
  const h5t2Length = tryH5T2Length(sym7);
  if (h5t2Length <= 6) {
    let header = 0;
    for (let i = 0; i < 5; i++) if (sym7[i] !== '0') header |= (1 << (4 - i));
    let out = ALPHABET[header];
    for (let i = 0; i < 5; i++) if (sym7[i] !== '0') out += sym7[i];
    if (sym7[5] !== '0') out += sym7[5];
    if (sym7[6] !== '0') out += sym7[6];
    return out;
  }
  return sym7;
}

export function encodeMask32(mask) {
  return encode(mask);
}

export function pretty(code) {
  return code.replace(/w/g, '-');
}
