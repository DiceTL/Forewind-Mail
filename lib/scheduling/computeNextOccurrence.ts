import { DateTime } from "luxon";
import type { RRule } from "rrule";

export function computeNextOccurrence(
  rule: RRule,
  after: DateTime,
): DateTime | null {
  const result = rule.after(after.toJSDate(), false);
  if (result === null) return null;
  return DateTime.fromJSDate(result, { zone: "utc" });
}
