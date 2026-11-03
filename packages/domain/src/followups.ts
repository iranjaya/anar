import { z } from "zod";
import { wireDateSchema } from "./http.js";
import {
  type FollowUp,
  followUpWireSchema,
  type Lead,
  leadWireSchema,
} from "./leads.js";

const offsetDate = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const logFollowUpInputSchema = z.strictObject({
  requestId: z.uuid(),
  leadId: z.uuid(),
  outcomeId: z.uuid(),
  notes: z.string().max(2000).nullable().optional(),
  nextActionAt: offsetDate.nullable().optional(),
  stageId: z.uuid().optional(),
  lostReasonId: z.uuid().nullable().optional(),
  custom: z
    .record(z.string(), z.union([z.string(), z.number(), z.null()]))
    .optional(),
});

export type LogFollowUpWireInput = z.input<typeof logFollowUpInputSchema>;
export type LogFollowUpInput = z.output<typeof logFollowUpInputSchema>;
export type LogFollowUpResult = {
  lead: Lead;
  followUp: FollowUp;
  lostSuggested: boolean;
  nextLeadId: string | null;
};

export const logFollowUpResultWireSchema = z.strictObject({
  lead: leadWireSchema,
  followUp: followUpWireSchema,
  lostSuggested: z.boolean(),
  nextLeadId: z.uuid().nullable(),
});
export type LogFollowUpWireResult = z.infer<typeof logFollowUpResultWireSchema>;

const date = wireDateSchema.transform((value) => new Date(value));
export const logFollowUpResultSchema = logFollowUpResultWireSchema.extend({
  lead: leadWireSchema.extend({
    leadDate: date,
    scoredAt: date,
    nextActionAt: date.nullable(),
    lastContactedAt: date.nullable(),
    lostSuggestedAt: date.nullable(),
    deletedAt: date.nullable(),
    createdAt: date,
  }),
  followUp: logFollowUpResultWireSchema.shape.followUp.extend({
    happenedAt: date,
    nextActionAt: date.nullable(),
  }),
});

export function logFollowUpWire(
  result: LogFollowUpResult,
): LogFollowUpWireResult {
  const lead = result.lead;
  return logFollowUpResultWireSchema.parse({
    ...result,
    lead: {
      ...lead,
      leadDate: lead.leadDate.toISOString(),
      scoredAt: lead.scoredAt.toISOString(),
      nextActionAt: lead.nextActionAt?.toISOString() ?? null,
      lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
      lostSuggestedAt: lead.lostSuggestedAt?.toISOString() ?? null,
      deletedAt: lead.deletedAt?.toISOString() ?? null,
      createdAt: lead.createdAt.toISOString(),
    },
    followUp: {
      ...result.followUp,
      happenedAt: result.followUp.happenedAt.toISOString(),
      nextActionAt: result.followUp.nextActionAt?.toISOString() ?? null,
    },
  });
}
