"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { computeSendTime } from "@/lib/scheduling/computeSendTime";
import { validateOffset } from "@/lib/scheduling/validateOffset";
import { recomputeOnDeadlineEdit } from "@/lib/scheduling/recomputeOnDeadlineEdit";
import { cancelOccurrences } from "@/lib/scheduling/cancelOccurrences";

export type ReminderFormState = {
  error: string | null;
};

function parseDeadlineInput(
  raw: FormDataEntryValue | null,
  zone: string,
): DateTime | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  const parsed = DateTime.fromFormat(raw.trim(), "yyyy-MM-dd'T'HH:mm", {
    zone,
  });
  if (!parsed.isValid) {
    return null;
  }
  return parsed;
}

async function getUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function getUserTimezone(userId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  const tz = (data as { timezone?: string } | null)?.timezone;
  return tz || "UTC";
}

export async function createReminder(
  _prev: ReminderFormState,
  formData: FormData,
): Promise<ReminderFormState> {
  const userId = await getUserId();
  if (!userId) {
    redirect("/login");
  }

  const title = (formData.get("title") as string | null)?.trim() ?? "";
  if (!title) {
    return { error: "Title is required." };
  }

  const offsetRaw = formData.get("offsetMinutes");
  const offsetMinutes = Number.parseInt(
    typeof offsetRaw === "string" ? offsetRaw.trim() : "",
    10,
  );
  if (!Number.isFinite(offsetMinutes)) {
    return { error: "Lead time must be a number of minutes." };
  }

  const timezone = await getUserTimezone(userId);
  const deadline = parseDeadlineInput(formData.get("deadline"), timezone);
  const deadlineRaw = formData.get("deadline");
  if (
    typeof deadlineRaw === "string" &&
    deadlineRaw.trim() !== "" &&
    !deadline
  ) {
    return { error: "Deadline is not a valid date and time." };
  }

  const now = DateTime.utc();
  const validation = validateOffset(offsetMinutes, deadline, now);
  if (!validation.ok) {
    if (validation.reason === "too_small") {
      return { error: "Lead time must be at least 5 minutes." };
    }
    if (validation.reason === "not_multiple_of_five") {
      return { error: "Lead time must be in 5-minute increments." };
    }
    return {
      error: "That lead time is already in the past for this deadline.",
    };
  }

  const repeatEnabled = formData.get("repeatEnabled") === "on";
  const repeatPattern =
    (formData.get("repeatPattern") as string | null)?.trim() || null;
  const repeatRule = repeatEnabled ? (repeatPattern ?? "daily") : null;

  const sendAt =
    deadline !== null
      ? computeSendTime(deadline, offsetMinutes)
      : now.plus({ minutes: offsetMinutes });

  const supabase = await createClient();
  const { data: reminder, error: reminderError } = await supabase
    .from("reminders")
    .insert({
      user_id: userId,
      title,
      deadline: deadline ? (deadline.toUTC().toISO() as string) : null,
      repeat_enabled: repeatEnabled,
      repeat_rule: repeatRule,
      status: "active",
    })
    .select("id")
    .single();
  if (reminderError || !reminder) {
    return { error: reminderError?.message ?? "Could not create reminder." };
  }

  const { error: offsetError } = await supabase
    .from("reminder_offsets")
    .insert({
      reminder_id: (reminder as { id: string }).id,
      offset_minutes: offsetMinutes,
    });
  if (offsetError) {
    return { error: offsetError.message };
  }

  const { error: occurrenceError } = await supabase
    .from("reminder_occurrences")
    .insert({
      reminder_id: (reminder as { id: string }).id,
      send_at: sendAt.toUTC().toISO() as string,
      status: "pending",
    });
  if (occurrenceError) {
    return { error: occurrenceError.message };
  }

  revalidatePath("/reminders");
  redirect("/reminders");
}

export async function updateReminderDeadline(
  reminderId: string,
  _prev: ReminderFormState,
  formData: FormData,
): Promise<ReminderFormState> {
  const userId = await getUserId();
  if (!userId) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("reminders")
    .select("id")
    .eq("id", reminderId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) {
    return { error: "Reminder not found." };
  }

  const timezone = await getUserTimezone(userId);
  const newDeadline = parseDeadlineInput(formData.get("deadline"), timezone);
  if (!newDeadline) {
    return { error: "Deadline is required." };
  }
  const now = DateTime.utc();

  const { error: updateError } = await supabase
    .from("reminders")
    .update({ deadline: newDeadline.toUTC().toISO() as string })
    .eq("id", reminderId);
  if (updateError) {
    return { error: updateError.message };
  }

  await recomputeOnDeadlineEdit(reminderId, newDeadline, now);

  revalidatePath("/reminders");
  redirect("/reminders");
}

export async function markDone(reminderId: string): Promise<void> {
  const userId = await getUserId();
  if (!userId) {
    redirect("/login");
  }
  const supabase = await createClient();
  await supabase
    .from("reminders")
    .update({ status: "done" })
    .eq("id", reminderId)
    .eq("user_id", userId);
  await cancelOccurrences(reminderId);
  revalidatePath("/reminders");
}

export async function reopenReminder(reminderId: string): Promise<void> {
  const userId = await getUserId();
  if (!userId) {
    redirect("/login");
  }
  const supabase = await createClient();
  // Per WORKFLOW open assumption: reopen does not recompute —
  // cancelled stays cancelled.
  await supabase
    .from("reminders")
    .update({ status: "active" })
    .eq("id", reminderId)
    .eq("user_id", userId);
  revalidatePath("/reminders");
}
