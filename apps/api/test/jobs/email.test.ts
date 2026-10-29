import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEmailConfig } from "../../src/lib/email/config.js";
import { createEmailSender } from "../../src/lib/email/index.js";

describe("Resend HTTP transport", () => {
  let server: Server;
  let url: string;
  let status: number;
  let responseBody: string;
  let requests: {
    method?: string;
    path?: string;
    headers: IncomingHttpHeaders;
    body: string;
  }[];
  const message = {
    to: "recipient@example.test",
    subject: "Fixture",
    text: "Synthetic message",
    deliveryKey: "fixture-revision-1",
  };
  const config = () => ({
    ...loadEmailConfig({
      EMAIL_TRANSPORT: "resend",
      EMAIL_FROM: "sender@example.test",
      RESEND_API_KEY: "fake-test-key",
    }),
    url,
  });

  beforeEach(async () => {
    requests = [];
    status = 200;
    responseBody = '{"id":"fixture-message"}';
    server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      requests.push({
        method: request.method,
        path: request.url,
        headers: request.headers,
        body,
      });
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(responseBody);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected a loopback port");
    url = `http://127.0.0.1:${address.port}/emails`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("sends the configured sender and stable idempotency key", async () => {
    const sender = createEmailSender(config());
    await sender.sendEmail(message);
    await sender.sendEmail(message);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.method).toBe("POST");
      expect(request.path).toBe("/emails");
      expect(request.headers.authorization).toBe("Bearer fake-test-key");
      expect(request.headers["idempotency-key"]).toBe(message.deliveryKey);
      expect(JSON.parse(request.body)).toEqual({
        from: "sender@example.test",
        to: [message.to],
        subject: message.subject,
        text: message.text,
      });
    }
  });

  it("hides provider error content and leaves retries to the queue", async () => {
    status = 503;
    responseBody = '{"message":"synthetic provider detail"}';
    const error = await createEmailSender(config())
      .sendEmail(message)
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toBe("Error: Email delivery failed");
    expect(error).not.toHaveProperty("cause");
    expect(requests).toHaveLength(1);
  });

  it("aborts an in-flight delivery", async () => {
    server.removeAllListeners("request");
    const received = new Promise<void>((resolve) => {
      server.on("request", (request) => {
        request.once("end", resolve);
        request.resume();
      });
    });
    const controller = new AbortController();
    const result = createEmailSender(config())
      .sendEmail({ ...message, signal: controller.signal })
      .catch((failure: unknown) => failure);
    await received;
    controller.abort();
    expect(String(await result)).toBe("Error: Email delivery failed");
  });

  it("requires the selected transport credentials", () => {
    expect(
      loadEmailConfig({
        EMAIL_TRANSPORT: "mailpit",
        EMAIL_FROM: "sender@example.test",
        MAILPIT_URL: "http://127.0.0.1:8025",
      }),
    ).toEqual({
      provider: "mailpit",
      from: "sender@example.test",
      url: "http://127.0.0.1:8025",
    });
    expect(() =>
      loadEmailConfig({
        EMAIL_TRANSPORT: "resend",
        EMAIL_FROM: "sender@example.test",
      }),
    ).toThrow("RESEND_API_KEY is required");
  });
});
