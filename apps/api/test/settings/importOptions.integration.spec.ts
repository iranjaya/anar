import { fields } from "@anar/db/tenant";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createFields,
  extendFieldOptions,
} from "../../src/modules/settings/index.js";
import type { Ctx } from "../../src/modules/tenant/index.js";
import { type SettingsFixture, startSettingsFixture } from "./fixture.js";

type Option = { value: string; label: string };
const options = (count: number, prefix = "c"): Option[] =>
  Array.from({ length: count }, (_, n) => ({
    value: `${prefix}${n}`,
    label: `${prefix.toUpperCase()} ${n}`,
  }));

describe("an import adds answers to existing dropdowns", () => {
  let fixture: SettingsFixture;
  beforeAll(async () => {
    fixture = await startSettingsFixture();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  async function setup(start: Option[] = options(2)) {
    const base = await fixture.setup();
    const { manager } = base;
    const current = (otpAgeMs = 0) =>
      ({
        role: "super_admin",
        agencyId: base.a.agencyId,
        companyId: base.a.companyId,
        superAdminCanImport: false,
        user: manager.user,
        session: { lastOtpAt: new Date(fixture.now().getTime() - otpAgeMs) },
      }) as unknown as Ctx;
    const run = <T>(
      fn: (tx: Parameters<typeof createFields>[0]) => Promise<T>,
    ) => fixture.scoped(base.a, fn);
    await run((tx) =>
      createFields(
        tx,
        current(),
        [{ key: "unit", label: "Unit", type: "dropdown", options: start }],
        { at: fixture.now(), ip: null },
      ),
    );
    const unit = async () => {
      const [row] = await run((tx) =>
        tx.select().from(fields).where(eq(fields.key, "unit")),
      );
      return row;
    };
    const extend = (
      input: { fieldKey: string; options: Option[] }[],
      otpAgeMs = 0,
    ) =>
      run((tx) =>
        extendFieldOptions(tx, current(otpAgeMs), input, {
          at: fixture.now(),
          ip: null,
        }),
      );
    return { ...base, current, run, unit, extend };
  }
  const updates = () =>
    fixture.rows<{ target_id: string }>(
      sql`select target_id from audit_log where action = 'settings.field_updated'`,
    );

  it("appends only new codes and keeps the labels already saved", async () => {
    const { unit, extend } = await setup();
    await extend([
      {
        fieldKey: "unit",
        options: [
          { value: "c1", label: "Changed label" },
          { value: "d0", label: "D 0" },
        ],
      },
    ]);
    const row = await unit();
    expect(row.options).toEqual([...options(2), { value: "d0", label: "D 0" }]);
    expect(await updates()).toEqual([{ target_id: row.id }]);
  });

  it("writes nothing when every code is already there", async () => {
    const { unit, extend } = await setup();
    await extend([
      { fieldKey: "unit", options: [{ value: "c0", label: "Other label" }] },
    ]);
    expect((await unit()).options).toEqual(options(2));
    expect(await updates()).toEqual([]);
  });

  it("allows 200 answers and refuses the 201st", async () => {
    const { unit, extend } = await setup(options(199));
    await extend([{ fieldKey: "unit", options: options(1, "d") }]);
    expect((await unit()).options).toHaveLength(200);
    await expect(
      extend([{ fieldKey: "unit", options: options(1, "e") }]),
    ).rejects.toMatchObject({ code: "validation" });
    expect((await unit()).options).toHaveLength(200);
  });

  it("refuses a field that was archived or stopped being a dropdown", async () => {
    const { run, unit, extend } = await setup();
    const add = [{ fieldKey: "unit", options: options(1, "d") }];
    await run((tx) =>
      tx
        .update(fields)
        .set({ type: "text", options: null })
        .where(eq(fields.key, "unit")),
    );
    await expect(extend(add)).rejects.toMatchObject({ code: "conflict" });
    await run((tx) =>
      tx
        .update(fields)
        .set({
          type: "dropdown",
          options: options(2),
          archivedAt: fixture.now(),
        })
        .where(eq(fields.key, "unit")),
    );
    await expect(extend(add)).rejects.toMatchObject({ code: "conflict" });
    await expect(
      extend([{ fieldKey: "missing", options: options(1) }]),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await unit()).options).toEqual(options(2));
  });

  it("needs a fresh code and keeps neither new fields nor answers without it", async () => {
    const { run, current, unit } = await setup();
    const both = (otpAgeMs: number) =>
      run(async (tx) => {
        const meta = { at: fixture.now(), ip: null };
        await createFields(
          tx,
          current(otpAgeMs),
          [{ key: "budget", label: "Budget", type: "number" }],
          meta,
        );
        await extendFieldOptions(
          tx,
          current(otpAgeMs),
          [{ fieldKey: "unit", options: options(1, "d") }],
          meta,
        );
      });
    await expect(both(15 * 60_000 + 1)).rejects.toMatchObject({
      code: "step_up_required",
    });
    const keys = async () =>
      (await run((tx) => tx.select({ key: fields.key }).from(fields)))
        .map((row) => row.key)
        .sort();
    expect(await keys()).not.toContain("budget");
    expect((await unit()).options).toEqual(options(2));
    await both(15 * 60_000);
    expect(await keys()).toContain("budget");
    expect((await unit()).options).toHaveLength(3);
  });

  it("rolls back the new answers when their audit cannot be written", async () => {
    const { unit, extend } = await setup();
    await fixture.owner("REVOKE INSERT ON audit_log FROM anar_app");
    try {
      await expect(
        extend([{ fieldKey: "unit", options: options(1, "d") }]),
      ).rejects.toThrow();
    } finally {
      await fixture.owner("GRANT INSERT ON audit_log TO anar_app");
    }
    expect((await unit()).options).toEqual(options(2));
  });
});
