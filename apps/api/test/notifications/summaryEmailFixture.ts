import { createECDH, randomBytes } from "node:crypto";
import {
  createTenantDb,
  notificationDeliveries,
  notifications,
  type TenantTx,
} from "@anar/db/tenant";
import type { NotificationDeliveryJob } from "@anar/domain/jobs";
import type { NotificationInput } from "@anar/domain/notifications";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import type { createEmailSender } from "../../src/lib/email/index.js";
import dailySummary from "../../src/lib/email/templates/dailySummary.js";
import weeklySummary from "../../src/lib/email/templates/weeklySummary.js";
import pushBindings from "../../src/modules/auth/pushBindings.js";
import delivery from "../../src/modules/notifications/delivery.js";
import notify from "../../src/modules/notifications/service.js";
import summaryEmail from "../../src/modules/notifications/summaryEmail.js";
import { queueSummaryEmail } from "../../src/modules/notifications/summaryEmailQueue.js";
import summaryEmailRepository from "../../src/modules/notifications/summaryEmailRepository.js";
import summaryRepository from "../../src/modules/reports/summaryRepository.js";
import recipients from "../../src/modules/tenant/recipients.js";
import system from "../../src/modules/tenant/system.js";
import { publicOrigin } from "../auth/fixture.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

type Company = {
  agencyId: string;
  companyId: string;
  company: { slug: string };
};
const at = new Date("2026-11-02T02:15:00.000Z");
const control = () => ({ signal: new AbortController().signal });
type User = Awaited<ReturnType<CompanyFixture["seedUser"]>>;
type Member = Awaited<ReturnType<CompanyFixture["seedMember"]>>;
type SummaryEmailFixture = {
  fixture: CompanyFixture;
  scoped<T>(company: Company, fn: (tx: TenantTx) => Promise<T>): Promise<T>;
  setup(kind?: "daily" | "weekly"): Promise<{
    company: Company;
    user: User;
    member: Member;
  }>;
  createNotice(
    company: Company,
    userId: string,
    kind: "daily" | "weekly",
    pushEnabled: boolean,
  ): Promise<NotificationDeliveryJob>;
  emailWorker(
    sendEmail: ReturnType<typeof createEmailSender>["sendEmail"],
  ): ReturnType<typeof summaryEmail.create>;
  pushWorker(
    sendPush: Parameters<typeof delivery.create>[0]["sendPush"],
  ): ReturnType<typeof delivery.create>;
  device(company: Company, user: User): Promise<string>;
  ledger(
    company: Company,
    notificationId: string,
  ): Promise<(typeof notificationDeliveries.$inferSelect)[]>;
  storedNotice(
    company: Company,
    notificationId: string,
  ): Promise<typeof notifications.$inferSelect>;
  control(): { signal: AbortSignal };
  close(): Promise<void>;
};

export async function startSummaryEmailFixture(): Promise<SummaryEmailFixture> {
  const fixture = await startCompanyFixture();
  const tenantDb = await createTenantDb(fixture.postgres.appUrl);
  const scoped = <T>(company: Company, fn: (tx: TenantTx) => Promise<T>) =>
    tenantDb.withTenant(
      {
        agencyId: company.agencyId,
        companyId: company.companyId,
        userId: v7(),
      },
      fn,
    );
  const withSystemTenant = <T>(
    scope: { agencyId: string; companyId: string; authority: "scheduler" },
    fn: (tx: TenantTx) => Promise<T>,
  ) => fixture.db.transaction((tx) => system.withSystemTenant(tx, scope, fn));
  const notifier = (pushEnabled: boolean) =>
    notify.create({
      context: fixture.apps[0].tenant,
      now: fixture.now,
      ...recipients,
      queueSummaryEmail,
      pushEnabled,
      pushHosts: [],
      vapidPublicKey: "",
      bindPushEndpoint: async () => false,
    });
  const emailWorker = (
    sendEmail: ReturnType<typeof createEmailSender>["sendEmail"],
  ) =>
    summaryEmail.create({
      ...summaryEmailRepository,
      withSystemTenant,
      now: fixture.now,
      publicOrigin,
      readScopedCompany: recipients.readScopedCompany,
      readRecipientEmail: recipients.readRecipientEmail,
      canReceiveCompanyNotification: recipients.canReceiveCompanyNotification,
      isActiveSummaryRecipient: (tx, type, userId) =>
        type === "daily"
          ? summaryRepository.isActiveAdmin(tx, userId)
          : summaryRepository.isActiveManager(tx, userId),
      mailCodec: fixture.codec,
      sendEmail,
      renderDaily: dailySummary.render,
      renderWeekly: weeklySummary.render,
    });
  const pushWorker = (
    sendPush: Parameters<typeof delivery.create>[0]["sendPush"],
  ) =>
    delivery.create({
      withSystemTenant,
      now: fixture.now,
      sendPush,
      ...recipients,
      readLivePushBinding: pushBindings.readLivePushBinding,
      queueSummaryEmail,
    });
  const device = async (
    company: Company,
    user: Parameters<CompanyFixture["loginAs"]>[0],
  ) => {
    const login = await fixture.loginAs(user, { ip: "198.51.100.191" });
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("hex")}`;
    const response = await fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/companies/${company.company.slug}/notifications/subscribePush`,
      payload: {
        endpoint,
        keys: {
          p256dh: ecdh.getPublicKey().toString("base64url"),
          auth: randomBytes(16).toString("base64url"),
        },
        expirationTime: null,
      },
      headers: { cookie: login.cookie, origin: publicOrigin },
    });
    if (response.statusCode !== 200)
      throw new Error("Could not subscribe the test device");
    return endpoint;
  };
  const notice = (
    company: Company,
    userId: string,
    kind: "daily" | "weekly",
  ): NotificationInput =>
    kind === "daily"
      ? {
          companyId: company.companyId,
          userId,
          title: "Today's leads",
          body: "1 overdue, 2 due today, 3 new.",
          url: `/${company.company.slug}/today`,
          dedupeKey: `daily:${company.companyId}:2026-11-02`,
          data: {
            type: "daily",
            localDate: "2026-11-02",
            overdue: 1,
            dueToday: 2,
            newLeads: 3,
          },
        }
      : {
          companyId: company.companyId,
          userId,
          title: "Weekly summary",
          body: "3 leads, 0 calls, 0 visits, 0 bookings, 0 overdue.",
          url: `/${company.company.slug}/notifications`,
          dedupeKey: `weekly:${company.companyId}:2026-10-26`,
          data: {
            type: "weekly",
            weekStart: "2026-10-26",
            leads: 3,
            calls: 0,
            siteVisits: 0,
            bookings: 0,
            overdue: 0,
            staffCalls: 0,
            top: null,
            bottom: null,
          },
        };
  const createNotice = async (
    company: Company,
    userId: string,
    kind: "daily" | "weekly",
    pushEnabled: boolean,
  ) => {
    const saved = await scoped(company, (tx) =>
      notifier(pushEnabled).notify(tx, notice(company, userId, kind)),
    );
    return {
      agencyId: company.agencyId,
      companyId: company.companyId,
      notificationId: saved.id,
    };
  };
  const ledger = (company: Company, notificationId: string) =>
    scoped(company, (tx) =>
      tx
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.notificationId, notificationId))
        .orderBy(notificationDeliveries.id),
    );
  const storedNotice = (company: Company, notificationId: string) =>
    scoped(company, async (tx) => {
      const [row] = await tx
        .select()
        .from(notifications)
        .where(eq(notifications.id, notificationId));
      return row;
    });
  const setup = async (kind: "daily" | "weekly" = "daily") => {
    fixture.setTime(at.getTime());
    const base = await fixture.setup();
    const user = await fixture.seedUser();
    const member = await fixture.seedMember(
      base.a,
      user.id,
      "active",
      kind === "daily" ? "admin" : "super_admin",
    );
    return { company: base.a, user, member };
  };
  return {
    fixture,
    scoped,
    setup,
    createNotice,
    emailWorker,
    pushWorker,
    device,
    ledger,
    storedNotice,
    control,
    async close() {
      try {
        await tenantDb.close();
      } finally {
        await fixture.close();
      }
    },
  };
}
