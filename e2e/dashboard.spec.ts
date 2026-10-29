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
) {
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
}

async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("Dashboard content is not visible");
  return box;
}

function teamRows(page: Page) {
  return page
    .getByRole("region", { name: "Team performance", exact: true })
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader") });
}

function summary(page: Page, label: string) {
  return page
    .getByRole("region", { name: "Team summary", exact: true })
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: label, exact: true }) });
}

test.describe("dashboard", () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    await setUser(context, baseURL, "rohan");
    await page.goto("/companies");
    await page.getByRole("button", { name: "Reset demo", exact: true }).click();
    await expect(page).toHaveURL("/sundar-heights/today");
    await expect(
      page.getByRole("button", { name: "Reset demo", exact: true }),
    ).toBeEnabled();
    await setUser(context, baseURL, "prakash");
    await page.goto("/sundar-heights/dashboard");
    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible();
    await expect(teamRows(page)).toHaveCount(5);
  });

  test("keeps tile periods fixed while Today, week, month and Custom change report headers", async ({
    page,
  }) => {
    const tiles = page.getByRole("region", {
      name: "Team summary",
      exact: true,
    });
    const original = (await tiles.textContent()) ?? "";
    for (const name of [
      "New leads · today",
      "Unassigned · now",
      "Overdue · now",
      "Site visits · this week",
      "Bookings · this month",
    ])
      await expect(
        tiles.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    const range = page.getByRole("combobox", {
      name: "Report range",
      exact: true,
    });
    const callsByRange = new Map<string, number>();
    for (const [value, label] of [
      ["today", "today"],
      ["month", "this month"],
      ["week", "this week"],
    ]) {
      await range.selectOption(value);
      await expect(
        page.getByRole("button", { name: new RegExp(`^Calls ${label}`) }),
      ).toBeVisible();
      await expect(tiles).toHaveText(original);
      const callsCell = teamRows(page)
        .filter({
          has: page.getByRole("button", {
            name: "Sunaina Shrestha",
            exact: true,
          }),
        })
        .getByRole("cell")
        .nth(1);
      const calls = Number(
        (await callsCell.textContent())?.match(/(\d+)\s*\//)?.[1],
      );
      expect(Number.isFinite(calls)).toBe(true);
      callsByRange.set(value, calls);
      const compareCalls = page
        .getByRole("region", { name: "Compare people", exact: true })
        .getByRole("definition")
        .first()
        .locator("span")
        .first();
      await expect(compareCalls).toHaveText(String(calls));
    }
    expect(callsByRange.get("month")).toBeGreaterThan(
      callsByRange.get("today") ?? 0,
    );
    await range.selectOption("custom");
    await page.getByLabel("From", { exact: true }).fill("2026-10-01");
    await page.getByLabel("To", { exact: true }).fill("2026-10-28");
    await page
      .getByRole("button", { name: "Apply range", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /^Calls 2026-10-01 to 2026-10-28/ }),
    ).toBeVisible();
    await expect(tiles).toHaveText(original);
    expect(new URL(page.url()).searchParams.get("from")).toBe("2026-10-01");
  });

  test("shows the selected comparison people and leaves the first out of the second picker", async ({
    page,
  }) => {
    const compare = page.getByRole("region", {
      name: "Compare people",
      exact: true,
    });
    const first = compare.getByRole("combobox", {
      name: "First person",
      exact: true,
    });
    const second = compare.getByRole("combobox", {
      name: "Second person",
      exact: true,
    });
    await expect(first).toHaveValue("sundar-heights-sunaina");
    await expect(second).toHaveValue("sundar-heights-aakash");
    await expect(first.locator("option:checked")).toHaveText(
      "Sunaina Shrestha",
    );
    await expect(second.locator("option:checked")).toHaveText("Aakash Pandey");
    await expect(
      second.getByRole("option", { name: "Sunaina Shrestha", exact: true }),
    ).toHaveCount(0);
    const oldMetrics = (await compare.locator("dl").textContent()) ?? "";
    await second.selectOption("sundar-heights-rojina");
    await expect(second).toHaveValue("sundar-heights-rojina");
    await expect(second.locator("option:checked")).toHaveText("Rojina Lama");
    await expect(compare.locator("dl")).not.toHaveText(oldMetrics);
    await first.selectOption("sundar-heights-rojina");
    await expect(first).toHaveValue("sundar-heights-rojina");
    await expect(second).toHaveValue("sundar-heights-sunaina");
    await expect(
      second.getByRole("option", { name: "Rojina Lama", exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(first).toHaveValue("sundar-heights-rojina");
    await expect(second).toHaveValue("sundar-heights-sunaina");
  });

  test("sorts every team column both ways and expands the member below the row", async ({
    page,
  }) => {
    const team = page.getByRole("region", {
      name: "Team performance",
      exact: true,
    });
    const overdue = team
      .getByRole("columnheader")
      .filter({ has: page.getByRole("button", { name: /^Overdue/ }) });
    await overdue.getByRole("button").click();
    await expect(teamRows(page).first().getByRole("rowheader")).toHaveText(
      "Rojina Lama",
    );
    const headings = team.getByRole("columnheader");
    for (let index = 0; index < (await headings.count()); index++) {
      const heading = headings.nth(index);
      await heading.getByRole("button").click();
      for (const direction of ["ascending", "descending"]) {
        if ((await heading.getAttribute("aria-sort")) !== direction)
          await heading.getByRole("button").click();
        await expect(heading).toHaveAttribute("aria-sort", direction);
        const values = await teamRows(page).evaluateAll(
          (rows, column) =>
            rows.map((row) => row.children[column].textContent ?? ""),
          index,
        );
        const ordered =
          index === 0
            ? values
                .map((value) => value.trim())
                .sort((a, b) => a.localeCompare(b))
            : values
                .map((value) =>
                  Number(value.match(/(\d+)(?:\s*\/\s*\d+)?\s*$/)?.[1]),
                )
                .sort((a, b) => a - b);
        if (direction === "descending") ordered.reverse();
        const actual =
          index === 0
            ? values.map((value) => value.trim())
            : values.map((value) =>
                Number(value.match(/(\d+)(?:\s*\/\s*\d+)?\s*$/)?.[1]),
              );
        expect(actual).toEqual(ordered);
      }
    }
    const person = team.getByRole("button", {
      name: "Sunaina Shrestha",
      exact: true,
    });
    await person.click();
    await expect(person).toHaveAttribute("aria-expanded", "true");
    const detail = team.getByRole("region", {
      name: "Sunaina Shrestha detail",
      exact: true,
    });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("Now: 3 overdue · 3 due today · 4 new");
    await expect(
      detail.getByRole("progressbar", { name: "Calls today", exact: true }),
    ).toHaveAttribute("max", "30");
    await expect(
      detail.getByRole("progressbar", {
        name: "Calls this week",
        exact: true,
      }),
    ).toHaveAttribute("max", "150");
    const personBox = await bounds(person);
    expect((await bounds(detail)).y).toBeGreaterThanOrEqual(
      personBox.y + personBox.height,
    );
    await person.click();
    await expect(detail).toBeHidden();
  });

  test("keeps backwards custom dates and shows the error at To", async ({
    page,
  }) => {
    await page
      .getByRole("combobox", { name: "Report range", exact: true })
      .selectOption("custom");
    const from = page.getByLabel("From", { exact: true });
    const to = page.getByLabel(/^To/);
    await from.fill("2026-10-28");
    await to.fill("2026-10-27");
    await page
      .getByRole("button", { name: "Apply range", exact: true })
      .click();
    await expect(from).toHaveValue("2026-10-28");
    await expect(to).toHaveValue("2026-10-27");
    await expect(to).toHaveAttribute("aria-invalid", "true");
    await expect(to).toHaveAccessibleDescription(
      "To must be on or after From.",
    );
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "To must be on or after From.",
    );
    expect(new URL(page.url()).searchParams.has("from")).toBe(false);
    await to.fill("2026-10-29");
    await page
      .getByRole("button", { name: "Apply range", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Team · 2026-10-28 to 2026-10-29",
        exact: true,
      }),
    ).toBeVisible();
    await expect(to).toHaveValue("2026-10-29");
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

  test("uses the phone queue link and assigns from the desktop aside without leaving Dashboard", async ({
    page,
    isMobile,
  }) => {
    const tile = summary(page, "Unassigned · now");
    await expect(tile).toContainText("45");
    const link = tile.getByRole("link", {
      name: "Assign leads",
      exact: true,
    });
    if (isMobile) {
      await expect(link).toHaveAttribute("href", "/sundar-heights/leads");
      await link.click();
      await expect(page).toHaveURL("/sundar-heights/leads");
      await expect(
        page.getByText("45 unassigned leads", { exact: true }),
      ).toBeVisible();
      return;
    }
    await expect(link).toHaveAttribute("href", "#unassigned");
    await link.click();
    const aside = page.getByRole("complementary", {
      name: "Unassigned leads",
      exact: true,
    });
    const checks = aside
      .getByRole("checkbox", { name: /^Select / })
      .filter({ visible: true });
    const rows = aside
      .getByRole("table")
      .getByRole("row")
      .filter({ has: page.getByRole("link") });
    await expect(rows).toHaveCount(45);
    await expect(checks).toHaveCount(46);
    for (let index = 0; index < 3; index++)
      await rows.nth(index).getByRole("checkbox").check();
    await aside
      .getByRole("combobox", { name: "Assign to", exact: true })
      .selectOption({ label: "Sunaina Shrestha" });
    await aside
      .getByRole("button", { name: "Assign 3 leads", exact: true })
      .click();
    await expect(tile).toContainText("42");
    await expect(aside.getByRole("status")).toHaveText(
      "3 leads assigned to Sunaina Shrestha.",
    );
    await expect(rows).toHaveCount(42);
    expect(new URL(page.url()).pathname).toBe("/sundar-heights/dashboard");
    await page.reload();
    await expect(tile).toContainText("42");
  });

  test("keeps Admins out and shows Pahad empty states without a load error", async ({
    context,
    page,
    baseURL,
  }) => {
    await setUser(context, baseURL, "sunaina");
    await page.goto("/sundar-heights/dashboard");
    await expect(page).toHaveURL("/sundar-heights/today");
    await expect(
      page.getByRole("region", { name: "Team summary", exact: true }),
    ).toHaveCount(0);
    await setUser(context, baseURL, "mina");
    await page.goto("/pahad-view/dashboard");
    await expect(
      page.getByRole("heading", { name: "No leads yet", exact: true }),
    ).toBeVisible();
    await expect(summary(page, "Unassigned · now")).toContainText("0");
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    const emptyQueue = page.getByRole("heading", {
      name: "No unassigned leads",
      exact: true,
    });
    if (
      await page
        .getByRole("complementary", { name: "Unassigned leads", exact: true })
        .isVisible()
    )
      await expect(emptyQueue).toBeVisible();
  });

  test("shows the load error without zero tiles and retries after the failure clears", async ({
    page,
  }) => {
    const failure = page.getByRole("checkbox", {
      name: "Simulate failure",
      exact: true,
    });
    try {
      await failure.click();
      await expect(failure).toBeChecked();
      await expect(failure).toBeEnabled();
      await page.reload();
      const shell = page.getByRole("region", {
        name: "Company shell",
        exact: true,
      });
      await expect(shell.getByRole("alert")).toHaveText(
        "Couldn't load this page",
      );
      await expect(
        shell.getByRole("region", { name: "Team summary", exact: true }),
      ).toHaveCount(0);
      await expect(
        shell.getByRole("heading", { name: "No leads yet", exact: true }),
      ).toHaveCount(0);
      await failure.click();
      await expect(failure).not.toBeChecked();
      await shell.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(
        shell.getByRole("heading", { name: "Dashboard", exact: true }),
      ).toBeVisible();
      await expect(summary(page, "Unassigned · now")).toContainText("45");
    } finally {
      await expect(failure).toBeEnabled();
      if (await failure.isChecked()) {
        await failure.click();
        await expect(failure).not.toBeChecked();
      }
    }
  });

  test("uses one team table and five desktop tiles beside the queue with no sideways scroll", async ({
    page,
    isMobile,
  }) => {
    const main = page.getByRole("main");
    const tiles = page
      .getByRole("region", { name: "Team summary", exact: true })
      .getByRole("article");
    const team = page.getByRole("region", {
      name: "Team performance",
      exact: true,
    });
    const aside = page.getByRole("complementary", {
      name: "Unassigned leads",
      exact: true,
    });
    await expect(tiles).toHaveCount(5);
    await expect(team.getByRole("table", { includeHidden: true })).toHaveCount(
      1,
    );
    await expect(
      main.getByRole("combobox", {
        name: "Report range",
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(1);
    for (const name of ["First person", "Second person"])
      await expect(
        main.getByRole("combobox", {
          name,
          exact: true,
          includeHidden: true,
        }),
      ).toHaveCount(1);
    await expect(
      main.getByRole("table", {
        name: "Unassigned leads",
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(1);
    const ids = await main
      .locator("[id]")
      .evaluateAll((elements) => elements.map((element) => element.id));
    expect(ids).toEqual([...new Set(ids)]);
    const boxes = await Promise.all((await tiles.all()).map(bounds));
    if (isMobile) {
      await expect(aside).toBeHidden();
      expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
    } else {
      expect((await bounds(main)).width).toBeGreaterThan(1000);
      for (const box of boxes)
        expect(Math.abs(box.y - boxes[0].y)).toBeLessThan(2);
      const teamBox = await bounds(team);
      const asideBox = await bounds(aside);
      expect(asideBox.x).toBeGreaterThan(teamBox.x + teamBox.width);
      const firstRow = await bounds(teamRows(page).first());
      for (const header of await team.getByRole("columnheader").all())
        expect(
          (await bounds(header)).y + (await bounds(header)).height,
        ).toBeLessThan(firstRow.y);
      const funnelBox = await bounds(
        page.getByRole("region", { name: "Lead funnel", exact: true }),
      );
      const compareBox = await bounds(
        page.getByRole("region", { name: "Compare people", exact: true }),
      );
      expect(compareBox.x).toBeGreaterThan(funnelBox.x + funnelBox.width);
      expect(Math.abs(compareBox.y - funnelBox.y)).toBeLessThan(2);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  });
});
