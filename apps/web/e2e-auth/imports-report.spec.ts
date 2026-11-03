import { writeFile } from "node:fs/promises";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixture";
import {
  appAlert,
  database,
  expectFits,
  openImport,
  readDatabase,
  worker,
} from "./imports";

async function commitFile(page: Page, testInfo: TestInfo, lines: string[]) {
  const file = testInfo.outputPath(`rows-${lines.length}.csv`);
  await writeFile(file, ["full_name,phone", ...lines, ""].join("\n"));
  await page.getByLabel("Meta CSV file").setInputFiles(file);
  await page.getByRole("link", { name: "Match columns" }).click();
  await page
    .getByRole("button", { name: `Check ${lines.length} rows` })
    .click();
  await expect(page).toHaveURL(/\/map\?step=check$/);
  const batchId = page.url().split("/imports/")[1].split("/")[0];
  await page.getByRole("button", { name: /^Import \d+ leads$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/imports/${batchId}$`));
  return batchId;
}

test("a held import shows waiting, updates itself when done, and pages every row", async ({
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
    "report-live",
  );
  await worker(stack, "stop");
  try {
    const batchId = await commitFile(
      page,
      testInfo,
      Array.from({ length: 60 }, (_, n) => `Lead ${n},1${n}`),
    );
    await expect(
      page.getByRole("heading", { name: "Import in progress", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Waiting to start" }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText("0 of 60 rows saved.")).toBeVisible();
    await expectFits(page, testInfo, "import-report-waiting");
    await page.goto(`/${slug}/imports/${batchId}/map`);
    await expect(page).toHaveURL(new RegExp(`/imports/${batchId}$`));
    await worker(stack, "start");
    await expect(
      page.getByRole("heading", { name: "Import complete", level: 1 }),
    ).toBeVisible({ timeout: 60000 });
  } finally {
    await worker(stack, "start");
  }
  const summary = page.getByRole("region", { name: "Import result summary" });
  await expect(
    summary.getByRole("heading", { name: "60 added" }),
  ).toBeVisible();
  const list = page.getByRole("region", { name: "Needs a look: 60 rows" });
  await expect(list.getByText("Row 50", { exact: true })).toBeVisible();
  await expect(list.getByText("Row 51", { exact: true })).toHaveCount(0);
  await expectFits(page, testInfo, "import-report-done");
  await page.getByRole("link", { name: "Next 50 rows" }).click();
  await expect(
    page
      .getByRole("region", { name: "Needs a look: 60 rows" })
      .getByText("Row 51", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Next 50 rows" })).toHaveCount(0);
  await page.getByRole("link", { name: "All rows" }).click();
  await expect(
    page.getByRole("region", { name: "All rows: 60 rows" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Open lead/ })).toHaveCount(0);
});

test("a dead job shows where the import stopped and why, after a reload", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const { page } = await openImport(
    browser,
    baseURL,
    mailbox,
    testInfo,
    "report-dead",
  );
  await worker(stack, "stop");
  try {
    const batchId = await commitFile(page, testInfo, [
      "Asha,+9779841000201",
      "Bina,+9779841000202",
    ]);
    await database(
      stack,
      `UPDATE pgboss.job SET state = 'failed' WHERE id = (SELECT job_id FROM import_runs WHERE batch_id = '${batchId}')`,
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Import stopped at row 0" }),
    ).toBeVisible();
    await expect(appAlert(page)).toContainText(
      "Processing stopped after repeated errors",
    );
    expect(
      await readDatabase(
        stack,
        `SELECT state FROM import_runs WHERE batch_id = '${batchId}'`,
      ),
    ).toBe("queued");
    await expectFits(page, testInfo, "import-report-stopped");
  } finally {
    await worker(stack, "start");
  }
});
