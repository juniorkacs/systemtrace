import { useDeferredValue, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, Plus, Search } from "lucide-react";
import { api } from "../api.ts";
import { PRIORITIES, REQUIREMENT_STATUSES, REQUIREMENT_TYPES } from "../../shared/schema.ts";
import { Button, Empty, ErrorBanner, Loading, PageHeader, Panel, StateBadge, Tag, inputCls, useAsync } from "../components/ui.tsx";
import { RequirementForm } from "../components/RequirementForm.tsx";

export function Requirements() {
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const search = params.get("search") ?? "";
  const deferredSearch = useDeferredValue(search);
  const filter = {
    search: deferredSearch || undefined,
    status: params.get("status") ?? undefined,
    priority: params.get("priority") ?? undefined,
    type: params.get("type") ?? undefined,
  };
  const list = useAsync(() => api.requirements(filter), [filter.search, filter.status, filter.priority, filter.type]);
  const all = useAsync(() => api.requirements(), [creating]);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Requirements"
        description="Every requirement with its verification state and trace links. Select a row to edit it, change its links or run impact analysis."
        actions={
          !creating ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden /> New requirement
            </Button>
          ) : null
        }
      />

      {creating ? (
        <Panel title="New requirement" className="mb-6">
          <RequirementForm
            parents={all.data ?? []}
            submitLabel="Create requirement"
            onCancel={() => setCreating(false)}
            onSubmit={async (v) => {
              await api.createRequirement(v);
              navigate(`/requirements/${v.id}`);
            }}
          />
        </Panel>
      ) : null}

      <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_repeat(3,10rem)]">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" aria-hidden />
          <label htmlFor="req-search" className="sr-only">
            Search requirements
          </label>
          <input
            id="req-search"
            type="search"
            className={`${inputCls} pl-8`}
            placeholder="Search ID, title or description"
            value={search}
            onChange={(e) => setParam("search", e.target.value)}
          />
        </div>
        {(
          [
            ["status", REQUIREMENT_STATUSES, "All statuses"],
            ["priority", PRIORITIES, "All priorities"],
            ["type", REQUIREMENT_TYPES, "All types"],
          ] as const
        ).map(([key, options, all]) => (
          <div key={key}>
            <label htmlFor={`filter-${key}`} className="sr-only">
              Filter by {key}
            </label>
            <select id={`filter-${key}`} className={inputCls} value={params.get(key) ?? ""} onChange={(e) => setParam(key, e.target.value)}>
              <option value="">{all}</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {list.error ? <ErrorBanner error={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data ? (
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[52rem] text-sm">
            <caption className="sr-only">Requirements</caption>
            <thead className="bg-sunken text-left text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-normal">ID</th>
                <th scope="col" className="px-3 py-2 font-normal">Title</th>
                <th scope="col" className="px-3 py-2 font-normal">Priority</th>
                <th scope="col" className="px-3 py-2 font-normal">Status</th>
                <th scope="col" className="px-3 py-2 font-normal">Verification</th>
                <th scope="col" className="px-3 py-2 text-center font-normal">Allocated</th>
                <th scope="col" className="px-3 py-2 text-right font-normal">Links</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-raised">
              {list.data.map((r) => (
                <tr key={r.id} className="hover:bg-sunken/60">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link to={`/requirements/${r.id}`} className="type-condensed text-accent hover:underline">
                      {r.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className={r.parentId ? "pl-4 text-ink" : "text-ink"}>{r.title}</span>
                    {r.childCount ? <span className="ml-2 text-xs text-muted">{r.childCount} children</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <Tag tone={r.priority === "high" ? "bad" : "muted"}>{r.priority}</Tag>
                  </td>
                  <td className="px-3 py-2 text-muted">{r.status}</td>
                  <td className="px-3 py-2">
                    {r.status === "deferred" ? <span className="text-xs text-muted">deferred</span> : <StateBadge state={r.verificationState} />}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.allocated ? (
                      <Check size={16} className="inline text-ok" aria-label="Allocated" />
                    ) : (
                      <span className="text-xs text-warn">No</span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-muted">
                    {r.componentIds.length} / {r.testIds.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data.length === 0 ? <Empty>No requirements match these filters.</Empty> : null}
        </div>
      ) : null}
      <p className="mt-2 text-xs text-muted">Links column shows components / tests linked directly to each requirement.</p>
    </>
  );
}
