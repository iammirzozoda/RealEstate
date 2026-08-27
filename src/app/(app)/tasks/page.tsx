"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/isConfigured";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { SetupNotice } from "@/components/SetupNotice";
import { ControlGroup, PillButton } from "@/components/ActionBar";
import { AddButton } from "@/components/AddButton";
import { Pagination } from "@/components/Pagination";
import { TASK_STATUS_COLORS } from "@/lib/tasks/format";
import { TASK_STATUSES, type Task, type TaskStatusValue } from "@/lib/tasks/types";

const PAGE_SIZE = 25;

export default function TasksPage() {
  const { t } = useLocale();
  const configured = isSupabaseConfigured();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  // "Loading" is derived, not stored. It is exactly "the data on screen does
  // not belong to the parameters currently set", so it is a comparison, not a
  // flag raised before a fetch and lowered after -- and raising it inside the
  // effect cost a second render every time a filter moved. Not configured
  // means nothing will ever load, so it is not loading either.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<TaskStatusValue | "all">("all");

  // Every filter change restarts at page 1 -- page 7 of the previous result
  // set means nothing once the filter moved. Done in the handlers rather
  // than in an effect watching them: the reset is part of the event.
  function onFilterChange<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setPage(1);
    };
  }

  const queryKey = [page, statusFilter].join("|");
  const loading = configured && loadedKey !== queryKey;

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();

    let query = supabase.schema("crm").from("tasks").select("*", { count: "exact" });
    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    const from = (page - 1) * PAGE_SIZE;
    query = query
      .order("due_date", { ascending: true, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1);

    query.then(({ data, count }) => {
      setTasks((data ?? []) as Task[]);
      setTotalCount(count ?? 0);
      setLoadedKey(queryKey);
    });
  }, [configured, page, statusFilter, queryKey]);

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t.tasks.title}</h1>

      {!configured && <SetupNotice />}

      {/* One option per status rather than a dropdown: there are only four,
          and as pills the current filter is visible without opening anything.
          The add action lives in the same right-aligned cluster now, not a
          separate control up in the title row with a gap of empty header
          between it and everything else that touches this list. */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <ControlGroup>
          <PillButton
            label={t.tasks.filters.allStatuses}
            active={statusFilter === "all"}
            onClick={() => onFilterChange(setStatusFilter)("all")}
          />
          {TASK_STATUSES.map((status) => (
            <PillButton
              key={status}
              label={t.tasks.statuses[status]}
              active={statusFilter === status}
              onClick={() => onFilterChange(setStatusFilter)(status)}
            />
          ))}
        </ControlGroup>
        <AddButton href="/tasks/new">{t.tasks.newTask}</AddButton>
      </div>

      <div className="animate-fade-up hidden overflow-x-auto rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] sm:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--border-c)] text-[var(--ink-4)]">
            <tr>
              <th className="px-4 py-3 font-medium">{t.tasks.table.title}</th>
              <th className="px-4 py-3 font-medium">{t.tasks.table.dueDate}</th>
              <th className="px-4 py-3 font-medium">{t.tasks.table.status}</th>
              <th className="px-4 py-3 font-medium">{t.tasks.table.assignee}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[var(--ink-5)]">
                  {t.common.loading}
                </td>
              </tr>
            )}
            {!loading && tasks.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[var(--ink-5)]">
                  {t.tasks.empty}
                </td>
              </tr>
            )}
            {tasks.map((task) => {
              const today = new Date().toISOString().slice(0, 10);
              const soonDate = new Date();
              soonDate.setDate(soonDate.getDate() + 3);
              const soon = soonDate.toISOString().slice(0, 10);
              const overdue =
                task.status !== "done" && !!task.due_date && task.due_date < today;
              const dueSoon =
                task.status !== "done" &&
                !!task.due_date &&
                task.due_date >= today &&
                task.due_date <= soon;

              return (
                <tr
                  key={task.id}
                  className="cursor-pointer border-b border-[var(--border-c2)] transition-colors last:border-0 hover:bg-[var(--hover-c)]"
                >
                  <td className="px-4 py-3 font-medium text-[var(--ink-1)]">
                    <Link href={`/tasks/${task.id}`} className="block">
                      {task.title}
                    </Link>
                  </td>
                  <td
                    className={`px-4 py-3 ${overdue ? "font-medium text-[var(--wash-rose-ink)]" : dueSoon ? "font-medium text-[var(--wash-amber-ink)]" : "text-[var(--ink-3)]"}`}
                  >
                    {task.due_date || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${TASK_STATUS_COLORS[task.status]}`}
                    >
                      {t.tasks.statuses[task.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--ink-3)]">{task.assignee || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="animate-fade-up flex flex-col gap-2 sm:hidden">
        {loading && (
          <p className="rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] px-4 py-6 text-center text-sm text-[var(--ink-5)]">
            {t.common.loading}
          </p>
        )}
        {!loading && tasks.length === 0 && (
          <p className="rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] px-4 py-6 text-center text-sm text-[var(--ink-5)]">
            {t.tasks.empty}
          </p>
        )}
        {tasks.map((task) => {
          const today = new Date().toISOString().slice(0, 10);
          const soonDate = new Date();
          soonDate.setDate(soonDate.getDate() + 3);
          const soon = soonDate.toISOString().slice(0, 10);
          const overdue = task.status !== "done" && !!task.due_date && task.due_date < today;
          const dueSoon =
            task.status !== "done" &&
            !!task.due_date &&
            task.due_date >= today &&
            task.due_date <= soon;

          return (
            <Link
              key={task.id}
              href={`/tasks/${task.id}`}
              className="flex flex-col gap-2 rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] p-3.5 transition-colors active:bg-[var(--hover-c)]"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-[var(--ink-1)]">{task.title}</span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${TASK_STATUS_COLORS[task.status]}`}
                >
                  {t.tasks.statuses[task.status]}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span
                  className={
                    overdue
                      ? "font-medium text-[var(--wash-rose-ink)]"
                      : dueSoon
                        ? "font-medium text-[var(--wash-amber-ink)]"
                        : "text-[var(--ink-3)]"
                  }
                >
                  {task.due_date || "—"}
                </span>
                <span className="text-[var(--ink-4)]">{task.assignee || "—"}</span>
              </div>
            </Link>
          );
        })}
      </div>

      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}
