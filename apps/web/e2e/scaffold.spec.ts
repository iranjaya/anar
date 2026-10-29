import { expect, test } from "@playwright/test";

test("shows Anar on the company list", async ({ page, context, baseURL }) => {
  await context.addCookies([
    {
      name: "anar_demo",
      value: JSON.stringify({ userId: "rohan", actingCompanyId: null }),
      url: baseURL,
    },
  ]);
  await page.goto("/companies");
  await expect(page.getByText("Anar · DNA", { exact: true })).toBeVisible();
});
