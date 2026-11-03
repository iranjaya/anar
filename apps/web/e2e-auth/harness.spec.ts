import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, stackContainer, staffEmail, test } from "./fixture";

test("delivers a code through the worker and keeps the proxy cookie through refresh and logout", async ({
  page,
  context,
  mailbox,
  baseURL,
}) => {
  const before = await mailbox.ids();
  const headers = { Origin: baseURL ?? "" };
  const requested = await page.request.post("/api/auth/requestOtp", {
    headers,
    data: { email: staffEmail },
  });
  expect(requested.status()).toBe(200);
  const code = await mailbox.code(staffEmail, before);
  const verified = await page.request.post("/api/auth/verifyOtp", {
    headers,
    data: { email: staffEmail, code },
  });
  expect(verified.status()).toBe(200);
  const session = (await context.cookies()).find(
    (cookie) => cookie.name === "anar_session",
  );
  expect(!!session).toBe(true);
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  const refreshed = await page.request.post("/api/auth/refresh", {
    headers,
    data: {},
  });
  expect(refreshed.status()).toBe(200);
  const devices = await page.request.get("/api/auth/listSessions");
  expect(devices.status()).toBe(200);
  expect(
    (await devices.json()).data.some(
      (device: { current: boolean }) => device.current,
    ),
  ).toBe(true);
  const loggedOut = await page.request.post("/api/auth/logout", {
    headers,
    data: {},
  });
  expect(loggedOut.status()).toBe(200);
  expect(
    (await context.cookies()).some((cookie) => cookie.name === "anar_session"),
  ).toBe(false);
  expect((await page.request.get("/api/auth/listSessions")).status()).toBe(401);
});

test("keeps demo access outside the real profile", async ({
  page,
  context,
  baseURL,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/login");
  expect(response?.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  await expect(
    page.getByRole("heading", { name: "Sign in to Anar" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await context.addCookies([
    {
      name: "anar_demo",
      value: JSON.stringify({
        userId: "rohan",
        actingCompanyId: "sundar-heights",
      }),
      url: baseURL,
    },
  ]);
  await page.goto("/");
  await expect(page).toHaveURL(`${baseURL}/login`);
  await expect(
    page.getByRole("button", { name: "Send code", exact: true }),
  ).toBeEnabled();
  expect((await page.request.get("/companies")).status()).toBe(404);
  expect((await page.request.get("/sundar-heights/dashboard")).status()).toBe(
    404,
  );
  expect((await page.request.post("/api/imports", { data: {} })).status()).toBe(
    403,
  );
});

test("the worker reaches the fake push service over trusted HTTPS", async ({
  stack,
}) => {
  await fetch(`${stack.pushURL}/reset`, { method: "POST" });
  const worker = await stackContainer(stack, "worker");
  await promisify(execFile)(
    "docker",
    [
      "exec",
      worker,
      "node",
      "-e",
      'const r = await fetch("https://fcm.googleapis.com/fcm/send/harness", { method: "POST", headers: { TTL: "60" } }); if (r.status !== 201) process.exit(1);',
    ],
    { timeout: 30000 },
  );
  const received = await (await fetch(`${stack.pushURL}/requests`)).json();
  expect(received).toEqual([
    expect.objectContaining({
      host: "fcm.googleapis.com",
      path: "/fcm/send/harness",
      ttl: "60",
    }),
  ]);
});
