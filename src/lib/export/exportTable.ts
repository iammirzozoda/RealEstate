// Table export in two formats the user picks from a menu.
//
// Excel: a REAL .xlsx workbook (ExcelJS), not the old trick of saving an
// HTML <table> with a ".xls" extension and letting Excel's format-sniffing
// open it. That trick worked, but every modern Excel shows a scary "the file
// format and extension don't match, it might be corrupted" warning before
// opening it, numbers land as plain text (no summing, no right-alignment,
// sorting treats "10" as coming before "9"), and there's no styling Excel
// itself recognises as real formatting -- which is exactly what read as
// "непонятный формат" (an unclear/wrong format). A genuine workbook has
// none of that: real numeric cells, a header styled to match the site
// (graphite fill, the same font, a yellow accent line under it -- see
// globals.css's own flattened Лимӯ theme for where those colours come
// from), sized columns, a frozen header row, and an auto-filter -- the
// things "an actual Excel file" is expected to have.
//
// PDF: unchanged -- a styled print window; the browser's "Save as PDF"
// turns it into a clean tabular document. User-initiated (a click), so
// popup blockers allow it.

import ExcelJS from "exceljs";

type Cell = string | number | null | undefined;

// The site's own graphite/yellow -- see globals.css's flattened Лимӯ theme
// (--hero-1 / --accent-yellow). Fixed rather than read from the company's
// live theme settings: this module has no access to that context (it's a
// plain function called from any export button on any page), and a
// professional-looking export shouldn't shift every time someone changes
// the app's hero theme in Settings.
const GRAPHITE = "FF18181B";
const YELLOW = "FFFACC15";
const INK_MUTED = "FF64748B";
const ROW_STRIPE = "FFF8FAFC";
const BORDER = "FFE2E8F0";
// Excel font records take one name, no fallback list the way CSS does --
// this is the site's actual font (next/font/google's Geist in layout.tsx).
// A machine without it installed just falls back to its own default with
// no error, same as a missing web font would.
const FONT = "Geist";

function trigger(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// A cell is written as a real Excel number only when the caller already
// handed over an actual JS number -- never guessed at by reverse-parsing a
// formatted string ("1 234,56 TJS"). Every export today builds its money
// columns as pre-formatted display strings (thousands grouping, a comma
// decimal, a currency code appended) for exactly this table; guessing
// which of those are safe to coerce back into numbers risks silently
// corrupting a figure in a financial export, which is worse than leaving
// it as text. Callers that want real numeric cells can already pass one --
// the type has always allowed it -- this just stops discarding it.
function isNumeric(v: Cell): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export async function exportExcel(
  filename: string,
  headers: string[],
  rows: Cell[][],
  title?: string
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RealEstate CRM";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(title?.slice(0, 31) || "Данные", {
    views: [{ state: "frozen", ySplit: title ? 4 : 1 }],
  });

  let headerRowNumber = 1;
  if (title) {
    const titleRow = sheet.addRow([title]);
    titleRow.getCell(1).font = { name: FONT, size: 14, bold: true, color: { argb: GRAPHITE } };
    sheet.mergeCells(1, 1, 1, Math.max(headers.length, 1));

    const dateRow = sheet.addRow([new Date().toLocaleDateString("ru-RU")]);
    dateRow.getCell(1).font = { name: FONT, size: 10, color: { argb: INK_MUTED } };
    sheet.mergeCells(2, 1, 2, Math.max(headers.length, 1));

    sheet.addRow([]);
    headerRowNumber = 4;
  }

  const headerRow = sheet.getRow(headerRowNumber);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAPHITE } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = { bottom: { style: "medium", color: { argb: YELLOW } } };
  });
  headerRow.commit();
  sheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: Math.max(headers.length, 1) },
  };

  rows.forEach((r, rowIndex) => {
    const row = sheet.addRow(r.map((c) => (isNumeric(c) ? c : (c ?? ""))));
    const striped = rowIndex % 2 === 1;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: FONT, size: 10.5 };
      cell.border = { bottom: { style: "thin", color: { argb: BORDER } } };
      if (striped) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROW_STRIPE } };
      if (isNumeric(r[colNumber - 1])) cell.alignment = { horizontal: "right" };
    });
  });

  // Column width from the widest cell actually in it (header included),
  // clamped so one long outlier (a note, an address) can't stretch every
  // column in the sheet to match it.
  headers.forEach((h, i) => {
    const longest = rows.reduce((max, r) => {
      const v = r[i];
      const len = v == null ? 0 : String(v).length;
      return Math.max(max, len);
    }, h.length);
    sheet.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 10), 40);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  trigger(
    filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`,
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );
}

const esc = (v: Cell) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export function exportPdf(title: string, headers: string[], rows: Cell[][]) {
  const thead = `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
  const tbody = rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("");
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(
    title
  )}</title><style>
    * { font-family: Arial, sans-serif; }
    h2 { color:#1c1a3a; margin:0 0 12px; }
    .date { color:#64748b; font-size:12px; margin:0 0 16px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th { background:#1c1a3a; color:#fff; text-align:left; padding:6px 8px; }
    td { border-bottom:1px solid #e2e8f0; padding:5px 8px; }
    tr:nth-child(even) td { background:#f8fafc; }
    @page { size: A4 landscape; margin: 12mm; }
  </style></head><body>
    <h2>${esc(title)}</h2>
    <p class="date">${new Date().toLocaleDateString()}</p>
    <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
    <script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) return; // popup blocked
  w.document.write(doc);
  w.document.close();
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
