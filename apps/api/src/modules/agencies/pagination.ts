import {
  type AgencyListQuery,
  agencyCursorSchema,
  agencyListQuerySchema,
} from "@anar/domain/agencies";
import { AppError } from "@anar/domain/errors";

export type AgencyCursor = { createdAt: Date; id: string };
const pagination = {
  cursor(query: AgencyListQuery): AgencyCursor | undefined {
    const parsed = agencyListQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new AppError("validation", "Invalid list cursor");
    if (!parsed.data.cursor) return undefined;
    try {
      const cursor = agencyCursorSchema.parse(
        JSON.parse(
          Buffer.from(parsed.data.cursor, "base64url").toString("utf8"),
        ),
      );
      return { createdAt: new Date(cursor.createdAt), id: cursor.id };
    } catch {
      throw new AppError("validation", "Invalid list cursor");
    }
  },
  page<T extends AgencyCursor>(
    rows: T[],
  ): { items: T[]; nextCursor: string | null } {
    const items = rows.slice(0, 50);
    const last = items.at(-1);
    const nextCursor =
      rows.length > 50 && last
        ? Buffer.from(
            JSON.stringify({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            }),
          ).toString("base64url")
        : null;
    return { items, nextCursor };
  },
};
export default pagination;
