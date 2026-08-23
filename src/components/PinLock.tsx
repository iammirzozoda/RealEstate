"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";

const PIN_KEY = "appPinHash";
// Lock the screen after this much inactivity. The app is often left open on a
// shared front desk, so it re-locks on its own.
const LOCK_AFTER_MS = 3 * 60_000;
const PIN_LEN = 4;

async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`realestate-pin:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// A device-local PIN screen-lock layered on top of the login session. On first
// open the user sets a 4-digit PIN; after that the app locks on every open and
// after a few minutes of inactivity, and the PIN is required to get back in.
// Input works three ways: an on-screen keypad (mouse), the physical keyboard
// (PC), and the phone's own numeric keyboard (a focused numeric input pops it
// up automatically). This is a privacy shade for a shared desk, not a
// replacement for the login -- the Supabase session still gates the real data.
export function PinLock() {
  const { t } = useLocale();
  const [ready, setReady] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [locked, setLocked] = useState(false);
  // Setup collects the PIN twice; unlock just once.
  const [firstEntry, setFirstEntry] = useState<string | null>(null);
  const [entry, setEntry] = useState("");
  const [error, setError] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(PIN_KEY);
    setHasPin(!!stored);
    if (stored) setLocked(true); // lock on open
    setReady(true);
  }, []);

  // Inactivity auto-lock: only while a PIN exists and we're currently unlocked.
  // The listener does nothing but stamp a number -- tearing down and rebuilding
  // a timer on every single mousemove and scroll frame (which is what this did
  // before) is main-thread work the user pays for as sluggishness. A once-a-
  // second check is more than precise enough for a three-minute lock.
  useEffect(() => {
    if (!hasPin || locked) return;
    let lastActivity = Date.now();
    const mark = () => {
      lastActivity = Date.now();
    };
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    timer.current = window.setInterval(() => {
      if (Date.now() - lastActivity >= LOCK_AFTER_MS) setLocked(true);
    }, 1000);
    return () => {
      window.clearInterval(timer.current);
      events.forEach((e) => window.removeEventListener(e, mark));
    };
  }, [hasPin, locked]);

  const showing = ready && (!hasPin || locked);

  // Focus the hidden numeric field whenever the lock screen appears, so the
  // phone's keyboard opens by itself and PC typing lands somewhere.
  useEffect(() => {
    if (showing) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(id);
    }
  }, [showing, firstEntry]);

  const complete = useCallback(
    async (pin: string) => {
      // Setup flow: capture, then confirm.
      if (!hasPin) {
        if (firstEntry === null) {
          setFirstEntry(pin);
          setEntry("");
          return;
        }
        if (firstEntry !== pin) {
          setError(t.pin.mismatch);
          setFirstEntry(null);
          setEntry("");
          return;
        }
        window.localStorage.setItem(PIN_KEY, await hashPin(pin));
        setHasPin(true);
        setLocked(false);
        setFirstEntry(null);
        setEntry("");
        return;
      }
      // Unlock flow.
      const stored = window.localStorage.getItem(PIN_KEY);
      if ((await hashPin(pin)) === stored) {
        setLocked(false);
        setEntry("");
      } else {
        setError(t.pin.wrong);
        setEntry("");
      }
    },
    [hasPin, firstEntry, t]
  );

  // Single entry point used by the keypad, the physical keyboard and the phone
  // keyboard alike.
  const setDigits = useCallback(
    (nextRaw: string) => {
      const next = nextRaw.replace(/\D/g, "").slice(0, PIN_LEN);
      setError("");
      setEntry(next);
      if (next.length === PIN_LEN) void complete(next);
    },
    [complete]
  );

  // Typing on a physical keyboard used to work ONLY while the invisible input
  // still had focus -- and it lost focus the moment anything else on the
  // screen was clicked, including the on-screen keypad. So after one tap of a
  // digit button (or a stray click on the background) the keyboard went dead
  // with no visible reason. Listening on the window instead means the keys are
  // picked up no matter what happens to be focused.
  useEffect(() => {
    if (!showing) return;
    const onKey = (e: KeyboardEvent) => {
      // Let the hidden field handle its own typing -- it is what opens the
      // phone keyboard -- otherwise one keypress would count twice.
      if (e.target === inputRef.current) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        setDigits(entry + e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setDigits(entry.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showing, entry, setDigits]);

  if (!ready) return null;
  if (hasPin && !locked) return null;

  const inSetup = !hasPin;
  const title = inSetup
    ? firstEntry === null
      ? t.pin.setNew
      : t.pin.repeatNew
    : t.pin.locked;

  const keypad = (d: string) => setDigits(entry + d);

  return (
    <div className="hero-gradient hero-panel fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 p-6 text-white">
      <div className="flex flex-col items-center gap-2">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-7 w-7"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
        </span>
        <p className="text-lg font-semibold">{title}</p>
        {inSetup && <p className="text-xs text-white/70">{t.pin.setupHint}</p>}
      </div>

      {/* Dots + an overlaid numeric input. The input is what opens the phone
          keyboard and receives physical-keyboard typing; tapping the dots
          focuses it. It's transparent, so only the dots show. */}
      <label className="relative flex gap-3" aria-label={title}>
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={entry}
          onChange={(e) => setDigits(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-default opacity-0"
        />
        {Array.from({ length: PIN_LEN }).map((_, i) => (
          <span
            key={i}
            className={`h-3.5 w-3.5 rounded-full border border-white/50 transition-colors ${
              i < entry.length ? "bg-white" : "bg-transparent"
            }`}
          />
        ))}
      </label>

      <p className="h-4 text-sm text-amber-200">{error}</p>

      {/* On-screen keypad for mouse / touch. preventDefault on mousedown keeps
          focus on the hidden field, so tapping a digit does not dismiss the
          phone keyboard. */}
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => keypad(d)}
            className="h-16 w-16 rounded-full bg-white/10 text-2xl font-semibold backdrop-blur-sm transition-all hover:bg-white/20 active:scale-95"
          >
            {d}
          </button>
        ))}
        <span />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => keypad("0")}
          className="h-16 w-16 rounded-full bg-white/10 text-2xl font-semibold backdrop-blur-sm transition-all hover:bg-white/20 active:scale-95"
        >
          0
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setDigits(entry.slice(0, -1))}
          aria-label="⌫"
          className="flex h-16 w-16 items-center justify-center rounded-full text-2xl text-white/70 transition-colors hover:text-white"
        >
          ⌫
        </button>
      </div>
    </div>
  );
}
