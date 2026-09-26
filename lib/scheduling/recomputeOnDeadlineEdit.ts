import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { computeSendTime } from "@/lib/scheduling/computeSendTime";

export type OccurrenceUpdate =
  | { type: "reschedule"; occurrenceId: string; sendAt: DateTime }
  | { type: "cancel"; occurrenceId: string };

type OffsetRow = {
  id: string;
  reminder_id: string;
  offset_minutes: number;
};

type OccurrenceRow = {
  id: string;
  reminder_id: string;
  send_at: string;
  status: string;
};

export async function recomputeOnDeadlineEdit(
  reminderId: string,
  newDeadline: DateTime,
  now: DateTime,
): Promise<OccurrenceUpdate[]> {
  const supabase = await createClient();

  const { data: offsets, error: offsetsError } = await supabase
    .from("reminder_offsets")
    .select("id, reminder_id, offset_minutes")
    .eq("reminder_id", reminderId);
  if (offsetsError) throw offsetsError;

  const { data: occurrences, error: occurrencesError } = await supabase
    .from("reminder_occurrences")
    .select("id, reminder_id, send_at, status")
    .eq("reminder_id", reminderId)
    .eq("status", "pending");
  if (occurrencesError) throw occurrencesError;

  const sortedOffsets = [...((offsets ?? []) as OffsetRow[])].sort(
    (a, b) => a.offset_minutes - b.offset_minutes,
  );
  const sortedPending = [...((occurrences ?? []) as OccurrenceRow[])].sort(
    (a, b) =>
      DateTime.fromISO(b.send_at).toMillis() -
      DateTime.fromISO(a.send_at).toMillis(),
  );

  const updates: OccurrenceUpdate[] = [];
  const count = Math.min(sortedOffsets.length, sortedPending.length);

  for (let i = 0; i < count; i++) {
    const offset = sortedOffsets[i];
    const occurrence = sortedPending[i];
    const newSend = computeSendTime(newDeadline, offset.offset_minutes);

    if (newSend > now) {
      const { error } = await supabase
        .from("reminder_occurrences")
        .update({ send_at: newSend.toUTC().toISO() as string })
        .eq("id", occurrence.id);
      if (error) throw error;
      updates.push({
        type: "reschedule",
        occurrenceId: occurrence.id,
        sendAt: newSend,
      });
    } else {
      const { error } = await supabase
        .from("reminder_occurrences")
        .update({ status: "cancelled" })
        .eq("id", occurrence.id);
      if (error) throw error;
      updates.push({ type: "cancel", occurrenceId: occurrence.id });
    }
  }

  return updates;
}
