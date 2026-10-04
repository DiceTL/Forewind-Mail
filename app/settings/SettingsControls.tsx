"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setPaused, updateTimezone } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";

function timezones(): string[] {
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
  return [
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
}

export function TimezoneSelector({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const zones = timezones();
  const options = zones.includes(initial)
    ? zones
    : [initial, ...zones];

  async function handleChange(next: string) {
    setValue(next);
    await updateTimezone(next);
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="timezone">Time zone</label>
      <select
        id="timezone"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className="rounded-md border border-input bg-background px-3 py-2"
      >
        {options.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PauseSwitch({ initial }: { initial: boolean }) {
  const [paused, setPausedState] = useState(initial);

  async function handleClick() {
    const next = !paused;
    setPausedState(next);
    try {
      await setPaused(next);
    } catch {
      setPausedState(paused);
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={paused ? "true" : "false"}
      aria-label="Pause emails"
      onClick={handleClick}
      className="rounded-md border border-input px-4 py-2"
    >
      {paused ? "Emails paused" : "Emails active"}
    </button>
  );
}

export function DeleteAccount() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Delete failed.");
      }
      router.push("/login");
      router.refresh();
      window.location.href = "/login";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="destructive"
        onClick={() => setConfirming(true)}
      >
        Delete account
      </Button>
      {confirming ? (
        <>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={handleConfirm}
          >
            Confirm delete
          </Button>
          {error ? <p role="alert">{error}</p> : null}
        </>
      ) : null}
    </div>
  );
}
