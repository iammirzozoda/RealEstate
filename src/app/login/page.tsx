"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/isConfigured";
import { SetupNotice } from "@/components/SetupNotice";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { LoginScene } from "@/components/LoginScene";
import { LoginAside } from "@/components/LoginAside";
import { quoteOfTheDay } from "@/lib/quotes";
import { applyHeroTheme } from "@/components/HeroThemeSwitcher";

const FIELD_CLASS =
  "h-11 w-full rounded-lg border border-slate-300 px-3.5 text-sm transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10";

export default function LoginPage() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  // A build-time env check, constant for the whole session. Without the keys
  // the browser Supabase client throws the instant it is constructed, so this
  // screen used to render React's blank "This page couldn't load" -- with no
  // hint that the deployment is simply missing its environment variables,
  // which is exactly the state a freshly created project is in.
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetting, setResetting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Company branding for the header. The login page runs before auth, and
  // full settings are staff-only -- public_branding() (026) exposes exactly
  // the name and logo, nothing else. Falls back to the app name until the
  // RPC answers (or if the migration isn't applied yet).
  // One pick per render, shared by the desktop panel and the phone copy.
  const dailyQuote = quoteOfTheDay();
  const [brand, setBrand] = useState<{ name: string | null; logo: string | null }>({
    name: null,
    logo: null,
  });

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    supabase
      .schema("crm")
      .rpc("public_branding")
      .then(({ data }) => {
        const row = Array.isArray(data) ? data[0] : data;
        if (row) {
          setBrand({
            name: row.company_name ?? null,
            logo: row.company_logo_url ?? null,
          });
          // Paint the login page in the company's chosen theme too (the
          // AppShell that normally applies it isn't mounted here).
          applyHeroTheme(row.hero_theme ?? null, row.hero_pattern ?? null);
        }
      });
  }, [configured]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured) return;
    setSubmitting(true);
    setError("");
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setSubmitting(false);
    if (signInError) {
      setError(t.login.error);
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <div className="relative flex min-h-screen flex-col lg:flex-row">
      <LoginScene />

      {/* Left column -- the living half: clock, real local weather, quote of
          the day. The logo, company name and "sign in" caption used to be
          repeated here as well as in the form, so on a desktop screen the
          same two lines were printed twice, side by side. Identity now lives
          in exactly one place: the form header, on every screen size. */}
      <div className="relative z-10 hidden flex-1 flex-col justify-between p-14 text-white lg:flex">
        <div />
        <LoginAside />
        <p className="text-xs tracking-wide text-white/60">
          developed by{" "}
          <a
            href="https://www.instagram.com/iammirzozoda"
            target="_blank"
            rel="noopener noreferrer"
            className="-mx-1.5 rounded px-1.5 font-semibold text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          >
            IMRON
          </a>
        </p>
      </div>

      {/* Form side. */}
      <div className="relative z-10 flex w-full flex-col items-center justify-center p-4 lg:w-[480px] lg:shrink-0 lg:p-10">
      <form
        onSubmit={handleSubmit}
        className="relative flex w-full max-w-sm flex-col gap-4 overflow-hidden rounded-2xl border border-white/40 bg-white/90 p-7 shadow-2xl shadow-slate-900/30 backdrop-blur-md"
      >
        <div className="card-accent-bar absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-[var(--brand-strong)] via-[var(--brand)] to-[var(--hero-3)]" />
        {/* Language first: the person picking РУ/ТҶ hasn't logged in yet,
            so the login page itself must offer the choice. */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {brand.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logo}
                alt=""
                className="h-12 w-12 rounded-xl border border-slate-200 bg-white object-contain p-1 shadow-sm"
              />
            )}
            <div>
              <h1 className="bg-gradient-to-r from-[var(--brand-strong)] to-[var(--brand)] bg-clip-text text-xl font-bold tracking-tight text-transparent">
                {brand.name || t.appName}
              </h1>
              <p className="text-sm text-slate-500">{t.login.title}</p>
            </div>
          </div>
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-200">
            {(["ru", "tj"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                className={`px-2.5 py-1 text-xs font-semibold uppercase transition-colors ${
                  locale === l
                    ? "bg-brand text-white"
                    : "bg-white text-slate-500 hover:text-slate-800"
                }`}
              >
                {l === "ru" ? "Ру" : "Тҷ"}
              </button>
            ))}
          </div>
        </div>
        {/* A deployment whose environment variables were never set: say so
            here, where the person is already looking, instead of letting the
            Supabase client throw and replace the whole screen with a blank
            error. Signing in is impossible either way, but this way the
            reason is on screen. */}
        {!configured && <SetupNotice />}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.login.email}</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.login.password}</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-emerald-600">{notice}</p>}
        <button
          type="submit"
          disabled={submitting || !configured}
          className="btn-brand mt-1 h-11 rounded-lg text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
        >
          {submitting ? t.common.loading : t.login.submit}
        </button>
        <button
          type="button"
          disabled={resetting || !configured}
          onClick={async () => {
            setError("");
            setNotice("");
            if (!configured) return;
            if (!email.trim()) {
              setError(t.login.resetEnterEmail);
              return;
            }
            setResetting(true);
            const supabase = createClient();
            // Sends only to addresses that exist in Supabase Auth; the
            // wording never confirms whether an account exists, so the
            // form can't be used to probe for staff e-mails.
            await supabase.auth.resetPasswordForEmail(email.trim(), {
              redirectTo: `${window.location.origin}/reset-password`,
            });
            setResetting(false);
            setNotice(t.login.resetSent);
          }}
          className="-mx-1.5 self-center rounded px-1.5 py-0.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
        >
          {t.login.forgot}
        </button>
      </form>

      {/* The brand panel is desktop-only, so phones would lose the quote
          entirely. A compact copy, no clock or weather -- on a small screen
          those compete with the form instead of framing it. */}
      <figure className="mt-6 max-w-sm border-l-2 border-white/30 pl-3 lg:hidden">
        <blockquote className="text-[13px] italic leading-relaxed text-white/85">
          “{dailyQuote[locale === "tj" ? "tj" : "ru"]}”
        </blockquote>
        <figcaption className="mt-1 text-[11px] text-white/55">
          — {dailyQuote.author[locale === "tj" ? "tj" : "ru"]}
        </figcaption>
      </figure>

      {/* Credit -- shown under the form on phones (the desktop copy lives in
          the brand panel). */}
      <p className="mt-6 text-xs tracking-wide text-white/70 lg:hidden">
        developed by{" "}
        <a
          href="https://www.instagram.com/iammirzozoda"
          target="_blank"
          rel="noopener noreferrer"
          className="-mx-1.5 rounded px-1.5 font-semibold text-white/90 transition-colors hover:bg-white/15"
        >
          IMRON
        </a>
      </p>
      </div>
    </div>
  );
}
