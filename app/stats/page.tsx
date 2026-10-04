import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import StatsGrid from "./StatsGrid";

function onTimeRate(
  occurrences: { status: string; send_at: string; sent_at: string | null }[],
): string {
  const sent = occurrences.filter((o) => o.status === "sent");
  if (sent.length === 0) {
    return "0%";
  }
  let onTime = 0;
  for (const o of sent) {
    if (!o.sent_at) {
      continue;
    }
    const sendAt = DateTime.fromISO(o.send_at);
    const sentAt = DateTime.fromISO(o.sent_at);
    if (!sendAt.isValid || !sentAt.isValid) {
      continue;
    }
    if (sentAt.diff(sendAt).as("minutes") < 2) {
      onTime += 1;
    }
  }
  const pct = Math.round((onTime / sent.length) * 100);
  return `${pct}%`;
}

function mostUsedLeadTime(offsets: { offset_minutes: number }[]): string {
  if (offsets.length === 0) {
    return "—";
  }
  const counts = new Map<number, number>();
  for (const o of offsets) {
    counts.set(o.offset_minutes, (counts.get(o.offset_minutes) ?? 0) + 1);
  }
  let mode = offsets[0]!.offset_minutes;
  let best = -1;
  for (const [value, count] of counts) {
    if (count > best) {
      best = count;
      mode = value;
    }
  }
  return `${mode} min`;
}

function perWeek(createdAts: string[]): { week: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const iso of createdAts) {
    const dt = DateTime.fromISO(iso, { zone: "utc" });
    if (!dt.isValid) {
      continue;
    }
    const weekStart = dt.startOf("week").toISODate() ?? iso.slice(0, 10);
    counts.set(weekStart, (counts.get(weekStart) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, count]) => ({ week, count }));
}

export default async function StatsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: reminders } = await supabase
    .from("reminders")
    .select("id, status, created_at")
    .eq("user_id", user.id);
  const reminderRows = (reminders ?? []) as {
    id: string;
    status: string;
    created_at: string;
  }[];

  if (reminderRows.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Stats</h1>
        <p role="status" aria-label="No reminders yet">
          No reminders yet
        </p>
      </main>
    );
  }

  const ids = reminderRows.map((r) => r.id);
  const { data: offsets } = await supabase
    .from("reminder_offsets")
    .select("offset_minutes")
    .in("reminder_id", ids);
  const { data: occurrences } = await supabase
    .from("reminder_occurrences")
    .select("status, send_at, sent_at")
    .in("reminder_id", ids);

  const offsetRows = (offsets ?? []) as { offset_minutes: number }[];
  const occurrenceRows = (occurrences ?? []) as {
    status: string;
    send_at: string;
    sent_at: string | null;
  }[];

  const total = reminderRows.length;
  const active = reminderRows.filter((r) => r.status === "active").length;
  const done = reminderRows.filter((r) => r.status === "done").length;
  const sent = occurrenceRows.filter((o) => o.status === "sent").length;
  const failed = occurrenceRows.filter((o) => o.status === "failed").length;
  const pending = occurrenceRows.filter((o) => o.status === "pending").length;

  const weekly = perWeek(reminderRows.map((r) => r.created_at));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Stats</h1>
      <StatsGrid
        items={[
          { title: "Total reminders", value: String(total) },
          { title: "Active reminders", value: String(active) },
          { title: "Done reminders", value: String(done) },
          { title: "Emails sent", value: String(sent) },
          { title: "Emails failed", value: String(failed) },
          { title: "Emails pending", value: String(pending) },
          { title: "On-time delivery rate", value: onTimeRate(occurrenceRows) },
          { title: "Most-used lead time", value: mostUsedLeadTime(offsetRows) },
        ]}
      />
      <section
        role="region"
        aria-label="Reminders created per week"
        className="rounded-lg border p-4"
      >
        <h2 className="text-lg font-medium">Reminders created per week</h2>
        <ul>
          {weekly.map((w) => (
            <li key={w.week}>
              Week of {w.week}: {w.count}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
