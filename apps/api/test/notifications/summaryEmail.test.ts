import type { TenantTx } from "@anar/db/tenant";
import { describe, expect, it } from "vitest";
import { createMailCodec } from "../../src/lib/email/crypto.js";
import summaryEmail, {
  type SummaryEmailDeps,
} from "../../src/modules/notifications/summaryEmail.js";

const agencyId = "10000000-0000-4000-8000-000000000001";
const companyId = "20000000-0000-4000-8000-000000000001";
const userId = "30000000-0000-4000-8000-000000000001";
const notificationId = "40000000-0000-4000-8000-000000000001";
const key = `summary:${companyId}:${notificationId}`;
const job = { agencyId, companyId, notificationId };
const control = () => ({ signal: new AbortController().signal });
type Candidate = NonNullable<
  Awaited<ReturnType<SummaryEmailDeps["readCandidate"]>>
>;
type Ledger = {
  state: "pending" | "sending" | "sent" | "skipped" | "indeterminate";
  encryptedMessage: string;
  expiresAt: Date;
  firstAttemptAt: Date | null;
  attempts: number;
  deliveredAt: Date | null;
};
type State = { ledger: Ledger | null };
type FakeTx = TenantTx & { state: State };
const stateOf = (tx: TenantTx) => (tx as FakeTx).state;

function harness(type: "daily" | "weekly" = "daily") {
  let now = new Date("2026-11-02T02:15:00.000Z");
  let state: State = { ledger: null };
  let allowed = true;
  let active = true;
  let email: string | null = "seller@example.test";
  let failSend = false;
  let push = { open: false, sent: false };
  const sent: { to: string; text: string; deliveryKey: string }[] = [];
  const codec = createMailCodec(Buffer.alloc(32, 7).toString("base64"));
  const candidate = {
    id: notificationId,
    companyId,
    userId,
    type,
    data:
      type === "daily"
        ? {
            type: "daily",
            localDate: "2026-11-02",
            overdue: 1,
            dueToday: 0,
            newLeads: 0,
          }
        : {
            type: "weekly",
            weekStart: "2026-10-26",
            leads: 0,
            calls: 0,
            siteVisits: 0,
            bookings: 0,
            overdue: 0,
            staffCalls: 0,
            top: null,
            bottom: null,
          },
    url: `/client-one/${type === "daily" ? "today" : "notifications"}`,
    createdAt: now,
    pushedAt: null,
    emailedAt: null,
  } as unknown as Candidate;
  const deps: SummaryEmailDeps = {
    now: () => now,
    publicOrigin: "https://anar.example.test",
    readScopedCompany: async () => ({
      name: "Client One",
      slug: "client-one",
      timezone: "Asia/Kathmandu",
    }),
    readRecipientEmail: async () => email,
    async withSystemTenant(_scope, fn) {
      const tx = { state: structuredClone(state) } as FakeTx;
      const result = await fn(tx);
      state = tx.state;
      return result;
    },
    readCandidate: async () => candidate,
    pushState: async () => push,
    canReceiveCompanyNotification: async () => allowed,
    isActiveSummaryRecipient: async () => active,
    mailCodec: codec,
    renderDaily: ({ data, url }) => ({
      subject: "Daily summary",
      text: `${data.overdue} overdue. ${url}`,
      html: `<p>${data.overdue} overdue.</p>`,
    }),
    renderWeekly: ({ data, url }) => ({
      subject: "Weekly summary",
      text: `${data.calls} calls. ${url}`,
      html: `<p>${data.calls} calls.</p>`,
    }),
    async saveEnvelope(tx, input) {
      const current = stateOf(tx);
      current.ledger ??= {
        state: "pending",
        encryptedMessage: input.encryptedMessage,
        expiresAt: input.expiresAt,
        firstAttemptAt: null,
        attempts: 0,
        deliveredAt: null,
      };
    },
    async claim(tx, _notificationId, at) {
      const row = stateOf(tx).ledger;
      if (!row || !["pending", "sending"].includes(row.state)) return null;
      if (
        at >= row.expiresAt ||
        (row.firstAttemptAt &&
          at.getTime() - row.firstAttemptAt.getTime() >= 23 * 60 * 60_000) ||
        row.attempts >= 4
      ) {
        row.state = row.attempts ? "indeterminate" : "skipped";
        return null;
      }
      row.state = "sending";
      row.attempts += 1;
      row.firstAttemptAt ??= at;
      return {
        id: "50000000-0000-4000-8000-000000000001",
        attempts: row.attempts,
        encryptedMessage: row.encryptedMessage,
        stopAt: new Date(
          Math.min(
            row.expiresAt.getTime(),
            row.firstAttemptAt.getTime() + 23 * 60 * 60_000,
          ),
        ),
      };
    },
    async finish(tx, input) {
      const row = stateOf(tx).ledger;
      if (row?.state !== "sending" || row.attempts !== input.attempts)
        return false;
      row.state = input.sent
        ? "sent"
        : input.attempts >= 4
          ? "indeterminate"
          : "pending";
      row.deliveredAt = input.sent ? input.at : null;
      if (input.sent) candidate.emailedAt = input.at;
      return true;
    },
    async skip(tx) {
      const row = stateOf(tx).ledger;
      if (row && ["pending", "sending"].includes(row.state))
        row.state = "skipped";
    },
    async closeExpired(tx) {
      const row = stateOf(tx).ledger;
      if (row && ["pending", "sending"].includes(row.state))
        row.state = row.firstAttemptAt ? "indeterminate" : "skipped";
    },
    async sendEmail(input) {
      sent.push({
        to: input.to,
        text: input.text,
        deliveryKey: input.deliveryKey,
      });
      if (failSend) throw new Error("Email delivery failed");
    },
  };
  return {
    deliver: summaryEmail.create(deps).deliver,
    candidate,
    ledger: () => state.ledger,
    sent,
    setNow(value: string) {
      now = new Date(value);
    },
    setAllowed(value: boolean) {
      allowed = value;
    },
    setActive(value: boolean) {
      active = value;
    },
    setEmail(value: string | null) {
      email = value;
    },
    setPush(value: typeof push) {
      push = value;
    },
    setFailSend(value: boolean) {
      failSend = value;
    },
  };
}

describe("summary email fallback", () => {
  it("sends once after push has no target and keeps the envelope encrypted", async () => {
    const run = harness();
    await run.deliver(job, control());
    await run.deliver(job, control());
    expect(run.sent).toEqual([
      {
        to: "seller@example.test",
        text: "1 overdue. https://anar.example.test/client-one/today",
        deliveryKey: key,
      },
    ]);
    expect(run.ledger()).toMatchObject({ state: "sent", attempts: 1 });
    expect(run.ledger()?.encryptedMessage).not.toContain("seller@example.test");
    expect(run.candidate.emailedAt).not.toBeNull();
  });

  it("waits for retryable push and skips email after any push succeeds", async () => {
    const run = harness();
    run.setPush({ open: true, sent: false });
    await expect(run.deliver(job, control())).rejects.toThrow(
      "Push delivery is still open",
    );
    run.setPush({ open: false, sent: true });
    await run.deliver(job, control());
    expect(run.sent).toEqual([]);
    expect(run.ledger()).toBeNull();
  });

  it("retries with the saved message and the same delivery key", async () => {
    const run = harness();
    run.setFailSend(true);
    await expect(run.deliver(job, control())).rejects.toThrow(
      "Email delivery failed",
    );
    const envelope = run.ledger()?.encryptedMessage;
    run.candidate.data = {
      type: "daily",
      localDate: "2026-11-02",
      overdue: 9,
      dueToday: 9,
      newLeads: 9,
    };
    run.setFailSend(false);
    await run.deliver(job, control());
    expect(run.ledger()).toMatchObject({
      state: "sent",
      attempts: 2,
      encryptedMessage: envelope,
    });
    expect(run.sent.map((item) => [item.text, item.deliveryKey])).toEqual([
      ["1 overdue. https://anar.example.test/client-one/today", key],
      ["1 overdue. https://anar.example.test/client-one/today", key],
    ]);
  });

  it("cancels the saved envelope when the address or recipient changes", async () => {
    const run = harness();
    run.setFailSend(true);
    await expect(run.deliver(job, control())).rejects.toThrow(
      "Email delivery failed",
    );
    run.setEmail("new@example.test");
    run.setFailSend(false);
    await run.deliver(job, control());
    expect(run.ledger()?.state).toBe("skipped");
    expect(run.sent).toHaveLength(1);

    const removed = harness();
    removed.setFailSend(true);
    await expect(removed.deliver(job, control())).rejects.toThrow(
      "Email delivery failed",
    );
    removed.setActive(false);
    removed.setFailSend(false);
    await removed.deliver(job, control());
    expect(removed.sent).toHaveLength(1);
    expect(removed.ledger()?.state).toBe("skipped");

    const deactivated = harness();
    deactivated.setFailSend(true);
    await expect(deactivated.deliver(job, control())).rejects.toThrow(
      "Email delivery failed",
    );
    deactivated.setEmail(null);
    await deactivated.deliver(job, control());
    expect(deactivated.ledger()?.state).toBe("skipped");
  });

  it("marks a failed weekly send indeterminate after 23 hours", async () => {
    const run = harness("weekly");
    run.setFailSend(true);
    await expect(run.deliver(job, control())).rejects.toThrow(
      "Email delivery failed",
    );
    run.setNow("2026-11-03T01:15:01.000Z");
    run.setFailSend(false);
    await run.deliver(job, control());
    expect(run.ledger()?.state).toBe("indeterminate");
    expect(run.sent).toHaveLength(1);
  });

  it("sends a zero weekly summary while the recipient is active", async () => {
    const run = harness("weekly");
    run.setAllowed(true);
    await run.deliver(job, control());
    expect(run.sent[0].text).toBe(
      "0 calls. https://anar.example.test/client-one/notifications",
    );
  });
});
