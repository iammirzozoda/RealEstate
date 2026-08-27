"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { DATE_BOUNDS, isDateInRange } from "@/lib/dates";
import { PassportScanner } from "@/components/PassportScanner";
import { AddButton } from "@/components/AddButton";
import type { Client, ClientInput } from "@/lib/clients/types";

const FIELD_CLASS =
  "h-10 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]";

const emptyNewClient: ClientInput = {
  name: "",
  phone: "",
  phone2: "",
  email: "",
  passport: "",
  passport_issued_by: "",
  birth_date: "",
  address: "",
  source: "",
  interested_object_id: "",
  notes: "",
};

export function ClientAutocomplete({
  clients,
  value,
  onChange,
  newClient,
  onNewClientChange,
}: {
  clients: Client[];
  value: string;
  onChange: (clientId: string) => void;
  newClient: ClientInput | null;
  onNewClientChange: (value: ClientInput | null) => void;
}) {
  const { t } = useLocale();
  const selected = clients.find((c) => c.id === value) ?? null;
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(selected?.name ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q === selected?.name.toLowerCase()) return [];
    return clients.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [clients, query, selected]);

  const updateNew = <K extends keyof ClientInput>(key: K, val: ClientInput[K]) => {
    if (!newClient) return;
    onNewClientChange({ ...newClient, [key]: val });
  };

  // Same rule as the full client form -- this quick-add path was a second way
  // in with no bounds at all.
  const birthBounds = DATE_BOUNDS.birth();
  const birthInvalid = !isDateInRange(newClient?.birth_date ?? "", birthBounds.min, birthBounds.max);

  if (newClient) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-c)] bg-[var(--surface-1)] p-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-[var(--border-c2)] pb-2">
          <span className="text-sm font-semibold text-[var(--ink-2)]">{t.clients.form.addNew}</span>
          <button
            type="button"
            onClick={() => onNewClientChange(null)}
            className="rounded-md px-2 py-1 text-xs font-medium text-[var(--ink-4)] transition-colors hover:bg-[var(--hover-c2)] hover:text-[var(--ink-1)]"
          >
            {t.clients.form.backToSearch}
          </button>
        </div>

        {/* Booking a unit from the shakhmatka is exactly the moment a
            client's ID is in hand at the desk -- same scanner as the full
            client form, wired to this quick-add draft instead. */}
        <PassportScanner
          onExtract={(fields) => {
            onNewClientChange({
              ...newClient,
              ...(fields.name ? { name: fields.name } : {}),
              ...(fields.passport ? { passport: fields.passport } : {}),
              ...(fields.passport_issued_by
                ? { passport_issued_by: fields.passport_issued_by }
                : {}),
              ...(fields.birth_date ? { birth_date: fields.birth_date } : {}),
              ...(fields.address ? { address: fields.address } : {}),
            });
          }}
        />

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.clients.form.name}</span>
          <input
            required
            autoFocus
            value={newClient.name}
            onChange={(e) => updateNew("name", e.target.value)}
            className={FIELD_CLASS}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">{t.clients.form.phone}</span>
            <input
              value={newClient.phone}
              onChange={(e) => updateNew("phone", e.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">{t.clients.form.email}</span>
            <input
              type="email"
              value={newClient.email}
              onChange={(e) => updateNew("email", e.target.value)}
              className={FIELD_CLASS}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">
              {t.clients.form.passport} <span className="text-[var(--wash-rose-ink)]">*</span>
            </span>
            <input
              required
              value={newClient.passport}
              onChange={(e) => updateNew("passport", e.target.value)}
              placeholder={t.clients.form.passportPlaceholder}
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">
              {t.clients.form.passportIssuedBy} <span className="text-[var(--wash-rose-ink)]">*</span>
            </span>
            <input
              required
              value={newClient.passport_issued_by}
              onChange={(e) => updateNew("passport_issued_by", e.target.value)}
              className={FIELD_CLASS}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">
              {t.clients.form.birthDate} <span className="text-[var(--wash-rose-ink)]">*</span>
            </span>
            <input
              required
              type="date"
              value={newClient.birth_date}
              min={birthBounds.min}
              max={birthBounds.max}
              onChange={(e) => updateNew("birth_date", e.target.value)}
              className={`${FIELD_CLASS} ${birthInvalid ? "border-[var(--wash-rose-ink)]" : ""}`}
            />
            {birthInvalid && (
              <span className="text-xs font-medium text-[var(--wash-rose-ink)]">
                {t.clients.form.birthDateRange
                  .replace("{min}", birthBounds.min)
                  .replace("{max}", birthBounds.max)}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">{t.clients.form.address}</span>
            <input
              value={newClient.address}
              onChange={(e) => updateNew("address", e.target.value)}
              className={FIELD_CLASS}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.clients.form.notes}</span>
          <textarea
            value={newClient.notes}
            onChange={(e) => updateNew("notes", e.target.value)}
            rows={2}
            className="rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-sm text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
          />
        </label>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1 text-sm">
      <span className="font-medium text-[var(--ink-2)]">{t.contracts.form.client}</span>
      <input
        required
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange("");
        }}
        onFocus={() => setOpen(true)}
        placeholder={t.contracts.form.selectClient}
        autoComplete="off"
        className={FIELD_CLASS}
      />

      {open && matches.length > 0 && (
        <div className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] shadow-lg">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c.id);
                setQuery(c.name);
                setOpen(false);
              }}
              className="flex w-full flex-col items-start px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--hover-c)]"
            >
              <span className="font-medium text-[var(--ink-1)]">{c.name}</span>
              {c.phone && <span className="text-xs text-[var(--ink-4)]">{c.phone}</span>}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="mt-1 flex flex-col gap-2">
          {(!selected.passport || !selected.passport_issued_by || !selected.birth_date) && (
            <p className="rounded-lg bg-[var(--wash-amber)] px-3 py-2 text-xs font-medium text-[var(--wash-amber-ink)]">
              ⚠ {t.contracts.form.missingRequiredClientFields}
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 rounded-xl border border-[var(--border-c)] bg-[var(--surface-2)] p-3 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-[var(--ink-5)]">
                {t.clients.form.phone}
              </span>
              <span className="text-sm text-[var(--ink-2)]">{selected.phone || "—"}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-[var(--ink-5)]">
                {t.clients.form.birthDate}
              </span>
              <span
                className={`text-sm ${selected.birth_date ? "text-[var(--ink-2)]" : "font-medium text-[var(--wash-amber-ink)]"}`}
              >
                {selected.birth_date || "—"}
              </span>
            </div>
            <div className="col-span-2 flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-[var(--ink-5)]">
                {t.clients.form.address}
              </span>
              <span className="text-sm text-[var(--ink-2)]">{selected.address || "—"}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-[var(--ink-5)]">
                {t.clients.form.passport}
              </span>
              <span
                className={`text-sm ${selected.passport ? "text-[var(--ink-2)]" : "font-medium text-[var(--wash-amber-ink)]"}`}
              >
                {selected.passport || "—"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-[var(--ink-5)]">
                {t.clients.form.passportIssuedBy}
              </span>
              <span
                className={`text-sm ${selected.passport_issued_by ? "text-[var(--ink-2)]" : "font-medium text-[var(--wash-amber-ink)]"}`}
              >
                {selected.passport_issued_by || "—"}
              </span>
            </div>
          </div>
        </div>
      )}

      {!selected && (
        <AddButton
          size="sm"
          className="mt-1"
          onClick={() => onNewClientChange({ ...emptyNewClient, name: query.trim() })}
        >
          {t.clients.form.addNew}
        </AddButton>
      )}
    </div>
  );
}
