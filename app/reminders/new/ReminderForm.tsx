"use client";

import { useActionState } from "react";
import { createReminder, type ReminderFormState } from "@/app/actions/reminders";
import { Button } from "@/components/ui/button";

const initialState: ReminderFormState = { error: null };

// Pre-fill so the native date/time control never shows its empty
// placeholders (mm/dd/yyyy, --:--). E2E fills overwrite this value.
function defaultDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ReminderForm() {
  const [state, formAction, pending] = useActionState(
    createReminder,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          name="title"
          type="text"
          required
          className="rounded-md border border-input bg-background px-3 py-2"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="deadline">Deadline</label>
        <input
          id="deadline"
          name="deadline"
          type="datetime-local"
          defaultValue={defaultDeadline()}
          className="rounded-md border border-input bg-background px-3 py-2"
        />
        <p className="text-sm text-muted-foreground">
          Pre-filled with tomorrow at 9:00 AM — clear it for a general
          reminder with no fixed date.
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="offset">Lead time (minutes)</label>
        <input
          id="offset"
          name="offsetMinutes"
          type="number"
          min={5}
          step={5}
          defaultValue={60}
          required
          className="rounded-md border border-input bg-background px-3 py-2"
        />
      </div>
      <div className="flex items-center gap-2">
        <input id="repeat" name="repeatEnabled" type="checkbox" value="on" />
        <label htmlFor="repeat">Repeat</label>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="repeat-pattern">Repeat pattern</label>
        <select
          id="repeat-pattern"
          name="repeatPattern"
          defaultValue="daily"
          className="rounded-md border border-input bg-background px-3 py-2"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly on chosen days</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      {state.error ? <p role="alert">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        Create reminder
      </Button>
    </form>
  );
}
