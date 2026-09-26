import { createClient } from "@/lib/supabase/server";

export async function cancelOccurrences(reminderId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("reminder_occurrences").update({ status: "cancelled" }).eq("reminder_id", reminderId).eq("status", "pending");
  if (error) throw error;
}
