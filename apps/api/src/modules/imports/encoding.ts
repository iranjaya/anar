import type { EncodingResult } from "./types.js";

const sampleSize = 64 * 1024;

const encoding = {
  detectEncoding(bytes: Uint8Array): EncodingResult {
    if (bytes[0] === 0xff && bytes[1] === 0xfe)
      return { encoding: "utf-16le", bomLength: 2, warning: null };
    if (bytes[0] === 0xfe && bytes[1] === 0xff)
      return { encoding: "utf-16be", bomLength: 2, warning: null };
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
      return { encoding: "utf-8", bomLength: 3, warning: null };
    const sample = bytes.subarray(0, sampleSize);
    if (encoding._nullShare(sample, 1) > 0.3)
      return { encoding: "utf-16le", bomLength: 0, warning: null };
    if (encoding._nullShare(sample, 0) > 0.3)
      return { encoding: "utf-16be", bomLength: 0, warning: null };
    try {
      // stream: true keeps a multi-byte character cut by the sample end from failing.
      new TextDecoder("utf-8", { fatal: true }).decode(sample, {
        stream: sample.length === sampleSize,
      });
      return { encoding: "utf-8", bomLength: 0, warning: null };
    } catch {
      return {
        encoding: "windows-1252",
        bomLength: 0,
        warning: "encoding_fallback",
      };
    }
  },
  _nullShare(sample: Uint8Array, start: 0 | 1): number {
    let total = 0;
    let nulls = 0;
    for (let i = start; i < sample.length; i += 2) {
      total++;
      if (sample[i] === 0) nulls++;
    }
    return total === 0 ? 0 : nulls / total;
  },
};
export default encoding;
