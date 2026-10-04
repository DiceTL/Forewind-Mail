import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ReminderList from "./ReminderList";

export default async function RemindersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: reminders } = await supabase
    .from("reminders")
    .select("id, title, status")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const rows = (reminders ?? []) as { id: string; title: string; status: string }[];
  const ids = rows.map((r) => r.id);

  const occurrencesByReminder = new Map<string, { id: string; send_at: string; status: string }[]>();
  if (ids.length > 0) {
    const { data: occurrences } = await supabase
      .from("reminder_occurrences")
      .select("id, reminder_id, send_at, status")
      .in("reminder_id", ids)
      .order("send_at", { ascending: true });
    const occRows = (occurrences ?? []) as {
      id: string;
      reminder_id: string;
      send_at: string;
      status: string;
    }[];
    for (const o of occRows) {
      const list = occurrencesByReminder.get(o.reminder_id) ?? [];
      list.push({ id: o.id, send_at: o.send_at, status: o.status });
      occurrencesByReminder.set(o.reminder_id, list);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Reminders</h1>
      <Link href="/reminders/new">New reminder</Link>
      <ReminderList
        items={rows.map((r) => ({
          reminder: r,
          occurrences: occurrencesByReminder.get(r.id) ?? [],
        }))}
      />
    </main>
  );
}
