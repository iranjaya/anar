import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Browser, Page, TestInfo } from "@playwright/test";
import {
  expect,
  type Mailbox,
  newPage,
  signIn,
  staffEmail,
  test,
} from "./fixture";

const ownerEmail = "owner@browser.example.test";

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

// Sign-in codes are limited to 3 per email in 10 minutes, so the owner signs in once per stack.
let owner: Page | undefined;

async function ownerPage(
  browser: Browser,
  baseURL: string,
  mailbox: Mailbox,
  testInfo: TestInfo,
) {
  if (!owner) {
    owner = await newPage(browser, baseURL, testInfo);
    await signIn(owner, mailbox, ownerEmail);
  }
  await owner.goto("/owner/agencies");
  await expect(owner.getByRole("heading", { name: "Agencies" })).toBeVisible();
  return owner;
}

test.afterAll(async () => {
  await owner?.context().close();
  owner = undefined;
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

function agency(testInfo: TestInfo, name: string) {
  const slug = `${name}-${testInfo.project.name}`;
  return {
    name: `Agency ${slug}`,
    slug,
    staffName: "First Staff",
    email: `first-${slug}@browser.example.test`,
  };
}

async function fill(page: Page, values: ReturnType<typeof agency>) {
  await page.getByLabel("Agency name", { exact: true }).fill(values.name);
  await page.getByLabel("Agency slug").fill(values.slug);
  await page.getByLabel("First staff name").fill(values.staffName);
  await page.getByLabel("First staff email").fill(values.email);
}

async function expectForm(page: Page, values: ReturnType<typeof agency>) {
  await expect(page.getByLabel("Agency name", { exact: true })).toHaveValue(
    values.name,
  );
  await expect(page.getByLabel("Agency slug")).toHaveValue(values.slug);
  await expect(page.getByLabel("First staff name")).toHaveValue(
    values.staffName,
  );
  await expect(page.getByLabel("First staff email")).toHaveValue(values.email);
}

function card(page: Page, name: string) {
  return page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
}

test("owner creates an agency and it stays pending with the first invite sent", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const values = agency(testInfo, "pending");
  const page = await ownerPage(browser, String(baseURL), mailbox, testInfo);
  await fill(page, values);
  const before = await mailbox.ids();
  await page.getByRole("button", { name: "Create and invite" }).click();
  await expect(
    page.getByText("Agency created. First staff invitation queued."),
  ).toBeVisible();
  await expect(page.getByLabel("Agency slug")).toHaveValue("");
  const created = card(page, values.name);
  await expect(created.getByText("pending", { exact: true })).toBeVisible();
  await expect(
    created.getByRole("button", { name: "Resend first invite" }),
  ).toBeVisible();
  await expect(mailbox.invite(values.email, before)).resolves.toMatch(
    /^#token=/,
  );
  await fits(page, testInfo, "owner-agency-pending");
});

test("resending the first invite stops the old link", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const values = agency(testInfo, "resend");
  const page = await ownerPage(browser, String(baseURL), mailbox, testInfo);
  await fill(page, values);
  const first = await mailbox.ids();
  await page.getByRole("button", { name: "Create and invite" }).click();
  const oldLink = await mailbox.invite(values.email, first);
  const created = card(page, values.name);
  const second = await mailbox.ids();
  await created.getByRole("button", { name: "Resend first invite" }).click();
  await expect(
    created.getByRole("status").filter({ hasText: "Invitation queued." }),
  ).toBeVisible();
  const newLink = await mailbox.invite(values.email, second);
  expect(newLink).not.toBe(oldLink);
  await fits(page, testInfo, "owner-agency-resent");

  const staff = await newPage(browser, String(baseURL), testInfo);
  await staff.goto(`/invite${oldLink}`);
  await expect(
    staff.getByRole("alert").filter({ hasText: /unavailable/i }),
  ).toBeVisible();
  await staff.goto("/login");
  await staff.goto(`/invite${newLink}`);
  await expect(staff.getByText(`Invited email: ${values.email}`)).toBeVisible();
  await staff.context().close();
});

test("agency turns active and loses resend once the first staff accepts", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const values = agency(testInfo, "active");
  const page = await ownerPage(browser, String(baseURL), mailbox, testInfo);
  await fill(page, values);
  const before = await mailbox.ids();
  await page.getByRole("button", { name: "Create and invite" }).click();
  const link = await mailbox.invite(values.email, before);

  const staff = await newPage(browser, String(baseURL), testInfo);
  await staff.goto(`/invite${link}`);
  await staff.getByLabel("Your name").fill(values.staffName);
  await staff
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await expect(
    staff.getByText("Invitation accepted. Sign in with your invited email."),
  ).toBeVisible();
  await staff.context().close();

  await page.reload();
  const accepted = card(page, values.name);
  await expect(accepted.getByText("active", { exact: true })).toBeVisible();
  await expect(
    accepted.getByRole("button", { name: "Resend first invite" }),
  ).toHaveCount(0);
  await fits(page, testInfo, "owner-agency-active");
});

test("a taken slug fails and keeps what the owner typed", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const values = { ...agency(testInfo, "taken"), slug: "browser-agency" };
  const page = await ownerPage(browser, String(baseURL), mailbox, testInfo);
  await fill(page, values);
  await page.getByRole("button", { name: "Create and invite" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /slug is unavailable/i }),
  ).toBeVisible();
  await expectForm(page, values);
  await expect(card(page, values.name)).toHaveCount(0);
  await fits(page, testInfo, "owner-agency-taken-slug");
});

test("an old sign-in asks for a fresh code and the retry keeps the form", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const values = agency(testInfo, "fresh");
  const page = await ownerPage(browser, String(baseURL), mailbox, testInfo);
  await fill(page, values);
  await ageSessionCode(String(baseURL), ownerEmail, 20);
  await page.getByRole("button", { name: "Create and invite" }).click();
  await expect(
    page.getByText("Confirm with a fresh code", { exact: true }),
  ).toBeVisible();
  await expectForm(page, values);

  const before = await mailbox.ids();
  await page.getByRole("button", { name: "Send fresh code" }).click();
  await expect(
    page.getByText("Code requested. Check your email."),
  ).toBeVisible();
  await page
    .getByLabel("Six-digit code")
    .fill(await mailbox.code(ownerEmail, before));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(
    page.getByText("Code verified. Retry your action."),
  ).toBeVisible();
  await fits(page, testInfo, "owner-agency-fresh-code");
  await expectForm(page, values);

  await page.getByRole("button", { name: "Create and invite" }).click();
  await expect(
    page.getByText("Agency created. First staff invitation queued."),
  ).toBeVisible();
  await expect(
    card(page, values.name).getByText("pending", { exact: true }),
  ).toBeVisible();
});

test("agency staff cannot load the agency list", async ({
  page,
  mailbox,
}, testInfo) => {
  await signIn(page, mailbox, staffEmail);
  await page.goto("/owner/agencies");
  await expect(
    page.getByRole("alert").filter({ hasText: "Owner access is required" }),
  ).toBeVisible();
  await expect(page.locator("article")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Browser Agency", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/agencies/listAgencies")).status()).toBe(
    403,
  );
  await fits(page, testInfo, "staff-agency-list-denied");
});

test("agency staff remove a colleague, who is signed out, and cannot remove the last staff", async ({
  page,
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const leaver = await newPage(browser, String(baseURL), testInfo);
  const staffCard = (name: string) =>
    page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  try {
    await signIn(leaver, mailbox, "leaver@browser.example.test");
    await signIn(page, mailbox, "remover@browser.example.test");
    await page.goto("/agency/staff");
    const colleague = staffCard("Leaver Staff");
    await expect(colleague.getByText("active", { exact: true })).toBeVisible();
    await colleague.getByRole("button", { name: "Remove from agency" }).click();
    await expect(
      colleague.getByText(
        "Leaver Staff will be signed out everywhere and their pending invitations stop working.",
      ),
    ).toBeVisible();
    await fits(page, testInfo, "agency-staff-remove-confirm");
    await colleague.getByRole("button", { name: "Yes, remove" }).click();
    await expect(
      colleague.getByText("deactivated", { exact: true }),
    ).toBeVisible();
    await expect(
      colleague.getByRole("button", { name: "Remove from agency" }),
    ).toHaveCount(0);

    expect((await leaver.request.get("/api/agencies/getAgency")).status()).toBe(
      401,
    );
    expect(
      (
        await leaver.request.post("/api/auth/refresh", {
          headers: { origin: String(baseURL) },
          data: {},
        })
      ).status(),
    ).toBe(401);
    await leaver.goto("/");
    await expect(leaver).toHaveURL(/\/login$/);

    const self = staffCard("Remover Staff");
    await self.getByRole("button", { name: "Leave agency" }).click();
    await self.getByRole("button", { name: "Yes, leave" }).click();
    await expect(
      self
        .getByRole("alert")
        .filter({ hasText: "The last active staff member cannot be removed" }),
    ).toBeVisible();
    await page.reload();
    await expect(self.getByText("active", { exact: true })).toBeVisible();
    await fits(page, testInfo, "agency-staff-last-refused");
  } finally {
    await leaver.context().close();
  }
});

test("agency pages send you to sign in once the session is gone", async ({
  page,
  baseURL,
  mailbox,
}, testInfo) => {
  await signIn(page, mailbox, "remover@browser.example.test");
  await page.goto("/agency/staff");
  await expect(
    page.getByRole("heading", { name: "Agency staff", exact: true }),
  ).toBeVisible();
  // A refresh started by the page can still set the cookie again, so end the session on the server too.
  expect(
    (
      await page.request.post("/api/auth/logout", {
        data: {},
        headers: { origin: String(baseURL) },
      })
    ).status(),
  ).toBe(200);
  await page.context().clearCookies();
  for (const path of [
    "/agency",
    "/agency/staff",
    "/agency/invites",
    "/agency/companies",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(`${baseURL}/login`);
  }
  await fits(page, testInfo, "agency-session-gone");
});

test("the owner cannot enter a company", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const page = await ownerPage(browser, String(baseURL), mailbox, testInfo);
  const response = await page.request.post("/api/companies/enterCompany", {
    data: {
      companyId: "40000000-0000-4000-8000-000000000001",
      reason: "Checking the lead import for the client",
    },
    headers: { origin: String(baseURL) },
  });
  expect(response.status()).toBe(403);
  expect((await page.goto("/browser-company"))?.status()).toBe(404);
});

test("the owner signs out from the agencies page", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const page = await ownerPage(browser, String(baseURL), mailbox, testInfo);
  await fits(page, testInfo, "owner-sign-out");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${baseURL}/login`);
  expect((await page.request.get("/api/auth/getSession")).status()).toBe(401);
  await page.context().close();
  owner = undefined;
});
