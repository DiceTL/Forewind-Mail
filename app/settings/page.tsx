import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DeleteAccount, PauseSwitch, TimezoneSelector } from "./SettingsControls";

const FALLBACK_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
];

// Computed once on the server and passed as a prop so SSR and hydration
// render the identical option list. Calling supportedValuesOf on both
// sides risks a mismatch (server ICU vs browser ICU) and a hydration
// error on the first <option>.
function getTimezones(): string[] {
  try {
    const values = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (values && values.length > 0) {
      return values;
    }
  } catch {
    // fall through to fixed list
  }
  return FALLBACK_TIMEZONES;
}

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
      <TimezoneSelector initial={row.timezone || "UTC"} zones={getTimezones()} />
      <PauseSwitch initial={row.paused ?? false} />
      <DeleteAccount />
    </main>
  );
}
