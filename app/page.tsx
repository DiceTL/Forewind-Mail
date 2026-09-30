import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions/auth";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Forewind Mail</h1>
      <p className="text-muted-foreground">Email reminders ahead of your deadlines.</p>
      {user?.email ? (
        <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
      ) : null}
      <Button>Get started</Button>
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
