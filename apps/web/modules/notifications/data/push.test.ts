import { createECDH, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { subscribePushSchema } from "@anar/domain/notifications";
import { describe, expect, it } from "vitest";
import {
  applicationServerKey,
  type BrowserPush,
  deviceState,
  toSubscribeInput,
} from "./push";

const browser = (change: Partial<BrowserPush> = {}): BrowserPush => ({
  supported: true,
  permission: "granted",
  subscribed: true,
  ...change,
});

describe("device push state", () => {
  it("is on only when the browser and the saved row agree", () => {
    expect(deviceState(browser(), true)).toBe("on");
    expect(deviceState(browser(), false)).toBe("off");
    expect(deviceState(browser({ subscribed: false }), true)).toBe("off");
    expect(deviceState(browser({ permission: "default" }), true)).toBe("off");
  });

  it("shows blocked and unsupported browsers as their own states", () => {
    expect(deviceState(browser({ permission: "denied" }), true)).toBe(
      "blocked",
    );
    expect(deviceState(browser({ supported: false }), true)).toBe(
      "unsupported",
    );
  });
});

describe("browser subscription", () => {
  it("turns the browser JSON into input the API accepts", () => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const input = toSubscribeInput({
      endpoint: "https://web.push.apple.com/QGx",
      expirationTime: null,
      keys: {
        p256dh: ecdh.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
    });
    expect(subscribePushSchema.safeParse(input).success).toBe(true);
  });

  it("gives input the API refuses when the browser leaves out keys", () => {
    const input = toSubscribeInput({
      endpoint: "https://web.push.apple.com/x",
    });
    expect(input.expirationTime).toBeNull();
    expect(subscribePushSchema.safeParse(input).success).toBe(false);
  });

  it("decodes the server key to its raw bytes", () => {
    const raw = randomBytes(65);
    expect(
      Buffer.from(applicationServerKey(raw.toString("base64url"))),
    ).toEqual(raw);
  });
});

describe("service worker", () => {
  type Handler = (event: object) => void;
  function load() {
    const handlers: Record<string, Handler> = {};
    const shown: { title: string; options: { data: { url: string } } }[] = [];
    const opened: string[] = [];
    const self = {
      location: { origin: "https://anar.test" },
      addEventListener: (name: string, handler: Handler) => {
        handlers[name] = handler;
      },
      registration: {
        showNotification: async (
          title: string,
          options: { data: { url: string } },
        ) => {
          shown.push({ title, options });
        },
      },
      clients: {
        matchAll: async () => [],
        openWindow: async (url: string) => {
          opened.push(url);
        },
      },
    };
    runInNewContext(
      readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8"),
      { self, URL },
    );
    return { handlers, shown, opened, self };
  }
  async function push(message: unknown) {
    const sw = load();
    let wait: Promise<unknown> = Promise.resolve();
    sw.handlers.push({
      data: { json: () => message },
      waitUntil: (promise: Promise<unknown>) => {
        wait = promise;
      },
    });
    await wait;
    return sw.shown[0];
  }
  async function click(url: unknown) {
    const sw = load();
    let wait: Promise<unknown> = Promise.resolve();
    sw.handlers.notificationclick({
      notification: { close: () => {}, data: { url } },
      waitUntil: (promise: Promise<unknown>) => {
        wait = promise;
      },
    });
    await wait;
    return sw.opened[0];
  }
  const leadId = "01900000-0000-7000-8000-000000000002";

  it("keeps a same-company link the app allows", async () => {
    const shown = await push({
      title: "Lead overdue",
      body: "A lead needs a call.",
      tag: "n-1",
      url: `/client-one/leads/${leadId}`,
    });
    expect(shown.title).toBe("Lead overdue");
    expect(shown.options.data.url).toBe(`/client-one/leads/${leadId}`);
    expect(await click("/client-one/today")).toBe(
      "https://anar.test/client-one/today",
    );
  });

  it("opens a weekly summary in notifications", async () => {
    const url = "/client-one/notifications";
    const shown = await push({
      title: "Weekly summary",
      body: "This week.",
      url,
    });
    expect(shown.options.data.url).toBe(url);
    expect(await click(url)).toBe(`https://anar.test${url}`);
  });

  it.each([
    "https://evil.example/client-one",
    "//evil.example/client-one",
    "/client-one/../owner",
    "/client-one/settings",
    "javascript:alert(1)",
    "/client-one/today?next=//evil.example",
    42,
  ])("sends %s to the app home instead", async (url) => {
    expect((await push({ title: "x", body: "y", url })).options.data.url).toBe(
      "/",
    );
    expect(await click(url)).toBe("https://anar.test/");
  });

  it("still shows a plain notice when the payload is not JSON", async () => {
    const sw = load();
    let wait: Promise<unknown> = Promise.resolve();
    sw.handlers.push({
      data: {
        json: () => {
          throw new Error("not json");
        },
      },
      waitUntil: (promise: Promise<unknown>) => {
        wait = promise;
      },
    });
    await wait;
    expect(sw.shown[0].title).toBe("Anar");
  });
});
