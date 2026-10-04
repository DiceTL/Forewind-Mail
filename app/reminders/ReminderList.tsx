import ReminderCard, {
  type ReminderCardOccurrence,
  type ReminderCardReminder,
} from "./ReminderCard";

export default function ReminderList({
  items,
}: {
  items: {
    reminder: ReminderCardReminder;
    occurrences: ReminderCardOccurrence[];
  }[];
}) {
  if (items.length === 0) {
    return <p>No reminders yet. Create your first reminder.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => (
        <ReminderCard
          key={item.reminder.id}
          reminder={item.reminder}
          occurrences={item.occurrences}
        />
      ))}
    </div>
  );
}
