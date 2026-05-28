import {
  WirehairDecoder,
  Wirehair_NeedMore,
  Wirehair_Success,
} from "./libs/wirehair-wasm/dist/wirehair.mjs";

const VERSION = 1;
const WIREHAIR_HEADER_BYTES = 8;

export function parseFountainFrame(text) {
  const m = text.match(/^Q4W\|([0-9A-F]+)\|([0-9A-F]{1,4})\/([0-9A-F]{1,4})\|([0-9A-Z]{3,4})\|([0-9A-F]{1,4})\|([0-9A-F]{1,4})\|([0-9A-F]{1,8})\|([0-9A-F]{8})\|([A-Za-z0-9_-]*)$/i);
  if (!m) return null;

  let payload;
  try {
    payload = base64UrlToBytes(m[9]);
  } catch {
    return null;
  }

  const frame = {
    protocol: "Q4W",
    version: parseInt(m[1], 16),
    packetId: parseInt(m[2], 16) - 1,
    totalPackets: parseInt(m[3], 16),
    sid: m[4].toUpperCase(),
    sourceSymbolCount: parseInt(m[5], 16),
    packetByteCount: parseInt(m[6], 16),
    sourceLength: parseInt(m[7], 16),
    crc32: parseInt(m[8], 16) >>> 0,
    payload,
  };

  if (frame.version !== VERSION) return null;
  if (!Number.isInteger(frame.packetId) || frame.packetId < 0) return null;
  if (!Number.isInteger(frame.totalPackets) || frame.totalPackets <= 0) return null;
  if (frame.packetId >= frame.totalPackets) return null;
  if (!Number.isInteger(frame.sourceSymbolCount) || frame.sourceSymbolCount <= 0) return null;
  if (!Number.isInteger(frame.packetByteCount) || frame.packetByteCount <= WIREHAIR_HEADER_BYTES) return null;
  if (!Number.isInteger(frame.sourceLength) || frame.sourceLength <= 0) return null;
  if (frame.payload.length <= WIREHAIR_HEADER_BYTES || frame.payload.length > frame.packetByteCount) return null;

  const header = readWirehairHeader(frame.payload);
  if (!header) return null;
  if (header.sourceLength !== frame.sourceLength) return null;
  if (header.blockId !== frame.packetId) return null;
  frame.blockId = header.blockId;

  return frame;
}

export function bytesToBase64Url(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  let binary = "";
  const block = 0x8000;
  for (let i = 0; i < bytes.length; i += block) {
    binary += String.fromCharCode(...bytes.subarray(i, i + block));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class FountainDecoder {
  static async create(firstFrame) {
    const wirehair = await WirehairDecoder.create();
    return new FountainDecoder(firstFrame, wirehair);
  }

  constructor(firstFrame, wirehair) {
    this.sid = firstFrame.sid;
    this.totalPackets = firstFrame.totalPackets;
    this.sourceSymbolCount = firstFrame.sourceSymbolCount;
    this.packetByteCount = firstFrame.packetByteCount;
    this.sourceLength = firstFrame.sourceLength;
    this.crc32 = firstFrame.crc32 >>> 0;
    this.wirehair = wirehair;
    this.seenBlocks = new Set();
    this.received = 0;
    this.duplicates = 0;
    this.rejected = 0;
    this.complete = false;
    this.recoveredBytes = null;
    this.lastError = "";
  }

  get rank() {
    return Math.min(this.received, this.sourceSymbolCount);
  }

  matches(frame) {
    return frame.protocol === "Q4W" &&
      frame.sid === this.sid &&
      frame.totalPackets === this.totalPackets &&
      frame.sourceSymbolCount === this.sourceSymbolCount &&
      frame.packetByteCount === this.packetByteCount &&
      frame.sourceLength === this.sourceLength &&
      frame.crc32 === this.crc32;
  }

  accept(frame) {
    if (this.complete) return { accepted: false, complete: true, reason: "complete" };
    if (!this.matches(frame)) {
      this.rejected++;
      return { accepted: false, complete: false, reason: "metadata" };
    }
    if (this.seenBlocks.has(frame.blockId)) {
      this.duplicates++;
      return { accepted: false, complete: false, reason: "duplicate" };
    }

    let result;
    try {
      result = this.wirehair.decode(frame.payload);
    } catch (error) {
      this.rejected++;
      this.lastError = error instanceof Error ? error.message : String(error);
      return { accepted: false, complete: false, reason: "decode-error" };
    }

    if (result === false) {
      this.duplicates++;
      this.seenBlocks.add(frame.blockId);
      return { accepted: false, complete: false, reason: "duplicate" };
    }
    if (result !== Wirehair_NeedMore && result !== Wirehair_Success) {
      this.rejected++;
      this.lastError = `Wirehair decode returned ${result}.`;
      return { accepted: false, complete: false, reason: "decode-error" };
    }

    this.seenBlocks.add(frame.blockId);
    this.received++;

    if (result === Wirehair_Success) {
      return this.tryRecover();
    }

    return { accepted: true, complete: false, reason: "accepted" };
  }

  tryRecover() {
    let recovered;
    try {
      recovered = this.wirehair.recover();
    } catch (error) {
      this.rejected++;
      this.lastError = error instanceof Error ? error.message : String(error);
      return { accepted: false, complete: false, reason: "recover-error" };
    }

    if (crc32(recovered) !== this.crc32) {
      this.rejected++;
      this.lastError = "CRC-32 mismatch.";
      return { accepted: false, complete: false, reason: "crc" };
    }

    this.complete = true;
    this.recoveredBytes = recovered;
    return { accepted: true, complete: true, reason: "complete" };
  }

  free() {
    if (this.wirehair) {
      this.wirehair.free();
      this.wirehair = null;
    }
  }
}

function readWirehairHeader(packet) {
  if (packet.byteLength < WIREHAIR_HEADER_BYTES) return null;
  const view = new DataView(packet.buffer, packet.byteOffset, WIREHAIR_HEADER_BYTES);
  return {
    sourceLength: view.getUint32(0, true),
    blockId: view.getUint32(4, true),
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
