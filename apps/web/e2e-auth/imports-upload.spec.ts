import { writeFile } from "node:fs/promises";
import { expect, test } from "./fixture";
import { appAlert, csvFixture, expectFits, openImport } from "./imports";

test("staff upload a real file, retry after an error and reopen the result", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const { page, slug, title } = await openImport(
    browser,
    baseURL,
    mailbox,
    testInfo,
    "upload",
  );
  const card = page.getByRole("region", { name: "Company and file" });
  await expect(card.getByText(title, { exact: true })).toBeVisible();
  await expect(
    card.getByRole("link", { name: "Change company" }),
  ).toHaveAttribute("href", "/agency/companies");
  await expect(card.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByText("Your file contents are not read")).toHaveCount(
    0,
  );

  const empty = testInfo.outputPath("empty.csv");
  await writeFile(empty, "");
  await page.getByLabel("Meta CSV file").setInputFiles(empty);
  await expect(appAlert(page)).toHaveText("The file has no header row");
  const retry = page.getByRole("button", { name: "Retry upload" });
  await expect(retry).toHaveCount(1);
  const resent = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes(`/api/imports?company=${slug}`),
  );
  await retry.click();
  await resent;
  await expect(appAlert(page)).toHaveText("The file has no header row");
  await expectFits(page, testInfo, "import-upload-error");

  await page
    .getByLabel("Meta CSV file")
    .setInputFiles(csvFixture("meta-utf16le-tab.csv"));
  const details = page.getByRole("region", { name: "What the file holds" });
  await expect(details.getByText("meta-utf16le-tab.csv")).toBeVisible();
  await expect(details.getByText("4 rows · 17 columns")).toBeVisible();
  await expect(details.getByText("UTF-16 LE · Tab separated")).toBeVisible();
  await expect(details.getByText(/^Lead dates: /)).toBeVisible();
  await expect(appAlert(page)).toHaveCount(0);
  await expect(
    details.getByRole("link", { name: "Match columns" }),
  ).toHaveAttribute("href", /\/imports\/[0-9a-f-]{36}\/map$/);
  await expect(page).toHaveURL(
    new RegExp(`/${slug}/imports/new\\?batch=[0-9a-f-]{36}$`),
  );
  await expectFits(page, testInfo, "import-upload-done");

  await page.reload();
  await expect(details.getByText("4 rows · 17 columns")).toBeVisible();
  await expect(details.getByText("UTF-16 LE · Tab separated")).toBeVisible();
  await expect(details.getByText("meta-utf16le-tab.csv")).toBeVisible();
  await expectFits(page, testInfo, "import-upload-reopened");
});

test("a file with no lead dates says so", async ({
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
    "nodates",
  );
  await page
    .getByLabel("Meta CSV file")
    .setInputFiles(csvFixture("quoted-utf8.csv"));
  const details = page.getByRole("region", { name: "What the file holds" });
  await expect(details.getByText("2 rows · 3 columns")).toBeVisible();
  await expect(details.getByText("UTF-8 · Comma separated")).toBeVisible();
  await expect(
    details.getByText("No lead dates found in this file."),
  ).toBeVisible();
  await expectFits(page, testInfo, "import-upload-no-dates");
});
