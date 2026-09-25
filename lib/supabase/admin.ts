import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// SERVER ONLY — bypasses row-level security via the service-role key.
//
// Per T2.6, this module may be imported ONLY by:
//   - app/api/cron/send-due/route.ts (T4.4: send due emails across all users)
//   - app/api/account/delete/route.ts (T6.5: delete the auth.users row)
// No other file under app/ or lib/ may import it. The T8.3 security audit
// greps for violations.
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient must only be called on the server.");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
