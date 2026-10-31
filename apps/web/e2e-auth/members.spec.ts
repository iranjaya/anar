import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Browser, Page, TestInfo } from "@playwright/test";
import { expect, staffEmail, test } from "./fixture";

const run = promisify(execFile);
const managerEmail = "manager@browser.example.test";
const slug = "browser-company";
const team = `/${slug}/settings/team`;

type Mailbox = {
  ids(): Promise<string[]>;
  code(email: string, before: string[]): Promise<string>;
  invite(email: string, before: string[]): Promise<string>;
};

async function ageSessionCode(baseURL: string, email: string, minutes: number) {
  await run(
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

async function database(baseURL: string, query: string) {
  const docker = async (...args: string[]) =>
    (await run("docker", args, { timeout: 30000 })).stdout.trim();
  const project = await docker(
    "ps",
    "--filter",
    `publish=${new URL(baseURL).port}`,
    "--format",
    '{{.Label "com.docker.compose.project"}}',
  );
  if (!/^anar-browser-[0-9a-f-]{36}$/.test(project))
    throw new Error("Expected the disposable browser stack");
  const db = await docker(
    "ps",
    "--quiet",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--filter",
    "label=com.docker.compose.service=db",
  );
  await docker(
    "exec",
    db,
    "psql",
    "-U",
    "postgres",
    "-d",
    "anar",
    "-v",
    "ON_ERROR_STOP=1",
    "-Atc",
    query,
  );
}

async function signIn(page: Page, mailbox: Mailbox, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  const before = await mailbox.ids();
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await expect(page).toHaveURL(/\/login\/code$/);
  await page
    .getByLabel("Six-digit code")
    .fill(await mailbox.code(email, before));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function newPage(browser: Browser, baseURL: string, testInfo: TestInfo) {
  const { viewport, isMobile, hasTouch } = testInfo.project.use;
  const context = await browser.newContext({
    baseURL,
    viewport,
    isMobile,
    hasTouch,
  });
  return context.newPage();
}

// Sign-in codes are limited to 3 per email in 10 minutes, so the Super Admin signs in once per stack.
let manager: Page | undefined;

async function managerPage(
  browser: Browser,
  baseURL: string,
  mailbox: Mailbox,
  testInfo: TestInfo,
) {
  if (!manager) {
    manager = await newPage(browser, baseURL, testInfo);
    await signIn(manager, mailbox, managerEmail);
  }
  await manager.goto(team);
  await expect(manager.getByRole("heading", { name: "Team" })).toBeVisible();
  return manager;
}

let staff: Page | undefined;

async function enteredStaffPage(
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
  await staff
    .getByLabel("Reason for entering Browser Company")
    .fill("Helping the client team");
  await staff
    .locator("article")
    .filter({
      has: staff.getByRole("heading", { name: "Browser Company", exact: true }),
    })
    .getByRole("button", { name: "Enter company", exact: true })
    .click();
  await expect(staff).toHaveURL(`${baseURL}/${slug}`);
  await staff.goto(team);
  return staff;
}

test.afterAll(async () => {
  await manager?.context().close();
  manager = undefined;
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

function admin(testInfo: TestInfo, name: string) {
  return {
    name: "Sales Admin",
    email: `admin-${name}-${testInfo.project.name}@browser.example.test`,
  };
}

async function fill(page: Page, values: ReturnType<typeof admin>) {
  await page.getByLabel("Admin name").fill(values.name);
  await page.getByLabel("Admin email").fill(values.email);
}

async function expectForm(page: Page, values: ReturnType<typeof admin>) {
  await expect(page.getByLabel("Admin name")).toHaveValue(values.name);
  await expect(page.getByLabel("Admin email")).toHaveValue(values.email);
}

function pending(page: Page, email: string) {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByText(email, { exact: true }) });
}

test("the team shows active members apart from pending invites", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const page = await managerPage(browser, String(baseURL), mailbox, testInfo);
  await page.goto(`/${slug}`);
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(page).toHaveURL(`${baseURL}${team}`);
  await expect(page.getByText(managerEmail, { exact: true })).toBeVisible();
  await expect(page.getByText(/^\d+ active members?$/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Pending invites" }),
  ).toBeVisible();
  await fits(page, testInfo, "team");
});

test("an old sign-in asks for a fresh code and the retry sends the Admin invite", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const values = admin(testInfo, "fresh");
  const page = await managerPage(browser, String(baseURL), mailbox, testInfo);
  const activeBefore = await page
    .getByText(/^\d+ active members?$/)
    .textContent();
  await fill(page, values);
  await ageSessionCode(String(baseURL), managerEmail, 20);
  await page.getByRole("button", { name: "Invite Admin", exact: true }).click();
  await expect(
    page.getByText("Confirm with a fresh code", { exact: true }),
  ).toBeVisible();
  await expectForm(page, values);

  const codeMail = await mailbox.ids();
  await page.getByRole("button", { name: "Send fresh code" }).click();
  await expect(
    page.getByText("Code requested. Check your email."),
  ).toBeVisible();
  await page
    .getByLabel("Six-digit code")
    .fill(await mailbox.code(managerEmail, codeMail));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(
    page.getByText("Code verified. Retry your action."),
  ).toBeVisible();
  await expectForm(page, values);
  await fits(page, testInfo, "team-fresh-code");

  const inviteMail = await mailbox.ids();
  await page.getByRole("button", { name: "Invite Admin", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Invitation queued." }),
  ).toBeVisible();
  await expect(mailbox.invite(values.email, inviteMail)).resolves.toMatch(
    /^#token=/,
  );
  await expect(pending(page, values.email)).toBeVisible();
  await expect(page.getByText(/^\d+ active members?$/)).toHaveText(
    activeBefore ?? "",
  );
  await fits(page, testInfo, "team-invited");
});

test("resending an Admin invite stops the old link", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const values = admin(testInfo, "resend");
  const page = await managerPage(browser, String(baseURL), mailbox, testInfo);
  await fill(page, values);
  const first = await mailbox.ids();
  await page.getByRole("button", { name: "Invite Admin", exact: true }).click();
  const oldLink = await mailbox.invite(values.email, first);
  const second = await mailbox.ids();
  const row = pending(page, values.email);
  await row.getByRole("button", { name: "Resend invite" }).click();
  await expect(
    row.getByRole("status").filter({ hasText: "Invitation queued." }),
  ).toBeVisible();
  const newLink = await mailbox.invite(values.email, second);
  expect(newLink).not.toBe(oldLink);

  const invitee = await newPage(browser, String(baseURL), testInfo);
  await invitee.goto(`/invite${oldLink}`);
  await expect(
    invitee.getByRole("alert").filter({ hasText: /unavailable/i }),
  ).toBeVisible();
  await invitee.goto("/login");
  await invitee.goto(`/invite${newLink}`);
  await expect(
    invitee.getByText(`Invited email: ${values.email}`),
  ).toBeVisible();
  await invitee.context().close();
});

test("an invited Admin joins the company but cannot open the team", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const values = admin(testInfo, "accept");
  const page = await managerPage(browser, String(baseURL), mailbox, testInfo);
  await fill(page, values);
  const before = await mailbox.ids();
  await page.getByRole("button", { name: "Invite Admin", exact: true }).click();
  const link = await mailbox.invite(values.email, before);

  const member = await newPage(browser, String(baseURL), testInfo);
  await member.goto(`/invite${link}`);
  await member.getByLabel("Your name").fill(values.name);
  await member
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await expect(
    member.getByText("Invitation accepted. Sign in with your invited email."),
  ).toBeVisible();
  await signIn(member, mailbox, values.email);
  await expect(member).toHaveURL(`${baseURL}/${slug}`);
  await expect(
    member.getByRole("link", { name: "Team", exact: true }),
  ).toHaveCount(0);
  expect((await member.goto(team))?.status()).toBe(404);
  expect(
    (
      await member.request.get(`/api/companies/${slug}/members/listMembers`)
    ).status(),
  ).toBe(403);
  await member.context().close();

  await page.goto(team);
  await expect(page.getByText(values.email, { exact: true })).toHaveCount(1);
});

test("a failed team load shows an error, not an empty team", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const page = await managerPage(browser, String(baseURL), mailbox, testInfo);
  const userId = "10000000-0000-4000-8000-0000000000f1";
  const memberId = "50000000-0000-4000-8000-0000000000f1";
  await database(
    String(baseURL),
    `INSERT INTO users (id,email,name) VALUES ('${userId}','broken-${testInfo.project.name}@browser.example.test','Broken');
     INSERT INTO company_members (id,agency_id,company_id,user_id,name,role,status) VALUES
     ('${memberId}','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','${userId}','${"x".repeat(200)}','admin','active');`,
  );
  try {
    await page.goto(team);
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "Try again" }),
    ).toBeVisible();
    await expect(page.getByText("No team members yet.")).toHaveCount(0);
    await expect(page.getByText(/active members?$/)).toHaveCount(0);
    await fits(page, testInfo, "team-failed");
  } finally {
    await database(
      String(baseURL),
      `DELETE FROM company_members WHERE id = '${memberId}'; DELETE FROM users WHERE id = '${userId}';`,
    );
  }
});

test("removing an Admin ends their access on the next request", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const values = admin(testInfo, "remove");
  const page = await managerPage(browser, String(baseURL), mailbox, testInfo);
  await fill(page, values);
  const before = await mailbox.ids();
  await page.getByRole("button", { name: "Invite Admin", exact: true }).click();
  const link = await mailbox.invite(values.email, before);

  const member = await newPage(browser, String(baseURL), testInfo);
  await member.goto(`/invite${link}`);
  await member.getByLabel("Your name").fill(values.name);
  await member
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await expect(
    member.getByText("Invitation accepted. Sign in with your invited email."),
  ).toBeVisible();
  await signIn(member, mailbox, values.email);
  await expect(member).toHaveURL(`${baseURL}/${slug}`);

  await page.goto(team);
  const row = page
    .getByRole("listitem")
    .filter({ has: page.getByText(values.email, { exact: true }) });
  await row
    .getByRole("button", { name: `Remove ${values.name} from the team` })
    .click();
  await expect(row.getByText("deactivated", { exact: true })).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
  await fits(page, testInfo, "team-removed");

  await member.goto(`/${slug}`);
  await expect(member).toHaveURL(`${baseURL}/login`);
  expect((await member.request.get("/api/auth/getSession")).status()).toBe(401);
  await member.context().close();
});

test("entered agency staff resend a Super Admin invite", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const page = await enteredStaffPage(
    browser,
    String(baseURL),
    mailbox,
    testInfo,
  );
  const email = `super-admin-${testInfo.project.name}@browser.example.test`;
  const first = await mailbox.ids();
  const invited = await page.request.post("/api/companies/inviteSuperAdmin", {
    data: {
      companyId: "40000000-0000-4000-8000-000000000001",
      email,
      name: "Second Manager",
    },
    headers: { origin: String(baseURL) },
  });
  expect(invited.status()).toBe(200);
  const oldLink = await mailbox.invite(email, first);
  await page.reload();
  const row = pending(page, email);
  const second = await mailbox.ids();
  await row.getByRole("button", { name: "Resend invite" }).click();
  await expect(
    row.getByRole("status").filter({ hasText: "Invitation queued." }),
  ).toBeVisible();
  expect(await mailbox.invite(email, second)).not.toBe(oldLink);
  await fits(page, testInfo, "team-staff-resend");
});

test("entered agency staff remove Super Admins but not the last one", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const page = await enteredStaffPage(
    browser,
    String(baseURL),
    mailbox,
    testInfo,
  );
  const others = page
    .getByRole("listitem")
    .filter({ hasText: "super admin" })
    .filter({ hasNot: page.getByText(managerEmail, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: /^Remove .+ team$/ }) });
  for (let left = await others.count(); left > 0; left--) {
    await others
      .first()
      .getByRole("button", { name: /^Remove .+ team$/ })
      .click();
    await expect(others).toHaveCount(left - 1);
  }
  const row = page
    .getByRole("listitem")
    .filter({ has: page.getByText(managerEmail, { exact: true }) });
  await row
    .getByRole("button", { name: "Remove Browser Manager from the team" })
    .click();
  await expect(
    row.getByRole("alert").filter({ hasText: "last Super Admin" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("listitem")
      .filter({ has: page.getByText(managerEmail, { exact: true }) })
      .getByText("active", { exact: true }),
  ).toBeVisible();
  await fits(page, testInfo, "team-staff-last-manager");
});
