import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { AppError } from "@anar/domain/errors";
import type { ReadControl } from "./types.js";

export const fileCap = 25 * 1024 * 1024;

const files = {
  // Bytes go to a random temp name first; only a recorded batch gets its final name.
  async writeTemp(
    root: string,
    bytes: AsyncIterable<Uint8Array>,
    control: ReadControl,
  ): Promise<{ path: string; size: number }> {
    const dir = join(root, "tmp");
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${randomUUID()}.part`);
    let size = 0;
    try {
      await pipeline(
        bytes,
        async function* (source: AsyncIterable<Uint8Array>) {
          for await (const chunk of source) {
            size += chunk.length;
            if (size > fileCap)
              throw new AppError("validation", "The file is larger than 25 MB");
            yield chunk;
          }
        },
        createWriteStream(path, { flags: "wx" }),
        { signal: control.signal },
      );
    } catch (error) {
      await files.remove(path);
      throw error;
    }
    return { path, size };
  },
  async place(
    root: string,
    tempPath: string,
    companyId: string,
    batchId: string,
  ): Promise<string> {
    const relative = join("imports", companyId, `${batchId}.csv`);
    await mkdir(join(root, "imports", companyId), { recursive: true });
    await rename(tempPath, join(root, relative));
    return relative;
  },
  // Null when the file is gone.
  async sha256(path: string, control: ReadControl): Promise<string | null> {
    const hash = createHash("sha256");
    try {
      for await (const chunk of createReadStream(path, {
        signal: control.signal,
      }))
        hash.update(chunk);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return hash.digest("hex");
  },
  async remove(path: string): Promise<void> {
    await rm(path, { force: true });
  },
};
export default files;
