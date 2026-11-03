import { writeFile } from "node:fs/promises";
import { expect, test } from "./fixture";
import {
  database,
  expectFits,
  openImport,
  readDatabase,
  worker,
} from "./imports";

const rows = 20000;
const phone = (n: number) => `+9779841${String(n).padStart(6, "0")}`;

test("a killed import resumes after reload with no repeated rows, leads or notices", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  test.setTimeout(180000);
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const { page } = await openImport(
    browser,
    baseURL,
    mailbox,
    testInfo,
    "resume",
  );
  // Every tenth phone needs review, except row 600, which repeats row 3 across the first chunk edge.
  const lines = Array.from({ length: rows }, (_, index) => {
    const n = index + 1;
    if (n === 600) return `Lead ${n},${phone(3)}`;
    return `Lead ${n},${n % 10 === 0 ? `1${n}` : phone(n)}`;
  });
  const file = testInfo.outputPath("resume.csv");
  await writeFile(file, ["full_name,phone", ...lines, ""].join("\n"));
  await page.getByLabel("Meta CSV file").setInputFiles(file);
  await page.getByRole("link", { name: "Match columns" }).click();
  await page.getByRole("button", { name: `Check ${rows} rows` }).click();
  await expect(page).toHaveURL(/\/map\?step=check$/);
  const batchId = page.url().split("/imports/")[1].split("/")[0];
  const progress = () =>
    readDatabase(
      stack,
      `SELECT last_row_no FROM import_batches WHERE id = '${batchId}'`,
    ).then(Number);

  await page.getByRole("button", { name: /^Import \d+ leads$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/imports/${batchId}$`));
  try {
    await expect
      .poll(progress, { intervals: [100], timeout: 60000 })
      .toBeGreaterThanOrEqual(500);
    await worker(stack, "kill");
    const savedRow = await progress();
    expect(savedRow).toBeLessThan(rows);
    await database(
      stack,
      `UPDATE pgboss.job SET state = 'failed' WHERE id = (SELECT job_id FROM import_runs WHERE batch_id = '${batchId}')`,
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: `Import stopped at row ${savedRow}` }),
    ).toBeVisible();
    const resume = page.getByRole("button", {
      name: `Resume from row ${savedRow + 1}`,
    });
    await expect(resume).toBeVisible();
    await expectFits(page, testInfo, "import-resume-stopped");
    await worker(stack, "start");
    await resume.click();
    await expect(
      page.getByRole("heading", { name: "Import complete", level: 1 }),
    ).toBeVisible({ timeout: 90000 });
  } finally {
    await worker(stack, "start");
  }
  await expect(
    page.getByRole("heading", { name: `${rows - 1} added` }),
  ).toBeVisible();
  await expectFits(page, testInfo, "import-resume-done");
  expect(
    await readDatabase(
      stack,
      `SELECT count(*) || ' ' || count(DISTINCT row_no) || ' ' ||
        count(*) FILTER (WHERE result = 'duplicate_file') || ' ' ||
        count(*) FILTER (WHERE reason = 'invalid_phone')
      FROM import_rows WHERE batch_id = '${batchId}'`,
    ),
  ).toBe(`${rows} ${rows} 1 ${rows / 10 - 1}`);
  expect(
    await readDatabase(
      stack,
      `SELECT (SELECT count(*) FROM leads WHERE import_batch_id = '${batchId}') || ' ' ||
        (SELECT count(*) FROM lead_events WHERE data->>'batchId' = '${batchId}') || ' ' ||
        (SELECT count(*) FROM notifications WHERE data->>'batchId' = '${batchId}') || ' ' ||
        (SELECT string_agg(run_no || ':' || state, ',' ORDER BY run_no) FROM import_runs WHERE batch_id = '${batchId}')`,
    ),
  ).toBe(`${rows - 1} ${rows - 1} 1 1:stopped,2:done`);
});
