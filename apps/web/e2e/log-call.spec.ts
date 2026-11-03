import { type BrowserContext, expect, test } from "@playwright/test";

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

test.describe("call logging", () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    await setUser(context, baseURL, "rohan");
    await page.goto("/companies");
    await page.getByRole("button", { name: "Reset demo", exact: true }).click();
    await expect(page).toHaveURL("/sundar-heights/today");
    await expect(
      page.getByRole("button", { name: "Reset demo", exact: true }),
    ).toBeEnabled();
  });

  test.afterEach(async ({ page }) => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  });

  test("saves Tomorrow and selects the next overdue lead on Today", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/sundar-heights/today?lead=sundar-lead-001");
    await page.getByRole("link", { name: "Log a call", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Log a call", exact: true });
    await expect(sheet).toHaveCount(1);
    const save = sheet.getByRole("button", {
      name: "Save and next lead",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await expect(
      sheet.getByText("Pick an outcome", { exact: true }),
    ).toBeVisible();
    await expect(sheet.getByRole("alert")).toHaveCount(0);
    const primaryColor = await save.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    for (const button of await sheet.getByRole("button").all()) {
      if ((await button.textContent())?.trim() === "Save and next lead")
        continue;
      expect(
        await button.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      ).not.toBe(primaryColor);
    }
    const box = await sheet.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      if (isMobile) {
        expect(Math.abs(box.y + box.height - 844)).toBeLessThanOrEqual(1);
        expect(box.width).toBe(390);
      } else {
        expect(box.x).toBe(960);
        expect(box.width).toBe(480);
        expect(box.y).toBe(0);
        const heading = page.getByRole("heading", {
          name: "Bikash Thapa",
          exact: true,
          includeHidden: true,
        });
        const headingBox = await heading.boundingBox();
        expect(headingBox).not.toBeNull();
        if (headingBox) expect(headingBox.x).toBeLessThan(box.x);
        expect(
          (await page.getByRole("main", { includeHidden: true }).boundingBox())
            ?.width,
        ).toBeGreaterThan(1000);
        const tomorrow = await sheet
          .getByRole("button", { name: "Tomorrow", exact: true })
          .boundingBox();
        const pick = await sheet
          .getByRole("button", { name: "Pick date", exact: true })
          .boundingBox();
        expect(tomorrow?.y).toBe(pick?.y);
        const outcomes = sheet
          .getByRole("group", { name: "Outcome", exact: true })
          .getByRole("button");
        const first = await outcomes.nth(0).boundingBox();
        const second = await outcomes.nth(1).boundingBox();
        expect(first?.y).toBe(second?.y);
        expect(second?.x).toBeGreaterThan(first?.x ?? 0);
      }
    }
    await sheet.getByRole("button", { name: "No Answer", exact: true }).click();
    await sheet.getByRole("button", { name: "Tomorrow", exact: true }).click();
    await save.click();
    await expect(page).toHaveURL("/sundar-heights/today?lead=sundar-lead-002");
    await expect(sheet).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Anita Maharjan", exact: true }),
    ).toBeVisible();
    if (isMobile)
      await page
        .getByRole("link", { name: "Back to the list", exact: true })
        .click();
    const overdue = page.getByRole("region", {
      name: "Overdue 2",
      exact: true,
    });
    await expect(overdue).toBeVisible();
    await expect(
      overdue.getByRole("link", { name: "Bikash Thapa", exact: true }),
    ).toHaveCount(0);
    await page.goto("/sundar-heights/leads/sundar-lead-001");
    await expect(
      page
        .getByRole("region", { name: "Timeline", exact: true })
        .getByRole("listitem")
        .first(),
    ).toContainText("Tomorrow 10:00");
  });

  test("stays in the original bucket and returns to Today when it is empty", async ({
    page,
  }) => {
    await page.goto("/sundar-heights/today?lead=sundar-lead-004&log=1");
    for (const next of ["sundar-lead-005", "sundar-lead-006", null]) {
      const sheet = page.getByRole("dialog", {
        name: "Log a call",
        exact: true,
      });
      await sheet
        .getByRole("button", { name: "No Answer", exact: true })
        .click();
      await sheet
        .getByRole("button", { name: "Tomorrow", exact: true })
        .click();
      await sheet
        .getByRole("button", { name: "Save and next lead", exact: true })
        .click();
      await expect(page).toHaveURL(
        next ? `/sundar-heights/today?lead=${next}` : "/sundar-heights/today",
      );
      await expect(sheet).toHaveCount(0);
      if (next)
        await page
          .getByRole("link", { name: "Log a call", exact: true })
          .click();
    }
  });

  test("requires a lost reason, keeps the note and fits seven choices", async ({
    page,
  }) => {
    await page.goto("/sundar-heights/leads/sundar-lead-001?log=1");
    const sheet = page.getByRole("dialog", { name: "Log a call", exact: true });
    await sheet.getByRole("button", { name: "No Answer", exact: true }).click();
    await sheet.getByRole("button", { name: "Lost", exact: true }).click();
    const save = sheet.getByRole("button", {
      name: "Mark as Lost",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await expect(
      sheet.getByText("Pick why it was lost", { exact: true }),
    ).toBeVisible();
    const note = sheet.getByRole("textbox", { name: "Note", exact: true });
    await note.fill("Asked us to stop calling");
    await expect(
      sheet.getByRole("group", { name: "Next follow-up", exact: true }),
    ).toHaveCount(0);
    const reasons = sheet.getByRole("group", {
      name: "Lost reason",
      exact: true,
    });
    await expect(reasons.getByRole("button")).toHaveCount(7);
    for (const button of await reasons.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(
          page.viewportSize()?.width ?? 0,
        );
      }
    }
    await reasons
      .getByRole("button", { name: "Too Expensive", exact: true })
      .click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(sheet).toHaveCount(0);
    await page.goto("/sundar-heights/leads/sundar-lead-001");
    await expect(
      page
        .getByRole("region", { name: "Timeline", exact: true })
        .getByText("Too Expensive", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Timeline", exact: true })
        .getByText("Asked us to stop calling", { exact: true }),
    ).toBeVisible();
  });

  test("keeps the latest Lost stage when opened after the banner save", async ({
    context,
    page,
    baseURL,
  }) => {
    await setUser(context, baseURL, "prakash");
    await page.goto("/sundar-heights/leads/sundar-lead-004");
    const banner = page.getByRole("region", {
      name: "Lost suggestion",
      exact: true,
    });
    await banner
      .getByRole("button", { name: "Mark as Lost", exact: true })
      .click();
    await banner
      .getByRole("button", { name: "Too Expensive", exact: true })
      .click();
    await banner
      .getByRole("button", { name: "Mark as Lost", exact: true })
      .click();
    await expect(banner).toHaveCount(0);
    await page.getByRole("link", { name: "Log a call", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Log a call", exact: true });
    await expect(
      sheet.getByRole("button", { name: "Lost", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      sheet.getByRole("button", { name: "Too Expensive", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await sheet.getByRole("button", { name: "No Answer", exact: true }).click();
    await sheet
      .getByRole("button", { name: "Mark as Lost", exact: true })
      .click();
    await expect(sheet).toHaveCount(0);
    await expect(
      page
        .getByRole("region", { name: "Lead detail", exact: true })
        .getByText("Lost", { exact: true }),
    ).toBeVisible();
  });

  test("keeps the call details after a failed save and retries", {
    tag: "@failure",
  }, async ({ context, page }) => {
    const controls = await context.newPage();
    await controls.goto("/sundar-heights/today");
    const failure = controls.getByRole("checkbox", {
      name: "Simulate failure",
      exact: true,
    });
    await page.goto("/sundar-heights/leads/sundar-lead-001?log=1");
    const sheet = page.getByRole("dialog", { name: "Log a call", exact: true });
    const outcome = sheet.getByRole("button", {
      name: "Callback Requested",
      exact: true,
    });
    const note = sheet.getByRole("textbox", { name: "Note", exact: true });
    const stage = sheet.getByRole("button", { name: "Qualified", exact: true });
    const save = sheet.getByRole("button", {
      name: "Save and next lead",
      exact: true,
    });
    await outcome.click();
    await note.fill("Call after lunch.");
    await sheet.getByRole("button", { name: "Pick date", exact: true }).click();
    const date = sheet.getByLabel("Follow-up date, 10:00", {
      exact: true,
    });
    await date.fill("2026-11-15");
    await stage.click();
    try {
      await failure.click();
      await expect(failure).toBeChecked();
      await expect(failure).toBeEnabled();
      await save.click();
      const error = sheet.getByRole("alert");
      await expect(error).toHaveText("Couldn't load demo data. Try again.");
      await expect(outcome).toHaveAttribute("aria-pressed", "true");
      await expect(note).toHaveValue("Call after lunch.");
      await expect(date).toHaveValue("2026-11-15");
      await expect(stage).toHaveAttribute("aria-pressed", "true");
      expect((await error.boundingBox())?.y).toBeLessThan(
        (await save.boundingBox())?.y ?? 0,
      );
      await failure.click();
      await expect(failure).not.toBeChecked();
      await expect(failure).toBeEnabled();
      await save.click();
      await expect(page).toHaveURL(
        "/sundar-heights/today?lead=sundar-lead-002",
      );
      await page.goto("/sundar-heights/leads/sundar-lead-001");
      await expect(
        page
          .getByRole("region", { name: "Timeline", exact: true })
          .getByText("Call after lunch.", { exact: true }),
      ).toBeVisible();
    } finally {
      await expect(failure).toBeEnabled();
      if (await failure.isChecked()) {
        await failure.click();
        await expect(failure).not.toBeChecked();
      }
      await controls.close();
    }
  });

  test("hides call logging from DNA even with a direct log URL", async ({
    context,
    page,
    baseURL,
  }) => {
    await setUser(context, baseURL, "rohan");
    await page.goto("/sundar-heights/leads/sundar-lead-001?log=1");
    await expect(
      page.getByRole("heading", { name: "Bikash Thapa", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Log a call", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
