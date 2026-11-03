import path from "node:path";

export type ArchiveEntry = {
  name: string;
  kind: "file" | "directory" | "link" | "other";
};

export function validateArchive(entries: ArchiveEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = entry.name.replace(/\/$/, "");
    if (name === "." && entry.kind === "directory") continue;
    if (
      !name ||
      name.includes("\\") ||
      [...name].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) ||
      path.posix.isAbsolute(name) ||
      /^[a-zA-Z]:/.test(name) ||
      name.split("/").some((part) => part === ".." || part === "") ||
      !["file", "directory"].includes(entry.kind)
    )
      throw new Error("Unsafe uploads archive");
    const normalized = path.posix.normalize(name);
    if (seen.has(normalized)) throw new Error("Duplicate uploads archive path");
    seen.add(normalized);
  }
}
