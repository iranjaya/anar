import { isDeepStrictEqual } from "node:util";
import { readCompanyScope, type TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  type MarkReadInput,
  markReadSchema,
  type Notification,
  type NotificationData,
  type NotificationInput,
  type NotificationPage,
  type NotificationQuery,
  notificationInputSchema,
  notificationQuerySchema,
  notificationSlug,
} from "@anar/domain/notifications";
import type { FastifyRequest } from "fastify";
import { v7 } from "uuid";
import { enqueue } from "../../lib/jobs/index.js";
import audit from "../tenant/audit.js";
import type tenant from "../tenant/index.js";
import type { Ctx } from "../tenant/index.js";
import repository from "./repository.js";
import subscriptions, { type PushDeps } from "./subscriptions.js";

export type NotificationDeps = {
  context: Pick<
    ReturnType<typeof tenant.create>,
    "requireContext" | "withContext"
  >;
  now(): Date;
  canReceiveCompanyNotification(tx: TenantTx, userId: string): Promise<boolean>;
  readScopedCompanySlug(tx: TenantTx): Promise<string>;
  queueSummaryEmail?(
    tx: TenantTx,
    job: { agencyId: string; companyId: string; notificationId: string },
  ): Promise<void>;
} & PushDeps;
type Cursor = { createdAt: Date; id: string };
const pageSize = 50;

type Content = Pick<
  NotificationInput,
  "companyId" | "title" | "body" | "url"
> & { type: string; data: unknown };

const notifications = {
  create(deps: NotificationDeps) {
    return {
      ...subscriptions.create(deps),
      async notify(
        tx: TenantTx,
        raw: NotificationInput,
      ): Promise<{ id: string }> {
        const parsed = notificationInputSchema.safeParse(raw);
        if (!parsed.success)
          throw new AppError("validation", "Notification is not valid");
        const input = parsed.data;
        const scope = await readCompanyScope(tx);
        if (input.companyId !== scope.companyId)
          throw new AppError(
            "forbidden",
            "Notification is for another company",
          );
        if (
          notificationSlug(input.url) !== (await deps.readScopedCompanySlug(tx))
        )
          throw new AppError("validation", "Notification link is not valid");
        if (!(await deps.canReceiveCompanyNotification(tx, input.userId)))
          throw new AppError("forbidden", "Recipient cannot be notified");
        const row = { ...input, type: input.data.type };
        const inserted = await repository.insert(tx, { id: v7(), ...row });
        if (inserted) {
          if (deps.pushEnabled)
            await enqueue(
              tx,
              "notify.push",
              {
                agencyId: scope.agencyId,
                companyId: scope.companyId,
                notificationId: inserted.id,
              },
              `push:${scope.companyId}:${inserted.id}`,
            );
          else if (
            input.data.type === "daily" ||
            input.data.type === "weekly"
          ) {
            if (!deps.queueSummaryEmail)
              throw new Error("Summary email queue is unavailable");
            await deps.queueSummaryEmail(tx, {
              agencyId: scope.agencyId,
              companyId: scope.companyId,
              notificationId: inserted.id,
            });
          }
          return inserted;
        }
        const existing = await repository.readByKey(
          tx,
          input.userId,
          input.dedupeKey,
        );
        if (!existing || !notifications._sameContent(existing, row))
          throw new AppError("conflict", "Notification key is already used");
        return { id: existing.id };
      },
      requireContext(
        request: Pick<FastifyRequest, "headers">,
        slug: string,
      ): Promise<Ctx> {
        return deps.context.requireContext(request, slug);
      },
      listNotifications(
        actor: Ctx,
        input: NotificationQuery,
      ): Promise<NotificationPage> {
        const parsed = notificationQuerySchema.safeParse(input);
        if (!parsed.success)
          throw new AppError("validation", "Notification page is not valid");
        const cursor = parsed.data.cursor
          ? notifications._decodeCursor(parsed.data.cursor)
          : null;
        return deps.context.withContext(actor, async (tx, current) => {
          const owner = {
            companyId: current.companyId,
            userId: current.user.id,
          };
          const rows = await repository.list(tx, owner, cursor, pageSize + 1);
          const items = rows.slice(0, pageSize).map(
            ({ updatedAt: _updatedAt, ...row }): Notification => ({
              ...row,
              data: row.data as NotificationData,
            }),
          );
          const last = items.at(-1);
          return {
            items,
            nextCursor:
              rows.length > pageSize && last
                ? notifications._encodeCursor(last)
                : null,
            unreadCount: await repository.countUnread(tx, owner),
          };
        });
      },
      markRead(
        actor: Ctx,
        input: MarkReadInput,
        meta: { ip: string | null },
      ): Promise<{ ok: true }> {
        const parsed = markReadSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError("validation", "Choose notifications to mark read");
        const { ids } = parsed.data;
        return deps.context.withContext(actor, async (tx, current) => {
          const owned = await repository.lockOwn(
            tx,
            { companyId: current.companyId, userId: current.user.id },
            ids,
          );
          if (owned.length !== ids.length)
            throw new AppError("not_found", "Notification not found");
          const unread = owned.filter((row) => row.readAt === null);
          if (!unread.length) return { ok: true };
          await repository.markRead(
            tx,
            unread.map((row) => row.id),
            deps.now(),
          );
          if (current.role === "agency_staff")
            await audit.audit(
              tx,
              {
                user: current.user,
                role: current.role,
                agencyId: current.agencyId,
                companyId: current.companyId,
                ip: meta.ip,
              },
              "notifications.read",
              { type: "company", id: current.companyId },
              { count: String(unread.length) },
            );
          return { ok: true };
        });
      },
    };
  },
  _encodeCursor(row: Cursor): string {
    return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString(
      "base64url",
    );
  },
  _decodeCursor(value: string): Cursor {
    const [at, id, extra] = Buffer.from(value, "base64url")
      .toString()
      .split("|");
    const createdAt = new Date(at ?? "");
    if (
      extra !== undefined ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at ?? "") ||
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== at ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        id ?? "",
      )
    )
      throw new AppError("validation", "Notification page is not valid");
    return { createdAt, id };
  },
  _sameContent(existing: Content, row: Content): boolean {
    return (
      existing.companyId === row.companyId &&
      existing.type === row.type &&
      existing.title === row.title &&
      existing.body === row.body &&
      existing.url === row.url &&
      isDeepStrictEqual(existing.data, row.data)
    );
  },
};
export type NotificationService = ReturnType<typeof notifications.create>;
export default notifications;
