import { DateTime } from "luxon";

export function computeSendTime(
  deadline: DateTime,
  offsetMinutes: number,
): DateTime {
  return deadline.minus({ minutes: offsetMinutes });
}
