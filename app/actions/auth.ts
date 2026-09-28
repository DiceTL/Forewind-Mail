"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Clears the Supabase auth session cookies, then lands on /login.
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
