"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { ControlGroup, IconAction, type ToolbarSize } from "@/components/ActionBar";
import { DownloadIcon, TableIcon, PdfIcon } from "@/components/icons";

// One "Экспорт" button that opens a small menu: Excel or PDF. The parent
// supplies the data lazily (fetched on demand) plus the headers, so the same
// menu serves clients, debtors, etc.
export function ExportMenu({
  getData,
  headers,
  filenameBase,
  title,
  size = "md",
  bare = false,
}: {
  // Returns the rows to export; async so the page can fetch the full set.
  getData: () => Promise<Array<Array<string | number | null | undefined>>>;
  headers: string[];
  filenameBase: string;
  title: string;
  size?: ToolbarSize;
  /** Render just the icon -- for when a parent ControlGroup owns the border. */
  bare?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const run = async (format: "excel" | "pdf") => {
    setBusy(true);
    setOpen(false);
    const rows = await getData();
    const { exportExcel, exportPdf, todayStamp } = await import("@/lib/export/exportTable");
    if (format === "excel") {
      await exportExcel(`${filenameBase}-${todayStamp()}`, headers, rows, title);
    } else {
      exportPdf(title, headers, rows);
    }
    setBusy(false);
  };

  return (
    // Same icon toolbar as print/share everywhere else, so "get this data out"
    // looks the same wherever it appears. The ⤓/▦/▤ characters it used before
    // were typographic stand-ins that rendered differently on every OS and
    // ignored the theme.
    <div ref={ref} className="relative">
      {(() => {
        const trigger = (
          <IconAction
            label={busy ? t.common.loading : t.exportMenu.export}
            icon={<DownloadIcon />}
            active={open}
            disabled={busy}
            size={size}
            onClick={() => setOpen((o) => !o)}
          />
        );
        return bare ? trigger : <ControlGroup size={size}>{trigger}</ControlGroup>;
      })()}
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] shadow-lg">
          <button
            type="button"
            onClick={() => run("excel")}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-[var(--ink-2)] transition-colors hover:bg-[var(--hover-c)]"
          >
            <TableIcon className="h-4 w-4 text-emerald-600" /> {t.exportMenu.excel}
          </button>
          <button
            type="button"
            onClick={() => run("pdf")}
            className="flex w-full items-center gap-2 border-t border-[var(--border-c2)] px-3 py-2.5 text-left text-sm text-[var(--ink-2)] transition-colors hover:bg-[var(--hover-c)]"
          >
            <PdfIcon className="h-4 w-4 text-rose-600" /> {t.exportMenu.pdf}
          </button>
        </div>
      )}
    </div>
  );
}
