import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "@anar/domain/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createImportService,
  type ImportDeps,
} from "../../src/modules/imports/index.js";
import type { Ctx } from "../../src/modules/tenant/index.js";

const current = {
  user: { id: "c0000000-0000-4000-8000-000000000001" },
  role: "agency_staff",
  agencyId: "a0000000-0000-4000-8000-000000000001",
  companyId: "b0000000-0000-4000-8000-000000000001",
  member: null,
  superAdminCanImport: false,
} as unknown as Ctx;
const csv = "name,phone\nTest Lead,9841000001\n";

async function* bytes(...chunks: (string | Uint8Array)[]) {
  for (const chunk of chunks)
    yield typeof chunk === "string" ? Buffer.from(chunk) : chunk;
}

describe("upload cleans up after every failure", () => {
  let root: string;
  let calls: string[];
  let allowed: boolean;
  let insert: () => never;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "anar-upload-"));
    calls = [];
    allowed = true;
    insert = () => {
      throw new AppError("unavailable", "The database is down");
    };
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function service(overrides: Partial<ImportDeps> = {}) {
    const tx = {
      select: () => ({ from: async () => [] }),
      insert: () => insert(),
    };
    return createImportService({
      uploadsRoot: root,
      context: {
        requireContext: vi.fn(),
        withContext: async (actor, fn) => {
          calls.push("context");
          return fn(tx as never, actor);
        },
      },
      limitUpload: async () => ({ allowed, retryAfter: 600 }),
      loadSchema: async () => ({
        fields: [],
        stages: [],
        outcomes: [],
        lostReasons: [],
      }),
      findImportMatches: async () => [],
      now: () => new Date(),
      createFields: vi.fn(),
      extendFieldOptions: vi.fn(),
      fieldKeys: vi.fn(),
      enqueue: vi.fn(),
      ...overrides,
    });
  }
  const control = () => ({ signal: new AbortController().signal });
  async function filesLeft() {
    const found: string[] = [];
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else found.push(path);
      }
    }
    await walk(root);
    return found;
  }
  const upload = (
    input: Partial<{ fileName: string; contentType: string }>,
    chunks: AsyncIterable<Uint8Array> = bytes(csv),
    deps: Partial<ImportDeps> = {},
    signal = control(),
  ) =>
    service(deps).createImportBatch(
      current,
      {
        fileName: "leads.csv",
        contentType: "text/csv",
        bytes: chunks,
        ip: null,
        ...input,
      },
      signal,
    );

  it.each([
    [{ fileName: "leads.xlsx" }],
    [{ fileName: "leads" }],
    [{ contentType: "application/pdf" }],
    [{ contentType: "image/png" }],
  ])("refuses %j before checking access or reading bytes", async (input) => {
    await expect(upload(input)).rejects.toMatchObject({ code: "validation" });
    expect(calls).toEqual([]);
    expect(await filesLeft()).toEqual([]);
  });

  it("refuses a disallowed actor before any file exists", async () => {
    const denied = { ...current, role: "admin", member: { id: "m" } } as Ctx;
    await expect(
      service().createImportBatch(
        denied,
        {
          fileName: "leads.csv",
          contentType: "text/csv",
          bytes: bytes(csv),
          ip: null,
        },
        control(),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await filesLeft()).toEqual([]);
  });

  it("checks access and the hourly limit before any byte is read", async () => {
    allowed = false;
    await expect(service().admitUpload(current)).resolves.toEqual({
      allowed: false,
      retryAfter: 600,
    });
    expect(calls).toEqual(["context"]);
    expect(await filesLeft()).toEqual([]);
  });

  it("stops a file over 25 MB and removes what was written", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x61);
    const big = bytes(...Array.from({ length: 25 }, () => chunk), "a");
    await expect(upload({}, big)).rejects.toMatchObject({
      code: "validation",
      message: "The file is larger than 25 MB",
    });
    expect(await filesLeft()).toEqual([]);
  });

  it.each<[string, string | Uint8Array]>([
    ["an empty file", ""],
    ["binary bytes", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])],
  ])("removes the temp file for %s", async (_, body) => {
    await expect(
      upload({ contentType: "" }, bytes(body)),
    ).rejects.toMatchObject({ code: "validation" });
    expect(await filesLeft()).toEqual([]);
  });

  it("removes the placed file when the batch insert fails", async () => {
    await expect(upload({})).rejects.toMatchObject({ code: "unavailable" });
    expect(calls).toEqual(["context"]);
    expect(await filesLeft()).toEqual([]);
  });

  it("removes the temp file when the request stops mid stream", async () => {
    const abort = new AbortController();
    async function* stalled() {
      yield Buffer.from("name,phone\n");
      abort.abort();
      yield Buffer.from("Test Lead,9841000001\n");
    }
    await expect(
      upload({}, stalled(), {}, { signal: abort.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await filesLeft()).toEqual([]);
  });
});
