import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import {
  type Browser,
  test as base,
  expect,
  type Page,
  type TestInfo,
} from "@playwright/test";

type Message = { ID: string; To: { Address: string }[]; Text: string };
type AuthStack = {
  baseURL: string;
  mailURL: string;
  pushURL: string;
  project: string;
};
export const staffEmail = "staff@browser.example.test";

async function docker(...args: string[]) {
  return (
    await promisify(execFile)("docker", args, { timeout: 60000 })
  ).stdout.trim();
}

export async function stackContainer(stack: AuthStack, service: string) {
  if (!/^anar-browser-[0-9a-f-]{36}$/.test(stack.project))
    throw new Error("Expected the disposable browser stack");
  const id = await docker(
    "ps",
    "-aq",
    "--filter",
    `label=com.docker.compose.project=${stack.project}`,
    "--filter",
    `label=com.docker.compose.service=${service}`,
  );
  if (!id) throw new Error(`Missing ${service} container`);
  return id;
}

// Each test starts with empty rate limits, so one test's sign-ins cannot use up another test's codes.
export async function resetRateLimits(stack: AuthStack) {
  await docker(
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
    "delete from auth_rate_limits",
  );
}

export const test = base.extend<
  {
    rateLimits: undefined;
    mailbox: {
      ids(): Promise<string[]>;
      code(email: string, before: string[]): Promise<string>;
      invite(email: string, before: string[]): Promise<string>;
    };
  },
  { stack: AuthStack }
>({
  stack: [
    async ({ browserName: _browserName }, use) => {
      const child = spawn(
        process.execPath,
        [
          path.resolve(
            __dirname,
            "../../../test/support/auth-browser-stack.ts",
          ),
        ],
        { stdio: ["pipe", "pipe", "inherit"] },
      );
      const exited = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error("Browser stack exited unsuccessfully")),
        );
      });
      const lines = createInterface({ input: child.stdout });
      const ready = new Promise<AuthStack>((resolve, reject) => {
        lines.once("line", (line) => {
          try {
            resolve(JSON.parse(line) as AuthStack);
          } catch {
            reject(new Error("Invalid browser stack readiness"));
          }
        });
      });
      try {
        const stack = await Promise.race([
          ready,
          exited.then(() => {
            throw new Error("Browser stack stopped before readiness");
          }),
        ]);
        await use(stack);
      } finally {
        lines.close();
        child.stdin.end();
        await exited;
      }
    },
    { scope: "worker", timeout: 300000 },
  ],
  rateLimits: [
    async ({ stack }, use) => {
      await resetRateLimits(stack);
      await use(undefined);
    },
    { auto: true },
  ],
  baseURL: async ({ stack }, use) => {
    await use(stack.baseURL);
  },
  mailbox: async ({ stack }, use) => {
    const read = async (path: string) => {
      const response = await fetch(`${stack.mailURL}${path}`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new Error("Test mailbox unavailable");
      return response.json();
    };
    const messages = async (): Promise<Message[]> =>
      (await read("/api/v1/messages")).messages;
    async function delivered(email: string, before: string[], pattern: RegExp) {
      let value: string | undefined;
      await expect
        .poll(
          async () => {
            for (const message of await messages()) {
              if (
                before.includes(message.ID) ||
                !message.To.some((to) => to.Address === email)
              )
                continue;
              const body: Message = await read(
                `/api/v1/message/${encodeURIComponent(message.ID)}`,
              );
              value = body.Text.match(pattern)?.[0];
              if (value) return true;
            }
            return false;
          },
          { timeout: 30000, message: "Expected a new test email" },
        )
        .toBe(true);
      if (!value) throw new Error("Test email has no matching content");
      return value;
    }
    await use({
      ids: async () => (await messages()).map((message) => message.ID),
      code: (email, before) => delivered(email, before, /\b\d{6}\b/),
      async invite(email, before) {
        const link = await delivered(
          email,
          before,
          /https?:\/\/[^\s]+\/invite#token=[A-Za-z0-9_-]{43}/,
        );
        const url = new URL(link);
        if (url.origin !== stack.baseURL || url.pathname !== "/invite")
          throw new Error("Invite must point to the disposable stack");
        return url.hash;
      },
    });
  },
});
export { expect };

export type Mailbox = {
  ids(): Promise<string[]>;
  code(email: string, before: string[]): Promise<string>;
};

export async function signIn(page: Page, mailbox: Mailbox, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  const before = await mailbox.ids();
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await expect(page).toHaveURL(/\/login\/code$/);
  await page
    .getByLabel("Six-digit code")
    .fill(await mailbox.code(email, before));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function newPage(
  browser: Browser,
  baseURL: string,
  testInfo: TestInfo,
) {
  const { viewport, isMobile, hasTouch } = testInfo.project.use;
  const context = await browser.newContext({
    baseURL,
    viewport,
    isMobile,
    hasTouch,
  });
  return context.newPage();
}
