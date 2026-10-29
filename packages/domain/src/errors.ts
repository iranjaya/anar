export type AppErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "step_up_required"
  | "unavailable";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppErrorCode; message: string };

export function actionFailure(error: unknown): ActionResult<never> {
  if (!(error instanceof AppError)) throw error;
  return { ok: false, error: error.code, message: error.message };
}
