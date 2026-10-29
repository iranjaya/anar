import { expect, type Locator, test } from "@playwright/test";

function bounds(locator: Locator) {
  return locator.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
}

test.describe("Today panes", () => {
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
      page.getByRole("region", { name: "Today's leads", exact: true }),
    ).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  });

  test("shows the calls target, buckets and row actions", async ({ page }) => {
    const filters = page.getByRole("complementary", {
      name: "Today filters",
      exact: true,
    });
    await expect(
      filters.getByText("3 of 30 calls today", { exact: true }),
    ).toBeVisible();
    await expect(filters.getByRole("progressbar")).toHaveAttribute(
      "value",
      "3",
    );
    await expect(filters.getByRole("progressbar")).toHaveAttribute("max", "30");
    const list = page.getByRole("region", {
      name: "Today's leads",
      exact: true,
    });
    for (const name of ["Overdue 3", "Due today 3", "New 4"]) {
      await expect(
        list.getByRole("region", { name, exact: true }),
      ).toBeVisible();
    }
    await expect(list.getByRole("article")).toHaveCount(10);
    const row = list.getByRole("article").filter({ hasText: "Bikash Thapa" });
    await expect(
      row.getByText("1 try, no answer", { exact: true }),
    ).toBeVisible();
    const name = row.getByRole("link", { name: "Bikash Thapa", exact: true });
    await expect(name).toHaveAttribute(
      "href",
      "/sundar-heights/today?lead=sundar-lead-001",
    );
    const call = row.getByRole("link", { name: "Call", exact: true });
    await expect(call).toHaveAttribute("href", "tel:+9779810000000");
    await expect(row.getByRole("button")).toHaveCount(0);
    expect(
      await call.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).not.toBe("rgba(0, 0, 0, 0)");
    expect(
      await name.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).toBe("rgba(0, 0, 0, 0)");
    const invalid = list
      .getByRole("article")
      .filter({ hasText: "Phone needs review" });
    await expect(
      invalid.getByRole("button", { name: "Call", exact: true }),
    ).toBeDisabled();
    await expect(invalid.locator('a[href^="tel:"]')).toHaveCount(0);
  });

  test("filters by name, phone, score and stage", async ({ page }) => {
    const list = page.getByRole("region", {
      name: "Today's leads",
      exact: true,
    });
    const search = page.getByRole("searchbox", {
      name: "Search leads",
      exact: true,
    });
    await search.fill("bikash");
    await expect(list.getByRole("article")).toHaveCount(1);
    await expect(
      list.getByRole("link", { name: "Bikash Thapa", exact: true }),
    ).toBeVisible();
    await search.fill("981");
    await expect(list.getByRole("article")).toHaveCount(9);
    await search.fill("");
    const hot = page.getByRole("button", { name: "Hot", exact: true });
    await hot.click();
    await expect(hot).toHaveAttribute("aria-pressed", "true");
    const rows = list.getByRole("article");
    expect(await rows.count()).toBeGreaterThan(0);
    for (const row of await rows.all()) {
      await expect(row.getByText(/^Hot · \d+$/)).toBeVisible();
    }
    await page.getByRole("button", { name: "All", exact: true }).click();
    const stage = page.getByRole("combobox", { name: "Stage", exact: true });
    await stage.selectOption({ label: "Follow-up" });
    await expect(rows).toHaveCount(6);
    await stage.selectOption({ label: "New Lead" });
    await expect(rows).toHaveCount(4);
  });

  test("puts filters, buckets and detail in their own columns", async ({
    page,
    isMobile,
  }) => {
    const main = page.getByRole("main");
    const filters = page.getByRole("complementary", {
      name: "Today filters",
      exact: true,
    });
    const list = page.getByRole("region", {
      name: "Today's leads",
      exact: true,
    });
    const detail = page.getByRole("region", {
      name: "Lead detail",
      exact: true,
    });
    await expect(main.getByRole("searchbox")).toHaveCount(1);
    await expect(
      main.getByRole("combobox", { name: "Stage", exact: true }),
    ).toHaveCount(1);
    const ids = await main
      .locator("[id]")
      .evaluateAll((elements) => elements.map((element) => element.id));
    expect(ids).toEqual([...new Set(ids)]);
    const filterBox = await bounds(filters);
    const listBox = await bounds(list);
    const overdue = await bounds(
      list.getByRole("region", { name: "Overdue 3", exact: true }),
    );
    const due = await bounds(
      list.getByRole("region", { name: "Due today 3", exact: true }),
    );
    const fresh = await bounds(
      list.getByRole("region", { name: "New 4", exact: true }),
    );
    expect(due.y).toBeGreaterThan(overdue.y + overdue.height);
    expect(fresh.y).toBeGreaterThan(due.y + due.height);
    expect(due.x).toBe(overdue.x);
    expect(fresh.x).toBe(overdue.x);
    if (isMobile) {
      await expect(detail).not.toBeVisible();
      expect(listBox.y).toBeGreaterThan(filterBox.y + filterBox.height);
    } else {
      await expect(detail).toHaveCount(1);
      await expect(
        detail.getByRole("heading", { name: "Bikash Thapa", exact: true }),
      ).toBeVisible();
      const detailBox = await bounds(detail);
      expect((await bounds(main)).width).toBeGreaterThan(1000);
      expect(listBox.x).toBeGreaterThan(filterBox.x + filterBox.width);
      expect(detailBox.x).toBeGreaterThan(listBox.x + listBox.width);
      expect(Math.abs(detailBox.y - listBox.y)).toBeLessThan(2);
    }
  });

  test("opens the second overdue lead on Today and goes back on phone", async ({
    page,
    isMobile,
  }) => {
    const list = page.getByRole("region", {
      name: "Today's leads",
      exact: true,
    });
    const second = list
      .getByRole("region", { name: "Overdue 3", exact: true })
      .getByRole("article")
      .nth(1);
    const link = second.getByRole("link", {
      name: "Anita Maharjan",
      exact: true,
    });
    await expect(link).toHaveAttribute(
      "href",
      "/sundar-heights/today?lead=sundar-lead-002",
    );
    await link.click();
    await expect(page).toHaveURL("/sundar-heights/today?lead=sundar-lead-002");
    const detail = page.getByRole("region", {
      name: "Lead detail",
      exact: true,
    });
    await expect(detail).toHaveCount(1);
    await expect(
      detail.getByRole("heading", { name: "Anita Maharjan", exact: true }),
    ).toBeVisible();
    const back = page.getByRole("link", {
      name: "Back to the list",
      exact: true,
    });
    if (isMobile) {
      await expect(list).not.toBeVisible();
      await expect(
        page.getByRole("complementary", { name: "Today filters", exact: true }),
      ).not.toBeVisible();
      const mainBox = await bounds(page.getByRole("main"));
      const detailBox = await bounds(detail);
      expect(detailBox.width).toBeGreaterThan(mainBox.width - 40);
      await back.click();
      await expect(page).toHaveURL("/sundar-heights/today");
      await expect(list).toBeVisible();
      await expect(detail).not.toBeVisible();
    } else {
      await expect(list).toBeVisible();
      await expect(link).toHaveAttribute("aria-current", "true");
      await expect(back).not.toBeVisible();
      expect((await bounds(detail)).x).toBeGreaterThan(
        (await bounds(list)).x + (await bounds(list)).width,
      );
    }
  });

  test("opens call logging on Today", async ({ page }) => {
    const row = page
      .getByRole("region", { name: "Today's leads", exact: true })
      .getByRole("article")
      .filter({ hasText: "Anita Maharjan" });
    const call = row.getByRole("link", { name: "Call", exact: true });
    await expect(call).toHaveAttribute("href", "tel:+9779810000001");
    await call.click();
    await expect(page).toHaveURL(
      "/sundar-heights/today?lead=sundar-lead-002&log=1",
    );
    await expect(
      page
        .getByRole("dialog", { name: "Log a call", exact: true })
        .getByText("Anita Maharjan", { exact: true }),
    ).toBeVisible();
  });

  test("keeps no matches in the list column", async ({ page, isMobile }) => {
    const list = page.getByRole("region", {
      name: "Today's leads",
      exact: true,
    });
    const before = await bounds(list);
    await page.getByRole("button", { name: "Hot", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "Search leads", exact: true })
      .fill("nobody with this name");
    await expect(
      list.getByRole("heading", { name: "No hot leads match", exact: true }),
    ).toBeVisible();
    await expect(list.getByRole("article")).toHaveCount(0);
    await expect(list.getByText(/Nothing overdue/)).toHaveCount(0);
    await expect(
      list.getByRole("heading", {
        name: "No leads assigned to you yet",
        exact: true,
      }),
    ).toHaveCount(0);
    expect((await bounds(list)).x).toBe(before.x);
    expect((await bounds(list)).width).toBe(before.width);
    const detail = page.getByRole("region", {
      name: "Lead detail",
      exact: true,
    });
    await expect(
      detail.getByText("No hot leads match", { exact: true }),
    ).toHaveCount(0);
    if (!isMobile)
      await expect(
        detail.getByRole("heading", { name: "Bikash Thapa", exact: true }),
      ).toBeVisible();
  });

  test("keeps no assigned leads in the list column", async ({
    context,
    page,
    baseURL,
    isMobile,
  }) => {
    await context.addCookies([
      {
        name: "anar_demo",
        value: JSON.stringify({ userId: "dipen", actingCompanyId: null }),
        url: baseURL,
      },
    ]);
    await page.goto("/pahad-view/today");
    const list = page.getByRole("region", {
      name: "Today's leads",
      exact: true,
    });
    await expect(
      list.getByRole("heading", {
        name: "No leads assigned to you yet",
        exact: true,
      }),
    ).toBeVisible();
    await expect(list.getByRole("article")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByText(/Nothing overdue/)).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Lead detail", exact: true }),
    ).toHaveCount(0);
    if (!isMobile) {
      const filters = await bounds(
        page.getByRole("complementary", { name: "Today filters", exact: true }),
      );
      expect((await bounds(list)).x).toBeGreaterThan(filters.x + filters.width);
    }
  });

  test("keeps failed loads in the list column and retries", {
    tag: "@failure",
  }, async ({ page, isMobile }) => {
    await page.goto("/sundar-heights/today?lead=sundar-lead-002");
    await expect(
      page.getByRole("region", { name: "Lead detail", exact: true }),
    ).toBeVisible();
    const failure = page.getByRole("checkbox", {
      name: "Simulate failure",
      exact: true,
    });
    try {
      await failure.click();
      await expect(failure).toBeChecked();
      await expect(failure).toBeEnabled();
      await page.reload();
      const list = page.getByRole("region", {
        name: "Today's leads",
        exact: true,
      });
      await expect(list.getByRole("alert")).toHaveText(
        "Couldn't load this page",
      );
      const filters = page.getByRole("complementary", {
        name: "Today filters",
        exact: true,
      });
      await expect(filters).toBeVisible();
      await expect(
        filters.getByText("Calls today unavailable", { exact: true }),
      ).toBeVisible();
      await expect(filters.getByRole("progressbar")).toHaveCount(0);
      await expect(
        filters.getByRole("combobox", { name: "Stage", exact: true }),
      ).toBeDisabled();
      await filters
        .getByRole("searchbox", { name: "Search leads", exact: true })
        .fill("Bikash");
      await filters.getByRole("button", { name: "Hot", exact: true }).click();
      await expect(list.getByRole("heading")).toHaveCount(0);
      if (!isMobile) {
        const filterBox = await bounds(filters);
        expect((await bounds(list)).x).toBeGreaterThan(
          filterBox.x + filterBox.width,
        );
        expect((await bounds(page.getByRole("main"))).width).toBeGreaterThan(
          1000,
        );
      }
      await expect(
        page.getByRole("region", { name: "Lead detail", exact: true }),
      ).toHaveCount(0);
      await expect(page.getByRole("article")).toHaveCount(0);
      await expect(
        page.getByText(/Nothing overdue|0 of 30 calls today/),
      ).toHaveCount(0);
      await list.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(list.getByRole("alert")).toHaveText(
        "Couldn't load this page",
      );
      await failure.click();
      await expect(failure).not.toBeChecked();
      await list.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(
        page
          .getByRole("region", { name: "Lead detail", exact: true })
          .getByRole("heading", { name: "Anita Maharjan", exact: true }),
      ).toBeVisible();
      if (isMobile)
        await page
          .getByRole("link", { name: "Back to the list", exact: true })
          .click();
      await expect(list.getByRole("article")).toHaveCount(10);
    } finally {
      await expect(failure).toBeEnabled();
      if (await failure.isChecked()) {
        await failure.click();
        await expect(failure).not.toBeChecked();
      }
    }
  });
});
