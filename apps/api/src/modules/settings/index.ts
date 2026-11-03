import defaults from "./defaults.js";
import fields from "./fields.js";
import history from "./history.js";
import importOptions from "./importOptions.js";
import repository from "./repository.js";
import settings from "./service.js";

export type { SettingsReferenceReader } from "./fields.js";
export type { SettingsRouteOptions } from "./routes.js";
export { default as settingsRoutes } from "./routes.js";
export type { SettingsDeps, SettingsService } from "./service.js";

export const createSettingsService = settings.create;
export const loadSchema = settings.loadSchema;
export const seedDefaults = defaults.seedDefaults;
export const createFields = fields.createFields;
export const extendFieldOptions = importOptions.extendFieldOptions;
export const fieldKeys = repository.fieldKeys;
export const { loadHistoricalReferences, readOutcomeFacts } = history;
