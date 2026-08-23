"use client";

import { useCallback, useEffect, useState } from "react";
import { BackLink } from "@/components/BackLink";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { createClient } from "@/lib/supabase/client";
import { useRole, type Role } from "@/lib/auth/useRole";
import type { Building } from "@/lib/buildings/types";

// A user in the staff list can be role-less ("none") -- that's a person
// created in Supabase Auth who hasn't been given a role yet. The whole
// point of this page is to turn those into managers/directors/admins.
type StaffRole = Role | "none";
type StaffUser = {
  id: string;
  email: string | null;
  role: StaffRole;
  created_at: string;
};

async function authHeaders() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

export default function UsersPage() {
  const { t } = useLocale();
  const { role, loading: roleLoading } = useRole();

  const [users, setUsers] = useState<StaffUser[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Set<string>>>({});
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Optional convenience: create straight from here. Needs the server
  // service key; when it isn't set this simply fails with a clear message
  // and the admin uses the Supabase-Dashboard path instead. The LIST and
  // ROLE assignment below never touch the service key.
  const [showCreate, setShowCreate] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("manager");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    // Users come from an in-database RPC (list_staff), not the service-key
    // API -- so this page works even when SUPABASE_SERVICE_ROLE_KEY is
    // wrong or unset.
    const [staffRes, buildingsRes, assignmentsRes] = await Promise.all([
      supabase.schema("crm").rpc("list_staff"),
      supabase.schema("crm").from("buildings").select("*").order("name"),
      supabase.schema("crm").from("manager_buildings").select("user_id, building_id"),
    ]);
    if (staffRes.error) {
      setError(staffRes.error.message);
      setUsers([]);
    } else {
      setUsers((staffRes.data ?? []) as StaffUser[]);
    }
    setBuildings((buildingsRes.data ?? []) as Building[]);
    const map: Record<string, Set<string>> = {};
    for (const row of (assignmentsRes.data ?? []) as Array<{
      user_id: string;
      building_id: string;
    }>) {
      (map[row.user_id] ??= new Set()).add(row.building_id);
    }
    setAssignments(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (role === "admin") load();
  }, [role, load]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ email, password, role: newRole }),
    });
    const data = await res.json();
    if (res.ok) {
      setEmail("");
      setPassword("");
      setNewRole("manager");
      setShowCreate(false);
      await load();
    } else {
      setError(data.error);
    }
    setCreating(false);
  };

  // Role changes go through the set_user_role RPC (admin-guarded in the DB).
  const handleRoleChange = async (userId: string, newUserRole: StaffRole) => {
    setError(null);
    const prev = users;
    setUsers((us) => us.map((u) => (u.id === userId ? { ...u, role: newUserRole } : u)));
    const supabase = createClient();
    const { error: rpcError } = await supabase
      .schema("crm")
      .rpc("set_user_role", { p_user: userId, p_role: newUserRole });
    if (rpcError) {
      setError(rpcError.message);
      setUsers(prev); // revert
    }
  };

  const toggleAssignment = async (userId: string, buildingId: string) => {
    const supabase = createClient();
    const has = assignments[userId]?.has(buildingId) ?? false;
    setAssignments((prev) => {
      const next = { ...prev, [userId]: new Set(prev[userId] ?? []) };
      if (has) next[userId].delete(buildingId);
      else next[userId].add(buildingId);
      return next;
    });
    const { error: writeError } = has
      ? await supabase
          .schema("crm")
          .from("manager_buildings")
          .delete()
          .eq("user_id", userId)
          .eq("building_id", buildingId)
      : await supabase
          .schema("crm")
          .from("manager_buildings")
          .insert({ user_id: userId, building_id: buildingId });
    if (writeError) {
      setError(writeError.message);
      await load();
    }
  };

  if (roleLoading) return <p className="text-[var(--ink-5)]">{t.common.loading}</p>;
  if (role !== "admin") {
    return (
      <div className="flex flex-col gap-3">
        <BackLink href="/settings">{t.users.backToSettings}</BackLink>
        <p className="text-[var(--ink-4)]">{t.users.accessDenied}</p>
        <WhoAmI />
      </div>
    );
  }

  const roleOptions: { value: StaffRole; label: string }[] = [
    { value: "none", label: t.users.roleNone },
    { value: "manager", label: t.users.roleManager },
    { value: "director", label: t.users.roleDirector },
    { value: "admin", label: t.users.roleAdmin },
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <BackLink href="/settings">{t.users.backToSettings}</BackLink>
      <h1 className="text-2xl font-semibold">{t.users.title}</h1>

      {/* How-to: the reliable path is create-in-Supabase, assign-here. */}
      <div className="rounded-xl border border-brand-soft bg-brand-soft p-4 text-sm text-[var(--ink-3)]">
        <p className="font-semibold text-brand">{t.users.howToTitle}</p>
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
          <li>{t.users.howTo1}</li>
          <li>{t.users.howTo2}</li>
          <li>{t.users.howTo3}</li>
        </ol>
        <button
          type="button"
          onClick={() => setShowCreate((s) => !s)}
          className="-mx-1 mt-2 w-fit rounded px-1 text-xs font-medium text-brand transition-colors hover:bg-brand-soft"
        >
          {showCreate ? t.users.hideCreate : t.users.showCreate}
        </button>
      </div>

      {/* Optional direct-create form (needs the service key). */}
      {showCreate && (
        <div className="rounded-xl border border-[var(--border-c)] bg-[var(--surface-1)] p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-2.5">
            <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs">
              <span className="font-semibold text-[var(--ink-3)]">{t.users.email}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@mail.com"
                className="h-10 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
              />
            </label>
            <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs">
              <span className="font-semibold text-[var(--ink-3)]">{t.users.password}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                className="h-10 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-semibold text-[var(--ink-3)]">{t.users.role}</span>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as Role)}
                className="h-10 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)]"
              >
                <option value="manager">{t.users.roleManager}</option>
                <option value="director">{t.users.roleDirector}</option>
                <option value="admin">{t.users.roleAdmin}</option>
              </select>
            </label>
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating || !email || password.length < 6}
              className="h-10 rounded-lg btn-brand px-4 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
            >
              {creating ? t.users.creating : t.users.create}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-[var(--wash-rose-ink)]">{error}</p>}

      {loading ? (
        <p className="text-[var(--ink-5)]">{t.common.loading}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-c)] bg-[var(--surface-1)] shadow-sm">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <thead className="border-b border-[var(--border-c)] text-[var(--ink-4)]">
              <tr>
                <th className="px-4 py-3 font-medium">{t.users.email}</th>
                <th className="px-4 py-3 font-medium">{t.users.role}</th>
                <th className="px-4 py-3 font-medium">{t.users.createdAt}</th>
                <th className="px-4 py-3 font-medium">{t.users.actions}</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-[var(--ink-5)]">
                    {t.users.empty}
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  roleOptions={roleOptions}
                  buildings={buildings}
                  assigned={assignments[u.id]}
                  expanded={expandedUser === u.id}
                  onToggleExpand={() =>
                    setExpandedUser((prev) => (prev === u.id ? null : u.id))
                  }
                  onRoleChange={(r) => handleRoleChange(u.id, r)}
                  onToggleBuilding={(bId) => toggleAssignment(u.id, bId)}
                  t={t}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UserRow({
  user,
  roleOptions,
  buildings,
  assigned,
  expanded,
  onToggleExpand,
  onRoleChange,
  onToggleBuilding,
  t,
}: {
  user: StaffUser;
  roleOptions: { value: StaffRole; label: string }[];
  buildings: Building[];
  assigned: Set<string> | undefined;
  expanded: boolean;
  onToggleExpand: () => void;
  onRoleChange: (r: StaffRole) => void;
  onToggleBuilding: (buildingId: string) => void;
  t: ReturnType<typeof useLocale>["t"];
}) {
  const roleTone: Record<StaffRole, string> = {
    none: "border-[var(--field-border)] text-[var(--ink-5)]",
    manager: "border-[var(--wash-sky-ink)] text-[var(--wash-sky-ink)]",
    director: "border-[var(--wash-amber-ink)] text-[var(--wash-amber-ink)]",
    admin: "border-brand-soft text-brand",
  };
  return (
    <>
      <tr className="border-b border-[var(--border-c2)] last:border-0">
        <td className="px-4 py-2.5">{user.email}</td>
        <td className="px-4 py-2.5">
          <select
            value={user.role}
            onChange={(e) => onRoleChange(e.target.value as StaffRole)}
            className={`rounded-md border bg-[var(--surface-1)] px-2 py-1 font-medium ${roleTone[user.role]}`}
          >
            {roleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </td>
        <td className="px-4 py-2.5 text-[var(--ink-4)]">
          {new Date(user.created_at).toLocaleDateString()}
        </td>
        <td className="px-4 py-2.5">
          {user.role === "manager" && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="rounded-lg border border-[var(--field-border)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-2)] transition-all hover:bg-[var(--surface-2)] active:scale-95"
            >
              {t.users.assignBuildings} ({assigned?.size ?? 0})
            </button>
          )}
        </td>
      </tr>
      {expanded && user.role === "manager" && (
        <tr className="border-b border-[var(--border-c2)]">
          <td colSpan={4} className="bg-[var(--surface-2)] px-4 py-3">
            <p className="mb-2 text-xs font-medium text-[var(--ink-4)]">{t.users.assignHint}</p>
            {buildings.length === 0 ? (
              <p className="text-xs text-[var(--ink-5)]">{t.buildings.empty}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {buildings.map((b) => {
                  const checked = assigned?.has(b.id) ?? false;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => onToggleBuilding(b.id)}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all active:scale-95 ${
                        checked
                          ? "border-brand bg-brand text-white"
                          : "border-[var(--field-border)] bg-[var(--surface-1)] text-[var(--ink-3)] hover:bg-[var(--hover-c2)]"
                      }`}
                    >
                      {checked ? "✓ " : ""}
                      {b.name}
                    </button>
                  );
                })}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function WhoAmI() {
  const [info, setInfo] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      const u = data.user;
      if (!u) {
        setInfo(null);
        return;
      }
      const { data: p } = await supabase
        .schema("crm")
        .from("profiles")
        .select("role")
        .eq("id", u.id)
        .maybeSingle();
      setInfo(`${u.email} — ${p?.role ?? "—"}`);
    });
  }, []);
  if (!info) return null;
  return <p className="text-xs text-[var(--ink-5)]">{info}</p>;
}
