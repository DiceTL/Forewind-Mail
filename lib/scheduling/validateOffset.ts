import type { DateTime } from "luxon";

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: "too_small" | "not_multiple_of_five" | "already_past" };

export function validateOffset(
  offsetMinutes: number,
  deadline: DateTime | null,
  now: DateTime,
): ValidationResult {
  if (offsetMinutes < 5) {
    return { ok: false, reason: "too_small" };
  }
  if (offsetMinutes % 5 !== 0) {
    return { ok: false, reason: "not_multiple_of_five" };
  }
  if (deadline !== null && deadline.minus({ minutes: offsetMinutes }) < now) {
    return { ok: false, reason: "already_past" };
  }
  return { ok: true };
}
