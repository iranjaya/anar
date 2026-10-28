import { expect, type Locator, type Page, test } from "@playwright/test";

const fileName =
  "Sundar Heights 2 3 BHK October_Leads_2026-10-14_2026-10-28.csv";
const timeline = "when_are_you_planning_to_purchase?_";
const systemColumns = [
  ["created_time", "lead_date"],
  ["campaign_name", "campaign_name"],
  ["platform", "source"],
  ["full_name", "full_name"],
  ["phone", "phone"],
  ["email", "email"],
];
const newColumns = [
  ["which_apartment_are_you_planning_to_purchase?", "Apartment type"],
  [timeline, "Purchase timeline"],
  ["what_is_your_primary_purpose?", "Purchase purpose"],
  ["job_title", "Job title"],
];

async function pickFile(page: Page) {
  await page.getByLabel("Meta CSV file", { exact: true }).setInputFiles({
    name: fileName,
    mimeType: "text/csv",
    buffer: Buffer.from("Fictional demo file"),
  });
}

async function expectNoOverflow(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Set a viewport for this check.");
  const content = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(content).toBeLessThanOrEqual(viewport.width);
}

async function bounds(locator: Locator) {
  return locator.evaluate((element) => {
    const { x, y, width } = element.getBoundingClientRect();
    return { x, y, width };
  });
}

test.describe("import columns", () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    await context.addCookies([
      {
        name: "anar_demo",
        value: JSON.stringify({
          userId: "rohan",
          actingCompanyId: "pahad-view",
        }),
        url: baseURL,
      },
    ]);
    await page.goto("/pahad-view/imports/new");
    await expect(
      page.getByRole("heading", { name: "Import leads" }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", {
        name: "Import steps",
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(1);
  });

  test("matches each column and remaps the timeline", async ({ page }) => {
    await pickFile(page);
    await expect(
      page.getByText("64 rows · 10 columns", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Saved mapping found", { exact: true }),
    ).toHaveCount(0);
    await expectNoOverflow(page);
    await page
      .getByRole("link", { name: "Match columns", exact: true })
      .click();
    for (const [header, target] of systemColumns) {
      await expect(
        page.getByRole("combobox", {
          name: `Map ${header}`,
          exact: true,
          includeHidden: true,
        }),
      ).toHaveValue(`system:${target}`);
    }
    await expect(
      page.getByRole("group", {
        name: "New field",
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(4);
    for (const [index, [header, label]] of newColumns.entries()) {
      await expect(
        page.getByRole("combobox", { name: `Map ${header}`, exact: true }),
      ).toHaveValue("new");
      await expect(
        page.getByRole("textbox", { name: "Label", exact: true }).nth(index),
      ).toHaveValue(label);
    }
    await page
      .getByRole("combobox", { name: `Map ${timeline}`, exact: true })
      .selectOption("field:purchase_timeline");
    await expect(
      page.getByRole("combobox", { name: `Map ${timeline}`, exact: true }),
    ).toHaveValue("field:purchase_timeline");
    await expect(
      page.getByRole("combobox", { name: "Map phone", exact: true }),
    ).toHaveValue("system:phone");
    await expect(
      page.getByRole("group", { name: "New field", exact: true }),
    ).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: "Check 64 rows", exact: true }),
    ).toBeEnabled();
    await expectNoOverflow(page);
  });

  test("keeps field edits local and explains an invalid key", async ({
    page,
  }) => {
    await pickFile(page);
    await page
      .getByRole("link", { name: "Match columns", exact: true })
      .click();
    const fields = page.getByRole("group", {
      name: "New field",
      exact: true,
    });
    const apartment = fields.nth(0);
    await apartment
      .getByRole("textbox", { name: "Label", exact: true })
      .fill("Apartment choice");
    await apartment
      .getByRole("textbox", { name: "Label for 3_bhk", exact: true })
      .fill("Three bedrooms");
    await expect(
      fields.nth(1).getByRole("textbox", { name: "Label", exact: true }),
    ).toHaveValue("Purchase timeline");
    await expect(apartment.getByText("3_bhk", { exact: true })).toBeVisible();
    const key = apartment.getByRole("textbox", { name: "Key", exact: true });
    await key.fill("purchase_timeline");
    await expect(
      page.getByText(
        "New field keys must be unique. You can also select an existing company field.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Check 64 rows", exact: true }),
    ).toBeDisabled();
    await key.fill("apartment_choice");
    await expect(
      page.getByRole("button", { name: "Check 64 rows", exact: true }),
    ).toBeEnabled();
    const job = fields.nth(3);
    await job
      .getByRole("combobox", { name: "Type", exact: true })
      .selectOption("dropdown");
    await expect(
      job.getByRole("textbox", { name: "Label for Engineer", exact: true }),
    ).toHaveValue("Engineer");
    await expect(
      page.getByRole("button", { name: "Check 64 rows", exact: true }),
    ).toBeEnabled();
  });

  test("finds Sundar's saved mapping with one main action", async ({
    page,
  }) => {
    await page
      .getByRole("combobox", { name: "Company", exact: true })
      .selectOption("sundar-heights");
    await expect(page).toHaveURL("/sundar-heights/imports/new");
    await pickFile(page);
    const details = page.getByRole("region", {
      name: "What the file holds",
      exact: true,
    });
    await expect(
      details.getByRole("heading", {
        name: "Saved mapping found",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      details.getByText("412 rows · 10 columns", { exact: true }),
    ).toBeVisible();
    const check = details.getByRole("link", {
      name: "Check 412 rows",
      exact: true,
    });
    const review = details.getByRole("link", {
      name: "Review columns",
      exact: true,
    });
    await expect(check).toHaveCount(1);
    await expect(check).toHaveAttribute("href", /\/map\?step=check$/);
    await expect(review).toHaveAttribute("href", /\/map$/);
    expect(
      await check.evaluate((link) => getComputedStyle(link).backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)");
    expect(
      await review.evaluate((link) => getComputedStyle(link).backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
    await expectNoOverflow(page);
    await review.click();
    await expect(
      page.getByRole("combobox", { name: `Map ${timeline}`, exact: true }),
    ).toHaveValue("field:purchase_timeline");
    await expect(
      page.getByRole("group", { name: "New field", exact: true }),
    ).toHaveCount(0);
  });

  test("keeps the company and file after a failed upload and retries", async ({
    page,
  }) => {
    await page.route(
      "**/api/imports",
      (route) =>
        route.fulfill({
          status: 503,
          json: {
            ok: false,
            error: "unavailable",
            message: "Couldn't upload this file. Try again.",
          },
        }),
      { times: 1 },
    );
    await pickFile(page);
    const file = page.getByRole("region", {
      name: "Company and file",
      exact: true,
    });
    await expect(file.getByRole("alert")).toHaveText(
      "Couldn't upload this file. Try again.",
    );
    await expect(
      file.getByRole("combobox", { name: "Company", exact: true }),
    ).toHaveValue("pahad-view");
    await expect(page).toHaveURL("/pahad-view/imports/new");
    expect(
      await file
        .getByLabel("Meta CSV file", { exact: true })
        .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
    ).toBe(fileName);
    await file
      .getByRole("button", { name: "Retry upload", exact: true })
      .click();
    await expect(
      page.getByText("64 rows · 10 columns", { exact: true }),
    ).toBeVisible();
    await expect(file.getByRole("alert")).toHaveCount(0);
    await expectNoOverflow(page);
  });

  test("uses desktop columns and a mapping table without sideways scroll", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop layout");
    await pickFile(page);
    await expect(
      page.getByText("64 rows · 10 columns", { exact: true }),
    ).toBeVisible();
    const rail = page.getByRole("complementary", {
      name: "Import progress",
      exact: true,
    });
    const file = page.getByRole("region", {
      name: "Company and file",
      exact: true,
    });
    const details = page.getByRole("region", {
      name: "What the file holds",
      exact: true,
    });
    await expect(rail).toBeVisible();
    const railBox = await bounds(rail);
    const fileBox = await bounds(file);
    const detailsBox = await bounds(details);
    expect(railBox.x + railBox.width).toBeLessThan(fileBox.x);
    expect(fileBox.x + fileBox.width).toBeLessThan(detailsBox.x);
    expect(Math.abs(fileBox.y - detailsBox.y)).toBeLessThan(2);
    expect((await bounds(page.getByRole("main"))).width).toBeGreaterThan(1000);
    await expectNoOverflow(page);
    await page
      .getByRole("link", { name: "Match columns", exact: true })
      .click();
    const table = page.getByRole("table", {
      name: "Match CSV columns to lead fields",
      exact: true,
    });
    await expect(table).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(11);
    for (const [header] of [...systemColumns, ...newColumns]) {
      await expect(
        table.getByRole("rowheader").filter({ hasText: header }),
      ).toHaveCount(1);
    }
    expect((await bounds(page.getByRole("main"))).width).toBeGreaterThan(1000);
    await expectNoOverflow(page);
    const timelineTarget = page.getByRole("combobox", {
      name: `Map ${timeline}`,
      exact: true,
      includeHidden: true,
    });
    await timelineTarget.selectOption("field:purchase_timeline");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(timelineTarget).toHaveCount(1);
    await expect(timelineTarget).toHaveValue("field:purchase_timeline");
    await expect(
      page.getByRole("list", {
        name: "Import steps",
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(1);
    await expectNoOverflow(page);
  });

  test("keeps the upload form mounted with Simulate failure on", () => {
    test.fixme(
      true,
      "The shared tenant toggle refreshes the layout and unmounts the form. Deferred with approval.",
    );
  });
});
