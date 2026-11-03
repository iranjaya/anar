import summaries from "./summaries.js";
import summaryRepository from "./summaryRepository.js";

export type { SummaryDeps, SummaryJob, SummaryService } from "./summaries.js";
export { default as summaryRepository } from "./summaryRepository.js";
export const createSummaryService = summaries.create;
export const summaryReads = summaryRepository;
