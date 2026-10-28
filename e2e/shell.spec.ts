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

  test.fixme("shows the DNA banner and leaves to Companies", {
    annotation: { type: "deferred", description: "Needs the Import page." },
  }, async ({ page }) => {
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
    test.fixme(`shows only built navigation for ${userId}`, {
      annotation: {
        type: "deferred",
        description: "Needs the role home pages and their navigation.",
      },
    }, async ({ context, page, baseURL, isMobile }) => {
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

  test.fixme("keeps the load error and Retry inside the company shell", {
    annotation: {
      type: "deferred",
      description: "Needs a company route page.",
    },
  }, async ({ page }) => {
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
      await failure.click();
      await expect(failure).not.toBeChecked();
      await shell.getByRole("button", { name: "Retry", exact: true }).click();
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
