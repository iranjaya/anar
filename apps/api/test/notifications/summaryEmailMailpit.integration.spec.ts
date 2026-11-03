import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEmailSender } from "../../src/lib/email/index.js";
import { startSummaryEmailFixture } from "./summaryEmailFixture.js";

describe("summary email through Mailpit", () => {
  let run: Awaited<ReturnType<typeof startSummaryEmailFixture>>;
  beforeAll(async () => {
    run = await startSummaryEmailFixture();
  });
  afterAll(async () => {
    await run?.close();
  });

  it("sends daily and weekly messages to the local inbox once", async () => {
    const { company, user } = await run.setup();
    const manager = await run.fixture.seedUser();
    await run.fixture.seedMember(company, manager.id, "active", "super_admin");
    const daily = await run.createNotice(company, user.id, "daily", false);
    const weekly = await run.createNotice(company, manager.id, "weekly", false);
    const sender = createEmailSender({
      provider: "mailpit",
      url: run.fixture.mailpit.url,
      from: "noreply@anar.example.test",
    });
    const worker = run.emailWorker(sender.sendEmail);
    await worker.deliver(daily, run.control());
    await worker.deliver(weekly, run.control());
    await worker.deliver(daily, run.control());
    await worker.deliver(weekly, run.control());
    await expect
      .poll(async () => (await run.fixture.mailpit.messages()).length, {
        timeout: 5000,
      })
      .toBe(2);
    const messages = await run.fixture.mailpit.messages();
    const received = await Promise.all(
      messages.map((message) => run.fixture.mailpit.message(message.ID)),
    );
    const dailyMail = received.find(
      (message) => message.To[0]?.Address === user.email,
    );
    const weeklyMail = received.find(
      (message) => message.To[0]?.Address === manager.email,
    );
    expect(dailyMail).toMatchObject({
      Subject: "Client company: your 2026-11-02 work",
      Text: expect.stringContaining(
        `http://anar.example.test/${company.company.slug}/today`,
      ),
      HTML: expect.stringContaining("Overdue"),
    });
    expect(weeklyMail).toMatchObject({
      Subject: "Client company: week of 2026-10-26",
      Text: expect.stringContaining(
        `http://anar.example.test/${company.company.slug}/notifications`,
      ),
      HTML: expect.stringContaining("Staff calls"),
    });
    const headers = await Promise.all(
      messages.map((message) => run.fixture.mailpit.headers(message.ID)),
    );
    expect(
      headers.map((entry) => entry["X-Anar-Delivery-Key"]?.[0]).sort(),
    ).toEqual(
      [
        `summary:${company.companyId}:${daily.notificationId}`,
        `summary:${company.companyId}:${weekly.notificationId}`,
      ].sort(),
    );
    expect(
      (await run.storedNotice(company, daily.notificationId)).emailedAt,
    ).not.toBeNull();
    expect(
      (await run.storedNotice(company, weekly.notificationId)).emailedAt,
    ).not.toBeNull();
  });
});
