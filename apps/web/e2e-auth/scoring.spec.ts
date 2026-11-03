import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Page, TestInfo } from "@playwright/test";
import {
  expect,
  newPage,
  signIn,
  stackContainer,
  staffEmail,
  test,
} from "./fixture";

const run = promisify(execFile);

async function database(
  stack: Parameters<typeof stackContainer>[0],
  query: string,
) {
  await run(
    "docker",
    [
      "exec",
      await stackContainer(stack, "db"),
      "psql",
      "-U",
      "postgres",
      "-d",
      "anar",
      "-v",
      "ON_ERROR_STOP=1",
      "-qc",
      query,
    ],
    { timeout: 30000 },
  );
}

async function enterNewCompany(page: Page, name: string, slug: string) {
  await page.goto("/agency/companies");
  await page.getByLabel("Company name", { exact: true }).fill(name);
  await page.getByLabel("Company slug").fill(slug);
  await page
    .getByRole("button", { name: "Create company", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Company created", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(`Reason for entering ${name}`)
    .fill("Checking the scoring setup");
  await page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: "Enter company", exact: true })
    .click();
  await expect(page).toHaveURL(`/${slug}`);
}

async function expectFits(page: Page, testInfo: TestInfo, name: string) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
  });
}

test("a new company shows its scoring defaults read-only", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const slug = `scoring-${testInfo.project.name}`;
  const page = await newPage(browser, baseURL, testInfo);
  await signIn(page, mailbox, staffEmail);
  await enterNewCompany(page, `Scoring ${testInfo.project.name}`, slug);

  const settings = page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Settings", exact: true });
  await expect(settings).toHaveCount(1);
  await expect(settings).toHaveAttribute("href", `/${slug}/settings`);

  await page.goto(`/${slug}/settings/scoring`);
  await expect(
    page.getByRole("heading", { name: "Lead scoring" }),
  ).toBeVisible();
  const totals = page.locator("dl").first();
  for (const [label, value] of [
    ["Base", "1"],
    ["Warm from", "5"],
    ["Hot from", "8"],
  ]) {
    await expect(
      totals.locator("div").filter({ hasText: label }).locator("dd"),
    ).toHaveText(value);
  }
  const timeline = page.getByRole("region", { name: "Purchase timeline" });
  const under15 = timeline
    .getByRole("listitem")
    .filter({ hasText: "Under 15 days" });
  await expect(under15).toHaveCount(1);
  await expect(under15).toContainText("Code <15 days");
  await expect(under15).toContainText("4 pts");
  await expect(timeline.getByRole("listitem")).toHaveCount(8);
  await expect(
    page.getByRole("region", { name: "Budget fit" }).getByRole("listitem"),
  ).toHaveCount(2);
  await expect(page.getByRole("button", { name: /save/i })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expectFits(page, testInfo, "scoring-defaults");

  await database(stack, "REVOKE SELECT ON scoring_configs FROM anar_app;");
  try {
    await page.reload();
    await expect(
      page.getByRole("alert").filter({ hasText: "Try again" }),
    ).toBeVisible();
    await expect(page.getByText("Hot from")).toHaveCount(0);
  } finally {
    await database(stack, "GRANT SELECT ON scoring_configs TO anar_app;");
  }
  await page.context().close();
});
