"use client";

import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";

// One row, everything on the right.
//
// Action rows were previously built ad hoc with `justify-between`: the icon
// segment pinned left, the text buttons pinned right, and a stretch of empty
// space in between. On a wide screen the two halves ended up far enough apart
// to read as unrelated controls, and the eye had to cross the whole card to
// find them. Collecting them into a single right-aligned cluster gives every
// screen the same place to look.
//
// Wraps to the right on narrow screens rather than stacking to the left, so
// the grouping survives on a phone.
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
}

// Toolbars sit in two kinds of place: page headers, where they are the main
// controls and can be full size, and inside cards and table rows, where a
// full-size button would tower over the text beside it. The toolbar declares
// the size once and every icon in it follows, so a row can't come out with
// mismatched buttons.
export type ToolbarSize = "sm" | "md";

const SizeContext = createContext<ToolbarSize>("md");

export const SIZE_CLASSES: Record<ToolbarSize, { button: string; icon: string }> = {
  sm: { button: "h-8 w-8", icon: "[&_svg]:h-[16px] [&_svg]:w-[16px]" },
  md: { button: "h-10 w-10", icon: "[&_svg]:h-[19px] [&_svg]:w-[19px]" },
};

// The bordered container that glues neighbouring controls into ONE control.
// Anything that sits shoulder to shoulder belongs in here -- icon buttons,
// text pills, a date range, a select -- so a row never reads as a scattering
// of separate widgets.
//
// Deliberately NOT `overflow-hidden`: the tooltips below each icon have to be
// able to escape it. Rounding lives on the individual children instead, so
// hover backgrounds still look right at the ends.
//
// `scrollable` opts a group into `overflow-x-auto` instead of `w-fit` -- for
// rows that can genuinely outgrow a phone's width (a building's status +
// room-count + gap pills together routinely runs past 375px) and would
// otherwise just get cut off with no way to reach the rest. Off by default:
// setting overflow-x on an element forces its overflow-y to `auto` too (a
// real CSS rule, not a Tailwind quirk), which WOULD clip an IconAction
// tooltip poking out below it -- so this is only for groups built entirely
// from PillButton/plain content, never one holding an IconAction.
//
// min-w-0 alongside max-w-full/overflow-x-auto is not decorative -- without
// it this does nothing. ControlGroup is always used as a flex item (inside
// a `flex flex-wrap` action row), and a flex item's default min-width is
// `auto`, meaning "never shrink below your own content's width" -- NOT 0.
// max-width:100% only caps growth; it can't force something narrower than
// that floor. With the floor left at `auto`, the group just stayed exactly
// as wide as its pills needed, pushed everything else on the row wider than
// the phone, and the overflow got silently clipped by <main>'s own
// overflow-x-hidden three levels up -- overflow-x-auto never even
// triggered, because the group itself never actually became narrower than
// its content. min-w-0 removes that floor so max-width and overflow-x can
// do what they say.
//
// `wrap` is the version for groups that DO hold an IconAction (a tooltip
// that must stay visible rules out `scrollable`): plain `flex-wrap`, no
// overflow property touched at all, so a long toolbar (search + date range
// + building + sort icons, say) breaks onto a second line inside the same
// bordered box on a narrow phone instead of running off the edge.
export function ControlGroup({
  children,
  size = "md",
  scrollable = false,
  wrap = false,
  className = "",
}: {
  children: ReactNode;
  size?: ToolbarSize;
  scrollable?: boolean;
  wrap?: boolean;
  className?: string;
}) {
  return (
    <SizeContext.Provider value={size}>
      <div
        className={`inline-flex items-center rounded-lg border border-[var(--border-strong-c)] bg-[var(--surface-1)] ${
          scrollable
            ? "min-w-0 max-w-full overflow-x-auto"
            : wrap
              ? "min-w-0 max-w-full flex-wrap"
              : "w-fit"
        } ${size === "sm" ? "gap-0.5 p-0.5" : "gap-1 p-1"} ${className}`}
      >
        {children}
      </div>
    </SizeContext.Provider>
  );
}

// Kept as the name most call sites already use; a toolbar is just a control
// group that happens to hold only icons.
export const IconToolbar = ControlGroup;

// A hairline between two clusters inside one group -- so "filter by date" and
// "sort" can share a single control without blurring into each other.
export function GroupDivider() {
  const size = useContext(SizeContext);
  return (
    <span
      aria-hidden="true"
      className={`mx-0.5 w-px shrink-0 bg-[var(--border-c)] ${size === "sm" ? "h-5" : "h-6"}`}
    />
  );
}

// A text option inside a group (sort order, status filter, period). Same
// height as the icon buttons beside it, so a mixed group sits on one line.
export function PillButton({
  label,
  active = false,
  onClick,
  size,
  title,
}: {
  label: ReactNode;
  active?: boolean;
  onClick: () => void;
  size?: ToolbarSize;
  title?: string;
}) {
  const inherited = useContext(SizeContext);
  const s = size ?? inherited;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`shrink-0 whitespace-nowrap rounded-md font-medium transition-all active:scale-[0.97] ${
        s === "sm" ? "h-8 px-2.5 text-xs" : "h-10 px-3.5 text-sm"
      } ${
        active
          ? // --brand carries the company colour; --brand-strong is near-black
            // in every theme and made the active option look simply black.
            "bg-brand text-white shadow-sm"
          : "text-[var(--ink-3)] hover:bg-[var(--hover-c2)]"
      }`}
    >
      {label}
    </button>
  );
}

// One icon-only action with its name on hover.
//
// The label is not decoration: an icon on its own is a guess until you click
// it. It is exposed three ways -- a styled tooltip for the mouse, `title` for
// the browser's own tooltip and touch long-press, and `aria-label` for screen
// readers -- because an icon button with no accessible name is just an
// unlabelled square to anyone not using their eyes.
export function IconAction({
  label,
  icon,
  onClick,
  href,
  active = false,
  tone = "quiet",
  disabled = false,
  size,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  href?: string;
  /** Toggled-on look, for actions that hold a state (e.g. edit mode). */
  active?: boolean;
  tone?: "quiet" | "brand" | "danger";
  disabled?: boolean;
  /** Overrides the size inherited from the surrounding IconToolbar. */
  size?: ToolbarSize;
}) {
  const inherited = useContext(SizeContext);
  const s = SIZE_CLASSES[size ?? inherited];
  // The `[&_svg]` rule sizes the icon from here rather than trusting each call
  // site to pass the same h-4 w-4 -- one place to change, and a new toolbar
  // can't quietly come out a different size.
  //
  // The lift on hover (-translate-y-0.5 + a shadow) is what makes an icon feel
  // pressable at all: without a label there is otherwise nothing that answers
  // the pointer until it's already been clicked.
  const base =
    `flex ${s.button} ${s.icon} shrink-0 items-center justify-center rounded-md transition-all duration-150 ` +
    "hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-95 " +
    "disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none";
  const look = active
    ? "bg-[var(--wash-amber)] text-[var(--wash-amber-ink)]"
    : tone === "brand"
      ? // --brand, not --brand-strong: the "strong" variant is near-black in
        // every theme (#1c1a3a, #06302b, #0c1e4a...), so a themed button made
        // of it just looked black. --brand is the shade that actually carries
        // the company's colour.
        "bg-brand text-white hover:brightness-110"
      : tone === "danger"
        ? "text-[var(--wash-rose-ink)] hover:bg-[var(--wash-rose)]"
        : "text-[var(--ink-3)] hover:bg-[var(--hover-c2)]";

  const inner = <span className="pointer-events-none">{icon}</span>;

  return (
    <span className="group/tip relative inline-flex">
      {href ? (
        <Link href={href} title={label} aria-label={label} className={`${base} ${look}`}>
          {inner}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          title={label}
          aria-label={label}
          className={`${base} ${look}`}
        >
          {inner}
        </button>
      )}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
