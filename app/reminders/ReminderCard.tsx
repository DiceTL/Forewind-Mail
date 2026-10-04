"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markDone, reopenReminder } from "@/app/actions/reminders";
import { Button } from "@/components/ui/button";

export type ReminderCardOccurrence = {
  id: string;
  send_at: string;
  status: string;
};

export type ReminderCardReminder = {
  id: string;
  title: string;
  status: string;
};

export default function ReminderCard({
  reminder,
  occurrences,
}: {
  reminder: ReminderCardReminder;
  occurrences: ReminderCardOccurrence[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState(reminder.status);
  const [isPending, startTransition] = useTransition();

  const pending = occurrences
    .filter((o) => o.status === "pending")
    .sort((a, b) => a.send_at.localeCompare(b.send_at));
  const nextSend = pending[0]?.send_at ?? null;
  const active = status === "active";
  const statusLabel = active ? "Active" : "Done";

  function handleMarkDone() {
    startTransition(async () => {
      await markDone(reminder.id);
      setStatus("done");
      router.refresh();
    });
  }

  function handleReopen() {
    startTransition(async () => {
      await reopenReminder(reminder.id);
      setStatus("active");
      router.refresh();
    });
  }

  return (
    <article aria-label={reminder.title} className="rounded-lg border p-4">
      <h2 className="text-lg font-medium">{reminder.title}</h2>
      <p role="status" aria-label={statusLabel}>
        {statusLabel}
      </p>
      {nextSend ? <p>Next send: {nextSend}</p> : <p>No pending emails</p>}
      {occurrences.length > 0 ? (
        <ul>
          {occurrences.map((o) => (
            <li key={o.id}>
              {o.send_at} — {o.status}
            </li>
          ))}
        </ul>
      ) : null}
      {active ? (
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={handleMarkDone}
        >
          Mark done
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={handleReopen}
        >
          Reopen
        </Button>
      )}
    </article>
  );
}
