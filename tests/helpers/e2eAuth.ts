import type { Page } from "@playwright/test";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type E2EEnv = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  userAEmail: string;
  userBEmail: string;
};

/**
 * Fail fast when isolation E2E secrets are missing (no silent skip).
 */
export function requireE2EEnv(): E2EEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userAEmail = process.env.E2E_USER_A_EMAIL;
  const userBEmail = process.env.E2E_USER_B_EMAIL;

  const missing = (
    [
      ["NEXT_PUBLIC_SUPABASE_URL", url],
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey],
      ["SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey],
      ["E2E_USER_A_EMAIL", userAEmail],
      ["E2E_USER_B_EMAIL", userBEmail],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required E2E env vars: ${missing.join(", ")}. ` +
        "Isolation tests need seeded Supabase users and service-role access.",
    );
  }

  return {
    url: url!,
    anonKey: anonKey!,
    serviceRoleKey: serviceRoleKey!,
    userAEmail: userAEmail!,
    userBEmail: userBEmail!,
  };
}

export function createE2EAdminClient(): SupabaseClient<Database> {
  const { url, serviceRoleKey } = requireE2EEnv();
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createE2EAnonClient(): SupabaseClient<Database> {
  const { url, anonKey } = requireE2EEnv();
  return createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Resolve an existing auth user by email (does not create users).
 * Uses Admin generateLink so Google-only test accounts do not need a password.
 */
export async function getUserIdForEmail(email: string): Promise<string> {
  const admin = createE2EAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) {
    throw new Error(`getUserIdForEmail(${email}): ${error.message}`);
  }
  const userId = data.user?.id;
  if (!userId) {
    throw new Error(
      `getUserIdForEmail(${email}): generateLink returned no user — is the account seeded?`,
    );
  }
  return userId;
}

/**
 * Mint a real JWT session without driving the Google OAuth UI.
 */
export async function mintSessionForEmail(email: string): Promise<{
  session: Session;
  userId: string;
}> {
  const admin = createE2EAdminClient();
  const anon = createE2EAnonClient();

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) {
    throw new Error(`mintSessionForEmail(${email}): generateLink failed: ${error.message}`);
  }

  const userId = data.user?.id;
  const hashedToken = data.properties?.hashed_token;
  if (!userId || !hashedToken) {
    throw new Error(
      `mintSessionForEmail(${email}): generateLink missing user id or hashed_token`,
    );
  }

  const { data: otpData, error: otpError } = await anon.auth.verifyOtp({
    type: "email",
    token_hash: hashedToken,
  });
  if (otpError || !otpData.session) {
    throw new Error(
      `mintSessionForEmail(${email}): verifyOtp failed: ${otpError?.message ?? "no session"}`,
    );
  }

  return { session: otpData.session, userId };
}

/**
 * Anon client authenticated as the given session — RLS applies as that user.
 */
export async function createRlsClient(
  session: Session,
): Promise<SupabaseClient<Database>> {
  const client = createE2EAnonClient();
  const { error } = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) {
    throw new Error(`createRlsClient: setSession failed: ${error.message}`);
  }
  return client;
}

/**
 * Inject a session into the browser so middleware / SSR see the user.
 * Isolation assertions prefer createRlsClient; this is for page-level checks.
 */
export async function signInAs(page: Page, email: string): Promise<Session> {
  const { url } = requireE2EEnv();
  const { session } = await mintSessionForEmail(email);
  const projectRef = new URL(url).hostname.split(".")[0];

  // Land on the app origin so cookies attach to localhost.
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.evaluate(
    ({
      supabaseUrl,
      accessToken,
      refreshToken,
    }: {
      supabaseUrl: string;
      accessToken: string;
      refreshToken: string;
    }) => {
      // Persist in the shape @supabase/ssr createBrowserClient reads from storage.
      const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
      const payload = JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      });
      window.localStorage.setItem(storageKey, payload);
      // Also set a cookie for SSR middleware that reads cookies, not localStorage.
      document.cookie = `${storageKey}=${encodeURIComponent(payload)}; path=/; SameSite=Lax`;
    },
    {
      supabaseUrl: url,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    },
  );

  // Ensure cookie is visible to subsequent navigations via Playwright cookie jar too.
  await page.context().addCookies([
    {
      name: `sb-${projectRef}-auth-token`,
      value: encodeURIComponent(
        JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }),
      ),
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  return session;
}
