import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";

async function getSignedIn(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return false;
  }
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return !!user;
  } catch {
    return false;
  }
}

export default async function LandingPage() {
  if (await getSignedIn()) {
    redirect("/reminders");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <img
        src="/assets/wordmark.svg"
        alt="Forewind Mail wordmark"
        width={320}
        height={64}
      />
      <h1 className="text-3xl font-semibold tracking-tight">Forewind Mail</h1>
      <p className="max-w-md text-muted-foreground">
        Lightweight email reminders ahead of your deadlines. Set a title, pick
        a deadline, and get an email reminder before it is due.
      </p>
      <Button asChild size="lg">
        <Link href="/login">Sign in</Link>
      </Button>
    </main>
  );
}
