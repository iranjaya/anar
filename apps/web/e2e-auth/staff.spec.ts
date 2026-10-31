import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fixture";

const staffEmail = "invite-staff@browser.example.test";
const colleagueEmail = "new-colleague@browser.example.test";

async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("agency staff invite a colleague, resend the invite and see them join", async ({
  page,
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, mailbox, staffEmail);
  await expect(page).toHaveURL(`${baseURL}/agency/companies`);

  await page.goto("/agency/staff");
  const staffList = page.getByRole("region", { name: "Staff list" });
  await expect(
    staffList.getByRole("heading", { name: "Invite Staff" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Invite colleague" }),
  ).toBeEnabled();
  await page.getByLabel("Name", { exact: true }).fill("New Colleague");
  await page.getByLabel("Email", { exact: true }).fill(colleagueEmail);
  await promisify(execFile)(
    process.execPath,
    [
      path.resolve(__dirname, "../../../test/support/session-otp.ts"),
      String(baseURL),
      staffEmail,
      "20",
    ],
    { timeout: 60000 },
  );
  await page.getByRole("button", { name: "Invite colleague" }).click();
  await expect(
    page.getByText("Confirm with a fresh code", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "New Colleague",
  );
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    colleagueEmail,
  );
  const beforeCode = await mailbox.ids();
  await page.getByRole("button", { name: "Send fresh code" }).click();
  await expect(
    page.getByText("Code requested. Check your email."),
  ).toBeVisible();
  await page
    .getByLabel("Six-digit code")
    .fill(await mailbox.code(staffEmail, beforeCode));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(
    page.getByText("Code verified. Retry your action."),
  ).toBeVisible();
  await fits(page);
  await page.screenshot({
    path: testInfo.outputPath("agency-staff-fresh-code.png"),
    fullPage: true,
  });

  const beforeInvite = await mailbox.ids();
  await page.getByRole("button", { name: "Invite colleague" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Invitation queued." }),
  ).toBeVisible();
  const firstLink = await mailbox.invite(colleagueEmail, beforeInvite);

  await page.goto("/agency/invites");
  const invite = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "New Colleague" }) });
  await expect(invite.getByText("Awaiting acceptance")).toBeVisible();
  const beforeResend = await mailbox.ids();
  await invite.getByRole("button", { name: "Resend invite" }).click();
  await expect(
    invite.getByRole("status").filter({ hasText: "Invitation queued." }),
  ).toBeVisible();
  const secondLink = await mailbox.invite(colleagueEmail, beforeResend);
  expect(secondLink).not.toBe(firstLink);
  await fits(page);
  await page.screenshot({
    path: testInfo.outputPath("agency-invites.png"),
    fullPage: true,
  });

  const { viewport, isMobile, hasTouch } = testInfo.project.use;
  const colleagueContext = await browser.newContext({
    baseURL,
    viewport,
    isMobile,
    hasTouch,
  });
  try {
    const colleague = await colleagueContext.newPage();
    colleague.on("pageerror", (error) => errors.push(error.message));
    await colleague.goto(`/invite${firstLink}`);
    await expect(
      colleague
        .getByRole("alert")
        .filter({ hasText: "Invitation is unavailable" }),
    ).toBeVisible();
    await colleague.goto("/login");
    await colleague.goto(`/invite${secondLink}`);
    await expect(
      colleague.getByText(`Invited email: ${colleagueEmail}`),
    ).toBeVisible();
    await colleague.getByLabel("Your name").fill("New Colleague");
    await colleague
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(
      colleague.getByText(
        "Invitation accepted. Sign in with your invited email.",
      ),
    ).toBeVisible();
    await signIn(colleague, mailbox, colleagueEmail);
    await expect(colleague).toHaveURL(`${baseURL}/agency/companies`);
  } finally {
    await colleagueContext.close();
  }

  await page.goto("/agency/staff");
  await expect(
    staffList.getByRole("heading", { name: "New Colleague" }),
  ).toBeVisible();
  await page.goto("/agency/invites");
  await expect(
    page.getByRole("heading", { name: "New Colleague" }),
  ).toHaveCount(0);
  await fits(page);
  expect(errors).toEqual([]);
});
