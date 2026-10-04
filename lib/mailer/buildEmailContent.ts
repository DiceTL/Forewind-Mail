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
  html?: string;
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

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtml({
  title,
  deadline,
  offsetMinutes,
  timezone,
}: BuildEmailContentInput): string {
  const lead = formatLeadTime(offsetMinutes);
  const safeTitle = escapeHtml(title);
  const safeLead = escapeHtml(lead);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const safeAppUrl = escapeHtml(appUrl);

  const deadlineBlock =
    deadline && deadline.isValid
      ? `<p style="margin: 16px 0; padding: 12px; background-color: #f5f5f5;">Due: ${escapeHtml(formatDeadlineLocal(deadline, timezone))}</p>`
      : "";

  const footerBlock = safeAppUrl
    ? `<p style="margin: 24px 0 0; font-size: 12px; color: #666666;">Open Forewind Mail to mark it done or update the reminder. ${safeAppUrl}</p>`
    : `<p style="margin: 24px 0 0; font-size: 12px; color: #666666;">Open Forewind Mail to mark it done or update the reminder.</p>`;

  return [
    `<div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">`,
    `<p style="margin: 0 0 16px; font-size: 14px; color: #666666;">Forewind Mail</p>`,
    `<h1 style="margin: 0 0 8px; font-size: 24px;">${safeTitle}</h1>`,
    deadlineBlock,
    `<p><span style="display: inline-block; padding: 4px 12px; background-color: #eeeeee;">${safeLead} before</span></p>`,
    footerBlock,
    `</div>`,
  ].join("");
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
    return {
      subject,
      text,
      html: buildHtml({ title, deadline, offsetMinutes, timezone }),
    };
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
  return {
    subject,
    text,
    html: buildHtml({ title, deadline, offsetMinutes, timezone }),
  };
}
