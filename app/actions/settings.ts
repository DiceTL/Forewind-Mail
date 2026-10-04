"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function isValidTimezone(zone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export async function updateTimezone(timezone: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  if (!isValidTimezone(timezone)) {
    throw new Error("Invalid time zone.");
  }
  const { error } = await supabase
    .from("profiles")
    .update({ timezone })
    .eq("user_id", user.id);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/settings");
}

export async function setPaused(paused: boolean): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  const { error } = await supabase
    .from("profiles")
    .update({ paused })
    .eq("user_id", user.id);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/settings");
}
