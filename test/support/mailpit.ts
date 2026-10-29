import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
export type MailpitMessage = {
  ID: string;
  Subject: string;
  Text: string;
  To: { Address: string }[];
};

export async function startMailpit() {
  const name = `anar-s12b-mailpit-${randomUUID()}`;
  const stop = () =>
    run("docker", ["rm", "--force", "--volumes", name], { timeout: 15000 });
  try {
    await run(
      "docker",
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        name,
        "--publish",
        "127.0.0.1::8025",
        "axllent/mailpit:v1.32.0",
      ],
      { timeout: 60000 },
    );
    const published = (
      await run("docker", ["port", name, "8025/tcp"])
    ).stdout.trim();
    const port = Number(published.split(":").at(-1));
    if (!port || [3000, 3001, 3100].includes(port))
      throw new Error("Expected an isolated Mailpit port");
    const url = `http://127.0.0.1:${port}`;
    const request = async (path: string, method = "GET") => {
      const response = await fetch(`${url}${path}`, {
        method,
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new Error(`Mailpit returned ${response.status}`);
      return response;
    };
    const deadline = Date.now() + 30000;
    while (true) {
      try {
        await (await request("/api/v1/info")).body?.cancel();
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await delay(200);
      }
    }
    return {
      name,
      port,
      url,
      stop,
      async clear() {
        await (await request("/api/v1/messages", "DELETE")).body?.cancel();
      },
      async messages(): Promise<MailpitMessage[]> {
        return (
          (await (await request("/api/v1/messages")).json()) as {
            messages: MailpitMessage[];
          }
        ).messages;
      },
      async message(id: string): Promise<MailpitMessage> {
        return (await (
          await request(`/api/v1/message/${id}`)
        ).json()) as MailpitMessage;
      },
      async headers(id: string): Promise<Record<string, string[]>> {
        return (await (
          await request(`/api/v1/message/${id}/headers`)
        ).json()) as Record<string, string[]>;
      },
    };
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
}

export type Mailpit = Awaited<ReturnType<typeof startMailpit>>;
