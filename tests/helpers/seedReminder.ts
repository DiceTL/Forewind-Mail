import { createE2EAdminClient } from "./e2eAuth";

export type SeededReminder = {
  id: string;
  title: string;
  status: string;
  user_id: string;
};

/**
 * Insert a reminders row as service role (bypasses RLS).
 * Lives under tests/ only — must not use lib/supabase/admin.ts (T2.6 allowlist).
 */
export async function seedReminderForUser(
  userId: string,
  options?: { title?: string },
): Promise<SeededReminder> {
  const title = options?.title ?? `isolation-${Date.now()}`;
  const admin = createE2EAdminClient();

  const { data, error } = await admin
    .from("reminders")
    .insert({
      user_id: userId,
      title,
      status: "active",
      repeat_enabled: false,
    })
    .select("id, title, status, user_id")
    .single();

  if (error || !data) {
    throw new Error(
      `seedReminderForUser: insert failed: ${error?.message ?? "no row returned"}`,
    );
  }

  return data;
}

export async function deleteReminder(id: string): Promise<void> {
  const admin = createE2EAdminClient();
  const { error } = await admin.from("reminders").delete().eq("id", id);
  if (error) {
    throw new Error(`deleteReminder(${id}): ${error.message}`);
  }
}

/**
 * Read a reminder by id with service role (for post-condition checks after peer writes).
 */
export async function getReminderAsAdmin(
  id: string,
): Promise<SeededReminder | null> {
  const admin = createE2EAdminClient();
  const { data, error } = await admin
    .from("reminders")
    .select("id, title, status, user_id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`getReminderAsAdmin(${id}): ${error.message}`);
  }
  return data;
}
