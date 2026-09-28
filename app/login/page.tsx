"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

// Short-lived cookie the OAuth callback reads to seed profiles.timezone.
// Matches the name expected by app/api/auth/callback/route.ts.
const TIMEZONE_COOKIE = "forewind-timezone";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSignIn() {
    setError(null);
    setPending(true);
    try {
      const detected =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      document.cookie = `${TIMEZONE_COOKIE}=${encodeURIComponent(detected)}; path=/; max-age=300; SameSite=Lax`;

      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback`,
        },
      });
      if (oauthError) {
        setError(oauthError.message);
        setPending(false);
      }
      // On success Supabase redirects the browser to Google; pending stays.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Forewind Mail</h1>
      <p className="text-muted-foreground">
        Email reminders ahead of your deadlines.
      </p>
      <Button onClick={handleSignIn} disabled={pending} size="lg">
        {pending ? "Redirecting…" : "Sign in with Google"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </main>
  );
}
