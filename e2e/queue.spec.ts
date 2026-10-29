import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

async function setUser(
  context: BrowserContext,
  baseURL: string | undefined,
  userId: string,
  company = "sundar-heights",
) {
  await context.addCookies([
    {
      name: "anar_demo",
      value: JSON.stringify({
        userId,
        actingCompanyId: userId === "rohan" ? company : null,
      }),
      url: baseURL,
    },
  ]);
}

async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("Queue content is not visible");
  return box;
}

function rows(page: Page) {
  return page
    .getByRole("table", { name: "Unassigned leads", exact: true })
    .locator("tbody")
    .getByRole("row");
}

async function pickThree(page: Page) {
  for (let index = 0; index < 3; index++)
    await rows(page).nth(index).getByRole("checkbox").check();
  await page
    .getByRole("combobox", { name: "Assign to", exact: true })
    .selectOption({ label: "Sunaina Shrestha" });
}

test.describe("unassigned queue", () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    await setUser(context, baseURL, "rohan");
    await page.goto("/companies");
    await page.getByRole("button", { name: "Reset demo", exact: true }).click();
    await expect(page).toHaveURL("/sundar-heights/today");
    await expect(
      page.getByRole("button", { name: "Reset demo", exact: true }),
    ).toBeEnabled();
    await setUser(context, baseURL, "prakash");
    await page.goto("/sundar-heights/leads");
    await expect(
      page.getByText("45 unassigned leads", { exact: true }),
    ).toBeVisible();
    await expect(rows(page)).toHaveCount(45);
  });

  test("explains disabled Assign, selects only the shown rows and assigns three", async ({
    page,
  }) => {
    const panel = page.getByRole("region", {
      name: "Assign leads",
      exact: true,
    });
    const assign = panel.getByRole("button");
    await expect(assign).toBeDisabled();
    await expect(
      panel.getByText("Select leads to assign", { exact: true }),
    ).toBeVisible();
    const all = page.getByRole("checkbox", {
      name: "Select all 45 shown",
      exact: true,
    });
    await all.check();
    await expect(
      rows(page).getByRole("checkbox", { checked: true }),
    ).toHaveCount(45);
    await expect(panel.getByText("45 selected", { exact: true })).toBeVisible();
    await expect(assign).toBeDisabled();
    await expect(
      panel.getByText("Pick a person to assign to", { exact: true }),
    ).toBeVisible();
    await all.uncheck();
    await expect(
      rows(page).getByRole("checkbox", { checked: true }),
    ).toHaveCount(0);
    await pickThree(page);
    await expect(assign).toHaveText("Assign 3 leads");
    await assign.click();
    await expect(
      page.getByText("42 unassigned leads", { exact: true }),
    ).toBeVisible();
    await expect(rows(page)).toHaveCount(42);
    await expect(page.getByRole("status")).toHaveText(
      "3 leads assigned to Sunaina Shrestha.",
    );
    await expect(
      rows(page).getByRole("checkbox", { checked: true }),
    ).toHaveCount(0);
    await expect(assign).toBeDisabled();
    await page.reload();
    await expect(
      page.getByText("42 unassigned leads", { exact: true }),
    ).toBeVisible();
  });

  test("keeps three picks and the assignee on failure, then retries", {
    tag: "@failure",
  }, async ({ page }) => {
    await pickThree(page);
    const panel = page.getByRole("region", {
      name: "Assign leads",
      exact: true,
    });
    const failure = page.getByRole("checkbox", {
      name: "Simulate failure",
      exact: true,
    });
    try {
      await failure.click();
      await expect(failure).toBeChecked();
      await expect(failure).toBeEnabled();
      await panel
        .getByRole("button", { name: "Assign 3 leads", exact: true })
        .click();
      await expect(panel.getByRole("alert")).toHaveText(
        "Couldn't load demo data. Try again.",
      );
      await expect(
        page.getByText("45 unassigned leads", { exact: true }),
      ).toBeVisible();
      await expect(
        rows(page).getByRole("checkbox", { checked: true }),
      ).toHaveCount(3);
      await expect(panel.getByRole("combobox")).toHaveValue(
        "sundar-heights-sunaina",
      );
      expect((await bounds(panel.getByRole("alert"))).y).toBeLessThan(
        (await bounds(panel.getByRole("button"))).y,
      );
      await failure.click();
      await expect(failure).not.toBeChecked();
      await expect(failure).toBeEnabled();
      await panel
        .getByRole("button", { name: "Assign 3 leads", exact: true })
        .click();
      await expect(
        page.getByText("42 unassigned leads", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("status")).toHaveText(
        "3 leads assigned to Sunaina Shrestha.",
      );
      await expect(panel.getByRole("alert")).toHaveCount(0);
    } finally {
      await expect(failure).toBeEnabled();
      if (await failure.isChecked()) {
        await failure.click();
        await expect(failure).not.toBeChecked();
      }
    }
  });

  test("keeps a filtered empty state distinct from an empty queue", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Hot", exact: true }).click();
    await expect(page).toHaveURL(/priority=hot/);
    const hotCount = await rows(page).count();
    expect(hotCount).toBeGreaterThan(0);
    await page
      .getByRole("checkbox", {
        name: `Select all ${hotCount} shown`,
        exact: true,
      })
      .check();
    await page
      .getByRole("combobox", { name: "Assign to", exact: true })
      .selectOption({ label: "Sunaina Shrestha" });
    await page
      .getByRole("button", { name: `Assign ${hotCount} leads`, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "No hot leads waiting", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`${45 - hotCount} unassigned leads`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No unassigned leads", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(rows(page)).toHaveCount(45 - hotCount);
    await page
      .getByRole("checkbox", {
        name: `Select all ${45 - hotCount} shown`,
        exact: true,
      })
      .check();
    await page
      .getByRole("button", {
        name: `Assign ${45 - hotCount} leads`,
        exact: true,
      })
      .click();
    await expect(
      page.getByText("0 unassigned leads", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No unassigned leads", exact: true }),
    ).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
  });

  test("restores search with browser Back and keeps filters in step", async ({
    page,
  }) => {
    const search = page.getByRole("searchbox", {
      name: "Search leads",
      exact: true,
    });
    await search.fill("nobody with this name");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/q=nobody/);
    await expect(
      page.getByRole("heading", { name: "No leads match", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(rows(page)).toHaveCount(45);
    await expect(search).toHaveValue("");
    await page.getByRole("button", { name: "Hot", exact: true }).click();
    await expect(page).toHaveURL(/priority=hot/);
    expect(new URL(page.url()).searchParams.has("q")).toBe(false);
    await expect(rows(page).first()).toBeVisible();
    for (const row of await rows(page).all())
      await expect(row.getByRole("cell").nth(2)).toContainText("Hot");
  });

  test("keeps Sunaina out and shows Pahad's real empty queue", async ({
    context,
    page,
    baseURL,
  }) => {
    await setUser(context, baseURL, "sunaina");
    await page.goto("/sundar-heights/leads");
    await expect(page).toHaveURL("/sundar-heights/today");
    await expect(
      page.getByRole("region", { name: "Assign leads", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("table", { name: "Unassigned leads", exact: true }),
    ).toHaveCount(0);
    await setUser(context, baseURL, "mina", "pahad-view");
    await page.goto("/pahad-view/leads");
    await expect(
      page.getByRole("heading", { name: "No unassigned leads", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("0 unassigned leads", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

  test("uses one queue with phone cards and desktop columns", async ({
    page,
    isMobile,
  }) => {
    const main = page.getByRole("main");
    const filters = page.getByRole("complementary", {
      name: "Queue filters",
      exact: true,
    });
    const table = page.getByRole("table", {
      name: "Unassigned leads",
      exact: true,
    });
    const panel = page.getByRole("region", {
      name: "Assign leads",
      exact: true,
    });
    await expect(table).toHaveCount(1);
    await expect(panel).toHaveCount(1);
    await expect(main.getByRole("combobox")).toHaveCount(1);
    await expect(main.getByRole("searchbox")).toHaveCount(1);
    const filterBox = await bounds(filters);
    const tableBox = await bounds(table);
    const panelBox = await bounds(panel);
    const position = await panel.evaluate(
      (element) => getComputedStyle(element).position,
    );
    if (isMobile) {
      expect(position).toBe("fixed");
      expect(tableBox.y).toBeGreaterThan(filterBox.y + filterBox.height);
      await rows(page).last().getByRole("cell").last().scrollIntoViewIfNeeded();
      expect(
        (await bounds(rows(page).last())).y +
          (await bounds(rows(page).last())).height,
      ).toBeLessThanOrEqual((await bounds(panel)).y);
    } else {
      expect(position).toBe("sticky");
      expect((await bounds(main)).width).toBeGreaterThan(1000);
      expect(tableBox.x).toBeGreaterThan(filterBox.x + filterBox.width);
      expect(panelBox.x).toBeGreaterThan(tableBox.x + tableBox.width);
      for (const [index, name] of [
        "Name",
        "Score",
        "Apartment",
        "Buying when",
        "Platform",
        "Time",
      ].entries()) {
        const header = table.getByRole("columnheader", { name, exact: true });
        await expect(header).toBeVisible();
        const headerBox = await bounds(header);
        for (const row of await rows(page).all()) {
          expect(headerBox.y + headerBox.height).toBeLessThan(
            (await bounds(row)).y,
          );
          const cell = await bounds(row.getByRole("cell").nth(index + 1));
          expect(Math.abs(cell.x - headerBox.x)).toBeLessThanOrEqual(2);
        }
      }
      const first = rows(page).first().getByRole("cell");
      expect((await bounds(first.nth(2))).x).toBeGreaterThan(
        (await bounds(first.nth(1))).x,
      );
    }
    const ids = await main
      .locator("[id]")
      .evaluateAll((elements) => elements.map((element) => element.id));
    expect(ids).toEqual([...new Set(ids)]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  });
});
