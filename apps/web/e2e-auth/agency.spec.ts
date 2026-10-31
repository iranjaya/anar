import type { Browser, Page, TestInfo } from "@playwright/test";
import {
  expect,
  type Mailbox,
  newPage,
  signIn,
  staffEmail,
  test,
} from "./fixture";

const company = { name: "Browser Company", slug: "browser-company" };
const reason = "Checking the lead import for the client";

// Sign-in codes are limited to 3 per email in 10 minutes, so staff signs in once per stack.
let staff: Page | undefined;

async function staffPage(
  browser: Browser,
  baseURL: string,
  mailbox: Mailbox,
  testInfo: TestInfo,
) {
  if (!staff) {
    staff = await newPage(browser, baseURL, testInfo);
    await signIn(staff, mailbox, staffEmail);
  }
  await staff.goto("/agency/companies");
  return staff;
}

test.afterAll(async () => {
  await staff?.context().close();
  staff = undefined;
});

async function fits(page: Page, testInfo: TestInfo, name: string) {
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

function reasonField(page: Page, name: string) {
  return page.getByLabel(`Reason for entering ${name}`);
}

async function enter(page: Page, name: string, why = reason) {
  await reasonField(page, name).fill(why);
  await page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: "Enter company", exact: true })
    .click();
}

test("a short reason is refused and stays in the field", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const page = await staffPage(browser, String(baseURL), mailbox, testInfo);
  await enter(page, company.name, "abcd");
  await expect(
    page.getByRole("alert").filter({ hasText: /at least 5 characters/ }),
  ).toBeVisible();
  await expect(reasonField(page, company.name)).toHaveValue("abcd");
  await expect(page).toHaveURL(/\/agency\/companies$/);
  await fits(page, testInfo, "enter-short-reason");
});

test("staff enter with a reason, see the banner and leave", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const page = await staffPage(browser, String(baseURL), mailbox, testInfo);
  await enter(page, company.name);
  await expect(page).toHaveURL(`${baseURL}/${company.slug}`);
  const banner = page.getByRole("region", { name: "Agency staff access" });
  await expect(banner).toContainText(`Reason: ${reason}`);
  await expect(banner).toContainText(company.name);
  await expect(
    page.getByRole("heading", { name: "Welcome, Browser Staff" }),
  ).toBeVisible();
  await fits(page, testInfo, "entered");

  await banner.getByRole("button", { name: "Leave company" }).click();
  await expect(page).toHaveURL(`${baseURL}/agency/companies`);
  expect((await page.goto(`/${company.slug}`))?.status()).toBe(404);
});

test("entering a second company closes the first tab's access", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const page = await staffPage(browser, String(baseURL), mailbox, testInfo);
  const second = {
    name: `Second ${testInfo.project.name}`,
    slug: `second-${testInfo.project.name}`,
  };
  await page.getByLabel("Company name", { exact: true }).fill(second.name);
  await page.getByLabel("Company slug").fill(second.slug);
  await page
    .getByRole("button", { name: "Create company", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Company created", exact: true }),
  ).toBeVisible();

  await page.goto("/agency/companies");
  await enter(page, company.name);
  await expect(page).toHaveURL(`${baseURL}/${company.slug}`);

  const other = await page.context().newPage();
  await other.goto("/agency/companies");
  await enter(other, second.name);
  await expect(other).toHaveURL(`${baseURL}/${second.slug}`);
  await expect(
    other.getByRole("region", { name: "Agency staff access" }),
  ).toContainText(second.name);

  expect((await page.reload())?.status()).toBe(404);
  await other.getByRole("button", { name: "Leave company" }).click();
  await expect(other).toHaveURL(`${baseURL}/agency/companies`);
  await other.close();
});

test("the company manager sees the staff entry on the team page", async ({
  page,
  mailbox,
}, testInfo) => {
  await signIn(page, mailbox, "entries-manager@browser.example.test");
  await page.goto(`/${company.slug}/settings/team`);
  const entries = page.getByRole("region", { name: "Agency staff entries" });
  await expect(entries).toBeVisible();
  const entry = entries
    .getByRole("listitem")
    .filter({ hasText: "Browser Staff" })
    .first();
  await expect(entry).toContainText(reason);
  await fits(page, testInfo, "team-agency-entries");
});
