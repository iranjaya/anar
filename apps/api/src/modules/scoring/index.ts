import config from "./config.js";
import defaults from "./defaults.js";
import score from "./score.js";

export type {
  ScoreInput,
  ScoreResult,
  ScoringConfig,
  ScoringRule,
} from "@anar/domain/scoring";
export type { ScoringDeps, ScoringService } from "./config.js";
export type { ScoringRouteOptions } from "./routes.js";
export { default as scoringRoutes } from "./routes.js";
export const { scoreLead } = score;
export const { loadActiveConfig } = config;
export const { seedScoringDefaults } = defaults;
export const createScoringService = config.create;
