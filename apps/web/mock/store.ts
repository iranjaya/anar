import { requireDemoMode } from "@/lib/api/mode";
import type {
  ImportBatch,
  ImportRow,
  MappingTemplate,
} from "@/modules/imports/types";
import type { FollowUp, Lead, LeadEvent } from "@/modules/leads/types";
import type { Target } from "@/modules/reports/types";
import type { ScoringConfig } from "@/modules/scoring/types";
import type {
  Field,
  LostReason,
  Outcome,
  Stage,
} from "@/modules/settings/types";
import type { Company, Member, User } from "@/modules/tenant/types";
import { buildSeed } from "./seed";

export type MockStore = {
  companies: Company[];
  users: User[];
  members: Member[];
  fields: Field[];
  stages: Stage[];
  outcomes: Outcome[];
  lostReasons: LostReason[];
  scoringConfigs: ScoringConfig[];
  mappingTemplates: MappingTemplate[];
  importBatches: ImportBatch[];
  importRows: ImportRow[];
  leads: Lead[];
  followUps: FollowUp[];
  events: LeadEvent[];
  targets: Target[];
};

const globalStore = globalThis as typeof globalThis & { anarStore?: MockStore };

export function db(): MockStore {
  requireDemoMode();
  globalStore.anarStore ??= buildSeed(new Date());
  return globalStore.anarStore;
}

export function resetStore(now: Date): MockStore {
  requireDemoMode();
  globalStore.anarStore = buildSeed(now);
  return globalStore.anarStore;
}
