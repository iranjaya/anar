import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Page, TestInfo } from "@playwright/test";
import { expect, newPage, signIn, stackContainer, test } from "./fixture";

const run = promisify(execFile);
const company = "40000000-0000-4000-8000-000000000001";
const manager = {
  id: "10000000-0000-4000-8000-000000000003",
  email: "manager@browser.example.test",
};
const second = {
  id: "10000000-0000-4000-8000-0000000000e1",
  email: "notified-admin@browser.example.test",
};
const list = "/browser-company/notifications";

async function database(
  stack: Parameters<typeof stackContainer>[0],
  query: string,
) {
  await run(
    "docker",
    [
      "exec",
      await stackContainer(stack, "db"),
      "psql",
      "-U",
      "postgres",
      "-d",
      "anar",
      "-v",
      "ON_ERROR_STOP=1",
      "-qc",
      query,
    ],
    { timeout: 30000 },
  );
}

function row(userId: string, n: number) {
  const id = `60000000-0000-4000-8000-${userId.slice(-4)}0000000${n}`;
  return `('${id}','${company}','${userId}','daily','Daily summary ${n}','${n} leads are due today.','/browser-company','{"type":"daily","localDate":"2026-10-2${n}","overdue":0,"dueToday":${n},"newLeads":0}','daily:${company}:2026-10-2${n}', now() - interval '${n} minutes')`;
}

async function expectFits(page: Page, testInfo: TestInfo, name: string) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
  });
}

test("each person sees and marks only their own notifications", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  await database(
    stack,
    `INSERT INTO users (id,email,name) VALUES ('${second.id}','${second.email}','Notified Admin') ON CONFLICT DO NOTHING;
    INSERT INTO company_members (id,agency_id,company_id,user_id,name,role,status) VALUES
    ('50000000-0000-4000-8000-0000000000e1','20000000-0000-4000-8000-000000000001','${company}','${second.id}','Notified Admin','admin','active') ON CONFLICT DO NOTHING;
    DELETE FROM notification_deliveries;
    DELETE FROM notifications;
    INSERT INTO notifications (id,company_id,user_id,type,title,body,url,data,dedupe_key,created_at) VALUES
    ${[row(manager.id, 1), row(manager.id, 2), row(second.id, 1)].join(",")};`,
  );
  const one = await newPage(browser, baseURL, testInfo);
  await signIn(one, mailbox, manager.email);
  const two = await newPage(browser, baseURL, testInfo);
  await signIn(two, mailbox, second.email);

  await one.goto("/browser-company");
  const bell = one.getByRole("link", { name: "Notifications, 2 unread" });
  await expect(bell).toHaveCount(1);
  await bell.click();
  await expect(one).toHaveURL(list);
  await expect(
    one.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(one.getByText("Daily summary 1")).toBeVisible();
  await expect(one.getByText("Daily summary 2")).toBeVisible();
  await expect(one.getByRole("button", { name: "Mark read" })).toHaveCount(2);
  await expectFits(one, testInfo, "notifications-list");

  await two.goto(list);
  await expect(two.getByText("Daily summary 1")).toBeVisible();
  await expect(two.getByText("Daily summary 2")).toHaveCount(0);
  await expect(
    two.getByRole("link", { name: "Notifications, 1 unread" }),
  ).toHaveCount(1);

  await one.getByRole("button", { name: "Mark read" }).first().click();
  await expect(one.getByRole("button", { name: "Mark read" })).toHaveCount(1);
  await one.reload();
  await expect(one.getByRole("button", { name: "Mark read" })).toHaveCount(1);
  await expect(
    one.getByRole("link", { name: "Notifications, 1 unread" }),
  ).toHaveCount(1);
  await expect(one.getByText("1 unread", { exact: true })).toBeVisible();

  await two.reload();
  await expect(
    two.getByRole("link", { name: "Notifications, 1 unread" }),
  ).toHaveCount(1);

  await one.getByRole("link", { name: "Open" }).first().click();
  await expect(one).toHaveURL("/browser-company");
  await one.context().close();
  await two.context().close();
});

test("a notification outage shows unavailable, never zero", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const page = await newPage(browser, baseURL, testInfo);
  await signIn(page, mailbox, manager.email);
  await database(stack, "REVOKE SELECT ON notifications FROM anar_app;");
  try {
    await page.goto("/browser-company");
    await expect(
      page.getByRole("link", { name: "Notifications unavailable" }),
    ).toHaveCount(1);
    await page.goto(list);
    await expect(
      page.getByRole("alert").filter({ hasText: "Try again" }),
    ).toBeVisible();
    await expect(page.getByText("No notifications yet.")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
    await expectFits(page, testInfo, "notifications-outage");
  } finally {
    await database(stack, "GRANT SELECT ON notifications TO anar_app;");
  }
  await page.getByRole("link", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Try again" }),
  ).toHaveCount(0);
  await page.context().close();
});
