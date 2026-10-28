import { expect, test } from "@playwright/test";

test.describe("shell", () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    await context.addCookies([
      {
        name: "anar_demo",
        value: JSON.stringify({ userId: "rohan", actingCompanyId: null }),
        url: baseURL,
      },
    ]);
    await page.goto("/companies");
    await expect(
      page.getByRole("heading", { name: "Companies", exact: true }),
    ).toBeVisible();
  });

  test("shows the company list and demo controls", async ({ page }) => {
    await expect(
      page.getByRole("complementary", { name: "Demo controls" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sundar Heights", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Pahad View Apartments",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enter company", exact: true }),
    ).toHaveCount(2);
  });

  for (const { userId, role, path } of [
    { userId: "sunaina", role: "Admin", path: "/sundar-heights/today" },
    {
      userId: "prakash",
      role: "Super Admin",
      path: "/sundar-heights/dashboard",
    },
    { userId: "rohan", role: "DNA", path: "/companies" },
  ]) {
    test(`redirects ${role} to its home URL`, async ({ page }) => {
      const users = page.getByRole("combobox", {
        name: "Demo user",
        exact: true,
      });
      await users.selectOption(userId);
      await expect(page).toHaveURL(path);
      await expect(users).toHaveValue(userId);
      await page.goto("/");
      await expect(page).toHaveURL(path);
      await users.selectOption("rohan");
      await expect(page).toHaveURL("/companies");
      await expect(
        page.getByRole("heading", { name: "Companies", exact: true }),
      ).toBeVisible();
    });
  }

  test("shows a load error and retries after failure is off", async ({
    page,
  }) => {
    const failure = page.getByRole("checkbox", {
      name: "Simulate failure",
      exact: true,
    });
    try {
      await failure.click();
      await expect(failure).toBeChecked();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        "Couldn't load this page",
      );
      await expect(
        page.getByRole("button", { name: "Retry", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("complementary", { name: "Demo controls" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Companies", exact: true }),
      ).toHaveCount(0);
      await failure.click();
      await expect(failure).not.toBeChecked();
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Companies", exact: true }),
      ).toBeVisible();
    } finally {
      await expect(failure).toBeEnabled();
      if (await failure.isChecked()) {
        await failure.click();
        await expect(failure).not.toBeChecked();
      }
    }
  });

  test("shows the DNA banner and leaves to Companies", async ({ page }) => {
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
    const banner = page.getByRole("complementary", {
      name: "Company access",
    });
    await expect(banner).toContainText("DNA · Inside Sundar Heights");
    await banner.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(page).toHaveURL("/companies");
    await expect(
      page.getByRole("heading", { name: "Companies", exact: true }),
    ).toBeVisible();
  });

  for (const { userId, path, links } of [
    { userId: "sunaina", path: "/sundar-heights/today", links: [] },
    {
      userId: "prakash",
      path: "/sundar-heights/dashboard",
      links: ["Dashboard", "Leads"],
    },
    {
      userId: "rohan",
      path: "/sundar-heights/imports/new",
      links: ["Companies", "Import"],
    },
  ]) {
    test(`shows only built navigation for ${userId}`, async ({
      context,
      page,
      baseURL,
      isMobile,
    }) => {
      test.fixme(
        userId === "prakash",
        "Needs the role home pages and their navigation.",
      );
      await context.addCookies([
        {
          name: "anar_demo",
          value: JSON.stringify({
            userId,
            actingCompanyId: userId === "rohan" ? "sundar-heights" : null,
          }),
          url: baseURL,
        },
      ]);
      await page.goto(path);
      const nav = page.getByRole("navigation", { name: "Main navigation" });
      if (isMobile || links.length === 0) {
        await expect(nav).not.toBeVisible();
        return;
      }
      await expect(nav.getByRole("link")).toHaveText(links);
    });
  }

  test("keeps the load error and Retry inside the company shell", async ({
    page,
  }) => {
    await page
      .getByRole("combobox", { name: "Demo user", exact: true })
      .selectOption("sunaina");
    await page.goto("/sundar-heights/today");
    const failure = page.getByRole("checkbox", {
      name: "Simulate failure",
      exact: true,
    });
    try {
      await failure.click();
      await expect(failure).toBeChecked();
      const shell = page.getByRole("region", { name: "Company shell" });
      await expect(shell.getByRole("alert")).toHaveText(
        "Couldn't load this page",
      );
      await expect(
        shell.getByRole("button", { name: "Retry", exact: true }),
      ).toBeVisible();
      await shell.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(shell.getByRole("alert")).toHaveText(
        "Couldn't load this page",
      );
      await failure.click();
      await expect(failure).not.toBeChecked();
      await expect(shell.getByRole("alert")).toHaveCount(0);
    } finally {
      await expect(failure).toBeEnabled();
      if (await failure.isChecked()) {
        await failure.click();
        await expect(failure).not.toBeChecked();
      }
    }
  });
});

test.describe("Today", () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
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
    await expect(
      page.getByRole("heading", { name: "My Leads Today", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(10);
  });

  test("shows the three buckets and only Call as the filled row action", async ({
    page,
  }) => {
    for (const name of ["Overdue 3", "Due today 3", "New 4"]) {
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    }
    const row = page.getByRole("article").filter({
      has: page.getByRole("link", { name: "Bikash Thapa", exact: true }),
    });
    const call = row.getByRole("link", { name: "Call", exact: true });
    await expect(call).toHaveAttribute("href", "tel:+9779810000000");
    await expect(row.getByRole("button")).toHaveCount(0);
    expect(
      await call.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).not.toBe("rgba(0, 0, 0, 0)");
    expect(
      await row
        .getByRole("link", { name: "Bikash Thapa", exact: true })
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
    const invalid = page
      .getByRole("article")
      .filter({ hasText: "Phone needs review" });
    await expect(
      invalid.getByRole("button", { name: "Call", exact: true }),
    ).toBeDisabled();
    await expect(invalid.locator('a[href^="tel:"]')).toHaveCount(0);
  });

  test("filters by score, stage, name and the seeded phone prefix", async ({
    page,
  }) => {
    const search = page.getByRole("searchbox", {
      name: "Search leads",
      exact: true,
    });
    await search.fill("bikash");
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(
      page.getByRole("link", { name: "Bikash Thapa", exact: true }),
    ).toBeVisible();
    await search.fill("981");
    await expect(page.getByRole("article")).toHaveCount(9);
    await search.fill("");
    await page.getByRole("button", { name: "Hot", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Hot", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const hot = page.getByRole("article");
    expect(await hot.count()).toBeGreaterThan(0);
    for (const row of await hot.all())
      await expect(row.getByText(/^Hot · \d+$/)).toBeVisible();
    await page.getByRole("button", { name: "All", exact: true }).click();
    const stage = page.getByRole("combobox", { name: "Stage", exact: true });
    await stage.selectOption({ label: "Follow-up" });
    await expect(page.getByRole("article")).toHaveCount(6);
    await stage.selectOption({ label: "New Lead" });
    await expect(page.getByRole("article")).toHaveCount(4);
  });

  test("distinguishes no match from no assigned leads", async ({
    context,
    page,
    baseURL,
  }) => {
    await page.getByRole("button", { name: "Hot", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "Search leads", exact: true })
      .fill("nobody with this name");
    await expect(
      page.getByRole("heading", { name: "No hot leads match", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByText(/Nothing overdue/)).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "No leads assigned to you yet",
        exact: true,
      }),
    ).toHaveCount(0);
    await context.addCookies([
      {
        name: "anar_demo",
        value: JSON.stringify({ userId: "dipen", actingCompanyId: null }),
        url: baseURL,
      },
    ]);
    await page.goto("/pahad-view/today");
    await expect(
      page.getByRole("heading", {
        name: "No leads assigned to you yet",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByText(/Nothing overdue/)).toHaveCount(0);
  });

  test("uses the available width on desktop and stacks the phone view", async ({
    page,
    isMobile,
  }) => {
    await expect(
      page.getByRole("searchbox", { name: "Search leads", exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("combobox", { name: "Stage", exact: true }),
    ).toHaveCount(1);
    const ids = await page
      .getByRole("main")
      .locator("[id]")
      .evaluateAll((elements) => elements.map((element) => element.id));
    expect(ids).toEqual([...new Set(ids)]);
    const main = await page.getByRole("main").boundingBox();
    const filters = await page
      .getByRole("complementary", { name: "Today filters", exact: true })
      .boundingBox();
    const overdue = await page
      .getByRole("region", { name: "Overdue 3", exact: true })
      .boundingBox();
    const due = await page
      .getByRole("region", { name: "Due today 3", exact: true })
      .boundingBox();
    const fresh = await page
      .getByRole("region", { name: "New 4", exact: true })
      .boundingBox();
    expect(main).not.toBeNull();
    expect(filters).not.toBeNull();
    expect(overdue).not.toBeNull();
    expect(due).not.toBeNull();
    expect(fresh).not.toBeNull();
    if (main && filters && overdue && due && fresh) {
      if (isMobile) {
        expect(overdue.y).toBeGreaterThan(filters.y + filters.height);
        expect(due.y).toBeGreaterThan(overdue.y);
        expect(fresh.y).toBeGreaterThan(due.y);
      } else {
        expect(main.width).toBeGreaterThan(1000);
        expect(overdue.x).toBeGreaterThan(filters.x + filters.width);
        expect(due.x).toBeGreaterThan(overdue.x);
        expect(fresh.x).toBeGreaterThan(due.x);
        expect(Math.abs(overdue.y - due.y)).toBeLessThan(2);
      }
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    await page.screenshot({
      path: `/private/tmp/anar-today-${isMobile ? "phone" : "desktop"}.png`,
      fullPage: true,
    });
  });

  test("shows failed loads without the Good day card or zero counts", async ({
    page,
  }) => {
    const failure = page.getByRole("checkbox", {
      name: "Simulate failure",
      exact: true,
    });
    try {
      await failure.click();
      await expect(failure).toBeChecked();
      const shell = page.getByRole("region", {
        name: "Company shell",
        exact: true,
      });
      await expect(shell.getByRole("alert")).toHaveText(
        "Couldn't load this page",
      );
      await expect(
        page.getByText(/Nothing overdue|0 of 30 calls today/),
      ).toHaveCount(0);
      await expect(page.getByRole("article")).toHaveCount(0);
      await shell.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(shell.getByRole("alert")).toHaveText(
        "Couldn't load this page",
      );
      await failure.click();
      await expect(failure).not.toBeChecked();
      await expect(
        page.getByRole("heading", { name: "My Leads Today", exact: true }),
      ).toBeVisible();
    } finally {
      await expect(failure).toBeEnabled();
      if (await failure.isChecked()) {
        await failure.click();
        await expect(failure).not.toBeChecked();
      }
    }
  });
});
