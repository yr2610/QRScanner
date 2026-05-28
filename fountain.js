const VERSION = 1;

export function parseFountainFrame(text) {
  const m = text.match(/^Q4F\|([0-9A-F]+)\|([0-9A-F]{1,4})\/([0-9A-F]{1,4})\|([0-9A-Z]{3,4})\|([0-9A-F]{1,4})\|([0-9A-F]{1,4})\|([0-9A-F]{1,8})\|([0-9A-F]{8})\|([A-Za-z0-9_-]*)$/i);
  if (!m) return null;
  let payload;
  try {
    payload = base64UrlToBytes(m[9]);
  } catch {
    return null;
  }

  const frame = {
    version: parseInt(m[1], 16),
    symbolId: parseInt(m[2], 16) - 1,
    totalSymbols: parseInt(m[3], 16),
    sid: m[4].toUpperCase(),
    sourceSymbolCount: parseInt(m[5], 16),
    symbolSize: parseInt(m[6], 16),
    sourceLength: parseInt(m[7], 16),
    crc32: parseInt(m[8], 16) >>> 0,
    payload,
  };

  if (frame.version !== VERSION) return null;
  if (!Number.isInteger(frame.symbolId) || frame.symbolId < 0) return null;
  if (!Number.isInteger(frame.totalSymbols) || frame.totalSymbols <= 0) return null;
  if (!Number.isInteger(frame.sourceSymbolCount) || frame.sourceSymbolCount <= 0) return null;
  if (!Number.isInteger(frame.symbolSize) || frame.symbolSize <= 0) return null;
  if (!Number.isInteger(frame.sourceLength) || frame.sourceLength <= 0) return null;
  if (frame.payload.length !== frame.symbolSize) return null;
  return frame;
}

export function bytesToBase64Url(bytes) {
  let binary = "";
  const block = 0x8000;
  for (let i = 0; i < bytes.length; i += block) {
    binary += String.fromCharCode(...bytes.subarray(i, i + block));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class FountainDecoder {
  constructor(firstFrame) {
    this.sid = firstFrame.sid;
    this.totalSymbols = firstFrame.totalSymbols;
    this.sourceSymbolCount = firstFrame.sourceSymbolCount;
    this.symbolSize = firstFrame.symbolSize;
    this.sourceLength = firstFrame.sourceLength;
    this.crc32 = firstFrame.crc32 >>> 0;
    this.wordCount = Math.ceil(this.sourceSymbolCount / 32);
    this.basisBits = new Array(this.sourceSymbolCount);
    this.basisData = new Array(this.sourceSymbolCount);
    this.seenSymbols = new Set();
    this.rank = 0;
    this.received = 0;
    this.duplicates = 0;
    this.rejected = 0;
    this.complete = false;
    this.recoveredBytes = null;
  }

  matches(frame) {
    return frame.sid === this.sid &&
      frame.totalSymbols === this.totalSymbols &&
      frame.sourceSymbolCount === this.sourceSymbolCount &&
      frame.symbolSize === this.symbolSize &&
      frame.sourceLength === this.sourceLength &&
      frame.crc32 === this.crc32;
  }

  accept(frame) {
    if (this.complete) return { accepted: false, complete: true, reason: "complete" };
    if (!this.matches(frame)) {
      this.rejected++;
      return { accepted: false, complete: false, reason: "metadata" };
    }
    if (this.seenSymbols.has(frame.symbolId)) {
      this.duplicates++;
      return { accepted: false, complete: false, reason: "duplicate" };
    }

    this.seenSymbols.add(frame.symbolId);
    this.received++;
    const bits = coefficientBits(frame.symbolId, this.sourceSymbolCount, this.wordCount);
    const data = new Uint8Array(frame.payload);
    const independent = this.addEquation(bits, data);
    if (independent && this.rank === this.sourceSymbolCount) {
      this.tryRecover();
    }

    return { accepted: independent, complete: this.complete, reason: independent ? "accepted" : "dependent" };
  }

  addEquation(bits, data) {
    for (;;) {
      const pivot = firstSetBit(bits);
      if (pivot < 0) {
        return false;
      }

      const basisBits = this.basisBits[pivot];
      if (!basisBits) {
        this.basisBits[pivot] = bits;
        this.basisData[pivot] = data;
        this.rank++;
        return true;
      }

      xorWords(bits, basisBits);
      xorBytes(data, this.basisData[pivot]);
    }
  }

  tryRecover() {
    const solved = new Array(this.sourceSymbolCount);
    for (let pivot = this.sourceSymbolCount - 1; pivot >= 0; pivot--) {
      const bits = this.basisBits[pivot];
      if (!bits) return false;

      const data = new Uint8Array(this.basisData[pivot]);
      for (let i = pivot + 1; i < this.sourceSymbolCount; i++) {
        if (hasBit(bits, i)) {
          xorBytes(data, solved[i]);
        }
      }
      solved[pivot] = data;
    }

    const recovered = new Uint8Array(this.sourceSymbolCount * this.symbolSize);
    for (let i = 0; i < solved.length; i++) {
      recovered.set(solved[i], i * this.symbolSize);
    }

    const trimmed = recovered.slice(0, this.sourceLength);
    if (crc32(trimmed) !== this.crc32) {
      this.rejected++;
      return false;
    }

    this.complete = true;
    this.recoveredBytes = trimmed;
    return true;
  }
}

function coefficientBits(symbolId, sourceSymbolCount, wordCount) {
  const bits = new Uint32Array(wordCount);
  if (symbolId >= 0 && symbolId < sourceSymbolCount) {
    setBit(bits, symbolId);
    return bits;
  }

  if (sourceSymbolCount > 1 && symbolId < sourceSymbolCount * 2) {
    setBit(bits, sourceSymbolCount - 1 - (symbolId - sourceSymbolCount));
    return bits;
  }

  const rng = new XorShift32(seedFor(symbolId, sourceSymbolCount));
  const degree = chooseDegree(rng, sourceSymbolCount);
  const selected = new Set();
  while (selected.size < degree) {
    selected.add(rng.nextUInt32() % sourceSymbolCount);
  }
  for (const index of selected) {
    setBit(bits, index);
  }
  return bits;
}

function chooseDegree(rng, sourceSymbolCount) {
  if (sourceSymbolCount <= 1) return 1;
  const sample = rng.nextUInt32() % 100;
  const preferred = sample < 15 ? 2 :
    sample < 30 ? 3 :
    sample < 50 ? 5 :
    sample < 70 ? 8 :
    sample < 85 ? 13 :
    sample < 95 ? 21 : 34;
  return Math.min(preferred, Math.min(64, sourceSymbolCount));
}

class XorShift32 {
  constructor(seed) {
    this.state = seed >>> 0 || 0x6d2b79f5;
  }

  nextUInt32() {
    let x = this.state >>> 0;
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0;
    this.state = x >>> 0;
    return this.state;
  }
}

function seedFor(symbolId, sourceSymbolCount) {
  let x = (Math.imul((symbolId + 1) >>> 0, 0x9e3779b1) ^
    Math.imul(sourceSymbolCount >>> 0, 0x85ebca77) ^
    0xa5a5a5a5) >>> 0;
  x = mix32(x);
  return x || 0x6d2b79f5;
}

function mix32(x) {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

function setBit(bits, index) {
  bits[index >>> 5] |= (1 << (index & 31)) >>> 0;
}

function hasBit(bits, index) {
  return (bits[index >>> 5] & ((1 << (index & 31)) >>> 0)) !== 0;
}

function firstSetBit(bits) {
  for (let wordIndex = 0; wordIndex < bits.length; wordIndex++) {
    let word = bits[wordIndex] >>> 0;
    if (word === 0) continue;
    for (let bit = 0; bit < 32; bit++) {
      if ((word & ((1 << bit) >>> 0)) !== 0) {
        return (wordIndex << 5) + bit;
      }
    }
  }
  return -1;
}

function xorWords(target, source) {
  for (let i = 0; i < target.length; i++) {
    target[i] ^= source[i];
  }
}

function xorBytes(target, source) {
  for (let i = 0; i < target.length; i++) {
    target[i] ^= source[i];
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc = (crc ^ b) >>> 0;
    for (let i = 0; i < 8; i++) {
      const mask = -(crc & 1);
      crc = ((crc >>> 1) ^ (0xedb88320 & mask)) >>> 0;
    }
  }
  return (~crc) >>> 0;
}
