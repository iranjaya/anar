import type { Page } from "@playwright/test";
import { expect, test } from "./fixture";

test("owner invites staff, staff creates companies, and Super Admin chooses a workspace", async ({
  page: owner,
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  test.setTimeout(180000);
  const options = {
    baseURL,
    viewport: owner.viewportSize(),
    isMobile: testInfo.project.name === "phone",
    hasTouch: testInfo.project.name === "phone",
  };
  const staffContext = await browser.newContext(options);
  const adminContext = await browser.newContext(options);
  const staff = await staffContext.newPage();
  const admin = await adminContext.newPage();
  const errors: string[] = [];
  for (const page of [owner, staff, admin])
    page.on("pageerror", (error) => errors.push(error.message));
  const staffEmail = "first-staff@browser.example.test";
  const adminEmail = "super-admin@browser.example.test";

  async function view(page: Page, name: string) {
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

  async function signIn(page: Page, email: string, landing: string) {
    await page.goto("/login");
    await page.getByLabel("Email address").fill(email);
    await view(page, `${landing.replaceAll("/", "-")}-login`);
    const before = await mailbox.ids();
    await page.getByRole("button", { name: "Send code", exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/login/code`);
    await view(page, `${landing.replaceAll("/", "-")}-code`);
    const code = await mailbox.code(email, before);
    await page.getByLabel("Six-digit code").fill(code);
    const refreshed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/refresh") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(page).toHaveURL(`${baseURL}${landing}`);
    expect((await refreshed).status()).toBe(200);
    const session = (await page.context().cookies()).find(
      (cookie) => cookie.name === "anar_session",
    );
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
  }

  async function accept(
    page: Page,
    email: string,
    before: string[],
    target: string,
  ) {
    const fragment = await mailbox.invite(email, before);
    await page.goto(`/invite${fragment}`);
    await expect(page).toHaveURL(`${baseURL}/invite`);
    await expect(page.getByText(target, { exact: true })).toBeVisible();
    await expect(page.getByText(`Invited email: ${email}`)).toBeVisible();
    await page.reload();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "This invitation link is missing." }),
    ).toBeVisible();
    await page.goto("/login");
    await page.goto(`/invite${fragment}`);
    await expect(page.getByText(`Invited email: ${email}`)).toBeVisible();
    expect(
      await page.evaluate(() => [localStorage.length, sessionStorage.length]),
    ).toEqual([0, 0]);
    await page.getByLabel("Your name").fill("   ");
    await page
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Check your name" }),
    ).toBeVisible();
    await expect(page.getByLabel("Your name")).toHaveValue("   ");
    await page
      .getByLabel("Your name")
      .fill(email === staffEmail ? "First Staff" : "Company Admin");
    await view(page, `${target.replaceAll(" ", "-")}-invite`);
    await page.route("**/api/auth/acceptInvite", (route) => route.abort(), {
      times: 1,
    });
    await page
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Could not reach the service." }),
    ).toBeVisible();
    await expect(page.getByLabel("Your name")).toHaveValue(
      email === staffEmail ? "First Staff" : "Company Admin",
    );
    await page
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(
      page.getByText("Invitation accepted. Sign in with your invited email."),
    ).toBeVisible();
  }

  async function createCompany(name: string, slug: string) {
    await staff.goto("/agency/companies");
    await staff.getByLabel("Company name", { exact: true }).fill(name);
    await staff.getByLabel("Company slug").fill(slug);
    await staff
      .getByRole("button", { name: "Create company", exact: true })
      .click();
    const created = staff.locator("section").filter({
      has: staff.getByRole("heading", {
        name: "Company created",
        exact: true,
      }),
    });
    await expect(created).toBeVisible();
    await created.getByLabel("Super Admin name").fill("Company Admin");
    await created.getByLabel("Super Admin email").fill(adminEmail);
    const before = await mailbox.ids();
    await created
      .getByRole("button", { name: "Invite Super Admin", exact: true })
      .click();
    await expect(
      created.getByRole("status").filter({ hasText: "Invitation queued." }),
    ).toBeVisible();
    return before;
  }

  try {
    await signIn(owner, "owner@browser.example.test", "/owner/agencies");
    await owner
      .getByLabel("Agency name", { exact: true })
      .fill("Journey Agency");
    await owner.getByLabel("Agency slug").fill("journey-agency");
    await owner.getByLabel("First staff name").fill("First Staff");
    await owner.getByLabel("First staff email").fill(staffEmail);
    const firstInvite = await mailbox.ids();
    await owner.getByRole("button", { name: "Create and invite" }).click();
    await expect(
      owner.getByText("Agency created. First staff invitation queued."),
    ).toBeVisible();
    await view(owner, "owner-agencies");
    await accept(staff, staffEmail, firstInvite, "Journey Agency");
    await staff.getByRole("link", { name: "Continue to sign in" }).click();
    await expect(staff.getByLabel("Email address")).toHaveValue(staffEmail);
    await signIn(staff, staffEmail, "/agency/companies");
    await view(staff, "agency-companies");
    const companyInvite = await createCompany(
      "Journey Company",
      "journey-company",
    );
    await accept(admin, adminEmail, companyInvite, "Journey Company");
    await signIn(admin, adminEmail, "/journey-company");
    await expect(
      admin.getByRole("heading", { name: "Welcome, Company Admin" }),
    ).toBeVisible();
    await view(admin, "company-home");

    const secondInvite = await createCompany(
      "Second Company",
      "second-company",
    );
    await accept(admin, adminEmail, secondInvite, "Second Company");
    await admin.goto("/workspaces");
    await expect(
      admin.getByRole("heading", { name: "Your workspaces" }),
    ).toBeVisible();
    await expect(admin.getByRole("link", { name: /Open company/ })).toHaveCount(
      2,
    );
    await view(admin, "workspaces");
    await admin
      .getByRole("link", { name: /Second Company.*Open company/ })
      .click();
    await expect(admin).toHaveURL(`${baseURL}/second-company`);
    await owner.goto("/");
    await expect(owner).toHaveURL(`${baseURL}/owner/agencies`);
    await staff.goto("/");
    await expect(staff).toHaveURL(`${baseURL}/agency/companies`);
    await admin.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(admin).toHaveURL(`${baseURL}/login`);
    expect((await admin.request.get("/api/auth/getSession")).status()).toBe(
      401,
    );
    expect((await owner.request.get("/api/auth/getSession")).status()).toBe(
      200,
    );
    expect((await staff.request.get("/api/auth/getSession")).status()).toBe(
      200,
    );
    expect(errors).toEqual([]);
  } finally {
    await staffContext.close();
    await adminContext.close();
  }
});
