"use client";

import { useSettings } from "@/lib/settings/SettingsProvider";
import { bareCompanyName } from "@/lib/settings/companyName";
import type { Currency } from "@/lib/currency";
import { amountToWordsTj } from "@/lib/contracts/amountToWordsTj";
import type { ContractPayment, PaymentType } from "@/lib/contracts/types";

export type ContractDocumentData = {
  number: string | null;
  signed_date: string | null;
  amount: number;
  paid_amount: number;
  amount_words: string | null;
  currency: Currency;
  payment_type: PaymentType;
  installment_months: number | null;
  client: {
    name: string;
    phone: string | null;
    passport: string | null;
    passport_issued_by: string | null;
    birth_date: string | null;
    address: string | null;
  } | null;
  object: {
    name: string;
    address: string | null;
    area: number | null;
    floor: number | null;
    block: string | null;
    rooms: number | null;
    building: { name: string; address: string | null; price_per_sqm: number | null } | null;
  } | null;
};

const SERIF = { fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif" };

// Tajik month names -- the paper contract dates in words, not 2026-03-14.
const TJ_MONTHS = [
  "январ",
  "феврал",
  "март",
  "апрел",
  "май",
  "июн",
  "июл",
  "август",
  "сентябр",
  "октябр",
  "ноябр",
  "декабр",
];

function tjLongDate(iso: string | null): string {
  if (!iso) return "____________";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${TJ_MONTHS[d.getMonth()]} ${d.getFullYear()} с.`;
}

// The paper contract writes sums as "340000 сомонӣ" / "6355,14 сомонӣ" --
// the Tajik currency word, not the TJS ticker that formatCurrency emits for
// the screen, and a decimal comma with no thousands spaces.
const CURRENCY_WORD: Record<Currency, string> = {
  TJS: "сомонӣ",
  USD: "доллари ИМА",
};

function docAmount(value: number, currency: Currency): string {
  const hasFraction = Math.round(value * 100) % 100 !== 0;
  const num = hasFraction ? value.toFixed(2).replace(".", ",") : String(Math.round(value));
  return `${num} ${CURRENCY_WORD[currency]}`;
}

// Areas print as "53,50 м²" -- two decimals, decimal comma.
function docArea(value: number | null): string {
  return value == null ? "__" : value.toFixed(2).replace(".", ",");
}

function shortDate(iso: string | null): string {
  if (!iso) return "__.__.____";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const PLUM = "#5b3468";

// Numbered section heading: a plum numeral in an outlined disc, the title,
// then a hairline rule running to the margin. Outlined rather than filled
// because a filled disc vanishes when the print dialog's "background
// graphics" box is unticked -- which is the default.
function Section({ num, title }: { num: number; title: string }) {
  return (
    <div className="mt-2.5 flex items-center gap-2 break-inside-avoid break-after-avoid">
      <span
        style={{ borderColor: PLUM, color: PLUM }}
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[10px] font-bold"
      >
        {num}
      </span>
      <span className="shrink-0 text-[12px] font-bold uppercase tracking-[0.07em]">
        {title}
      </span>
      <span style={{ backgroundColor: PLUM }} className="h-px flex-1 opacity-30" />
    </div>
  );
}

// Data that changes with every deal -- buyer, apartment, sums, dates.
// Rendered like a filled-in field (bold, dotted plum underline) so the
// document reads as a completed form rather than a wall of prose, and so
// staff can eyeball the substituted values before signing. The company's
// own details are deliberately NOT marked this way: they're constant.
function Var({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{ borderBottom: `1px dotted ${PLUM}` }}
      className="font-bold text-slate-900"
    >
      {children}
    </span>
  );
}

// One clean key/value row inside the deal-summary panel (no table borders,
// just a hairline divider). The legal clauses below reference this panel
// instead of restating every number.
function SummaryRow({
  label,
  value,
  big,
  last,
}: {
  label: string;
  value: React.ReactNode;
  big?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-1.5 ${
        last ? "" : "border-b border-slate-100"
      }`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </span>
      <span
        className={`text-right font-bold ${big ? "text-[15px]" : "text-[12.5px]"}`}
        style={big ? { color: PLUM } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

// A tiny stacked stat for the accent rail (label above, value below).
function RailStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <p className="text-[13px] font-bold leading-tight">{value}</p>
    </div>
  );
}

// A place to sign, drawn as a slot rather than a ruled line: the same dashed
// outline the seal ("М. П.") box beside it already uses, just wide instead of
// square and labelled "имзо" instead of "М. П.". Two matched fill-in boxes
// read as one modern idea -- "the empty ones are for you to fill in" -- where
// a bare horizontal rule above a caption is the older convention this
// replaces.
function SignatureSlot({ className = "" }: { className?: string }) {
  return (
    <div
      // h-10, not h-14: this box and the two lines under it are what push
      // Section 9's cards tall enough that the pair sometimes doesn't fit
      // the room left after clause 8.3, and break-inside-avoid then moves
      // the whole pair to a fresh page -- leaving clause 8's page with a
      // blank tail. A shorter slot is still plainly a place to sign; it
      // just costs the layout less.
      className={`flex h-10 items-center justify-center rounded-lg border-[1.5px] border-dashed border-slate-300 text-[10px] tracking-[0.2em] text-slate-300 ${className}`}
    >
      имзо
    </div>
  );
}

// The company's official cooperation contract (ШАРТНОМАИ ҲАМКОРӢ), wording
// taken verbatim from Намунаи шартномаи Бурҷи Бохтар.docx -- only the
// party/apartment/amount specifics are substituted from the deal. Section
// and clause numbers are kept exactly as in the paper original, because the
// text itself cross-references them ("дар банди 2.2 шартномаи мазкур").
export function ContractDocument({
  contract,
  payments,
  copyLabel,
  apartmentNumber,
}: {
  contract: ContractDocumentData;
  payments: ContractPayment[];
  copyLabel?: string;
  apartmentNumber?: number;
}) {
  const { settings } = useSettings();

  // Bare name: the document supplies the legal form itself, so a stored
  // "ЧДММ «Х»" would otherwise print as "ҶДММ «ЧДММ «Х»»".
  const companyName = bareCompanyName(settings.company_name) || "____________";
  const director = settings.company_director || "____________";
  const buildingAddress =
    contract.object?.building?.address ?? contract.object?.address ?? "____________";
  // The price per m² printed on the contract is THIS deal's individually
  // negotiated rate -- the contract's own total divided by the unit's area --
  // not the building's default listing rate. So a client given a special
  // price sees that price on paper, and re-editing the contract amount
  // re-derives it. Falls back to the building default only when the deal has
  // no usable amount/area yet.
  const dealArea = contract.object?.area ?? null;
  const pricePerSqm =
    dealArea && dealArea > 0 && contract.amount > 0
      ? Math.round((contract.amount / dealArea) * 100) / 100
      : contract.object?.building?.price_per_sqm ?? null;

  const amountWords =
    contract.amount_words || amountToWordsTj(contract.amount, contract.currency);

  const aptNo = apartmentNumber != null ? String(apartmentNumber) : "____";
  // A DRAFT template, not vetted legal wording -- see the isRent branches
  // below throughout this component. Flagged in chat when this was added:
  // review before actually handing one to a tenant to sign.
  const isRent = contract.payment_type === "rent";
  const paymentLabel = isRent
    ? `Иҷора · ${contract.installment_months ?? "__"} моҳ`
    : contract.payment_type === "installment"
      ? `Бо қисм · ${contract.installment_months ?? "__"} моҳ`
      : contract.payment_type === "barter"
        ? "Бартер"
        : "Якбора";
  const sellerLabel = isRent ? "АРЕНДОДАТЕЛЬ" : "Фурӯшанда";
  const buyerLabel = isRent ? "АРЕНДАТОР" : "Харидор";
  const sellerLabelUpper = isRent ? "АРЕНДОДАТЕЛЬ" : "ФУРӮШАНДА";
  const buyerLabelUpper = isRent ? "АРЕНДАТОР" : "ХАРИДОР";
  // Block/entrance is its own line, not joined into the same string as
  // floor/area/rooms: a block name like "Блоки А / Даромадгоҳи 1" is long
  // enough on its own to wrap, and wrapping it next to unrelated short items
  // used to break the line mid-phrase ("...Даромадгоҳи" / "1 · ошёнаи 7...").
  // Kept apart, each line only ever wraps within itself.
  const railBlock = contract.object?.block ?? null;
  // Order matters here: floor first (which floor the buyer walks onto), then
  // area, then room count -- matches how the company reads out a unit
  // verbally and how the paper contract should read too.
  const railSpecs = [
    contract.object?.floor != null ? `ошёнаи ${contract.object.floor}` : null,
    dealArea != null ? `${docArea(dealArea)} м²` : null,
    contract.object?.rooms != null ? `${contract.object.rooms} ҳуҷра` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const scheduleTotal = payments.reduce((sum, p) => sum + p.amount, 0);

  // Schedule summary derived from the ACTUAL rows, not recomputed from
  // amount/installment_months -- otherwise a hand-edited plan (irregular down
  // payments, extra one-off payments) printed a headline that contradicted the
  // table below it. Paid-so-far and the remaining count/typical monthly all
  // come straight from the payment rows the table renders.
  const paidRows = payments.filter((p) => p.paid);
  const unpaidRows = payments.filter((p) => !p.paid);
  const paidSoFar = paidRows.reduce((sum, p) => sum + p.amount, 0);
  const remainingSchedule = unpaidRows.reduce((sum, p) => sum + p.amount, 0);
  const typicalMonthly =
    unpaidRows.length > 0
      ? Math.round((remainingSchedule / unpaidRows.length) * 100) / 100
      : null;

  // Grouped into the same 4 practical categories as the work itself
  // (facade/entrance, grounds, in-unit, utilities) rather than one flat
  // run of 14 -- makes the printed table scannable, not just numbered.
  const workCategories: { category: string; items: string[] }[] = [
    {
      category: "Намо ва даромадгоҳ",
      items: [
        "Ороиши намо тибқи лоиҳа.",
        "Ороиши пурраи даромадгоҳи бино.",
        "Зинаҳои печдор бо тахтасангҳо (кафел).",
        "Насбкунии лифт.",
      ],
    },
    {
      category: "Ободонии ҳудуд",
      items: [
        "Насби таҷҳизотҳои рӯшноӣ дар зинапояҳо ва даромадгоҳ.",
        "Ободонии гирду атрофи бино.",
        "Сохт ва омодасозии майдончаи бозиҳои кӯдакона.",
      ],
    },
    {
      category: "Дохили хона",
      items: ["Насби дарҳои хонаҳо аз масолеҳи оҳанӣ.", "Тирезаҳо аз ПВХ, истеҳсоли Туркия."],
    },
    {
      category: "Шабакаҳои муҳандисӣ",
      items: [
        "Нуқтаи пайвасти синамо (телевизион).",
        "Пайвасти ноқилҳои барқӣ то нуқтаи аввал.",
        "Нуқтаи пайвасти обу корези (канализатсия).",
        "Ноқили пайвасти дар даромадгоҳ бо дамафон (domofon).",
        "Ноқилҳои пайвасти телефон, интернет ва WiFi.",
      ],
    },
  ];
  // Flattened once, with a running № carried across category boundaries,
  // so the table body below is a plain .map over category-header rows and
  // numbered-item rows instead of nested maps with hand-tracked counters.
  type WorkRow =
    | { kind: "cat"; key: string; label: string }
    | { kind: "item"; key: string; n: number; text: string };
  const worksRows: WorkRow[] = (() => {
    const rows: WorkRow[] = [];
    let n = 0;
    for (const group of workCategories) {
      rows.push({ kind: "cat", key: `cat-${group.category}`, label: group.category });
      for (const item of group.items) {
        n += 1;
        rows.push({ kind: "item", key: `item-${n}`, n, text: item });
      }
    }
    return rows;
  })();

  // A4 content height per printed page: 297mm page minus the 12mm top and
  // 12mm bottom margins (the @page rule in globals.css -- this number has
  // to match it by hand, there's no way to read a CSS rule back in here).
  const PAGE_CONTENT_MM = 297 - 12 - 12;

  // Watermark: the company logo, washed out and centred behind the text,
  // same as the Word original. Deliberately <img> elements rather than a
  // CSS background -- browsers skip background graphics when printing
  // unless the user ticks that box, but real images always print.
  //
  // REPEATED, one copy per page height, rather than a single instance
  // centred on the whole document -- a contract can run several physical
  // pages (the main body, then ЗАМИМА and the payment schedule each
  // forcing a fresh page of their own), and a single top:50% image only
  // ever lands on whichever ONE page happens to fall at the combined
  // midpoint, leaving every other page missing it or showing it cut off
  // partway down. position:fixed would repeat a background per printed
  // page instead, but #contract-print-area's own print rules
  // (globals.css) already tried that and dropped it: Chrome doesn't
  // paginate a fixed element at all, it just clips the same
  // single-viewport-height slice onto every page. Tiling absolute copies
  // at fixed PAGE_CONTENT_MM intervals is what's left -- each one centred
  // within its own page-height slice, counted from the top of THIS
  // document (which always starts a fresh page: see the
  // print:break-before-page/print:break-after-page around every copy and
  // annex, so offset 0 here really is the top of a printed page). Eight
  // repeats is more pages than any realistic contract runs to; the unused
  // ones fall past the actual content and are clipped by this card's own
  // overflow-hidden, same as if they were never rendered.
  const logoUrl = settings.company_logo_url;
  const watermark = logoUrl && (
    <>
      {Array.from({ length: 8 }, (_, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={logoUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 w-[62%] -translate-x-1/2 -translate-y-1/2 select-none opacity-[0.12]"
          style={{ top: `${i * PAGE_CONTENT_MM + PAGE_CONTENT_MM / 2}mm` }}
        />
      ))}
    </>
  );

  return (
    <div
      style={SERIF}
      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white text-[11px] leading-[1.4] text-slate-900 shadow-sm print:rounded-none print:border-0 print:shadow-none"
    >
      {watermark}
      <div className="relative">
        {copyLabel && (
          <p className="px-6 py-1 text-center text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">
            {copyLabel}
          </p>
        )}

        {/* Letterhead: the company's fixed identity, left; the contract's
            own identity, right. Everything here except the number/date is
            constant across every contract the company ever prints. */}
        <div
          style={{ borderBottom: `2.5px solid ${PLUM}` }}
          className="flex items-start justify-between gap-6 px-10 pb-4 pt-7"
        >
          <div className="flex items-start gap-3">
            {settings.company_logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={settings.company_logo_url}
                alt=""
                className="h-14 w-14 shrink-0 object-contain"
              />
            )}
            <div className="leading-[1.45]">
              <p className="text-[15px] font-bold tracking-tight">
                ҶДММ «{companyName}»
              </p>
              {settings.company_address && (
                <p className="text-[10px] text-slate-500">{settings.company_address}</p>
              )}
              {settings.company_bank_details && (
                <p className="text-[9.5px] text-slate-400">{settings.company_bank_details}</p>
              )}
            </div>
          </div>
          <div
            style={{ borderColor: PLUM }}
            className="shrink-0 rounded-lg border-[1.5px] px-3 py-1.5 text-right"
          >
            <p className="text-[8.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Шартнома
            </p>
            <p style={{ color: PLUM }} className="text-[17px] font-bold leading-tight">
              №{contract.number || "____"}
            </p>
          </div>
        </div>

        {/* print:block: this is the whole letter body (all 9 sections + the
            payment table), routinely taller than one printed page. Chrome's
            print engine doesn't fragment display:flex containers across
            page breaks the way it does plain block content -- content got
            cut off mid-line or an entire remaining stretch jumped whole to
            the next page. Block flow lets the page-break-inside/orphans/
            widows rules on #contract-print-area (globals.css) do their job. */}
        <div className="flex flex-col gap-1.5 px-9 pb-6 pt-4 print:block">
          {/* Title */}
          <div className="flex items-center gap-3">
            <span style={{ backgroundColor: PLUM }} className="h-px flex-1 opacity-25" />
            <p className="shrink-0 text-center text-[18px] font-bold tracking-[0.14em]">
              {isRent ? "ШАРТНОМАИ ИҶОРА" : "ШАРТНОМАИ ҲАМКОРӢ"}
            </p>
            <span style={{ backgroundColor: PLUM }} className="h-px flex-1 opacity-25" />
          </div>

          <div className="flex items-baseline justify-between text-[12.5px] print:mt-1">
            <span>
              <Var>{shortDate(contract.signed_date)}</Var>{" "}
              <span className="text-slate-500">({tjLongDate(contract.signed_date)})</span>
            </span>
            <span className="font-bold">ш. Бохтар</span>
          </div>

          {/* Deal summary ("Маълумоти аҳд") -- an accent rail with the flat
              number + its key specs, and clean data rows beside it. Every
              figure lives here; the clauses below reference it instead of
              repeating the numbers. */}
          <div
            style={{ borderColor: PLUM }}
            className="mt-3 overflow-hidden rounded-lg border break-inside-avoid"
          >
            <p
              style={{ borderColor: PLUM, color: PLUM }}
              className="border-b px-3 py-1 text-[9px] font-bold uppercase tracking-[0.16em]"
            >
              Маълумоти аҳд
            </p>
            <div className="flex">
            <div
              style={{ borderColor: PLUM }}
              // Widened from w-36: at that width "Блоки А / Даромадгоҳи 1"
              // alone wrapped across two lines and pushed the whole rail
              // taller than the five rows beside it needed to be -- which is
              // what stretched those rows apart with justify-between below.
              // A wider column lets the block name sit on one line, the rail
              // shrinks to match its neighbour, and the gap goes with it.
              className="flex w-44 shrink-0 flex-col gap-2.5 border-r bg-slate-50 p-3 print:bg-white"
            >
              <div>
                <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Хона
                </p>
                <p style={{ color: PLUM }} className="text-[30px] font-bold leading-none">
                  №{aptNo}
                </p>
              </div>
              {(railBlock || railSpecs) && (
                <div className="flex flex-col gap-0.5">
                  {railBlock && <p className="text-[10.5px] text-slate-600">{railBlock}</p>}
                  {railSpecs && <p className="text-[10.5px] text-slate-600">{railSpecs}</p>}
                </div>
              )}
              <div className="mt-auto flex flex-col gap-2 pt-1">
                <RailStat
                  label="Масоҳат"
                  value={`${docArea(contract.object?.area ?? null)} м²`}
                />
                {pricePerSqm != null && (
                  <RailStat label="Нарх/м²" value={docAmount(pricePerSqm, contract.currency)} />
                )}
              </div>
            </div>

            {/* Centred as a tight block, not stretched with justify-between.
                The rail beside this is the taller column -- a big flat
                number, the spec lines and two stats add up to more height
                than five short rows need -- and spreading five rows across
                that extra height put visible gaps between every one of them.
                The rows stay their own natural, close height; centring just
                places that block in the middle of whatever space the rail
                sets, so the panel reads as compact regardless of which
                column happens to be taller. */}
            <div className="flex flex-1 flex-col justify-center px-3.5 py-1.5">
              <SummaryRow label={sellerLabel} value={`ҶДММ «${companyName}»`} />
              <SummaryRow label={buyerLabel} value={contract.client?.name ?? "____________"} />
              <SummaryRow label="Шиноснома" value={contract.client?.passport ?? "—"} />
              <SummaryRow label="Навъи пардохт" value={paymentLabel} />
              <SummaryRow
                label={isRent ? "Маблағи умумии иҷора" : "Маблағи умумӣ"}
                value={docAmount(contract.amount, contract.currency)}
                big
                last
              />
            </div>
            </div>
          </div>

          <Section num={1} title="Тарафҳои аҳдкунанда" />
          {isRent ? (
            <p className="text-justify">
              Ҷамъияти дорои масъулияти маҳдуди «{companyName}» дар шахсияти роҳбари ҷамъият{" "}
              <b>{director}</b>, ки дар асоси Оинномаи ҷамъият амал мекунад, аз як тараф,
              минбаъд <b>«АРЕНДОДАТЕЛЬ»</b> ва аз тарафи дигар шаҳрванди Ҷумҳурии Тоҷикистон{" "}
              <Var>{contract.client?.name ?? "____________"}</Var>
              {contract.client?.passport ? ", шиноснома № " : ""}
              {contract.client?.passport && <Var>{contract.client.passport}</Var>}
              {contract.client?.passport_issued_by ? ", дода шудааст аз ҷониби " : ""}
              {contract.client?.passport_issued_by && (
                <Var>{contract.client.passport_issued_by}</Var>
              )}
              , ки минбаъд <b>«АРЕНДАТОР»</b> номида мешавад, ҳамин шартномаро оид ба иҷораи
              хона бо шартҳои зерин бастанд.
            </p>
          ) : (
            <p className="text-justify">
              Ҷамъияти дорои масъулияти маҳдуди «{companyName}» дар шахсияти роҳбари ҷамъият{" "}
              <b>{director}</b>, ки дар асоси Оинномаи ҷамъият амал мекунад, аз як тараф,
              минбаъд <b>«Фурӯшанда»</b> ва аз тарафи дигар шаҳрванди Ҷумҳурии Тоҷикистон{" "}
              <Var>{contract.client?.name ?? "____________"}</Var>
              {contract.client?.passport ? ", шиноснома № " : ""}
              {contract.client?.passport && <Var>{contract.client.passport}</Var>}
              {contract.client?.passport_issued_by ? ", дода шудааст аз ҷониби " : ""}
              {contract.client?.passport_issued_by && (
                <Var>{contract.client.passport_issued_by}</Var>
              )}
              , ки минбаъд <b>«Харидор»</b> номида мешавад, ҳамин шартномаро бо шартҳои зерин
              бастанд.
            </p>
          )}

          <Section num={2} title="Мақсади шартнома" />
          {isRent ? (
            <>
              <p className="text-justify">
                2.1. Мутобиқи шартномаи мазкур «АРЕНДОДАТЕЛЬ» ҳуҷраи (хонаи){" "}
                <Var>№{aptNo}</Var>-ро, воқеъ дар <Var>{buildingAddress}</Var>, бо
                нишондиҳандаҳои дар «Маълумоти аҳд»-и боло овардашуда (масоҳат, нарх барои
                1 м²), бо шартҳои иҷора ба «АРЕНДАТОР» месупорад.
              </p>
              <p className="text-justify">
                2.2. Мӯҳлати иҷора{" "}
                <Var>{contract.installment_months ?? "__"} моҳ</Var>-ро ташкил медиҳад, аз
                санаи <Var>{shortDate(contract.signed_date)}</Var> сар карда.
              </p>
              <p className="text-justify">
                2.3. «АРЕНДАТОР» уҳдадор мешавад маблағи иҷораро дар андозаи дар «Маълумоти
                аҳд» нишондодашуда ({amountWords}), тибқи ҷадвали замимашудаи пардохт, ҳар моҳ
                пардохт намояд.
              </p>
              <p className="text-justify">
                2.4. Супоридани ҳуҷра (хона) ба иҷора моликияти онро ба «АРЕНДАТОР» интиқол
                намедиҳад — ба «АРЕНДАТОР» танҳо ҳуқуқи истифодабарии муваққатӣ дар давоми
                мӯҳлати шартномаи мазкур дода мешавад.
              </p>
            </>
          ) : (
            <>
              <p className="text-justify">
                2.1. Бо мақсади вусъат бахшидани рафти сохтмони биноҳои истиқоматии баландошёна
                бо пентхаус, дар ошёнаи якум маркази савдо ва хизматрасонӣ ва дар таҳхонаҳои онҳо
                ташкил намудани таваққуфгоҳи зеризаминӣ, воқеъ дар <Var>{buildingAddress}</Var>, тарафҳо
                уҳдадор шуданд, ки бо шартҳои манфиати мутақобила ҳамкорӣ намоянд.
              </p>
              <p className="text-justify">
                2.2. «Фурӯшанда» имконият медиҳад, ки «Харидор» дар маблағгузории иншооти мазкур
                ширкат намуда, ҳуҷраи истиқоматии <Var>№{aptNo}</Var>-ро, ки нишондиҳандаҳои он
                (ошёна, шумораи ҳуҷраҳо, масоҳат ва нарх барои 1 м²) дар «Маълумоти аҳд»-и боло
                оварда шудаанд, ба моликияти худ ба расмият дарорад. «Харидор» уҳдадор мешавад, ки
                маблағи умумии дар «Маълумоти аҳд» нишондодашударо ({amountWords}) дар муҳлати
                пешбининамудаи шартномаи мазкур пардохт намуда, минбаъд онро ба моликияти шахсии
                худ табдил диҳад.
              </p>
              <p className="text-justify">
                2.3. «Фурӯшанда» бо анҷом расидани корҳои сохтмонӣ ва супоридани иншоот ба
                «Харидор» масоҳати зикршударо, ки дар банди 2.2-и шартномаи мазкур нишон дода
                шудааст, месупорад.
              </p>
              <p className="text-justify">
                2.4. «Харидор» аз лаҳзаи бастани шартномаи ҳамкорӣ талаботи дар банди 2.2-и
                шартномаи мазкур нишон додашударо таъмин менамояд.
              </p>
            </>
          )}

          <Section num={3} title="Уҳдадориҳои тарафҳо" />
          {isRent ? (
            <>
              <p className="text-justify">
                3.1. «АРЕНДОДАТЕЛЬ» уҳдадор мешавад ҳуҷраро (хонаро) дар ҳолати барои истифода
                мувофиқ ба «АРЕНДАТОР» супорад.
              </p>
              <p className="text-justify">
                3.2. «АРЕНДАТОР» уҳдадор мешавад ҳуҷраро (хонаро) тибқи таъиноти он истифода
                барад, ҳолати онро нигоҳ дорад ва хароҷоти ҷории истифодабарӣ (обу барқ ва
                монанди инҳо, агар дар шартнома тартиби дигар пешбинӣ нашуда бошад)-ро
                мустақилона пардохт намояд.
              </p>
              <p className="text-justify">
                3.3. Бе розигии хаттии «АРЕНДОДАТЕЛЬ» «АРЕНДАТОР» ҳуқуқи ба зерижора додани
                ҳуҷраро (хонаро) ба шахси сеюм надорад.
              </p>
            </>
          ) : (
            <>
              <p className="text-justify">
                3.1. «Фурӯшанда» уҳдадор мешавад ба «Харидор» барои ба расмият даровардани
                манзили истиқоматӣ ба моликияти шахсӣ шиносномаи техникӣ диҳад, ки он баъди
                қабули иншоот ба баҳрабардорӣ дода мешавад.
              </p>
              <p className="text-justify">
                3.2. Тамоми хароҷоти вобаста ба ҳуҷҷатгузории нотариалӣ ва бақайдгирии давлатӣ,
                аз рӯи нархномаи КДФБММГ ва нотариуси давлатӣ, мустақилона аз ҷониби «Харидор»
                пардохт карда мешавад.
              </p>
            </>
          )}

          <Section num={4} title="Масъулияти тарафҳо" />
          {isRent ? (
            <>
              <p className="text-justify">
                4.1. «АРЕНДАТОР» барои саривақт пардохт намудани маблағи иҷора масъул мебошад.
              </p>
              <p className="text-justify">
                4.2. «АРЕНДОДАТЕЛЬ» барои пешниҳод намудани ҳуҷра (хона) дар ҳолати барои
                истифода мувофиқ, дар мӯҳлати банди 2.1-и шартномаи мазкур масъул мебошад.
              </p>
              <p className="text-justify">
                4.3. «АРЕНДАТОР» барои зараре, ки аз ҷониби худи ӯ ба ҳуҷра (хона) расонида
                мешавад, ба ғайр аз кӯҳнашавии табиӣ, масъул мебошад.
              </p>
            </>
          ) : (
            <>
              <p className="text-justify">
                4.1. «Харидор» барои саривақт пардохт намудани маблағи шартнома дар банди 2.2
                шартномаи мазкур нишондодашуда масъул мебошад.
              </p>
              <p className="text-justify">
                4.2. «Фурӯшанда» барои саривақт ва босифат иҷро намудани корҳои сохтмонӣ –
                васлкунии иншоот масъул мебошад.
              </p>
            </>
          )}

          <Section num={5} title="Чораҳои ҷаримавӣ" />
          {isRent ? (
            <p className="text-justify">
              5.1. Дар мавриди риоя накардани муҳлати пардохти иҷора зиёда аз 10 рӯз, ба
              андозаи 0,1% аз маблағи иҷораи як моҳ барои ҳар як рӯзи ба таъхирандозӣ, на
              зиёда аз 10%, «АРЕНДАТОР» ба «АРЕНДОДАТЕЛЬ» ҷарима пардохт менамояд.
            </p>
          ) : (
            <>
              <p className="text-justify">
                5.1. Дар мавриди риоя накардани муҳлати пардохт зиёда аз як моҳ ба андозаи 0,1%
                аз маблағи умумии шартнома барои ҳар як рӯзи ба таъхирандозӣ, на зиёда аз 10%,
                «Харидор» ба «Фурӯшанда» ҷарима пардохт менамояд.
              </p>
              <p className="text-justify">
                5.2. Дар ҳолати «Харидор» пас аз анҷоми сохтмони бинои истиқоматии бисёрошёна дар
                банди 2.2 шартномаи мазкур муқараргардидаро рад намояд, бо ҷарима ситонида ба
                андозаи 10%-и маблағи умумии дар шартнома зикршуда баргардонида мешавад.
              </p>
            </>
          )}

          <Section num={6} title="Ҳолатҳои бекор намудани шартнома" />
          {isRent ? (
            <>
              <p className="text-justify">
                6.1. Шартнома тибқи мувофиқаи тарафайн, инчунин бо хоҳиши яктарафаи ҳар кадом
                тараф бо огоҳонии дигар тараф на камтар аз 30 рӯз пеш, бекор карда шуда
                метавонад.
              </p>
              <p className="text-justify">
                6.2. Дар сурати аз ҷониби «АРЕНДАТОР» 2 (ду) моҳ пай дар пай пардохт накардани
                маблағи иҷора, «АРЕНДОДАТЕЛЬ» метавонад шартномаро якҷониба бекор намуда,
                ҳуҷраро (хонаро) ба иҷорагири дигар супорад.
              </p>
              <p className="text-justify">
                6.3. Баъди анҷоми мӯҳлати шартнома «АРЕНДАТОР» уҳдадор аст ҳуҷраро (хонаро) дар
                ҳолати аслии он, бо назардошти кӯҳнашавии табиӣ, ба «АРЕНДОДАТЕЛЬ» баргардонад.
              </p>
            </>
          ) : (
            <>
              <p className="text-justify">
                6.1. Шартнома тибқи мувофиқаи тарафайн то пардохт намудан ва ё бо тартиби
                яктарафа дар мавриди қобилияти имконнопазир рад намуда, «Харидор» изҳори
                боздошти пардохт беш аз як моҳ аз муҳлати пардохт метавон бекор кард.
              </p>
              <p className="text-justify">
                6.2. Дар сурати 2 (ду) моҳ пардохт накардани маблағ аз тарафи «Харидор», онгоҳ
                «Фурӯшанда» метавонад дигар муштариро барои ҳуҷраи дар банди 2.2 шартномаи мазкур
                аз нав бандад.
              </p>
            </>
          )}

          <Section num={7} title="Форс-мажор" />
          <p className="text-justify">
            7.1. Ягон тараф масъулиятро барои иҷро накардан ва иҷрои номатлуби уҳдадориҳои
            худ нахоҳад бурд, агар иҷрои номатлуб дар ҳолати қувваи рафънопазир номумкин
            гашта бошад, яъне ҳолатҳои фавқулода, ки онҳо баъди бастани Шартномаҳои мазкур ба
            вуҷуд омаданд. Ба чунин ҳолатҳо дохил мешавад: сӯхтор, обхезӣ, заминҷунбӣ ва
            дигар офатҳои табиӣ, ки уҳдадориҳои тарафҳоро номумкин мегардонад.
          </p>
          <p className="text-justify">
            7.2. Агар ҳамагуна аз ҳолатҳои мазкур бевосита барои иҷрои уҳдадориҳо ба
            муҳлате, ки дар шартномаи мазкур дарҷ шудааст, таъсир расонида, муҳлати мазкур ба
            вақти амалии ҳолати дахлдор дароз карда мешавад.
          </p>

          <Section num={8} title="Ҳалли баҳсҳо" />
          <p className="text-justify">
            8.1. Баҳсҳои зимни амалисозии шартномаи мазкур рухдиҳандаро метавон бо роҳи
            гуфтушунид ҳал намуд. Дар мавриди бо гуфтушунид ҳал нагардидани баҳс, он дар
            асоси Қонунҳои амалкунандаи Ҷумҳурии Тоҷикистон дар Суди иқтисодии шаҳри Бохтар
            ҳаллу фасл карда мешавад.
          </p>
          <p className="text-justify">
            8.2. Шартномаи мазкур аз лаҳзаи ба имзо расонидани ҳар ду тараф эътибор пайдо
            менамояд.
          </p>
          <p className="text-justify">
            8.3.{" "}
            {isRent
              ? "Шартномаи мазкур дар ду нусха бо забони тоҷикӣ барои ҳар кадом тарафҳо тартиб дода шудааст ва эътибор ва ҳуқуқи якхела дорад."
              : "Ба Шартномаи мазкур номгӯи намуди корҳои иҷронамудаи «Фурӯшанда» замима гардида, қисми ҷудонопазири шартнома ба шумор рафта, шартнома дар ду нусха бо забони тоҷикӣ барои ҳар кадом тарафҳо тартиб дода шудааст ва эътибор ва ҳуқуқи якхела дорад."}
          </p>

          <Section num={9} title="Суроғаи ҳуқуқӣ ва имзои тарафҳо" />

          {/* Two party cards. The seller's block is the company's fixed
              identity (settings); the buyer's is the part that differs on
              every contract, so it gets the filled-field treatment.

              break-inside-avoid on the row AND on each card: nothing here
              told the print engine to keep a card whole, so when the pair
              landed too low on a page to fit, Chrome split a card's own
              border box mid-height -- the bottom half (a signature slot,
              "М. П.", the date) re-opened as if it were a fresh, unrelated
              box at the top of the next page, with no border tying it back
              to the header above. #contract-print-area's own print rules
              (globals.css) only cover <section> and <table>, and this is
              neither. Guarding the row keeps the seller/buyer pair moving
              together as one unit; guarding each card too is what actually
              stops ITS OWN border from splitting once that unit lands on a
              page. */}
          <div className="mt-1 grid grid-cols-2 gap-5 break-inside-avoid text-[11.5px] leading-[1.55]">
            <div
              style={{ borderColor: PLUM }}
              className="flex flex-col break-inside-avoid rounded-lg border p-3.5"
            >
              <p
                style={{ borderColor: PLUM, color: PLUM }}
                className="border-b pb-1 text-[12.5px] font-bold tracking-wide"
              >
                «{sellerLabelUpper}»
              </p>
              <p className="mt-1.5">Роҳбари ҶДММ «{companyName}»</p>
              <p className="text-[12.5px] font-bold">{director}</p>
              {settings.company_address && (
                <p className="text-slate-600">{settings.company_address}</p>
              )}
              {settings.company_bank_details && (
                <p className="whitespace-pre-line text-slate-600">
                  {settings.company_bank_details}
                </p>
              )}
              {/* М. П. beside the signature slot, not stacked under it --
                  stacked, it added a whole extra box's worth of height to
                  the seller's card alone. Since the two cards stretch to
                  equal height (grid's own align-items: stretch) and the
                  buyer has no stamp, that extra height became empty space
                  in the BUYER's card, pushed there by its own mt-auto. Side
                  by side, the seller's bottom block is barely taller than
                  the buyer's, so there is far less gap to inherit. */}
              <div className="mt-auto flex items-start gap-3 pt-4">
                <div className="flex-1">
                  <SignatureSlot />
                  <p className="mt-2">
                    Санаи <Var>{shortDate(contract.signed_date)}</Var>
                  </p>
                </div>
                <div className="flex h-10 w-20 shrink-0 items-center justify-center rounded-lg border-[1.5px] border-dashed border-slate-300 text-[10px] tracking-[0.2em] text-slate-300">
                  М. П.
                </div>
              </div>
            </div>

            <div
              style={{ borderColor: PLUM }}
              className="flex flex-col break-inside-avoid rounded-lg border p-3.5"
            >
              <p
                style={{ borderColor: PLUM, color: PLUM }}
                className="border-b pb-1 text-[12.5px] font-bold tracking-wide"
              >
                «{buyerLabelUpper}»
              </p>
              <p className="mt-1.5 text-[12.5px]">
                <Var>{contract.client?.name ?? "____________"}</Var>
              </p>
              {contract.client?.passport && (
                <p className="text-slate-600">Шиноснома: {contract.client.passport}</p>
              )}
              {contract.client?.passport_issued_by && (
                <p className="text-slate-600">
                  Дода шудааст: {contract.client.passport_issued_by}
                </p>
              )}
              {contract.client?.address && (
                <p className="text-slate-600">{contract.client.address}</p>
              )}
              {contract.client?.phone && (
                <p className="text-slate-600">Тел: {contract.client.phone}</p>
              )}
              <div className="mt-auto pt-4">
                <SignatureSlot />
                <p className="mt-2">
                  Санаи <Var>{shortDate(contract.signed_date)}</Var>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ЗАМИМА is the list of CONSTRUCTION works completed on a new
            building being sold -- meaningless for a lease of already-
            existing space, so it's skipped entirely for isRent rather than
            relabelled the way the sections above are. Forces its own fresh
            page again (print:break-before-page), matching the original Word
            document -- reinstated on purpose. Dropping it once (to stop it
            compounding whitespace with break-inside-avoid above) traded one
            real defect for another: a page that carries Section 9's
            signature+seal AND ЗАМИМА's own signature pair together looks
            like two separate signing points crammed onto one sheet.
            Section 9's cards were shrunk instead (SignatureSlot h-10,
            tighter padding) so the pair fits after clause 8.3 more often,
            which is the other half of the same fix -- leaving less room for
            the case this break-before-page still has to cover. print:block
            stays regardless: this can run past one page on its own
            (14-item list + two signature blocks), and a flex container
            doesn't paginate that overflow onto the next page cleanly. */}
        {!isRent && (
        <div className="flex flex-col gap-1.5 px-10 pb-8 pt-7 print:break-before-page print:block">
          <div className="flex items-center gap-3">
            <span style={{ backgroundColor: PLUM }} className="h-px flex-1 opacity-25" />
            <p className="shrink-0 text-center text-[16px] font-bold tracking-[0.18em]">
              ЗАМИМА
            </p>
            <span style={{ backgroundColor: PLUM }} className="h-px flex-1 opacity-25" />
          </div>
          <p className="text-center text-[12.5px] font-bold">
            Номгӯи корҳои иҷрошаванда ва масолеҳҳои истифодашаванда
          </p>
          {/* Full text width, matching the rest of the document -- an
              earlier pass narrowed this to its own centred column, which
              looked fine on its own but put its margins visibly out of
              line with every other page once printed as part of the same
              booklet. */}
          <p className="mt-1 text-justify">
            Корҳои сохтмонию васлкунии ба анҷом расонидашуда ва иншооти мазкур барои
            баҳрабардорӣ ва расмиятдарорӣ бо моликият пас аз анҷоми корҳои зайл омода
            ҳисобида мешаванд:
          </p>
          {/* A smeta-style table, not a numbered list -- per request, no
              circles/badges/colour in the marking itself: black rule under
              the header (bold) and under each category label, plain
              tabular numbers, a light grey zebra on item rows only. This
              is the format an act of completed works actually uses. Full
              text width, same reason as the paragraph above.
              break-inside-avoid keeps the whole table from splitting
              across the page boundary if it ever runs close to the edge. */}
          <div className="mt-2 break-inside-avoid">
            <table className="w-full border-collapse text-[9px]">
              <thead>
                <tr>
                  <th className="w-6 border-b-[1.6px] border-slate-900 py-1.5 pr-1 text-center font-bold">
                    №
                  </th>
                  <th className="border-b-[1.6px] border-slate-900 py-1.5 pl-2 text-left font-bold tracking-wide">
                    Номгӯи корҳо
                  </th>
                </tr>
              </thead>
              <tbody>
                {worksRows.map((row) =>
                  row.kind === "cat" ? (
                    <tr key={row.key}>
                      <td
                        colSpan={2}
                        className="border-b-[0.6px] border-slate-900 pb-1 pt-1.5 text-[7.9px] font-bold uppercase tracking-[0.08em]"
                      >
                        {row.label}
                      </td>
                    </tr>
                  ) : (
                    <tr key={row.key} className="even:bg-slate-50">
                      <td className="border-b-[0.6px] border-slate-300 py-1 pr-1 text-center font-bold tabular-nums">
                        {row.n}
                      </td>
                      <td className="border-b-[0.6px] border-slate-300 py-1 pl-2 text-left">
                        {row.text}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>

          {/* Both cells are flex-col with the signature group pushed to the
              bottom via mt-auto, not stacked flush under whatever text
              happens to be above it. The seller's cell carries two lines
              (role + name), the buyer's carries one -- with a fixed mt-7
              instead, that one extra line was enough to put the two "имзо"
              labels at different heights, which is exactly what showed up as
              the lines looking misaligned side by side. Grid's own
              align-items: stretch already gives both cells equal height, so
              mt-auto has a full-height column to push against on each side.
              break-inside-avoid for the same reason the main signature cards
              above carry it: without it, nothing stops a name from landing
              on one page and its own signature slot on the next. */}
          <div className="mt-8 grid grid-cols-2 gap-8 break-inside-avoid text-center text-[12px]">
            <div className="flex flex-col">
              <p style={{ color: PLUM }} className="text-[12.5px] font-bold">
                «Фурӯшанда»
              </p>
              <p className="mt-1">Роҳбари ҶДММ «{companyName}»</p>
              <p className="font-bold">{director}</p>
              <div className="mt-auto pt-7">
                <SignatureSlot className="mx-auto w-4/5" />
              </div>
            </div>
            <div className="flex flex-col">
              <p style={{ color: PLUM }} className="text-[12.5px] font-bold">
                «Харидор»
              </p>
              <p className="mt-1">
                <Var>{contract.client?.name ?? "____________"}</Var>
              </p>
              <div className="mt-auto pt-7">
                <SignatureSlot className="mx-auto w-4/5" />
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Payment schedule -- only when the deal actually has one, and the
            LAST thing in the document, after ЗАМИМА, rather than a table
            wedged into the body between clause 8.3 and the signatures.
            print:break-before-page for the same reason ЗАМИМА carries one:
            ЗАМИМА's own content doesn't reliably fill its page, so without
            a forced break here the table just continues wherever ЗАМИМА
            happened to end -- an annex sharing a page with an unrelated
            table, which reads as one page belonging to two different
            things. globals.css also keeps the <table> itself from
            splitting mid-row (page-break-inside: avoid); print:block is
            what lets it spill onto a FOLLOWING page cleanly if it runs
            past one on its own. */}
        {(contract.payment_type === "installment" || isRent) && payments.length > 0 && (
          <div className="flex flex-col gap-1.5 px-10 pb-8 pt-7 print:break-before-page print:block">
            <div className="flex items-center gap-3">
              <span style={{ backgroundColor: PLUM }} className="h-px flex-1 opacity-25" />
              <p className="shrink-0 text-center text-[16px] font-bold tracking-[0.18em]">
                ҶАДВАЛИ ПАРДОХТҲО
              </p>
              <span style={{ backgroundColor: PLUM }} className="h-px flex-1 opacity-25" />
            </div>
            {/* Same black/white marking as the ЗАМИМА table above: bold
                black rule under the header instead of plum, tabular
                numbers so № and Маблағ line up in their columns, neutral
                grey zebra, a bold (not coloured) date for a still-open row
                that's already past its due date, and a heavier top rule on
                the total row instead of the previous double-thin one.
                Full text width, matching every other page in the document
                -- not narrowed like an earlier pass had it, which put its
                margins visibly out of line with the rest of the printed
                booklet. */}
            <p className="text-center">
              Пардохтшуда: <b>{docAmount(paidSoFar, contract.currency)}</b>; боқимонда:{" "}
              <b>{docAmount(remainingSchedule, contract.currency)}</b>
              {unpaidRows.length > 0 && typicalMonthly != null && (
                <>
                  {" "}
                  дар <b>{unpaidRows.length}</b> қисм, ҳар моҳ тақрибан{" "}
                  <b>{docAmount(typicalMonthly, contract.currency)}</b>
                </>
              )}
              .
            </p>
            <div className="mt-1">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b-[1.6px] border-slate-900 text-left">
                    <th className="px-2 py-1 text-center font-bold">№</th>
                    <th className="px-2 py-1 font-bold">Сана</th>
                    <th className="px-2 py-1 text-right font-bold">Маблағ</th>
                    <th className="whitespace-nowrap px-2 py-1 text-center font-bold">
                      Пардохт шуд
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p, i) => {
                    const overdue = !p.paid && new Date(p.due_date) < new Date();
                    return (
                      <tr key={p.id} className="border-b-[0.6px] border-slate-300 even:bg-slate-50">
                        <td className="px-2 py-1 text-center tabular-nums">{i + 1}</td>
                        <td className={`px-2 py-1 ${overdue ? "font-bold" : ""}`}>
                          {shortDate(p.due_date)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {docAmount(p.amount, contract.currency)}
                        </td>
                        <td className="px-2 py-1 text-center">
                          {p.paid ? <span className="font-bold">✓</span> : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-[1.8px] border-slate-900 font-bold">
                    <td className="px-2 py-1" />
                    <td className="px-2 py-1">Ҷамъ</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {docAmount(scheduleTotal, contract.currency)}
                    </td>
                    <td className="px-2 py-1" />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
