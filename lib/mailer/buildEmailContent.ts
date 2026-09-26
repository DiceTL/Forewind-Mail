import { DateTime } from "luxon";

export type BuildEmailContentInput = {
  title: string;
  deadline: DateTime | null;
  offsetMinutes: number;
  timezone: string;
};

export type EmailContent = {
  subject: string;
  text: string;
};

function formatLeadTime(offsetMinutes: number): string {
  if (!Number.isFinite(offsetMinutes) || offsetMinutes <= 0) {
    return "5 minutes";
  }
  const rounded = Math.round(offsetMinutes);
  if (rounded < 60) {
    return `${rounded} minutes`;
  }
  if (rounded % 60 === 0) {
    const hours = rounded / 60;
    return `${hours} hour${hours === 1 ? "" : "s"} (${rounded} minutes)`;
  }
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return `${hours}h ${mins}m (${rounded} minutes)`;
}

function formatDeadlineLocal(deadline: DateTime, timezone: string): string {
  let local = deadline.setZone(timezone);
  if (!local.isValid) {
    local = deadline.setZone("utc");
  }
  return local.toFormat("EEEE, MMMM d, yyyy 'at' h:mm a ZZZZ");
}

export function buildEmailContent({
  title,
  deadline,
  offsetMinutes,
  timezone,
}: BuildEmailContentInput): EmailContent {
  const lead = formatLeadTime(offsetMinutes);
  const subject = `Reminder: ${title} — due in ${lead}`;

  const closing =
    "Open Forewind Mail to mark it done or update the reminder.";

  if (deadline && deadline.isValid) {
    const when = formatDeadlineLocal(deadline, timezone);
    const text = [
      `Hi,`,
      ``,
      `This is a reminder: ${title}.`,
      ``,
      `Due: ${when}`,
      `Sending this ${lead} before the deadline.`,
      ``,
      closing,
    ].join("\n");
    return { subject, text };
  }

  const text = [
    `Hi,`,
    ``,
    `This is a reminder: ${title}.`,
    ``,
    `This reminder has no fixed deadline. Sending this ${lead} before your planned time.`,
    ``,
    closing,
  ].join("\n");
  return { subject, text };
}
