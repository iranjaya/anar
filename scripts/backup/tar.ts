import { open } from "node:fs/promises";
import type { ArchiveEntry } from "./archive.ts";

const blockSize = 512;
const decoder = new TextDecoder("utf-8", { fatal: true });

function field(block: Buffer, start: number, length: number): string {
  const bytes = block.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return decoder.decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function octal(value: string): number {
  const trimmed = value.trim();
  if (!/^[0-7]+$/.test(trimmed)) throw new Error("Invalid uploads archive");
  const parsed = Number.parseInt(trimmed, 8);
  if (!Number.isSafeInteger(parsed)) throw new Error("Invalid uploads archive");
  return parsed;
}

export async function listTar(file: string): Promise<ArchiveEntry[]> {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    if (size < blockSize * 2 || size % blockSize !== 0)
      throw new Error("Invalid uploads archive");
    const entries: ArchiveEntry[] = [];
    const block = Buffer.alloc(blockSize);
    let offset = 0;
    while (offset + blockSize <= size) {
      const { bytesRead } = await handle.read(block, 0, blockSize, offset);
      if (bytesRead !== blockSize) throw new Error("Invalid uploads archive");
      if (block.every((byte) => byte === 0)) {
        if (offset + blockSize * 2 > size)
          throw new Error("Invalid uploads archive");
        const next = Buffer.alloc(blockSize);
        for (let rest = offset + blockSize; rest < size; rest += blockSize) {
          const read = await handle.read(next, 0, blockSize, rest);
          if (read.bytesRead !== blockSize || !next.every((byte) => byte === 0))
            throw new Error("Invalid uploads archive");
        }
        return entries;
      }
      if (field(block, 257, 5) !== "ustar")
        throw new Error("Invalid uploads archive");
      const expected = octal(field(block, 148, 8));
      let actual = 0;
      for (let index = 0; index < blockSize; index++)
        actual += index >= 148 && index < 156 ? 32 : block[index];
      if (expected !== actual) throw new Error("Invalid uploads archive");
      const name = field(block, 0, 100);
      const prefix = field(block, 345, 155);
      const type = block[156];
      entries.push({
        name: prefix ? `${prefix}/${name}` : name,
        kind:
          type === 0 || type === 48
            ? "file"
            : type === 53
              ? "directory"
              : type === 49 || type === 50
                ? "link"
                : "other",
      });
      const bodySize = octal(field(block, 124, 12));
      offset += blockSize + Math.ceil(bodySize / blockSize) * blockSize;
    }
    throw new Error("Invalid uploads archive");
  } finally {
    await handle.close();
  }
}
