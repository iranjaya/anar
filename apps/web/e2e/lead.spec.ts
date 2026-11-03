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

test.describe("lead detail", () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    await setUser(context, baseURL, "rohan");
    await page.goto("/companies");
    await page.getByRole("button", { name: "Reset demo", exact: true }).click();
    await expect(page).toHaveURL("/sundar-heights/today");
    await expect(
      page.getByRole("button", { name: "Reset demo", exact: true }),
    ).toBeEnabled();
    await page.goto("/sundar-heights/leads/sundar-lead-001");
    await expect(
      page.getByRole("heading", { name: "Bikash Thapa", exact: true }),
    ).toBeVisible();
  });

  test("shows the score, contact controls, answers and call history", async ({
    page,
  }) => {
    const detail = page.getByRole("region", {
      name: "Lead detail",
      exact: true,
    });
    await expect(detail.getByText("Hot · 10", { exact: true })).toBeVisible();
    await expect(
      detail.getByRole("link", { name: "Call", exact: true }),
    ).toHaveAttribute("href", "tel:+9779810000000");
    await expect(
      detail.getByRole("link", { name: "WhatsApp", exact: true }),
    ).toHaveAttribute("href", "https://wa.me/9779810000000");
    await expect(
      detail.getByRole("link", { name: "Email", exact: true }),
    ).toHaveAttribute("href", "mailto:lead-1@example.test");
    await detail.getByText("Why Hot", { exact: true }).click();
    await expect(
      detail.getByText("Hot starts at 8", { exact: true }),
    ).toBeVisible();
    const answers = detail.getByRole("region", {
      name: "Form answers",
      exact: true,
    });
    await expect(
      answers.getByText("Within 1 month", { exact: true }),
    ).toBeVisible();
    await expect(answers.getByText("3 BHK", { exact: true })).toBeVisible();
    await expect(
      answers.getByText("within_1_month", { exact: true }),
    ).toHaveCount(0);
    const timeline = detail.getByRole("region", {
      name: "Timeline",
      exact: true,
    });
    await expect(
      timeline.getByRole("listitem").first().getByRole("heading"),
    ).toHaveText("No Answer");
    await expect(
      timeline.getByText("Asked to call again.", { exact: true }),
    ).toBeVisible();
    await detail.getByRole("link", { name: "Log a call", exact: true }).click();
    await expect(page).toHaveURL("/sundar-heights/leads/sundar-lead-001?log=1");
  });

  test("disables invalid phones and hides Email when missing", async ({
    page,
  }) => {
    await page.goto("/sundar-heights/leads/sundar-lead-009");
    const detail = page.getByRole("region", {
      name: "Lead detail",
      exact: true,
    });
    await expect(
      detail.getByRole("button", { name: "Call", exact: true }),
    ).toBeDisabled();
    await expect(
      detail.getByText("Phone needs review", { exact: true }),
    ).toBeVisible();
    await expect(detail.locator('a[href^="tel:"]')).toHaveCount(0);
    await expect(
      detail.getByRole("link", { name: "WhatsApp", exact: true }),
    ).toHaveCount(0);
    await page.goto("/sundar-heights/leads/sundar-lead-010");
    await expect(
      detail.getByRole("link", { name: "Email", exact: true }),
    ).toHaveCount(0);
    await expect(
      detail.getByRole("link", { name: "Call", exact: true }),
    ).toHaveAttribute("href", "tel:+9779810000009");
  });

  test("hides a foreign lead from an Admin", async ({ page }) => {
    await page.goto("/sundar-heights/leads/sundar-lead-011");
    await expect(
      page.getByRole("heading", { name: "404", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Lead detail", exact: true }),
    ).toHaveCount(0);
  });

  for (const userId of ["sunaina", "prakash", "rohan"]) {
    test(`checks the lost banner for ${userId}`, async ({
      context,
      page,
      baseURL,
    }) => {
      await setUser(context, baseURL, userId);
      await page.goto("/sundar-heights/leads/sundar-lead-004");
      await expect(
        page.getByRole("heading", { name: "Nirmal Adhikari", exact: true }),
      ).toBeVisible();
      const banner = page.getByRole("region", {
        name: "Lost suggestion",
        exact: true,
      });
      if (userId === "sunaina") await expect(banner).toHaveCount(0);
      else await expect(banner).toContainText("5 failed attempts");
    });
  }

  test("keeps trying without changing the stage", async ({
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
      .getByRole("button", { name: "Keep trying", exact: true })
      .click();
    await expect(banner).toHaveCount(0);
    const timeline = page.getByRole("region", {
      name: "Timeline",
      exact: true,
    });
    await expect(
      timeline.getByRole("listitem").first().getByRole("heading"),
    ).toHaveText("Keep trying");
    await page.reload();
    await expect(banner).toHaveCount(0);
    await expect(
      page
        .getByRole("region", { name: "Lead detail", exact: true })
        .getByText("Follow-up", { exact: true }),
    ).toBeVisible();
  });

  test("keeps the chosen lost reason after a failed save and retries", {
    tag: "@failure",
  }, async ({ context, page, baseURL }) => {
    await setUser(context, baseURL, "prakash");
    await page.goto("/sundar-heights/leads/sundar-lead-004");
    const banner = page.getByRole("region", {
      name: "Lost suggestion",
      exact: true,
    });
    const mark = banner.getByRole("button", {
      name: "Mark as Lost",
      exact: true,
    });
    await mark.click();
    await expect(mark).toBeDisabled();
    await expect(
      banner.getByText("Pick why it was lost", { exact: true }),
    ).toBeVisible();
    const reasons = banner.getByRole("group", {
      name: "Lost reason",
      exact: true,
    });
    await expect(reasons.getByRole("button")).toHaveCount(7);
    const reason = reasons.getByRole("button", {
      name: "Too Expensive",
      exact: true,
    });
    await reason.click();
    await expect(reason).toHaveAttribute("aria-pressed", "true");
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
    const failure = page.getByRole("checkbox", {
      name: "Simulate failure",
      exact: true,
    });
    try {
      await failure.click();
      await expect(failure).toBeChecked();
      await expect(failure).toBeEnabled();
      await expect(
        page.getByRole("heading", { name: "Nirmal Adhikari", exact: true }),
      ).toBeVisible();
      await expect(reason).toHaveAttribute("aria-pressed", "true");
      await mark.click();
      await expect(banner.getByRole("alert")).toHaveText(
        "Couldn't load demo data. Try again.",
      );
      await expect(reason).toHaveAttribute("aria-pressed", "true");
      await expect(reasons.getByRole("button")).toHaveCount(7);
      await failure.click();
      await expect(failure).not.toBeChecked();
      await expect(failure).toBeEnabled();
      await expect(reason).toHaveAttribute("aria-pressed", "true");
      await mark.click();
      await expect(banner).toHaveCount(0);
      const timeline = page.getByRole("region", {
        name: "Timeline",
        exact: true,
      });
      await expect(
        timeline.getByText("Moved to Lost", { exact: true }),
      ).toBeVisible();
      await expect(
        timeline.getByText("Too Expensive", { exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page
          .getByRole("region", { name: "Lead detail", exact: true })
          .getByText("Lost", { exact: true }),
      ).toBeVisible();
    } finally {
      await expect(failure).toBeEnabled();
      if (await failure.isChecked()) {
        await failure.click();
        await expect(failure).not.toBeChecked();
      }
    }
  });

  test("uses one detail view with phone and desktop layouts", async ({
    context,
    page,
    baseURL,
    isMobile,
  }) => {
    await setUser(context, baseURL, "prakash");
    await page.goto("/sundar-heights/leads/sundar-lead-004");
    const detail = page.getByRole("region", {
      name: "Lead detail",
      exact: true,
    });
    await expect(detail).toHaveCount(1);
    const facts = detail.getByRole("region", {
      name: "Lead facts",
      exact: true,
    });
    const timeline = detail.getByRole("region", {
      name: "Timeline",
      exact: true,
    });
    await expect(facts).toHaveCount(1);
    await expect(timeline).toHaveCount(1);
    const log = detail.getByRole("link", { name: "Log a call", exact: true });
    await expect(log).toHaveCount(1);
    const position = await log.evaluate(
      (element) => getComputedStyle(element).position,
    );
    const factsBox = await facts.boundingBox();
    const timelineBox = await timeline.boundingBox();
    const mainBox = await page.getByRole("main").boundingBox();
    expect(factsBox).not.toBeNull();
    expect(timelineBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    if (factsBox && timelineBox && mainBox) {
      if (isMobile) {
        expect(position).toBe("fixed");
        const logBox = await log.boundingBox();
        const reserve = await page
          .getByRole("main")
          .evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).paddingBottom),
          );
        expect(logBox).not.toBeNull();
        if (logBox) {
          expect(logBox.y + logBox.height).toBeCloseTo(844, 0);
          expect(reserve).toBeGreaterThan(logBox.height);
        }
        expect(timelineBox.y).toBeGreaterThan(factsBox.y + factsBox.height);
      } else {
        expect(position).toBe("static");
        expect(mainBox.width).toBeGreaterThan(1000);
        expect(timelineBox.x).toBeGreaterThan(factsBox.x + factsBox.width);
        const callBox = await detail
          .getByRole("link", { name: "Call", exact: true })
          .boundingBox();
        const logBox = await log.boundingBox();
        expect(callBox).not.toBeNull();
        expect(logBox).not.toBeNull();
        if (callBox && logBox)
          expect(Math.abs(callBox.y - logBox.y)).toBeLessThan(2);
      }
    }
    const ids = await page
      .getByRole("main")
      .locator("[id]")
      .evaluateAll((elements) => elements.map((element) => element.id));
    expect(ids).toEqual([...new Set(ids)]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    await page.screenshot({
      path: `/private/tmp/anar-lead-${isMobile ? "phone" : "desktop"}.png`,
      fullPage: true,
    });
  });
});
