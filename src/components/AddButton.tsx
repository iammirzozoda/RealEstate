import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { PlusIcon } from "@/components/icons";

// The one shared "this adds something" button -- a rental unit, a client,
// a payment, a floor/block, a new record. Before this, every page styled
// its own: some a thin outline, some plain text, none of them animated or
// consistent with each other; page-header "new X" actions used a separate,
// icon-only control (IconAction) with no text label, so the same kind of
// action looked like two different controls depending on which page it was
// on. `.btn-add` (globals.css) carries the actual look -- brand-coloured
// outline at rest, fills in on hover via a sweep, the plus icon turning
// into a soft asterisk as it rotates -- so this component only has to
// assemble that class with a size and the icon.
export type AddButtonSize = "sm" | "md" | "lg";

const ICON_SIZE: Record<AddButtonSize, string> = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
  lg: "h-4 w-4",
};

type AddButtonOwnProps = {
  children: ReactNode;
  size?: AddButtonSize;
  /** Full width -- for a CTA at the foot of a form, not an inline toolbar. */
  block?: boolean;
  className?: string;
  /** Navigates instead of acting in place (e.g. "+ Мизоҷи нав" -> /clients/new)
      -- renders a Link with the exact same look instead of a <button>. */
  href?: string;
};

export function AddButton({
  children,
  size = "md",
  block = false,
  className = "",
  href,
  ...props
}: AddButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children" | "type" | "size">) {
  const cls = `btn-add btn-add-${size} ${block ? "btn-add-block" : ""} ${className}`;
  const inner = (
    <>
      <PlusIcon className={ICON_SIZE[size]} />
      {children}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} {...props}>
      {inner}
    </button>
  );
}
