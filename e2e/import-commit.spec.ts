import { expect, type Locator, type Page, test } from "@playwright/test";

const fileName =
  "Sundar Heights 2 3 BHK October_Leads_2026-10-14_2026-10-28.csv";
const resubmissions = "New submissions from existing leads";
const timeline = "when_are_you_planning_to_purchase?_";

async function pickFile(page: Page) {
  await page.getByLabel("Meta CSV file", { exact: true }).setInputFiles({
    name: fileName,
    mimeType: "text/csv",
    buffer: Buffer.from("Fictional demo file"),
  });
}

async function bounds(locator: Locator) {
  return locator.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
}

async function expectLayout(page: Page, summaryName: string, desktop: boolean) {
  const summary = page.getByRole("region", { name: summaryName, exact: true });
  const rows = page.getByRole("region", { name: resubmissions, exact: true });
  const summaryBox = await bounds(summary);
  const rowsBox = await bounds(rows);
  await expect(
    rows.getByRole("list", {
      name: resubmissions,
      exact: true,
      includeHidden: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("list", {
      name: "Import steps",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveCount(1);
  if (desktop) {
    expect(summaryBox.x + summaryBox.width).toBeLessThan(rowsBox.x);
    expect((await bounds(page.getByRole("main"))).width).toBeGreaterThan(1000);
    const firstRow = await bounds(rows.getByRole("listitem").first());
    for (const header of ["Row", "Name", "Why", "Lead"]) {
      const label = rows.getByText(header, { exact: true });
      await expect(label).toBeVisible();
      expect((await bounds(label)).y).toBeLessThan(firstRow.y);
    }
  } else {
    expect(rowsBox.y).toBeGreaterThan(summaryBox.y + summaryBox.height);
  }
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Set a viewport for this check.");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(viewport.width);
}

async function formValues(page: Page) {
  return {
    mapping: await page
      .getByRole("combobox", { name: /^Map / })
      .evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLSelectElement).value),
      ),
    text: await page
      .getByRole("textbox")
      .evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).value),
      ),
    types: await page
      .getByRole("combobox", { name: "Type", exact: true })
      .evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLSelectElement).value),
      ),
    save: await page
      .getByRole("checkbox", {
        name: "Save this mapping for next time",
        exact: true,
      })
      .isChecked(),
  };
}

test.describe("import check and result", () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    const cookie = {
      name: "anar_demo",
      value: JSON.stringify({
        userId: "rohan",
        actingCompanyId: "sundar-heights",
      }),
      url: baseURL,
    };
    await context.addCookies([cookie]);
    await page.goto("/companies");
    await page.getByRole("button", { name: "Reset demo", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Demo user", exact: true }),
    ).toHaveValue("sunaina");
    await context.addCookies([cookie]);
    await page.goto("/sundar-heights/imports/new");
    await expect(
      page.getByRole("heading", { name: "Import leads", exact: true }),
    ).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    await page.getByRole("button", { name: "Reset demo", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Demo user", exact: true }),
    ).toHaveValue("sunaina");
  });

  test("imports Sundar in one check and opens the affected leads", async ({
    page,
  }, testInfo) => {
    await pickFile(page);
    await page
      .getByRole("link", { name: "Check 412 rows", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "374 already in, 38 new",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "38 new out of 412 rows", exact: true }),
    ).toBeVisible();
    const pendingPhones = page.getByRole("region", {
      name: "Will import, needs phone review",
      exact: true,
    });
    await expect(pendingPhones.getByRole("listitem")).toHaveCount(2);
    await expect(
      pendingPhones.getByText("Available after import", { exact: true }),
    ).toHaveCount(2);
    await expect(pendingPhones.getByRole("link")).toHaveCount(0);
    await expect(
      page
        .getByRole("region", { name: resubmissions, exact: true })
        .getByRole("link"),
    ).toHaveCount(3);
    await expectLayout(
      page,
      "Import check summary",
      testInfo.project.name === "desktop",
    );
    await page
      .getByRole("button", { name: "Import 38 leads", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "38 added", exact: true }),
    ).toBeVisible();
    await expectLayout(
      page,
      "Import result summary",
      testInfo.project.name === "desktop",
    );
    const summary = page.getByRole("region", {
      name: "Import result summary",
      exact: true,
    });
    const queue = summary.getByRole("link", {
      name: "Open queue",
      exact: true,
    });
    const another = summary.getByRole("link", {
      name: "Import another",
      exact: true,
    });
    await expect(queue).toHaveCount(1);
    await expect(queue).toHaveAttribute("href", "/sundar-heights/leads");
    await expect(another).toHaveAttribute(
      "href",
      "/sundar-heights/imports/new",
    );
    expect(
      await queue.evaluate((link) => getComputedStyle(link).backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)");
    expect(
      await another.evaluate((link) => getComputedStyle(link).backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
    for (const [title, count] of [
      [resubmissions, 3],
      ["Added leads that need phone review", 2],
    ] as const) {
      const links = page
        .getByRole("region", { name: title, exact: true })
        .getByRole("link");
      await expect(links).toHaveCount(count);
      for (let index = 0; index < count; index++) {
        const link = links.nth(index);
        const name = (await link.getAttribute("aria-label"))?.replace(
          /^Open lead from row \d+: /,
          "",
        );
        await expect(link).toHaveAttribute(
          "href",
          /^\/sundar-heights\/leads\//,
        );
        await link.click();
        await expect(page).toHaveURL(/\/sundar-heights\/leads\/[^/]+$/);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          name ?? "",
        );
        await page.goBack();
        await expect(
          page.getByRole("heading", { name: "38 added", exact: true }),
        ).toBeVisible();
      }
    }
  });

  test("keeps every target and edited label when going back to columns", async ({
    page,
  }) => {
    await page
      .getByRole("combobox", { name: "Company", exact: true })
      .selectOption("pahad-view");
    await expect(page).toHaveURL("/pahad-view/imports/new");
    await pickFile(page);
    await page
      .getByRole("link", { name: "Match columns", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: `Map ${timeline}`, exact: true })
      .selectOption("field:purchase_timeline");
    await page
      .getByRole("combobox", { name: "Map job_title", exact: true })
      .selectOption("skip");
    const fields = page.getByRole("group", {
      name: "New field",
      exact: true,
    });
    const apartment = fields.nth(0);
    await apartment
      .getByRole("textbox", { name: "Key", exact: true })
      .fill("apartment_choice");
    await apartment
      .getByRole("textbox", { name: "Label", exact: true })
      .fill("Apartment choice");
    await apartment
      .getByRole("textbox", { name: "Label for 3_bhk", exact: true })
      .fill("Three bedrooms");
    await fields
      .nth(1)
      .getByRole("textbox", { name: "Label", exact: true })
      .fill("Reason to buy");
    await fields
      .nth(1)
      .getByRole("combobox", { name: "Type", exact: true })
      .selectOption("text");
    await page
      .getByRole("checkbox", {
        name: "Save this mapping for next time",
        exact: true,
      })
      .check();
    const before = await formValues(page);
    expect(before.mapping).toHaveLength(10);
    await page
      .getByRole("button", { name: "Check 64 rows", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "0 already in, 64 new",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Back to columns", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Match columns", exact: true }),
    ).toBeVisible();
    expect(await formValues(page)).toEqual(before);
    await expect(
      apartment.getByRole("textbox", { name: "Key", exact: true }),
    ).toHaveValue("apartment_choice");
    await expect(
      apartment.getByRole("textbox", { name: "Label", exact: true }),
    ).toHaveValue("Apartment choice");
    await expect(
      apartment.getByRole("textbox", {
        name: "Label for 3_bhk",
        exact: true,
      }),
    ).toHaveValue("Three bedrooms");
    await expect(
      fields.nth(1).getByRole("textbox", { name: "Label", exact: true }),
    ).toHaveValue("Reason to buy");
  });

  test("keeps step 3 on failure and imports after failure is off", {
    tag: "@failure",
  }, async ({ page }) => {
    await pickFile(page);
    await page
      .getByRole("link", { name: "Check 412 rows", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "374 already in, 38 new",
        exact: true,
      }),
    ).toBeVisible();
    const url = page.url();
    const failure = page.getByRole("checkbox", {
      name: "Simulate failure",
      exact: true,
    });
    const summary = page.getByRole("region", {
      name: "Import check summary",
      exact: true,
    });
    try {
      await failure.click();
      await expect(failure).toBeChecked();
      await summary
        .getByRole("button", { name: "Import 38 leads", exact: true })
        .click();
      await expect(summary.getByRole("alert")).toHaveText(
        "Couldn't load demo data. Try again.",
      );
      await expect(page).toHaveURL(url);
      await expect(
        summary.getByRole("heading", {
          name: "374 already in, 38 new",
          exact: true,
        }),
      ).toBeVisible();
      const errorBox = await bounds(summary.getByRole("alert"));
      const buttonBox = await bounds(
        summary.getByRole("button", { name: "Import 38 leads", exact: true }),
      );
      expect(errorBox.y + errorBox.height).toBeLessThanOrEqual(buttonBox.y);
      await expect(
        page
          .getByRole("region", { name: resubmissions, exact: true })
          .getByRole("link"),
      ).toHaveCount(3);
    } finally {
      if (await failure.isChecked()) {
        await failure.click();
        await expect(failure).not.toBeChecked();
      }
    }
    await summary
      .getByRole("button", { name: "Import 38 leads", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "38 added", exact: true }),
    ).toBeVisible();
  });
});
