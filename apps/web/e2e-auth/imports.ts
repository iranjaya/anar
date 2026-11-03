import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Browser, Page, TestInfo } from "@playwright/test";
import {
  expect,
  type Mailbox,
  newPage,
  signIn,
  stackContainer,
  staffEmail,
} from "./fixture";

const run = promisify(execFile);

export async function database(
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

// Stops, kills or starts the stack's worker, so a test can hold or break an import.
export async function worker(
  stack: Parameters<typeof stackContainer>[0],
  action: "stop" | "kill" | "start",
) {
  await run("docker", [action, await stackContainer(stack, "worker")], {
    timeout: 60000,
  });
}

// One value back from the disposable stack's database, as text.
export async function readDatabase(
  stack: Parameters<typeof stackContainer>[0],
  query: string,
): Promise<string> {
  const { stdout } = await run(
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
      "-Atqc",
      query,
    ],
    { timeout: 30000 },
  );
  return stdout.trim();
}

export const csvFixture = (name: string) =>
  path.resolve(__dirname, "../../api/test/fixtures/csv", name);

export async function expectFits(page: Page, testInfo: TestInfo, name: string) {
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

// Staff create a company, enter it with a reason, and land on the file step.
export async function openImport(
  browser: Browser,
  baseURL: string,
  mailbox: Mailbox,
  testInfo: TestInfo,
  name: string,
) {
  const slug = `${name}-${testInfo.project.name}`;
  const title = `Import ${name} ${testInfo.project.name}`;
  const page = await newPage(browser, baseURL, testInfo);
  await signIn(page, mailbox, staffEmail);
  await page.goto("/agency/companies");
  await page.getByLabel("Company name", { exact: true }).fill(title);
  await page.getByLabel("Company slug").fill(slug);
  await page
    .getByRole("button", { name: "Create company", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Company created", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(`Reason for entering ${title}`)
    .fill("Uploading the client lead export");
  await page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .getByRole("button", { name: "Enter company", exact: true })
    .click();
  await expect(page).toHaveURL(`/${slug}`);
  await page.goto(`/${slug}/imports/new`);
  await expect(
    page.getByRole("heading", { name: "Import leads", level: 1 }),
  ).toBeVisible();
  return { page, slug, title };
}

// Next adds its own empty route announcer with role alert; this skips it.
export const appAlert = (page: Page) =>
  page.locator('[role="alert"]:not(#__next-route-announcer__)');
