import { AppError } from "@anar/domain/errors";

export type Cursor = { at: Date; id: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isoMs = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// The tag ties a cursor to the query that made it, so it fails on any other one.
const cursor = {
  encode(row: Cursor, tag: string): string {
    return Buffer.from(`${row.at.toISOString()}|${row.id}|${tag}`).toString(
      "base64url",
    );
  },

  decode(value: string, tag: string, message: string): Cursor {
    const [at, id, used, extra] = Buffer.from(value, "base64url")
      .toString()
      .split("|");
    const date = new Date(at ?? "");
    if (
      extra !== undefined ||
      !isoMs.test(at ?? "") ||
      Number.isNaN(date.getTime()) ||
      date.toISOString() !== at ||
      !uuid.test(id ?? "") ||
      used !== tag
    )
      throw new AppError("validation", message);
    return { at: date, id: id as string };
  },
};
export default cursor;
