import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { Page, TestInfo } from "@playwright/test";
import { expect, newPage, signIn, stackContainer, test } from "./fixture";
import { fakePush, withFakePush } from "./push";

const run = promisify(execFile);
const agency = "20000000-0000-4000-8000-000000000001";
const company = "40000000-0000-4000-8000-000000000001";
const manager = {
  id: "10000000-0000-4000-8000-000000000003",
  email: "manager@browser.example.test",
};
const list = "/browser-company/notifications";

type Stack = Parameters<typeof stackContainer>[0];
type PushRequest = {
  host: string;
  path: string;
  ttl: string | null;
  contentEncoding: string | null;
  vapid: boolean;
  bytes: number;
};

async function sql(stack: Stack, query: string) {
  const { stdout } = await run(
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
      "-qtAc",
      query,
    ],
    { timeout: 30000 },
  );
  return stdout.trim();
}

// Inserts the row and queues notify.push with the same publish call notify makes.
async function notifyManager(stack: Stack, title: string) {
  const id = randomUUID();
  const batchId = randomUUID();
  await sql(
    stack,
    `INSERT INTO notifications (id,company_id,user_id,type,title,body,url,data,dedupe_key) VALUES
    ('${id}','${company}','${manager.id}','import_complete','${title}','120 leads imported.','/browser-company',
    '{"type":"import_complete","batchId":"${batchId}","imported":120,"duplicateDb":0}','import:${company}:${batchId}:complete');`,
  );
  const payload = JSON.stringify({
    agencyId: agency,
    companyId: company,
    notificationId: id,
  });
  await run(
    "docker",
    [
      "exec",
      await stackContainer(stack, "api"),
      "node",
      "--input-type=module",
      "-e",
      `const { createPlatformDb } = await import("@anar/db/platform");
      const { publish } = await import("@anar/db/queue");
      const db = await createPlatformDb(process.env.DATABASE_URL);
      await db.transaction((tx) => publish(tx, "notify.push", ${payload}, "push:${company}:${id}"));
      await db.close();`,
    ],
    { timeout: 30000 },
  );
  return id;
}

const provider = (stack: Stack, path: string, body?: unknown) =>
  fetch(`${stack.pushURL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const requests = async (stack: Stack) =>
  (await (await provider(stack, "/requests")).json()) as PushRequest[];
const deliveryState = (stack: Stack, notificationId: string) =>
  sql(
    stack,
    `SELECT string_agg(state, ',' ORDER BY id) FROM notification_deliveries WHERE notification_id = '${notificationId}'`,
  );

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

test("a new notification reaches the device and stops when it should", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  await provider(stack, "/reset", {});
  await sql(
    stack,
    "DELETE FROM notification_deliveries; DELETE FROM notifications;",
  );
  const device = fakePush();
  const page = await newPage(browser, baseURL, testInfo);
  await withFakePush(page, device);
  await signIn(page, mailbox, manager.email);
  await page.goto(list);
  await page.getByRole("button", { name: "Enable notifications" }).click();
  const status = page
    .getByRole("region", { name: "This device" })
    .getByRole("status");
  await expect(status).toHaveText("Notifications are on for this device.");

  const first = await notifyManager(stack, "Import finished");
  await expect
    .poll(() => deliveryState(stack, first), { timeout: 30000 })
    .toBe("sent");
  const [request] = await requests(stack);
  expect(request).toMatchObject({
    host: "fcm.googleapis.com",
    path: new URL(device.endpoint).pathname,
    contentEncoding: "aes128gcm",
    vapid: true,
  });
  expect(Number(request.ttl)).toBeGreaterThan(0);
  expect(request.bytes).toBeGreaterThan(0);
  expect(
    await sql(
      stack,
      `SELECT pushed_at IS NOT NULL FROM notifications WHERE id = '${first}'`,
    ),
  ).toBe("t");

  await page.reload();
  await expect(page.getByText("Import finished")).toHaveCount(1);
  await expectFits(page, testInfo, "push-delivery-list");
  await page.getByRole("link", { name: "Open" }).first().click();
  await expect(page).toHaveURL("/browser-company");

  await provider(stack, "/replies", [{ status: 410 }]);
  const gone = await notifyManager(stack, "Import finished again");
  await expect
    .poll(() => deliveryState(stack, gone), { timeout: 30000 })
    .toBe("failed");
  await page.goto(list);
  await expect(status).toHaveText("Notifications are off on this device.");
  await page.getByRole("button", { name: "Enable notifications" }).click();
  await expect(status).toHaveText("Notifications are on for this device.");

  const logout = await page.request.post("/api/auth/logout", {
    data: {},
    headers: { origin: baseURL },
  });
  expect(logout.ok()).toBe(true);
  const before = (await requests(stack)).length;
  const afterLogout = await notifyManager(stack, "After sign out");
  await expect
    .poll(() => deliveryState(stack, afterLogout), { timeout: 30000 })
    .toBe("skipped");
  expect(await requests(stack)).toHaveLength(before);
  await page.context().close();
});
