import type { Page, TestInfo } from "@playwright/test";
import { expect, newPage, signIn, test } from "./fixture";
import { type FakePush, fakePush, withFakePush } from "./push";

const manager = "manager@browser.example.test";
const list = "/browser-company/notifications";

async function open(
  browser: Parameters<typeof newPage>[0],
  baseURL: string | undefined,
  testInfo: TestInfo,
  mailbox: Parameters<typeof signIn>[1],
  push: FakePush,
) {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const page = await newPage(browser, baseURL, testInfo);
  await withFakePush(page, push);
  await signIn(page, mailbox, manager);
  await page.goto(list);
  return page;
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

const status = (page: Page) =>
  page.getByRole("region", { name: "This device" }).getByRole("status");

test("a person turns notifications on and off for this device", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const page = await open(browser, baseURL, testInfo, mailbox, fakePush());
  await expect(status(page)).toHaveText(
    "Notifications are off on this device.",
  );
  await expect(page.getByText("Add to Home Screen")).toBeVisible();
  const enable = page.getByRole("button", { name: "Enable notifications" });
  await expect(enable).toHaveCount(1);
  await enable.focus();
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText(
    "Notifications are on for this device.",
  );
  await expectFits(page, testInfo, "push-on");

  await page.reload();
  await expect(status(page)).toHaveText(
    "Notifications are on for this device.",
  );
  await page.getByRole("button", { name: "Disable this device" }).click();
  await expect(status(page)).toHaveText(
    "Notifications are off on this device.",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Enable notifications" }),
  ).toHaveCount(1);

  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  expect(
    await page.evaluate(async () =>
      Boolean(await navigator.serviceWorker.getRegistration("/")),
    ),
  ).toBe(true);
  await page.context().close();
});

test("a blocked or unsupported browser says so and offers no switch", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const blocked = await open(
    browser,
    baseURL,
    testInfo,
    mailbox,
    fakePush({ permission: "denied" }),
  );
  await blocked.getByRole("button", { name: "Enable notifications" }).click();
  await expect(status(blocked)).toHaveText(/Notifications are blocked/);
  await expect(
    blocked.getByRole("button", { name: /notifications|device/ }),
  ).toHaveCount(0);
  await blocked.context().close();

  const unsupported = await open(
    browser,
    baseURL,
    testInfo,
    mailbox,
    fakePush({ supported: false }),
  );
  await expect(status(unsupported)).toHaveText(
    "This browser cannot show notifications.",
  );
  await expect(
    unsupported.getByRole("button", { name: "Enable notifications" }),
  ).toHaveCount(0);
  await expect(unsupported.getByText("Add to Home Screen")).toBeVisible();
  await expectFits(unsupported, testInfo, "push-unsupported");
  await unsupported.context().close();
});

test("a failed save shows try again and never claims on", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const page = await open(
    browser,
    baseURL,
    testInfo,
    mailbox,
    fakePush({ endpoint: "https://push.example.com/send/x" }),
  );
  await page.getByRole("button", { name: "Enable notifications" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(status(page)).toHaveText(
    "Notifications are off on this device.",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(1);
  await page.reload();
  await expect(status(page)).toHaveText(
    "Notifications are off on this device.",
  );
  await page.context().close();
});
