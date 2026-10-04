import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  DeleteAccount,
  PauseSwitch,
  TimezoneSelector,
} from "./SettingsControls";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, paused")
    .eq("user_id", user.id)
    .maybeSingle();
  const row = (profile ?? { timezone: "UTC", paused: false }) as {
    timezone: string;
    paused: boolean;
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <TimezoneSelector initial={row.timezone || "UTC"} />
      <PauseSwitch initial={row.paused ?? false} />
      <DeleteAccount />
    </main>
  );
}
