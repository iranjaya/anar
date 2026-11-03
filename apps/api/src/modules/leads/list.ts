import { createHash } from "node:crypto";
import type { TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import {
  type LeadFilters,
  type LeadPage,
  type LeadRow,
  leadFiltersSchema,
} from "@anar/domain/leads";
import type { CompanySchema } from "@anar/domain/settings";
import type { FastifyRequest } from "fastify";
import { type CountryCode, getCountryCallingCode } from "libphonenumber-js/max";
import type tenant from "../tenant/index.js";
import type { Ctx } from "../tenant/index.js";
import permissions from "../tenant/permissions.js";
import cursor from "./cursor.js";
import repository, { type QueueFilter } from "./repository.js";

export type LeadListDeps = {
  context: Pick<
    ReturnType<typeof tenant.create>,
    "requireContext" | "withContext"
  >;
  loadSchema(tx: TenantTx): Promise<CompanySchema>;
};
type Filter = Omit<QueueFilter, "name" | "phonePrefix"> & { q: string | null };
const pageSize = 50;
const invalidPage = "This page of leads is not valid";

const list = {
  create(deps: LeadListDeps) {
    return {
      requireContext(
        request: Pick<FastifyRequest, "headers">,
        slug: string,
      ): Promise<Ctx> {
        return deps.context.requireContext(request, slug);
      },
      listLeads(actor: Ctx, raw: LeadFilters): Promise<LeadPage> {
        const parsed = leadFiltersSchema.safeParse(raw);
        if (!parsed.success)
          throw new AppError("validation", "Lead filters are not valid");
        return deps.context.withContext(actor, async (tx, current) => {
          permissions.require(current, "leads.view");
          const filter = list._filter(current, parsed.data);
          const fingerprint = list._fingerprint(filter);
          const after = parsed.data.cursor
            ? cursor.decode(parsed.data.cursor, fingerprint, invalidPage)
            : null;
          const query = list._query(filter, current.company.defaultCountry);
          const rows = await repository.listQueue(
            tx,
            query,
            after,
            pageSize + 1,
          );
          const schema = await deps.loadSchema(tx);
          const dropdowns = schema.fields
            .filter((field) => field.type === "dropdown")
            .sort((a, b) => a.position - b.position);
          const items = rows.slice(0, pageSize).map(
            (row): LeadRow => ({
              id: row.id,
              fullName: row.fullName,
              phoneE164: row.phoneE164,
              phoneValid: row.phoneValid,
              priority: row.priority,
              score: row.score,
              nextActionAt: row.nextActionAt,
              failedAttempts: row.failedAttempts,
              source: row.source,
              leadDate: row.leadDate,
              stage: row.stage,
              answers: dropdowns.flatMap((field) => {
                const option = field.options?.find(
                  (option) => option.value === row.custom[field.key],
                );
                return option ? [{ key: field.key, label: option.label }] : [];
              }),
              assignedAt: null,
              assignee:
                row.assigneeId && row.assigneeName
                  ? { memberId: row.assigneeId, name: row.assigneeName }
                  : null,
              bucket: null,
            }),
          );
          const last = items.at(-1);
          return {
            items,
            nextCursor:
              rows.length > pageSize && last
                ? cursor.encode({ at: last.leadDate, id: last.id }, fingerprint)
                : null,
            total: await repository.countQueue(tx, query),
          };
        });
      },
    };
  },

  // An Admin only ever sees their own leads; asking for anyone else's is refused, not narrowed.
  _filter(current: Ctx, input: LeadFilters): Filter {
    const base = {
      priority: input.priority ?? null,
      stageId: input.stageId ?? null,
      q: input.q || null,
    };
    if (current.role !== "admin")
      return { ...base, assignedTo: input.assignedTo ?? "unassigned" };
    if (
      input.assignedTo !== undefined &&
      input.assignedTo !== current.member.id
    )
      throw new AppError("forbidden", "This action is not allowed");
    return { ...base, assignedTo: current.member.id };
  },

  _query(filter: Filter, country: string): QueueFilter {
    const { q, ...rest } = filter;
    const phonePrefix = q && list._phonePrefix(q, country);
    return { ...rest, name: phonePrefix ? null : q, phonePrefix };
  },

  // Matches the start of the stored E.164 number, typed either in full or in the national form.
  _phonePrefix(q: string, country: string): string | null {
    if (!/^\+?[\d\s\-.()]+$/.test(q)) return null;
    const digits = q.replace(/\D/g, "");
    if (digits.length < 3) return null;
    if (q.startsWith("+")) return `+${digits}`;
    if (digits.startsWith("00")) return `+${digits.slice(2)}`;
    const code = getCountryCallingCode(country as CountryCode);
    return `+${code}${digits.replace(/^0/, "")}`;
  },

  _fingerprint(filter: Filter): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          filter.assignedTo,
          filter.priority,
          filter.stageId,
          filter.q,
        ]),
      )
      .digest("base64url")
      .slice(0, 16);
  },
};
export type LeadListService = ReturnType<typeof list.create>;
export default list;
