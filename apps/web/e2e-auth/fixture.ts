import { spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { test as base, expect } from "@playwright/test";

type Message = { ID: string; To: { Address: string }[]; Text: string };
type AuthStack = { baseURL: string; mailURL: string };
export const staffEmail = "staff@browser.example.test";

export const test = base.extend<
  {
    mailbox: {
      ids(): Promise<string[]>;
      code(email: string, before: string[]): Promise<string>;
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
    await use({
      ids: async () => (await messages()).map((message) => message.ID),
      async code(email, before) {
        let code: string | undefined;
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
                code = body.Text.match(/\b\d{6}\b/)?.[0];
                if (code) return true;
              }
              return false;
            },
            { timeout: 30000, message: "Expected a new test email code" },
          )
          .toBe(true);
        if (!code) throw new Error("Test email has no code");
        return code;
      },
    });
  },
});
export { expect };
