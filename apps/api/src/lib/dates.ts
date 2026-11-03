import { AppError } from "@anar/domain/errors";

export type ParsedLeadDate = { value: Date; issue: "bad_date" | null };
type Parts = [number, number, number, number, number, number, number];

const dayOrder: Record<string, "dmy" | "mdy"> = { NP: "dmy", US: "mdy" };
const time = String.raw`(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)`;
const isoOffset = new RegExp(
  String.raw`^(\d{4})-(\d{2})-(\d{2})${time}(Z|[+-]\d{2}:?\d{2})$`,
);
const isoLocal = new RegExp(String.raw`^(\d{4})-(\d{2})-(\d{2})${time}?$`);
const slashed = new RegExp(
  String.raw`^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})${time}?$`,
);
const dayMs = 24 * 60 * 60_000;

const dates = {
  parseLeadDate(
    raw: string | null,
    input: { defaultCountry: string; timezone: string; importedAt: Date },
  ): ParsedLeadDate {
    const text = raw?.trim() ?? "";
    const value =
      dates.parseOffsetDate(text) ??
      dates._parseLocal(text, input.defaultCountry, input.timezone);
    if (!value) return { value: input.importedAt, issue: "bad_date" };
    return { value, issue: null };
  },
  // Only dates that carry their own offset, so no company setting is needed.
  parseOffsetDate(text: string): Date | null {
    const match = isoOffset.exec(text);
    if (!match) return null;
    const parts = dates._parts(match[1], match[2], match[3], match.slice(4, 8));
    if (!parts) return null;
    const zone = match[8];
    const sign = zone.startsWith("-") ? -1 : 1;
    const digits = zone === "Z" ? "0000" : zone.slice(1).replace(":", "");
    const hours = Number(digits.slice(0, 2));
    const minutes = Number(digits.slice(2));
    if (hours > 14 || minutes > 59) return null;
    const offset = sign * (hours * 60 + minutes);
    return new Date(Date.UTC(...parts) - offset * 60_000);
  },
  // Midnight that starts the local day `days` after a YYYY-MM-DD date.
  localMidnight(localDate: string, days: number, timezone: string): Date {
    const [year, month, day] = localDate.split("-").map(Number);
    return dates._inZone([year, month - 1, day + days, 0, 0, 0, 0], timezone);
  },
  localDate(at: Date, timezone: string): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  },
  localDayBounds(at: Date, timezone: string) {
    const localDate = dates.localDate(at, timezone);
    return {
      at,
      start: dates.localMidnight(localDate, 0, timezone),
      end: dates.localMidnight(localDate, 1, timezone),
      dayAgo: new Date(at.getTime() - dayMs),
    };
  },
  previousLocalWeekBounds(at: Date, timezone: string) {
    const localDate = dates.localDate(at, timezone);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    }).format(at);
    const daysSinceMonday = [
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ].indexOf(weekday);
    const start = dates.localMidnight(
      localDate,
      -daysSinceMonday - 7,
      timezone,
    );
    const end = dates.localMidnight(localDate, -daysSinceMonday, timezone);
    return {
      weekStart: dates.localDate(start, timezone),
      weekEnd: dates.localDate(end, timezone),
      start,
      end,
    };
  },
  looksLikeDate(text: string): boolean {
    return [isoOffset, isoLocal, slashed].some((pattern) => pattern.test(text));
  },
  _parseLocal(text: string, country: string, timezone: string): Date | null {
    const iso = isoLocal.exec(text);
    if (iso) {
      const parts = dates._parts(iso[1], iso[2], iso[3], iso.slice(4, 8));
      return parts && dates._inZone(parts, timezone);
    }
    const match = slashed.exec(text);
    if (!match) return null;
    const first = Number(match[1]);
    const second = Number(match[2]);
    let order: "dmy" | "mdy";
    if (first > 12) order = "dmy";
    else if (second > 12) order = "mdy";
    else {
      const local = dayOrder[country];
      if (!local)
        throw new AppError(
          "validation",
          "Date order for this country is unknown",
        );
      order = local;
    }
    const [day, month] =
      order === "dmy" ? [match[1], match[2]] : [match[2], match[1]];
    const parts = dates._parts(match[3], month, day, match.slice(4, 8));
    return parts && dates._inZone(parts, timezone);
  },
  _parts(
    year: string,
    month: string,
    day: string,
    clock: (string | undefined)[],
  ): Parts | null {
    const [hour, minute, second] = clock
      .slice(0, 3)
      .map((part) => Number(part ?? 0));
    const ms = Number((clock[3] ?? "").padEnd(3, "0"));
    const parts: Parts = [
      Number(year),
      Number(month) - 1,
      Number(day),
      hour,
      minute,
      second,
      ms,
    ];
    const check = new Date(Date.UTC(...parts));
    if (
      check.getUTCFullYear() !== parts[0] ||
      check.getUTCMonth() !== parts[1] ||
      check.getUTCDate() !== parts[2] ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    )
      return null;
    return parts;
  },
  _inZone(parts: Parts, timezone: string): Date {
    const guess = Date.UTC(...parts);
    const first = guess - dates._offset(guess, timezone);
    return new Date(guess - dates._offset(first, timezone));
  },
  _offset(at: number, timezone: string): number {
    const shown = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      })
        .formatToParts(at)
        .map((part) => [part.type, Number(part.value)]),
    );
    const local = Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute,
      shown.second,
    );
    return local - (at - (at % 1000));
  },
};
export default dates;
