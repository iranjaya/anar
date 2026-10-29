import { apiFailureSchema, apiSuccessSchema } from "@anar/domain/http";
import type { z } from "zod";
import { AppError } from "@/lib/errors";

export async function parseApiResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  const body: unknown = await response.json();
  if (response.ok) {
    const parsed = apiSuccessSchema(schema).safeParse(body);
    if (parsed.success) return parsed.data.data;
  } else {
    const failure = apiFailureSchema.safeParse(body);
    if (failure.success) {
      const expected = {
        unauthorized: [401],
        forbidden: [403],
        not_found: [404],
        validation: [400, 429],
        conflict: [409],
        step_up_required: [428],
        unavailable: [500, 503],
      };
      if (expected[failure.data.error].includes(response.status))
        throw new AppError(failure.data.error, failure.data.message);
    }
  }
  throw new AppError(
    "unavailable",
    "The service returned an unexpected response. Try again.",
  );
}
