import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Browser, Page, TestInfo } from "@playwright/test";
import {
  expect,
  type Mailbox,
  newPage,
  resetRateLimits,
  signIn,
  stackContainer,
  test,
} from "./fixture";

const run = promisify(execFile);
const owner = "owner@browser.example.test";
const dnaStaff = "dna-staff@browser.example.test";
const secondStaff = "second-staff@browser.example.test";
const dnaManager = "admin-dna-north@browser.example.test";
const dnaSeller = "seller-dna-north@browser.example.test";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ stack }) => {
  test.setTimeout(240000);
  await resetRateLimits(stack);
  await run(
    process.execPath,
    [
      path.resolve(__dirname, "../../../test/support/foundation-seed.ts"),
      stack.baseURL,
      stack.mailURL,
      await stackContainer(stack, "api"),
    ],
    { timeout: 220000 },
  );
});

async function signedIn(
  browser: Browser,
  baseURL: string,
  mailbox: Mailbox,
  testInfo: TestInfo,
  email: string,
) {
  const page = await newPage(browser, baseURL, testInfo);
  await signIn(page, mailbox, email);
  return page;
}

async function fits(page: Page, testInfo: TestInfo, name: string) {
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

test("every role lands on its own home and sees only its own records", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const roles = [
    {
      email: owner,
      home: "/owner/agencies",
      sees: ["DNA", "Second Agency"],
      hidden: [],
    },
    {
      email: dnaStaff,
      home: "/agency/companies",
      sees: ["DNA North", "DNA South"],
      hidden: ["Second East", "Second West"],
    },
    {
      email: secondStaff,
      home: "/agency/companies",
      sees: ["Second East", "Second West"],
      hidden: ["DNA North", "DNA South"],
    },
    {
      email: dnaManager,
      home: "/dna-north",
      sees: ["Welcome, DNA North Admin"],
      hidden: [],
    },
    {
      email: dnaSeller,
      home: "/dna-north",
      sees: ["Welcome, DNA North Seller"],
      hidden: [],
    },
  ];
  for (const role of roles) {
    const page = await signedIn(
      browser,
      String(baseURL),
      mailbox,
      testInfo,
      role.email,
    );
    await expect(page).toHaveURL(`${baseURL}${role.home}`);
    for (const name of role.sees)
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    for (const name of role.hidden)
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    await fits(page, testInfo, `foundation-${role.email.split("@")[0]}`);

    if (role.email === dnaStaff) {
      await page.goto("/agency/staff");
      const joined = await page
        .locator("time")
        .first()
        .getAttribute("datetime");
      const age = Date.now() - Date.parse(String(joined));
      expect(age).toBeGreaterThan(-60000);
      expect(age).toBeLessThan(2 * 3600000);
    }
    if (role.email === dnaManager)
      expect((await page.goto("/dna-north/settings/team"))?.status()).toBe(200);
    if (role.email === dnaSeller)
      expect((await page.goto("/dna-north/settings/team"))?.status()).toBe(404);
    await page.context().close();
  }
});

test("two sessions invite at once, then one revokes the other while it refreshes", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  const first = await signedIn(
    browser,
    String(baseURL),
    mailbox,
    testInfo,
    dnaStaff,
  );
  const second = await signedIn(
    browser,
    String(baseURL),
    mailbox,
    testInfo,
    dnaStaff,
  );
  const origin = { origin: String(baseURL) };
  try {
    const colleague = {
      email: `concurrent-${Date.now()}@browser.example.test`,
      name: "Concurrent colleague",
    };
    const invited = await Promise.all(
      [first, second].map((page) =>
        page.request.post("/api/agencies/inviteStaff", {
          data: colleague,
          headers: origin,
        }),
      ),
    );
    expect(invited.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ]);

    const sessions = await (
      await first.request.get("/api/auth/listSessions")
    ).json();
    const other = sessions.data.find(
      (session: { current: boolean }) => !session.current,
    );
    expect(other).toBeTruthy();
    const [revoked] = await Promise.all([
      first.request.post("/api/auth/revokeSession", {
        data: { sessionId: other.id },
        headers: origin,
      }),
      ...[0, 1, 2].map(() =>
        second.request.post("/api/auth/refresh", { data: {}, headers: origin }),
      ),
    ]);
    expect(revoked.status()).toBe(200);
    expect((await second.request.get("/api/auth/getSession")).status()).toBe(
      401,
    );
    expect(
      (
        await second.request.post("/api/auth/refresh", {
          data: {},
          headers: origin,
        })
      ).status(),
    ).toBe(401);
    expect((await first.request.get("/api/auth/getSession")).status()).toBe(
      200,
    );
  } finally {
    await first.context().close();
    await second.context().close();
  }
});

test("a foreign Origin is refused and an API outage shows an error, never demo data", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  test.setTimeout(180000);
  const foreign = { origin: "https://evil.example.test" };
  const page = await signedIn(
    browser,
    String(baseURL),
    mailbox,
    testInfo,
    dnaManager,
  );
  expect(
    (
      await page.request.post("/api/auth/requestOtp", {
        data: { email: dnaManager },
        headers: foreign,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/companies/dna-north/members/inviteAdmin", {
        data: { email: "foreign@browser.example.test", name: "Foreign" },
        headers: foreign,
      })
    ).status(),
  ).toBe(403);

  const api = await stackContainer(stack, "api");
  await run("docker", ["stop", api], { timeout: 60000 });
  try {
    await page.goto("/dna-north");
    await expect(
      page.getByRole("alert").filter({
        hasText: "Could not reach the service. Try again.",
      }),
    ).toBeVisible();
    await expect(page.getByText("Sundar Heights")).toHaveCount(0);
    await expect(
      page.getByRole("complementary", { name: "Demo controls" }),
    ).toHaveCount(0);
    await fits(page, testInfo, "foundation-api-outage");
  } finally {
    await run("docker", ["start", api], { timeout: 60000 });
    await expect
      .poll(
        async () =>
          (await page.request.get("/api/health").catch(() => null))?.status(),
        { timeout: 90000 },
      )
      .toBe(200);
  }
  await page.goto("/dna-north");
  await expect(
    page.getByRole("heading", { name: "Welcome, DNA North Admin" }),
  ).toBeVisible();
  await page.context().close();
});
