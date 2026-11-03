import assign from "./assign.js";
import detail from "./detail.js";
import due from "./due.js";
import followUp from "./followUp.js";
import importMatches from "./importMatches.js";
import importWrite from "./importWrite.js";
import list from "./list.js";
import nextLead from "./nextLead.js";
import referenceCounts from "./referenceCounts.js";
import stage from "./stage.js";
import suggestion from "./suggestion.js";
import summaryReads from "./summaryReads.js";
import today from "./today.js";
import update from "./update.js";

export type { LeadAssignDeps, LeadAssignService } from "./assign.js";
export type { LeadDetailDeps, LeadDetailService } from "./detail.js";
export type { EventActor } from "./events.js";
export type { LeadFollowUpDeps, LeadFollowUpService } from "./followUp.js";
export type { LeadListDeps, LeadListService } from "./list.js";
export type {
  LeadAssignRouteOptions,
  LeadDetailRouteOptions,
  LeadRouteOptions,
  LeadStageRouteOptions,
  LeadSuggestionRouteOptions,
  LeadUpdateRouteOptions,
} from "./routes.js";
export { default as leadRoutes } from "./routes.js";
export type { LeadStageDeps, LeadStageService, StageDeps } from "./stage.js";
export type {
  LeadSuggestionDeps,
  LeadSuggestionService,
} from "./suggestion.js";
export type { WeeklyCounts } from "./summaryReads.js";
export type { TodayDeps, TodayService } from "./today.js";
export type { TodayRouteOptions } from "./todayRoutes.js";
export { default as todayRoutes } from "./todayRoutes.js";
export type { LeadUpdateDeps, LeadUpdateService } from "./update.js";
export const createLeadListService = list.create;
export const createLeadDetailService = detail.create;
export const createLeadUpdateService = update.create;
export const createLeadStageService = stage.create;
export const createLeadSuggestionService = suggestion.create;
export const { applyStageChange } = stage;
export const createLeadFollowUpService = followUp.create;
export const { readVisibleLeadForCall, applyFollowUp } = followUp;
export const { readOriginalBucket, nextLeadId } = nextLead;
export const createLeadAssignService = assign.create;
export const { assignLeads, reassignOpenLeads } = assign;
export const createTodayService = today.create;
export const { listDueFollowUps, isOverdueForUser } = due;
export const { readDailyCounts, readWeeklyCounts } = summaryReads;
export const { findImportMatches } = importMatches;
export const { addImportedLeads } = importWrite;
export const {
  getReferenceCounts,
  getMemberOpenLeadCount,
  getMemberLeadCounts,
} = referenceCounts;
