import { expect, signIn, test } from "./fixture";

const managerEmail = "manager@browser.example.test";
const companyStaffEmail = "company-staff@browser.example.test";
const companyId = "40000000-0000-4000-8000-000000000001";

test("company home loads from the API and demo access stays closed", async ({
  page,
  context,
  baseURL,
  mailbox,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, mailbox, managerEmail);
  await expect(page).toHaveURL(`${baseURL}/browser-company`);

  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(
    page.getByRole("heading", { name: "Browser Company", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Welcome, Browser Manager" }),
  ).toBeVisible();
  await expect(
    page.getByText("Browser Company · Browser Agency"),
  ).toBeVisible();
  await expect(nav.getByRole("link", { name: "Workspaces" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Your devices" })).toBeVisible();
  await expect(
    nav.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("company-home.png"),
    fullPage: true,
  });

  const view = await page.request.get("/api/context?company=browser-company");
  expect(view.status()).toBe(200);
  const body = await view.json();
  expect(body.data.companyId).toBe(companyId);
  expect(body.data.company.slug).toBe("browser-company");
  expect((await page.goto(`/${companyId}`))?.status()).toBe(404);

  await context.addCookies([
    {
      name: "anar_demo",
      value: JSON.stringify({
        userId: "rohan",
        actingCompanyId: "sundar-heights",
      }),
      url: baseURL,
    },
  ]);
  await page.goto("/browser-company");
  await expect(
    page.getByRole("heading", { name: "Welcome, Browser Manager" }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Demo controls" }),
  ).toHaveCount(0);
  await expect(page.getByText("Sundar Heights")).toHaveCount(0);
  expect((await page.goto("/sundar-heights"))?.status()).toBe(404);
  for (const path of [
    "/companies",
    "/browser-company/today",
    "/browser-company/leads",
    "/browser-company/dashboard",
    "/browser-company/imports/new",
  ])
    expect((await page.request.get(path)).status()).toBe(404);
  expect((await page.request.post("/api/imports", { data: {} })).status()).toBe(
    403,
  );
  expect(errors).toEqual([]);
});

test("agency staff see and create only their own agency's companies", async ({
  page,
  baseURL,
  mailbox,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, mailbox, companyStaffEmail);
  await expect(page).toHaveURL(`${baseURL}/agency/companies`);

  const list = page.getByRole("region", { name: "Company list" });
  await expect(
    list.getByRole("heading", { name: "Browser Company" }),
  ).toBeVisible();
  await expect(
    list.getByText("browser-company", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Other Company")).toHaveCount(0);
  expect((await page.goto("/other-company"))?.status()).toBe(404);
  await page.goto("/agency/companies");

  await page.getByLabel("Company name", { exact: true }).fill("Staff Company");
  await page.getByLabel("Company slug").fill("other-company");
  await page
    .getByRole("button", { name: "Create company", exact: true })
    .click();
  const failed = page
    .getByRole("alert")
    .filter({ hasText: "Company slug is unavailable" });
  await expect(failed).toBeVisible();
  await expect(failed).not.toContainText("Other");
  await expect(page.getByLabel("Company name", { exact: true })).toHaveValue(
    "Staff Company",
  );
  await expect(page.getByLabel("Company slug")).toHaveValue("other-company");

  await page.getByLabel("Company slug").fill("staff-company");
  await page
    .getByRole("button", { name: "Create company", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Company created", exact: true }),
  ).toBeVisible();
  await expect(
    list.getByRole("heading", { name: "Staff Company" }),
  ).toBeVisible();
  await expect(list.getByText("staff-company", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    list.getByRole("heading", { name: "Staff Company" }),
  ).toBeVisible();
  await expect(page.getByText("Other Company")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("agency-companies.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
