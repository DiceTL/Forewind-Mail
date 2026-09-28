import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const TIMEZONE_COOKIE = "forewind-timezone";

// Accept only real IANA zones; anything missing or invalid becomes UTC.
function resolveTimezone(raw: string | undefined): string {
  if (!raw) {
    return "UTC";
  }
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return "UTC";
  }
  if (!decoded) {
    return "UTC";
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: decoded });
    return decoded;
  } catch {
    return "UTC";
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.redirect(`${origin}/login?error=misconfigured`);
  }

  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=no_session`);
  }

  // First-login profile seed. ignoreDuplicates keeps a returning user's
  // stored timezone (editable in settings) instead of overwriting it.
  const timezone = resolveTimezone(request.cookies.get(TIMEZONE_COOKIE)?.value);
  const { error: profileError } = await supabase.from("profiles").upsert(
    { user_id: user.id, timezone },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (profileError) {
    return NextResponse.redirect(`${origin}/login?error=profile_failed`);
  }

  return response;
}
