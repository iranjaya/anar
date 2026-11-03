import { writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, staffEmail, test } from "./fixture";
import {
  appAlert,
  csvFixture,
  database,
  expectFits,
  openImport,
  readDatabase,
} from "./imports";

const batchOf = (page: Page) => page.url().split("/imports/")[1].split("/")[0];

test("new fields ask for a fresh code, keep the choices, then start one import", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const { page, slug } = await openImport(
    browser,
    baseURL,
    mailbox,
    testInfo,
    "commit-code",
  );
  await page
    .getByLabel("Meta CSV file")
    .setInputFiles(csvFixture("meta-utf16le-tab.csv"));
  await page.getByRole("link", { name: "Match columns" }).click();
  await page.getByLabel("Label for within_1_month").fill("Within a month");
  await page.getByRole("button", { name: "Check 4 rows" }).click();
  await expect(page).toHaveURL(/\/map\?step=check$/);
  const batchId = batchOf(page);
  await expect(
    page.getByText(
      "This import adds company fields or answers, so it asks for a fresh code.",
    ),
  ).toBeVisible();
  const importButton = page.getByRole("button", { name: /^Import \d+ leads$/ });
  await expect(importButton).toBeEnabled();

  await database(
    stack,
    "UPDATE sessions SET last_otp_at = now() - interval '20 minutes';",
  );
  await importButton.click();
  await expect(appAlert(page)).toContainText("fresh code");
  await expect(page).toHaveURL(/\/map\?step=check$/);
  expect(
    await readDatabase(
      stack,
      `SELECT count(*) FROM import_runs WHERE batch_id = '${batchId}'`,
    ),
  ).toBe("0");
  await expectFits(page, testInfo, "import-commit-fresh-code");

  const before = await mailbox.ids();
  await page.getByRole("button", { name: "Send fresh code" }).click();
  await expect(
    page.getByText("Code requested. Check your email."),
  ).toBeVisible();
  await page
    .getByLabel("Six-digit code")
    .fill(await mailbox.code(staffEmail, before));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(
    page.getByText("Code verified. Retry your action."),
  ).toBeVisible();

  await importButton.dblclick();
  await expect(page).toHaveURL(new RegExp(`/imports/${batchId}$`));
  expect(
    await readDatabase(
      stack,
      `SELECT count(*) || ' ' || bool_and(job_id IS NOT NULL) FROM import_runs WHERE batch_id = '${batchId}'`,
    ),
  ).toBe("1 true");
  expect(
    await readDatabase(
      stack,
      `SELECT count(*) FROM fields f JOIN companies c ON c.id = f.company_id, jsonb_array_elements(f.options) AS o
      WHERE c.slug = '${slug}' AND o->>'label' = 'Within a month'`,
    ),
  ).toBe("1");
  await expect
    .poll(
      () =>
        readDatabase(
          stack,
          `SELECT status FROM import_batches WHERE id = '${batchId}'`,
        ),
      { timeout: 30000 },
    )
    .toBe("done");
});

test("an import with no settings change needs no fresh code, and sending it again gets the same job", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const { page, slug } = await openImport(
    browser,
    baseURL,
    mailbox,
    testInfo,
    "commit-plain",
  );
  const plain = testInfo.outputPath("plain.csv");
  await writeFile(
    plain,
    [
      "full_name,phone,created_time,campaign_name",
      "Asha,+9779841000101,2026-09-12T10:11:12+05:45,Spring",
      "Bina,+9779841000102,2026-09-12T10:11:12+05:45,Spring",
      "Bina again,+9779841000102,2026-09-12T10:11:12+05:45,Spring",
      "",
    ].join("\n"),
  );
  await page.getByLabel("Meta CSV file").setInputFiles(plain);
  await page.getByRole("link", { name: "Match columns" }).click();
  await page.getByRole("button", { name: "Check 3 rows" }).click();
  await expect(
    page.getByRole("heading", { name: "0 already in, 2 new" }),
  ).toBeVisible();
  const batchId = batchOf(page);
  await expect(page.getByText(/asks for a fresh code/)).toHaveCount(0);
  await database(
    stack,
    "UPDATE sessions SET last_otp_at = now() - interval '20 minutes';",
  );
  await expectFits(page, testInfo, "import-commit-check");
  await page.getByRole("button", { name: "Import 2 leads" }).click();
  await expect(page).toHaveURL(new RegExp(`/imports/${batchId}$`));
  const jobId = await readDatabase(
    stack,
    `SELECT job_id FROM import_runs WHERE batch_id = '${batchId}'`,
  );

  const resent = JSON.parse(
    await readDatabase(
      stack,
      `SELECT json_build_object('batchId', id, 'mapping', draft->'mapping', 'newFields', draft->'newFields',
        'expectedRevision', preview_revision, 'previewRevision', preview_revision)
      FROM import_batches WHERE id = '${batchId}'`,
    ),
  );
  const response = await page.request.post(
    `/api/companies/${slug}/imports/commitImport`,
    { data: resent, headers: { origin: baseURL } },
  );
  expect(await response.json()).toEqual({ ok: true, data: { jobId } });
  expect(
    await readDatabase(
      stack,
      `SELECT string_agg(job_id::text, ',') FROM import_runs WHERE batch_id = '${batchId}'`,
    ),
  ).toBe(jobId);
  await expect
    .poll(
      () =>
        readDatabase(
          stack,
          `SELECT status || ' ' || last_row_no FROM import_batches WHERE id = '${batchId}'`,
        ),
      { timeout: 30000 },
    )
    .toBe("done 3");
  expect(
    await readDatabase(
      stack,
      `SELECT count(*) FROM leads WHERE import_batch_id = '${batchId}'`,
    ),
  ).toBe("2");
});
