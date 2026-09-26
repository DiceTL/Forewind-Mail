import { DateTime } from "luxon";
import { buildEmailContent } from "@/lib/mailer/buildEmailContent";
import { sendEmail } from "@/lib/mailer/sendEmail";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MAX_SEND_ATTEMPTS = 3;

function parseMaxAttempts(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_SEND_ATTEMPTS;
  }
  return parsed;
}

function deriveOffsetMinutes(
  deadline: DateTime | null,
  sendAtIso: string,
): number {
  if (deadline && deadline.isValid) {
    const sendAt = DateTime.fromISO(sendAtIso, { zone: "utc" });
    if (sendAt.isValid) {
      const diff = Math.round(
        (deadline.toMillis() - sendAt.toMillis()) / 60000,
      );
      if (Number.isFinite(diff)) {
        return Math.max(5, diff);
      }
    }
  }
  return 5;
}

type DueOccurrence = {
  id: string;
  reminder_id: string;
  send_at: string;
  status: string;
  attempt_count: number;
};

type ReminderRow = {
  id: string;
  user_id: string;
  title: string;
  deadline: string | null;
};

type ProfileRow = {
  user_id: string;
  timezone: string;
  paused: boolean;
};

function firstRow<T>(data: T | T[] | null): T | null {
  if (!data) return null;
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return data;
}

export async function POST(req: Request): Promise<Response> {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return Response.json(
      { error: "Server misconfigured: missing CRON_SECRET." },
      { status: 500 },
    );
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const maxAttempts = parseMaxAttempts(process.env.MAX_SEND_ATTEMPTS);
  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: dueRows, error: dueError } = await supabase
    .from("reminder_occurrences")
    .select("id,reminder_id,send_at,status,attempt_count")
    .eq("status", "pending")
    .lte("send_at", nowIso);

  if (dueError) {
    return Response.json({ error: "Failed to load due occurrences." }, { status: 500 });
  }

  const due = (dueRows ?? []) as DueOccurrence[];
  let sent = 0;
  let failed = 0;
  let pendingRetry = 0;
  let skipped = 0;

  for (const occ of due) {
    try {
      const { data: reminderRows } = await supabase
        .from("reminders")
        .select("id,user_id,title,deadline")
        .eq("id", occ.reminder_id);
      const reminder = firstRow<ReminderRow>(
        reminderRows as unknown as ReminderRow[] | null,
      );
      if (!reminder) {
        skipped += 1;
        continue;
      }

      const { data: profileRows } = await supabase
        .from("profiles")
        .select("user_id,timezone,paused")
        .eq("user_id", reminder.user_id);
      const profile = firstRow<ProfileRow>(
        profileRows as unknown as ProfileRow[] | null,
      );

      // T4.5: paused users are skipped; occurrences stay pending (no
      // attempt increment, no failed/sent update).
      if (profile?.paused) {
        skipped += 1;
        continue;
      }

      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(
        reminder.user_id,
      );
      const email = userData?.user?.email ?? null;
      if (userError || !email) {
        skipped += 1;
        continue;
      }

      const timezone = profile?.timezone || "UTC";
      const parsedDeadline = reminder.deadline
        ? DateTime.fromISO(reminder.deadline, { zone: "utc" })
        : null;
      const deadline =
        parsedDeadline && parsedDeadline.isValid ? parsedDeadline : null;
      const offsetMinutes = deriveOffsetMinutes(deadline, occ.send_at);

      const content = buildEmailContent({
        title: reminder.title,
        deadline,
        offsetMinutes,
        timezone,
      });

      // T4.4 claim + T4.6 retry bookkeeping: increment attempt_count and
      // stamp last_attempted_at before attempting the send, so a crashed
      // run still records the attempt and a concurrent run sees it.
      const attemptCount = (occ.attempt_count ?? 0) + 1;
      const attemptedAt = new Date().toISOString();
      await supabase
        .from("reminder_occurrences")
        .update({
          attempt_count: attemptCount,
          last_attempted_at: attemptedAt,
        })
        .eq("id", occ.id);

      try {
        await sendEmail({
          to: email,
          subject: content.subject,
          text: content.text,
        });
        await supabase
          .from("reminder_occurrences")
          .update({
            status: "sent",
            attempt_count: attemptCount,
            last_attempted_at: attemptedAt,
            sent_at: attemptedAt,
          })
          .eq("id", occ.id);
        sent += 1;
      } catch {
        if (attemptCount >= maxAttempts) {
          await supabase
            .from("reminder_occurrences")
            .update({
              status: "failed",
              attempt_count: attemptCount,
              last_attempted_at: attemptedAt,
            })
            .eq("id", occ.id);
          failed += 1;
        } else {
          pendingRetry += 1;
        }
      }
    } catch {
      skipped += 1;
    }
  }

  return Response.json({ ok: true, sent, failed, pendingRetry, skipped });
}
