"use client";

import { useActionState } from "react";
import {
  updateReminderDeadline,
  type ReminderFormState,
} from "@/app/actions/reminders";
import { Button } from "@/components/ui/button";

const initialState: ReminderFormState = { error: null };

export default function EditForm({
  reminderId,
  initialDeadline,
}: {
  reminderId: string;
  initialDeadline: string;
}) {
  const bound = updateReminderDeadline.bind(null, reminderId);
  const [state, formAction, pending] = useActionState(bound, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="deadline">Deadline</label>
        <input
          id="deadline"
          name="deadline"
          type="datetime-local"
          defaultValue={initialDeadline}
          required
          className="rounded-md border border-input bg-background px-3 py-2"
        />
      </div>
      {state.error ? <p role="alert">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        Save reminder
      </Button>
    </form>
  );
}
