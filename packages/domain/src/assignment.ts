import { z } from "zod";

export const assignLeadsInputSchema = z.strictObject({
  leadIds: z
    .array(z.uuid())
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "Each lead once"),
  memberId: z.uuid().nullable(),
});
export type AssignLeadsInput = z.infer<typeof assignLeadsInputSchema>;
export type AssignedData = {
  assignmentId: string;
  from: string | null;
  to: string;
};
export type UnassignedData = {
  assignmentId: string;
  from: string | null;
  to: null;
};
export const assignLeadsResultSchema = z.strictObject({
  updated: z.number().int().nonnegative(),
});
