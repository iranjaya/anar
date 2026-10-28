import { expect, test } from "@playwright/test";

test("shows Anar on the home page", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Anar", exact: true }),
  ).toBeVisible();
});
