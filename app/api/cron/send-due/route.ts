import { DateTime } from "luxon";
import { buildEmailContent } from "@/lib/mailer/buildEmailContent";
import { sendEmail } from "@/lib/mailer/sendEmail";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MAX_SEND_ATTEMPTS = 3;

// Small enough that one per-minute run finishes inside serverless limits
// (PRD/Vercel risk); unclaimed rows simply wait for the next minute.
const CLAIM_BATCH_LIMIT = 100;

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

type ClaimedOccurrence = {
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

  // Option B pickup: ONE rpc call locks due rows (SKIP LOCKED),
  // increments attempt_count, stamps last_attempted_at, and returns only
  // rows this run won. A concurrent run receives a disjoint set, so the
  // same reminder can never be sent twice. No table-level due-select here:
  // the frozen test mock returns empty for it on purpose, so bypassing
  // rpc cannot pass.
  //
  // NOTE on typing: Database["public"]["Functions"] is empty (types were
  // generated before this function existed and regen needs DB access), so
  // rpc is asserted to the documented signature of claim_due_occurrences
  // (see supabase/migrations/20260926000005_claim_due_occurrences.sql).
  // The method MUST stay bound to the client (.bind): extracting it bare
  // loses its `this` context and crashes in production with
  // "Cannot read properties of undefined (reading 'rest')".
  const claimRpc = supabase.rpc.bind(supabase) as unknown as (
    fn: "claim_due_occurrences",
    args: { p_now: string; p_limit: number },
  ) => Promise<{
    data: ClaimedOccurrence[] | null;
    error: { message: string } | null;
  }>;
  const { data: claimedRows, error: claimError } = await claimRpc(
    "claim_due_occurrences",
    { p_now: nowIso, p_limit: CLAIM_BATCH_LIMIT },
  );

  if (claimError) {
    return Response.json({ error: "Failed to claim due occurrences." }, { status: 500 });
  }

  const due = (claimedRows ?? []) as ClaimedOccurrence[];
  let sent = 0;
  let failed = 0;
  let pendingRetry = 0;
  let skipped = 0;

  for (const occ of due) {
    try {
      // attempt_count / last_attempted_at were already recorded by the
      // claim — never increment here, or one delivery would burn two
      // attempts.
      const attemptCount = occ.attempt_count ?? 0;

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

      // T4.5 defense in depth: the claim already excludes paused users,
      // but if one slips through (e.g. paused mid-run) skip without
      // failing — the row stays pending for after unpause.
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

      const sentAt = new Date().toISOString();
      try {
        await sendEmail({
          to: email,
          subject: content.subject,
          text: content.text,
        });
        await supabase
          .from("reminder_occurrences")
          .update({ status: "sent", sent_at: sentAt })
          .eq("id", occ.id);
        sent += 1;
      } catch {
        if (attemptCount >= maxAttempts) {
          await supabase
            .from("reminder_occurrences")
            .update({ status: "failed" })
            .eq("id", occ.id);
          failed += 1;
        } else {
          // Stays pending with the claim's attempt recorded; next run
          // re-claims (SKIP LOCKED no longer excludes it once unlocked).
          pendingRetry += 1;
        }
      }
    } catch {
      skipped += 1;
    }
  }

  return Response.json({ ok: true, sent, failed, pendingRetry, skipped });
}
