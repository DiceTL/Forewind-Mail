import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import EditForm from "./EditForm";

export default async function EditReminderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: reminder } = await supabase
    .from("reminders")
    .select("id, deadline")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!reminder) {
    redirect("/reminders");
  }

  const row = reminder as { id: string; deadline: string | null };
  let initialDeadline = "";
  if (row.deadline) {
    const dt = DateTime.fromISO(row.deadline, { zone: "utc" });
    if (dt.isValid) {
      initialDeadline = dt.toFormat("yyyy-MM-dd'T'HH:mm");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Edit reminder</h1>
      <EditForm reminderId={row.id} initialDeadline={initialDeadline} />
    </main>
  );
}
