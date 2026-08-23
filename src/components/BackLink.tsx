"use client";

import Link from "next/link";
import type { ReactNode } from "react";

// One consistent, good-looking "back" control: a small pill button with an
// arrow that nudges left on hover. Replaces the faint grey text links that
// were scattered (and inconsistent, and sometimes missing) across pages.
//
// Hover reads as the Лимӯ accent specifically (--accent-yellow), not
// --brand -- for the lemon theme --brand is deliberately graphite, not
// yellow (white text on #facc15 fails contrast, see globals.css), so a
// --brand-based hover here never actually looked yellow. The icon circle
// goes solid yellow with a fixed dark ink (not white, same contrast
// reason), while the pill itself stays a soft translucent wash so the
// surrounding text keeps using a normal readable ink colour rather than
// yellow-on-white, which is its own contrast problem the other way.
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex w-fit items-center gap-2 rounded-full border border-[var(--border-c)] bg-[var(--surface-1)] py-1.5 pl-1.5 pr-4 text-sm font-medium text-[var(--ink-3)] shadow-sm transition-all hover:-translate-x-0.5 hover:border-[color-mix(in_srgb,var(--accent-yellow)_55%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent-yellow)_14%,transparent)] hover:text-[var(--ink-1)] hover:shadow-md active:scale-95"
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--hover-c2)] text-[var(--ink-4)] transition-colors group-hover:bg-[var(--accent-yellow)] group-hover:text-[#18181b]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-3.5 w-3.5"><path d="M15 5l-7 7 7 7" /></svg>
      </span>
      {children}
    </Link>
  );
}
