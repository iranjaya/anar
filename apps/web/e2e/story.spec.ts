import { expect, type Page, test } from "@playwright/test";

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
}

async function switchUser(page: Page, userId: string, path: string) {
  await page
    .getByRole("combobox", { name: "Demo user", exact: true })
    .selectOption(userId);
  await expect(page).toHaveURL(path);
  await expect(
    page.getByRole("combobox", { name: "Demo user", exact: true }),
  ).toBeEnabled();
  await expectNoOverflow(page);
}

function unassignedTile(page: Page) {
  return page
    .getByRole("region", { name: "Team summary", exact: true })
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", { name: "Unassigned · now", exact: true }),
    })
    .locator("p");
}

async function callsToday(page: Page) {
  await page
    .getByRole("combobox", { name: "Report range", exact: true })
    .selectOption("today");
  await expect(
    page.getByRole("heading", { name: "Team · today", exact: true }),
  ).toBeVisible();
  const row = page
    .getByRole("region", { name: "Team performance", exact: true })
    .getByRole("row")
    .filter({
      has: page.getByRole("button", { name: "Sunaina Shrestha", exact: true }),
    });
  const text = await row.getByRole("cell").nth(1).textContent();
  const calls = Number(text?.match(/(\d+)\s*\/\s*30/)?.[1]);
  expect(Number.isFinite(calls)).toBe(true);
  return calls;
}

test.describe("day story", () => {
  test("imports, assigns and logs a call across DNA, manager and salesperson", async ({
    context,
    page,
    baseURL,
  }) => {
    await context.addCookies([
      {
        name: "anar_demo",
        value: JSON.stringify({ userId: "rohan", actingCompanyId: null }),
        url: baseURL,
      },
    ]);
    await page.goto("/companies");
    await page.getByRole("button", { name: "Reset demo", exact: true }).click();
    await expect(page).toHaveURL("/sundar-heights/today");
    await expect(
      page.getByRole("button", { name: "Reset demo", exact: true }),
    ).toBeEnabled();
    await page.goto("/");
    await expect(page).toHaveURL("/sundar-heights/today");
    await expectNoOverflow(page);
    await switchUser(page, "rohan", "/companies");
    await page
      .getByRole("article")
      .filter({
        has: page.getByRole("heading", {
          name: "Sundar Heights",
          exact: true,
        }),
      })
      .getByRole("button", { name: "Enter company", exact: true })
      .click();
    await expect(page).toHaveURL("/sundar-heights/imports/new");
    await expectNoOverflow(page);
    await page.getByLabel("Meta CSV file", { exact: true }).setInputFiles({
      name: "Sundar Heights 2 3 BHK October_Leads_2026-10-14_2026-10-28.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Fictional demo file"),
    });
    await page
      .getByRole("link", { name: "Review columns", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Match columns", exact: true }),
    ).toBeVisible();
    await expectNoOverflow(page);
    await page
      .getByRole("button", { name: "Check 412 rows", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "374 already in, 38 new",
        exact: true,
      }),
    ).toBeVisible();
    await expectNoOverflow(page);
    await page
      .getByRole("button", { name: "Import 38 leads", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "38 added", exact: true }),
    ).toBeVisible();
    await expectNoOverflow(page);
    await switchUser(page, "prakash", "/sundar-heights/dashboard");
    await expect(unassignedTile(page)).toHaveText("83");
    const before = await callsToday(page);
    await page.goto("/sundar-heights/leads");
    await expectNoOverflow(page);
    const people = ["Aarav Acharya", "Amrita Gautam", "Anil Pandey"];
    for (const [index, name] of people.entries()) {
      await page
        .getByRole("searchbox", { name: "Search leads", exact: true })
        .fill(`+977982000000${index}`);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      const leadHref = `/sundar-heights/leads/meta-sundar-heights-${index + 1}`;
      const row = page
        .getByRole("table", { name: "Unassigned leads", exact: true })
        .getByRole("row")
        .filter({ has: page.locator(`a[href="${leadHref}"]`) });
      await expect(
        row.getByRole("link", { name, exact: true }),
      ).toHaveAttribute("href", leadHref);
      await row.getByRole("checkbox").check();
    }
    await page
      .getByRole("combobox", { name: "Assign to", exact: true })
      .selectOption({ label: "Sunaina Shrestha" });
    await page
      .getByRole("button", { name: "Assign 3 leads", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      "3 leads assigned to Sunaina Shrestha.",
    );
    await page.goto("/sundar-heights/dashboard");
    await expect(unassignedTile(page)).toHaveText("80");
    await switchUser(page, "sunaina", "/sundar-heights/today");
    const fresh = page.getByRole("region", { name: "New 7", exact: true });
    for (const [index, name] of people.entries())
      await expect(
        fresh.getByRole("link", { name, exact: true }),
      ).toHaveAttribute(
        "href",
        `/sundar-heights/today?lead=meta-sundar-heights-${index + 1}`,
      );
    const lead = fresh.getByRole("article").filter({
      has: page.getByRole("link", { name: people[0], exact: true }),
    });
    const call = lead.getByRole("link", { name: "Call", exact: true });
    await expect(call).toHaveAttribute("href", "tel:+9779820000000");
    await call.click();
    const sheet = page.getByRole("dialog", {
      name: "Log a call",
      exact: true,
    });
    await expect(sheet).toBeVisible();
    await expectNoOverflow(page);
    await sheet
      .getByRole("button", { name: "Callback Requested", exact: true })
      .click();
    await sheet.getByRole("button", { name: "Tomorrow", exact: true }).click();
    await sheet
      .getByRole("button", { name: "Save and next lead", exact: true })
      .click();
    await expect(sheet).toHaveCount(0);
    await expectNoOverflow(page);
    await page.goto("/sundar-heights/leads/meta-sundar-heights-1");
    await expect(
      page.getByRole("region", { name: "Timeline", exact: true }),
    ).toContainText("Callback Requested");
    await expectNoOverflow(page);
    await switchUser(page, "prakash", "/sundar-heights/dashboard");
    expect(await callsToday(page)).toBe(before + 1);
    await expectNoOverflow(page);
  });
});
