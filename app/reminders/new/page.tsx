import ReminderForm from "./ReminderForm";

export default function NewReminderPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">New reminder</h1>
      <ReminderForm />
    </main>
  );
}
