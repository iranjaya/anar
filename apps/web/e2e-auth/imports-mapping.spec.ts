import { expect, newPage, test } from "./fixture";
import { appAlert, csvFixture, expectFits, openImport } from "./imports";

const question = "when_are_you_planning_to_purchase?_";

test("staff match columns, edit new fields and keep them across reload and a clash", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const { page } = await openImport(
    browser,
    baseURL,
    mailbox,
    testInfo,
    "mapping",
  );
  await page
    .getByLabel("Meta CSV file")
    .setInputFiles(csvFixture("meta-utf16le-tab.csv"));
  await page.getByRole("link", { name: "Match columns" }).click();
  await expect(page).toHaveURL(/\/imports\/[0-9a-f-]{36}\/map$/);
  await expect(
    page.getByRole("heading", { name: "Match columns", level: 1 }),
  ).toBeVisible();
  const mapUrl = page.url();

  await expect(page.getByLabel("Map phone", { exact: true })).toHaveValue(
    "system:phone",
  );
  await expect(page.getByLabel("Map platform", { exact: true })).toHaveValue(
    "system:source",
  );
  await expect(page.getByLabel("Map ad_id", { exact: true })).toHaveValue(
    "skip",
  );
  await expect(page.getByLabel(`Map ${question}`, { exact: true })).toHaveValue(
    "new",
  );
  await expect(
    page
      .getByLabel("Map phone", { exact: true })
      .getByRole("option", { name: "Form name" }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Save columns" })).toHaveCount(
    1,
  );
  await expect(page.getByRole("button", { name: "Check 4 rows" })).toHaveCount(
    1,
  );

  await page.locator(`[id="field-label-${question}"]`).fill("Buying when");
  await page.getByLabel("Label for within_1_month").fill("Within a month");
  await page.locator("#field-key-job_title").fill("Job title");
  await expect(
    page.getByText("Give each new field a valid key and label."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save columns" }),
  ).toBeDisabled();
  await page.locator("#field-key-job_title").fill("job_title");
  await page.getByLabel("Save this mapping for next time").check();
  await page.getByRole("button", { name: "Save columns" }).click();
  await expect(page.getByText("Columns saved.")).toBeVisible();
  await expectFits(page, testInfo, "import-mapping-saved");

  await page.reload();
  await expect(page.locator(`[id="field-label-${question}"]`)).toHaveValue(
    "Buying when",
  );
  await expect(page.getByLabel("Label for within_1_month")).toHaveValue(
    "Within a month",
  );
  await expect(
    page.getByLabel("Save this mapping for next time"),
  ).toBeChecked();

  const other = await newPage(browser, baseURL, testInfo);
  await other.context().addCookies(await page.context().cookies());
  await other.goto(mapUrl);
  await other.getByLabel("Label for within_1_month").fill("Inside a month");
  await other.getByRole("button", { name: "Save columns" }).click();
  await expect(other.getByText("Columns saved.")).toBeVisible();

  await page.getByLabel("Label for within_1_month").fill("Within 30 days");
  await page.getByRole("button", { name: "Save columns" }).click();
  await expect(appAlert(page)).toHaveText(
    "These columns were changed in another tab. Reload to see the latest",
  );
  await expect(page.getByLabel("Label for within_1_month")).toHaveValue(
    "Within 30 days",
  );
  await expectFits(page, testInfo, "import-mapping-clash");

  await page.reload();
  await expect(page.getByLabel("Label for within_1_month")).toHaveValue(
    "Inside a month",
  );
});
