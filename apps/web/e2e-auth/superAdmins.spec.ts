import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Browser, Page, TestInfo } from "@playwright/test";
import { expect, type Mailbox, newPage, signIn, test } from "./fixture";

const staffEmail = "super-admin-staff@browser.example.test";

async function ageSessionCode(baseURL: string, email: string, minutes: number) {
  await promisify(execFile)(
    process.execPath,
    [
      path.resolve(__dirname, "../../../test/support/session-otp.ts"),
      baseURL,
      email,
      String(minutes),
    ],
    { timeout: 60000 },
  );
}

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

function details(testInfo: TestInfo, name: string) {
  const slug = `sa-${name}-${testInfo.project.name}`;
  return {
    company: `Company ${slug}`,
    slug,
    name: "Sales Manager",
    email: `manager-${slug}@browser.example.test`,
  };
}

async function createCompany(page: Page, values: ReturnType<typeof details>) {
  await page.goto("/agency/companies");
  await page.getByLabel("Company name", { exact: true }).fill(values.company);
  await page.getByLabel("Company slug").fill(values.slug);
  await page
    .getByRole("button", { name: "Create company", exact: true })
    .click();
  const created = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Company created", exact: true }),
  });
  await expect(created).toBeVisible();
  return created;
}

async function expectForm(
  form: ReturnType<Page["locator"]>,
  values: ReturnType<typeof details>,
) {
  await expect(form.getByLabel("Super Admin name")).toHaveValue(values.name);
  await expect(form.getByLabel("Super Admin email")).toHaveValue(values.email);
}

test("an old sign-in asks for a fresh code and the retry sends the invite email", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const values = details(testInfo, "fresh");
  const page = await staffPage(browser, String(baseURL), mailbox, testInfo);
  const created = await createCompany(page, values);
  await created.getByLabel("Super Admin name").fill(values.name);
  await created.getByLabel("Super Admin email").fill(values.email);
  await ageSessionCode(String(baseURL), staffEmail, 20);
  await created
    .getByRole("button", { name: "Invite Super Admin", exact: true })
    .click();
  await expect(
    created.getByText("Confirm with a fresh code", { exact: true }),
  ).toBeVisible();
  await expectForm(created, values);

  const codeMail = await mailbox.ids();
  await created.getByRole("button", { name: "Send fresh code" }).click();
  await expect(
    created.getByText("Code requested. Check your email."),
  ).toBeVisible();
  await created
    .getByLabel("Six-digit code")
    .fill(await mailbox.code(staffEmail, codeMail));
  await created.getByRole("button", { name: "Verify code" }).click();
  await expect(
    created.getByText("Code verified. Retry your action."),
  ).toBeVisible();
  await expectForm(created, values);
  await fits(page, testInfo, "super-admin-fresh-code");

  const inviteMail = await mailbox.ids();
  await created
    .getByRole("button", { name: "Invite Super Admin", exact: true })
    .click();
  await expect(
    created.getByRole("status").filter({ hasText: "Invitation queued." }),
  ).toBeVisible();
  await expect(mailbox.invite(values.email, inviteMail)).resolves.toMatch(
    /^#token=/,
  );
  await fits(page, testInfo, "super-admin-invited");
});

test("a failed invite keeps what the staff typed", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const values = details(testInfo, "taken");
  const page = await staffPage(browser, String(baseURL), mailbox, testInfo);
  const created = await createCompany(page, values);
  await created.getByLabel("Super Admin name").fill(values.name);
  await created.getByLabel("Super Admin email").fill(values.email);
  await created
    .getByRole("button", { name: "Invite Super Admin", exact: true })
    .click();
  await expect(
    created.getByRole("status").filter({ hasText: "Invitation queued." }),
  ).toBeVisible();

  const listed = page.locator("article").filter({
    has: page.getByRole("heading", { name: values.company, exact: true }),
  });
  await listed.getByLabel("Super Admin name").fill(values.name);
  await listed.getByLabel("Super Admin email").fill(values.email);
  await listed
    .getByRole("button", { name: "Invite Super Admin", exact: true })
    .click();
  await expect(
    listed.getByRole("alert").filter({ hasText: /already pending/i }),
  ).toBeVisible();
  await expectForm(listed, values);
  await fits(page, testInfo, "super-admin-invite-failed");
});

test("the invited Super Admin accepts and lands on the company", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const values = details(testInfo, "accept");
  const page = await staffPage(browser, String(baseURL), mailbox, testInfo);
  const created = await createCompany(page, values);
  await created.getByLabel("Super Admin name").fill(values.name);
  await created.getByLabel("Super Admin email").fill(values.email);
  const before = await mailbox.ids();
  await created
    .getByRole("button", { name: "Invite Super Admin", exact: true })
    .click();
  const link = await mailbox.invite(values.email, before);

  const admin = await newPage(browser, String(baseURL), testInfo);
  await admin.goto(`/invite${link}`);
  await expect(admin.getByText(values.company, { exact: true })).toBeVisible();
  await admin.getByLabel("Your name").fill(values.name);
  await admin
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await expect(
    admin.getByText("Invitation accepted. Sign in with your invited email."),
  ).toBeVisible();
  await signIn(admin, mailbox, values.email);
  await expect(admin).toHaveURL(`${baseURL}/${values.slug}`);
  await expect(
    admin.getByRole("heading", { name: `Welcome, ${values.name}` }),
  ).toBeVisible();
  await fits(admin, testInfo, "super-admin-company-home");
  await admin.context().close();
});
