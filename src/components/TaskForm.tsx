"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { DATE_BOUNDS, isDateInRange } from "@/lib/dates";
import { createClient } from "@/lib/supabase/client";
import { TASK_STATUSES, type TaskInput } from "@/lib/tasks/types";
import type { Client } from "@/lib/clients/types";
import type { PropertyObject } from "@/lib/objects/types";

const emptyInput: TaskInput = {
  title: "",
  description: "",
  due_date: "",
  status: "todo",
  assignee: "",
  assignee_phone: "",
  client_id: "",
  object_id: "",
};

export function TaskForm({
  initial,
  submitting,
  onSubmit,
  onDelete,
}: {
  initial?: Partial<TaskInput>;
  submitting: boolean;
  onSubmit: (values: TaskInput) => void;
  onDelete?: () => void;
}) {
  const { t } = useLocale();
  const [values, setValues] = useState<TaskInput>({ ...emptyInput, ...initial });
  const [clients, setClients] = useState<Client[]>([]);
  const [objects, setObjects] = useState<PropertyObject[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("crm")
      .from("clients")
      .select("*")
      .order("name")
      .then(({ data }) => setClients((data ?? []) as Client[]));
    supabase
      .schema("crm")
      .from("objects")
      .select("*")
      .order("name")
      .then(({ data }) => setObjects((data ?? []) as PropertyObject[]));
  }, []);

  const update = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const dueBounds = DATE_BOUNDS.future();
  const dueInvalid = !isDateInRange(values.due_date, dueBounds.min, dueBounds.max);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (dueInvalid) return;
        onSubmit(values);
      }}
      className="flex max-w-xl flex-col gap-4"
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-2)]">{t.tasks.form.title}</span>
        <input
          required
          value={values.title}
          onChange={(e) => update("title", e.target.value)}
          className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-2)]">{t.tasks.form.description}</span>
        <textarea
          value={values.description}
          onChange={(e) => update("description", e.target.value)}
          rows={3}
          className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
        />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.tasks.form.dueDate}</span>
          {/* A deadline may be in the future, so this window allows it -- but
              not year 20260. */}
          <input
            type="date"
            value={values.due_date}
            min={dueBounds.min}
            max={dueBounds.max}
            onChange={(e) => update("due_date", e.target.value)}
            className={`rounded-md border bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)] ${
              dueInvalid ? "border-[var(--wash-rose-ink)]" : "border-[var(--field-border)] focus:border-[var(--field-focus-border)]"
            }`}
          />
          {dueInvalid && (
            <span className="text-xs font-medium text-[var(--wash-rose-ink)]">
              {t.common.dateOutOfRange
                .replace("{min}", dueBounds.min)
                .replace("{max}", dueBounds.max)}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.tasks.form.status}</span>
          <select
            value={values.status}
            onChange={(e) => update("status", e.target.value as TaskInput["status"])}
            className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
          >
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t.tasks.statuses[status]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.tasks.form.assignee}</span>
          <input
            value={values.assignee}
            onChange={(e) => update("assignee", e.target.value)}
            className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.tasks.form.assigneePhone}</span>
          <input
            value={values.assignee_phone}
            onChange={(e) => update("assignee_phone", e.target.value)}
            placeholder="+992"
            className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.tasks.form.client}</span>
          <select
            value={values.client_id}
            onChange={(e) => update("client_id", e.target.value)}
            className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
          >
            <option value="">{t.tasks.form.noneOption}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.tasks.form.object}</span>
          <select
            value={values.object_id}
            onChange={(e) => update("object_id", e.target.value)}
            className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
          >
            <option value="">{t.tasks.form.noneOption}</option>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
        >
          {t.tasks.form.save}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-[var(--wash-rose-border)] px-4 py-2 text-sm font-medium text-[var(--wash-rose-ink)] hover:bg-[var(--wash-rose)]"
          >
            {t.tasks.form.delete}
          </button>
        )}
      </div>
    </form>
  );
}
